window.DartDataLoader = (function () {
  const CACHE_MAX = 120;       // fetchJson 경로 캐시 최대 항목 수
  const DETAIL_CACHE_MAX = 30; // corp 상세 캐시 최대 항목 수

  const cache = new Map();
  const detailCache = new Map();

  function setCapped(map, key, value, max) {
    if (map.size >= max) {
      // Map 삽입 순서 보장 → 첫 번째(가장 오래된) 항목 제거
      map.delete(map.keys().next().value);
    }
    map.set(key, value);
  }

  async function fetchJson(path) {
    if (cache.has(path)) return cache.get(path);
    const resp = await fetch(path, { cache: 'no-cache' });
    if (!resp.ok) {
      throw new Error(`데이터 로딩 실패: ${path} (${resp.status})`);
    }
    const json = await resp.json();
    setCapped(cache, path, json, CACHE_MAX);
    return json;
  }

  function getCorpIndex() {
    return fetch('/api/corp-index', { cache: 'no-cache' })
      .then((resp) => {
        if (!resp.ok) throw new Error(`corp-index api failed: ${resp.status}`);
        return resp.json();
      })
      .catch(() => fetchJson('./data/corp-index.json'));
  }

  function getCorpOverview(corpCode) {
    return fetchJson(`./data/corp/${corpCode}/overview.json`);
  }

  function getCorpFinancials(corpCode) {
    return fetchJson(`./data/corp/${corpCode}/financials.json`);
  }

  function getCorpDividends(corpCode) {
    return fetchJson(`./data/corp/${corpCode}/dividends.json`);
  }

  function getCorpGuidance(corpCode) {
    return fetchJson(`./data/corp/${corpCode}/guidance.json`);
  }

  function getCorpTreasury(corpCode) {
    return fetchJson(`./data/corp/${corpCode}/treasury.json`);
  }

  function getCorpConsensus(corpCode) {
    return fetchJson(`./data/corp/${corpCode}/consensus.json`);
  }

  function getMarketDataByStockCode(stockCode) {
    if (!stockCode) {
      return Promise.resolve(null);
    }
    return fetchJson(`./data/market/${stockCode}.json`);
  }

  async function getCorpDetail(corpCode, stockCode) {
    const key = `${corpCode || ''}:${stockCode || ''}`;
    if (detailCache.has(key)) return detailCache.get(key);
    const ticker = encodeURIComponent(stockCode || '');
    const url = `/api/corp/${encodeURIComponent(corpCode)}/detail?ticker=${ticker}`;
    const resp = await fetch(url, { cache: 'no-cache' });
    if (!resp.ok) {
      throw new Error(`상세 데이터 로딩 실패: ${corpCode} (${resp.status})`);
    }
    const json = await resp.json();
    // 수집이 완전히 끝난 응답만 캐시.
    // collecting:true(수집 중), financials/market_data 누락(부분 응답)이면 캐시하지 않고 다음 폴링에서 재요청.
    if (json.market_data != null && json.financials != null && !json.collecting) {
      setCapped(detailCache, key, json, DETAIL_CACHE_MAX);
    }
    return json;
  }

  // 특정 기업의 모든 캐시 항목 제거 (재수집 시 호출)
  function clearCorpCache(corpCode) {
    for (const key of detailCache.keys()) {
      if (key.startsWith(`${corpCode}:`)) detailCache.delete(key);
    }
    for (const key of cache.keys()) {
      if (key.includes(`/corp/${corpCode}/`)) cache.delete(key);
    }
  }

  return {
    getCorpIndex,
    getCorpOverview,
    getCorpFinancials,
    getCorpDividends,
    getCorpGuidance,
    getCorpTreasury,
    getCorpConsensus,
    getMarketDataByStockCode,
    getCorpDetail,
    clearCorpCache,
  };
})();

