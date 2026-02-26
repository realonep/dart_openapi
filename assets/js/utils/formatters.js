window.DartFormatters = (function () {
  function formatNumber(value) {
    if (value == null || isNaN(value)) return '-';
    return Number(value).toLocaleString('ko-KR');
  }

  function formatCurrencyKRW(value) {
    if (value == null || isNaN(value)) return '-';
    return formatNumber(value) + '원';
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
    formatPercent,
    formatDate,
  };
})();

