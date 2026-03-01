const { createHybridLibsqlClient } = require('../db/libsql-client');

function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toMaybeText(v) {
  if (v === null || v === undefined) return null;
  return String(v);
}

function mapFinancialRecordRow(row) {
  return {
    year: toNum(row.year),
    quarter: toMaybeText(row.quarter),
    revenue: toNum(row.revenue),
    op_income: toNum(row.op_income),
    net_income: toNum(row.net_income),
    equity: toNum(row.equity),
    total_assets: toNum(row.total_assets),
    debt: toNum(row.debt),
    operating_cf: toNum(row.operating_cf),
    non_cash_adjustments: toNum(row.non_cash_adjustments),
    working_capital_change: toNum(row.working_capital_change),
    capex_ppe: toNum(row.capex_ppe),
    capex_intangible: toNum(row.capex_intangible),
    capex_total: toNum(row.capex_total),
    fcf: toNum(row.fcf),
    roe: toNum(row.roe),
    roa: toNum(row.roa),
    debt_ratio: toNum(row.debt_ratio),
    status: toMaybeText(row.status),
    source: toMaybeText(row.source),
    fs_div: toMaybeText(row.fs_div),
    report_type: toMaybeText(row.report_type),
  };
}

function createLibsqlProvider(options = {}) {
  const fallbackProvider = options.fallbackProvider;
  const strictReads = !!options.strictReads;
  if (!fallbackProvider) {
    throw new Error('libsql provider requires fallbackProvider');
  }

  const { client, config } = createHybridLibsqlClient(process.env);

  async function queryRows(sql, args = []) {
    const result = await client.execute({ sql, args });
    return Array.isArray(result?.rows) ? result.rows : [];
  }

  async function getCorpDetailBase(corpCode) {
    try {
      const code = String(corpCode || '').trim();
      if (!code) return null;

      const [overviewRows, finMetaRows, finYearsRows, finRecordsRows, divMetaRows, divYearRows, divDetailRows, guidanceMetaRows, guidanceRows, treasuryMetaRows, treasuryItemRows, treasuryYearlyRows, treasuryPolicyRows, consensusMetaRows, consensusItemRows] = await Promise.all([
        queryRows('SELECT payload_json FROM corp_overview WHERE corp_code = ?', [code]),
        queryRows('SELECT financials_fs_policy, last_updated_at FROM corp_financial_meta WHERE corp_code = ?', [code]),
        queryRows('SELECT year, status, source FROM corp_financial_year_status WHERE corp_code = ? ORDER BY year DESC', [code]),
        queryRows(`SELECT corp_code, year, period_key, period_type, quarter, revenue, op_income, net_income, equity, total_assets, debt, operating_cf, non_cash_adjustments, working_capital_change, capex_ppe, capex_intangible, capex_total, fcf, roe, roa, debt_ratio, status, source, fs_div, report_type FROM corp_financial_records WHERE corp_code = ? ORDER BY year DESC`, [code]),
        queryRows('SELECT last_updated_at FROM corp_dividend_meta WHERE corp_code = ?', [code]),
        queryRows('SELECT year, total_cash_dividend_per_share, dividend_yield_expect, payout_ratio, dividend_yield FROM corp_dividend_yearly WHERE corp_code = ? ORDER BY year DESC', [code]),
        queryRows('SELECT corp_code, year, detail_idx, type, label, cash_dividend_per_share, rcept_no, report_nm, rcept_dt, status, source FROM corp_dividend_details WHERE corp_code = ? ORDER BY year DESC, detail_idx ASC', [code]),
        queryRows('SELECT logic_version, last_updated_at FROM corp_guidance_meta WHERE corp_code = ?', [code]),
        queryRows('SELECT corp_code, rcept_no, report_nm, rcept_dt, status, source, report_kind, period_label, revenue, op_income, net_income, cash_dividend_per_share FROM corp_guidance_items WHERE corp_code = ? ORDER BY rcept_dt DESC, rcept_no DESC', [code]),
        queryRows('SELECT logic_version, last_updated_at FROM corp_treasury_meta WHERE corp_code = ?', [code]),
        queryRows('SELECT corp_code, rcept_no, year, report_nm, rcept_dt, event_type, retired_shares, retired_amount, status, source, confidence FROM corp_treasury_items WHERE corp_code = ? ORDER BY rcept_dt DESC, rcept_no DESC', [code]),
        queryRows('SELECT corp_code, year, retired_shares_total, retired_amount_total, event_count, basis FROM corp_treasury_yearly_summary WHERE corp_code = ? ORDER BY year DESC', [code]),
        queryRows('SELECT lookback_months, cutoff_rcept_dt, source FROM corp_treasury_fetch_policy WHERE corp_code = ?', [code]),
        queryRows('SELECT stock_code, source, unit, source_url, ttl_hours, last_updated_at, fetched_at FROM corp_consensus_meta WHERE corp_code = ?', [code]),
        queryRows('SELECT year_label, is_estimate, revenue, op_income, net_income, roe FROM corp_consensus_items WHERE corp_code = ? ORDER BY year_label ASC', [code]),
      ]);

      let shareholdersRows = [];
      try {
        shareholdersRows = await queryRows('SELECT bsns_year, reprt_code, items_json, common_treasury_shares, total_issued_shares, naver_items_json, sync_status, last_updated_at FROM corp_shareholders WHERE corp_code = ?', [code]);
      } catch (_) {
        shareholdersRows = [];
      }

      if (
        overviewRows.length === 0 &&
        finYearsRows.length === 0 &&
        divYearRows.length === 0 &&
        guidanceRows.length === 0 &&
        treasuryItemRows.length === 0
      ) {
        return null;
      }

      const overview = overviewRows[0]?.payload_json ? JSON.parse(String(overviewRows[0].payload_json)) : null;

      const finMeta = finMetaRows[0] || null;
      const financialByYear = new Map();
      for (const row of finYearsRows) {
        const year = toNum(row.year);
        if (year === null) continue;
        financialByYear.set(year, {
          year,
          annual: null,
          quarters: {},
          status: toMaybeText(row.status),
          source: toMaybeText(row.source),
        });
      }
      for (const row of finRecordsRows) {
        const year = toNum(row.year);
        if (year === null) continue;
        if (!financialByYear.has(year)) {
          financialByYear.set(year, { year, annual: null, quarters: {}, status: null, source: null });
        }
        const bucket = financialByYear.get(year);
        const periodKey = toMaybeText(row.period_key);
        const periodType = toMaybeText(row.period_type);
        const payload = mapFinancialRecordRow(row);
        if (periodType === 'annual' || periodKey === 'annual') {
          bucket.annual = payload;
        } else if (periodKey) {
          bucket.quarters[periodKey] = payload;
        }
      }
      const financialItems = Array.from(financialByYear.values()).sort((a, b) => (b.year || 0) - (a.year || 0));
      const financials = financialItems.length > 0 || finMeta
        ? {
            corp_code: code,
            financials_fs_policy: toMaybeText(finMeta?.financials_fs_policy),
            items: financialItems,
            last_updated_at: toMaybeText(finMeta?.last_updated_at),
          }
        : null;

      const divMeta = divMetaRows[0] || null;
      const detailsByYear = new Map();
      for (const d of divDetailRows) {
        const year = toNum(d.year);
        if (year === null) continue;
        if (!detailsByYear.has(year)) detailsByYear.set(year, []);
        detailsByYear.get(year).push({
          type: toMaybeText(d.type),
          label: toMaybeText(d.label),
          cash_dividend_per_share: toNum(d.cash_dividend_per_share),
          rcept_no: toMaybeText(d.rcept_no),
          report_nm: toMaybeText(d.report_nm),
          rcept_dt: toMaybeText(d.rcept_dt),
          status: toMaybeText(d.status),
          source: toMaybeText(d.source),
        });
      }
      const dividendItems = divYearRows.map((row) => {
        const year = toNum(row.year);
        return {
          year,
          total_cash_dividend_per_share: toNum(row.total_cash_dividend_per_share),
          dividend_yield_expect: toNum(row.dividend_yield_expect),
          payout_ratio: toNum(row.payout_ratio),
          dividend_yield: toNum(row.dividend_yield),
          details: detailsByYear.get(year) || [],
        };
      });
      const dividends = dividendItems.length > 0 || divMeta
        ? {
            corp_code: code,
            items: dividendItems,
            last_updated_at: toMaybeText(divMeta?.last_updated_at),
          }
        : null;

      const guidanceMeta = guidanceMetaRows[0] || null;
      const guidanceItems = guidanceRows.map((g) => {
        const row = {
          rcept_no: toMaybeText(g.rcept_no),
          report_nm: toMaybeText(g.report_nm),
          rcept_dt: toMaybeText(g.rcept_dt),
          status: toMaybeText(g.status),
          source: toMaybeText(g.source),
          report_kind: toMaybeText(g.report_kind),
          period_label: toMaybeText(g.period_label),
        };
        const values = {
          revenue: toNum(g.revenue),
          op_income: toNum(g.op_income),
          net_income: toNum(g.net_income),
          cash_dividend_per_share: toNum(g.cash_dividend_per_share),
        };
        if (Object.values(values).some((v) => v !== null)) {
          row.values = values;
        }
        return row;
      });
      const guidance = guidanceItems.length > 0 || guidanceMeta
        ? {
            corp_code: code,
            logic_version: toMaybeText(guidanceMeta?.logic_version),
            items: guidanceItems,
            last_updated_at: toMaybeText(guidanceMeta?.last_updated_at),
          }
        : null;

      const treasuryMeta = treasuryMetaRows[0] || null;
      const treasuryItems = treasuryItemRows.map((t) => ({
        year: toNum(t.year),
        rcept_no: toMaybeText(t.rcept_no),
        report_nm: toMaybeText(t.report_nm),
        rcept_dt: toMaybeText(t.rcept_dt),
        event_type: toMaybeText(t.event_type),
        retired_shares: toNum(t.retired_shares),
        retired_amount: toNum(t.retired_amount),
        status: toMaybeText(t.status),
        source: toMaybeText(t.source),
        confidence: toMaybeText(t.confidence),
      }));
      const treasuryYearlySummary = treasuryYearlyRows.map((y) => ({
        year: toNum(y.year),
        retired_shares_total: toNum(y.retired_shares_total),
        retired_amount_total: toNum(y.retired_amount_total),
        event_count: toNum(y.event_count),
        basis: toMaybeText(y.basis),
      }));
      const policy = treasuryPolicyRows[0]
        ? {
            lookback_months: toNum(treasuryPolicyRows[0].lookback_months),
            cutoff_rcept_dt: toMaybeText(treasuryPolicyRows[0].cutoff_rcept_dt),
            source: toMaybeText(treasuryPolicyRows[0].source),
          }
        : null;
      const treasury = treasuryItems.length > 0 || treasuryMeta || treasuryYearlySummary.length > 0
        ? {
            corp_code: code,
            logic_version: toMaybeText(treasuryMeta?.logic_version),
            items: treasuryItems,
            yearly_summary: treasuryYearlySummary,
            fetch_policy: policy,
            last_updated_at: toMaybeText(treasuryMeta?.last_updated_at),
          }
        : null;

      const consensusMeta = consensusMetaRows[0];
      const consensusItems = (consensusItemRows || []).map((row) => ({
        year_label: toMaybeText(row.year_label),
        is_estimate: row.is_estimate === 1,
        revenue: toNum(row.revenue),
        op_income: toNum(row.op_income),
        net_income: toNum(row.net_income),
        roe: toNum(row.roe),
      }));
      const consensus = consensusMeta
        ? {
            corp_code: code,
            stock_code: toMaybeText(consensusMeta.stock_code),
            source: toMaybeText(consensusMeta.source),
            unit: toMaybeText(consensusMeta.unit),
            items: consensusItems,
            source_url: toMaybeText(consensusMeta.source_url),
            fetch_policy: consensusMeta.ttl_hours != null ? { ttl_hours: toNum(consensusMeta.ttl_hours) } : undefined,
            last_updated_at: toMaybeText(consensusMeta.last_updated_at),
            fetched_at: toMaybeText(consensusMeta.fetched_at),
          }
        : null;

      const shareholdersRow = shareholdersRows[0] || null;
      let shareholders = null;
      if (shareholdersRow) {
        let shItems = [];
        let shNaverItems = [];
        try { shItems = shareholdersRow.items_json ? JSON.parse(String(shareholdersRow.items_json)) : []; }
        catch (e) { console.warn(`[libsql] corp=${code} shareholders items_json parse error:`, e.message); }
        try { shNaverItems = shareholdersRow.naver_items_json ? JSON.parse(String(shareholdersRow.naver_items_json)) : []; }
        catch (e) { console.warn(`[libsql] corp=${code} shareholders naver_items_json parse error:`, e.message); }
        shareholders = {
          bsns_year: shareholdersRow.bsns_year != null ? Number(shareholdersRow.bsns_year) : null,
          reprt_code: toMaybeText(shareholdersRow.reprt_code),
          items: shItems,
          common_treasury_shares: shareholdersRow.common_treasury_shares != null ? Number(shareholdersRow.common_treasury_shares) : null,
          total_issued_shares: shareholdersRow.total_issued_shares != null ? Number(shareholdersRow.total_issued_shares) : null,
          naver_extra_items: shNaverItems,
          sync_status: toMaybeText(shareholdersRow.sync_status),
          last_updated_at: toMaybeText(shareholdersRow.last_updated_at),
        };
      }

      let officersRows = [];
      try {
        officersRows = await queryRows('SELECT bsns_year, reprt_code, items_json, sync_status, last_updated_at FROM corp_officers WHERE corp_code = ?', [code]);
      } catch (_) {
        officersRows = [];
      }
      const officersRow = officersRows[0] || null;
      let officers = null;
      if (officersRow) {
        let ofItems = [];
        try { ofItems = officersRow.items_json ? JSON.parse(String(officersRow.items_json)) : []; }
        catch (e) { console.warn(`[libsql] corp=${code} officers items_json parse error:`, e.message); }
        officers = {
          bsns_year: officersRow.bsns_year != null ? Number(officersRow.bsns_year) : null,
          reprt_code: toMaybeText(officersRow.reprt_code),
          items: ofItems,
          sync_status: toMaybeText(officersRow.sync_status),
          last_updated_at: toMaybeText(officersRow.last_updated_at),
        };
      }

      return { overview, financials, dividends, guidance, treasury, consensus, shareholders, officers };
    } catch (err) {
      if (strictReads) {
        throw err;
      }
      // During phased rollout, any DB read issue immediately falls back to stable JSON source.
      return fallbackProvider.getCorpDetailBase(corpCode);
    }
  }

  async function getCorpIndex() {
    try {
      const rows = await queryRows(
        `SELECT corp_code, corp_name, stock_name, stock_code, market, induty, sector, last_updated_at
         FROM corp_index
         ORDER BY corp_name ASC`,
      );
      if (!rows.length) {
        return fallbackProvider.getCorpIndex();
      }
      return rows.map((row) => ({
        corp_code: toMaybeText(row.corp_code),
        corp_name: toMaybeText(row.corp_name),
        stock_name: toMaybeText(row.stock_name),
        stock_code: toMaybeText(row.stock_code),
        market: toMaybeText(row.market),
        induty: toMaybeText(row.induty),
        sector: toMaybeText(row.sector),
        last_updated_at: toMaybeText(row.last_updated_at),
      }));
    } catch (err) {
      if (strictReads) {
        throw err;
      }
      return fallbackProvider.getCorpIndex();
    }
  }

  return {
    mode: 'db',
    readStrategy: 'db-with-json-fallback',
    client,
    config,
    getCorpDetailBase,
    getCorpIndex,
  };
}

module.exports = {
  createLibsqlProvider,
};
