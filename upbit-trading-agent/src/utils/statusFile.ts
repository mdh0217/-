/**
 * 상태 전광판 (Status File)
 *
 * 매 사이클 결과를 current-status.txt 에 덮어씁니다.
 * 로그 파일을 쌓지 않고도 봇 상태를 즉시 확인할 수 있습니다.
 *
 * 제어: .env 의 WRITE_STATUS_FILE=true|false
 */

import * as fs   from 'fs';
import * as path from 'path';

// ── 타입 ──────────────────────────────────────────────────────────────────────

export type SignalStrength = 'none' | 'normal' | 'strong';

export interface MarketStatus {
  market:  string;           // e.g. 'KRW-BTC'
  signal:  SignalStrength;
}

/** 정상 사이클 — 종목별 신호 포함 */
interface StatusOk {
  kind:      'ok';
  markets:   MarketStatus[];
  iteration: number;
}

/** BTC 방어 차단 사이클 */
interface StatusBlocked {
  kind:      'blocked';
  reason:    string;
  iteration: number;
}

export type StatusData = StatusOk | StatusBlocked;

// ── 상수 ──────────────────────────────────────────────────────────────────────

const STATUS_FILE = path.resolve(process.cwd(), 'current-status.txt');

const SIGNAL_ICON: Record<SignalStrength, string> = {
  none:   '✗',
  normal: '△',
  strong: '★',
};

// ── 내부 헬퍼 ────────────────────────────────────────────────────────────────

function isEnabled(): boolean {
  // 기본값 true — 명시적으로 'false' 일 때만 비활성화
  return process.env['WRITE_STATUS_FILE'] !== 'false';
}

function nowStamp(): string {
  const d   = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    ` ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

function buildLine(data: StatusData): string {
  const ts   = nowStamp();
  const iter = `#${data.iteration}`;

  if (data.kind === 'blocked') {
    return `[${ts}] ${iter} Monitoring Paused: ${data.reason}`;
  }

  // 종목별 신호 아이콘
  const parts = data.markets.map(({ market, signal }) => {
    const coin = market.replace('KRW-', '');
    return `${coin}:${SIGNAL_ICON[signal]}`;
  });

  // 신호 있는 종목 요약
  const hits = data.markets.filter((m) => m.signal !== 'none');
  const signalSummary =
    hits.length > 0
      ? hits.map((m) => `${m.market.replace('KRW-', '')}(${m.signal})`).join(', ')
      : 'None';

  return `[${ts}] ${iter} ${parts.join(' | ')} (Signal: ${signalSummary})`;
}

// ── 공개 API ─────────────────────────────────────────────────────────────────

/**
 * current-status.txt 를 최신 사이클 결과로 덮어씁니다.
 * 쓰기 실패는 조용히 무시합니다 (트레이딩 루프를 멈추면 안 됨).
 */
export function writeStatusFile(data: StatusData): void {
  if (!isEnabled()) return;

  try {
    fs.writeFileSync(STATUS_FILE, buildLine(data) + '\n', 'utf8');
  } catch {
    // best-effort
  }
}

/**
 * 봇 종료 시 current-status.txt 에 중단 메시지를 남깁니다.
 */
export function writeShutdownStatus(reason: string): void {
  if (!isEnabled()) return;

  try {
    const line = `[${nowStamp()}] 🔴 봇 중단됨 (사유: ${reason})`;
    fs.writeFileSync(STATUS_FILE, line + '\n', 'utf8');
  } catch {
    // best-effort
  }
}
