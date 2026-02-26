window.DartCard = (function () {
  const { el } = window.DartDOM;

  function cardRoot(className) {
    return el('div', { className: `card ${className || ''}`.trim() });
  }

  function cardHeader(title, subtitle) {
    const root = el('div', { className: 'card__header' });
    const titleEl = el('h2', { className: 'card__title', text: title });
    root.appendChild(titleEl);
    if (subtitle) {
      const subEl = el('p', { className: 'card__subtitle text-muted', text: subtitle });
      root.appendChild(subEl);
    }
    return root;
  }

  function cardBody(children) {
    return el('div', { className: 'card__body', children: Array.isArray(children) ? children : [children] });
  }

  return {
    cardRoot,
    cardHeader,
    cardBody,
  };
})();

