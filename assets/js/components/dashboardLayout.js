(() => {
  const { el, clear } = window.DartDOM;
  const State = window.DartState;

  function renderTabs(container, state) {
    clear(container);
    const tabs = el('div', { className: 'dashboard-tabs' });

    const tabDefs = [
      { id: 'overview', label: '개황' },
      { id: 'financials', label: '재무' },
      { id: 'dividends', label: '배당' },
    ];

    tabDefs.forEach((t) => {
      const btn = el('button', {
        className: 'dashboard-tab' + (state.activeTab === t.id ? ' dashboard-tab--active' : ''),
        text: t.label,
      });
      btn.addEventListener('click', () => {
        State.setActiveTab(t.id);
        window.DartRouter.update({ tab: t.id });
      });
      tabs.appendChild(btn);
    });

    container.appendChild(tabs);
  }

  async function renderDashboard(root, state) {
    clear(root);

    const tabsContainer = el('div');
    renderTabs(tabsContainer, state);

    const grid = el('div', { className: 'dashboard-grid' });
    const left = el('div');
    const right = el('div');

    grid.appendChild(left);
    grid.appendChild(right);

    root.appendChild(tabsContainer);
    root.appendChild(grid);

    if (!state.selectedCorp) {
      const empty = el('div', {
        className: 'empty-state card',
        children: [
          el('h2', { text: '기업을 선택해 주세요' }),
          el('p', { text: '상단 검색 바에서 상장사를 검색해 선택하면 요약 대시보드가 표시됩니다.' }),
        ],
      });
      clear(grid);
      grid.appendChild(empty);
      return;
    }

    // 좌측: 항상 기업 개황 카드
    await window.DartCompanyOverview.render(left, state.selectedCorp);

    // 우측: 탭에 따라 재무/배당
    if (state.activeTab === 'financials') {
      await window.DartFinancialCharts.render(right, state.selectedCorp);
    } else if (state.activeTab === 'dividends') {
      await window.DartDividendCharts.render(right, state.selectedCorp);
    } else {
      // overview 탭: 재무/배당 중 요약 하나를 보여도 되지만, 초기에는 재무 요약만
      await window.DartFinancialCharts.render(right, state.selectedCorp);
    }
  }

  window.DartDashboardLayout = {
    render: renderDashboard,
    renderTabs,
  };
})();

