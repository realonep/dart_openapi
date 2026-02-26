(() => {
  const { el, clear } = window.DartDOM;
  const { cardRoot, cardHeader, cardBody } = window.DartCard;
  const DataLoader = window.DartDataLoader;
  const Table = window.DartTable;
  const Chart = window.DartChart;
  const { formatNumber } = window.DartFormatters;

  async function renderDividends(root, corp) {
    clear(root);
    if (!corp) {
      root.appendChild(
        el('div', {
          className: 'empty-state card',
          children: [
            el('h2', { text: '기업을 선택해 주세요' }),
            el('p', { text: '선택된 기업의 배당 이력이 이 영역에 나타납니다.' }),
          ],
        }),
      );
      return;
    }

    let dividends = null;
    try {
      dividends = await DataLoader.getCorpDividends(corp.corp_code || corp.code);
    } catch (e) {
      dividends = null;
    }

    const card = cardRoot('dividend-card');
    card.appendChild(cardHeader('배당 현황', '연도별 배당 이력 및 배당성향'));

    if (!dividends || !Array.isArray(dividends.items) || !dividends.items.length) {
      card.appendChild(
        cardBody(
          el('div', {
            className: 'empty-state',
            children: [
              el('h2', { text: '배당 데이터가 없습니다' }),
              el('p', { text: 'Open DART 데이터 수집 후 배당 내역이 표시됩니다. 무배당 기업일 수도 있습니다.' }),
            ],
          }),
        ),
      );
      root.appendChild(card);
      return;
    }

    const recent = dividends.items.slice(-10).reverse();
    const tableRows = recent.map((d) => ({
      year: d.year,
      type: d.type || d.dividend_type || '-',
      cash: d.cash_dividend_per_share != null ? formatNumber(d.cash_dividend_per_share) : '-',
      stock: d.stock_dividend_rate != null ? d.stock_dividend_rate + '%' : '-',
      payout: d.payout_ratio != null ? d.payout_ratio.toFixed(1) + '%' : '-',
      record_date: d.record_date || '-',
      payment_date: d.payment_date || '-',
    }));

    const table = Table.createTable(
      [
        { key: 'year', label: '연도' },
        { key: 'type', label: '구분' },
        { key: 'cash', label: '현금배당(주당)' },
        { key: 'stock', label: '주식배당율' },
        { key: 'payout', label: '배당성향' },
        { key: 'record_date', label: '기준일' },
        { key: 'payment_date', label: '지급일' },
      ],
      tableRows,
    );

    const chartPlaceholder = Chart.placeholderChart('연도별 배당 추이는 차트로 시각화 예정입니다.');

    card.appendChild(
      cardBody([
        chartPlaceholder,
        el('div', { className: 'dividend-table-wrapper', children: [table] }),
      ]),
    );

    root.appendChild(card);
  }

  window.DartDividendCharts = { render: renderDividends };
})();

