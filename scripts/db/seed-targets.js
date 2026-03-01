/**
 * companies-config.json 의 target_corps 를 sync_targets 테이블에 반영.
 * 최초 1회 또는 JSON으로 관리하던 수집 대상을 DB로 옮길 때 실행.
 * 실행: npm run db:seed-targets
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const { createHybridLibsqlClient } = require('./libsql-client');
const { ensureSchema } = require('./schema');
const { readJson } = require('../utils/file-utils');

const ROOT = path.resolve(__dirname, '..', '..');
const COMPANIES_CONFIG_PATH = path.join(ROOT, 'data', 'meta', 'companies-config.json');

async function main() {
  const config = readJson(COMPANIES_CONFIG_PATH, { target_corps: [] });
  const corps = config.target_corps || [];
  if (!corps.length) {
    console.log('[db:seed-targets] target_corps 비어 있음. 종료.');
    return;
  }

  const { client } = createHybridLibsqlClient(process.env);
  await ensureSchema(client);

  const now = new Date().toISOString();
  let inserted = 0;
  for (let i = 0; i < corps.length; i++) {
    const corpCode = String(corps[i] || '').trim();
    if (!corpCode) continue;
    await client.execute({
      sql: 'INSERT OR REPLACE INTO sync_targets (corp_code, added_at, is_active) VALUES (?, ?, 1)',
      args: [corpCode, now],
    });
    inserted += 1;
  }
  console.log(`[db:seed-targets] sync_targets에 ${inserted}건 반영됨.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
