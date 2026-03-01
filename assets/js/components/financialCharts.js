(() => {
  const { el, clear } = window.DartDOM;
  const { cardRoot, cardHeader, cardBody } = window.DartCard;
  const DataLoader = window.DartDataLoader;
  const Table = window.DartTable;
  const { formatCompactKrw, formatNumber } = window.DartFormatters;
  const Metrics = window.DartMetricsEngine;

  function toPercent(current, base) {
    if (current == null || base == null || Number(base) === 0) return null;
    return (Number(current) / Number(base)) * 100;
  }

  function fmtPct(v, digits = 1) {
    return v == null || !Number.isFinite(Number(v)) ? 'N/A' : Number(v).toFixed(digits) + '%';
  }

  function buildMonotoneBarChart(rows, metrics, consensusData, guidanceData) {
    const consensusItems = consensusData && Array.isArray(consensusData.items) ? consensusData.items : [];
    // 연도 정보만 있고 실제 수치가 없는 항목은 컨센서스로 인정하지 않음
    const hasConsensus = consensusItems.some(
      (it) => it && (it.revenue != null || it.op_income != null),
    );
    const defaultData = (rows || []).slice().reverse(); // 오래된 연도 -> 최신 연도
    if (!defaultData.length) return null;

    let chartData = [];
    let title = '최근 5년 매출/FCF 추이';
    let legend = '■ 매출  ■ FCF  (연회색/빗금 = 진행중 누적)';

    if (!hasConsensus) {
      chartData = defaultData.map((r) => {
        return {
          yearLabel: String(r.year),
          revenue: Number(r.revenueRaw || 0),
          thirdRaw: Number(r.fcfRaw || 0),
          inProgress: !!r.isCumulative,
          dataType: r.isCumulative ? 'provisional' : 'actual',
        };
      }).slice(-5);
    } else {
      title = '컨센서스 포함 매출/영업이익 추이';
      legend = '■ 확정(A)  ▨ 잠정·분기(P/Q)  ▧ 컨센서스(E)';
      const guidanceItems = guidanceData && Array.isArray(guidanceData.items) ? guidanceData.items : [];
      const guidanceAnnual = guidanceItems
        .filter((g) => g && g.values && String(g.period_label || '').match(/(20\d{2})\.4Q/i))
        .map((g) => {
          const m = String(g.period_label || '').match(/(20\d{2})\.4Q/i);
          const y = m ? Number(m[1]) : null;
          if (!Number.isFinite(y)) return null;
          return {
            yearNum: y,
            yearLabel: String(y),
            revenue: g.values?.revenue != null ? Number(g.values.revenue) : 0,
            thirdRaw: g.values?.op_income != null ? Number(g.values.op_income) : 0,
            inProgress: true, // 잠정/최신 값은 진행중 스타일 유지
            periodRank: 4.8, // 확정 Annual(5) 다음 우선순위
            dataType: 'provisional',
          };
        })
        .filter(Boolean);
      const quarterRank = (label) => {
        const m = String(label || '').match(/([1-4])Q/i);
        return m ? Number(m[1]) : 0;
      };
      const actualRows = (rows || [])
        .filter((r) => r && r.yearNumeric != null)
        .map((r) => {
          const y = Number(r.yearNumeric);
          const isAnnual = !r.isCumulative;
          const rank = isAnnual ? 5 : quarterRank(r.quarterLabel);
          return {
            yearNum: y,
            yearLabel: String(y),
            revenue: Number(r.revenueRaw || 0),
            thirdRaw: Number(r.opIncomeRaw || 0),
            inProgress: !!r.isCumulative,
            periodRank: rank,
            dataType: r.isCumulative ? 'provisional' : 'actual',
          };
        });
      const consensusProjected = consensusItems.map((it) => {
        const y = Number(String(it?.year_label || '').replace(/[^0-9]/g, '').slice(0, 4));
        return {
          yearNum: y,
          yearLabel: String(it?.year_label || ''),
          revenue: it?.revenue != null ? Number(it.revenue) * 100000000 : 0,
          thirdRaw: it?.op_income != null ? Number(it.op_income) * 100000000 : 0,
          inProgress: false,
          periodRank: 4.5, // 3Q보다는 최신으로, 확정 Annual(5)보다는 낮게 처리
          dataType: 'consensus',
        };
      }).filter((x) => Number.isFinite(x.yearNum));
      const byYear = new Map();
      [...actualRows, ...guidanceAnnual, ...consensusProjected].forEach((row) => {
        const prev = byYear.get(row.yearNum);
        if (!prev || Number(row.periodRank || 0) > Number(prev.periodRank || 0)) {
          byYear.set(row.yearNum, row);
        }
      });
      chartData = Array.from(byYear.values())
        .sort((a, b) => a.yearNum - b.yearNum)
        .slice(-5);
    }

    if (!chartData.length) return null;
    const maxVal = chartData.reduce((m, r) => {
      return Math.max(m, Number(r.revenue || 0), Math.abs(Number(r.thirdRaw || 0)));
    }, 0) || 1;

    const bars = chartData.map((r) => {
      const revenue = Number(r.revenue || 0);
      const thirdRaw = Number(r.thirdRaw || 0);
      const thirdAbs = Math.abs(thirdRaw);
      const revH = Math.max(4, (revenue / maxVal) * 100);
      const thirdH = Math.max(4, (thirdAbs / maxVal) * 100);
      const inProgress = !!r.inProgress;
      const isConsensus = r.dataType === 'consensus';
      const thirdNegative = thirdRaw < 0;
      return el('div', {
        className: `mono-chart__group${isConsensus ? ' mono-chart__group--consensus' : ''}`,
        children: [
          el('div', {
            className: 'mono-chart__bars',
            children: [
              el('div', {
                className: `mono-chart__bar mono-chart__bar--rev${inProgress ? ' mono-chart__bar--progress' : ''}${isConsensus ? ' mono-chart__bar--consensus' : ''}`,
                attrs: { style: `height:${revH}%;` },
              }),
              el('div', {
                className: `mono-chart__bar mono-chart__bar--fcf${inProgress ? ' mono-chart__bar--progress' : ''}${thirdNegative ? ' mono-chart__bar--negative' : ''}${isConsensus ? ' mono-chart__bar--consensus' : ''}`,
                attrs: { style: `height:${thirdH}%;` },
              }),
            ],
          }),
          el('div', {
            className: `mono-chart__year${r.dataType === 'consensus' ? ' mono-chart__year--consensus' : ''}${r.dataType === 'provisional' ? ' mono-chart__year--provisional' : ''}`,
            text: String(r.yearLabel || '-'),
          }),
          el('div', {
            className: 'mono-chart__value',
            children: [
              el('span', {
                className: 'mono-chart__value-fcf',
                text: Number.isFinite(thirdRaw) ? formatCompactKrw(thirdRaw) : '-',
              }),
            ],
          }),
        ],
      });
    });

    return el('div', {
      className: 'mono-chart',
      children: [
        el('div', { className: 'mono-chart__title', text: title }),
        el('div', { className: 'mono-chart__legend', text: legend }),
        el('div', { className: 'mono-chart__canvas', children: bars }),
      ],
    });
  }

  function toSmaData(candleData, period) {
    const out = [];
    let sum = 0;
    for (let i = 0; i < candleData.length; i++) {
      sum += Number(candleData[i].close);
      if (i >= period) {
        sum -= Number(candleData[i - period].close);
      }
      if (i >= period - 1) {
        out.push({
          time: candleData[i].time,
          value: sum / period,
        });
      }
    }
    return out;
  }

  function mountLightweightCandleChart(container, series) {
    if (!container || !window.LightweightCharts || !series.length) return;
    const lw = window.LightweightCharts;
    const sorted = series.slice().sort((a, b) => String(a.time).localeCompare(String(b.time)));
    const candleData = sorted.map((item) => ({
      time: item.date,
      open: Number(item.open),
      high: Number(item.high),
      low: Number(item.low),
      close: Number(item.close),
    }));
    const volumeData = sorted.map((item) => ({
      time: item.date,
      value: Number(item.volume || 0),
      color: 'rgba(209, 209, 209, 0.6)',
    }));

    const chart = lw.createChart(container, {
      width: Math.max(300, container.clientWidth || 300),
      height: 320,
      layout: {
        background: { color: '#FFFFFF' },
        textColor: '#000000',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      },
      rightPriceScale: {
        borderVisible: false,
      },
      timeScale: {
        borderVisible: false,
      },
      grid: {
        vertLines: { color: 'rgba(238, 238, 238, 0.35)', style: 4 },
        horzLines: { color: 'rgba(238, 238, 238, 0.35)', style: 4 },
      },
      crosshair: {
        mode: lw.CrosshairMode.Normal,
        vertLine: {
          color: '#000000',
          width: 1,
          labelBackgroundColor: '#000000',
        },
        horzLine: {
          color: '#000000',
          width: 1,
          labelBackgroundColor: '#000000',
        },
      },
      localization: {
        priceFormatter: (p) => Number(p).toLocaleString('ko-KR'),
      },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#FF0000',
      downColor: '#0000FF',
      borderUpColor: '#FF0000',
      borderDownColor: '#0000FF',
      wickUpColor: '#FF0000',
      wickDownColor: '#0000FF',
      priceLineVisible: false,
    });
    candleSeries.setData(candleData);

    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'left',
      base: 0,
      lastValueVisible: false,
      priceLineVisible: false,
      scaleMargins: { top: 0.82, bottom: 0.0 },
    });
    volumeSeries.setData(volumeData);

    const ma5 = chart.addLineSeries({ color: '#FF66CC', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    const ma20 = chart.addLineSeries({ color: '#FFD400', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    const ma60 = chart.addLineSeries({ color: '#00AA55', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    ma5.setData(toSmaData(candleData, 5));
    ma20.setData(toSmaData(candleData, 20));
    ma60.setData(toSmaData(candleData, 60));

    chart.timeScale().fitContent();

    const resize = () => chart.applyOptions({ width: Math.max(300, container.clientWidth || 300), height: 320 });
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    container.__lwCleanup = () => {
      try { ro.disconnect(); } catch (_) {}
      try { chart.remove(); } catch (_) {}
    };
  }

  function buildPriceLineChart(marketData, stockCode) {
    // 상세 API의 market_data는 해당 기업용이므로, daily_chart만 있으면 그림(URL 해시만으로 진입 시 stockCode가 8자리로 넘어와 불일치하는 경우 보정)
    if (!marketData || !Array.isArray(marketData.daily_chart) || !marketData.daily_chart.length) return null;
    const series = marketData.daily_chart
      .filter((d) => d && d.open != null && d.high != null && d.low != null && d.close != null)
      .slice(-250);
    if (!series.length) return null;

    const first = series[0];
    const last = series[series.length - 1];
    const chartHost = el('div', { className: 'price-line__host' });
    setTimeout(() => mountLightweightCandleChart(chartHost, series), 0);

    return el('div', {
      className: 'price-line',
      children: [
        el('div', { className: 'price-line__title', text: `일봉 차트 (최근 ${series.length}거래일)` }),
        chartHost,
        el('div', {
          className: 'price-line__meta',
          children: [
            el('span', { text: `${first.date} · O ${formatNumber(first.open)} H ${formatNumber(first.high)} L ${formatNumber(first.low)} C ${formatNumber(first.close)}` }),
            el('span', { text: `${last.date} · O ${formatNumber(last.open)} H ${formatNumber(last.high)} L ${formatNumber(last.low)} C ${formatNumber(last.close)}` }),
          ],
        }),
      ],
    });
  }

  function buildInlineDividendPanel(dividends, marketData, treasuryData, financialsData) {
    const dividendItems = dividends && Array.isArray(dividends.items) ? dividends.items : [];
    const treasuryYears = ((treasuryData && Array.isArray(treasuryData.yearly_summary)) ? treasuryData.yearly_summary : [])
      .map((x) => Number(x?.year))
      .filter((y) => Number.isFinite(y));
    const dividendYears = dividendItems
      .map((d) => Number(d?.year))
      .filter((y) => Number.isFinite(y));
    const yearSet = new Set([...dividendYears, ...treasuryYears]);
    const years = Array.from(yearSet).sort((a, b) => b - a).slice(0, 10);
    if (!years.length) {
      return el('div', { className: 'inline-dividend-panel inline-dividend-panel--empty', text: '배당 데이터가 없습니다.' });
    }
    const dividendByYear = new Map(dividendItems.map((d) => [String(d.year || ''), d]));
    const treasuryByYear = new Map(
      ((treasuryData && Array.isArray(treasuryData.yearly_summary)) ? treasuryData.yearly_summary : [])
        .map((x) => [String(x.year || ''), x]),
    );
    const closeByYear = marketData && marketData.year_end_close_prices ? marketData.year_end_close_prices : {};
    const capByYear = marketData && marketData.year_end_market_caps ? marketData.year_end_market_caps : {};
    const sharesByYear = marketData && marketData.year_end_estimated_shares ? marketData.year_end_estimated_shares : {};
    const estShares = marketData && marketData.estimated_shares_outstanding != null
      ? Number(marketData.estimated_shares_outstanding)
      : null;

    // 연도별 당기순이익 (배당성향 기반 역산에 사용)
    const netIncomeByYear = new Map(
      ((financialsData && Array.isArray(financialsData.items)) ? financialsData.items : [])
        .filter((item) => item && item.annual && item.annual.net_income != null)
        .map((item) => [String(item.year || ''), Number(item.annual.net_income)]),
    );

    // 연도별 발행주식수 조회: year_end_estimated_shares → 없으면 시총÷종가로 역산
    function resolveShares(y) {
      const yStr = String(y || '');
      if (sharesByYear[yStr] != null) return Number(sharesByYear[yStr]);
      const cap = capByYear[yStr] != null ? Number(capByYear[yStr]) : null;
      const close = closeByYear[yStr] != null ? Number(closeByYear[yStr]) : null;
      if (cap && close && close > 0) return Math.round(cap / close);
      return estShares;
    }

    const rows = years.map((year) => {
      const d = dividendByYear.get(String(year)) || null;
      const yStr = String(year || '');

      // 주당배당금: 직접값 우선, 없으면 배당성향×순이익÷주식수로 역산
      const dpsDirectly = d && d.total_cash_dividend_per_share != null
        ? Number(d.total_cash_dividend_per_share) : null;
      const payoutRatio = d && d.payout_ratio != null ? Number(d.payout_ratio) : null;
      const netIncome = netIncomeByYear.get(yStr) ?? null;
      const shares = resolveShares(year);

      // 배당총액: 주당배당금×주식수 우선, 없으면 순이익×배당성향
      let cashTotalVal = null;
      let cashTotalEstimated = false;
      if (dpsDirectly != null && shares && shares > 0) {
        cashTotalVal = dpsDirectly * shares;
      } else if (payoutRatio != null && netIncome != null && netIncome > 0) {
        cashTotalVal = netIncome * (payoutRatio / 100);
        cashTotalEstimated = true;
      }

      // 주당배당금 표시: 직접값 우선, 없으면 배당총액÷주식수
      let cashPerShareDisplay = '-';
      if (dpsDirectly != null) {
        cashPerShareDisplay = formatNumber(dpsDirectly) + '원';
      } else if (cashTotalVal != null && shares && shares > 0) {
        cashPerShareDisplay = formatNumber(Math.round(cashTotalVal / shares)) + '원*';
      }

      return {
        year,
        cash_total: cashTotalVal != null
          ? formatCompactKrw(cashTotalVal) + (cashTotalEstimated ? '*' : '')
          : '-',
        cash_per_share: cashPerShareDisplay,
        yield: (() => {
          const close = closeByYear[yStr] != null ? Number(closeByYear[yStr]) : null;
          const dps = dpsDirectly ?? (cashTotalVal != null && shares && shares > 0 ? cashTotalVal / shares : null);
          if (!close || !dps || close <= 0) return '-';
          return ((dps / close) * 100).toFixed(2) + '%';
        })(),
        payout: payoutRatio != null ? payoutRatio.toFixed(1) + '%' : '-',
        treasury_retired: (() => {
          const t = treasuryByYear.get(yStr);
          if (!t || t.retired_amount_total == null) return '-';
          return formatCompactKrw(t.retired_amount_total);
        })(),
      };
    });
    const table = Table.createTable(
      [
        { key: 'year', label: '연도' },
        { key: 'cash_total', label: '배당총액(추정)' },
        { key: 'cash_per_share', label: '주당배당' },
        { key: 'yield', label: '시가배당률' },
        { key: 'payout', label: '배당성향' },
        { key: 'treasury_retired', label: '자사주 소각' },
      ],
      rows,
    );
    const lookbackMonths = Number(treasuryData?.fetch_policy?.lookback_months);
    const cutoff = String(treasuryData?.fetch_policy?.cutoff_rcept_dt || '');
    const cutoffText = cutoff && cutoff.length === 8
      ? `${cutoff.slice(0, 4)}-${cutoff.slice(4, 6)}-${cutoff.slice(6, 8)}`
      : null;
    const fetchNotice = Number.isFinite(lookbackMonths)
      ? `자사주 소각 공시는 최근 ${lookbackMonths}개월 범위만 조회합니다${cutoffText ? ` (기준일: ${cutoffText})` : ''}.`
      : null;
    return el('div', {
      className: 'inline-dividend-panel',
      children: [
        el('div', { className: 'inline-dividend-panel__title', text: '배당 현황 (상세)' }),
        fetchNotice ? el('div', { className: 'inline-dividend-panel__note', text: fetchNotice }) : null,
          el('div', { className: 'inline-dividend-panel__table', children: [table] }),
      ],
    });
  }

  function buildFinancialRows(financials) {
    const rows = (financials.items || []).map((item) => {
      const qs = item.quarters || {};
      const latestQuarter = qs['4Q'] || qs['3Q'] || qs['2Q'] || qs['1Q'] || null;
      const basis = latestQuarter || item.annual || null;
      if (!basis) return null;
      const isAnnualBackedQ4 = !!(latestQuarter && latestQuarter.quarter === '4Q' && item.annual);
      return {
        year: item.year,
        yearNumeric: item.year,
        period: latestQuarter
          ? (isAnnualBackedQ4 ? `${item.year}(A)` : `${item.year} ${latestQuarter.quarter}`)
          : `${item.year}(A)`,
        quarterLabel: latestQuarter ? latestQuarter.quarter : null,
        revenue: formatCompactKrw(basis.revenue),
        revenueRaw: basis.revenue,
        op_income: formatCompactKrw(basis.op_income),
        opIncomeRaw: basis.op_income,
        net_income: formatCompactKrw(basis.net_income),
        netIncomeRaw: basis.net_income,
        roe: basis.roe != null ? basis.roe.toFixed(1) + '%' : '-',
        roeRaw: basis.roe,
        roa: basis.roa != null ? basis.roa.toFixed(1) + '%' : '-',
        roaRaw: basis.roa,
        debt_ratio: basis.debt_ratio != null ? basis.debt_ratio.toFixed(1) + '%' : '-',
        debtRatioRaw: basis.debt_ratio,
        equityRaw: basis.equity,
        operatingCfRaw: basis.operating_cf,
        nonCashAdjRaw: basis.non_cash_adjustments,
        wcChangeRaw: basis.working_capital_change,
        capexPpeRaw: basis.capex_ppe,
        capexIntangibleRaw: basis.capex_intangible,
        capexTotalRaw: basis.capex_total,
        fcfRaw: basis.fcf,
        fsDiv: basis.fs_div || null,
        isCumulative: !!(latestQuarter && latestQuarter.report_type === 'cumulative'),
      };
    }).filter(Boolean);

    function quarterRank(row) {
      if (!row || !row.quarterLabel) return 5; // annual
      const m = String(row.quarterLabel).match(/([1-4])Q/i);
      return m ? Number(m[1]) : 0;
    }

    return rows
      .sort((a, b) => {
        if (a.yearNumeric !== b.yearNumeric) return b.yearNumeric - a.yearNumeric;
        return quarterRank(b) - quarterRank(a);
      })
      .slice(0, 12);
  }

  function buildGuidanceTopRow(guidance, metrics) {
    const items = guidance && Array.isArray(guidance.items) ? guidance.items : [];
    const candidate = items.find((g) => g && g.values && (
      g.values.revenue != null || g.values.op_income != null || g.values.net_income != null
    ));
    if (!candidate || !candidate.values) return null;
    const revenueRaw = candidate.values.revenue != null ? Number(candidate.values.revenue) : null;
    const opIncomeRaw = candidate.values.op_income != null ? Number(candidate.values.op_income) : null;
    const netIncomeRaw = candidate.values.net_income != null ? Number(candidate.values.net_income) : null;
    const currentMarketCap = metrics && metrics.marketCap != null ? Number(metrics.marketCap) : null;
    const opMargin = toPercent(opIncomeRaw, revenueRaw);
    const periodLabelRaw = String(candidate.period_label || 'Guidance').trim();
    const periodLabelDisplay = (() => {
      const m = periodLabelRaw.match(/^(20\d{2})\.4Q$/i);
      if (m) return `${m[1]}(A)`;
      return periodLabelRaw;
    })();
    return {
      __rowClassName: 'dart-table__row--latest',
      period_display: `${periodLabelDisplay.replace(/\s+/g, '')}[잠정]`,
      revenue: revenueRaw != null ? formatCompactKrw(revenueRaw) : '',
      op_bundle: opIncomeRaw != null
        ? `${formatCompactKrw(opIncomeRaw)}(${opMargin == null || !Number.isFinite(opMargin) ? '' : Number(opMargin).toFixed(1) + '%'})`
        : '',
      net_income: netIncomeRaw != null ? formatCompactKrw(netIncomeRaw) : '',
      non_cash_adj: '',
      wc_change: '',
      cfo_bundle: '',
      capex: '',
      investment_intensity: '',
      self_funding_ratio: '',
      fcf: '',
      roe: '',
      market_cap: currentMarketCap != null ? formatCompactKrw(currentMarketCap) : '',
      per: '',
      pbr: '',
      debt_ratio: '',
      roa: '',
      cagr: '',
    };
  }

  function buildAnnualRevenueCagrByYear(rows) {
    const annualRows = (rows || [])
      .filter((r) => r && !r.isCumulative && r.revenueRaw != null && r.yearNumeric != null)
      .slice()
      .sort((a, b) => Number(a.yearNumeric) - Number(b.yearNumeric));
    if (annualRows.length < 2) return {};

    const base = annualRows[0];
    const baseYear = Number(base.yearNumeric);
    const baseRevenue = Number(base.revenueRaw);
    if (!Number.isFinite(baseRevenue) || baseRevenue <= 0) return {};

    const out = {};
    annualRows.forEach((row) => {
      const y = Number(row.yearNumeric);
      const years = y - baseYear;
      const revenue = Number(row.revenueRaw);
      if (!Number.isFinite(revenue) || revenue <= 0 || years <= 0) {
        out[String(y)] = null;
        return;
      }
      out[String(y)] = (Math.pow(revenue / baseRevenue, 1 / years) - 1) * 100;
    });
    return out;
  }

  function guideItem(title, lines) {
    return el('div', {
      className: 'invest-guide__item',
      children: [
        el('div', { className: 'invest-guide__item-title', text: title }),
        el('div', {
          className: 'invest-guide__item-body',
          children: lines.map((t) => el('p', { text: t })),
        }),
      ],
    });
  }

  function buildInvestmentGuideSection() {
    return el('details', {
      className: 'invest-guide',
      children: [
        el('summary', {
          className: 'invest-guide__title',
          text: '기업 생존 의지 검증 (The Survival Will)',
        }),
        el('div', {
          className: 'invest-guide__content',
          children: [
            el('div', {
              className: 'invest-guide__grid',
              children: [
                guideItem('[Step 1] 이익의 탄생: 장부상 이익(NI)의 발생', [
                  '핵심 지표: 당기순이익(NI), 영업이익.',
                  '해석: 기업이 한 해 동안 거둔 최종 성적표입니다. 다만 이는 회계적 의견일 수 있으므로 다음 단계의 현금 검증이 필요합니다.',
                ]),
                guideItem('[Step 2] 현금의 검증: 이익의 질(Quality of Profit) 평가', [
                  '핵심 지표: CFO (Ratio), 비현금 조정(감가상각비 등).',
                  '메커니즘: 실제 돈이 나가지 않은 감가상각비 등 비현금 조정이 이익을 방어해 실제 현금(CFO)이 순이익보다 많이 들어오는지 확인합니다.',
                  '판단: CFO/NI 배수가 1.0 이상일 때 비로소 그 이익은 정직한 현금으로 인정됩니다.',
                ]),
                guideItem('[Step 3] 성장의 베팅: 미래를 위한 투자 강도', [
                  '핵심 지표: CapEx, R&D 비용, 투자 강도(Intensity).',
                  '산업별 차이: 제조업은 유형 CapEx, 소프트웨어/서비스는 R&D 및 무형자산 투자가 핵심 성장 동력입니다.',
                  '판단: 투자 강도가 1.0을 넘어야 감가상각을 상회하는 진짜 베팅으로 해석할 수 있습니다.',
                ]),
                guideItem('[Step 4] 결과적 잉여: 주주 환원으로의 연결', [
                  '핵심 지표: FCF, 자사주 소각, 배당.',
                  '메커니즘: 모든 투자를 마친 뒤에도 남는 잉여현금(FCF)이 실제 주주환원 정책으로 이어지는지 확인합니다.',
                  '판단: 잉여가 자사주 소각/배당으로 연결될 때 기업의 생존 서사가 완성됩니다.',
                ]),
              ],
            }),
            el('div', {
              className: 'invest-guide__takeaway',
              children: [
                el('div', {
                  className: 'invest-guide__takeaway-title',
                  text: 'Insight Highlight',
                }),
                el('p', {
                  className: 'invest-guide__takeaway-body',
                  text: '이익(NI)은 의견일 뿐이지만, 현금(CFO)은 사실입니다. 투자 강도가 낮은 상태에서 발생하는 높은 FCF는 성장을 포기한 청산형 현금일 수 있습니다. 진짜 우량주는 투자를 퍼부으면서도 FCF가 남는 기업입니다.',
                }),
              ],
            }),
          ],
        }),
      ],
    });
  }

  function computeAnnualAverages(financials) {
    const items = financials && Array.isArray(financials.items) ? financials.items : [];
    const annualRows = items
      .filter((item) => item && item.annual)
      .slice()
      .sort((a, b) => Number(b?.year || 0) - Number(a?.year || 0))
      .slice(0, 5);
    const weightedRows = annualRows.map((item, idx) => ({
      annual: item.annual,
      weight: annualRows.length - idx, // 최근 연도 가중치가 가장 큼
    }));
    const acc = {
      revenue: { weightedSum: 0, weightSum: 0, count: 0 },
      op_income: { weightedSum: 0, weightSum: 0, count: 0 },
      net_income: { weightedSum: 0, weightSum: 0, count: 0 },
    };
    weightedRows.forEach((row) => {
      const a = row && row.annual ? row.annual : null;
      const w = Number(row?.weight || 0);
      if (!a) return;
      if (a.revenue != null && Number.isFinite(Number(a.revenue))) {
        acc.revenue.weightedSum += Number(a.revenue) * w;
        acc.revenue.weightSum += w;
        acc.revenue.count += 1;
      }
      if (a.op_income != null && Number.isFinite(Number(a.op_income))) {
        acc.op_income.weightedSum += Number(a.op_income) * w;
        acc.op_income.weightSum += w;
        acc.op_income.count += 1;
      }
      if (a.net_income != null && Number.isFinite(Number(a.net_income))) {
        acc.net_income.weightedSum += Number(a.net_income) * w;
        acc.net_income.weightSum += w;
        acc.net_income.count += 1;
      }
    });
    return {
      revenue: acc.revenue.weightSum ? (acc.revenue.weightedSum / acc.revenue.weightSum) : null,
      op_income: acc.op_income.weightSum ? (acc.op_income.weightedSum / acc.op_income.weightSum) : null,
      net_income: acc.net_income.weightSum ? (acc.net_income.weightedSum / acc.net_income.weightSum) : null,
      counts: {
        revenue: acc.revenue.count,
        op_income: acc.op_income.count,
        net_income: acc.net_income.count,
      },
    };
  }

  function buildValueWithDeltaCell(consensusEok, baselineKrw) {
    const c = consensusEok != null && Number.isFinite(Number(consensusEok)) ? Number(consensusEok) * 100000000 : null;
    const b = baselineKrw != null && Number.isFinite(Number(baselineKrw)) ? Number(baselineKrw) : null;
    const valueText = c == null ? '' : formatCompactKrw(c);
    if (c == null || b == null || b === 0) return valueText;
    const pct = ((c - b) / Math.abs(b)) * 100;
    const signed = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
    if (pct > 0) {
      return {
        html: `${valueText}<span class="consensus-delta-up">(${signed})</span>`,
      };
    }
    if (pct < 0) {
      return {
        html: `${valueText}<span class="consensus-delta-down">(${signed})</span>`,
      };
    }
    return `${valueText}(${signed})`;
  }

  function buildConsensusPanel(consensusData, consensusCache, consensusAlert, financials) {
    const items = consensusData && Array.isArray(consensusData.items) ? consensusData.items : [];
    const annualAvg = computeAnnualAverages(financials);
    const alertMessage = consensusAlert && consensusAlert.message ? String(consensusAlert.message) : '';
    const alertLevel = consensusAlert && consensusAlert.level ? String(consensusAlert.level) : '';
    if (!items.length) {
      return el('div', {
        className: 'consensus-panel consensus-panel--empty',
        children: [
          el('div', { text: '컨센서스 데이터가 없습니다.' }),
          alertMessage ? el('div', {
            className: `consensus-panel__alert consensus-panel__alert--${alertLevel || 'warn'}`,
            text: alertMessage,
          }) : null,
        ],
      });
    }

    const rows = items
      .slice()
      .sort((a, b) => {
        const ay = Number(String(a?.year_label || '').replace(/[^0-9]/g, '').slice(0, 4));
        const by = Number(String(b?.year_label || '').replace(/[^0-9]/g, '').slice(0, 4));
        if (Number.isFinite(ay) && Number.isFinite(by)) return by - ay;
        return String(b?.year_label || '').localeCompare(String(a?.year_label || ''));
      })
      .slice(0, 4)
      .map((it) => ({
      year: String(it.year_label || '-'),
      revenue: buildValueWithDeltaCell(it.revenue, annualAvg.revenue),
      op_income: buildValueWithDeltaCell(it.op_income, annualAvg.op_income),
      net_income: buildValueWithDeltaCell(it.net_income, annualAvg.net_income),
      roe: it.roe != null ? `${Number(it.roe).toFixed(2)}%` : '',
    }));

    const table = Table.createTable(
      [
        { key: 'year', label: '연도(컨센서스)' },
        { key: 'revenue', label: '매출액' },
        { key: 'op_income', label: '영업이익' },
        { key: 'net_income', label: '당기순이익' },
        { key: 'roe', label: 'ROE' },
      ],
      rows,
    );

    const updatedAt = consensusData?.last_updated_at ? `업데이트: ${consensusData.last_updated_at}` : '';
    const source = consensusData?.source ? `출처: ${String(consensusData.source).toUpperCase()}` : '출처: NAVER';
    const avgMeta = `Annual 가중평균 기준(매출 n=${annualAvg.counts.revenue}, 영업 n=${annualAvg.counts.op_income}, 순익 n=${annualAvg.counts.net_income})`;

    return el('div', {
      className: 'consensus-panel',
      children: [
        el('div', { className: 'consensus-panel__title', text: '애널리스트 컨센서스' }),
        el('div', { className: 'consensus-panel__meta', text: `${source}${updatedAt ? ` · ${updatedAt}` : ''}${consensusCache ? ` · cache: ${consensusCache}` : ''}` }),
        el('div', { className: 'consensus-panel__meta', text: avgMeta }),
        alertMessage ? el('div', {
          className: `consensus-panel__alert consensus-panel__alert--${alertLevel || 'warn'}`,
          text: alertMessage,
        }) : null,
        el('div', { className: 'consensus-panel__table', children: [table] }),
      ],
    });
  }

  function buildIntegratedTableRows(rows, metrics, guidance) {
    const latestPeriod = rows.length ? rows[0].period : null;
    const cagrByYear = buildAnnualRevenueCagrByYear(rows);
    const tableRows = rows.map((r) => {
      const opMargin = toPercent(r.opIncomeRaw, r.revenueRaw);
      const rowMetrics = metrics?.byPeriod?.[r.period] || {};
      const rowCagr = !r.isCumulative ? cagrByYear[String(r.yearNumeric)] : null;
      const isLatest = r.period === latestPeriod;
      const cfoRatio = r.operatingCfRaw != null && r.netIncomeRaw != null && Number(r.netIncomeRaw) !== 0
        ? Number(r.operatingCfRaw) / Number(r.netIncomeRaw)
        : null;
      const selfFundingRatio = r.operatingCfRaw != null && r.capexTotalRaw != null && Number(r.capexTotalRaw) !== 0
        ? Number(r.operatingCfRaw) / Number(r.capexTotalRaw)
        : null;
      const investmentIntensity = r.capexTotalRaw != null && r.nonCashAdjRaw != null && Number(r.nonCashAdjRaw) !== 0
        ? Number(r.capexTotalRaw) / Number(r.nonCashAdjRaw)
        : null;
      let investmentIntensityCell = '-';
      if (investmentIntensity != null && Number.isFinite(investmentIntensity)) {
        const text = `${Number(investmentIntensity).toFixed(2)}x`;
        if (investmentIntensity > 1.5) {
          investmentIntensityCell = { text, className: 'td-intensity-high' };
        } else if (investmentIntensity < 0.5) {
          investmentIntensityCell = { text: `${text}•`, className: 'td-intensity-low' };
        } else {
          investmentIntensityCell = text;
        }
      }
      return {
        __rowClassName: isLatest ? 'dart-table__row--latest' : '',
        period_display: isLatest ? `${String(r.period).replace(/\s+/g, '')}[최신]` : String(r.period).replace(/\s+/g, ''),
        revenue: r.revenue,
        op_bundle: `${r.op_income}(${fmtPct(opMargin, 1)})`,
        net_income: r.net_income,
        non_cash_adj: r.nonCashAdjRaw == null ? '-' : formatCompactKrw(r.nonCashAdjRaw),
        wc_change: r.wcChangeRaw == null ? '-' : formatCompactKrw(r.wcChangeRaw),
        cfo_bundle: r.operatingCfRaw == null
          ? '-'
          : `${formatCompactKrw(r.operatingCfRaw)}(${cfoRatio == null || !Number.isFinite(cfoRatio) ? '-' : Number(cfoRatio).toFixed(2) + 'x'})`,
        capex: r.capexTotalRaw == null ? 'N/A' : formatCompactKrw(r.capexTotalRaw),
        investment_intensity: investmentIntensityCell,
        self_funding_ratio: selfFundingRatio == null || !Number.isFinite(selfFundingRatio) ? '-' : Number(selfFundingRatio).toFixed(2) + 'x',
        fcf: r.fcfRaw == null ? 'N/A' : formatCompactKrw(r.fcfRaw),
        roe: r.roe,
        market_cap: rowMetrics.marketCap != null ? formatCompactKrw(rowMetrics.marketCap) : '-',
        per: rowMetrics.per != null ? Number(rowMetrics.per).toFixed(2) + 'x' : '-',
        pbr: rowMetrics.pbr != null ? Number(rowMetrics.pbr).toFixed(2) + 'x' : '-',
        debt_ratio: r.debt_ratio,
        roa: r.roa,
        cagr: rowCagr == null ? '-' : Number(rowCagr).toFixed(1) + '%',
      };
    });
    const guidanceRow = buildGuidanceTopRow(guidance, metrics);
    return guidanceRow ? [guidanceRow, ...tableRows] : tableRows;
  }

  function buildResponsiveFinancialTables(tableRows) {
    const periodKey = (label) => {
      const s = String(label || '');
      const mAnnual = s.match(/(20\d{2})\(?A\)?/i);
      if (mAnnual) return Number(mAnnual[1]) * 10 + 4;
      const mQ = s.match(/(20\d{2})\.?([1-4])Q/i);
      if (mQ) return Number(mQ[1]) * 10 + Number(mQ[2]);
      return 0;
    };
    const periodCols = (tableRows || [])
      .map((r) => ({
        key: String(r?.period_display || ''),
        row: r || {},
      }))
      .filter((x) => x.key)
      .sort((a, b) => periodKey(a.key) - periodKey(b.key));

    const headers = [{ key: 'metric', label: '지표' }]
      .concat(periodCols.map((c, idx) => ({ key: `p${idx}`, label: c.key })));

    const metricDefs = [
      ['market_cap', '시총'],
      ['revenue', '매출액'],
      ['op_bundle', '영업이익(률)'],
      ['net_income', '당기순이익(NI)'],
      ['non_cash_adj', '비현금조정(+)'],
      ['wc_change', '운전자본변동(±)'],
      ['cfo_bundle', 'CFO(Ratio)'],
      ['capex', 'CapEx'],
      ['fcf', 'FCF'],
      ['investment_intensity', '투자강도(Proxy)'],
      ['self_funding_ratio', '자금자족률'],
      ['roe', 'ROE'],
      ['per', 'PER'],
      ['pbr', 'PBR'],
      ['debt_ratio', '부채비율'],
      ['roa', 'ROA'],
      ['cagr', 'CAGR'],
    ];

    const highlightKeys = new Set(['market_cap', 'cfo_bundle', 'fcf', 'roe']);
    const rows = metricDefs.map(([metricKey, label]) => {
      const row = {
        metric: label,
        __rowClassName: highlightKeys.has(metricKey) ? 'financial-metric-highlight' : '',
      };
      periodCols.forEach((c, idx) => {
        const v = c.row[metricKey];
        row[`p${idx}`] = v == null ? '-' : v;
      });
      return row;
    });

    const table = Table.createTable(headers, rows);
    return el('div', {
      className: 'financial-table-pivot',
      children: [table],
    });
  }

  async function renderFinancials(root, corp, detailBundle, options = {}) {
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

    // 상세 응답: detailBundle이 { data: response } 형태로 넘어올 수 있음(dashboardLayout에서 detailBundle.data 전달)
    const response = detailBundle && typeof detailBundle.data !== 'undefined' ? detailBundle.data : detailBundle;
    let financials = response?.financials || null;
    if (!financials) {
      try {
        financials = await DataLoader.getCorpFinancials(corp.corp_code || corp.code);
      } catch (e) {
        financials = null;
      }
    }

    let marketData = response?.market_data || null;
    let marketAlert = response?.market_alert || null;
    if (!marketData) {
      try {
        marketData = await DataLoader.getMarketDataByStockCode(corp.stock_code || corp.code);
      } catch (_) {
        marketData = null;
      }
    }

    let guidanceData = response?.guidance || null;
    if (!guidanceData) {
      try {
        guidanceData = await DataLoader.getCorpGuidance(corp.corp_code || corp.code);
      } catch (_) {
        guidanceData = null;
      }
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

    const recent = buildFinancialRows(financials);

    let inlineDividendsData = options.inlineDividends || response?.dividends || null;
    let inlineTreasuryData = options.inlineTreasury || response?.treasury || null;
    let consensusData = response?.consensus || null;
    if (!inlineDividendsData) {
      try {
        inlineDividendsData = await DataLoader.getCorpDividends(corp.corp_code || corp.code);
      } catch (_) {
        inlineDividendsData = null;
      }
    }
    if (!inlineTreasuryData) {
      try {
        inlineTreasuryData = await DataLoader.getCorpTreasury(corp.corp_code || corp.code);
      } catch (_) {
        inlineTreasuryData = null;
      }
    }
    if (!consensusData) {
      try {
        consensusData = await DataLoader.getCorpConsensus(corp.corp_code || corp.code);
      } catch (_) {
        consensusData = null;
      }
    }

    const metrics = Metrics.compute(recent, marketData, corp.stock_code || corp.code);
    const barChart = buildMonotoneBarChart(recent, metrics, consensusData, guidanceData);
    const lineChart = buildPriceLineChart(marketData, corp.stock_code || corp.code);
    const inlineDividends = buildInlineDividendPanel(inlineDividendsData, marketData, inlineTreasuryData, financials);
    const tableRows = buildIntegratedTableRows(recent, metrics, guidanceData);
    const marketMeta = (() => {
      const cache = response?.market_cache ? `cache:${response.market_cache}` : '';
      const quality = response?.market_quality ? `quality:${response.market_quality}` : '';
      const source = marketData?.market_cap_source ? `source:${marketData.market_cap_source}` : '';
      const meta = [cache, quality, source].filter(Boolean).join(' · ');
      if (!meta) return null;
      return el('div', { className: 'consensus-panel__meta', text: `시장 데이터 상태 · ${meta}` });
    })();

    const tableArea = buildResponsiveFinancialTables(tableRows);
    const consensusPanel = buildConsensusPanel(consensusData, response?.consensus_cache, response?.consensus_alert, financials);

    const chartRow = el('div', {
      className: 'financial-chart-row',
      children: [
        inlineDividends,
        barChart || el('div', { className: 'mono-chart mono-chart--empty', text: '차트를 표시할 재무 데이터가 없습니다.' }),
      ],
    });

    card.appendChild(
      cardBody([
        marketMeta,
        marketAlert ? el('div', {
          className: `consensus-panel__alert consensus-panel__alert--${marketAlert.level || 'warn'}`,
          text: marketAlert.message || '시장 데이터 상태를 확인해 주세요.',
        }) : null,
        chartRow,
        consensusPanel,
        el('div', {
          className: 'financial-table-wrapper',
          children: [
            el('div', { className: 'consensus-panel__title', text: '기업 재무제표' }),
            tableArea,
          ],
        }),
        buildInvestmentGuideSection(),
      ]),
    );

    root.appendChild(card);
  }

  async function renderPriceOnly(root, corp, detailBundle) {
    clear(root);
    if (!corp) return;
    const response = detailBundle && typeof detailBundle.data !== 'undefined' ? detailBundle.data : detailBundle;
    let marketData = response?.market_data || null;
    const marketAlert = response?.market_alert || null;
    const marketMetaText = (() => {
      const cache = response?.market_cache ? `cache:${response.market_cache}` : '';
      const quality = response?.market_quality ? `quality:${response.market_quality}` : '';
      const source = marketData?.market_cap_source ? `source:${marketData.market_cap_source}` : '';
      return [cache, quality, source].filter(Boolean).join(' · ');
    })();
    if (!marketData) {
      try {
        marketData = await DataLoader.getMarketDataByStockCode(corp.stock_code || corp.code);
      } catch (_) {
        marketData = null;
      }
    }
    const card = cardRoot('price-card');
    card.appendChild(cardHeader('일봉 차트', '최근 최대 250거래일'));
    const lineChart = buildPriceLineChart(marketData, corp.stock_code || corp.code);
    card.appendChild(
      cardBody([
        marketMetaText ? el('div', { className: 'consensus-panel__meta', text: `시장 데이터 상태 · ${marketMetaText}` }) : null,
        marketAlert ? el('div', {
          className: `consensus-panel__alert consensus-panel__alert--${marketAlert.level || 'warn'}`,
          text: marketAlert.message || '시장 데이터 상태를 확인해 주세요.',
        }) : null,
        lineChart || el('div', { className: 'price-line price-line--empty', text: '시장 데이터가 없어 라인차트를 표시할 수 없습니다.' }),
      ]),
    );
    root.appendChild(card);
  }

  window.DartFinancialCharts = { render: renderFinancials, renderPriceOnly };
})();

