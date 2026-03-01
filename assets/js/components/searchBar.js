(() => {
  const { el, clear } = window.DartDOM;
  const State = window.DartState;

  async function initSearchBar(root) {
    const wrapper = el('div');
    const bar = el('div', { className: 'search-bar' });
    const input = el('input', {
      className: 'search-bar__input',
      attrs: { type: 'text', placeholder: '회사명, 종목코드 또는 고유번호로 검색' },
    });
    const badge = el('div', { className: 'search-bar__badge text-muted', text: '상장사 검색' });

    bar.appendChild(input);
    bar.appendChild(badge);
    wrapper.appendChild(bar);

    const resultsContainer = el('div', { className: 'search-results', attrs: { 'data-empty': 'true' } });
    wrapper.appendChild(resultsContainer);
    root.appendChild(wrapper);

    function renderResults(items) {
      clear(resultsContainer);
      if (!items.length) {
        resultsContainer.style.display = 'none';
        return;
      }
      resultsContainer.style.display = 'block';

      items.slice(0, 30).forEach((corp) => {
        const displayName = corp.stock_name || corp.corp_name || corp.name || '-';
        const item = el('div', { className: 'search-results__item' });
        const left = el('div', { className: 'search-results__left' });
        const name = el('div', { className: 'search-results__name', text: displayName });
        const meta = el('div', {
          className: 'search-results__meta',
          text: `${corp.stock_code || '-'} · 고유번호 ${corp.corp_code || '-'}`,
        });
        left.appendChild(name);
        left.appendChild(meta);
        item.appendChild(left);

        item.addEventListener('click', () => {
          const corpCode = corp.corp_code || corp.code;
          // fetch-one 트리거는 dashboardLayout.js가 단독으로 담당 (중복 수집 방지)
          State.setSelectedCorp({ ...corp, corp_name: displayName, name: displayName });
          const stockCode = corp.stock_code || corp.code || '';
          window.DartRouter.update({
            corp: corpCode,
            stock: stockCode,
            tab: State.getState().activeTab,
          });
          resultsContainer.style.display = 'none';
          input.value = displayName;
        });

        resultsContainer.appendChild(item);
      });
    }

    let searchDebounce = null;
    input.addEventListener('input', () => {
      const q = input.value.trim();
      if (!q) {
        renderResults([]);
        return;
      }
      if (searchDebounce) clearTimeout(searchDebounce);
      searchDebounce = setTimeout(async () => {
        try {
          const resp = await fetch('/api/search-corps?q=' + encodeURIComponent(q), { cache: 'no-cache' });
          const data = await resp.json();
          const items = data.items || [];
          if (items.length === 0) {
            clear(resultsContainer);
            resultsContainer.style.display = 'block';
            resultsContainer.appendChild(
              el('div', {
                className: 'search-results__item search-results__empty-hint',
                text: '검색 결과가 없습니다. 터미널에서 npm run fetch:corp-code-list 를 실행한 뒤 새로고침하세요.',
              }),
            );
          } else {
            renderResults(items);
          }
        } catch (_) {
          clear(resultsContainer);
          resultsContainer.style.display = 'block';
          resultsContainer.appendChild(
            el('div', {
              className: 'search-results__item search-results__empty-hint',
              text: '검색에 실패했습니다. 서버가 켜져 있는지 확인하세요.',
            }),
          );
        }
      }, 200);
    });

    input.addEventListener('focus', () => {
      if (input.value.trim()) {
        resultsContainer.style.display = 'block';
      }
    });

    document.addEventListener('click', (e) => {
      if (!wrapper.contains(e.target)) {
        resultsContainer.style.display = 'none';
      }
    });
  }

  window.DartSearchBar = { init: initSearchBar };
})();
