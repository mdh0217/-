/**
 * 봇 모니터링 대시보드
 *
 * 사용법: node scripts/dashboard.js
 *
 * 동작:
 *   - 매 1시간: 화면 지우고 상태 한 줄 표시
 *   - 거래(매수/매도) 또는 오류 발생 시: 즉시 상세 보고
 *   - 평소: 화면 상단 상태 줄만 유지
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT          = path.resolve(__dirname, '..');
const STATUS_FILE   = path.join(ROOT, 'current-status.txt');
const LOG_DIR       = path.join(ROOT, 'logs');
const DB_PATH       = path.join(ROOT, 'data', 'trading.db');
const INITIAL_KRW   = parseInt(process.env['INITIAL_KRW'] ?? '1000000', 10);
const HEALTH_MS     = 60 * 60 * 1000; // 1시간

// ── 포맷 헬퍼 ─────────────────────────────────────────────────────────────────

function krw(n) {
  return Math.round(n).toLocaleString('ko-KR') + '원';
}

function pct(n) {
  return (n >= 0 ? '+' : '') + (n * 100).toFixed(2) + '%';
}

function timeStr(date) {
  const d = date ?? new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((v) => String(v).padStart(2, '0'))
    .join(':');
}

function nextCheckStr(fromMs) {
  const next = new Date(Date.now() + fromMs);
  return `${String(next.getHours()).padStart(2, '0')}:${String(next.getMinutes()).padStart(2, '0')}`;
}

// ── DB 잔고 조회 ──────────────────────────────────────────────────────────────

async function getBalance() {
  try {
    if (!fs.existsSync(DB_PATH)) {return null;}

    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs({
      locateFile: (file) => path.join(ROOT, 'node_modules', 'sql.js', 'dist', file),
    });

    const db = new SQL.Database(fs.readFileSync(DB_PATH));

    const balRows = db.exec("SELECT available FROM virtual_balance WHERE currency='KRW'");
    const krwAvail = balRows[0]?.values[0]?.[0] ?? 0;

    const posRows = db.exec("SELECT COALESCE(SUM(total_invested),0) FROM positions WHERE status='open'");
    const totalInvested = posRows[0]?.values[0]?.[0] ?? 0;

    const posCountRows = db.exec("SELECT COUNT(*) FROM positions WHERE status='open'");
    const openCount = posCountRows[0]?.values[0]?.[0] ?? 0;

    db.close();

    const totalValue  = krwAvail + totalInvested;
    const profit      = totalValue - INITIAL_KRW;
    const profitRate  = profit / INITIAL_KRW;

    return { krwAvail, totalInvested, totalValue, profit, profitRate, openCount };
  } catch {
    return null;
  }
}

// ── 상태 한 줄 출력 ───────────────────────────────────────────────────────────

let nextHealthTime = Date.now() + HEALTH_MS;

async function showStatus(clearFirst = true) {
  if (clearFirst) {process.stdout.write('\x1Bc');}

  const now  = new Date();
  const bal  = await getBalance();
  const next = nextCheckStr(nextHealthTime - Date.now());

  let balStr    = '잔고 조회 중';
  let profitStr = '-';
  let posStr    = '';

  if (bal) {
    balStr    = krw(bal.krwAvail);
    profitStr = `${pct(bal.profitRate)} (${krw(bal.profit)})`;
    posStr    = ` | 포지션: ${bal.openCount}개`;
  }

  const line = `[ ${timeStr(now)} | 잔고: ${balStr}${posStr} | 수익: ${profitStr} | 다음체크: ${next} ]`;
  console.log('─'.repeat(line.length));
  console.log(line);
  console.log('─'.repeat(line.length));
  console.log('');
}

// ── 거래/오류 로그 감시 ───────────────────────────────────────────────────────

function todayLogPath(prefix) {
  const d    = new Date();
  const date = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
  return path.join(LOG_DIR, `${prefix}-${date}.log`);
}

/**
 * 파일의 새 줄을 스트리밍합니다.
 * 파일이 없으면 생성될 때까지 polling합니다.
 */
function tailFile(filePath, onLine) {
  let pos = 0;

  function tryRead() {
    try {
      if (!fs.existsSync(filePath)) {return;}
      const stat = fs.statSync(filePath);
      if (stat.size <= pos) {return;}
      const fd  = fs.openSync(filePath, 'r');
      const buf = Buffer.alloc(stat.size - pos);
      fs.readSync(fd, buf, 0, buf.length, pos);
      fs.closeSync(fd);
      pos = stat.size;
      const text = buf.toString('utf8');
      text.split('\n').filter(Boolean).forEach(onLine);
    } catch {
      // 읽기 실패는 조용히 무시
    }
  }

  // 파일 끝으로 초기 위치 이동 (과거 로그는 무시)
  try {
    if (fs.existsSync(filePath)) {
      pos = fs.statSync(filePath).size;
    }
  } catch { /* ignore */ }

  return setInterval(tryRead, 1000);
}

function isTradeOrError(line) {
  return (
    line.includes('[TRADE]') ||
    line.includes('[매수]')  ||
    line.includes('[매도]')  ||
    line.includes('[손절]')  ||
    line.includes('[익절]')  ||
    line.includes('[DCA')    ||
    line.includes('[ERROR]') ||
    line.includes('[error]') ||
    line.includes('Fatal')
  );
}

function onLogLine(line) {
  if (!isTradeOrError(line)) {return;}

  const isTrade = !line.includes('[ERROR]') && !line.includes('[error]') && !line.includes('Fatal');
  const prefix  = isTrade ? '🔔 거래' : '🚨 오류';
  console.log(`\n${prefix}: ${line}`);
}

// ── 메인 ─────────────────────────────────────────────────────────────────────

async function main() {
  // 시작 시 즉시 상태 표시
  await showStatus(true);

  // 1시간 헬스체크 타이머
  setInterval(async () => {
    nextHealthTime = Date.now() + HEALTH_MS;
    await showStatus(true);
  }, HEALTH_MS);

  // 거래 로그 감시 (1초 polling)
  tailFile(todayLogPath('trades'),  onLogLine);
  tailFile(todayLogPath('trading'), onLogLine);
  tailFile(path.join(LOG_DIR, 'error.log'), onLogLine);

  // 자정에 오늘 날짜 로그 파일로 교체
  const msToMidnight = () => {
    const now  = new Date();
    const next = new Date(now);
    next.setHours(24, 0, 5, 0);
    return next.getTime() - now.getTime();
  };

  setTimeout(() => {
    tailFile(todayLogPath('trades'),  onLogLine);
    tailFile(todayLogPath('trading'), onLogLine);
  }, msToMidnight());
}

main().catch((err) => {
  console.error('[dashboard] 오류:', err.message);
  process.exit(1);
});
