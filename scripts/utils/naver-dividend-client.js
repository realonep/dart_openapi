/**
 * 네이버 금융 main.naver 페이지에서 배당 정보 파싱.
 * 컨센서스와 동일한 페이지·테이블을 사용하므로 추가 HTTP 요청 최소화.
 *
 * 추출 항목:
 *   - 주당배당금(원) → total_cash_dividend_per_share
 *   - 시가배당률(%)  → dividend_yield
 *   - 배당성향(%)    → payout_ratio
 */
const cheerio = require('cheerio');

function cleanText(v) {
  return String(v || '').replace(/\s+/g, ' ').trim();
}

function toNumberOrNull(v) {
  if (v == null) return null;
  const s = String(v).replace(/,/g, '').trim();
  if (!s || s === '-' || s === 'N/A' || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function toYyyymmdd(date = new Date()) {
  const y = String(date.getFullYear());
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * HTML에서 주요재무정보 테이블을 찾아 배당 항목을 연도별로 추출한다.
 * 연간 결산 컬럼만 대상 (`.12` 패턴, `(E)` 제외).
 *
 * @param {string} html
 * @returns {Array<{year:number, total_cash_dividend_per_share:number|null, dividend_yield:number|null, payout_ratio:number|null, details:Array}>}
 */
function extractDividendsFromHtml(html) {
  const $ = cheerio.load(html);
  let target = null;

  $('table').each((_, tbl) => {
    const text = cleanText($(tbl).text());
    if (text.includes('주당배당금') && text.includes('배당성향')) {
      target = $(tbl);
    }
  });
  if (!target) return [];

  // 모든 행 수집
  const rows = [];
  target.find('tr').each((_, tr) => {
    const cells = [];
    $(tr).find('th, td').each((__, td) => {
      cells.push(cleanText($(td).text()));
    });
    if (cells.some((c) => c)) rows.push(cells);
  });
  if (!rows.length) return [];

  // 날짜 헤더 행: 20xx.12 패턴이 2개 이상인 행
  const dateRow = rows.find((r) => r.filter((c) => /20\d{2}\.\d{2}/.test(c)).length >= 2);
  if (!dateRow) return [];

  // 연간 결산 컬럼 추출
  // - 확정(A) 값만: `20xx.mm` 형식(E 없는 것)
  // - 결산 월은 회사마다 다를 수 있으므로 첫 번째 날짜 열의 월을 기준으로 필터
  // - 연도가 반복되거나 감소하면 분기 섹션 시작으로 판단해 중단 (yr <= prevYear)
  const annualCols = [];
  let prevYear = null;
  let fiscalMonth = null; // 결산 월 (예: '12', '03')

  for (let i = 0; i < dateRow.length; i++) {
    const cell = dateRow[i];
    const m = cell.match(/^(20\d{2})\.(\d{2})$/);
    if (!m) continue; // (E) 포함 또는 다른 형식 → 스킵
    const yr = Number(m[1]);
    const mo = m[2];
    if (!Number.isFinite(yr)) continue;

    if (fiscalMonth === null) fiscalMonth = mo; // 첫 컬럼의 월을 결산 월로 확정
    if (mo !== fiscalMonth) continue;           // 결산 월이 다른 분기 컬럼 스킵

    if (prevYear !== null && yr <= prevYear) break; // 연도 반복/감소 = 분기 섹션 시작
    prevYear = yr;
    annualCols.push({ colIdx: i, year: yr });
  }
  if (!annualCols.length) return [];

  // 필요한 행 찾기
  const metricRows = {};
  for (const row of rows) {
    const key = cleanText(row[0]);
    if (/주당배당금/.test(key)) metricRows.dps = row;
    else if (/시가배당률/.test(key)) metricRows.yield = row;
    else if (/배당성향/.test(key)) metricRows.payout = row;
  }

  return annualCols
    .map(({ colIdx, year }) => {
      // 날짜 행(row1)은 레이블 없이 시작하지만, 지표 행(row16~18)은 col[0]이 항목명 레이블.
      // 따라서 날짜 행 colIdx → 지표 행 colIdx+1 로 접근해야 정확한 값을 얻는다.
      const dataIdx = colIdx + 1;
      const dps = metricRows.dps ? toNumberOrNull(metricRows.dps[dataIdx]) : null;
      const divYield = metricRows.yield ? toNumberOrNull(metricRows.yield[dataIdx]) : null;
      const payout = metricRows.payout ? toNumberOrNull(metricRows.payout[dataIdx]) : null;
      if (dps == null && divYield == null && payout == null) return null;
      return {
        year,
        total_cash_dividend_per_share: dps,
        dividend_yield_expect: null,
        payout_ratio: payout,
        dividend_yield: divYield,
        details: dps != null ? [{
          type: '결산',
          label: '결산',
          cash_dividend_per_share: dps,
          status: 'confirmed',
          source: 'Naver/FnGuide',
        }] : [],
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.year - a.year);
}

/**
 * @param {string} ticker  6자리 KRX 종목코드
 * @returns {Promise<Array>}  dividends.json items[] 형식
 */
async function fetchNaverDividendsByTicker(ticker) {
  const code = String(ticker || '').trim();
  if (!code) return [];

  const sourceUrl = `https://finance.naver.com/item/main.naver?code=${encodeURIComponent(code)}`;
  const res = await fetch(sourceUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Referer: 'https://finance.naver.com/',
      'Accept-Language': 'ko-KR,ko;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`Naver dividend fetch failed: ${res.status} (ticker=${code})`);
  const html = await res.text();
  return extractDividendsFromHtml(html);
}

module.exports = { fetchNaverDividendsByTicker };
