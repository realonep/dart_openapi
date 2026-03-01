/**
 * corp_master 테이블 초기화(전부 삭제).
 * 실행: npm run db:clear-corp-master
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const { createHybridLibsqlClient } = require('./libsql-client');
const { ensureSchema } = require('./schema');

async function main() {
  const { client } = createHybridLibsqlClient(process.env);
  await ensureSchema(client);
  const result = await client.execute({ sql: 'DELETE FROM corp_master', args: [] });
  console.log('[db:clear-corp-master] corp_master 초기화 완료.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
