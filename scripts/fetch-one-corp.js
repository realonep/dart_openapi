/**
 * 단일 기업 수집. 서버에서 선택 시 백그라운드 실행용.
 * 사용: node scripts/fetch-one-corp.js <corp_code>
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const corpCode = process.argv[2] ? String(process.argv[2]).trim() : '';
if (!corpCode || !/^\d{8}$/.test(corpCode)) {
  console.error('Usage: node scripts/fetch-one-corp.js <corp_code> (8 digits)');
  process.exit(1);
}

const apiKey = process.env.OPENDART_API_KEY;
if (!apiKey || !apiKey.trim()) {
  console.error('OPENDART_API_KEY required');
  process.exit(1);
}

const dbOnly = /^1|true|yes|y$/i.test(String(process.env.DB_ONLY || '').trim());
const { createHybridLibsqlClient } = require('./db/libsql-client');
const { ensureSchema } = require('./db/schema');
const { syncOneCorp, getYears } = require('./sync-all');

async function main() {
  let dbClient = null;
  try {
    const hybrid = createHybridLibsqlClient(process.env);
    dbClient = hybrid.client;
    await ensureSchema(dbClient);
  } catch (e) {
    console.warn('[fetch-one-corp] DB init failed, continuing without DB:', e.message);
  }
  const years = getYears();
  const dataRoot = path.join(__dirname, '..', 'data');
  await syncOneCorp(corpCode, years, apiKey, dataRoot, { dbClient, dbOnly });
  console.log(`[fetch-one-corp] done ${corpCode}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
