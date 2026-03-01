const https = require('https');
const http = require('http');
const { URL } = require('url');

const REQUEST_TIMEOUT_MS = 45000; // 45초 (공공 API 응답 지연 대비)

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
  Referer: 'https://opendart.fss.or.kr/',
};

function getRedirected(fullUrl) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(fullUrl);
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: DEFAULT_HEADERS,
    };

    const req = lib.get(options, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const location = res.headers.location;
        if (location) {
          const next = new URL(location, fullUrl);
          if (!next.search && parsed.search) {
            next.search = parsed.search;
          }
          res.resume();
          getRedirected(next.href).then(resolve, reject);
          return;
        }
      }
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode, data }));
    });
    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error(`Open DART 요청 시간 초과 (${REQUEST_TIMEOUT_MS / 1000}초). URL: ${fullUrl.split('?')[0]}`));
    });
  });
}

/** 바이너리 응답 수집 (ZIP 등). */
function getRedirectedBinary(fullUrl) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(fullUrl);
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: DEFAULT_HEADERS,
    };
    const req = lib.get(options, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const location = res.headers.location;
        if (location) {
          const next = new URL(location, fullUrl);
          if (!next.search && parsed.search) next.search = parsed.search;
          res.resume();
          getRedirectedBinary(next.href).then(resolve, reject);
          return;
        }
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode, data: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error(`Open DART 요청 시간 초과 (${REQUEST_TIMEOUT_MS / 1000}초). URL: ${fullUrl.split('?')[0]}`));
    });
  });
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function requestJson(url, params, apiKey) {
  if (!apiKey || apiKey.trim() === '') {
    return Promise.reject(new Error('OPENDART_API_KEY가 비어 있습니다.'));
  }
  const search = new URLSearchParams({ crtfc_key: apiKey.trim(), ...params }).toString();
  const fullUrl = `${url}?${search}`;

  const timeoutPromise = delay(REQUEST_TIMEOUT_MS).then(() => {
    throw new Error(`Open DART 전체 요청 시간 초과 (${REQUEST_TIMEOUT_MS / 1000}초). URL: ${url}`);
  });

  const fetchPromise = getRedirected(fullUrl).then(({ statusCode, data }) => {
    if (!data || data.trim() === '') {
      throw new Error(`Open DART 응답 없음 (HTTP ${statusCode}). URL: ${url}`);
    }
    try {
      return JSON.parse(data);
    } catch (err) {
      const preview = data.length > 300 ? data.slice(0, 300) + '...' : data;
      throw new Error(
        `Open DART 응답이 JSON이 아님 (HTTP ${statusCode}). 본문 앞부분: ${preview.replace(/\s+/g, ' ')}`,
      );
    }
  });

  return Promise.race([fetchPromise, timeoutPromise]);
}

/**
 * GET 요청 후 응답 본문을 Buffer로 반환 (ZIP 등 바이너리용).
 * @param {string} url - 베이스 URL
 * @param {Record<string,string>} params - 쿼리 파라미터 (crtfc_key 제외)
 * @param {string} apiKey - 인증키
 * @returns {Promise<Buffer>}
 */
function requestBinary(url, params, apiKey) {
  if (!apiKey || apiKey.trim() === '') {
    return Promise.reject(new Error('OPENDART_API_KEY가 비어 있습니다.'));
  }
  const search = new URLSearchParams({ crtfc_key: apiKey.trim(), ...params }).toString();
  const fullUrl = `${url}?${search}`;

  const timeoutPromise = delay(REQUEST_TIMEOUT_MS).then(() => {
    throw new Error(`Open DART 전체 요청 시간 초과 (${REQUEST_TIMEOUT_MS / 1000}초). URL: ${url}`);
  });

  const fetchPromise = getRedirectedBinary(fullUrl).then(({ data }) => data);

  return Promise.race([fetchPromise, timeoutPromise]);
}

module.exports = {
  requestJson,
  requestBinary,
  delay,
};

