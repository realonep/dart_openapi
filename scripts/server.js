const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { URL } = require('url');
const { spawn } = require('child_process');
const { fetchNaverConsensusByTicker } = require('./utils/naver-consensus-client');
const { createDataProvider } = require('./data-providers');
const { createHybridLibsqlClient } = require('./db/libsql-client');
const { ensureSchema } = require('./db/schema');
const { upsertMarketFromPayload } = require('./db/sync-market-to-db');
const { trace } = require('./utils/trace-log');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ROOT = path.resolve(__dirname, '..');
const DATA_ROOT = path.join(ROOT, 'data');
const FETCH_LOG_DIR = path.join(ROOT, 'logs', 'fetch-one');
const META_DIR = path.join(DATA_ROOT, 'meta');
const CORP_CODE_LIST_PATH = path.join(META_DIR, 'corp-code-list.json');
const COMPANIES_CONFIG_PATH = path.join(META_DIR, 'companies-config.json');
const MARKET_CACHE_DIR = path.join(DATA_ROOT, 'market');
const PUBLIC_ROOT = ROOT;
const PORT = Number(process.env.PORT || 4173);
const BASE_TTL_HOURS = Number(process.env.MARKET_CACHE_TTL_HOURS || 2);
const USE_SESSION_TTL = String(process.env.MARKET_CACHE_USE_SESSION_TTL || 'true').toLowerCase() !== 'false';
const MARKET_TTL_HOURS = Number(process.env.MARKET_CACHE_TTL_MARKET_HOURS || BASE_TTL_HOURS);
const OFF_HOURS_TTL_HOURS = Number(process.env.MARKET_CACHE_TTL_OFF_HOURS || Math.max(BASE_TTL_HOURS, 6));
const MARKET_PARTIAL_TTL_HOURS = Number(process.env.MARKET_CACHE_TTL_PARTIAL_HOURS || 0.5);
const CONSENSUS_TTL_HOURS = Number(process.env.CONSENSUS_CACHE_TTL_HOURS || 12);
const DATA_BACKEND = String(process.env.DATA_BACKEND || 'json').trim().toLowerCase();
const DATA_BACKEND_STRICT = process.env.DATA_BACKEND_STRICT;
const FETCH_ONE_WATCHDOG_MS = Math.max(0, Number(process.env.FETCH_ONE_WATCHDOG_MS || 15 * 60 * 1000));

const dataProviderResult = createDataProvider({
  requestedMode: DATA_BACKEND,
  strictMode: DATA_BACKEND_STRICT,
  dataRoot: DATA_ROOT,
});
const dataProvider = dataProviderResult.provider;

let marketDbClient = null;
let marketDbInitDone = false;
function getMarketDbClient() {
  if (DATA_BACKEND !== 'db') return null;
  if (marketDbInitDone) return marketDbClient;
  marketDbInitDone = true;
  try {
    const hybrid = createHybridLibsqlClient();
    marketDbClient = hybrid.client;
    ensureSchema(marketDbClient).catch((err) => {
      console.error('[Market DB] ensureSchema failed:', err.message);
      marketDbClient = null;
    });
    return marketDbClient;
  } catch (_) {
    return null;
  }
}

/** 동시 수집 중복 방지: spawn된 fetch-one-corp 프로세스가 살아있는 corp_code 집합 */
const collectingCorps = new Set();

const MAX_BODY_BYTES = 4096; // API body는 corp_code(8자리) JSON만 필요 — 4KB 초과 거부

/** POST body에서 corp_code(8자리) 추출. 유효하지 않으면 null 반환. */
async function parseCorpCodeBody(req) {
  let body = '';
  let size = 0;
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > MAX_BODY_BYTES) return null; // 과도한 body 즉시 거부
    body += chunk;
  }
  try {
    const code = String(JSON.parse(body || '{}').corp_code || '').trim();
    return /^\d{8}$/.test(code) ? code : null;
  } catch (_) {
    return null;
  }
}

/**
 * fetch-one-corp.js 프로세스 스폰.
 * 이미 수집 중이면 false 반환, 스폰 성공 시 true 반환.
 * forceRespawn=true 이면 collectingCorps를 먼저 제거하고 재시작 (reset-corp 전용).
 * onExit 콜백은 종료 시 exitCode를 받아 호출됩니다.
 */
function spawnFetchOne(corpCode, forceRespawn = false, onExit = null) {
  if (forceRespawn) collectingCorps.delete(corpCode);
  if (collectingCorps.has(corpCode)) return false;
  const scriptPath = path.join(__dirname, 'fetch-one-corp.js');
  collectingCorps.add(corpCode);

  // logs/fetch-one/ 에 stderr 캡처 (디렉터리 없으면 생성)
  let stderrStream = 'ignore';
  try {
    fs.mkdirSync(FETCH_LOG_DIR, { recursive: true });
    const logPath = path.join(FETCH_LOG_DIR, `${corpCode}.log`);
    stderrStream = fs.openSync(logPath, 'w');
  } catch (_) { /* 로그 디렉터리 생성 실패 시 무시 */ }

  const child = spawn(process.execPath, [scriptPath, corpCode], {
    env: process.env,
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', 'ignore', stderrStream],
  });
  trace('fetch_one_spawned', { corp_code: corpCode, force_respawn: !!forceRespawn, pid: child.pid });
  let settled = false;
  const watchdog = FETCH_ONE_WATCHDOG_MS > 0
    ? setTimeout(() => {
      if (settled) return;
      settled = true;
      collectingCorps.delete(corpCode);
      if (typeof stderrStream === 'number') {
        try { fs.closeSync(stderrStream); } catch (_) {}
      }
      console.error(`[fetch-one] corp=${corpCode} watchdog timeout (${FETCH_ONE_WATCHDOG_MS}ms) — cleared collecting flag`);
      trace('fetch_one_watchdog_timeout', { corp_code: corpCode, watchdog_ms: FETCH_ONE_WATCHDOG_MS });
      if (typeof onExit === 'function') onExit(124);
    }, FETCH_ONE_WATCHDOG_MS)
    : null;
  if (watchdog && typeof watchdog.unref === 'function') watchdog.unref();

  child.on('exit', (code) => {
    if (settled) return;
    settled = true;
    if (watchdog) clearTimeout(watchdog);
    // fd를 정수로 열었을 때 자식 종료 후 명시적으로 닫아 누수 방지
    if (typeof stderrStream === 'number') {
      try { fs.closeSync(stderrStream); } catch (_) {}
    }
    collectingCorps.delete(corpCode);
    if (code !== 0) {
      console.error(`[fetch-one] corp=${corpCode} exited with code=${code} — see logs/fetch-one/${corpCode}.log`);
    }
    trace('fetch_one_exit', { corp_code: corpCode, exit_code: Number(code) });
    if (typeof onExit === 'function') onExit(code);
  });
  child.on('error', (err) => {
    if (settled) return;
    settled = true;
    if (watchdog) clearTimeout(watchdog);
    if (typeof stderrStream === 'number') {
      try { fs.closeSync(stderrStream); } catch (_) {}
    }
    collectingCorps.delete(corpCode);
    console.error(`[fetch-one] corp=${corpCode} spawn error:`, err.message);
    trace('fetch_one_spawn_error', { corp_code: corpCode, error: String(err.message || err) });
    if (typeof onExit === 'function') onExit(125);
  });
  child.unref();
  return true;
}

/** 수집 대상·전체 상장사용 DB (sync_targets, corp_master). DATA_BACKEND와 무관하게 연결 가능하면 사용. */
let listDbClient = null;
let listDbInitDone = false;
let listDbSchemaDone = false;  // ensureSchema가 이미 완료됐으면 재실행 방지
function getListDbClient() {
  if (listDbInitDone) return listDbClient;
  listDbInitDone = true;
  try {
    const hybrid = createHybridLibsqlClient();
    listDbClient = hybrid.client;
    ensureSchema(listDbClient)
      .then(() => { listDbSchemaDone = true; })
      .catch((err) => {
        console.error('[List DB] ensureSchema failed:', err.message);
      });
    return listDbClient;
  } catch (_) {
    return null;
  }
}

/** ensureSchema가 완료된 이후에만 client를 반환. 미완료 시 null → 호출자 fallback. */
async function getListDbClientReady() {
  const client = getListDbClient();
  if (!client) return null;
  if (!listDbSchemaDone) {
    // 아직 완료 안 된 경우 완료까지 대기 (최대 3초)
    const deadline = Date.now() + 3000;
    while (!listDbSchemaDone && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  return listDbSchemaDone ? client : null;
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

function isValidPositiveNumber(v) {
  return Number.isFinite(v) && v > 0;
}

function getKstParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = fmt.formatToParts(date);
  const weekday = parts.find((p) => p.type === 'weekday')?.value || '';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  return { weekday, hour, minute };
}

function isMarketOpenKst(date = new Date()) {
  const { weekday, hour, minute } = getKstParts(date);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  if (hour < 9 || hour > 15) return false;
  if (hour === 15 && minute > 30) return false;
  return true;
}

function resolveMarketTtlHours(now = new Date()) {
  const base = isValidPositiveNumber(BASE_TTL_HOURS) ? BASE_TTL_HOURS : 2;
  if (!USE_SESSION_TTL) return base;
  const onMarket = isMarketOpenKst(now);
  const dynamic = onMarket ? MARKET_TTL_HOURS : OFF_HOURS_TTL_HOURS;
  return isValidPositiveNumber(dynamic) ? dynamic : base;
}

function isFreshByTtl(mtime, ttlHours, now = new Date()) {
  if (!(mtime instanceof Date) || !isValidPositiveNumber(ttlHours)) return false;
  const ttlMs = ttlHours * 60 * 60 * 1000;
  return now.getTime() - mtime.getTime() <= ttlMs;
}

async function readJsonSafe(filePath) {
  try {
    const raw = await fsp.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function toSafeTickerFileName(ticker) {
  const cleaned = String(ticker || '').trim().replace(/[^a-zA-Z0-9._-]/g, '');
  return cleaned || 'unknown';
}

function getMarketCachePath(ticker) {
  const fileName = `${toSafeTickerFileName(ticker)}.json`;
  return path.join(MARKET_CACHE_DIR, fileName);
}

function getConsensusCachePath(corpCode) {
  return path.join(DATA_ROOT, 'corp', String(corpCode || ''), 'consensus.json');
}

function runPythonProcess(pythonCmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonCmd, args, { cwd: ROOT, windowsHide: true });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (buf) => {
      stdout += String(buf);
    });
    child.stderr.on('data', (buf) => {
      stderr += String(buf);
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        const msg = stderr.trim() || stdout.trim() || `exit=${code}`;
        reject(new Error(msg));
        return;
      }
      resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

async function runPythonMarketFetch(ticker, outputPath) {
  await fsp.mkdir(MARKET_CACHE_DIR, { recursive: true });
  const scriptPath = path.join(ROOT, 'scripts', 'fetch-market-data.py');
  const args = [scriptPath, String(ticker), '--output', outputPath];

  const tryOrder = process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'];
  let lastError = null;

  for (const pythonCmd of tryOrder) {
    try {
      const result = await runPythonProcess(pythonCmd, args);
      if (result.stdout) console.log(`  [Market] ${result.stdout}`);
      return result;
    } catch (err) {
      lastError = err;
      if (err.code === 'ENOENT' || (err.message && err.message.includes('spawn'))) {
        continue;
      }
      throw new Error(`market data 수집 실패: ${err.message}`);
    }
  }

  throw new Error(
    `python 실행 실패: ${lastError?.message || 'unknown'}. ` +
    '일봉 데이터 수집을 위해 Python 설치 후 pip install finance-datareader pandas 실행해 주세요.'
  );
}

/** KRX 종목코드는 6자리. 8자리면 고유번호(corp_code)이므로 목록에서 종목코드로 보정. */
async function resolveStockCodeFromCorpCode(corpCode) {
  const code = String(corpCode || '').trim();
  if (!/^\d{8}$/.test(code)) return null;
  const client = getListDbClient();
  if (client) {
    try {
      const result = await client.execute({
        sql: 'SELECT stock_code FROM corp_master WHERE corp_code = ? LIMIT 1',
        args: [code],
      });
      const rows = (result && result.rows) || [];
      const stock = rows[0] && rows[0].stock_code;
      if (stock && String(stock).trim().length === 6) return String(stock).trim();
    } catch (_) {
      /* fallback to file */
    }
  }
  try {
    const data = await fsp.readFile(CORP_CODE_LIST_PATH, 'utf-8');
    const list = JSON.parse(data);
    const items = list && list.items;
    if (!Array.isArray(items)) return null;
    const found = items.find((c) => String(c.corp_code || '').trim() === code);
    const stock = found && found.stock_code;
    if (stock && String(stock).trim().length === 6) return String(stock).trim();
  } catch (_) {
    return null;
  }
  return null;
}

async function getMarketDataOnDemand(tickerInput) {
  let ticker = String(tickerInput || '').trim();
  if (!ticker) {
    return { data: null, cache: 'skip-no-ticker' };
  }
  // 8자리 숫자면 corp_code로 간주 → 종목코드로 보정하지 않고 스킵(보정은 handleCorpDetail에서 함)
  if (/^\d{8}$/.test(ticker)) {
    return { data: null, cache: 'skip-invalid-ticker-corp-code' };
  }

  const now = new Date();
  const ttlHours = resolveMarketTtlHours(now);
  const partialTtlHours = isValidPositiveNumber(MARKET_PARTIAL_TTL_HOURS) ? MARKET_PARTIAL_TTL_HOURS : 0.5;
  const marketPath = getMarketCachePath(ticker);

  const client = getMarketDbClient();
  if (client) {
    try {
      const row = await client.execute({
        sql: 'SELECT payload_json, fetched_at FROM market_cache WHERE ticker = ?',
        args: [ticker],
      });
      const rows = row.rows || [];
      if (rows.length > 0) {
        const payloadJson = rows[0].payload_json;
        const fetchedAtStr = rows[0].fetched_at;
        const fetchedAt = fetchedAtStr ? new Date(fetchedAtStr) : null;
        if (fetchedAt && isFreshByTtl(fetchedAt, ttlHours, now)) {
          const data = payloadJson ? JSON.parse(payloadJson) : null;
          const hasSameTicker =
            data &&
            String(data.stock_code || '').trim() === ticker &&
            Array.isArray(data.daily_chart) &&
            data.daily_chart.length > 0;
          const hasMarketCap = hasSameTicker && data.market_cap != null && Number.isFinite(Number(data.market_cap));
          if (hasMarketCap) {
            return { data, cache: `db-hit-ttl-${ttlHours}h` };
          }
          if (hasSameTicker && isFreshByTtl(fetchedAt, partialTtlHours, now)) {
            return { data, cache: `db-hit-partial-ttl-${partialTtlHours}h` };
          }
        }
      }
    } catch (_) {
      /* fallback to file */
    }
  }

  let stat = null;
  let existing = null;
  try {
    stat = await fsp.stat(marketPath);
    existing = await readJsonSafe(marketPath);
  } catch (_) {
    stat = null;
    existing = null;
  }

  const hasSameTicker =
    existing &&
    String(existing.stock_code || '').trim() === ticker &&
    Array.isArray(existing.daily_chart) &&
    existing.daily_chart.length > 0;
  const hasMarketCap = hasSameTicker && existing.market_cap != null && Number.isFinite(Number(existing.market_cap));
  if (stat && hasMarketCap && isFreshByTtl(stat.mtime, ttlHours, now)) {
    return { data: existing, cache: `file-hit-ttl-${ttlHours}h` };
  }
  if (stat && hasSameTicker && isFreshByTtl(stat.mtime, partialTtlHours, now)) {
    return { data: existing, cache: `file-hit-partial-ttl-${partialTtlHours}h` };
  }

  await runPythonMarketFetch(ticker, marketPath);
  const fresh = await readJsonSafe(marketPath);
  if (client && fresh) {
    try {
      await upsertMarketFromPayload(client, ticker, fresh, now.toISOString());
    } catch (_) {
      /* non-fatal */
    }
  }
  return { data: fresh, cache: `miss-refresh-ttl-${ttlHours}h` };
}

function evaluateMarketDataQuality(data, ticker) {
  if (!data) {
    return {
      quality: 'missing',
      alert: { level: 'warn', message: '시장 데이터가 비어 있습니다.' },
    };
  }

  const sameTicker = String(data.stock_code || '').trim() === String(ticker || '').trim();
  const hasDaily = Array.isArray(data.daily_chart) && data.daily_chart.length > 0;
  const hasCap = data.market_cap != null && Number.isFinite(Number(data.market_cap));

  if (!sameTicker) {
    return {
      quality: 'partial',
      alert: { level: 'warn', message: '시장 데이터 종목코드가 요청값과 다릅니다.' },
    };
  }
  if (!hasDaily && !hasCap) {
    return {
      quality: 'missing',
      alert: { level: 'warn', message: '일봉/시가총액 모두 비어 있습니다.' },
    };
  }
  if (!hasCap) {
    return {
      quality: 'partial',
      alert: { level: 'warn', message: '시가총액 데이터가 비어 있습니다.' },
    };
  }
  if (!hasDaily) {
    return {
      quality: 'partial',
      alert: { level: 'warn', message: '일봉 데이터가 비어 있습니다.' },
    };
  }
  return { quality: 'ok', alert: null };
}

async function getConsensusOnDemand(corpCode, tickerInput, forceRefresh = false) {
  const ticker = String(tickerInput || '').trim();
  if (!ticker) {
    return {
      data: null,
      cache: 'skip-no-ticker',
      alert: { level: 'warn', message: '종목코드가 없어 컨센서스 조회를 건너뛰었습니다.' },
    };
  }
  const cachePath = getConsensusCachePath(corpCode);
  const now = new Date();
  let existing = null;
  let stat = null;
  try {
    existing = await readJsonSafe(cachePath);
    stat = await fsp.stat(cachePath);
  } catch (_) {
    existing = null;
    stat = null;
  }

  if (!forceRefresh && existing && stat && isFreshByTtl(stat.mtime, CONSENSUS_TTL_HOURS, now)) {
    return { data: existing, cache: `hit-ttl-${CONSENSUS_TTL_HOURS}h`, alert: null };
  }

  try {
    const fetched = await fetchNaverConsensusByTicker(ticker);
    const payload = {
      corp_code: corpCode,
      stock_code: ticker,
      source: 'naver',
      unit: '억원',
      items: fetched.items || [],
      source_url: fetched.source_url || null,
      fetch_policy: {
        ttl_hours: CONSENSUS_TTL_HOURS,
      },
      last_updated_at: new Date().toISOString().slice(0, 10),
      fetched_at: new Date().toISOString(),
    };
    await fsp.mkdir(path.dirname(cachePath), { recursive: true });
    await fsp.writeFile(cachePath, JSON.stringify(payload, null, 2), 'utf-8');
    if (!Array.isArray(payload.items) || payload.items.length === 0) {
      return {
        data: payload,
        cache: forceRefresh ? `force-refresh-ttl-${CONSENSUS_TTL_HOURS}h` : `miss-refresh-ttl-${CONSENSUS_TTL_HOURS}h`,
        alert: { level: 'warn', message: '컨센서스 응답은 정상이나 표시 가능한 E 데이터가 없습니다.' },
      };
    }
    return {
      data: payload,
      cache: forceRefresh ? `force-refresh-ttl-${CONSENSUS_TTL_HOURS}h` : `miss-refresh-ttl-${CONSENSUS_TTL_HOURS}h`,
      alert: null,
    };
  } catch (err) {
    if (existing) {
      return {
        data: existing,
        cache: `stale-fallback:${err.message}`,
        alert: { level: 'warn', message: `컨센서스 최신 수집 실패로 캐시를 사용합니다: ${err.message}` },
      };
    }
    return {
      data: null,
      cache: `error:${err.message}`,
      alert: { level: 'error', message: `컨센서스 수집 실패: ${err.message}` },
    };
  }
}

function resolveStaticPath(urlPathname) {
  const normalized = decodeURIComponent(urlPathname).replace(/\\/g, '/');
  const requested = normalized === '/' ? '/index.html' : normalized;
  const abs = path.resolve(PUBLIC_ROOT, `.${requested}`);
  if (!abs.startsWith(PUBLIC_ROOT)) return null;
  return abs;
}

async function handleCorpDetail(reqUrl, res, corpCode) {
  const t0 = Date.now();
  const base = await dataProvider.getCorpDetailBase(corpCode);
  if (!base) {
    trace('corp_detail_not_found', { corp_code: corpCode, elapsed_ms: Date.now() - t0 });
    sendJson(res, 404, { error: '해당 기업 데이터가 없습니다.', corp_code: corpCode });
    return;
  }
  const { overview, financials, dividends, guidance, treasury, consensus: baseConsensus, shareholders, officers } = base;

  const tickerFromQuery = reqUrl.searchParams.get('ticker');
  let ticker = String(tickerFromQuery || overview?.stock_code || '').trim();
  // ticker가 비어 있거나 8자리(corp_code)면 목록에서 종목코드로 보정
  if (!ticker || (ticker === String(corpCode || '').trim() && /^\d{8}$/.test(ticker))) {
    const resolved = await resolveStockCodeFromCorpCode(corpCode);
    if (resolved) ticker = resolved;
  }
  const forceConsensus = ['1', 'true', 'yes'].includes(String(reqUrl.searchParams.get('force_consensus') || '').toLowerCase());

  let marketData = null;
  let marketCache = 'skip';
  let marketAlert = null;
  let marketQuality = 'missing';
  try {
    const market = await getMarketDataOnDemand(ticker);
    marketData = market.data;
    marketCache = market.cache;
    const evaluated = evaluateMarketDataQuality(marketData, ticker);
    marketAlert = evaluated.alert;
    marketQuality = evaluated.quality;
  } catch (err) {
    marketData = null;
    marketCache = `error:${err.message}`;
    marketAlert = { level: 'error', message: `시장 데이터 처리 오류: ${err.message}` };
    marketQuality = 'error';
    console.warn(`  [Market] ticker=${ticker} error:`, err.message);
  }

  let consensusData = null;
  let consensusCache = 'skip';
  let consensusAlert = null;
  if (baseConsensus != null) {
    consensusData = baseConsensus;
    consensusCache = 'db';
  } else {
    try {
      const consensus = await getConsensusOnDemand(corpCode, ticker, forceConsensus);
      consensusData = consensus.data;
      consensusCache = consensus.cache;
      consensusAlert = consensus.alert || null;
    } catch (err) {
      consensusData = null;
      consensusCache = `error:${err.message}`;
      consensusAlert = { level: 'error', message: `컨센서스 처리 오류: ${err.message}` };
    }
  }

  if (consensusAlert) {
    console.log(`  [Consensus/Alert] corp=${corpCode} level=${consensusAlert.level} cache=${consensusCache} msg=${consensusAlert.message}`);
  }

  sendJson(res, 200, {
    corp_code: corpCode,
    collecting: collectingCorps.has(corpCode),
    overview,
    financials,
    dividends,
    guidance,
    treasury,
    shareholders,
    officers,
    market_data: marketData,
    market_cache: marketCache,
    market_quality: marketQuality,
    market_alert: marketAlert,
    consensus: consensusData,
    consensus_cache: consensusCache,
    consensus_alert: consensusAlert,
    served_at: new Date().toISOString(),
  });
  trace('corp_detail_served', {
    corp_code: corpCode,
    collecting: collectingCorps.has(corpCode),
    has_financials: financials != null,
    has_shareholders: shareholders != null,
    has_officers: officers != null,
    elapsed_ms: Date.now() - t0,
  });
}

async function handleRequest(req, res) {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = reqUrl.pathname;

  if (pathname === '/api/system/data-backend') {
    sendJson(res, 200, {
      requested_mode: dataProviderResult.requestedMode,
      active_mode: dataProviderResult.activeMode,
      read_strategy: dataProvider.readStrategy || 'native',
      fallback_reason: dataProviderResult.fallbackReason,
    });
    return;
  }

  if (pathname === '/api/corp-index') {
    const corpIndex = await dataProvider.getCorpIndex();
    if (!Array.isArray(corpIndex)) {
      sendJson(res, 404, { error: '기업 인덱스 데이터가 없습니다.' });
      return;
    }
    sendJson(res, 200, corpIndex);
    return;
  }

  if (pathname === '/api/search-corps') {
    const q = (reqUrl.searchParams.get('q') || '').trim();
    let items = [];
    const client = getListDbClient();
    if (client && q.length >= 1) {
      try {
        const pattern = `%${q}%`;
        const result = await client.execute({
          sql: `SELECT cm.corp_code, cm.corp_name, cm.stock_code, cm.modify_date, ci.stock_name
                FROM corp_master cm
                LEFT JOIN corp_index ci ON cm.corp_code = ci.corp_code
                WHERE cm.corp_name LIKE ? OR cm.stock_code LIKE ? OR cm.corp_code LIKE ? OR ci.stock_name LIKE ?
                LIMIT 200`,
          args: [pattern, pattern, pattern, pattern],
        });
        items = (result.rows || []).map((r) => ({
          corp_code: r.corp_code,
          corp_name: r.corp_name,
          stock_name: r.stock_name || null,
          stock_code: r.stock_code,
          modify_date: r.modify_date || '',
        }));
      } catch (_) {
        /* fallback to file */
      }
    }
    if (items.length === 0) {
      try {
        const data = await readJsonSafe(CORP_CODE_LIST_PATH);
        const list = data?.items || [];
        if (q.length >= 1) {
          const lower = q.toLowerCase();
          items = list.filter(
            (c) =>
              (c.corp_name && c.corp_name.toLowerCase().includes(lower)) ||
              (c.stock_code && c.stock_code.toLowerCase().includes(lower)) ||
              (c.corp_code && c.corp_code.toLowerCase().includes(lower)),
          );
        }
        items = items.slice(0, 200);
      } catch (_) {
        /* file missing or invalid */
      }
    }
    // 동일 corp_name 중복 제거: modify_date가 가장 최신인 항목 하나만 유지
    // (합병·상호변경으로 소멸된 구 법인 이력 제거)
    const nameMap = new Map();
    for (const it of items) {
      const key = (it.corp_name || '').trim();
      if (!key) continue;
      const prev = nameMap.get(key);
      if (!prev || (it.modify_date || '') > (prev.modify_date || '')) {
        nameMap.set(key, it);
      }
    }
    items = [...nameMap.values()].slice(0, 50);
    sendJson(res, 200, { items });
    return;
  }

  if (pathname === '/api/target-corps' && req.method === 'POST') {
    const corpCode = await parseCorpCodeBody(req);
    if (!corpCode) {
      sendJson(res, 400, { error: 'corp_code는 8자리 숫자여야 합니다.' });
      return;
    }
    const { readJson, writeJson } = require('./utils/file-utils');
    let targetCorps = [];
    const client = getListDbClient();
    if (client) {
      try {
        await client.execute({
          sql: 'INSERT OR REPLACE INTO sync_targets (corp_code, added_at, is_active) VALUES (?, ?, 1)',
          args: [corpCode, new Date().toISOString()],
        });
        const result = await client.execute({
          sql: 'SELECT corp_code FROM sync_targets WHERE is_active = 1 ORDER BY added_at',
          args: [],
        });
        targetCorps = (result.rows || []).map((r) => String(r.corp_code || ''));
      } catch (err) {
        sendJson(res, 500, { error: err.message || 'sync_targets write failed' });
        return;
      }
    }
    try {
      const config = readJson(COMPANIES_CONFIG_PATH, { target_corps: [], description: '' });
      const corps = config.target_corps || [];
      if (!corps.includes(corpCode)) {
        corps.push(corpCode);
        config.target_corps = corps;
        writeJson(COMPANIES_CONFIG_PATH, config);
      }
      if (targetCorps.length === 0) targetCorps = config.target_corps || [];
      sendJson(res, 200, { ok: true, target_corps: targetCorps });
    } catch (err) {
      if (targetCorps.length > 0) {
        sendJson(res, 200, { ok: true, target_corps: targetCorps });
      } else {
        sendJson(res, 500, { error: err.message || 'config write failed' });
      }
    }
    return;
  }

  if (pathname === '/api/fetch-one' && req.method === 'POST') {
    const corpCode = await parseCorpCodeBody(req);
    if (!corpCode) {
      sendJson(res, 400, { error: 'corp_code는 8자리 숫자여야 합니다.' });
      return;
    }
    const spawned = spawnFetchOne(corpCode);
    trace('api_fetch_one', { corp_code: corpCode, spawned });
    sendJson(res, 202, {
      ok: true,
      message: spawned ? '수집을 시작했습니다.' : '이미 수집 중입니다.',
      corp_code: corpCode,
    });
    return;
  }

  // 특정 기업 데이터 초기화 후 재수집 (overview 유지, 나머지 삭제 후 fetch-one 재실행)
  if (pathname === '/api/reset-corp' && req.method === 'POST') {
    const corpCode = await parseCorpCodeBody(req);
    if (!corpCode) {
      sendJson(res, 400, { error: 'corp_code는 8자리 숫자여야 합니다.' });
      return;
    }

    // Soft-delete 방식: 기존 데이터를 미리 삭제하지 않고 재수집을 먼저 시작.
    // 새 수집이 upsert로 각 테이블을 덮어쓰므로 사전 삭제가 필요 없음.
    // 재수집 성공 → 새 데이터로 교체됨. 실패 → 기존 데이터 그대로 보존.
    // (exit code ≠ 0 이면 logs/fetch-one/<corp_code>.log 에 원인 기록됨)
    const onFetchExit = (code) => {
      if (code !== 0) {
        console.warn(`[reset-corp] corp=${corpCode} re-fetch failed (code=${code}), old data preserved — see logs/fetch-one/${corpCode}.log`);
      } else {
        console.log(`[reset-corp] corp=${corpCode} re-fetch completed successfully`);
      }
    };

    spawnFetchOne(corpCode, true, onFetchExit);
    trace('api_reset_corp', { corp_code: corpCode, action: 'start_refetch' });
    console.log(`[reset-corp] corp=${corpCode} re-fetch started (existing data preserved until new data arrives)`);
    sendJson(res, 202, { ok: true, message: '재수집을 시작했습니다.', corp_code: corpCode });
    return;
  }

  const detailMatch = pathname.match(/^\/api\/corp\/([^/]+)\/detail$/);
  if (detailMatch) {
    const corpCode = decodeURIComponent(detailMatch[1]);
    await handleCorpDetail(reqUrl, res, corpCode);
    return;
  }

  const filePath = resolveStaticPath(pathname);
  if (!filePath) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  try {
    let stat = await fsp.stat(filePath);
    let target = filePath;
    if (stat.isDirectory()) {
      target = path.join(filePath, 'index.html');
      stat = await fsp.stat(target);
    }
    const ext = path.extname(target).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      'Content-Length': stat.size,
    });
    fs.createReadStream(target).pipe(res);
  } catch (_) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    sendJson(res, 500, { error: err.message || 'internal error' });
  });
});

server.listen(PORT, () => {
  const providerMsg = dataProviderResult.fallbackReason
    ? `requested=${dataProviderResult.requestedMode} active=${dataProviderResult.activeMode} fallback=${dataProviderResult.fallbackReason}`
    : `requested=${dataProviderResult.requestedMode} active=${dataProviderResult.activeMode}`;
  console.log(`[DataBackend] ${providerMsg}`);
  console.log(`Server running at http://localhost:${PORT}`);
});
