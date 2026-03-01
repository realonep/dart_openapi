const path = require('path');
const fs = require('fs/promises');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { createJsonProvider } = require('./data-providers/json-provider');
const { createLibsqlProvider } = require('./data-providers/libsql-provider');

const ROOT = path.resolve(__dirname, '..');
const DATA_ROOT = path.join(ROOT, 'data');
const GOLDEN_PATH = path.join(__dirname, 'fixtures', 'db-contract-golden.json');

function unique(arr) {
  return Array.from(new Set(arr));
}

function sortByString(arr) {
  return [...arr].sort((a, b) => String(a).localeCompare(String(b)));
}

function compact(value) {
  if (Array.isArray(value)) {
    return value.map(compact);
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      const v = value[key];
      if (v === undefined) continue;
      out[key] = compact(v);
    }
    return out;
  }
  return value;
}

function stringifyStable(value) {
  return JSON.stringify(compact(value));
}

function summaryIndex(index) {
  const list = Array.isArray(index) ? index : [];
  const codes = sortByString(list.map((x) => x.corp_code).filter(Boolean));
  return {
    count: list.length,
    corp_codes: codes,
  };
}

function summaryDetail(detail) {
  if (!detail) {
    return {
      exists: false,
    };
  }

  const financialItems = Array.isArray(detail.financials?.items) ? detail.financials.items : [];
  const dividendItems = Array.isArray(detail.dividends?.items) ? detail.dividends.items : [];
  const guidanceItems = Array.isArray(detail.guidance?.items) ? detail.guidance.items : [];
  const treasuryItems = Array.isArray(detail.treasury?.items) ? detail.treasury.items : [];

  const financialYears = sortByString(financialItems.map((x) => x.year)).map((x) => Number(x));
  const dividendYears = sortByString(dividendItems.map((x) => x.year)).map((x) => Number(x));
  const guidanceRceptNos = sortByString(guidanceItems.map((x) => x.rcept_no).filter(Boolean));
  const treasuryRceptNos = sortByString(treasuryItems.map((x) => x.rcept_no).filter(Boolean));

  return {
    exists: true,
    overview_corp_code: detail.overview?.corp_code || null,
    overview_stock_code: detail.overview?.stock_code || null,
    financial_years: financialYears,
    financial_latest_year: financialYears.length ? Math.max(...financialYears) : null,
    dividend_years: dividendYears,
    guidance_rcept_no: guidanceRceptNos,
    treasury_rcept_no: treasuryRceptNos,
    financial_count: financialItems.length,
    dividend_count: dividendItems.length,
    guidance_count: guidanceItems.length,
    treasury_count: treasuryItems.length,
  };
}

function parseArgv() {
  const args = process.argv.slice(2).filter((a) => a !== '--update-golden');
  const updateGolden = process.argv.includes('--update-golden');
  return { corpCodesArg: args, updateGolden };
}

async function readGolden() {
  try {
    const raw = await fs.readFile(GOLDEN_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

async function main() {
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'file:local.db';

  const { corpCodesArg, updateGolden } = parseArgv();

  const jsonProvider = createJsonProvider({ dataRoot: DATA_ROOT });
  const dbProvider = createLibsqlProvider({
    fallbackProvider: jsonProvider,
    strictReads: true,
  });

  const jsonIndex = await jsonProvider.getCorpIndex();
  const dbIndex = await dbProvider.getCorpIndex();
  const jsonIndexSummary = summaryIndex(jsonIndex);
  const dbIndexSummary = summaryIndex(dbIndex);

  const mismatches = [];
  if (stringifyStable(jsonIndexSummary) !== stringifyStable(dbIndexSummary)) {
    mismatches.push({
      type: 'index',
      json: jsonIndexSummary,
      db: dbIndexSummary,
    });
  }

  const targetCorpCodes = corpCodesArg.length
    ? unique(corpCodesArg)
    : jsonIndexSummary.corp_codes;

  const detailSummariesJson = {};
  const detailSummariesDb = {};

  for (const corpCode of targetCorpCodes) {
    const [jsonDetail, dbDetail] = await Promise.all([
      jsonProvider.getCorpDetailBase(corpCode),
      dbProvider.getCorpDetailBase(corpCode),
    ]);
    const jsonSummary = summaryDetail(jsonDetail);
    const dbSummary = summaryDetail(dbDetail);
    detailSummariesJson[corpCode] = jsonSummary;
    detailSummariesDb[corpCode] = dbSummary;
    if (stringifyStable(jsonSummary) !== stringifyStable(dbSummary)) {
      mismatches.push({
        type: 'corp_detail',
        corp_code: corpCode,
        json: jsonSummary,
        db: dbSummary,
      });
    }
  }

  if (mismatches.length > 0) {
    console.error(`[db:verify] mismatches=${mismatches.length}`);
    console.error(JSON.stringify(mismatches, null, 2));
    process.exit(1);
  }

  if (updateGolden) {
    const golden = {
      saved_at: new Date().toISOString(),
      index: jsonIndexSummary,
      corp_codes: targetCorpCodes,
      details: detailSummariesJson,
    };
    await fs.mkdir(path.dirname(GOLDEN_PATH), { recursive: true });
    await fs.writeFile(GOLDEN_PATH, JSON.stringify(golden, null, 2), 'utf-8');
    console.log(`[db:verify] OK corp_count=${targetCorpCodes.length} (json vs db match); golden updated at ${GOLDEN_PATH}`);
    return;
  }

  const golden = await readGolden();
  if (golden) {
    const goldenMismatches = [];
    if (stringifyStable(golden.index) !== stringifyStable(dbIndexSummary)) {
      goldenMismatches.push({ type: 'index', expected: golden.index, actual: dbIndexSummary });
    }
    for (const corpCode of targetCorpCodes) {
      const expected = golden.details?.[corpCode];
      const actual = detailSummariesDb[corpCode];
      if (expected === undefined && actual?.exists) {
        goldenMismatches.push({ type: 'corp_detail', corp_code: corpCode, expected: null, actual });
      } else if (expected && stringifyStable(expected) !== stringifyStable(actual)) {
        goldenMismatches.push({ type: 'corp_detail', corp_code: corpCode, expected, actual });
      }
    }
    if (goldenMismatches.length > 0) {
      console.error(`[db:verify] golden mismatches=${goldenMismatches.length} (DB vs saved snapshot)`);
      console.error(JSON.stringify(goldenMismatches, null, 2));
      process.exit(1);
    }
    console.log(`[db:verify] OK corp_count=${targetCorpCodes.length} (json vs db + golden match)`);
  } else {
    console.log(`[db:verify] OK corp_count=${targetCorpCodes.length} (json vs db summaries match)`);
  }
}

main().catch((err) => {
  console.error(`[db:verify] failed: ${err.message}`);
  process.exit(1);
});
