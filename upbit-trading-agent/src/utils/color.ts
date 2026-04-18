/**
 * ANSI 컬러 유틸리티 (외부 라이브러리 없음)
 *
 * 터미널 출력에서 '돈의 흐름'을 한눈에 파악할 수 있도록
 * 이벤트 종류별로 색상을 명확히 구분합니다.
 *
 *   🟢 매수 (BUY / DCA)     → 초록색
 *   🔴 매도 (SELL / 손절)   → 빨간색
 *   ✨ 익절 (트레일링 스탑)  → 노란색 굵게
 *   🔥 오류 (ERROR)         → 빨간 배경 + 흰 글씨
 *   🔵 감시 (INFO / WATCH)  → 시안색
 */

// ── ANSI 이스케이프 코드 ──────────────────────────────────────────────────────

const R = '\x1b[0m';  // Reset

export const ANSI = {
  reset:      R,
  bold:       '\x1b[1m',

  // 전경색
  green:      '\x1b[32m',
  red:        '\x1b[31m',
  yellow:     '\x1b[33m',
  cyan:       '\x1b[36m',
  white:      '\x1b[37m',
  gray:       '\x1b[90m',

  // 배경 + 전경 조합
  redBgWhite: '\x1b[41m\x1b[97m',
} as const;

// ── 메시지 종류 판별 ─────────────────────────────────────────────────────────

function isBuy(msg: string):   boolean { return msg.includes('[매수]') || msg.includes('[DCA'); }
function isSell(msg: string):  boolean { return msg.includes('[매도]') || msg.includes('[손절]'); }
function isProfit(msg: string): boolean { return msg.includes('[익절]'); }
function isError(msg: string): boolean {
  return msg.includes('[ERROR]') || msg.includes('[error]') || msg.includes('Fatal');
}

// ── 공개 API ─────────────────────────────────────────────────────────────────

/**
 * TRADE 레벨 메시지에 내용 기반 색상을 적용합니다.
 * 파일 로그에는 적용하지 말고 콘솔 출력에만 사용하세요.
 */
export function colorTrade(msg: string): string {
  if (isBuy(msg))    return `${ANSI.bold}${ANSI.green}${msg}${R}`;
  if (isProfit(msg)) return `${ANSI.bold}${ANSI.yellow}${msg}${R}`;
  if (isSell(msg))   return `${ANSI.bold}${ANSI.red}${msg}${R}`;
  return `${ANSI.cyan}${msg}${R}`;
}

/**
 * ERROR 레벨 메시지에 빨간 배경 색상을 적용합니다.
 */
export function colorError(msg: string): string {
  return `${ANSI.redBgWhite} ${msg} ${R}`;
}
