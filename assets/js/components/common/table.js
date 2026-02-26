window.DartTable = (function () {
  const { el } = window.DartDOM;

  function createTable(headers, rows) {
    const table = el('table', { className: 'dart-table' });
    const thead = el('thead');
    const trHead = el('tr');
    headers.forEach((h) => {
      trHead.appendChild(el('th', { text: h.label || h }));
    });
    thead.appendChild(trHead);
    table.appendChild(thead);

    const tbody = el('tbody');
    rows.forEach((row) => {
      const tr = el('tr');
      headers.forEach((h) => {
        const key = h.key || h;
        tr.appendChild(el('td', { text: row[key] != null ? row[key] : '-' }));
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  }

  return { createTable };
})();

