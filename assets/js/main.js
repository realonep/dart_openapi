(() => {
  const State = window.DartState;
  const Router = window.DartRouter;

  function syncStateFromHash() {
    const params = Router.parseHash();
    if (params.tab && ['overview', 'financials', 'dividends'].includes(params.tab)) {
      State.setActiveTab(params.tab);
    }
    // corp는 검색 인덱스를 기반으로 찾아야 하는데, 초기 버전에서는 hash만 맞춰두고,
    // 사용자가 검색을 통해 선택하도록 유도
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

