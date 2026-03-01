/**
 * 비정형 공시(XML/텍스트) 파싱 시 단위 통일 및 원(KRW) 정규화용 전역 유틸리티.
 * 정형 API(fnlttSinglAcnt 등) 응답에는 사용하지 않음.
 */

/**
 * 문서 전체 텍스트 상단에서 단위 표기를 감지해 원(KRW) 환산 곱수(Multiplier)를 반환한다.
 * @param {string} text - 문서 전체 또는 상단 텍스트
 * @returns {number} 1e8(억원), 1e6(백만원), 1e3(천원), 1(원)
 */
function detectUnit(text) {
  if (!text || typeof text !== 'string') return 1;
  const head = text.slice(0, 4000);
  const compact = head.replace(/\s+/g, '');
  if (/단위[:：]?억원|\(억원\)/.test(compact)) return 1e8;
  if (/단위[:：]?백만원|\(백만원\)/.test(compact)) return 1e6;
  if (/단위[:：]?천원|\(천원\)/.test(compact)) return 1e3;
  return 1;
}

/**
 * 콤마 포함 문자열 숫자를 파싱해 곱수를 곱한 절대 원(KRW) 금액으로 반환한다.
 * 비율(%)·소수점만 있는 데이터는 걸러내어 null을 반환한다.
 * @param {string} valueStr - 예: "123,456", "258935"
 * @param {number} multiplier - detectUnit()으로 얻은 곱수
 * @returns {number|null} 원(KRW) 금액, 또는 null(파싱 실패·비율/소수 데이터)
 */
function normalizeKRW(valueStr, multiplier) {
  if (valueStr == null || multiplier == null || multiplier <= 0) return null;
  const s = String(valueStr).replace(/,/g, '').replace(/\s/g, '').trim();
  const m = s.match(/^-?[\d]+(?:\.[\d]+)?/);
  if (!m) return null;
  const num = parseFloat(m[0]);
  if (Number.isNaN(num) || !Number.isFinite(num)) return null;
  if (num % 1 !== 0 && num < 1000) return null;
  if (num % 1 !== 0 && num >= 1000) {
    const rounded = Math.round(num);
    if (Math.abs(rounded - num) < 0.01) return rounded * multiplier;
  }
  const result = num * multiplier;
  return Number.isFinite(result) ? result : null;
}

/**
 * 이미 숫자로 파싱된 값에 곱수만 적용해 원(KRW)으로 반환. (테이블 셀 등에서 사용)
 * 비율로 보이는 값(정수가 아닌 소수이며 1000 미만)은 null 반환.
 * @param {number} num - 파싱된 숫자
 * @param {number} multiplier - detectUnit()으로 얻은 곱수
 * @returns {number|null}
 */
function applyMultiplier(num, multiplier) {
  if (num == null || Number.isNaN(num) || multiplier == null || multiplier <= 0) return null;
  if (num % 1 !== 0 && num < 1000) return null;
  const result = num * multiplier;
  return Number.isFinite(result) ? result : null;
}

module.exports = {
  detectUnit,
  normalizeKRW,
  applyMultiplier,
};
