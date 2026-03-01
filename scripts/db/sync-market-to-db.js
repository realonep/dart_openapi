/**
 * 마켓 캐시: 파일 → market_cache 테이블 upsert.
 * - 서버가 Python으로 파일 갱신 후 한 건 upsert할 때 사용
 * - CLI: data/market/*.json 전체 동기화 (npm run db:sync-market 등)
 */
const path = require('path');
const fsp = require('fs/promises');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const { createHybridLibsqlClient } = require('./libsql-client');
const { ensureSchema } = require('./schema');

const ROOT = path.resolve(__dirname, '..', '..');
const DATA_ROOT = path.join(ROOT, 'data');
const MARKET_DIR = path.join(DATA_ROOT, 'market');

/**
 * @param {object} client - libsql client (raw client from createHybridLibsqlClient().client)
 * @param {string} ticker - 종목코드 (PK)
 * @param {object} payload - 마켓 JSON 객체 전체 (stock_code, market_cap, daily_chart 등)
 * @param {string} [fetchedAt] - ISO 시각 (기본: 현재)
 */
async function upsertMarketFromPayload(client, ticker, payload, fetchedAt) {
  const at = fetchedAt || new Date().toISOString();
  await client.execute({
    sql: `INSERT OR REPLACE INTO market_cache (ticker, payload_json, fetched_at) VALUES (?, ?, ?)`,
    args: [String(ticker).trim(), JSON.stringify(payload), at],
  });
}

async function readJsonSafe(filePath) {
  try {
    const raw = await fsp.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

/**
 * data/market 디렉터리의 모든 .json 파일을 market_cache에 동기화.
 * @param {object} client - libsql client
 * @param {string} [marketDir] - 마켓 디렉터리 (기본: data/market)
 * @returns {{ synced: number, failed: string[] }}
 */
async function syncAllMarketFiles(client, marketDir = MARKET_DIR) {
  let synced = 0;
  const failed = [];
  let entries = [];
  try {
    entries = await fsp.readdir(marketDir, { withFileTypes: true });
  } catch (_) {
    return { synced: 0, failed: ['market dir not found'] };
  }
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.json')) continue;
    const ticker = e.name.replace(/\.json$/i, '');
    const filePath = path.join(marketDir, e.name);
    const payload = await readJsonSafe(filePath);
    if (!payload || !payload.stock_code) {
      failed.push(ticker);
      continue;
    }
    try {
      const stat = await fsp.stat(filePath);
      const fetchedAt = stat.mtime ? new Date(stat.mtime).toISOString() : new Date().toISOString();
      await upsertMarketFromPayload(client, payload.stock_code, payload, fetchedAt);
      synced += 1;
    } catch (err) {
      failed.push(`${ticker}: ${err.message}`);
    }
  }
  return { synced, failed };
}

async function main() {
  const { client } = createHybridLibsqlClient(process.env);
  await ensureSchema(client);
  const { synced, failed } = await syncAllMarketFiles(client);
  console.log(`[sync-market-to-db] synced=${synced} failed=${failed.length}`);
  if (failed.length) failed.forEach((f) => console.log(`  - ${f}`));
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = {
  upsertMarketFromPayload,
  syncAllMarketFiles,
};
