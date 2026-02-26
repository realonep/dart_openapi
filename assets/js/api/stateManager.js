window.DartState = (function () {
  let selectedCorp = null;
  let activeTab = 'overview'; // overview | financials | dividends
  let lastUpdatedAt = null;

  const listeners = new Set();

  function setSelectedCorp(corp) {
    selectedCorp = corp;
    notify();
  }

  function setActiveTab(tab) {
    activeTab = tab;
    notify();
  }

  function setLastUpdatedAt(value) {
    lastUpdatedAt = value;
    const el = document.getElementById('data-updated-at');
    if (el) {
      el.textContent = `데이터 기준일: ${value || '-'}`;
    }
  }

  function getState() {
    return { selectedCorp, activeTab, lastUpdatedAt };
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function notify() {
    const snapshot = getState();
    listeners.forEach((fn) => fn(snapshot));
  }

  return {
    getState,
    setSelectedCorp,
    setActiveTab,
    setLastUpdatedAt,
    subscribe,
  };
})();

