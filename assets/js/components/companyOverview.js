(() => {
  const { el, clear } = window.DartDOM;
  const { cardRoot, cardHeader, cardBody } = window.DartCard;
  const DataLoader = window.DartDataLoader;
  const State = window.DartState;
  const { formatNumber } = window.DartFormatters;

  async function renderOverview(root, corp) {
    clear(root);
    if (!corp) {
      root.appendChild(
        el('div', {
          className: 'empty-state card',
          children: [
            el('h2', { text: '기업을 선택해 주세요' }),
            el('p', { text: '상단 검색 바에서 상장사를 검색해 선택하면, 개황 · 재무 · 배당 정보를 보여드립니다.' }),
          ],
        }),
      );
      return;
    }

    let overview = null;
    try {
      overview = await DataLoader.getCorpOverview(corp.corp_code || corp.code);
      if (overview && overview.last_updated_at) {
        State.setLastUpdatedAt(overview.last_updated_at);
      }
    } catch (e) {
      overview = null;
    }

    const baseCard = cardRoot('overview-card');
    baseCard.appendChild(cardHeader(corp.corp_name || corp.name || '-', '기업 개황'));

    const metaList = el('dl', { className: 'overview-meta-list' });
    function addItem(label, value) {
      const row = el('div', { className: 'overview-meta-row' });
      row.appendChild(el('dt', { text: label }));
      row.appendChild(el('dd', { text: value || '-' }));
      metaList.appendChild(row);
    }

    addItem('종목코드', overview?.stock_code || corp.stock_code || '-');
    addItem('시장', overview?.market || corp.market || '-');
    addItem('업종', overview?.induty || corp.induty || corp.sector || '-');
    addItem('대표자', overview?.ceo_nm || '-');
    addItem('설립일', overview?.est_dt || '-');
    addItem('상장일', overview?.list_dt || '-');
    addItem('홈페이지', overview?.hm_url || '-');

    const summary = el('div', { className: 'overview-summary' });
    if (overview?.summary) {
      summary.textContent = overview.summary;
    } else {
      summary.textContent = '요약 정보는 추후 Open DART 데이터 동기화 후 표시됩니다.';
    }

    baseCard.appendChild(
      cardBody([
        metaList,
        el('hr', { className: 'overview-divider' }),
        summary,
      ]),
    );

    root.appendChild(baseCard);
  }

  window.DartCompanyOverview = { render: renderOverview };
})();

