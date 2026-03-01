/**
 * WiseReport(네이버 금융 연동) c1010001 페이지에서 주요주주 정보 파싱.
 *
 * 실제 데이터 출처:
 *   https://navercomp.wisereport.co.kr/v2/company/c1010001.aspx?cmp_cd={code}&cn=
 *   (네이버 금융 coinfo.naver 페이지가 iframe으로 로드하는 WiseReport 엔드포인트)
 *
 * 테이블 구조:
 *   헤더: 주요주주 | 보유주식수(보통) | 보유지분(%)
 *   데이터행: 이름(중복 포함 가능) | 주식수 | 지분율
 *
 * 제외 규칙:
 *   1. DART 대주주 그룹: "삼성생명보험 외 15인" 패턴 (dartItems 첫 번째 이름 기준)
 *   2. DART 주주명 정확 일치
 *   3. 자사주 / 자기주식
 */
const cheerio = require('cheerio');

function cleanText(v) {
  return String(v || '').replace(/\s+/g, ' ').trim();
}

function toNumberOrNull(v) {
  if (v == null) return null;
  const s = String(v).replace(/,/g, '').replace(/%/g, '').trim();
  if (!s || s === '-' || s === 'N/A' || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * WiseReport 주주명 셀은 "A A" 형태로 같은 이름이 반복되는 경우가 있음.
 * 정규식으로 감지해 첫 번째만 사용.
 */
function deduplicateName(s) {
  const m = s.match(/^(.+) \1$/);
  return m ? m[1] : s;
}

function stripGroupSuffix(name) {
  let s = cleanText(String(name || ''));
  // "외 15인", "외15명", "외 15", "외15" 등 숫자 동반 표현
  s = s.replace(/\s*외\s*\d+\s*(?:인|명)?\s*$/u, '');
  // "외 특수관계인", "외 관계인", "외 친인척" 등 그룹 설명 접미
  s = s.replace(/\s*외\s*(?:특수관계(?:인)?|관계(?:인)?|친인척|계열사)\s*$/u, '');
  // 숫자 없이 단순 "외"로 끝나는 케이스
  s = s.replace(/\s*외\s*$/u, '');
  return cleanText(s);
}

/**
 * 주주명 비교용 정규화.
 * - (주), ㈜, 주식회사 등 법인 표기 제거
 * - 공백/괄호/구두점 제거
 * - 영문은 대문자로 통일
 */
function normalizeHolderName(name) {
  let s = cleanText(name);
  // 접두/접미 법인 표기 제거
  s = s
    .replace(/^\(\s*주\s*\)\s*/u, '')
    .replace(/^㈜\s*/u, '')
    .replace(/^주식회사\s*/u, '')
    .replace(/\s*\(\s*주\s*\)$/u, '')
    .replace(/\s*㈜$/u, '')
    .replace(/\s*주식회사$/u, '');
  // 비교에 불필요한 문자 제거
  s = s.replace(/[\s(){}\[\].,·'"`~!@#$%^&*+=:;/?<>|-]/g, '');
  return s.toUpperCase();
}

/**
 * WiseReport HTML에서 주요주주 테이블을 파싱하여 배열로 반환.
 *
 * @param {string} html
 * @param {Array<{nm:string}>} dartItems  DART 기존 주주 목록 (제외 판단용)
 * @returns {Array<{nm:string, shares:number, ratio:number}>}
 */
function extractShareholdersFromHtml(html, dartItems) {
  const $ = cheerio.load(html);

  // DART 주주명 세트 구성 (정규화)
  const dartNames = new Set(
    (dartItems || [])
      .map((it) => String(it.nm || '').trim())
      .filter(Boolean),
  );
  const dartNormalizedNames = new Set([...dartNames].map((nm) => normalizeHolderName(nm)));
  const dartNormalizedBases = new Set(
    [...dartNames].map((nm) => normalizeHolderName(stripGroupSuffix(nm))),
  );

  // 주요주주 테이블: "주요주주" + "보유지분" 헤더를 가진 테이블
  let targetTable = null;
  $('table').each((_, tbl) => {
    const text = $(tbl).text().replace(/\s+/g, ' ');
    if (text.includes('주요주주') && (text.includes('보유지분') || text.includes('보유주식수'))) {
      targetTable = tbl;
      return false;
    }
  });

  if (!targetTable) return [];

  const results = [];
  const seenNormalized = new Set();

  $(targetTable)
    .find('tr')
    .each((ri, tr) => {
      const cells = $(tr).find('td');
      if (cells.length < 2) return;

      const rawName = cleanText($(cells[0]).text());
      const name = deduplicateName(rawName);
      const normalizedName = normalizeHolderName(name);
      const normalizedBase = normalizeHolderName(stripGroupSuffix(name));

      if (!name || name === '-') return;

      // 헤더 행 건너뜀
      if (name === '주요주주' || name === '주주명') return;

      // ① 자사주 제외
      if (name.includes('자사주') || name.includes('자기주식')) return;

      // ② DART 주주 제외: 법인 표기/공백/기호/외N인 변형까지 흡수
      if (dartNormalizedNames.has(normalizedName)) return;
      if (dartNormalizedBases.has(normalizedBase)) return;

      // 동일 엔티티 중복 행 제거 (네이버 표기 변형 중복 방지)
      if (seenNormalized.has(normalizedName) || seenNormalized.has(normalizedBase)) return;
      seenNormalized.add(normalizedName);
      seenNormalized.add(normalizedBase);

      const shares = cells.length >= 2 ? toNumberOrNull($(cells[1]).text()) : null;
      const ratio  = cells.length >= 3 ? toNumberOrNull($(cells[2]).text()) : null;

      if (ratio == null && shares == null) return;
      if (ratio !== null && ratio <= 0) return;

      results.push({
        nm:     name,
        shares: shares ?? 0,
        ratio:  ratio  ?? 0,
      });
    });

  return results;
}

/**
 * WiseReport에서 DART 외 추가 주요주주 수집.
 *
 * @param {string} ticker  6자리 KRX 종목코드
 * @param {Array}  dartItems  기존 DART 주주 목록 (제외용)
 * @returns {Promise<Array<{nm:string, shares:number, ratio:number}>>}
 */
async function fetchNaverExtraShareholders(ticker, dartItems) {
  const code = String(ticker || '').trim();
  if (!code) return [];

  const url = `https://navercomp.wisereport.co.kr/v2/company/c1010001.aspx?cmp_cd=${encodeURIComponent(code)}&cn=`;
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Referer: `https://finance.naver.com/item/coinfo.naver?code=${encodeURIComponent(code)}`,
      'Accept-Language': 'ko-KR,ko;q=0.9',
    },
  });
  if (!res.ok) {
    throw new Error(`WiseReport coinfo fetch failed: ${res.status} (ticker=${code})`);
  }
  const html = await res.text();
  return extractShareholdersFromHtml(html, dartItems);
}

module.exports = { fetchNaverExtraShareholders };
