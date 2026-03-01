const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS corp_index (
    corp_code TEXT PRIMARY KEY,
    corp_name TEXT,
    stock_name TEXT,
    stock_code TEXT,
    market TEXT,
    induty TEXT,
    sector TEXT,
    last_updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS corp_overview (
    corp_code TEXT PRIMARY KEY,
    stock_code TEXT,
    corp_name TEXT,
    payload_json TEXT NOT NULL,
    last_updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS corp_financial_meta (
    corp_code TEXT PRIMARY KEY,
    financials_fs_policy TEXT,
    last_updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS corp_financial_year_status (
    corp_code TEXT NOT NULL,
    year INTEGER NOT NULL,
    status TEXT,
    source TEXT,
    last_updated_at TEXT,
    PRIMARY KEY (corp_code, year)
  )`,
  `CREATE TABLE IF NOT EXISTS corp_financial_records (
    corp_code TEXT NOT NULL,
    year INTEGER NOT NULL,
    period_key TEXT NOT NULL,
    period_type TEXT NOT NULL,
    quarter TEXT,
    revenue REAL,
    op_income REAL,
    net_income REAL,
    equity REAL,
    total_assets REAL,
    debt REAL,
    operating_cf REAL,
    non_cash_adjustments REAL,
    working_capital_change REAL,
    capex_ppe REAL,
    capex_intangible REAL,
    capex_total REAL,
    fcf REAL,
    roe REAL,
    roa REAL,
    debt_ratio REAL,
    status TEXT,
    source TEXT,
    fs_div TEXT,
    report_type TEXT,
    PRIMARY KEY (corp_code, year, period_key)
  )`,
  `CREATE TABLE IF NOT EXISTS corp_dividend_yearly (
    corp_code TEXT NOT NULL,
    year INTEGER NOT NULL,
    total_cash_dividend_per_share REAL,
    dividend_yield_expect REAL,
    payout_ratio REAL,
    dividend_yield REAL,
    last_updated_at TEXT,
    PRIMARY KEY (corp_code, year)
  )`,
  `CREATE TABLE IF NOT EXISTS corp_dividend_meta (
    corp_code TEXT PRIMARY KEY,
    last_updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS corp_dividend_details (
    corp_code TEXT NOT NULL,
    year INTEGER NOT NULL,
    detail_idx INTEGER NOT NULL,
    type TEXT,
    label TEXT,
    cash_dividend_per_share REAL,
    rcept_no TEXT,
    report_nm TEXT,
    rcept_dt TEXT,
    status TEXT,
    source TEXT,
    PRIMARY KEY (corp_code, year, detail_idx)
  )`,
  `CREATE TABLE IF NOT EXISTS corp_guidance_items (
    corp_code TEXT NOT NULL,
    rcept_no TEXT NOT NULL,
    report_nm TEXT,
    rcept_dt TEXT,
    status TEXT,
    source TEXT,
    report_kind TEXT,
    period_label TEXT,
    revenue REAL,
    op_income REAL,
    net_income REAL,
    cash_dividend_per_share REAL,
    logic_version TEXT,
    last_updated_at TEXT,
    PRIMARY KEY (corp_code, rcept_no)
  )`,
  `CREATE TABLE IF NOT EXISTS corp_guidance_meta (
    corp_code TEXT PRIMARY KEY,
    logic_version TEXT,
    last_updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS corp_treasury_items (
    corp_code TEXT NOT NULL,
    rcept_no TEXT NOT NULL,
    year INTEGER,
    report_nm TEXT,
    rcept_dt TEXT,
    event_type TEXT,
    retired_shares REAL,
    retired_amount REAL,
    status TEXT,
    source TEXT,
    confidence TEXT,
    logic_version TEXT,
    last_updated_at TEXT,
    PRIMARY KEY (corp_code, rcept_no)
  )`,
  `CREATE TABLE IF NOT EXISTS corp_treasury_meta (
    corp_code TEXT PRIMARY KEY,
    logic_version TEXT,
    last_updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS corp_treasury_yearly_summary (
    corp_code TEXT NOT NULL,
    year INTEGER NOT NULL,
    retired_shares_total REAL,
    retired_amount_total REAL,
    event_count INTEGER,
    basis TEXT,
    PRIMARY KEY (corp_code, year)
  )`,
  `CREATE TABLE IF NOT EXISTS corp_treasury_fetch_policy (
    corp_code TEXT PRIMARY KEY,
    lookback_months INTEGER,
    cutoff_rcept_dt TEXT,
    source TEXT,
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS corp_consensus_meta (
    corp_code TEXT PRIMARY KEY,
    stock_code TEXT,
    source TEXT,
    unit TEXT,
    source_url TEXT,
    ttl_hours INTEGER,
    last_updated_at TEXT,
    fetched_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS corp_consensus_items (
    corp_code TEXT NOT NULL,
    year_label TEXT NOT NULL,
    is_estimate INTEGER,
    revenue REAL,
    op_income REAL,
    net_income REAL,
    roe REAL,
    PRIMARY KEY (corp_code, year_label)
  )`,
  `CREATE TABLE IF NOT EXISTS corp_shareholders (
    corp_code               TEXT PRIMARY KEY,
    bsns_year               INTEGER,
    reprt_code              TEXT,
    items_json              TEXT NOT NULL,
    common_treasury_shares  INTEGER,
    total_issued_shares     INTEGER,
    naver_items_json        TEXT,
    sync_status             TEXT,
    last_updated_at         TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS corp_officers (
    corp_code       TEXT PRIMARY KEY,
    bsns_year       INTEGER,
    reprt_code      TEXT,
    items_json      TEXT NOT NULL,
    sync_status     TEXT,
    last_updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS sync_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    finished_at TEXT NOT NULL,
    source_url TEXT,
    target_url TEXT,
    status TEXT NOT NULL,
    tables_synced INTEGER NOT NULL,
    rows_per_table TEXT,
    error_message TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS market_cache (
    ticker TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL,
    fetched_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sync_targets (
    corp_code TEXT PRIMARY KEY,
    added_at TEXT NOT NULL,
    memo TEXT,
    is_active INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS corp_master (
    corp_code TEXT PRIMARY KEY,
    corp_name TEXT,
    stock_code TEXT,
    modify_date TEXT,
    updated_at TEXT NOT NULL
  )`,
];

/** Tables to copy from local to remote (order: index/metas before details). market_cache, sync_targets, corp_master 제외(로컬 전용). */
const SYNCABLE_TABLES = [
  'corp_index',
  'corp_overview',
  'corp_financial_meta',
  'corp_financial_year_status',
  'corp_financial_records',
  'corp_dividend_meta',
  'corp_dividend_yearly',
  'corp_dividend_details',
  'corp_guidance_meta',
  'corp_guidance_items',
  'corp_treasury_meta',
  'corp_treasury_items',
  'corp_treasury_yearly_summary',
  'corp_treasury_fetch_policy',
  'corp_consensus_meta',
  'corp_consensus_items',
  'corp_shareholders',
  'corp_officers',
];

/**
 * 기존 테이블에 신규 컬럼을 추가하는 마이그레이션.
 * SQLite는 ADD COLUMN IF NOT EXISTS를 지원하지 않으므로 오류 발생 시 무시.
 */
const MIGRATION_STATEMENTS = [
  'ALTER TABLE corp_shareholders ADD COLUMN reprt_code TEXT',
  'ALTER TABLE corp_shareholders ADD COLUMN common_treasury_shares INTEGER',
  'ALTER TABLE corp_shareholders ADD COLUMN total_issued_shares INTEGER',
  'ALTER TABLE corp_shareholders ADD COLUMN naver_items_json TEXT',
  'ALTER TABLE corp_shareholders ADD COLUMN sync_status TEXT',
  'ALTER TABLE corp_officers ADD COLUMN sync_status TEXT',
];

async function ensureSchema(client) {
  for (const sql of SCHEMA_STATEMENTS) {
    await client.execute(sql);
  }
  for (const sql of MIGRATION_STATEMENTS) {
    try {
      await client.execute(sql);
    } catch (_) {
      // 컬럼이 이미 존재하면 오류 무시
    }
  }
}

module.exports = {
  ensureSchema,
  SYNCABLE_TABLES,
};
