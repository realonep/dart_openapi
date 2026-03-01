const path = require('path');
const fs = require('fs/promises');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { createHybridLibsqlClient } = require('./db/libsql-client');
const { ensureSchema } = require('./db/schema');
const { upsertOneCorp } = require('./db/corp-writer');

const ROOT = path.resolve(__dirname, '..');
const DATA_ROOT = path.join(ROOT, 'data');

async function readJsonSafe(filePath, fallback = null) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toText(v) {
  if (v === null || v === undefined) return null;
  return String(v);
}

async function importCorpIndex(client) {
  const items = await readJsonSafe(path.join(DATA_ROOT, 'corp-index.json'), []);
  if (!Array.isArray(items)) return 0;

  await client.execute('DELETE FROM corp_index');
  for (const row of items) {
    await client.execute({
      sql: `INSERT OR REPLACE INTO corp_index (
        corp_code, corp_name, stock_name, stock_code, market, induty, sector, last_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        toText(row.corp_code),
        toText(row.corp_name),
        toText(row.stock_name),
        toText(row.stock_code),
        toText(row.market),
        toText(row.induty),
        toText(row.sector),
        toText(row.last_updated_at),
      ],
    });
  }
  return items.length;
}

async function importOneCorp(client, corpCode) {
  const corpDir = path.join(DATA_ROOT, 'corp', corpCode);
  const overview = await readJsonSafe(path.join(corpDir, 'overview.json'));
  const financials = await readJsonSafe(path.join(corpDir, 'financials.json'));
  const dividends = await readJsonSafe(path.join(corpDir, 'dividends.json'));
  const guidance = await readJsonSafe(path.join(corpDir, 'guidance.json'));
  const treasury = await readJsonSafe(path.join(corpDir, 'treasury.json'));
  const consensus = await readJsonSafe(path.join(corpDir, 'consensus.json'));
  await upsertOneCorp(client, corpCode, {
    overview,
    financials,
    dividends,
    guidance,
    treasury,
    consensus,
  });
}

async function getCorpCodesFromDataDir() {
  const corpRoot = path.join(DATA_ROOT, 'corp');
  const entries = await fs.readdir(corpRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function main() {
  const corpCodeFromArg = process.argv[2] ? String(process.argv[2]).trim() : '';
  const { client, config } = createHybridLibsqlClient(process.env);
  await ensureSchema(client);

  const importedIndexCount = await importCorpIndex(client);
  const corpCodes = corpCodeFromArg ? [corpCodeFromArg] : await getCorpCodesFromDataDir();
  for (const corpCode of corpCodes) {
    await importOneCorp(client, corpCode);
    console.log(`[migrate-json-to-db] imported corp=${corpCode}`);
  }

  console.log(
    `[migrate-json-to-db] done mode=${config.remote ? 'remote' : 'local'} url=${config.url} corp_count=${corpCodes.length} index_count=${importedIndexCount}`,
  );
}

main().catch((err) => {
  console.error(`[migrate-json-to-db] failed: ${err.message}`);
  process.exit(1);
});
