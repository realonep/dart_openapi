/**
 * Open DART 통합 수집 엔진 V3 (정형 API + 비정형 LLM 하이브리드)
 * - 정형: fnlttSinglAcnt, company.json
 * - 비정형: document.xml → 태그 제거 → LLM 추출 (잠정실적, 가이던스)
 * - 배당: Naver Finance main.naver 스크래핑 (DPS / 배당수익률 / 배당성향)
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const AdmZip = require('adm-zip');
const { requestJson, requestBinary } = require('./utils/opendart-client');
const { readJson, writeJson, ensureDir } = require('./utils/file-utils');
const { sanitizeDocumentToRawText, extractFiguresViaLLM } = require('./utils/llm-extractor');
const { fetchNaverDividendsByTicker } = require('./utils/naver-dividend-client');
const { fetchNaverExtraShareholders } = require('./utils/naver-shareholders-client');
const { createHybridLibsqlClient } = require('./db/libsql-client');
const { ensureSchema } = require('./db/schema');
const corpWriter = require('./db/corp-writer');
const { trace } = require('./utils/trace-log');

const API_BASE = 'https://opendart.fss.or.kr/api';
const BASE_DELAY_MS = 150;
const JITTER_MS = 50;
const PAGE_DELAY_MS = 150;
const SYNC_CORP_CONCURRENCY = Math.max(1, Number(process.env.SYNC_CORP_CONCURRENCY || 2));
const FINANCIAL_YEARS = 6;
const MAX_RETRIES = 3;
/** 자사주 소각 공시 최소 조회 연도 범위 (현재 기준 N년 전까지 소급) */
const TREASURY_MIN_YEARS = 3;
const DART_STATUS_NO_DATA = '013';
const LLM_LOGIC_VERSION = '2026-02-27-v1';
const TREASURY_LOOKBACK_MONTHS = 18;

const REPRT_CODE_ANNUAL = '11011';
const REPRT_CODE_SEMI = '11012';
const REPRT_CODE_Q1 = '11013';
const REPRT_CODE_Q3 = '11014';

// Regex: 공시 제목 필터
const REGEX_PRELIMINARY = /(.*영업실적.*잠정.*실적|잠정\s*실적)/;
const REGEX_TREASURY = /(자기\s*주식|자사주).*(소각)|주식\s*소각\s*결정|자기주식\s*소각/;

// --- Utilities ---

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function smartDelay() {
  return sleep(BASE_DELAY_MS + Math.random() * JITTER_MS);
}

function getConfig() {
  const configPath = path.join(__dirname, '..', 'data', 'meta', 'companies-config.json');
  return readJson(configPath, { target_corps: [] });
}

/** 수집 대상: DB(sync_targets) 우선, 없거나 실패 시 companies-config.json */
async function getTargetCorps(dbClient) {
  if (dbClient) {
    try {
      const result = await dbClient.execute({
        sql: 'SELECT corp_code FROM sync_targets WHERE is_active = 1 ORDER BY added_at',
        args: [],
      });
      const rows = result.rows || [];
      if (rows.length > 0) {
        return rows.map((r) => String(r.corp_code || '').trim()).filter(Boolean);
      }
    } catch (_) {
      /* fallback to JSON */
    }
  }
  const config = getConfig();
  return config.target_corps || [];
}

function getYears() {
  const currentYear = new Date().getFullYear();
  const years = [];
  for (let y = currentYear - (FINANCIAL_YEARS - 1); y <= currentYear; y++) years.push(y);
  return years;
}

/**
 * 오늘 날짜 기준으로, 해당 연도에 대해 "최대 어느 분기까지 나왔을 법한지"를 추정.
 * - '0Q': 아직 어떤 분기도 기대하지 않음
 * - '1Q'~'3Q': 해당 분기까지는 나왔을 수 있음
 * - '4Q': 결산/연간까지 나왔을 법함
 */
function expectedMaxQuarterForYear(year) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const month = now.getMonth(); // 0=Jan
  const day = now.getDate();

  // 오래된 연도: 이미 결산까지 다 나왔다고 간주
  if (year < currentYear - 1) return '4Q';
  // 미래 연도: 아직 아무 분기도 기대하지 않음
  if (year > currentYear) return '0Q';

  // 현재 연도: 공시 마감 시점을 기준으로 보수적으로 판단
  if (year === currentYear) {
    // 1Q: 보통 5월 중순 이후 (대략 5/15)
    if (month < 4 || (month === 4 && day < 15)) return '0Q';
    // 2Q(반기): 8월 중순 이후
    if (month < 7 || (month === 7 && day < 15)) return '1Q';
    // 3Q: 11월 중순 이후
    if (month < 10 || (month === 10 && day < 15)) return '2Q';
    // 연말 전까지는 3Q까지만 기대
    return '3Q';
  }

  // year === currentYear - 1: 직전 연도
  // 다음 해 3월 말 전까지는 4Q/사업보고서가 없을 수 있으므로 3Q까지만 기대
  if (month < 2 || (month === 2 && day < 31)) return '3Q';
  return '4Q';
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function yyyymmddMonthsAgo(months) {
  const d = new Date();
  d.setMonth(d.getMonth() - Number(months || 0));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function logJsonApi(tag, corpCode, params, raw) {
  const year = params?.bsns_year || '-';
  const reprt = params?.reprt_code || '-';
  const fsDiv = params?.fs_div || '-';
  const page = params?.page_no || '-';
  const count = Array.isArray(raw?.list) ? raw.list.length : 0;
  const status = raw?.status ?? 'null';
  console.log(`  [${tag}/API] corp=${corpCode} year=${year} reprt=${reprt} fs_div=${fsDiv} page=${page} status=${status} count=${count}`);
}

function logBinaryApi(tag, corpCode, rceptNo, buffer) {
  const size = buffer?.length || 0;
  const okZip = !!(buffer && buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b);
  console.log(`  [${tag}/API] corp=${corpCode} rcept_no=${rceptNo || '-'} status=${okZip ? '000' : 'error'} bytes=${size}`);
}

/** list.json 응답에서 정규식으로 필터 */
function filterDisclosures(list, regex) {
  if (!Array.isArray(list)) return [];
  return list.filter((item) => regex.test(item.report_nm || '')).map((item) => ({
    rcept_no: item.rcept_no,
    report_nm: item.report_nm,
    rcept_dt: item.rcept_dt,
  }));
}

/** 공시 제목 또는 접수일에서 사업연도 추출 (배당 소속 연도). */
function extractYearFromReport(reportNm, rceptDt) {
  const s = String(reportNm || '') + String(rceptDt || '');
  const matches = s.match(/\b(20\d{2})\b/g);
  if (matches && matches.length) {
    return Math.max(...matches.map((m) => parseInt(m, 10)));
  }
  // fallback: rcept_dt like YYYYMMDD has no word boundary between year/month
  const compactDates = s.match(/20\d{6}/g);
  if (compactDates && compactDates.length) {
    return Math.max(...compactDates.map((d) => parseInt(String(d).slice(0, 4), 10)));
  }
  return null;
}


// --- 수시공시 배당: document API ZIP 파싱 ---

/**
 * ZIP 버퍼에서 첫 XML/HTML 항목 텍스트 추출 (UTF-8 또는 EUC-KR 시도).
 * @param {Buffer} zipBuffer
 * @returns {string}
 */
function extractTextFromDocumentZip(zipBuffer) {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();
  const xmlEntry = entries.find((e) => !e.isDirectory && /\.(xml|htm|html)$/i.test(e.entryName));
  if (!xmlEntry) return '';
  const raw = xmlEntry.getData();
  try {
    return raw.toString('utf8');
  } catch (_) {
    try {
      return raw.toString('euc-kr');
    } catch (__) {
      return raw.toString('utf8', 'ignore');
    }
  }
}

/** 공시 제목·접수일에서 분기 라벨 추출 (예: 2025.4Q). */
function getPeriodLabel(reportNm, rceptDt) {
  const y = extractYearFromReport(reportNm, rceptDt);
  if (y == null) return null;
  const n = String(reportNm || '');
  if (/4\s*분기|제4분기|4Q|결산|사업\s*연도|연간/i.test(n)) return `${y}.4Q`;
  if (/3\s*분기|제3분기|3Q/i.test(n)) return `${y}.3Q`;
  if (/2\s*분기|제2분기|2Q|반기|중간/i.test(n)) return `${y}.2Q`;
  if (/1\s*분기|제1분기|1Q/i.test(n)) return `${y}.1Q`;
  // 제목에 분기 정보가 없는 잠정실적 공시는 접수월 기준으로 분기를 추정한다.
  // Jan: 전년도 4Q, Apr: 당해 1Q, Jul: 당해 2Q, Oct: 당해 3Q
  const dt = String(rceptDt || '').replace(/[^0-9]/g, '');
  if (dt.length >= 6) {
    const yy = Number(dt.slice(0, 4));
    const mm = Number(dt.slice(4, 6));
    if (Number.isFinite(yy) && Number.isFinite(mm)) {
      if (mm <= 3) return `${yy - 1}.4Q`;
      if (mm <= 6) return `${yy}.1Q`;
      if (mm <= 9) return `${yy}.2Q`;
      return `${yy}.3Q`;
    }
  }
  return `${y}.4Q`;
}

function periodKeyFromLabel(periodLabel) {
  if (!periodLabel) return null;
  const m = String(periodLabel).match(/(20\d{2})\.([1-4])Q/i);
  if (!m) return null;
  return Number(m[1]) * 10 + Number(m[2]);
}

function getLatestFinancialPeriodKey(financials) {
  if (!financials || !Array.isArray(financials.items)) return null;
  let maxKey = null;
  for (const item of financials.items) {
    const y = Number(item?.year);
    if (!Number.isFinite(y)) continue;
    if (item.annual) {
      const k = y * 10 + 4;
      if (maxKey == null || k > maxKey) maxKey = k;
    }
    const qs = item.quarters || {};
    for (const [qLabel, qVal] of Object.entries(qs)) {
      if (!qVal) continue;
      const m = String(qLabel).match(/([1-4])Q/i);
      if (!m) continue;
      const k = y * 10 + Number(m[1]);
      if (maxKey == null || k > maxKey) maxKey = k;
    }
  }
  return maxKey;
}


// --- list.json (비정형 파이프라인 통합 수집기) ---
async function fetchUnstructuredDisclosuresIntegrated(corpCode, apiKey, options = {}) {
  const {
    needGuidance = true,
    needTreasury = true,
    latestFinancialPeriodKey = null,
    treasuryMinYear = null,
    treasuryLookbackMonths = TREASURY_LOOKBACK_MONTHS,
  } = options;
  const endDe = today().replace(/-/g, '');
  const bgnDe = `${new Date().getFullYear() - 1}0101`;
  const pageCount = 100;
  const nowYear = new Date().getFullYear();
  const guidance = { done: !needGuidance, items: [], seen: new Set() };
  const treasury = { done: !needTreasury, items: [], seen: new Set() };
  const guidanceScanLimit = MAX_GUIDANCE_ITEMS * 6;
  const treasuryCutoffYmd = yyyymmddMonthsAgo(treasuryLookbackMonths);
  const stopTreasuryBeforeYear = Number.isFinite(treasuryMinYear)
    ? Number(treasuryMinYear)
    : (nowYear - (TREASURY_MIN_YEARS - 1));
  const isAllDone = () => guidance.done && treasury.done;

  let totalPage = 1;
  let lastErr;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      for (let pageNo = 1; pageNo <= totalPage; pageNo++) {
        const params = {
          corp_code: corpCode,
          bgn_de: bgnDe,
          end_de: endDe,
          page_no: String(pageNo),
          page_count: String(pageCount),
        };
        const raw = await requestJson(`${API_BASE}/list.json`, params, apiKey);
        logJsonApi('DisclosureList', corpCode, params, raw);
        await smartDelay();
        if (raw && raw.status === DART_STATUS_NO_DATA && pageNo === 1) {
          return {
            guidance: guidance.items,
            treasury: treasury.items,
            meta: {
              treasury_lookback_months: treasuryLookbackMonths,
              treasury_cutoff_rcept_dt: treasuryCutoffYmd,
            },
          };
        }
        if (!raw || raw.status !== '000') {
          lastErr = new Error(raw?.message || 'list.json failed');
          break;
        }

        if (Array.isArray(raw.list) && raw.list.length) {
          for (const item of raw.list) {
            const rceptNo = item.rcept_no;
            const reportNm = item.report_nm || '';
            const rceptDt = item.rcept_dt || '';
            if (!rceptNo) continue;

            if (!guidance.done && isGuidancePerformanceTitle(reportNm) && !guidance.seen.has(rceptNo)) {
              const periodLabel = getPeriodLabel(reportNm, rceptDt);
              const periodKey = periodKeyFromLabel(periodLabel);
              if (latestFinancialPeriodKey != null && periodKey != null && periodKey <= latestFinancialPeriodKey) {
                guidance.done = true;
              } else {
                guidance.seen.add(rceptNo);
                guidance.items.push({
                  rcept_no: rceptNo,
                  report_nm: reportNm,
                  rcept_dt: rceptDt,
                });
                if (guidance.items.length >= guidanceScanLimit) guidance.done = true;
              }
            }

            if (!treasury.done && REGEX_TREASURY.test(reportNm) && !treasury.seen.has(rceptNo)) {
              const y = extractYearFromReport(reportNm, rceptDt);
              if (y != null && y >= stopTreasuryBeforeYear && y <= nowYear && (!rceptDt || rceptDt >= treasuryCutoffYmd)) {
                treasury.seen.add(rceptNo);
                treasury.items.push({
                  rcept_no: rceptNo,
                  report_nm: reportNm,
                  rcept_dt: rceptDt,
                });
                if (treasury.items.length >= MAX_TREASURY_ITEMS) treasury.done = true;
              }
            }
          }
        }

        if (pageNo === 1) {
          if (raw.total_page != null) totalPage = Math.max(1, parseInt(String(raw.total_page), 10) || 1);
          else if (raw.total_count != null) totalPage = Math.max(1, Math.ceil(Number(raw.total_count) / pageCount));
        }

        if (!treasury.done && Number.isFinite(stopTreasuryBeforeYear) && Array.isArray(raw.list) && raw.list.length) {
          const last = raw.list[raw.list.length - 1];
          const lastYear = extractYearFromReport(last?.report_nm, last?.rcept_dt);
          const lastDt = String(last?.rcept_dt || '');
          if (lastYear != null && lastYear < stopTreasuryBeforeYear) treasury.done = true;
          if (lastDt && lastDt < treasuryCutoffYmd) treasury.done = true;
        }

        if (isAllDone()) {
          return {
            guidance: guidance.items,
            treasury: treasury.items,
            meta: {
              treasury_lookback_months: treasuryLookbackMonths,
              treasury_cutoff_rcept_dt: treasuryCutoffYmd,
            },
          };
        }
        if (pageNo < totalPage) await sleep(PAGE_DELAY_MS);
      }
      if (lastErr) throw lastErr;
      return {
        guidance: guidance.items,
        treasury: treasury.items,
        meta: {
          treasury_lookback_months: treasuryLookbackMonths,
          treasury_cutoff_rcept_dt: treasuryCutoffYmd,
        },
      };
    } catch (e) {
      lastErr = e;
    }
    if (attempt < MAX_RETRIES - 1) await sleep(BASE_DELAY_MS * Math.pow(2, attempt + 1));
  }
  if (lastErr) throw lastErr;
  return {
    guidance: guidance.items,
    treasury: treasury.items,
    meta: {
      treasury_lookback_months: treasuryLookbackMonths,
      treasury_cutoff_rcept_dt: treasuryCutoffYmd,
    },
  };
}

// --- 정형: 재무제표 API (DART JSON 그대로 사용, 단위 변환 없음) ---

function parseAmount(str) {
  if (str == null) return null;
  const s = String(str).replace(/,/g, '').trim();
  if (s === '' || s === '-' || s === '0') return null;
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

function findAccount(list, matcher) {
  return list.find((item) => {
    const id = (item.account_id || '').toLowerCase();
    const nm = (item.account_nm || '').toLowerCase();
    return matcher(id, nm);
  });
}

function findAccountByPriority(list, rules, logLabel = '') {
  if (!Array.isArray(list) || !list.length || !Array.isArray(rules) || !rules.length) return null;
  for (const rule of rules) {
    const matched = list.filter((item) => {
      const id = (item.account_id || '').toLowerCase();
      const nm = (item.account_nm || '').toLowerCase();
      return rule.match(id, nm, item);
    });
    if (matched.length > 1 && logLabel) {
      const names = matched.slice(0, 3).map((x) => x.account_nm || '-').join(' | ');
      console.log(`  [Financials/CF-MATCH] ${logLabel}: multiple(${matched.length}) by ${rule.name}. pick=${matched[0].account_nm || '-'} candidates=${names}`);
    }
    if (matched.length) return matched[0];
  }
  return null;
}

function preferIncomeStatement(list) {
  if (!Array.isArray(list) || !list.length) return [];
  const isOrCis = list.filter((x) => ['IS', 'CIS'].includes(String(x.sj_div || '').toUpperCase()));
  return isOrCis.length ? isOrCis : list;
}

function getIncomeAmount(item, useCumulative) {
  if (!item) return null;
  if (useCumulative) {
    const cumulative = parseAmount(item.thstrm_add_amount);
    if (cumulative != null) return cumulative;
  }
  return parseAmount(item.thstrm_amount);
}

function preferCashflowStatement(list) {
  if (!Array.isArray(list) || !list.length) return [];
  const cfOnly = list.filter((x) => String(x.sj_div || '').toUpperCase() === 'CF');
  return cfOnly.length ? cfOnly : list;
}

function getCashflowAmount(item, useCumulative) {
  if (!item) return null;
  if (useCumulative) {
    const cumulative = parseAmount(item.thstrm_add_amount);
    if (cumulative != null) return cumulative;
  }
  return parseAmount(item.thstrm_amount);
}

function filterByFsDiv(rawList, preferred = 'cfs') {
  const lower = String(preferred || '').toLowerCase();
  const hasPreferred = rawList.some((x) => String(x.fs_div || '').toLowerCase() === lower);
  if (hasPreferred) return rawList.filter((x) => String(x.fs_div || '').toLowerCase() === lower);
  const firstDiv = String(rawList[0]?.fs_div || '').toLowerCase();
  return rawList.filter((x) => String(x.fs_div || '').toLowerCase() === firstDiv);
}

function toIndicators(rawList, year, meta = {}) {
  if (!Array.isArray(rawList) || !rawList.length) return null;
  const preferredFs = (meta.fs_div && String(meta.fs_div).toLowerCase()) || 'cfs';
  const scoped = filterByFsDiv(rawList, preferredFs);
  const incomeScoped = preferIncomeStatement(scoped);
  const cfScoped = preferCashflowStatement(scoped);
  const useCumulative = meta.reprt_code && meta.reprt_code !== REPRT_CODE_ANNUAL;

  const revenueItem =
    findAccount(incomeScoped, (id) => id === 'ifrs-full_revenue' || id === 'ifrs-full_revenuefromcontractswithcustomers') ||
    findAccount(incomeScoped, (id) => id.includes('revenue')) ||
    findAccount(incomeScoped, (id, nm) => nm.includes('매출액') || nm.includes('수익'));
  const opIncomeItem =
    findAccount(incomeScoped, (id) => id === 'ifrs-full_profitlossfromoperatingactivities') ||
    findAccount(incomeScoped, (id) => id.includes('operatingincomeloss')) ||
    findAccount(incomeScoped, (id, nm) => nm.includes('영업이익') || nm.includes('영업손익'));
  const netIncomeItem =
    findAccount(incomeScoped, (id) => id === 'ifrs-full_profitloss') ||
    findAccount(incomeScoped, (id) => id.includes('profitloss')) ||
    findAccount(incomeScoped, (id, nm) => nm.includes('당기순이익') || nm.includes('분기순이익'));
  const totalAssetsItem =
    findAccount(scoped, (id) => id === 'ifrs-full_assets') ||
    findAccount(scoped, (id) => id.includes('assets') && !id.includes('current')) ||
    findAccount(scoped, (id, nm) => nm.includes('자산총계'));
  const liabilitiesItem =
    findAccount(scoped, (id) => id === 'ifrs-full_liabilities') ||
    findAccount(scoped, (id) => id.includes('liabilities') && !id.includes('current')) ||
    findAccount(scoped, (id, nm) => nm.includes('부채총계'));
  const equityItem =
    findAccount(scoped, (id) => id === 'ifrs-full_equity') ||
    findAccount(scoped, (id) => id.includes('equity')) ||
    findAccount(scoped, (id, nm) => nm.includes('자본총계') || nm.includes('지배기업 소유주지분'));

  const operatingCfItem =
    findAccount(cfScoped, (id) => id === 'ifrs-full_cashflowsfromusedinoperatingactivities') ||
    findAccount(cfScoped, (id) => id === 'ifrs-full_netcashflowsfromusedinoperatingactivities') ||
    findAccount(cfScoped, (id) => id === 'ifrs-full_cashflowsfromusedinoperatingactivitiescontinuingoperations') ||
    findAccount(cfScoped, (id, nm) => nm.includes('영업활동으로 인한 현금흐름') || nm.includes('영업활동현금흐름'));
  const capexPpeItem =
    findAccount(cfScoped, (id) => id === 'ifrs-full_purchaseofpropertyplantandequipment') ||
    findAccount(cfScoped, (id) => id === 'ifrs-full_acquisitionofpropertyplantandequipment') ||
    findAccount(cfScoped, (id, nm) => nm.includes('유형자산') && nm.includes('취득'));
  const capexIntangibleItem =
    findAccount(cfScoped, (id) => id === 'ifrs-full_purchaseofintangibleassets') ||
    findAccount(cfScoped, (id) => id === 'ifrs-full_acquisitionofintangibleassets') ||
    findAccount(cfScoped, (id, nm) => nm.includes('무형자산') && nm.includes('취득'));
  const nonCashAdjustmentsItem = findAccountByPriority(cfScoped, [
    {
      name: 'id_exact_ifrs',
      match: (id) => id === 'ifrs-full_adjustmentsforreconcileprofitloss',
    },
    {
      name: 'id_contains_reconcile',
      match: (id) => id.includes('adjustmentsforreconcileprofitloss'),
    },
    {
      name: 'name_non_cash_adjust',
      match: (_id, nm) => nm.includes('비현금') && nm.includes('조정'),
    },
    {
      name: 'name_profitloss_adjust',
      match: (_id, nm) => nm.includes('손익') && nm.includes('조정'),
    },
    {
      // legacy fallback: only accept plain "조정" when account_id is missing/non-standard
      name: 'name_exact_adjust_legacy',
      match: (id, nm) => nm.trim() === '조정' && (!id || id === '-표준계정코드 미사용-'.toLowerCase()),
    },
  ], `non_cash_adjustments y=${year} fs=${String(meta.fs_div || '').toUpperCase()}`);
  const workingCapitalChangeItem = findAccountByPriority(cfScoped, [
    {
      name: 'id_exact_dart',
      match: (id) => id === 'dart_adjustmentsforassetsliabilitiesofoperatingactivities',
    },
    {
      name: 'id_contains_assets_liabilities',
      match: (id) => id.includes('adjustmentsforassetsliabilitiesofoperatingactivities'),
    },
    {
      name: 'name_working_capital_change',
      match: (_id, nm) => nm.includes('운전자본') && nm.includes('변동'),
    },
    {
      name: 'name_operating_assets_liabilities_change',
      match: (_id, nm) => nm.includes('영업활동') && nm.includes('자산부채') && nm.includes('변동'),
    },
    {
      name: 'name_operating_assets_liabilities_delta',
      match: (_id, nm) => nm.includes('영업활동') && nm.includes('자산') && nm.includes('부채') && nm.includes('증감'),
    },
  ], `working_capital_change y=${year} fs=${String(meta.fs_div || '').toUpperCase()}`);
  const revenue = getIncomeAmount(revenueItem, useCumulative);
  const opIncome = getIncomeAmount(opIncomeItem, useCumulative);
  const netIncome = getIncomeAmount(netIncomeItem, useCumulative);
  const totalAssets = totalAssetsItem ? parseAmount(totalAssetsItem.thstrm_amount) : null;
  const liabilities = liabilitiesItem ? parseAmount(liabilitiesItem.thstrm_amount) : null;
  const equity = equityItem ? parseAmount(equityItem.thstrm_amount) : null;
  const operatingCf = getCashflowAmount(operatingCfItem, useCumulative);
  const capexPpe = getCashflowAmount(capexPpeItem, useCumulative);
  const capexIntangible = getCashflowAmount(capexIntangibleItem, useCumulative);
  const nonCashAdjustments = getCashflowAmount(nonCashAdjustmentsItem, useCumulative);
  const workingCapitalChange = getCashflowAmount(workingCapitalChangeItem, useCumulative);
  const capexTotal = (capexPpe == null && capexIntangible == null)
    ? null
    : Math.abs(capexPpe || 0) + Math.abs(capexIntangible || 0);
  const fcf = operatingCf != null && capexTotal != null
    ? operatingCf - capexTotal
    : null;
  const roe = equity && netIncome != null ? (netIncome / equity) * 100 : null;
  const roa = totalAssets && netIncome != null ? (netIncome / totalAssets) * 100 : null;
  const debtRatio = equity && liabilities != null ? (liabilities / equity) * 100 : null;

  const fsDiv = meta.fs_div || (scoped.length && scoped[0].fs_div) || null;
  const { reprt_code: _reprtCode, ...safeMeta } = meta;
  return {
    year,
    quarter: null,
    revenue,
    op_income: opIncome,
    net_income: netIncome,
    equity,
    total_assets: totalAssets,
    debt: liabilities,
    operating_cf: operatingCf,
    non_cash_adjustments: nonCashAdjustments,
    working_capital_change: workingCapitalChange,
    capex_ppe: capexPpe,
    capex_intangible: capexIntangible,
    capex_total: capexTotal,
    fcf,
    roe,
    roa,
    debt_ratio: debtRatio,
    ...safeMeta,
    ...(fsDiv ? { fs_div: String(fsDiv).toUpperCase() } : {}),
  };
}

const NUMERIC_KEYS = [
  'revenue',
  'op_income',
  'net_income',
  'equity',
  'total_assets',
  'debt',
  'operating_cf',
  'non_cash_adjustments',
  'working_capital_change',
  'capex_ppe',
  'capex_intangible',
  'capex_total',
  'fcf',
  'roe',
  'roa',
  'debt_ratio',
];

function subtractIndicators(a, b) {
  if (!a || !b) return null;
  const out = { year: a.year, quarter: null };
  for (const key of NUMERIC_KEYS) {
    const va = a[key];
    const vb = b[key];
    if (va == null || vb == null) out[key] = null;
    else out[key] = va - vb;
  }
  return out;
}


// --- 정형: company / fnlttSinglAcnt / alotMatter (파싱·단위 변환 없음) ---

async function fetchOverview(corpCode, apiKey) {
  const params = { corp_code: corpCode };
  const raw = await requestJson(`${API_BASE}/company.json`, params, apiKey);
  logJsonApi('Overview', corpCode, params, raw);
  return raw;
}

// --- 스마트 보고서 코드 선택 ---

/**
 * 현재 월 기준으로 DART 보고서 탐색 우선순위 [(year, reprtCode), ...] 반환.
 * 제출 시차를 고려하여 가장 최신 데이터가 있을 가능성이 높은 순서로 정렬.
 *   1-3월  : 작년 사업·3Q·반기 순
 *   4-5월  : 올해 1Q → 작년 사업 순
 *   6-8월  : 올해 반기 → 1Q → 작년 사업 순
 *   9-12월 : 올해 3Q → 반기 → 1Q 순
 */
function getSmartReportCodes() {
  const now = new Date();
  const yr = now.getFullYear();
  const mo = now.getMonth() + 1;
  // 각 구간 마지막에 전년도 사업보고서를 최종 폴백으로 추가.
  // 1-3월: 전년(yr-1) 보고서가 아직 미제출일 수 있으므로 yr-2 연간도 포함.
  if (mo <= 3)  return [[yr - 1, '11011'], [yr - 1, '11014'], [yr - 1, '11012'], [yr - 2, '11011']];
  if (mo <= 5)  return [[yr, '11013'], [yr - 1, '11011'], [yr - 2, '11011']];
  if (mo <= 8)  return [[yr, '11012'], [yr, '11013'], [yr - 1, '11011'], [yr - 2, '11011']];
  /* 9-12 */    return [[yr, '11014'], [yr, '11012'], [yr, '11013'], [yr - 1, '11011']];
}

/**
 * getSmartReportCodes()의 순서대로 DART API를 시도하다 status=000이면 즉시 반환.
 * @param {string} apiPath  - e.g. 'hyslrSttus.json'
 * @param {object} baseParams - corp_code 등 (bsns_year, reprt_code는 자동 주입)
 * @param {string} apiKey
 * @param {Function} transform - (list, year, reprtCode) => result | null
 */
async function trySmartReportCodes(apiPath, baseParams, apiKey, transform) {
  for (const [year, reprtCode] of getSmartReportCodes()) {
    try {
      const params = { ...baseParams, bsns_year: String(year), reprt_code: reprtCode };
      const raw = await requestJson(`${API_BASE}/${apiPath}`, params, apiKey);
      logJsonApi(apiPath, baseParams.corp_code || '', params, raw);
      if (!raw || raw.status !== '000' || !Array.isArray(raw.list) || raw.list.length === 0) {
        await smartDelay();
        continue;
      }
      const result = transform(raw.list, year, reprtCode);
      if (result !== null) return result;
      await smartDelay();
    } catch (_) {
      await smartDelay();
    }
  }
  return null;
}

/**
 * 최대주주 현황 (hyslrSttus.json).
 * 보통주만 집계, 이름별 지분율 합산, 합계행 제외, 상위 3명 반환.
 */
function parseShareholders(list, year, reprtCode) {
  // 보통주·의결권있는주식 허용, 우선주·무의결·종류주식 제외
  const commonList = list.filter((r) => {
    const knd = String(r.stock_knd || '').trim();
    if (!knd || knd === '-') return true;
    if (knd.includes('우선') || knd.includes('무의결') || knd.includes('종류')) return false;
    return true;
  });
  if (commonList.length === 0) return null;

  const SUMMARY_NAMES = new Set(['계', '합계', 'total', '-']);
  const map = new Map();
  for (const r of commonList) {
    const nm = String(r.nm || '').trim();
    if (!nm || nm === '-' || SUMMARY_NAMES.has(nm.toLowerCase())) continue;
    const rt = parseFloat(r.trmend_posesn_stock_qota_rt) || 0;
    const shares = parseInt(String(r.trmend_posesn_stock_co || '').replace(/,/g, ''), 10) || 0;
    const relation = String(r.relate || '').trim();
    if (map.has(nm)) {
      const prev = map.get(nm);
      map.set(nm, { ...prev, ratio: prev.ratio + rt, shares: prev.shares + shares });
    } else {
      map.set(nm, { nm, ratio: rt, shares, relation });
    }
  }

  const items = Array.from(map.values())
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 3)
    .map(({ nm, ratio, shares, relation }) => ({
      nm,
      ratio: Math.round(ratio * 100) / 100,
      shares,
      relation,
    }));

  if (items.length === 0) return null;
  return { bsns_year: year, reprt_code: reprtCode, items, last_updated_at: today() };
}

async function fetchShareholders(corpCode, apiKey) {
  return trySmartReportCodes('hyslrSttus.json', { corp_code: corpCode }, apiKey, parseShareholders);
}

/**
 * 임원 현황 (exctvSttus.json).
 * 전체 임원 목록 추출. 이름·직위·담당업무·등기여부·상근여부·출생년월·성별·최대주주관계·재직기간·임기만료일 포함.
 */
function parseOfficers(list, year, reprtCode) {
  if (!list || list.length === 0) return null;

  const items = list.map((r) => ({
    nm:                    String(r.nm || '').trim(),
    ofcps:                 String(r.ofcps || '').trim(),
    chrg_job:              String(r.chrg_job || '').trim(),
    main_career:           String(r.main_career || '').trim(),
    rgist_exctv_at:        String(r.rgist_exctv_at || '').trim(),
    fte_at:                String(r.fte_at || '').trim(),
    birth_ym:              String(r.birth_ym || '').trim(),
    sexdstn:               String(r.sexdstn || '').trim(),
    mxmm_shrholdr_relate:  String(r.mxmm_shrholdr_relate || '').trim(),
    hffc_pd:               String(r.hffc_pd || '').trim(),
    tenure_end_on:         String(r.tenure_end_on || '').trim(),
  })).filter((it) => it.nm && it.nm !== '-');

  if (items.length === 0) return null;
  return { bsns_year: year, reprt_code: reprtCode, items, last_updated_at: today() };
}

async function fetchOfficers(corpCode, apiKey) {
  return trySmartReportCodes('exctvSttus.json', { corp_code: corpCode }, apiKey, parseOfficers);
}

/**
 * 주식의 총수 (stockTotqySttus.json).
 * 보통주 행에서 자기주식수(tesst_totqy) 추출.
 */
function parseTotalStock(list, year, reprtCode) {
  const common = list.find((r) => String(r.se || '').trim() === '보통주');
  if (!common) return null;
  const rawTreasury = String(common.tesst_totqy || common.tesstk_co || '').replace(/,/g, '');
  const treasuryShares = parseInt(rawTreasury, 10);
  if (!Number.isFinite(treasuryShares)) return null;
  const rawIssued = String(common.istc_totqy || '').replace(/,/g, '');
  const totalIssuedShares = parseInt(rawIssued, 10);
  return {
    bsns_year: year,
    reprt_code: reprtCode,
    common_treasury_shares: treasuryShares,
    total_issued_shares: Number.isFinite(totalIssuedShares) ? totalIssuedShares : null,
  };
}

async function fetchTotalStock(corpCode, apiKey) {
  return trySmartReportCodes('stockTotqySttus.json', { corp_code: corpCode }, apiKey, parseTotalStock);
}

/** 정형 재무 API: CFS·OFS 각각 조회. 원(KRW) 단위 정규화 로직 미적용. */
async function fetchFinancialReport(corpCode, year, reprtCode, apiKey) {
  const source = reprtCode === REPRT_CODE_ANNUAL ? 'Annual Report' : 'Quarterly';
  const meta = { status: 'confirmed', source };

  async function fetchOne(fsDiv) {
    try {
      const params = {
        corp_code: corpCode,
        bsns_year: String(year),
        reprt_code: reprtCode,
        fs_div: fsDiv,
      };
      const raw = await requestJson(`${API_BASE}/fnlttSinglAcntAll.json`, params, apiKey);
      logJsonApi('Financials', corpCode, params, raw);
      if (!raw || raw.status !== '000' || !Array.isArray(raw.list) || !raw.list.length) return null;
      return toIndicators(raw.list, year, { ...meta, fs_div: fsDiv, reprt_code: reprtCode });
    } catch (_) {
      console.log(`  [Financials/API] corp=${corpCode} year=${year} reprt=${reprtCode} fs_div=${fsDiv} page=- status=error count=0`);
      return null;
    }
  }

  const cfs = await fetchOne('CFS');
  await smartDelay();
  const ofs = await fetchOne('OFS');
  const hasData = cfs != null || ofs != null;
  return {
    reprtCode,
    cfs: cfs || null,
    ofs: ofs || null,
    status: hasData ? 'ok' : 'no_data',
  };
}

/** guidance 공시만 대상으로 최신 2건 상세 파싱. items 최대 2개. */
const MAX_GUIDANCE_ITEMS = 2;
const MAX_TREASURY_ITEMS = 40;

async function fetchGuidanceWithDetails(guidanceDisclosures, apiKey, corpCode = '-') {
  const seen = new Set();
  const merged = [];
  const add = (list) => {
    if (!Array.isArray(list)) return;
    for (const d of list) {
      if (!d.rcept_no || seen.has(d.rcept_no)) continue;
      seen.add(d.rcept_no);
      merged.push({
        rcept_no: d.rcept_no,
        report_nm: d.report_nm,
        rcept_dt: d.rcept_dt,
        status: 'preliminary',
        source: 'Disclosure',
        report_kind: 'guidance',
      });
    }
  };
  add(guidanceDisclosures);

  merged.sort((a, b) => (b.rcept_dt || '').localeCompare(a.rcept_dt || ''));
  const toFetch = merged.slice(0, MAX_GUIDANCE_ITEMS * 6);
  for (const item of toFetch) {
    try {
      await smartDelay();
      const zipBuffer = await requestBinary(`${API_BASE}/document.xml`, { rcept_no: item.rcept_no }, apiKey);
      logBinaryApi('GuidanceDocument', corpCode, item.rcept_no, zipBuffer);
      if (!zipBuffer || zipBuffer.length < 100 || zipBuffer[0] !== 0x50 || zipBuffer[1] !== 0x4b) continue;
      const text = extractTextFromDocumentZip(zipBuffer);
      const raw = sanitizeDocumentToRawText(text);
      const figures = await extractFiguresViaLLM(raw);
      const hasAny = figures.revenue != null || figures.op_income != null || figures.net_income != null || figures.dividend_per_share != null;
      const periodLabel = figures.period_label || getPeriodLabel(item.report_nm, item.rcept_dt) || undefined;
      if (hasAny) {
        item.values = {
          revenue: figures.revenue != null && Number.isFinite(figures.revenue) ? Number(figures.revenue) : null,
          op_income: figures.op_income != null && Number.isFinite(figures.op_income) ? Number(figures.op_income) : null,
          net_income: figures.net_income != null && Number.isFinite(figures.net_income) ? Number(figures.net_income) : null,
          cash_dividend_per_share: figures.dividend_per_share != null && Number.isFinite(figures.dividend_per_share) ? Number(figures.dividend_per_share) : null,
        };
        item.period_label = periodLabel;
      }
    } catch (_) {
      /* skip failed document */
    }
  }
  const byPeriod = new Map();
  for (const item of toFetch) {
    const periodLabel = item.period_label || getPeriodLabel(item.report_nm, item.rcept_dt) || 'unknown';
    const prev = byPeriod.get(periodLabel);
    if (!prev) {
      byPeriod.set(periodLabel, item);
      continue;
    }
    const a = String(item.rcept_dt || '');
    const b = String(prev.rcept_dt || '');
    if (a > b) byPeriod.set(periodLabel, item);
  }
  const deduped = Array.from(byPeriod.values())
    .sort((a, b) => (b.rcept_dt || '').localeCompare(a.rcept_dt || ''))
    .slice(0, MAX_GUIDANCE_ITEMS);
  return deduped;
}

function isGuidancePerformanceTitle(reportNm) {
  const n = String(reportNm || '');
  const include = /영업실적|잠정\s*실적|연결재무제표기준영업\(잠정\)실적/i;
  const exclude = /장래사업|경영계획|투자계획|사업계획/i;
  return include.test(n) && !exclude.test(n);
}

function detectUnitMultiplier(text) {
  const s = String(text || '');
  if (/단위\s*[:：]?\s*조원/i.test(s)) return 1_000_000_000_000;
  if (/단위\s*[:：]?\s*억원/i.test(s)) return 100_000_000;
  if (/단위\s*[:：]?\s*백만원/i.test(s)) return 1_000_000;
  if (/단위\s*[:：]?\s*천원/i.test(s)) return 1_000;
  return 1;
}

function parseNumericToken(token) {
  if (token == null) return null;
  const n = Number(String(token).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function firstMatchNumber(text, regexes) {
  for (const re of regexes) {
    const m = String(text || '').match(re);
    if (!m || m[1] == null) continue;
    const n = parseNumericToken(m[1]);
    if (n != null) return n;
  }
  return null;
}

function parseTreasuryFromDocumentText(text, reportNm, rceptDt, rceptNo) {
  const year = extractYearFromReport(reportNm, rceptDt);
  if (year == null) return null;
  const unit = detectUnitMultiplier(text);
  const ordinaryShares = firstMatchNumber(text, [
    /보통주식\s*\(주\)\s*([\d,]+)/i,
    /보통주(?:식)?\s*[:：]?\s*([\d,]+)/i,
  ]);
  const preferredShares = firstMatchNumber(text, [
    /종류주식\s*\(주\)\s*([\d,]+)/i,
    /우선주(?:식)?\s*[:：]?\s*([\d,]+)/i,
  ]);
  const sharesRaw = (ordinaryShares != null || preferredShares != null)
    ? Number(ordinaryShares || 0) + Number(preferredShares || 0)
    : firstMatchNumber(text, [
      /소각(?:할|예정|완료)?\s*주식(?:의)?\s*(?:총수|수량|수)?\s*[:：]?\s*([\d,]+)/i,
      /소각\s*주식수\s*[:：]?\s*([\d,]+)/i,
      /자기\s*주식\s*소각\s*[:：]?\s*([\d,]+)/i,
    ]);
  const amountRaw = firstMatchNumber(text, [
    /소각(?:할|예정|완료)?\s*(?:금액|대금|가액(?:총액)?)\s*(?:\([^)]+\))?\s*[:：]?\s*([\d,\.]+)/i,
    /취득가액(?:총액)?\s*(?:\([^)]+\))?\s*[:：]?\s*([\d,\.]+)/i,
    /총\s*소각금액\s*(?:\([^)]+\))?\s*[:：]?\s*([\d,\.]+)/i,
  ]);
  if (sharesRaw == null && amountRaw == null) return null;
  const eventType = /완료|종료|결과/.test(String(reportNm || '')) ? 'completion' : 'decision';
  return {
    year,
    rcept_no: rceptNo,
    report_nm: reportNm || '',
    rcept_dt: rceptDt || '',
    event_type: eventType,
    retired_shares: sharesRaw != null ? Math.round(sharesRaw) : null,
    retired_amount: amountRaw != null ? Math.round(amountRaw * unit) : null,
    status: 'confirmed',
    source: 'Disclosure',
    confidence: amountRaw != null || sharesRaw != null ? 'medium' : 'low',
  };
}

function buildTreasuryYearlySummary(items) {
  const byYear = new Map();
  for (const it of items || []) {
    if (!it || it.year == null) continue;
    if (!byYear.has(it.year)) byYear.set(it.year, []);
    byYear.get(it.year).push(it);
  }
  const out = [];
  for (const [year, list] of byYear.entries()) {
    const completion = list.filter((x) => x.event_type === 'completion');
    const source = completion.length ? completion : list;
    const retiredSharesTotal = source.reduce((acc, x) => acc + Number(x.retired_shares || 0), 0) || null;
    const retiredAmountTotal = source.reduce((acc, x) => acc + Number(x.retired_amount || 0), 0) || null;
    out.push({
      year,
      retired_shares_total: retiredSharesTotal,
      retired_amount_total: retiredAmountTotal,
      event_count: source.length,
      basis: completion.length ? 'completion' : 'decision',
    });
  }
  return out.sort((a, b) => (b.year || 0) - (a.year || 0));
}

async function fetchTreasuryWithDetails(treasuryDisclosures, apiKey, corpCode = '-') {
  const seen = new Set();
  const merged = [];
  for (const d of treasuryDisclosures || []) {
    if (!d.rcept_no || seen.has(d.rcept_no)) continue;
    seen.add(d.rcept_no);
    merged.push({ rcept_no: d.rcept_no, report_nm: d.report_nm, rcept_dt: d.rcept_dt });
  }
  merged.sort((a, b) => (b.rcept_dt || '').localeCompare(a.rcept_dt || ''));
  const toFetch = merged.slice(0, MAX_TREASURY_ITEMS);
  const items = [];
  for (const d of toFetch) {
    try {
      await smartDelay();
      const zipBuffer = await requestBinary(`${API_BASE}/document.xml`, { rcept_no: d.rcept_no }, apiKey);
      logBinaryApi('TreasuryDocument', corpCode, d.rcept_no, zipBuffer);
      if (!zipBuffer || zipBuffer.length < 100 || zipBuffer[0] !== 0x50 || zipBuffer[1] !== 0x4b) continue;
      const xmlText = extractTextFromDocumentZip(zipBuffer);
      const raw = sanitizeDocumentToRawText(xmlText);
      const parsed = parseTreasuryFromDocumentText(raw, d.report_nm, d.rcept_dt, d.rcept_no);
      if (parsed) items.push(parsed);
    } catch (_) {
      /* skip failed treasury document */
    }
  }
  return {
    items,
    yearly_summary: buildTreasuryYearlySummary(items),
  };
}

// --- Financials V2: CFS/OFS 정책 + Discrete 분기(동일 fs_div일 때만) ---

/**
 * 기업별 재무제표 정책: CFS가 하나라도 있으면 CFS 기업, 없으면 OFS 전용.
 * @param {{ [year]: { [reprtCode]: { cfs?: object, ofs?: object } } }} byYearReprt
 * @param {number[]} years
 * @returns {'CFS'|'OFS'}
 */
function decideFinancialsPolicy(byYearReprt, years) {
  for (const y of years) {
    const r = byYearReprt[y] || {};
    for (const code of [REPRT_CODE_Q1, REPRT_CODE_SEMI, REPRT_CODE_Q3, REPRT_CODE_ANNUAL]) {
      if (r[code]?.cfs) return 'CFS';
    }
  }
  return 'OFS';
}

/** 연도별·보고서별로 CFS/OFS 중 정책에 맞게 하나 선택. */
function chooseIndicatorsByPolicy(byYearReprt, years) {
  const policy = decideFinancialsPolicy(byYearReprt, years);

  const byYearChosen = {};
  for (const y of years) {
    byYearChosen[y] = {};
    const r = byYearReprt[y] || {};
    for (const code of [REPRT_CODE_Q1, REPRT_CODE_SEMI, REPRT_CODE_Q3, REPRT_CODE_ANNUAL]) {
      const cfs = r[code]?.cfs;
      const ofs = r[code]?.ofs;
      if (policy === 'CFS') {
        if (cfs) byYearChosen[y][code] = { indicator: cfs, fs_div: cfs.fs_div || 'CFS' };
        else if (ofs) byYearChosen[y][code] = { indicator: ofs, fs_div: ofs.fs_div || 'OFS' };
      } else {
        if (ofs) byYearChosen[y][code] = { indicator: ofs, fs_div: ofs.fs_div || 'OFS' };
        else if (cfs) byYearChosen[y][code] = { indicator: cfs, fs_div: cfs.fs_div || 'CFS' };
      }
    }
  }
  return { policy, byYearChosen };
}

function buildYearItemWithDiscreteQuarters(year, byReprt, latestYearWithData) {
  const slot = (code) => byReprt[code];
  const annualSlot = slot(REPRT_CODE_ANNUAL);
  const q1Slot = slot(REPRT_CODE_Q1);
  const semiSlot = slot(REPRT_CODE_SEMI);
  const q3Slot = slot(REPRT_CODE_Q3);

  const makeSnapshot = (slot, quarterLabel) => {
    if (!slot || !slot.indicator) return null;
    const base = slot.indicator;
    const fsDiv = slot.fs_div || base.fs_div || null;
    const status = base.status || 'confirmed';
    const source = base.source || (quarterLabel ? 'Quarterly' : 'Annual Report');
    const common = {
      ...base,
      fs_div: fsDiv,
      status,
      source,
    };
    if (quarterLabel) {
      return {
        ...common,
        quarter: quarterLabel,
        report_type: 'cumulative',
      };
    }
    return {
      ...common,
      quarter: null,
    };
  };
  const annual = makeSnapshot(annualSlot, null);
  let quarters = {};

  // 최신 데이터 연도만 분기 스냅샷을 가진다. 나머지 연도는 annual만.
  if (latestYearWithData && year === latestYearWithData) {
    const q1 = makeSnapshot(q1Slot, '1Q');
    const q2 = makeSnapshot(semiSlot, '2Q');
    const q3 = makeSnapshot(q3Slot, '3Q');
    const q4 = makeSnapshot(annualSlot, '4Q');

    // 현재 연도는 가장 최근 분기 하나만 남김 (4Q > 3Q > 2Q > 1Q 우선순위)
    let latest = null;
    let latestKey = null;
    if (q4) { latest = q4; latestKey = '4Q'; }
    else if (q3) { latest = q3; latestKey = '3Q'; }
    else if (q2) { latest = q2; latestKey = '2Q'; }
    else if (q1) { latest = q1; latestKey = '1Q'; }

    if (latest && latestKey) {
      quarters[latestKey] = latest;
    }
  }

  const hasAnnual = !!annual;
  return {
    year,
    annual,
    quarters,
    status: hasAnnual ? 'confirmed' : 'partial',
    source: hasAnnual ? 'Annual Report' : 'Quarterly',
  };
}

async function fetchFinancialsWithRetry(corpCode, years, apiKey) {
  const byYearReprt = {};
  const expectedByYear = {};
  years.forEach((y) => {
    expectedByYear[y] = expectedMaxQuarterForYear(y);
  });

  const now = new Date();
  const currentYear = now.getFullYear();

  // 1) 연간: 결산이 나왔을 법한 연도(또는 오래된 연도)에만 사업보고서(11011) 호출
  for (const year of years) {
    const exp = expectedByYear[year];
    const shouldFetchAnnual = exp === '4Q' || year < currentYear - 1;
    if (!shouldFetchAnnual) continue;
    const res = await fetchFinancialReport(corpCode, year, REPRT_CODE_ANNUAL, apiKey);
    await smartDelay();
    if (!byYearReprt[year]) byYearReprt[year] = {};
    byYearReprt[year][REPRT_CODE_ANNUAL] = { cfs: res.cfs || null, ofs: res.ofs || null, status: res.status };
  }

  // 2) 분기: "어떤 분기라도 있을 법한" 연도만 대상으로, 가능한 분기만 탑다운으로 조회
  const quarterCandidateYears = years.filter(
    (y) => expectedByYear[y] !== '0Q' && y >= currentYear - 1,
  );
  for (const year of quarterCandidateYears) {
    const exp = expectedByYear[year];
    /** @type {string[]} */
    let order = [];
    if (exp === '1Q') {
      order = [REPRT_CODE_Q1];
    } else if (exp === '2Q') {
      order = [REPRT_CODE_SEMI, REPRT_CODE_Q1];
    } else {
      // '3Q' 또는 '4Q'인 경우: 3Q -> 2Q -> 1Q 순
      order = [REPRT_CODE_Q3, REPRT_CODE_SEMI, REPRT_CODE_Q1];
    }

    let foundQuarter = false;
    for (const reprtCode of order) {
      if (foundQuarter) break;
      const res = await fetchFinancialReport(corpCode, year, reprtCode, apiKey);
      await smartDelay();
      if (!byYearReprt[year]) byYearReprt[year] = {};
      byYearReprt[year][reprtCode] = { cfs: res.cfs || null, ofs: res.ofs || null, status: res.status };
      if (res.cfs || res.ofs) {
        foundQuarter = true;
      }
    }
  }

  const { policy: financialsFsPolicy, byYearChosen } = chooseIndicatorsByPolicy(byYearReprt, years);

  // 실제로 어떤 연도에 데이터가 있는지 기준으로 "최신 연도"를 결정
  const candidateYears = years.filter((y) => {
    const r = byYearChosen[y] || {};
    return Object.values(r).some((slot) => slot && slot.indicator);
  });
  const latestYearWithData = candidateYears.length ? Math.max(...candidateYears) : null;

  const financialItems = years.map((y) => buildYearItemWithDiscreteQuarters(y, byYearChosen[y] || {}, latestYearWithData));
  const withData = financialItems.filter((i) => i.annual != null || Object.keys(i.quarters || {}).length > 0);
  const confirmedCount = withData.filter((i) => i.status === 'confirmed').length;
  return {
    financialItems: withData,
    noDataCount: years.length - withData.length,
    confirmedCount,
    prelimCount: 0,
    financialsFsPolicy,
  };
}

function guidanceValuesToIndicator(year, values) {
  if (!values || (values.revenue == null && values.op_income == null && values.net_income == null)) return null;
  return {
    year,
    quarter: '4Q',
    revenue: values.revenue ?? null,
    op_income: values.op_income ?? null,
    net_income: values.net_income ?? null,
    equity: null,
    total_assets: null,
    debt: null,
    roe: null,
    roa: null,
    debt_ratio: null,
    status: 'preliminary',
    source: 'Disclosure',
  };
}

function applyPreliminaryFallback(financialItems, guidanceItems, years) {
  const byYear = new Map();
  financialItems.forEach((i) => byYear.set(i.year, { ...i }));

  for (const g of guidanceItems || []) {
    if (!g.values || (!g.values.revenue && !g.values.op_income && !g.values.net_income)) continue;
    const y = extractYearFromReport(g.report_nm, g.rcept_dt);
    if (y == null) continue;
    const ind = guidanceValuesToIndicator(y, g.values);
    if (!ind) continue;
    let item = byYear.get(y);
    if (!item) {
      item = { year: y, annual: null, quarters: {}, status: 'partial', source: 'Quarterly' };
      byYear.set(y, item);
    }
    if (item.annual == null) {
      item.annual = { ...ind, status: 'preliminary', source: 'Disclosure' };
      if (!item.quarters) item.quarters = {};
      item.quarters['4Q'] = { ...ind, quarter: '4Q', status: 'preliminary', source: 'Disclosure' };
      item.status = 'preliminary';
    }
  }

  return Array.from(byYear.values()).sort((a, b) => (b.year || 0) - (a.year || 0));
}

// --- Router Pattern: 정형 / 비정형 완전 분리 ---

/** 정형 데이터 수집 (company.json, fnlttSinglAcntAll.json, Naver 배당) */
async function fetchStructuredData(corpCode, years, apiKey, dataRoot, opts = {}) {
  const { dbClient, dbOnly } = opts;
  const start = Date.now();
  let corpName = corpCode;
  const outDir = path.join(dataRoot, 'corp', corpCode);
  if (!dbOnly) ensureDir(outDir);

  let overviewOk = false;
  let overview = null;
  try {
    overview = await fetchOverview(corpCode, apiKey);
    await smartDelay();
    if (overview && overview.status === '000') {
      corpName = overview.corp_name || corpCode;
      overview.last_updated_at = today();
      if (!dbOnly) writeJson(path.join(outDir, 'overview.json'), overview);
      if (dbClient) {
        await corpWriter.upsertOverview(dbClient, corpCode, overview);
        await corpWriter.upsertCorpIndexEntry(dbClient, {
          corp_code: corpCode,
          corp_name: overview.corp_name ?? null,
          stock_name: overview.stock_name ?? null,
          stock_code: overview.stock_code ?? null,
          market: overview.market ?? null,
          induty: overview.induty ?? null,
          sector: overview.sector ?? null,
          last_updated_at: overview.last_updated_at ?? today(),
        });
      }
      overviewOk = true;
    }
  } catch (_) {
    await smartDelay();
  }

  let { financialItems, noDataCount, confirmedCount, prelimCount, financialsFsPolicy } = await fetchFinancialsWithRetry(
    corpCode, years, apiKey,
  );

  // 배당 데이터: Naver Finance (DPS / 배당수익률 / 배당성향)
  // overview에서 종목코드(stock_code) 추출 — 네이버는 KRX 코드 기반
  const stockCode = overview?.stock_code ? String(overview.stock_code).trim() : '';
  let dividendItems = [];
  const dividendLog = { latestYear: null, count: 0, total: 0 };
  if (stockCode) {
    try {
      dividendItems = await fetchNaverDividendsByTicker(stockCode);
      await smartDelay();
      if (dividendItems.length > 0) {
        const latest = dividendItems[0];
        dividendLog.latestYear = latest.year;
        dividendLog.count = (latest.details || []).length;
        dividendLog.total = latest.total_cash_dividend_per_share ?? 0;
      }
    } catch (_) {
      dividendItems = [];
    }
  }

  const financialsPayload = {
    corp_code: corpCode,
    financials_fs_policy: financialsFsPolicy,
    items: financialItems,
    last_updated_at: today(),
  };
  const dividendsPayload = {
    corp_code: corpCode,
    items: dividendItems,
    last_updated_at: today(),
  };
  // 최대주주·임원·주식총수 병렬 수집
  const [shareholdersResult, officersResult, totalStockResult] = await Promise.allSettled([
    fetchShareholders(corpCode, apiKey),
    fetchOfficers(corpCode, apiKey),
    fetchTotalStock(corpCode, apiKey),
  ]);

  let shareholdersPayload = shareholdersResult.status === 'fulfilled' ? shareholdersResult.value : null;
  const officersPayload   = officersResult.status   === 'fulfilled' ? officersResult.value   : null;
  const totalStockPayload = totalStockResult.status  === 'fulfilled' ? totalStockResult.value  : null;

  // 수집 결과 상태 결정 (ok / no_data / error)
  const shSyncStatus = shareholdersResult.status === 'rejected' ? 'error'
                     : shareholdersPayload !== null              ? 'ok'
                     :                                            'no_data';
  const ofSyncStatus = officersResult.status === 'rejected'     ? 'error'
                     : officersPayload !== null                  ? 'ok'
                     :                                            'no_data';

  // 자기주식수·발행주식총수를 shareholders 페이로드에 병합
  if (shareholdersPayload && totalStockPayload) {
    shareholdersPayload = {
      ...shareholdersPayload,
      common_treasury_shares: totalStockPayload.common_treasury_shares,
      total_issued_shares: totalStockPayload.total_issued_shares ?? null,
    };
  }

  // 네이버 보조 주주 수집 (DART 주주가 있고 종목코드가 있을 때만 시도)
  if (stockCode && shareholdersPayload?.items?.length > 0) {
    try {
      const naverExtra = await fetchNaverExtraShareholders(stockCode, shareholdersPayload.items);
      await smartDelay();
      shareholdersPayload = { ...shareholdersPayload, naver_extra_items: naverExtra };
    } catch (err) {
      console.warn(`  [Naver 주주] 수집 실패 (${corpCode}): ${err.message}`);
      shareholdersPayload = { ...shareholdersPayload, naver_extra_items: [] };
    }
  }

  // 항상 저장 (null이어도 sync_status 기록 — UI 상태 표시 위해)
  const shToSave = shareholdersPayload
    ? { ...shareholdersPayload, sync_status: shSyncStatus }
    : { items: [], sync_status: shSyncStatus, last_updated_at: today() };
  const ofToSave = officersPayload
    ? { ...officersPayload, sync_status: ofSyncStatus }
    : { items: [], sync_status: ofSyncStatus, last_updated_at: today() };

  if (!dbOnly) {
    writeJson(path.join(outDir, 'financials.json'), financialsPayload);
    writeJson(path.join(outDir, 'dividends.json'), dividendsPayload);
    writeJson(path.join(outDir, 'shareholders.json'), shToSave);
    writeJson(path.join(outDir, 'officers.json'), ofToSave);
  }
  if (dbClient) {
    await corpWriter.upsertFinancials(dbClient, corpCode, financialsPayload);
    await corpWriter.upsertDividends(dbClient, corpCode, dividendsPayload);
    await corpWriter.upsertShareholders(dbClient, corpCode, shToSave);
    await corpWriter.upsertOfficers(dbClient, corpCode, ofToSave);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const finSummary = summarizeFinancialsDepth(financialItems);

  return {
    corpCode,
    corpName,
    overviewOk,
    financialItems,
    dividendItems,
    financialsCount: financialItems.length,
    confirmedCount,
    prelimCount,
    totalYears: years.length,
    noDataCount,
    dividendLog,
    dividendsCount: dividendItems.length,
    shareholdersCount: shareholdersPayload?.items?.length ?? 0,
    officersCount: officersPayload?.items?.length ?? 0,
    elapsed,
    finSummary,
  };
}

/** 비정형 데이터 수집 (list.json + document.xml + LLM → guidance.json) */
async function fetchUnstructuredData(corpCode, apiKey, dataRoot, options = {}) {
  const { dbClient, dbOnly, forceLlm: forceLlmOpt, existingStructured } = options;
  const forceLlm = !!forceLlmOpt;
  const start = Date.now();
  const outDir = path.join(dataRoot, 'corp', corpCode);
  if (!dbOnly) ensureDir(outDir);

  const guidancePath = path.join(outDir, 'guidance.json');
  const treasuryPath = path.join(outDir, 'treasury.json');
  const financialsPath = path.join(outDir, 'financials.json');

  let existingGuidance;
  let existingTreasury;
  let existingFinancials;
  if (dbOnly && dbClient) {
    const fromDb = await corpWriter.getExistingGuidanceTreasury(dbClient, corpCode);
    existingGuidance = fromDb.guidance;
    existingTreasury = fromDb.treasury;
    existingFinancials = existingStructured ? { items: existingStructured.financialItems } : null;
  } else {
    existingGuidance = readJson(guidancePath, null);
    existingTreasury = readJson(treasuryPath, null);
    existingFinancials = readJson(financialsPath, null);
  }
  const existingVersion = existingGuidance && typeof existingGuidance === 'object'
    ? existingGuidance.logic_version
    : null;
  const existingTreasuryVersion = existingTreasury && typeof existingTreasury === 'object'
    ? existingTreasury.logic_version
    : null;
  const canSkipByVersion = !forceLlm
    && existingGuidance
    && typeof existingGuidance === 'object'
    && existingVersion === LLM_LOGIC_VERSION;
  const canSkipTreasuryByVersion = !forceLlm
    && existingTreasury
    && typeof existingTreasury === 'object'
    && existingTreasuryVersion === LLM_LOGIC_VERSION;

  const needGuidanceRefresh = forceLlm || !canSkipByVersion;
  const needTreasuryRefresh = forceLlm || !canSkipTreasuryByVersion;

  if (!needGuidanceRefresh && !needTreasuryRefresh) {
    console.log(`  [Guidance/Treasury] Skip: Already parsed with current logic (corp=${corpCode}, logic_version=${LLM_LOGIC_VERSION})`);
    const existingItems = Array.isArray(existingGuidance.items) ? existingGuidance.items : [];
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const unstructuredPeriod = existingItems.find((g) => g.values && g.period_label)?.period_label || null;
    return {
      corpCode,
      guidanceCount: existingItems.length,
      treasuryCount: Array.isArray(existingTreasury?.items) ? existingTreasury.items.length : 0,
      unstructuredPeriod,
      elapsed,
    };
  }
  if (forceLlm) {
    console.log(`  [Guidance] Re-run: forced by --force-llm (corp=${corpCode})`);
  } else if (!existingGuidance) {
    console.log(`  [Guidance] Re-run: no existing guidance.json (corp=${corpCode})`);
  } else if (!existingVersion) {
    console.log(`  [Guidance] Re-run: missing logic_version in existing data (corp=${corpCode})`);
  } else if (existingVersion !== LLM_LOGIC_VERSION) {
    console.log(`  [Guidance] Re-run: logic version changed (corp=${corpCode}, old=${existingVersion}, new=${LLM_LOGIC_VERSION})`);
  }

  let guidanceItems = Array.isArray(existingGuidance?.items) ? existingGuidance.items : [];
  let treasuryBundle = {
    items: Array.isArray(existingTreasury?.items) ? existingTreasury.items : [],
    yearly_summary: Array.isArray(existingTreasury?.yearly_summary) ? existingTreasury.yearly_summary : [],
  };

  if (needGuidanceRefresh || needTreasuryRefresh) {
    let guidanceDisclosures = [];
    let treasuryDisclosures = [];
    let unstructuredMeta = null;
    try {
      const latestFinancialPeriodKey = getLatestFinancialPeriodKey(existingFinancials);
      const merged = await fetchUnstructuredDisclosuresIntegrated(corpCode, apiKey, {
        needGuidance: needGuidanceRefresh,
        needTreasury: needTreasuryRefresh,
        latestFinancialPeriodKey,
        treasuryLookbackMonths: TREASURY_LOOKBACK_MONTHS,
      });
      guidanceDisclosures = merged.guidance || [];
      treasuryDisclosures = merged.treasury || [];
      unstructuredMeta = merged.meta || null;
      if (needTreasuryRefresh) {
        const lookbackMonths = Number(unstructuredMeta?.treasury_lookback_months || TREASURY_LOOKBACK_MONTHS);
        const cutoffDt = unstructuredMeta?.treasury_cutoff_rcept_dt || '-';
        console.log(`  [Treasury/Policy] corp=${corpCode} lookback_months=${lookbackMonths} cutoff_rcept_dt=${cutoffDt}`);
      }
    } catch (_) {
      await smartDelay();
    }

    if (needGuidanceRefresh) {
      guidanceItems = await fetchGuidanceWithDetails(
        guidanceDisclosures,
        apiKey,
        corpCode,
      );
      const guidancePayload = {
        corp_code: corpCode,
        logic_version: LLM_LOGIC_VERSION,
        items: guidanceItems,
        last_updated_at: today(),
      };
      if (!dbOnly) writeJson(guidancePath, guidancePayload);
      if (dbClient) await corpWriter.upsertGuidance(dbClient, corpCode, guidancePayload);
    } else {
      console.log(`  [Guidance] Skip: Already parsed with current logic (corp=${corpCode}, logic_version=${LLM_LOGIC_VERSION})`);
    }

    if (needTreasuryRefresh) {
      treasuryBundle = await fetchTreasuryWithDetails(
        treasuryDisclosures,
        apiKey,
        corpCode,
      );
      const treasuryPayload = {
        corp_code: corpCode,
        logic_version: LLM_LOGIC_VERSION,
        items: treasuryBundle.items || [],
        yearly_summary: treasuryBundle.yearly_summary || [],
        fetch_policy: {
          lookback_months: Number(unstructuredMeta?.treasury_lookback_months || TREASURY_LOOKBACK_MONTHS),
          cutoff_rcept_dt: unstructuredMeta?.treasury_cutoff_rcept_dt || null,
          source: 'integrated-list-fetch',
        },
        last_updated_at: today(),
      };
      if (!dbOnly) writeJson(treasuryPath, treasuryPayload);
      if (dbClient) await corpWriter.upsertTreasury(dbClient, corpCode, treasuryPayload);
    } else {
      console.log(`  [Treasury] Skip: Already parsed with current logic (corp=${corpCode}, logic_version=${LLM_LOGIC_VERSION})`);
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const unstructuredPeriod = guidanceItems.find((g) => g.values && g.period_label)?.period_label || null;

  return {
    corpCode,
    guidanceCount: guidanceItems.length,
    treasuryCount: (treasuryBundle.items || []).length,
    unstructuredPeriod,
    elapsed,
  };
}

// --- Sync one corp (Router) ---

async function syncOneCorp(corpCode, years, apiKey, dataRoot, opts = {}) {
  const { dbClient, dbOnly } = opts;
  const forceLlm = process.argv.includes('--force-llm');
  const t0 = Date.now();
  trace('sync_one_corp_start', { corp_code: corpCode, db_only: !!dbOnly });

  let structured = null;
  const tStructured = Date.now();
  try {
    structured = await fetchStructuredData(corpCode, years, apiKey, dataRoot, { dbClient, dbOnly });
    trace('sync_one_corp_structured_done', {
      corp_code: corpCode,
      elapsed_ms: Date.now() - tStructured,
      confirmed_count: Number(structured?.confirmedCount || 0),
    });
  } catch (err) {
    console.error(`[syncOneCorp] fetchStructuredData failed corp=${corpCode}:`, err.message);
    trace('sync_one_corp_structured_error', {
      corp_code: corpCode,
      elapsed_ms: Date.now() - tStructured,
      error: String(err.message || err),
    });
    // 구조화 데이터 실패 → 비구조화는 계속 시도하되 existingStructured=null
  }

  const existingStructured = structured
    ? { financialItems: structured.financialItems, dividendItems: structured.dividendItems || [] }
    : null;

  let unstructured = null;
  const tUnstructured = Date.now();
  try {
    unstructured = await fetchUnstructuredData(corpCode, apiKey, dataRoot, {
      dbClient,
      dbOnly,
      forceLlm,
      existingStructured,
    });
    trace('sync_one_corp_unstructured_done', {
      corp_code: corpCode,
      elapsed_ms: Date.now() - tUnstructured,
      period: unstructured?.unstructuredPeriod || null,
    });
  } catch (err) {
    console.error(`[syncOneCorp] fetchUnstructuredData failed corp=${corpCode}:`, err.message);
    trace('sync_one_corp_unstructured_error', {
      corp_code: corpCode,
      elapsed_ms: Date.now() - tUnstructured,
      error: String(err.message || err),
    });
  }

  // 두 단계 모두 실패하면 에러로 종료 (fetch-one-corp에서 exit code 1로 기록됨)
  if (!structured && !unstructured) {
    throw new Error(`Both structured and unstructured data fetch failed for corp=${corpCode}`);
  }

  const info = {
    corpCode,
    corpName: structured?.corpName || corpCode,
    confirmedCount: structured?.confirmedCount || 0,
    unstructuredPeriod: unstructured?.unstructuredPeriod || null,
    elapsed: Math.max(
      Number(structured?.elapsed || 0),
      Number(unstructured?.elapsed || 0),
    ).toFixed(1),
  };

  trace('sync_one_corp_done', {
    corp_code: corpCode,
    elapsed_ms: Date.now() - t0,
    confirmed_count: Number(info.confirmedCount || 0),
    unstructured_period: info.unstructuredPeriod || null,
  });

  return info;
}

function summarizeFinancialsDepth(financialItems) {
  const withData = (financialItems || []).filter((i) => (i.quarters && Object.keys(i.quarters).length > 0) || i.annual);
  if (withData.length === 0) return 'No Data';
  const latest = withData[0];
  const y = latest.year;
  const qs = latest.quarters || {};
  const has4 = qs['4Q'] || latest.annual;
  const range = has4 ? '1Q~4Q Discrete' : [qs['1Q'] && '1Q', qs['2Q'] && '2Q', qs['3Q'] && '3Q'].filter(Boolean).join('~') || 'Partial';
  return `${y} ${range}`;
}

function formatLog(info) {
  const structured = info.confirmedCount > 0 ? 'Fin OK' : 'Fin -';
  const unstructured = info.unstructuredPeriod ? `LLM Extracted ${info.unstructuredPeriod}` : 'Unstructured(-)';
  return `[${info.corpCode}] ${info.corpName}: Structured(${structured}) | ${unstructured} -> Done (${info.elapsed}s)`;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function run() {
  const startedAt = Date.now();
  const apiKey = process.env.OPENDART_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('환경변수 OPENDART_API_KEY 가 설정되어 있지 않습니다.');
  }
  const writeToDb = /^1|true|yes|y$/i.test(String(process.env.WRITE_TO_DB || '').trim());
  const dbOnly = /^1|true|yes|y$/i.test(String(process.env.DB_ONLY || '').trim());
  let dbClient = null;
  if (writeToDb || dbOnly) {
    try {
      const hybrid = createHybridLibsqlClient();
      dbClient = hybrid.client;
      await ensureSchema(dbClient);
    } catch (e) {
      console.error('DB init failed:', e.message);
      if (dbOnly) throw e;
      dbClient = null;
    }
  }

  const corps = await getTargetCorps(dbClient);
  if (!corps.length) {
    console.log('target_corps 비어 있음.');
    return;
  }
  const years = getYears();
  const dataRoot = path.join(__dirname, '..', 'data');
  const chunks = chunk(corps, SYNC_CORP_CONCURRENCY);
  for (let i = 0; i < chunks.length; i++) {
    const batch = chunks[i];
    const results = await Promise.all(
      batch.map((corpCode) => syncOneCorp(corpCode, years, apiKey, dataRoot, { dbClient, dbOnly })),
    );
    results.forEach((info) => console.log(formatLog(info)));
    if (i < chunks.length - 1) await smartDelay();
  }
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[ALL DONE] corps=${corps.length} elapsed=${elapsed}s`);

  if (writeToDb && !dbOnly) {
    const { spawn } = require('child_process');
    const migratePath = path.join(__dirname, 'migrate-json-to-db.js');
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [migratePath], {
        env: process.env,
        cwd: path.join(__dirname, '..'),
        stdio: 'inherit',
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`db:migrate exited with code ${code}`));
        } else {
          resolve();
        }
      });
    });
    console.log('[WRITE_TO_DB] JSON → DB migration completed.');
  }
  if (dbOnly) {
    console.log('[DB_ONLY] Data written to DB only; no JSON files created.');
  }
}

module.exports = { syncOneCorp, getYears };

if (require.main === module) {
  run()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
