const cheerio = require('cheerio');

function cleanText(v) {
  return String(v || '').replace(/\s+/g, ' ').trim();
}

function toNumberOrNull(v) {
  if (v == null) return null;
  const s = String(v).replace(/,/g, '').trim();
  if (!s || s === '-' || s === 'N/A') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function normalizeYearLabel(raw) {
  const t = cleanText(raw);
  const m = t.match(/(20\d{2})\.\d{2}(?:\((E)\))?/i);
  if (!m) return null;
  return m[2] ? `${m[1]}E` : m[1];
}

function toYyyymmdd(date = new Date()) {
  const y = String(date.getFullYear());
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function filterFutureEstimateItems(items) {
  const nowYear = new Date().getFullYear();
  return (items || [])
    .filter((x) => x && /E$/.test(String(x.year_label || '')))
    .filter((x) => {
      const y = Number(String(x.year_label || '').replace(/[^0-9]/g, '').slice(0, 4));
      return Number.isFinite(y) && y >= nowYear;
    })
    .slice(0, 3);
}

async function fetchWiseReportConsensusByTicker(ticker) {
  const code = String(ticker || '').trim();
  if (!code) return { items: [], source_url: null };
  const sourceUrl = `https://navercomp.wisereport.co.kr/v2/company/c1050001.aspx?cmp_cd=${encodeURIComponent(code)}&cn=`;
  const dataUrl = `https://navercomp.wisereport.co.kr/company/ajax/c1050001_data.aspx?flag=2&cmp_cd=${encodeURIComponent(code)}&finGubun=IFRSL&frq=0&sDT=${toYyyymmdd()}&chartType=svg`;
  const res = await fetch(dataUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Referer: sourceUrl,
    },
  });
  if (!res.ok) throw new Error(`WiseReport fetch failed: ${res.status}`);
  const json = await res.json();
  const rows = Array.isArray(json?.JsonData) ? json.JsonData : [];
  const mapped = rows.map((r) => ({
    year_label: normalizeYearLabel(r?.YYMM) || null,
    is_estimate: /\(E\)/i.test(String(r?.YYMM || '')),
    revenue: toNumberOrNull(r?.SALES),
    op_income: toNumberOrNull(r?.OP),
    net_income: toNumberOrNull(r?.NP),
    roe: toNumberOrNull(r?.ROE),
  }));
  const items = filterFutureEstimateItems(mapped).filter((x) => x.year_label);
  return {
    items,
    source_url: sourceUrl,
  };
}

function extractConsensusFromHtml(html) {
  const $ = cheerio.load(html);
  const tables = $('table');
  let target = null;
  tables.each((_, tbl) => {
    const text = cleanText($(tbl).text());
    if (text.includes('기업실적분석') && text.includes('주요재무정보') && text.includes('매출액')) {
      target = $(tbl);
    }
  });
  if (!target) return [];

  const rows = [];
  target.find('tr').each((_, tr) => {
    const cells = [];
    $(tr).children('th,td').each((__, td) => {
      cells.push(cleanText($(td).text()));
    });
    if (cells.length) rows.push(cells);
  });
  if (!rows.length) return [];

  const dateRow = rows.find((r) => r.filter((c) => /20\d{2}\.\d{2}/.test(c)).length >= 4);
  if (!dateRow) return [];
  const annualDates = [];
  let prevYear = null;
  for (const cell of dateRow) {
    if (!/20\d{2}\.12(?:\(E\))?/i.test(cell)) continue;
    const y = Number((cell.match(/(20\d{2})/) || [])[1]);
    if (!Number.isFinite(y)) continue;
    // "최근 연간 실적" 구간은 연도가 증가하다가, 분기 구간 시작 시 역전됨
    if (prevYear != null && y < prevYear) break;
    prevYear = y;
    annualDates.push(cell);
  }
  if (!annualDates.length) return [];

  const metricRows = {};
  for (const row of rows) {
    const key = cleanText(row[0]);
    if (!key) continue;
    if (key === '매출액' || key === '영업이익' || key === '당기순이익' || /^ROE/i.test(key)) {
      metricRows[key] = row;
    }
  }
  if (!metricRows['매출액'] && !metricRows['영업이익'] && !metricRows['당기순이익']) return [];
  const roeKey = Object.keys(metricRows).find((k) => /^ROE/i.test(k)) || null;

  const out = annualDates.map((cell, i) => {
    const yearLabel = normalizeYearLabel(cell);
    const metricCol = i + 1; // metric row는 첫 컬럼이 항목명
    return {
      year_label: yearLabel || cell,
      is_estimate: /\(E\)/i.test(cell) || /E$/.test(String(yearLabel || '')),
      revenue: metricRows['매출액'] ? toNumberOrNull(metricRows['매출액'][metricCol]) : null,
      op_income: metricRows['영업이익'] ? toNumberOrNull(metricRows['영업이익'][metricCol]) : null,
      net_income: metricRows['당기순이익'] ? toNumberOrNull(metricRows['당기순이익'][metricCol]) : null,
      roe: roeKey ? toNumberOrNull(metricRows[roeKey][metricCol]) : null,
    };
  });

  // 연간 컬럼 기준 최신 최대 3개년만 반환 (E 포함)
  return out
    .filter((x) => x.revenue != null || x.op_income != null || x.net_income != null)
    .slice(-3);
}

async function fetchNaverConsensusByTicker(ticker) {
  const code = String(ticker || '').trim();
  if (!code) return { items: [], source_url: null };
  try {
    const wise = await fetchWiseReportConsensusByTicker(code);
    if (wise.items && wise.items.length) return wise;
  } catch (_) {
    // fallback to finance.naver parser below
  }

  const sourceUrls = [
    `https://finance.naver.com/item/coinfo.naver?code=${encodeURIComponent(code)}`,
    `https://finance.naver.com/item/main.naver?code=${encodeURIComponent(code)}`,
  ];
  for (const sourceUrl of sourceUrls) {
    const res = await fetch(sourceUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Referer: 'https://finance.naver.com/',
      },
    });
    if (!res.ok) continue;
    const html = await res.text();
    const items = filterFutureEstimateItems(extractConsensusFromHtml(html));
    if (items.length) {
      return {
        items,
        source_url: sourceUrl,
      };
    }
  }
  throw new Error('Naver consensus parse failed');
}

module.exports = {
  fetchNaverConsensusByTicker,
};
