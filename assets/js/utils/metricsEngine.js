window.DartMetricsEngine = (function () {
  function quarterNum(label) {
    if (!label) return null;
    const m = String(label).match(/([1-4])Q/i);
    return m ? Number(m[1]) : null;
  }

  function annualizeNetIncome(latest) {
    if (!latest || latest.netIncomeRaw == null) return null;
    if (!latest.isCumulative) return latest.netIncomeRaw;
    const q = quarterNum(latest.quarterLabel);
    if (!q) return null;
    return (Number(latest.netIncomeRaw) / q) * 4;
  }

  function computeCagr(annualRows) {
    const rows = (annualRows || []).filter((r) => r && r.revenueRaw != null);
    if (rows.length < 2) return null;
    const sorted = rows.slice().sort((a, b) => a.year - b.year);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const years = last.year - first.year;
    if (!years || first.revenueRaw <= 0) return null;
    return (Math.pow(last.revenueRaw / first.revenueRaw, 1 / years) - 1) * 100;
  }

  function toPercent(numerator, denominator) {
    if (numerator == null || denominator == null || Number(denominator) === 0) return null;
    return (Number(numerator) / Number(denominator)) * 100;
  }

  function resolveRowMarketCap(row, latestMarketCap, marketData) {
    if (!row) return null;
    if (!row.isCumulative && marketData && marketData.year_end_market_caps) {
      const y = String(row.yearNumeric || row.year || '').trim();
      const cap = marketData.year_end_market_caps[y];
      if (cap != null) return Number(cap);
    }
    return latestMarketCap;
  }

  function compute(financialRows, marketData, stockCode) {
    const rows = financialRows || [];
    // buildFinancialRows()는 최신순(내림차순) 정렬이므로 rows[0]이 가장 최신 데이터
    const latest = rows[0] || null;
    const annualRows = rows.filter((r) => !r.isCumulative && String(r.period || '').includes('Annual')).slice(0, 5);

    const opMargin = latest ? toPercent(latest.opIncomeRaw, latest.revenueRaw) : null;
    const annualizedNet = annualizeNetIncome(latest);
    const equity = latest ? latest.equityRaw : null;

    // 상세 API의 market_data는 서버가 해당 기업용으로 보정해 준 것이므로, 있으면 사용(URL 해시만으로 진입 시 stockCode가 8자리 corp_code로 넘어와 불일치하는 경우 보정)
    let marketCap = null;
    if (marketData && marketData.market_cap != null) {
      marketCap = Number(marketData.market_cap);
    }

    const per = marketCap != null && annualizedNet != null && annualizedNet > 0 ? (marketCap / annualizedNet) : null;
    const pbr = marketCap != null && equity != null && equity > 0 ? (marketCap / equity) : null;
    const cagr5y = computeCagr(annualRows);

    const capex = latest && latest.capexTotalRaw != null ? latest.capexTotalRaw : null;
    const fcf = latest && latest.fcfRaw != null ? latest.fcfRaw : null;

    const byPeriod = {};
    rows.forEach((row) => {
      if (!row || !row.period) return;
      const rowMarketCap = resolveRowMarketCap(row, marketCap, marketData);
      const rowNet = row.netIncomeRaw != null ? Number(row.netIncomeRaw) : null;
      const rowEquity = row.equityRaw != null ? Number(row.equityRaw) : null;
      const rowPer = rowMarketCap != null && rowNet != null && rowNet > 0 ? (rowMarketCap / rowNet) : null;
      const rowPbr = rowMarketCap != null && rowEquity != null && rowEquity > 0 ? (rowMarketCap / rowEquity) : null;
      byPeriod[row.period] = {
        marketCap: rowMarketCap,
        per: rowPer,
        pbr: rowPbr,
      };
    });

    return {
      opMargin,
      roe: latest ? latest.roeRaw : null,
      roa: latest ? latest.roaRaw : null,
      debtRatio: latest ? latest.debtRatioRaw : null,
      capex,
      fcf,
      per,
      pbr,
      cagr5y,
      marketCap,
      byPeriod,
      sourceFsDiv: latest ? latest.fsDiv : null,
    };
  }

  return { compute };
})();
