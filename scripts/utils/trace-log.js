function isTraceEnabled(env = process.env) {
  const v = String(env.ENABLE_TRACE_LOGS || 'false').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function safeSerialize(obj) {
  try {
    return JSON.stringify(obj);
  } catch (_) {
    return '{"error":"trace-serialize-failed"}';
  }
}

function trace(event, fields = {}, env = process.env) {
  if (!isTraceEnabled(env)) return;
  const payload = {
    ts: new Date().toISOString(),
    event: String(event || 'trace'),
    ...fields,
  };
  // 한 줄 JSON 형태로 남겨 grep/집계가 쉽도록 구성
  console.log(`[TRACE] ${safeSerialize(payload)}`);
}

module.exports = {
  trace,
  isTraceEnabled,
};

