/**
 * market_cache에서 partial(시총 null 등) 레코드를 찾아 재수집/갱신한다.
 *
 * 사용 예:
 *   node scripts/db/refresh-partial-market-cache.js
 *   node scripts/db/refresh-partial-market-cache.js --limit 30
 *   node scripts/db/refresh-partial-market-cache.js --dry-run
 */
const path = require('path');
const fsp = require('fs/promises');
const { spawn } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const { createHybridLibsqlClient } = require('./libsql-client');
const { ensureSchema } = require('./schema');
const { upsertMarketFromPayload } = require('./sync-market-to-db');

const ROOT = path.resolve(__dirname, '..', '..');
const MARKET_DIR = path.join(ROOT, 'data', 'market');

function parseArgv(argv) {
  const args = argv.slice(2);
  const out = { limit: 50, dryRun: false };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--dry-run') out.dryRun = true;
    if (a === '--limit') {
      const v = Number(args[i + 1]);
      if (Number.isFinite(v) && v > 0) out.limit = Math.floor(v);
      i += 1;
    }
  }
  return out;
}

function isPartialPayload(ticker, payload) {
  if (!payload || typeof payload !== 'object') return true;
  if (String(payload.stock_code || '').trim() !== String(ticker || '').trim()) return true;
  const hasDaily = Array.isArray(payload.daily_chart) && payload.daily_chart.length > 0;
  const hasCap = payload.market_cap != null && Number.isFinite(Number(payload.market_cap));
  return !hasDaily || !hasCap;
}

async function readPartialTickers(client, limit) {
  const res = await client.execute({
    sql: 'SELECT ticker, payload_json, fetched_at FROM market_cache ORDER BY fetched_at ASC',
    args: [],
  });
  const rows = Array.isArray(res?.rows) ? res.rows : [];
  const partial = [];
  for (const row of rows) {
    const ticker = String(row.ticker || '').trim();
    if (!ticker) continue;
    let payload = null;
    try {
      payload = row.payload_json ? JSON.parse(String(row.payload_json)) : null;
    } catch (_) {
      payload = null;
    }
    if (isPartialPayload(ticker, payload)) {
      partial.push(ticker);
      if (partial.length >= limit) break;
    }
  }
  return partial;
}

function runPythonOnce(pythonCmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonCmd, args, { cwd: ROOT, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => { stdout += String(b); });
    child.stderr.on('data', (b) => { stderr += String(b); });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(stderr.trim() || stdout.trim() || `exit=${code}`));
      return resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

async function runPythonMarketFetch(ticker) {
  await fsp.mkdir(MARKET_DIR, { recursive: true });
  const outPath = path.join(MARKET_DIR, `${ticker}.json`);
  const scriptPath = path.join(ROOT, 'scripts', 'fetch-market-data.py');
  const args = [scriptPath, String(ticker), '--output', outPath];
  const tryOrder = process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'];
  let lastErr = null;
  for (const cmd of tryOrder) {
    try {
      await runPythonOnce(cmd, args);
      return outPath;
    } catch (err) {
      lastErr = err;
      if (err && (err.code === 'ENOENT' || String(err.message || '').includes('spawn'))) continue;
      throw err;
    }
  }
  throw new Error(lastErr ? lastErr.message : 'python not found');
}

async function readJsonSafe(filePath) {
  try {
    const raw = await fsp.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

async function main() {
  const { limit, dryRun } = parseArgv(process.argv);
  const { client } = createHybridLibsqlClient(process.env);
  await ensureSchema(client);

  const tickers = await readPartialTickers(client, limit);
  console.log(`[refresh-partial-market-cache] found_partial=${tickers.length} limit=${limit} dry_run=${dryRun}`);
  if (tickers.length === 0) return;

  let refreshed = 0;
  let stillPartial = 0;
  let failed = 0;
  for (const ticker of tickers) {
    if (dryRun) {
      console.log(`  - ${ticker}`);
      continue;
    }
    try {
      const outPath = await runPythonMarketFetch(ticker);
      const payload = await readJsonSafe(outPath);
      if (!payload || String(payload.stock_code || '').trim() !== ticker) {
        failed += 1;
        console.log(`  [fail] ${ticker} invalid payload`);
        continue;
      }
      await upsertMarketFromPayload(client, ticker, payload, new Date().toISOString());
      refreshed += 1;
      if (isPartialPayload(ticker, payload)) {
        stillPartial += 1;
        console.log(`  [partial] ${ticker} cache updated but still partial`);
      } else {
        console.log(`  [ok] ${ticker} refreshed`);
      }
    } catch (err) {
      failed += 1;
      console.log(`  [fail] ${ticker} ${err.message}`);
    }
  }

  console.log(`[refresh-partial-market-cache] refreshed=${refreshed} still_partial=${stillPartial} failed=${failed}`);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
