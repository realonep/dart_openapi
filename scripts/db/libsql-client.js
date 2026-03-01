const { createClient } = require('@libsql/client');

function normalizeUrl(rawUrl) {
  const input = String(rawUrl || '').trim();
  return input || 'file:local.db';
}

function isRemoteLibsqlUrl(url) {
  return /^libsql:\/\//i.test(url) || /^https?:\/\//i.test(url);
}

function applyLocalSqlitePragmas(client, cfg, env = process.env) {
  if (!client || !cfg || cfg.remote) return;
  const busyTimeoutMs = Math.max(0, Number(env.SQLITE_BUSY_TIMEOUT_MS || 5000));
  if (busyTimeoutMs > 0) {
    client.execute(`PRAGMA busy_timeout = ${busyTimeoutMs}`).catch(() => {});
  }
}

function resolveLibsqlConfig(env = process.env) {
  const url = normalizeUrl(env.DATABASE_URL);
  const authToken = String(env.DATABASE_AUTH_TOKEN || '').trim();
  const remote = isRemoteLibsqlUrl(url);
  if (remote && !authToken) {
    throw new Error('DATABASE_AUTH_TOKEN is required for remote libSQL/Turso');
  }

  return {
    url,
    authToken: remote ? authToken : undefined,
    remote,
  };
}

function createHybridLibsqlClient(env = process.env) {
  const cfg = resolveLibsqlConfig(env);
  const client = createClient({
    url: cfg.url,
    authToken: cfg.authToken,
  });
  applyLocalSqlitePragmas(client, cfg, env);

  return {
    client,
    config: cfg,
  };
}

/** Create a client with explicit url and optional authToken (for sync source/target). */
function createClientWith(url, authToken) {
  const u = String(url || 'file:local.db').trim() || 'file:local.db';
  const client = createClient({
    url: u,
    authToken: authToken ? String(authToken).trim() : undefined,
  });
  applyLocalSqlitePragmas(client, { remote: isRemoteLibsqlUrl(u) });
  return client;
}

module.exports = {
  createHybridLibsqlClient,
  createClientWith,
  resolveLibsqlConfig,
  isRemoteLibsqlUrl,
};
