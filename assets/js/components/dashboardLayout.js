(() => {
  const { el, clear } = window.DartDOM;
  const State = window.DartState;
  const DataLoader = window.DartDataLoader;
  let detailBundle = null;
  let detailBundlePromise = null;
  let renderVersion = 0;
  const fetchTriggeredFor = new Set();

  // ── 자동 폴링 상태 ──────────────────────────────────────────────
  let savedRoot = null;          // 재렌더 시 root 참조 보관
  let pollTimer = null;
  let pollAttempts = 0;
  let pollCorpCode = null;       // 현재 폴링 대상 corp_code
  let wasCollecting = false;     // 수집 대기 → 완료 전환 감지용
  const POLL_MAX = 20;           // 최대 재시도 횟수 (20 × 5 s = 100 s)
  const POLL_INTERVAL_MS = 5000;

  // ── 재수집 세션 추적 ─────────────────────────────────────────────
  // resetAndRefetch 호출마다 resetSessionId++.
  // 폴링 분기에서 수집 중 상태를 확인하면 collectingSessionId = resetSessionId로 동기화.
  // toast는 두 값이 일치할 때만 표시 → reset 직후 즉시 완료됐다고 뜨는 오발 방지.
  let resetSessionId = 0;
  let collectingSessionId = 0;

  function stopPolling() {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  }

  function resetPollState() {
    stopPolling();
    pollAttempts = 0;
    pollCorpCode = null;
    wasCollecting = false;
    resetSessionId = 0;
    collectingSessionId = 0;
  }

  function schedulePoll(corpCode) {
    if (pollTimer !== null) return;           // 이미 예약됨
    if (pollAttempts >= POLL_MAX) return;     // 최대 횟수 초과
    pollTimer = setTimeout(async () => {
      pollTimer = null;
      pollAttempts++;
      // DataLoader 캐시 + 로컬 번들 캐시 모두 무효화 후 재렌더
      // (DataLoader 캐시를 비워야 collecting:true 응답 캐시가 재사용되지 않음)
      if (pollCorpCode) DataLoader.clearCorpCache(pollCorpCode);
      detailBundle = null;
      detailBundlePromise = null;
      if (savedRoot) {
        await renderDashboard(savedRoot, State.getState());
      }
    }, POLL_INTERVAL_MS);
  }

  // ── fetch-one 트리거 (중복 방지: fetchTriggeredFor로 세션 내 1회만 호출) ──
  function triggerFetchOne(corpCode) {
    if (!corpCode || fetchTriggeredFor.has(corpCode)) return;
    fetchTriggeredFor.add(corpCode);
    fetch('/api/fetch-one', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ corp_code: corpCode }),
    }).catch(() => {});
  }

  // ── 재수집 (이미 수집된 잘못된 데이터를 초기화하고 재시작) ──────────
  async function resetAndRefetch(corpCode) {
    if (!corpCode) return;
    try {
      await fetch('/api/reset-corp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ corp_code: corpCode }),
      });
    } catch (_) {}
    // 클라이언트 캐시(detailCache + fetchJson cache) 완전 제거
    DataLoader.clearCorpCache(corpCode);
    fetchTriggeredFor.delete(corpCode);
    detailBundle = null;
    detailBundlePromise = null;
    resetPollState();
    resetSessionId++;         // 이번 재수집 세션 식별자 — collectingSessionId와 일치해야만 toast 허용
    collectingSessionId = 0;  // 아직 "수집 중" 상태 미확인
    wasCollecting = true;
    if (savedRoot) {
      await renderDashboard(savedRoot, State.getState());
    }
  }

  // ── Toast ───────────────────────────────────────────────────────
  function showToast(message) {
    const existing = document.getElementById('dart-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'dart-toast';
    toast.className = 'dart-toast dart-toast--success';
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('dart-toast--visible'));
    setTimeout(() => {
      toast.classList.remove('dart-toast--visible');
      setTimeout(() => toast.remove(), 350);
    }, 3500);
  }

  // ── 메인 렌더 ────────────────────────────────────────────────────
  async function renderDashboard(root, state) {
    savedRoot = root;
    const currentRender = ++renderVersion;
    clear(root);

    if (state.marketSyncing) {
      root.appendChild(
        el('div', {
          className: 'market-sync-status',
          children: [
            el('div', { className: 'market-sync-status__bar' }),
            el('div', { className: 'market-sync-status__text', text: '시장 데이터 동기화 중...' }),
          ],
        }),
      );
    }

    if (!state.selectedCorp) {
      resetPollState();
      root.appendChild(
        el('div', {
          className: 'empty-state card',
          children: [
            el('h2', { text: '기업을 선택해 주세요' }),
            el('p', { text: '상단 검색 바에서 상장사를 검색해 선택하면 요약 대시보드가 표시됩니다.' }),
          ],
        }),
      );
      return;
    }

    const corpCode = state.selectedCorp.corp_code || state.selectedCorp.code;
    const stockCode = state.selectedCorp.stock_code || state.selectedCorp.code;
    const bundleKey = `${corpCode || ''}:${stockCode || ''}`;

    // 종목이 바뀌면 폴링 초기화
    if (pollCorpCode && pollCorpCode !== corpCode) {
      resetPollState();
    }

    if (!detailBundle || detailBundle.key !== bundleKey) {
      if (!detailBundlePromise || detailBundlePromise.key !== bundleKey) {
        // Promise를 먼저 할당한 뒤 setMarketSyncing(true)를 호출해야 한다.
        // setMarketSyncing(true) → main.js subscriber → renderDashboard(Call N+1) 가 동기적으로
        // 발생하는데, 이 시점에 Promise가 이미 할당돼 있어야 중복 생성이 방지된다.
        detailBundlePromise = (async () => {
          try {
            const detail = await DataLoader.getCorpDetail(corpCode, stockCode);
            detailBundle = { key: bundleKey, data: detail };
          } catch (_) {
            detailBundle = { key: bundleKey, data: null };
          } finally {
            State.setMarketSyncing(false);
          }
          return detailBundle;
        })();
        detailBundlePromise.key = bundleKey;
        State.setMarketSyncing(true); // Promise 할당 후 호출 → subscriber 재진입 시 중복 생성 차단
      }
      await detailBundlePromise;
      if (currentRender !== renderVersion) return;
    }

    const stack = el('div', { className: 'dashboard-stack' });
    const hasData = detailBundle?.data != null;

    const backendCollecting = !!detailBundle?.data?.collecting;
    const isPollExhausted = pollAttempts >= POLL_MAX;
    const effectiveCollecting = backendCollecting && !isPollExhausted;

    // financials가 null이거나, 있더라도 items가 빈 배열이면 "아직 미완성"으로 판단
    // items가 [] 인 경우: 수집이 이미 완료됐지만 DART 데이터가 진짜 없는 것 vs 수집 실패·중단 구별 불가
    // → wasCollecting 중이거나 방금 트리거된 경우에 한해서만 폴링 연장
    const financials = detailBundle?.data?.financials;
    const financialsMissing = hasData && financials == null;
    const financialsEmpty = hasData && financials != null &&
      Array.isArray(financials.items) && financials.items.length === 0 && wasCollecting;
    const needsFinancialsPolling = (financialsMissing || financialsEmpty) && !isPollExhausted;

    if (!hasData) {
      triggerFetchOne(corpCode);

      wasCollecting = true;
      collectingSessionId = resetSessionId; // "수집 중" 상태 확인 → toast 허용 조건 충족
      pollCorpCode = corpCode;
      const exhausted = pollAttempts >= POLL_MAX;
      const progressBar = !exhausted
        ? el('div', { className: 'market-sync-status__bar collecting-bar' })
        : null;
      const noticeText = exhausted
        ? '데이터 수집에 시간이 걸리고 있습니다. 잠시 후 직접 새로고침해 주세요.'
        : `데이터를 수집하고 있습니다... (${pollAttempts + 1} / ${POLL_MAX} 자동 확인 중)`;
      const notice = el('div', {
        className: 'card dashboard-notice',
        children: [
          progressBar,
          el('p', { text: noticeText }),
        ].filter(Boolean),
      });
      stack.appendChild(notice);
      schedulePoll(corpCode);
    } else if (needsFinancialsPolling) {
      // overview는 수신됐으나 financials가 null 또는 empty → 수집 진행 중
      wasCollecting = true;
      collectingSessionId = resetSessionId; // "수집 중" 상태 확인 → toast 허용 조건 충족
      pollCorpCode = corpCode;
      triggerFetchOne(corpCode);
      const exhausted = pollAttempts >= POLL_MAX;
      const financialsNotice = el('div', {
        className: 'card dashboard-notice',
        children: [
          !exhausted ? el('div', { className: 'market-sync-status__bar collecting-bar' }) : null,
          el('p', {
            text: exhausted
              ? '재무 데이터 수집에 시간이 걸리고 있습니다. 잠시 후 직접 새로고침해 주세요.'
              : `재무 데이터를 수집하고 있습니다... (${pollAttempts + 1} / ${POLL_MAX} 자동 확인 중)`,
          }),
        ].filter(Boolean),
      });
      stack.appendChild(financialsNotice);
      schedulePoll(corpCode);
    } else {
      if (effectiveCollecting) {
        // 데이터는 있지만 서버가 collecting=true — soft-delete 재수집 진행 중
        // 기존 데이터를 보여주면서 폴링을 계속해 갱신 완료를 감지
        wasCollecting = true;
        collectingSessionId = resetSessionId;
        pollCorpCode = corpCode;
        schedulePoll(corpCode);
      } else if (backendCollecting && isPollExhausted) {
        // collecting=true가 길어지는 경우 무한 갱신 표시를 중단하고 복구 안내 표시
        const delayedNotice = el('div', {
          className: 'card dashboard-notice',
          children: [
            el('p', { text: '데이터 수집이 지연되고 있습니다. 아래 [데이터 재수집] 버튼으로 다시 시도할 수 있습니다.' }),
          ],
        });
        stack.appendChild(delayedNotice);
        stopPolling();
        wasCollecting = false;
      } else {
        // 데이터 정상 수신 완료 → 폴링 중이었으면 Toast
        // collectingSessionId === resetSessionId 조건:
        //   - 일반 최초 수집: 둘 다 0 → 일치 → toast ✓
        //   - 재수집(reset): reset 후 "수집 중" 분기를 최소 1회 통과해야 일치 → 즉시 오발 방지 ✓
        if (wasCollecting && collectingSessionId === resetSessionId) {
          showToast('데이터 수집이 완료되었습니다.');
          fetchTriggeredFor.delete(corpCode);
        }
        stopPolling();
        wasCollecting = false;
        collectingSessionId = 0;
        resetSessionId = 0;
      }
    }

    // ── 재수집 버튼: 이미 수집된 기업 데이터가 잘못됐을 때 강제 초기화 ──
    // 항상 표시하되, 수집 진행 중(폴링 중)일 때는 숨김
    if (hasData && !needsFinancialsPolling && (!wasCollecting || isPollExhausted)) {
      const refetchBtn = el('button', {
        className: 'corp-refetch-btn',
        text: '데이터 재수집',
        attrs: { title: '수집된 재무 데이터를 초기화하고 다시 수집합니다' },
      });
      refetchBtn.addEventListener('click', async () => {
        refetchBtn.disabled = true;
        refetchBtn.textContent = '재수집 중...';
        await resetAndRefetch(corpCode);
      });
      stack.appendChild(refetchBtn);
    }

    const overviewRoot = el('div');
    const priceRoot = el('div');
    const financialRoot = el('div');
    stack.appendChild(overviewRoot);
    stack.appendChild(priceRoot);
    stack.appendChild(financialRoot);
    root.appendChild(stack);
    if (currentRender !== renderVersion) return;

    // 통합 단일 페이지: 개황 → 일봉차트 → 재무 순서 고정
    await window.DartCompanyOverview.render(
      overviewRoot,
      state.selectedCorp,
      detailBundle?.data?.overview || null,
      detailBundle?.data?.shareholders || null,
      detailBundle?.data?.officers || null,
      detailBundle?.data?.market_data || null,
      { collecting: effectiveCollecting },
    );
    if (currentRender !== renderVersion) return;
    await window.DartFinancialCharts.renderPriceOnly(priceRoot, state.selectedCorp, detailBundle?.data || null);
    if (currentRender !== renderVersion) return;
    await window.DartFinancialCharts.render(financialRoot, state.selectedCorp, detailBundle?.data || null, {
      inlineDividends: detailBundle?.data?.dividends || null,
    });
    if (currentRender !== renderVersion) return;
  }

  window.DartDashboardLayout = {
    render: renderDashboard,
  };
})();

