window.DartDOM = (function () {
  function el(tag, options) {
    const node = document.createElement(tag);
    if (!options) return node;

    const { className, text, attrs, children } = options;

    if (className) node.className = className;
    if (text != null) node.textContent = text;
    if (attrs) {
      Object.entries(attrs).forEach(([k, v]) => {
        if (v != null) node.setAttribute(k, v);
      });
    }
    if (Array.isArray(children)) {
      children.forEach((child) => {
        if (child) node.appendChild(child);
      });
    }
    return node;
  }

  function clear(node) {
    // LightweightCharts ResizeObserver / WebGL 컨텍스트 정리
    node.querySelectorAll('*').forEach((child) => {
      if (typeof child.__lwCleanup === 'function') {
        try { child.__lwCleanup(); } catch (_) {}
      }
    });
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  return { el, clear };
})();

