/**
 * 비정형 공시 본문 → 순수 텍스트 정제 + LLM 기반 수치 추출 (Open DART V3)
 * 정규식/DOM 파싱 없이 태그 제거 후 LLM에만 의존.
 */

const MAX_TEXT_CHARS = 14000;

function detectDeclaredUnit(text) {
  const s = String(text || '');
  if (/단위\s*[:：]?\s*조원/i.test(s)) return { label: '조원', multiplier: 1_000_000_000_000 };
  if (/단위\s*[:：]?\s*억원/i.test(s)) return { label: '억원', multiplier: 100_000_000 };
  if (/단위\s*[:：]?\s*백만원/i.test(s)) return { label: '백만원', multiplier: 1_000_000 };
  if (/단위\s*[:：]?\s*천원/i.test(s)) return { label: '천원', multiplier: 1_000 };
  if (/단위\s*[:：]?\s*원/i.test(s)) return { label: '원', multiplier: 1 };
  return null;
}

function unitMultiplierFromLabel(label) {
  const s = String(label || '').toLowerCase();
  if (s.includes('조원')) return 1_000_000_000_000;
  if (s.includes('억원')) return 100_000_000;
  if (s.includes('백만원')) return 1_000_000;
  if (s.includes('천원')) return 1_000;
  if (s.includes('원')) return 1;
  return null;
}

/**
 * HTML/XML 태그를 모두 제거하여 순수 텍스트만 반환. 정규식 파싱은 하지 않음.
 * @param {string} html
 * @returns {string}
 */
function sanitizeDocumentToRawText(html) {
  if (!html || typeof html !== 'string') return '';
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * LLM으로 공시 텍스트에서 누계(누적) 실적·배당 수치 추출 (원(KRW) 절대 금액).
 * System: 기재정정 시 '정정 후' 우선, 단위 자동 감지 후 원 단위 정수로 환산.
 * Output: { period_label, revenue, op_income, net_income, dividend_per_share }
 * @param {string} text - 정제된 순수 텍스트
 * @param {{ apiKey?: string, baseURL?: string, model?: string }} [options]
 * @returns {Promise<{ period_label: string|null, revenue: number|null, op_income: number|null, net_income: number|null, dividend_per_share: number|null }>}
 */
async function extractFiguresViaLLM(text, options = {}) {
  const out = { period_label: null, revenue: null, op_income: null, net_income: null, dividend_per_share: null };
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey || !text || typeof text !== 'string') return out;
  const truncated = text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) + '…' : text;
  const detectedUnit = detectDeclaredUnit(truncated);
  const baseURL = options.baseURL || 'https://api.openai.com/v1';
  const model = options.model || 'gpt-4o-mini';
  const unitGuide = detectedUnit
    ? `문서 내 단위 표기는 "${detectedUnit.label}"로 감지됨(1 ${detectedUnit.label} = ${detectedUnit.multiplier}원). 반드시 이 단위를 적용해 원 단위 절대금액(Integer)으로 변환할 것.`
    : '문서 단위 표기가 불명확할 수 있으므로, 문맥상 단위를 추론하여 원 단위 절대금액(Integer)으로 변환할 것.';

  const systemPrompt = `주어진 공시 텍스트를 분석하여 최신 분기(또는 결산)의 누계(누적) 실적을 추출해라.
기재정정 공시인 경우 반드시 '정정 후' 수치를 우선할 것.
공시에 '당해실적'과 '누계실적(누적실적)'이 함께 있으면 반드시 누계실적만 사용하고, 당해실적은 절대 사용하지 마라.
누계/누적임이 명확하지 않으면 해당 값은 null로 둬라(당해실적으로 대체 금지).
단위(백만원, 억원 등)를 스스로 감지하여 반드시 '원(KRW)' 단위의 절대 금액(Integer)으로 환산해라.
${unitGuide}
응답은 반드시 아래 JSON만 출력하고, 없으면 null로 둬라. 다른 설명 금지.
period_label은 반드시 YYYY.[1-4]Q 형식(예: 2025.4Q)으로 반환하고, 판단 불가면 null.
가능하면 revenue_raw/op_income_raw/net_income_raw 에는 문서 원문 표기 단위(raw 숫자)를 넣고, unit_label에는 그 단위를 넣어라.
{"period_label": string|null, "unit_label": string|null, "revenue_raw": number|null, "op_income_raw": number|null, "net_income_raw": number|null, "revenue": number|null, "op_income": number|null, "net_income": number|null, "dividend_per_share": number|null}`;

  let res;
  try {
    res = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: truncated },
        ],
        temperature: 0,
      }),
    });
  } catch (_) {
    console.log('  [LLM] chat/completions request failed (network error)');
    return out;
  }
  if (!res.ok) {
    console.log(`  [LLM] chat/completions status=${res.status}`);
    return out;
  }
  let json;
  try {
    json = await res.json();
  } catch (_) {
    console.log('  [LLM] chat/completions JSON parse failed');
    return out;
  }
  const content = json.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') return out;
  const parsed = parseLLMJson(content);
  if (!parsed) return out;
  const unitLabel = parsed.unit_label || detectedUnit?.label || null;
  const unitMultiplier = unitMultiplierFromLabel(unitLabel) || detectedUnit?.multiplier || null;
  const revenueRaw = toNumberOrNull(parsed.revenue_raw);
  const opIncomeRaw = toNumberOrNull(parsed.op_income_raw);
  const netIncomeRaw = toNumberOrNull(parsed.net_income_raw);

  out.period_label = toPeriodLabelOrNull(parsed.period_label);
  out.revenue = (revenueRaw != null && unitMultiplier != null) ? Math.round(revenueRaw * unitMultiplier) : toNumberOrNull(parsed.revenue);
  out.op_income = (opIncomeRaw != null && unitMultiplier != null) ? Math.round(opIncomeRaw * unitMultiplier) : toNumberOrNull(parsed.op_income);
  out.net_income = (netIncomeRaw != null && unitMultiplier != null) ? Math.round(netIncomeRaw * unitMultiplier) : toNumberOrNull(parsed.net_income);
  out.dividend_per_share = toNumberOrNull(parsed.dividend_per_share);
  console.log(
    `  [LLM] Extracted period=${out.period_label ?? '-'} unit=${unitLabel ?? '-'} rev=${out.revenue ?? '-'} op=${out.op_income ?? '-'} net=${out.net_income ?? '-'} div=${out.dividend_per_share ?? '-'}`,
  );
  return out;
}

function toNumberOrNull(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toPeriodLabelOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;

  const m1 = s.match(/(20\d{2})\s*[\.\-\/]?\s*([1-4])\s*Q/i);
  if (m1) return `${m1[1]}.${m1[2]}Q`;

  const m2 = s.match(/(20\d{2})\s*년?\s*([1-4])\s*분기/i);
  if (m2) return `${m2[1]}.${m2[2]}Q`;

  const m3 = s.match(/\b(\d{2})\s*[\.\-\/]?\s*([1-4])\s*Q\b/i);
  if (m3) return `20${m3[1]}.${m3[2]}Q`;

  return null;
}

function parseLLMJson(content) {
  const trimmed = content.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}') + 1;
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end));
  } catch (_) {
    return null;
  }
}

module.exports = {
  sanitizeDocumentToRawText,
  extractFiguresViaLLM,
};
