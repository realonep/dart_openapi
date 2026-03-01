/**
 * DB에 기업 데이터를 upsert (객체 기준). 수집 파이프라인·마이그레이션 공용.
 */
function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toText(v) {
  if (v === null || v === undefined) return null;
  return String(v);
}

const BUSY_RETRY_ATTEMPTS = Math.max(1, Number(process.env.DB_BUSY_RETRY_ATTEMPTS || 4));
const BUSY_RETRY_BASE_MS = Math.max(1, Number(process.env.DB_BUSY_RETRY_BASE_MS || 120));
const BUSY_RETRY_JITTER_MS = Math.max(0, Number(process.env.DB_BUSY_RETRY_JITTER_MS || 80));

function isBusyError(err) {
  const msg = String(err?.message || '');
  return msg.includes('SQLITE_BUSY') || msg.toLowerCase().includes('database is locked');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function executeWithBusyRetryRaw(rawExecute, statement) {
  let lastErr = null;
  for (let attempt = 1; attempt <= BUSY_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await rawExecute(statement);
    } catch (err) {
      lastErr = err;
      if (!isBusyError(err) || attempt >= BUSY_RETRY_ATTEMPTS) break;
      const backoff = BUSY_RETRY_BASE_MS * (2 ** (attempt - 1));
      const jitter = Math.random() * BUSY_RETRY_JITTER_MS;
      await sleep(backoff + jitter);
    }
  }
  throw lastErr;
}

function ensureBusyRetryClient(client) {
  if (!client || client.__busyRetryPatched) return client;
  const rawExecute = client.execute.bind(client);
  const patchedExecute = (statement) => executeWithBusyRetryRaw(rawExecute, statement);
  try {
    Object.defineProperty(client, 'execute', { value: patchedExecute, configurable: true, writable: true });
    Object.defineProperty(client, '__busyRetryPatched', { value: true, configurable: true });
  } catch (_) {
    // 객체가 확장 불가한 경우엔 패치 없이 원본 사용
  }
  return client;
}

async function clearCorp(client, corpCode) {
  ensureBusyRetryClient(client);
  const deletes = [
    'DELETE FROM corp_overview WHERE corp_code = ?',
    'DELETE FROM corp_financial_meta WHERE corp_code = ?',
    'DELETE FROM corp_financial_year_status WHERE corp_code = ?',
    'DELETE FROM corp_financial_records WHERE corp_code = ?',
    'DELETE FROM corp_dividend_meta WHERE corp_code = ?',
    'DELETE FROM corp_dividend_yearly WHERE corp_code = ?',
    'DELETE FROM corp_dividend_details WHERE corp_code = ?',
    'DELETE FROM corp_guidance_meta WHERE corp_code = ?',
    'DELETE FROM corp_guidance_items WHERE corp_code = ?',
    'DELETE FROM corp_treasury_meta WHERE corp_code = ?',
    'DELETE FROM corp_treasury_items WHERE corp_code = ?',
    'DELETE FROM corp_treasury_yearly_summary WHERE corp_code = ?',
    'DELETE FROM corp_treasury_fetch_policy WHERE corp_code = ?',
    'DELETE FROM corp_consensus_meta WHERE corp_code = ?',
    'DELETE FROM corp_consensus_items WHERE corp_code = ?',
    'DELETE FROM corp_shareholders WHERE corp_code = ?',
    'DELETE FROM corp_officers WHERE corp_code = ?',
  ];
  for (const sql of deletes) {
    await client.execute({ sql, args: [corpCode] });
  }
}

async function upsertOverview(client, corpCode, overview) {
  ensureBusyRetryClient(client);
  if (!overview || typeof overview !== 'object') return;
  await client.execute({
    sql: `INSERT OR REPLACE INTO corp_overview (
      corp_code, stock_code, corp_name, payload_json, last_updated_at
    ) VALUES (?, ?, ?, ?, ?)`,
    args: [
      corpCode,
      toText(overview.stock_code),
      toText(overview.corp_name),
      JSON.stringify(overview),
      toText(overview.last_updated_at),
    ],
  });
}

async function upsertFinancials(client, corpCode, financials) {
  ensureBusyRetryClient(client);
  if (!financials || !Array.isArray(financials.items)) return;
  await client.execute({
    sql: `INSERT OR REPLACE INTO corp_financial_meta (
      corp_code, financials_fs_policy, last_updated_at
    ) VALUES (?, ?, ?)`,
    args: [
      corpCode,
      toText(financials.financials_fs_policy),
      toText(financials.last_updated_at),
    ],
  });
  for (const item of financials.items) {
    const year = toNum(item.year);
    if (year === null) continue;
    await client.execute({
      sql: `INSERT OR REPLACE INTO corp_financial_year_status (
        corp_code, year, status, source, last_updated_at
      ) VALUES (?, ?, ?, ?, ?)`,
      args: [
        corpCode,
        year,
        toText(item.status),
        toText(item.source),
        toText(financials.last_updated_at),
      ],
    });
    const periods = [];
    if (item.annual && typeof item.annual === 'object') {
      periods.push({ periodKey: 'annual', periodType: 'annual', payload: item.annual });
    }
    const quarters = item.quarters && typeof item.quarters === 'object' ? item.quarters : {};
    for (const [quarterKey, quarterValue] of Object.entries(quarters)) {
      periods.push({ periodKey: quarterKey, periodType: 'quarter', payload: quarterValue });
    }
    for (const period of periods) {
      const p = period.payload || {};
      await client.execute({
        sql: `INSERT OR REPLACE INTO corp_financial_records (
          corp_code, year, period_key, period_type, quarter, revenue, op_income, net_income, equity,
          total_assets, debt, operating_cf, non_cash_adjustments, working_capital_change,
          capex_ppe, capex_intangible, capex_total, fcf, roe, roa, debt_ratio, status, source, fs_div, report_type
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          corpCode,
          year,
          period.periodKey,
          period.periodType,
          toText(p.quarter),
          toNum(p.revenue),
          toNum(p.op_income),
          toNum(p.net_income),
          toNum(p.equity),
          toNum(p.total_assets),
          toNum(p.debt),
          toNum(p.operating_cf),
          toNum(p.non_cash_adjustments),
          toNum(p.working_capital_change),
          toNum(p.capex_ppe),
          toNum(p.capex_intangible),
          toNum(p.capex_total),
          toNum(p.fcf),
          toNum(p.roe),
          toNum(p.roa),
          toNum(p.debt_ratio),
          toText(p.status),
          toText(p.source),
          toText(p.fs_div),
          toText(p.report_type),
        ],
      });
    }
  }
}

async function upsertDividends(client, corpCode, dividends) {
  ensureBusyRetryClient(client);
  if (!dividends || !Array.isArray(dividends.items)) return;
  await client.execute({
    sql: `INSERT OR REPLACE INTO corp_dividend_meta (corp_code, last_updated_at) VALUES (?, ?)`,
    args: [corpCode, toText(dividends.last_updated_at)],
  });
  for (const item of dividends.items) {
    const year = toNum(item.year);
    if (year === null) continue;
    await client.execute({
      sql: `INSERT OR REPLACE INTO corp_dividend_yearly (
        corp_code, year, total_cash_dividend_per_share, dividend_yield_expect, payout_ratio, dividend_yield, last_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        corpCode,
        year,
        toNum(item.total_cash_dividend_per_share),
        toNum(item.dividend_yield_expect),
        toNum(item.payout_ratio),
        toNum(item.dividend_yield),
        toText(dividends.last_updated_at),
      ],
    });
    const details = Array.isArray(item.details) ? item.details : [];
    for (let i = 0; i < details.length; i += 1) {
      const d = details[i];
      await client.execute({
        sql: `INSERT OR REPLACE INTO corp_dividend_details (
          corp_code, year, detail_idx, type, label, cash_dividend_per_share,
          rcept_no, report_nm, rcept_dt, status, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          corpCode,
          year,
          i,
          toText(d.type),
          toText(d.label),
          toNum(d.cash_dividend_per_share),
          toText(d.rcept_no),
          toText(d.report_nm),
          toText(d.rcept_dt),
          toText(d.status),
          toText(d.source),
        ],
      });
    }
  }
}

async function upsertGuidance(client, corpCode, guidance) {
  ensureBusyRetryClient(client);
  if (!guidance || !Array.isArray(guidance.items)) return;
  await client.execute({
    sql: `INSERT OR REPLACE INTO corp_guidance_meta (corp_code, logic_version, last_updated_at) VALUES (?, ?, ?)`,
    args: [corpCode, toText(guidance.logic_version), toText(guidance.last_updated_at)],
  });
  for (const item of guidance.items) {
    if (!item.rcept_no) continue;
    const values = item.values && typeof item.values === 'object' ? item.values : {};
    await client.execute({
      sql: `INSERT OR REPLACE INTO corp_guidance_items (
        corp_code, rcept_no, report_nm, rcept_dt, status, source, report_kind, period_label,
        revenue, op_income, net_income, cash_dividend_per_share, logic_version, last_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        corpCode,
        toText(item.rcept_no),
        toText(item.report_nm),
        toText(item.rcept_dt),
        toText(item.status),
        toText(item.source),
        toText(item.report_kind),
        toText(item.period_label),
        toNum(values.revenue),
        toNum(values.op_income),
        toNum(values.net_income),
        toNum(values.cash_dividend_per_share),
        toText(guidance.logic_version),
        toText(guidance.last_updated_at),
      ],
    });
  }
}

async function upsertTreasury(client, corpCode, treasury) {
  ensureBusyRetryClient(client);
  if (!treasury || typeof treasury !== 'object') return;
  await client.execute({
    sql: `INSERT OR REPLACE INTO corp_treasury_meta (corp_code, logic_version, last_updated_at) VALUES (?, ?, ?)`,
    args: [corpCode, toText(treasury.logic_version), toText(treasury.last_updated_at)],
  });
  const items = Array.isArray(treasury.items) ? treasury.items : [];
  for (const item of items) {
    if (!item.rcept_no) continue;
    await client.execute({
      sql: `INSERT OR REPLACE INTO corp_treasury_items (
        corp_code, rcept_no, year, report_nm, rcept_dt, event_type, retired_shares, retired_amount,
        status, source, confidence, logic_version, last_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        corpCode,
        toText(item.rcept_no),
        toNum(item.year),
        toText(item.report_nm),
        toText(item.rcept_dt),
        toText(item.event_type),
        toNum(item.retired_shares),
        toNum(item.retired_amount),
        toText(item.status),
        toText(item.source),
        toText(item.confidence),
        toText(treasury.logic_version),
        toText(treasury.last_updated_at),
      ],
    });
  }
  const yearlySummary = Array.isArray(treasury.yearly_summary) ? treasury.yearly_summary : [];
  for (const row of yearlySummary) {
    const year = toNum(row.year);
    if (year === null) continue;
    await client.execute({
      sql: `INSERT OR REPLACE INTO corp_treasury_yearly_summary (
        corp_code, year, retired_shares_total, retired_amount_total, event_count, basis
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        corpCode,
        year,
        toNum(row.retired_shares_total),
        toNum(row.retired_amount_total),
        toNum(row.event_count),
        toText(row.basis),
      ],
    });
  }
  const policy = treasury.fetch_policy || {};
  await client.execute({
    sql: `INSERT OR REPLACE INTO corp_treasury_fetch_policy (
      corp_code, lookback_months, cutoff_rcept_dt, source, updated_at
    ) VALUES (?, ?, ?, ?, ?)`,
    args: [
      corpCode,
      toNum(policy.lookback_months),
      toText(policy.cutoff_rcept_dt),
      toText(policy.source),
      toText(treasury.last_updated_at),
    ],
  });
}

async function upsertConsensus(client, corpCode, consensus) {
  ensureBusyRetryClient(client);
  if (!consensus || typeof consensus !== 'object') return;
  await client.execute({
    sql: `INSERT OR REPLACE INTO corp_consensus_meta (
      corp_code, stock_code, source, unit, source_url, ttl_hours, last_updated_at, fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      corpCode,
      toText(consensus.stock_code),
      toText(consensus.source),
      toText(consensus.unit),
      toText(consensus.source_url),
      toNum(consensus.fetch_policy?.ttl_hours),
      toText(consensus.last_updated_at),
      toText(consensus.fetched_at),
    ],
  });
  const items = Array.isArray(consensus.items) ? consensus.items : [];
  for (const item of items) {
    if (!item.year_label) continue;
    await client.execute({
      sql: `INSERT OR REPLACE INTO corp_consensus_items (
        corp_code, year_label, is_estimate, revenue, op_income, net_income, roe
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        corpCode,
        toText(item.year_label),
        item.is_estimate ? 1 : 0,
        toNum(item.revenue),
        toNum(item.op_income),
        toNum(item.net_income),
        toNum(item.roe),
      ],
    });
  }
}

/** 한 기업 전체를 DB에 반영(기존 행 삭제 후 upsert). consensus는 선택. */
async function upsertOneCorp(client, corpCode, data) {
  ensureBusyRetryClient(client);
  await clearCorp(client, corpCode);
  if (data.overview)      await upsertOverview(client, corpCode, data.overview);
  if (data.financials)    await upsertFinancials(client, corpCode, data.financials);
  if (data.dividends)     await upsertDividends(client, corpCode, data.dividends);
  if (data.guidance)      await upsertGuidance(client, corpCode, data.guidance);
  if (data.treasury)      await upsertTreasury(client, corpCode, data.treasury);
  if (data.consensus)     await upsertConsensus(client, corpCode, data.consensus);
  if (data.shareholders)  await upsertShareholders(client, corpCode, data.shareholders);
  if (data.officers)      await upsertOfficers(client, corpCode, data.officers);
}

/** corp_index 한 행 upsert (수집 시 overview 기준으로 인덱스 갱신). */
async function upsertCorpIndexEntry(client, entry) {
  ensureBusyRetryClient(client);
  if (!entry || !entry.corp_code) return;
  await client.execute({
    sql: `INSERT OR REPLACE INTO corp_index (
      corp_code, corp_name, stock_name, stock_code, market, induty, sector, last_updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      toText(entry.corp_code),
      toText(entry.corp_name),
      toText(entry.stock_name),
      toText(entry.stock_code),
      toText(entry.market),
      toText(entry.induty),
      toText(entry.sector),
      toText(entry.last_updated_at),
    ],
  });
}

/** DB에서 guidance/treasury만 읽어 JSON과 동일한 형태로 반환 (DB_ONLY 시 기존 데이터 조회용). */
async function getExistingGuidanceTreasury(client, corpCode) {
  const [metaG, itemsG, metaT, itemsT, yearlyT, policyT] = await Promise.all([
    client.execute({ sql: 'SELECT logic_version, last_updated_at FROM corp_guidance_meta WHERE corp_code = ?', args: [corpCode] }),
    client.execute({ sql: 'SELECT * FROM corp_guidance_items WHERE corp_code = ? ORDER BY rcept_dt DESC, rcept_no DESC', args: [corpCode] }),
    client.execute({ sql: 'SELECT logic_version, last_updated_at FROM corp_treasury_meta WHERE corp_code = ?', args: [corpCode] }),
    client.execute({ sql: 'SELECT * FROM corp_treasury_items WHERE corp_code = ? ORDER BY rcept_dt DESC, rcept_no DESC', args: [corpCode] }),
    client.execute({ sql: 'SELECT * FROM corp_treasury_yearly_summary WHERE corp_code = ? ORDER BY year DESC', args: [corpCode] }),
    client.execute({ sql: 'SELECT lookback_months, cutoff_rcept_dt, source FROM corp_treasury_fetch_policy WHERE corp_code = ?', args: [corpCode] }),
  ]);
  const guidance = (itemsG.rows || []).length || metaG.rows?.length
    ? {
        corp_code: corpCode,
        logic_version: metaG.rows?.[0]?.logic_version ?? null,
        items: (itemsG.rows || []).map((r) => ({
          rcept_no: r.rcept_no,
          report_nm: r.report_nm,
          rcept_dt: r.rcept_dt,
          status: r.status,
          source: r.source,
          report_kind: r.report_kind,
          period_label: r.period_label,
          values: [r.revenue, r.op_income, r.net_income, r.cash_dividend_per_share].some((x) => x != null)
            ? { revenue: r.revenue, op_income: r.op_income, net_income: r.net_income, cash_dividend_per_share: r.cash_dividend_per_share }
            : undefined,
        })),
        last_updated_at: metaG.rows?.[0]?.last_updated_at ?? null,
      }
    : null;
  const policyRow = policyT.rows?.[0];
  const treasury = (itemsT.rows || []).length || metaT.rows?.length || (yearlyT.rows || []).length
    ? {
        corp_code: corpCode,
        logic_version: metaT.rows?.[0]?.logic_version ?? null,
        items: (itemsT.rows || []).map((r) => ({
          year: r.year,
          rcept_no: r.rcept_no,
          report_nm: r.report_nm,
          rcept_dt: r.rcept_dt,
          event_type: r.event_type,
          retired_shares: r.retired_shares,
          retired_amount: r.retired_amount,
          status: r.status,
          source: r.source,
          confidence: r.confidence,
        })),
        yearly_summary: (yearlyT.rows || []).map((y) => ({
          year: y.year,
          retired_shares_total: y.retired_shares_total,
          retired_amount_total: y.retired_amount_total,
          event_count: y.event_count,
          basis: y.basis,
        })),
        fetch_policy: policyRow
          ? { lookback_months: policyRow.lookback_months, cutoff_rcept_dt: policyRow.cutoff_rcept_dt, source: policyRow.source }
          : null,
        last_updated_at: metaT.rows?.[0]?.last_updated_at ?? null,
      }
    : null;
  return { guidance, treasury };
}

async function upsertShareholders(client, corpCode, shareholders) {
  ensureBusyRetryClient(client);
  if (!shareholders) return;
  const items = Array.isArray(shareholders.items) ? shareholders.items : [];
  const naverJson = Array.isArray(shareholders.naver_extra_items)
    ? JSON.stringify(shareholders.naver_extra_items)
    : null;
  await client.execute({
    sql: `INSERT OR REPLACE INTO corp_shareholders (
      corp_code, bsns_year, reprt_code, items_json, common_treasury_shares, total_issued_shares, naver_items_json, sync_status, last_updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      corpCode,
      shareholders.bsns_year != null ? Number(shareholders.bsns_year) : null,
      toText(shareholders.reprt_code),
      JSON.stringify(items),
      shareholders.common_treasury_shares != null ? Number(shareholders.common_treasury_shares) : null,
      shareholders.total_issued_shares != null ? Number(shareholders.total_issued_shares) : null,
      naverJson,
      toText(shareholders.sync_status ?? null),
      toText(shareholders.last_updated_at),
    ],
  });
}

async function upsertOfficers(client, corpCode, officers) {
  ensureBusyRetryClient(client);
  if (!officers) return;
  const items = Array.isArray(officers.items) ? officers.items : [];
  await client.execute({
    sql: `INSERT OR REPLACE INTO corp_officers (
      corp_code, bsns_year, reprt_code, items_json, sync_status, last_updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      corpCode,
      officers.bsns_year != null ? Number(officers.bsns_year) : null,
      toText(officers.reprt_code),
      JSON.stringify(items),
      toText(officers.sync_status ?? null),
      toText(officers.last_updated_at),
    ],
  });
}

module.exports = {
  upsertOverview,
  upsertFinancials,
  upsertDividends,
  upsertGuidance,
  upsertTreasury,
  upsertConsensus,
  upsertShareholders,
  upsertOfficers,
  upsertOneCorp,
  upsertCorpIndexEntry,
  getExistingGuidanceTreasury,
};
