/**
 * 거래일 기준 상장사 목록 하루 1회 갱신.
 * - 목록에 list_date(YYYY-MM-DD)가 있고, 오늘이 거래일이며, list_date가 오늘보다 이전일 때만 갱신.
 * - 휴일이거나 list_date가 오늘이면 스킵.
 * 실행: npm run fetch:corp-code-list:daily (cron/Actions에서 하루 1회 호출)
 */
const path = require('path');
const fsp = require('fs/promises');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ROOT = path.resolve(__dirname, '..');
const META_PATH = path.join(ROOT, 'data', 'meta', 'corp-code-list.json');

function getTodayKst() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

function isTradingDayKst(dateStr) {
  const d = new Date(dateStr + 'T12:00:00+09:00');
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return true;
}

async function getCurrentListDate() {
  try {
    const raw = await fsp.readFile(META_PATH, 'utf-8');
    const data = JSON.parse(raw);
    return data.list_date || data.updated_at?.slice(0, 10) || null;
  } catch (_) {
    return null;
  }
}

async function main() {
  const today = getTodayKst();
  if (!isTradingDayKst(today)) {
    console.log(`[ensure-corp-list-daily] skip: ${today} is not a trading day (weekend).`);
    process.exit(0);
  }

  const currentListDate = await getCurrentListDate();
  if (currentListDate === today) {
    console.log(`[ensure-corp-list-daily] skip: list_date already ${today}.`);
    process.exit(0);
  }

  console.log(`[ensure-corp-list-daily] run: list_date=${currentListDate || 'none'} today=${today}`);
  const { spawn } = require('child_process');
  const scriptPath = path.join(__dirname, 'fetch-corp-code-list.js');
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      env: process.env,
      cwd: ROOT,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`fetch-corp-code-list exited ${code}`));
      else resolve();
    });
  });
  console.log('[ensure-corp-list-daily] done.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
