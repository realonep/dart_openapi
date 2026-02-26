window.DartRouter = (function () {
  function parseHash() {
    const hash = window.location.hash.replace(/^#/, '');
    if (!hash) return {};
    return hash.split('&').reduce((acc, pair) => {
      const [k, v] = pair.split('=');
      if (!k) return acc;
      acc[decodeURIComponent(k)] = v ? decodeURIComponent(v) : '';
      return acc;
    }, {});
  }

  function buildHash(params) {
    const parts = Object.entries(params)
      .filter(([_, v]) => v != null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
    return '#' + parts.join('&');
  }

  function update(params) {
    const current = parseHash();
    const next = { ...current, ...params };
    window.location.hash = buildHash(next);
  }

  return {
    parseHash,
    update,
  };
})();

