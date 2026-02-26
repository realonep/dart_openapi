window.DartDataLoader = (function () {
  const cache = new Map();

  async function fetchJson(path) {
    if (cache.has(path)) return cache.get(path);
    const resp = await fetch(path, { cache: 'no-cache' });
    if (!resp.ok) {
      throw new Error(`데이터 로딩 실패: ${path} (${resp.status})`);
    }
    const json = await resp.json();
    cache.set(path, json);
    return json;
  }

  function getCorpIndex() {
    return fetchJson('./data/corp-index.json');
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

  return {
    getCorpIndex,
    getCorpOverview,
    getCorpFinancials,
    getCorpDividends,
  };
})();

