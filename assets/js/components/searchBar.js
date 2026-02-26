(() => {
  const { el, clear } = window.DartDOM;
  const DataLoader = window.DartDataLoader;
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

    const resultsContainer = el('div', { className: 'search-results', attrs: { 'data-empty': 'true' } });

    wrapper.appendChild(bar);
    wrapper.appendChild(resultsContainer);
    root.appendChild(wrapper);

    let corpIndex = [];
    try {
      corpIndex = await DataLoader.getCorpIndex();
    } catch (e) {
      clear(resultsContainer);
      resultsContainer.appendChild(
        el('div', {
          className: 'search-results__item',
          text: '기업 인덱스 데이터를 불러오지 못했습니다. GitHub Actions 설정을 확인하세요.',
        }),
      );
      return;
    }

    function renderResults(items) {
      clear(resultsContainer);
      if (!items.length) {
        resultsContainer.style.display = 'none';
        return;
      }
      resultsContainer.style.display = 'block';

      items.slice(0, 30).forEach((corp) => {
        const item = el('div', { className: 'search-results__item' });
        const left = el('div', { className: 'search-results__left' });
        const name = el('div', { className: 'search-results__name', text: corp.corp_name || corp.name });
        const meta = el('div', {
          className: 'search-results__meta',
          text: `${corp.stock_code || '-'} · ${corp.sector || corp.induty || ''}`,
        });
        left.appendChild(name);
        left.appendChild(meta);

        const right = el('div', { className: 'pill-group' });
        if (corp.market) {
          right.appendChild(
            el('span', {
              className: 'pill pill-item text-muted',
              text: corp.market,
            }),
          );
        }

        item.appendChild(left);
        item.appendChild(right);

        item.addEventListener('click', () => {
          State.setSelectedCorp(corp);
          window.DartRouter.update({ corp: corp.corp_code || corp.code, tab: State.getState().activeTab });
          resultsContainer.style.display = 'none';
          input.value = corp.corp_name || corp.name || '';
        });

        resultsContainer.appendChild(item);
      });
    }

    input.addEventListener('input', () => {
      const q = input.value.trim();
      if (!q) {
        renderResults([]);
        return;
      }
      const lower = q.toLowerCase();
      const matches = corpIndex.filter((corp) => {
        const name = (corp.corp_name || corp.name || '').toLowerCase();
        const code = (corp.stock_code || corp.code || '').toLowerCase();
        const id = (corp.corp_code || '').toLowerCase();
        return name.includes(lower) || code.includes(lower) || id.includes(lower);
      });
      renderResults(matches);
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

