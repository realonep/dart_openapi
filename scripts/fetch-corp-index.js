const path = require('path');
const { writeJson } = require('./utils/file-utils');

// TODO: Open DART의 corpCode API를 호출해 전체 기업 목록을 내려받고 파싱하는 로직으로 교체합니다.

async function main() {
  const outPath = path.join(__dirname, '..', 'data', 'corp-index.json');

  // 현재는 샘플 데이터를 그대로 둡니다.
  console.log('corp-index.json 은 예시 데이터로 초기화되어 있습니다.');
  console.log(`필요 시 ${outPath} 를 Open DART 기반 생성 로직으로 교체하세요.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

