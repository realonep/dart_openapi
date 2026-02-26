const path = require('path');
const { readJson, writeJson, ensureDir } = require('./utils/file-utils');
const { requestJson } = require('./utils/opendart-client');

const API_BASE = 'https://opendart.fss.or.kr/api';

async function fetchCorpOverview(corpCode, apiKey) {
  // 실제로는 /company.json 또는 이에 상응하는 Open DART 엔드포인트를 사용해야 합니다.
  const url = `${API_BASE}/company.json`;
  const data = await requestJson(url, { corp_code: corpCode }, apiKey);
  return data;
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
    console.log(`기업 개황 동기화: ${corpCode}`);
    try {
      const overview = await fetchCorpOverview(corpCode, apiKey);
      overview.last_updated_at = new Date().toISOString().slice(0, 10);
      const outDir = path.join(__dirname, '..', 'data', 'corp', corpCode);
      ensureDir(outDir);
      writeJson(path.join(outDir, 'overview.json'), overview);
    } catch (e) {
      console.error(`기업 개황 동기화 실패: ${corpCode}`, e.message);
    }
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

