const path = require('path');
const { readJson, writeJson, ensureDir } = require('./utils/file-utils');
const { requestJson } = require('./utils/opendart-client');

const API_BASE = 'https://opendart.fss.or.kr/api';

async function fetchFinancials(corpCode, apiKey, year) {
  // 정기보고서 단일회사 전체 재무제표 API (fnlttSinglAcntAll)
  const url = `${API_BASE}/fnlttSinglAcntAll.json`;
  // reprt_code 11011 = 사업보고서, fs_div CFS = 연결, OFS = 개별
  const data = await requestJson(
    url,
    {
      corp_code: corpCode,
      bsns_year: String(year),
      reprt_code: '11011',
      fs_div: 'CFS',
    },
    apiKey,
  );
  return data;
}

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

function toIndicators(rawList, year) {
  if (!Array.isArray(rawList) || !rawList.length) return null;

  // 매출액
  const revenueItem =
    findAccount(rawList, (id, nm) => id.includes('ifrs-full_revenue') || nm.includes('매출액')) ||
    findAccount(rawList, (id, nm) => nm.includes('수익'));

  // 영업이익
  const opIncomeItem =
    findAccount(rawList, (id, nm) => id.includes('operatingincomeloss') || nm.includes('영업이익')) ||
    findAccount(rawList, (id, nm) => nm.includes('영업손익'));

  // 당기순이익
  const netIncomeItem =
    findAccount(rawList, (id, nm) => id.includes('profitloss') || nm.includes('당기순이익')) ||
    findAccount(rawList, (id, nm) => nm.includes('분기순이익'));

  // 자산 / 부채 / 자본
  const totalAssetsItem =
    findAccount(rawList, (id, nm) => id.includes('assets') && !id.includes('current')) ||
    findAccount(rawList, (id, nm) => nm.includes('자산총계'));

  const liabilitiesItem =
    findAccount(rawList, (id, nm) => id.includes('liabilities') && !id.includes('current')) ||
    findAccount(rawList, (id, nm) => nm.includes('부채총계'));

  const equityItem =
    findAccount(rawList, (id, nm) => id.includes('equity') || nm.includes('자본총계')) ||
    findAccount(rawList, (id, nm) => nm.includes('지배기업 소유주지분'));

  const revenue = revenueItem ? parseAmount(revenueItem.thstrm_amount) : null;
  const opIncome = opIncomeItem ? parseAmount(opIncomeItem.thstrm_amount) : null;
  const netIncome = netIncomeItem ? parseAmount(netIncomeItem.thstrm_amount) : null;
  const totalAssets = totalAssetsItem ? parseAmount(totalAssetsItem.thstrm_amount) : null;
  const liabilities = liabilitiesItem ? parseAmount(liabilitiesItem.thstrm_amount) : null;
  const equity = equityItem ? parseAmount(equityItem.thstrm_amount) : null;

  const roe = equity ? (netIncome / equity) * 100 : null;
  const roa = totalAssets ? (netIncome / totalAssets) * 100 : null;
  const debtRatio = equity ? (liabilities / equity) * 100 : null;

  return {
    year,
    quarter: null,
    revenue,
    op_income: opIncome,
    net_income: netIncome,
    equity,
    total_assets: totalAssets,
    debt: liabilities,
    roe,
    roa,
    debt_ratio: debtRatio,
  };
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
        if (raw.status !== '000') {
          console.warn(`Open DART 응답 상태 코드: ${raw.status} (${raw.message})`);
          continue;
        }
        const indicator = toIndicators(raw.list || [], year);
        if (indicator) {
          items.push(indicator);
        } else {
          console.warn(`재무 지표를 계산할 수 없습니다: ${corpCode} / ${year}`);
        }
      } catch (e) {
        console.error(`재무정보 동기화 실패: ${corpCode} / ${year}`, e.message || e);
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

