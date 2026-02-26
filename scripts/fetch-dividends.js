const path = require('path');
const { readJson, writeJson, ensureDir } = require('./utils/file-utils');
const { requestJson } = require('./utils/opendart-client');

const API_BASE = 'https://opendart.fss.or.kr/api';

async function fetchDividendReports(corpCode, apiKey) {
  // 실제로는 공시목록 API를 활용해 배당 관련 공시를 필터링해야 합니다.
  const url = `${API_BASE}/list.json`;
  const data = await requestJson(
    url,
    {
      corp_code: corpCode,
      bgn_de: '20160101',
      end_de: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
      page_no: 1,
      page_count: 100,
    },
    apiKey,
  );
  return data;
}

function parseDividendsFromReports(reports) {
  // TODO: 실제 보고서 본문 또는 상세 API를 사용해 배당 정보를 파싱하는 로직을 구현합니다.
  // 현재는 빈 배열을 반환합니다.
  return [];
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

  for (const corpCode of corps) {
    console.log(`배당 데이터 동기화: ${corpCode}`);
    try {
      const raw = await fetchDividendReports(corpCode, apiKey);
      const items = parseDividendsFromReports(raw.list || []);
      const outDir = path.join(__dirname, '..', 'data', 'corp', corpCode);
      ensureDir(outDir);
      writeJson(
        path.join(outDir, 'dividends.json'),
        {
          corp_code: corpCode,
          items,
          last_updated_at: new Date().toISOString().slice(0, 10),
        },
      );
    } catch (e) {
      console.error(`배당 데이터 동기화 실패: ${corpCode}`, e.message);
    }
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

