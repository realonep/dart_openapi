const path = require('path');
const { readJson, writeJson, ensureDir } = require('./utils/file-utils');
const { requestJson } = require('./utils/opendart-client');

const API_BASE = 'https://opendart.fss.or.kr/api';

async function fetchFinancials(corpCode, apiKey, year) {
  // 실제로는 정기보고서 재무정보 API(예: fnlttSinglAcntAll.json 등)를 사용해야 합니다.
  const url = `${API_BASE}/fnlttSinglAcntAll.json`;
  const data = await requestJson(url, { corp_code: corpCode, bsns_year: year, reprt_code: '11011' }, apiKey);
  return data;
}

function toIndicators(rawItems) {
  // TODO: Open DART 응답 구조에 맞게 매출/이익과 ROE/ROA/부채비율을 계산하도록 구현합니다.
  // 현재는 그대로 반환합니다.
  return rawItems;
}

async function main() {
  const apiKey = process.env.OPENDART_API_KEY;
  if (!apiKey) {
    throw new Error('환경변수 OPENDART_API_KEY 가 설정되어 있지 않습니다.');
  }

  const configPath = path.join(__dirname, '..', 'data', 'meta', 'companies-config.json');
  const config = readJson(configPath, { target_corps: [] });
  const corps = config.target_corps || [];

  if (!corps.length) {
    console.log('companies-config.json 에 target_corps 가 비어 있습니다. 동기화할 기업이 없습니다.');
    return;
  }

  const currentYear = new Date().getFullYear();
  const years = [];
  for (let y = currentYear - 5; y <= currentYear; y++) {
    years.push(y);
  }

  for (const corpCode of corps) {
    const items = [];
    for (const year of years) {
      console.log(`재무정보 동기화: ${corpCode} / ${year}`);
      try {
        const raw = await fetchFinancials(corpCode, apiKey, year);
        const converted = toIndicators(raw.list || []);
        items.push(...converted);
      } catch (e) {
        console.error(`재무정보 동기화 실패: ${corpCode} / ${year}`, e.message);
      }
    }

    const outDir = path.join(__dirname, '..', 'data', 'corp', corpCode);
    ensureDir(outDir);
    writeJson(
      path.join(outDir, 'financials.json'),
      {
        corp_code: corpCode,
        items,
        last_updated_at: new Date().toISOString().slice(0, 10),
      },
    );
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

