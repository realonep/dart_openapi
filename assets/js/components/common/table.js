window.DartTable = (function () {
  const { el } = window.DartDOM;

  function createTable(headers, rows, options) {
    const table = el('table', { className: 'dart-table' });
    const thead = el('thead');
    const groupHeaders = options && Array.isArray(options.groupHeaders) ? options.groupHeaders : null;

    if (groupHeaders && groupHeaders.length) {
      const trGroup = el('tr', { className: 'dart-table__group-row' });
      groupHeaders.forEach((g) => {
        trGroup.appendChild(el('th', {
          text: g.label || '',
          attrs: { colspan: String(g.span || 1) },
        }));
      });
      thead.appendChild(trGroup);
    }

    const trHead = el('tr');
    headers.forEach((h) => {
      trHead.appendChild(el('th', { text: h.label || h }));
    });
    thead.appendChild(trHead);
    table.appendChild(thead);

    const tbody = el('tbody');
    rows.forEach((row) => {
      const tr = el('tr');
      if (row && row.__rowClassName) {
        tr.className = row.__rowClassName;
      }
      headers.forEach((h) => {
        const key = h.key || h;
        const raw = row[key];
        let text = raw != null ? raw : '-';
        let html = null;
        let className = '';
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          text = raw.text != null ? raw.text : '-';
          html = raw.html != null ? raw.html : null;
          className = raw.className || '';
        }
        const td = el('td', { text: html != null ? null : text });
        if (html != null) td.innerHTML = String(html);
        if (className) td.className = className;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  }

  return { createTable };
})();

