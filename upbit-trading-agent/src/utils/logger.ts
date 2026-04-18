/**
 * 프로젝트 전역 로거
 *
 * 출력 채널:
 *   콘솔          — 모든 레벨 (ERROR: 빨간색)
 *   logs/trading  — 모든 레벨 (daily rotate, 10 MB, 14일)
 *   logs/trades   — trade 레벨만 (매수·매도 이벤트 전용)
 *
 * 공개 API:
 *   logger.info()  / logger.warn()  / logger.error() / logger.debug()
 *   logger.trade() — [TRADE] 접두사 자동 추가, trades.log 에도 기록
 */

import * as winston          from 'winston';
import DailyRotateFile       from 'winston-daily-rotate-file';
import * as fs               from 'fs';
import * as path             from 'path';
import { colorTrade, colorError, ANSI } from './color';

// ── 로그 디렉토리 보장 ────────────────────────────────────────────────────────

const LOG_DIR      = path.resolve(process.cwd(), 'logs');
const LOG_MAX_DAYS = 7;

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * 봇 시작 시 LOG_MAX_DAYS 일보다 오래된 로그 파일을 삭제합니다.
 * Windows에서 파일이 잠겨 있어도 엔진이 멈추지 않도록 try-catch로 보호합니다.
 */
function cleanupOldLogs(): void {
  try {
    const cutoff = Date.now() - LOG_MAX_DAYS * 24 * 60 * 60 * 1000;
    const files  = fs.readdirSync(LOG_DIR);

    for (const file of files) {
      if (!file.endsWith('.log')) continue;
      const filePath = path.join(LOG_DIR, file);
      try {
        const { mtimeMs } = fs.statSync(filePath);
        if (mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
        }
      } catch {
        // 파일이 잠겨있거나 삭제 실패 시 조용히 무시
      }
    }
  } catch {
    // logs/ 디렉토리 접근 실패 시 조용히 무시
  }
}

cleanupOldLogs();

// ── 커스텀 레벨 ───────────────────────────────────────────────────────────────
//   숫자가 낮을수록 우선순위 높음 (winston 기본 규칙)
//   trade 레벨을 warn 과 info 사이에 배치

const CUSTOM_LEVELS = {
  error: 0,
  warn:  1,
  trade: 2,
  info:  3,
  debug: 4,
} as const;

winston.addColors({
  error: 'red bold',
  warn:  'yellow',
  trade: 'cyan bold',
  info:  'white',
  debug: 'gray',
});

// ── 포맷 헬퍼 ────────────────────────────────────────────────────────────────

/** [2026-04-14 18:30:05.123] 형태의 타임스탬프 (ms 단위 포함) */
const tsFormat = winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' });

/** 최종 출력 행 포맷 */
const printfFmt = winston.format.printf(({ timestamp, level, message }) =>
  `[${String(timestamp)}] [${level.toUpperCase().padEnd(5)}] ${String(message)}`,
);

/**
 * trade 레벨만 통과시키는 필터.
 * winston.format 은 false 를 반환하면 해당 메시지를 드롭합니다.
 */
const tradeOnlyFilter = winston.format((info) =>
  info['level'] === 'trade' ? info : false,
)();

/** 파일용 포맷 (색상 없음 — grep 친화적) */
const fileFmt = winston.format.combine(tsFormat, printfFmt);

/**
 * 콘솔용 포맷 — 레벨 + 내용 기반 색상 적용
 *
 *   ERROR → 빨간 배경 + 흰 글씨
 *   WARN  → 노란색
 *   TRADE → 내용에 따라 초록(매수) / 빨간(매도·손절) / 노란(익절) / 시안(기본)
 *   INFO  → 시안색
 *   DEBUG → 회색
 */
const consoleFmt = winston.format.combine(
  tsFormat,
  winston.format.printf(({ timestamp, level, message }) => {
    const ts  = `[${String(timestamp)}]`;
    const lv  = `[${level.toUpperCase().padEnd(5)}]`;
    const msg = String(message);
    const line = `${ts} ${lv} ${msg}`;

    switch (level) {
      case 'error': return colorError(line);
      case 'warn':  return `${ANSI.yellow}${line}${ANSI.reset}`;
      case 'trade': return colorTrade(line);
      case 'info':  return `${ANSI.cyan}${line}${ANSI.reset}`;
      case 'debug': return `${ANSI.gray}${line}${ANSI.reset}`;
      default:      return line;
    }
  }),
);

// ── 트랜스포트 팩토리 ─────────────────────────────────────────────────────────

function makeDailyRotate(
  prefix: string,
  format: winston.Logform.Format,
): DailyRotateFile {
  const transport = new DailyRotateFile({
    dirname:     LOG_DIR,
    filename:    `${prefix}-%DATE%.log`,
    datePattern: 'YYYY-MM-DD',
    maxSize:     '10m',
    maxFiles:    '7d',   // 7일 보존
    format,
    // Windows 심볼릭 링크 권한 문제로 createSymlink 미사용
  });

  // Windows에서 파일이 다른 프로세스에 의해 잠겨 있어도 엔진이 멈추지 않도록 방어
  transport.on('error', (err: Error) => {
    process.stderr.write(`[logger] 로그 파일 쓰기 오류 (무시): ${err.message}\n`);
  });

  return transport;
}

// ── winston 인스턴스 ──────────────────────────────────────────────────────────

// winston.Logger 의 타입에 커스텀 레벨 메서드를 추가
type CustomLogger = winston.Logger & {
  trade: (message: string, ...meta: unknown[]) => winston.Logger;
};

const _logger = winston.createLogger({
  levels: CUSTOM_LEVELS,
  level:  'debug',           // 모든 레벨을 수집 (transport 별로 필터)
  transports: [

    // ① 콘솔 — 모든 레벨
    new winston.transports.Console({
      format: consoleFmt,
    }),

    // ② trading.log — 모든 레벨
    makeDailyRotate('trading', fileFmt),

    // ③ trades.log — trade 레벨만
    //    tradeOnlyFilter 가 먼저 실행 → false 반환 시 dropAA → fileFmt 미호출
    makeDailyRotate(
      'trades',
      winston.format.combine(tradeOnlyFilter, fileFmt),
    ),

  ],
}) as CustomLogger;

// ── 공개 API ─────────────────────────────────────────────────────────────────

export const logger = {
  /** 일반 정보 (엔진 상태, 감시 목록 변경, 검증 통과 등) */
  info:  (msg: string) => _logger.info(msg),

  /** 경고 (스킵, 쿨다운, 데이터 이상 등) */
  warn:  (msg: string) => _logger.warn(msg),

  /** 오류 (예외, 사이클 타임아웃 등) — 콘솔 빨간색 */
  error: (msg: string) => _logger.error(msg),

  /** 디버그 (상세 분석 정보, 개발 시 사용) */
  debug: (msg: string) => _logger.debug(msg),

  /**
   * 매수 · 매도 이벤트 전용.
   * logs/trading.log 와 logs/trades.log 양쪽에 기록됩니다.
   * 레벨 필드에 [TRADE] 가 자동으로 표시됩니다.
   */
  trade: (msg: string) => _logger.trade(msg),
};
