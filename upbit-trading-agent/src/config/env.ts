/**
 * 환경변수 검증 및 파싱
 *
 * validateEnv() 를 봇 진입점(run-paper-trading.ts, index.ts)에서
 * dotenv 로드 직후 호출하면, 필수값 누락 시 즉시 종료되고 원인을 안내합니다.
 *
 * 다른 모듈은 process.env 직접 접근 대신 여기서 export된 env 객체를 사용합니다.
 */

import 'dotenv/config';

// ── 파싱 헬퍼 ────────────────────────────────────────────────────────────────

function str(key: string, defaultVal: string): string {
  return process.env[key]?.trim() || defaultVal;
}

function num(key: string, defaultVal: number): number {
  const val = process.env[key];
  const parsed = val !== undefined ? Number(val) : NaN;
  return Number.isFinite(parsed) ? parsed : defaultVal;
}

// ── 파싱된 환경변수 객체 ──────────────────────────────────────────────────────

export const env = {
  // 인증 (필수 — validateEnv 에서 검증)
  upbitAccessKey: process.env['UPBIT_ACCESS_KEY']?.trim() ?? '',
  upbitSecretKey: process.env['UPBIT_SECRET_KEY']?.trim() ?? '',

  // 운영 모드
  tradingMode: str('TRADING_MODE', 'paper') as 'paper' | 'live',

  // 매매 한도
  maxOrderKrw:    num('MAX_ORDER_KRW',    100_000),
  maxPositions:   num('MAX_POSITIONS',    3),
  initialKrw:     num('INITIAL_KRW',      1_000_000),
  dailyLossLimit: num('DAILY_LOSS_LIMIT', 0.05),   // 일일 최대 손실률 (기본 5%)

  // 전략 파라미터
  /** N일 고점 돌파 전략의 N값 (기본 20일, 터틀 트레이딩 기준) */
  nDayPeriod:  num('N_DAY_PERIOD',  20),
  topNMarkets: num('TOP_N_MARKETS', 4),
  targetMarkets: process.env['TARGET_MARKETS']
    ? process.env['TARGET_MARKETS'].split(',').map((m) => m.trim())
    : null,

  // 시스템
  dbPath:        str('DB_PATH',   './data/trading.db'),
  healthPort:    num('HEALTH_PORT', 3000),
  intervalSec:   num('INTERVAL_SEC', 60),
  writeStatusFile: process.env['WRITE_STATUS_FILE'] !== 'false',

  // 서킷 브레이커
  circuitFailureThreshold: num('CIRCUIT_FAILURE_THRESHOLD', 5),
  circuitResetTimeoutMs:   num('CIRCUIT_RESET_TIMEOUT_MS',  60_000),

  // 알림 (없으면 null → 조용히 건너뜀)
  discordWebhookUrl: process.env['DISCORD_WEBHOOK_URL']?.trim() || null,
} as const;

// ── 필수값 검증 ───────────────────────────────────────────────────────────────

const PLACEHOLDER_VALUES = new Set(['your_access_key_here', 'your_secret_key_here', '']);

/**
 * 필수 환경변수가 모두 설정되었는지 확인합니다.
 *
 * 누락된 항목이 있으면 설정 방법을 안내한 뒤 process.exit(1) 로 종료합니다.
 * 봇 진입점에서 dotenv 로드 직후에 호출하세요.
 *
 * @example
 * import 'dotenv/config';
 * import { validateEnv } from './config/env';
 * validateEnv();
 */
export function validateEnv(): void {
  const missing: string[] = [];

  if (PLACEHOLDER_VALUES.has(env.upbitAccessKey)) missing.push('UPBIT_ACCESS_KEY');
  if (PLACEHOLDER_VALUES.has(env.upbitSecretKey)) missing.push('UPBIT_SECRET_KEY');

  if (missing.length === 0) return;

  const sep = '─'.repeat(60);
  const lines = [
    '',
    sep,
    '[봇 시작 실패] 필수 환경변수가 설정되지 않았습니다.',
    '',
    `  누락된 항목: ${missing.join(', ')}`,
    '',
    '  설정 방법:',
    '    1. cp .env.example .env',
    '    2. .env 파일에 실제 API 키 입력',
    '    3. https://upbit.com/mypage/open_api_management 에서 발급',
    sep,
    '',
  ];

  console.error(lines.join('\n'));
  process.exit(1);
}
