/**
 * Phase A: Sync local SQLite → Turso (remote libSQL).
 * Run after npm run db:migrate when DATABASE_URL + DATABASE_AUTH_TOKEN are set.
 * If Turso is not configured, exits with 0 and a short message.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const { createClientWith, isRemoteLibsqlUrl } = require('./libsql-client');
const { ensureSchema, SYNCABLE_TABLES } = require('./schema');

function maskUrl(url) {
  const s = String(url || '');
  if (s.startsWith('file:')) return s;
  if (s.length <= 25) return s;
  return s.slice(0, 12) + '***' + s.slice(-8);
}

async function copyTable(sourceClient, targetClient, tableName) {
  const result = await sourceClient.execute({
    sql: `SELECT * FROM ${tableName}`,
    args: [],
  });
  const rows = result.rows || [];
  if (rows.length === 0) return 0;

  const columns = Object.keys(rows[0]);
  const placeholders = columns.map(() => '?').join(', ');
  const sql = `INSERT OR REPLACE INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`;

  for (const row of rows) {
    await targetClient.execute({
      sql,
      args: columns.map((c) => row[c]),
    });
  }
  return rows.length;
}

async function main() {
  const sourceUrl = process.env.SOURCE_DATABASE_URL || 'file:local.db';
  const targetUrl = (process.env.DATABASE_URL || '').trim();
  const targetToken = (process.env.DATABASE_AUTH_TOKEN || '').trim();

  if (!targetUrl || !isRemoteLibsqlUrl(targetUrl)) {
    console.log('[sync-to-remote] Turso not configured. Set DATABASE_URL (libsql://...) and DATABASE_AUTH_TOKEN to sync.');
    process.exit(0);
  }
  if (!targetToken) {
    console.error('[sync-to-remote] DATABASE_AUTH_TOKEN is required for remote sync.');
    process.exit(1);
  }

  const sourceClient = createClientWith(sourceUrl);
  const targetClient = createClientWith(targetUrl, targetToken);

  const startedAt = new Date().toISOString();
  const rowsPerTable = {};
  let status = 'ok';
  let errorMessage = null;

  try {
    await ensureSchema(targetClient);

    for (const table of SYNCABLE_TABLES) {
      const count = await copyTable(sourceClient, targetClient, table);
      rowsPerTable[table] = count;
      console.log(`  [sync] ${table}: ${count} rows`);
    }

    const finishedAt = new Date().toISOString();
    await targetClient.execute({
      sql: `INSERT INTO sync_runs (started_at, finished_at, source_url, target_url, status, tables_synced, rows_per_table, error_message)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        startedAt,
        finishedAt,
        maskUrl(sourceUrl),
        maskUrl(targetUrl),
        status,
        SYNCABLE_TABLES.length,
        JSON.stringify(rowsPerTable),
        errorMessage,
      ],
    });

    const total = Object.values(rowsPerTable).reduce((a, b) => a + b, 0);
    console.log(`[sync-to-remote] done. target=${maskUrl(targetUrl)} tables=${SYNCABLE_TABLES.length} total_rows=${total}`);
  } catch (err) {
    status = 'error';
    errorMessage = err.message || String(err);
    console.error(`[sync-to-remote] error: ${errorMessage}`);

    try {
      await targetClient.execute({
        sql: `INSERT INTO sync_runs (started_at, finished_at, source_url, target_url, status, tables_synced, rows_per_table, error_message)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          startedAt,
          new Date().toISOString(),
          maskUrl(sourceUrl),
          maskUrl(targetUrl),
          status,
          SYNCABLE_TABLES.length,
          JSON.stringify(rowsPerTable),
          errorMessage,
        ],
      });
    } catch (_) {}

    process.exit(1);
  }
}

main();
