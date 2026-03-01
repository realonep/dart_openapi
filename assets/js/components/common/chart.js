// 차트 라이브러리 연동을 위한 래퍼. 초기에는 단순한 placeholder만 사용.
window.DartChart = (function () {
  const { el } = window.DartDOM;

  function placeholderChart(message) {
    const root = el('div', { className: 'chart-placeholder' });
    root.appendChild(el('div', { className: 'chart-placeholder__label', text: message || '차트는 추후 구현 예정입니다.' }));
    return root;
  }

  return {
    placeholderChart,
  };
})();

