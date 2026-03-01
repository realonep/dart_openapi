const { createJsonProvider } = require('./json-provider');
const { createLibsqlProvider } = require('./libsql-provider');

function normalizeMode(value) {
  const mode = String(value || 'json').trim().toLowerCase();
  if (mode === 'db') return 'db';
  return 'json';
}

function toBool(v, defaultValue = false) {
  const raw = String(v || '').trim().toLowerCase();
  if (!raw) return defaultValue;
  return ['1', 'true', 'yes', 'y'].includes(raw);
}

function createDataProvider(options = {}) {
  const requestedMode = normalizeMode(options.requestedMode);
  const strict = toBool(options.strictMode, false);
  const dataRoot = options.dataRoot;

  const jsonProvider = createJsonProvider({ dataRoot });
  if (requestedMode === 'json') {
    return {
      provider: jsonProvider,
      requestedMode,
      activeMode: 'json',
      fallbackReason: null,
    };
  }

  try {
    const dbProvider = createLibsqlProvider({
      ...options,
      fallbackProvider: jsonProvider,
    });
    return {
      provider: dbProvider,
      requestedMode,
      activeMode: 'db',
      fallbackReason: null,
    };
  } catch (err) {
    if (strict) throw err;
    return {
      provider: jsonProvider,
      requestedMode,
      activeMode: 'json',
      fallbackReason: err.message || 'db provider init failed',
    };
  }
}

module.exports = {
  createDataProvider,
};
