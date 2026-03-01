window.DartFormatters = (function () {
  function formatNumber(value) {
    if (value == null || isNaN(value)) return '-';
    return Number(value).toLocaleString('ko-KR');
  }

  function formatCurrencyKRW(value) {
    if (value == null || isNaN(value)) return '-';
    return formatNumber(value) + '원';
  }

  // 유효숫자 3자리 + 자동 단위(원/백만원/억원/조원)
  function formatCompactKrw(value) {
    if (value == null || value === '' || isNaN(value)) return '-';
    const n = Number(value);
    const abs = Math.abs(n);

    const units = [
      { v: 1e12, label: '조원' },
      { v: 1e8, label: '억원' },
      { v: 1e6, label: '백만원' },
      { v: 1, label: '원' },
    ];

    const unit = units.find((u) => abs >= u.v) || units[units.length - 1];
    const scaled = n / unit.v;

    let s = Number(scaled).toPrecision(3);
    if (s.includes('e') || s.includes('E')) {
      s = Number(s).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
    } else {
      s = s.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
      const num = Number(s);
      if (Number.isFinite(num)) {
        s = num.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
      }
    }
    return `${s}${unit.label}`;
  }

  function formatPercent(value, digits) {
    if (value == null || isNaN(value)) return '-';
    const d = typeof digits === 'number' ? digits : 1;
    return value.toFixed(d) + '%';
  }

  function formatDate(dateStr) {
    if (!dateStr) return '-';
    // YYYYMMDD or YYYY-MM-DD
    const clean = String(dateStr).replace(/-/g, '');
    if (clean.length !== 8) return dateStr;
    const y = clean.slice(0, 4);
    const m = clean.slice(4, 6);
    const d = clean.slice(6, 8);
    return `${y}.${m}.${d}`;
  }

  return {
    formatNumber,
    formatCurrencyKRW,
    formatCompactKrw,
    formatPercent,
    formatDate,
  };
})();

