/**
 * DART 공시대상회사 목록 다운로드 → data/meta/corp-code-list.json 생성.
 * 전체 상장사 검색(/api/search-corps)에서 사용.
 * 실행: node scripts/fetch-corp-code-list.js (OPENDART_API_KEY 필요)
 */
const path = require('path');
const AdmZip = require('adm-zip');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { requestBinary } = require('./utils/opendart-client');
const { writeJson, ensureDir } = require('./utils/file-utils');
const { createHybridLibsqlClient } = require('./db/libsql-client');
const { ensureSchema } = require('./db/schema');

const API_URL = 'https://opendart.fss.or.kr/api/corpCode.xml';
const ROOT = path.resolve(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'data', 'meta', 'corp-code-list.json');

function parseXmlList(xmlStr) {
  const list = [];
  const re = /<list>([\s\S]*?)<\/list>/g;
  let m;
  while ((m = re.exec(xmlStr)) !== null) {
    const block = m[1];
    const corpCode = block.match(/<corp_code>([^<]*)<\/corp_code>/)?.[1]?.trim();
    const corpName = block.match(/<corp_name>([^<]*)<\/corp_name>/)?.[1]?.trim();
    const stockCode = block.match(/<stock_code>([^<]*)<\/stock_code>/)?.[1]?.trim();
    const modifyDate = block.match(/<modify_date>([^<]*)<\/modify_date>/)?.[1]?.trim() || null;
    if (corpCode) {
      list.push({
        corp_code: corpCode,
        corp_name: corpName || '',
        stock_code: stockCode || '',
        modify_date: modifyDate || null,
      });
    }
  }
  return list;
}

function bufferToUtf8(buf) {
  if (!buf || !buf.length) return '';
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.slice(3).toString('utf8');
  }
  try {
    return buf.toString('utf8');
  } catch (_) {
    try {
      return buf.toString('euc-kr');
    } catch (__) {
      return buf.toString('utf8', 'ignore');
    }
  }
}

async function main() {
  const apiKey = process.env.OPENDART_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('환경변수 OPENDART_API_KEY가 필요합니다.');
  }

  const zipBuffer = await requestBinary(API_URL, {}, apiKey);
  if (!zipBuffer || zipBuffer.length < 100) {
    throw new Error('corpCode 응답이 비어 있거나 너무 짧습니다.');
  }

  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();
  const xmlEntry = entries.find((e) => !e.isDirectory && /\.xml$/i.test(e.entryName));
  if (!xmlEntry) {
    throw new Error('ZIP 내 XML 파일을 찾을 수 없습니다.');
  }

  const raw = xmlEntry.getData();
  const xmlStr = bufferToUtf8(raw);
  let items = parseXmlList(xmlStr);
  // 코스피·코스닥 상장사만: DART XML에는 시장 구분이 없어 종목코드(stock_code) 유무로 상장사만 필터
  const before = items.length;
  items = items.filter((it) => {
    const code = String(it.stock_code || '').trim();
    return code.length >= 5 && /^\d+$/.test(code);
  });
  if (items.length < before) {
    console.log(`[fetch-corp-code-list] 상장사만 필터: ${before} → ${items.length}건 (종목코드 있는 법인만)`);
  }

  ensureDir(path.dirname(OUT_PATH));

  const now = new Date();
  const listDate = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  writeJson(OUT_PATH, {
    list_date: listDate,
    updated_at: now.toISOString(),
    count: items.length,
    items,
  });
  console.log(`[fetch-corp-code-list] saved ${items.length} items list_date=${listDate} to ${OUT_PATH}`);

  const writeCorpMaster = /^1|true|yes|y$/i.test(String(process.env.WRITE_CORP_MASTER || '').trim());
  if (!writeCorpMaster) {
    console.log('[fetch-corp-code-list] corp_master DB 적재 생략 (WRITE_CORP_MASTER=1 시에만 적재). 검색은 corp-code-list.json 사용.');
    return;
  }

  const updatedAt = new Date().toISOString();
  try {
    const { client } = createHybridLibsqlClient(process.env);
    await ensureSchema(client);
    await client.execute({ sql: 'DELETE FROM corp_master', args: [] });
    for (const it of items) {
      await client.execute({
        sql: `INSERT INTO corp_master (corp_code, corp_name, stock_code, modify_date, updated_at) VALUES (?, ?, ?, ?, ?)`,
        args: [
          it.corp_code || '',
          it.corp_name || null,
          it.stock_code || null,
          it.modify_date || null,
          updatedAt,
        ],
      });
    }
    console.log(`[fetch-corp-code-list] corp_master DB upserted ${items.length} rows`);
  } catch (e) {
    console.warn('[fetch-corp-code-list] DB write skipped:', e.message);
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { parseXmlList, bufferToUtf8 };
