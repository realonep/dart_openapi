(() => {
  const State = window.DartState;
  const Router = window.DartRouter;
  const DataLoader = window.DartDataLoader;

  async function syncStateFromHash() {
    const params = Router.parseHash();
    if (params.tab && ['overview', 'financials', 'dividends'].includes(params.tab)) {
      State.setActiveTab(params.tab);
    }
    if (params.corp) {
      // 이미 동일 corp_code + corp_name이 있는 상태면 덮어쓰지 않음
      // (검색바에서 선택 직후 hashchange가 발생해 corp_name이 지워지는 현상 방지)
      const currentCorp = State.getState().selectedCorp;
      const currentCode = currentCorp?.corp_code || currentCorp?.code;
      const currentName = currentCorp?.corp_name || currentCorp?.name;
      if (currentCode === params.corp && currentName) return;

      const stock = params.stock || params.stock_code || '';
      let corpName = '';
      try {
        const index = await DataLoader.getCorpIndex();
        const found = (index || []).find(
          (c) => (c.corp_code || c.code) === params.corp,
        );
        if (found) corpName = found.corp_name || found.name || '';
      } catch (_) {}

      State.setSelectedCorp({
        corp_code: params.corp,
        code: params.corp,
        corp_name: corpName || undefined,
        name: corpName || undefined,
        stock_code: stock || undefined,
      });
    }
  }

  function init() {
    const searchRoot = document.getElementById('search-bar-root');
    const dashboardRoot = document.getElementById('dashboard-root');

    window.DartSearchBar.init(searchRoot);
    window.DartDashboardLayout.render(dashboardRoot, State.getState());

    State.subscribe((state) => {
      window.DartDashboardLayout.render(dashboardRoot, state);
    });

    window.addEventListener('hashchange', syncStateFromHash);
    syncStateFromHash();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

