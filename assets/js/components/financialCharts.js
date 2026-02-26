(() => {
  const { el, clear } = window.DartDOM;
  const { cardRoot, cardHeader, cardBody } = window.DartCard;
  const DataLoader = window.DartDataLoader;
  const Table = window.DartTable;
  const Chart = window.DartChart;
  const { formatNumber } = window.DartFormatters;

  async function renderFinancials(root, corp) {
    clear(root);
    if (!corp) {
      root.appendChild(
        el('div', {
          className: 'empty-state card',
          children: [
            el('h2', { text: '기업을 선택해 주세요' }),
            el('p', { text: '선택된 기업의 재무 정보가 이 영역에 나타납니다.' }),
          ],
        }),
      );
      return;
    }

    let financials = null;
    try {
      financials = await DataLoader.getCorpFinancials(corp.corp_code || corp.code);
    } catch (e) {
      financials = null;
    }

    const card = cardRoot('financial-card');
    card.appendChild(cardHeader('주요 재무 지표', '매출 · 영업이익 · 순이익 및 수익성 지표'));

    if (!financials || !Array.isArray(financials.items) || !financials.items.length) {
      card.appendChild(
        cardBody(
          el('div', {
            className: 'empty-state',
            children: [
              el('h2', { text: '재무 데이터가 없습니다' }),
              el('p', { text: 'GitHub Actions가 Open DART에서 데이터를 수집한 후 다시 확인해 주세요.' }),
            ],
          }),
        ),
      );
      root.appendChild(card);
      return;
    }

    const recent = financials.items.slice(-5).reverse();
    const tableRows = recent.map((item) => ({
      period: `${item.year}${item.quarter ? ' Q' + item.quarter : ''}`,
      revenue: formatNumber(item.revenue),
      op_income: formatNumber(item.op_income),
      net_income: formatNumber(item.net_income),
      roe: item.roe != null ? item.roe.toFixed(1) + '%' : '-',
      roa: item.roa != null ? item.roa.toFixed(1) + '%' : '-',
      debt_ratio: item.debt_ratio != null ? item.debt_ratio.toFixed(1) + '%' : '-',
    }));

    const table = Table.createTable(
      [
        { key: 'period', label: '기간' },
        { key: 'revenue', label: '매출액' },
        { key: 'op_income', label: '영업이익' },
        { key: 'net_income', label: '당기순이익' },
        { key: 'roe', label: 'ROE' },
        { key: 'roa', label: 'ROA' },
        { key: 'debt_ratio', label: '부채비율' },
      ],
      tableRows,
    );

    const chartPlaceholder = Chart.placeholderChart('매출/이익 추이는 추후 차트 라이브러리와 연동합니다.');

    card.appendChild(
      cardBody([
        chartPlaceholder,
        el('div', { className: 'financial-table-wrapper', children: [table] }),
      ]),
    );

    root.appendChild(card);
  }

  window.DartFinancialCharts = { render: renderFinancials };
})();

