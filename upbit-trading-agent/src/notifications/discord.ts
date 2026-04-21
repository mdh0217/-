/**
 * 디스코드 웹훅 알림 모듈
 *
 * 엔진 시작 · 매수 · 매도(손절/익절) 이벤트를 디스코드로 전송합니다.
 * DISCORD_WEBHOOK_URL 환경변수가 없으면 조용히 건너뜁니다.
 */

import * as fs   from 'fs';
import * as path from 'path';
import { krw, pct } from '../utils/format';

// ── 포맷 헬퍼 ─────────────────────────────────────────────────────────────────

const now = () => new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

// ── 시작 알림 쿨다운 ──────────────────────────────────────────────────────────

const START_LOCK_FILE      = path.join(process.cwd(), '.discord_start_lock');
const START_COOLDOWN_MS    = 5 * 60 * 1000; // 5분

/** 시작 알림 발송 가능 여부 확인 및 타임스탬프 갱신. 쿨다운 중이면 false. */
function acquireStartLock(): boolean {
  try {
    const raw = fs.readFileSync(START_LOCK_FILE, 'utf8');
    if (Date.now() - parseInt(raw, 10) < START_COOLDOWN_MS) return false;
  } catch { /* 파일 없음 = 첫 실행 */ }
  try { fs.writeFileSync(START_LOCK_FILE, String(Date.now())); } catch { /* 무시 */ }
  return true;
}

// ── 자산 요약 헬퍼 ────────────────────────────────────────────────────────────

/**
 * 자산 비중 요약 문자열을 반환합니다.
 *
 * 총 자산 = KRW 잔고 + 오픈 포지션 투자 원금 합계 (실시간 API 호출 없음)
 *
 * @param krwBalance   현재 가용 KRW
 * @param totalInvested 오픈 포지션 total_invested 합계
 */
export function buildAssetSummary(krwBalance: number, totalInvested: number): string {
  const totalAsset = krwBalance + totalInvested;
  if (totalAsset <= 0) return krw(0);

  const cashPct   = Math.round((krwBalance   / totalAsset) * 100);
  const investPct = 100 - cashPct;
  const filled    = Math.round(cashPct / 10);
  const bar       = '▓'.repeat(filled) + '░'.repeat(10 - filled);

  return [
    `📊 자산 비중: [${bar}] 현금 ${cashPct}% / 운용 ${investPct}%`,
    `💰 총 자산 가치: ${krw(totalAsset)}`,
    `💵 가용 현금: ${krw(krwBalance)}`,
  ].join('\n');
}

// ── 웹훅 전송 ─────────────────────────────────────────────────────────────────

async function send(payload: object): Promise<void> {
  const WEBHOOK_URL = process.env['DISCORD_WEBHOOK_URL']?.trim();
  if (!WEBHOOK_URL) return;
  try {
    await fetch(WEBHOOK_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
  } catch {
    // 알림 실패가 트레이딩 루프를 중단시켜선 안 됨
  }
}

// ── 공개 알림 함수 ────────────────────────────────────────────────────────────

/** 엔진 시작 알림 — 전체 자산 현황 브리핑 포함 (5분 쿨다운) */
export async function notifyEngineStart(opts: {
  krwBalance:    number;
  markets:       string[];
  intervalSec:   number;
  totalInvested: number;
}): Promise<void> {
  if (!acquireStartLock()) return;
  await send({
    embeds: [{
      title:       '🚀 트레이딩 엔진 시작',
      color:       0x5865F2,
      description: '자율 트레이딩 에이전트가 가동되었습니다.',
      fields: [
        { name: '⏱️ 실행 주기', value: `${opts.intervalSec}초`,   inline: true  },
        { name: '📋 감시 종목', value: opts.markets.join(', '),   inline: false },
        { name: '📊 자산 현황', value: buildAssetSummary(opts.krwBalance, opts.totalInvested), inline: false },
      ],
      footer: { text: `시작 시각: ${now()}` },
    }],
  });
}

/** 매수 알림 (최초 진입 / DCA 포함) */
export async function notifyBuy(opts: {
  market:      string;
  price:       number;
  volume:      number;
  amount:      number;
  krwBalance:  number;
  tag:         string;        // '일반' | '강력' | `DCA${n}`
}): Promise<void> {
  const coin  = opts.market.replace('KRW-', '');
  const isDca = opts.tag.startsWith('DCA');

  await send({
    embeds: [{
      title:  isDca ? `♻️ DCA 매수 — ${coin}` : `🟢 매수 체결 — ${coin}`,
      color:  isDca ? 0xFEE75C : 0x57F287, // 노랑 / 초록
      fields: [
        { name: '📌 종목',        value: opts.market,            inline: true  },
        { name: '💵 체결가',      value: krw(opts.price),        inline: true  },
        { name: '📦 수량',        value: opts.volume.toFixed(6), inline: true  },
        { name: '💳 투자금액',    value: krw(opts.amount),       inline: true  },
        { name: '💰 남은 KRW',   value: krw(opts.krwBalance),   inline: true  },
        { name: '🏷️ 구분',       value: opts.tag,               inline: true  },
      ],
      footer: { text: now() },
    }],
  });
}

/** 매도 알림 (손절 / 익절) — 하단에 자산 요약 포함 */
export async function notifySell(opts: {
  market:        string;
  price:         number;
  volume:        number;
  pnl:           number;
  pnlRate:       number;
  krwBalance:    number;
  totalInvested: number;
  reason:        'stop_loss' | 'trailing_stop';
  peakPrice?:    number;
}): Promise<void> {
  const coin     = opts.market.replace('KRW-', '');
  const isProfit = opts.pnl >= 0;
  const isSL     = opts.reason === 'stop_loss';

  const title = isSL ? `🔴 손절 매도 — ${coin}` : `✅ 익절 매도 — ${coin}`;
  const color = isProfit ? 0x57F287 : 0xED4245;

  const fields: { name: string; value: string; inline: boolean }[] = [
    { name: '📌 종목',   value: opts.market,                                       inline: true  },
    { name: '💵 체결가', value: krw(opts.price),                                   inline: true  },
    { name: '📦 수량',   value: opts.volume.toFixed(6),                            inline: true  },
    { name: '📈 손익',   value: `${krw(opts.pnl)} (${pct(opts.pnlRate)})`,        inline: true  },
  ];

  if (!isSL && opts.peakPrice !== undefined) {
    fields.push({ name: '🏔️ 고점', value: krw(opts.peakPrice), inline: true });
  }

  // 매도 완료 후 자산 요약 (3~4줄)
  fields.push({
    name:   '── 자산 요약 ──',
    value:  buildAssetSummary(opts.krwBalance, opts.totalInvested),
    inline: false,
  });

  await send({
    embeds: [{ title, color, fields, footer: { text: now() } }],
  });
}

/** 경고 알림 — BTC 차단 / 일일 손실 한도 / 연속 타임아웃 쿨다운 */
export async function notifyWarning(opts: {
  kind:   'btc_drop' | 'daily_loss' | 'timeout_cooldown';
  detail: string;
}): Promise<void> {
  const meta: Record<string, { title: string; color: number }> = {
    btc_drop:         { title: '⚠️ BTC 급락 — 신규 매수 차단',       color: 0xFEE75C },
    daily_loss:       { title: '🛑 일일 손실 한도 도달 — 매수 차단', color: 0xED4245 },
    timeout_cooldown: { title: '⏸️ 연속 타임아웃 — 쿨다운 진입',    color: 0xFEE75C },
  };
  const { title, color } = meta[opts.kind]!;
  await send({
    embeds: [{
      title,
      color,
      description: opts.detail,
      footer: { text: now() },
    }],
  });
}

/** 일별 리포트 — KST 08:00 이후 첫 사이클에 발송 */
export async function notifyDailyReport(opts: {
  krwBalance:    number;
  totalInvested: number;
  todayTrades:   number;
  todayPnl:      number;
  todayWins:     number;
  allTimeTrades: number;
  allTimePnl:    number;
}): Promise<void> {
  const todayLosses = opts.todayTrades - opts.todayWins;
  const pnlSign     = opts.todayPnl >= 0 ? '+' : '';
  const allSign     = opts.allTimePnl >= 0 ? '+' : '';

  await send({
    embeds: [{
      title:  '📅 일별 리포트',
      color:  opts.todayPnl >= 0 ? 0x57F287 : 0xED4245,
      fields: [
        {
          name:   '오늘 거래',
          value:  opts.todayTrades === 0
            ? '거래 없음'
            : `${opts.todayTrades}회 (${opts.todayWins}승 ${todayLosses}패)  ${pnlSign}${krw(opts.todayPnl)}`,
          inline: false,
        },
        {
          name:   '누적 손익',
          value:  `${opts.allTimeTrades}회  ${allSign}${krw(opts.allTimePnl)}`,
          inline: false,
        },
        {
          name:   '현재 자산',
          value:  buildAssetSummary(opts.krwBalance, opts.totalInvested),
          inline: false,
        },
      ],
      footer: { text: `리포트 기준: ${now()}` },
    }],
  });
}

/** 셧다운 알림 (정상 종료 / 에러 종료 구분) */
export async function notifyShutdown(opts: {
  kind:       'signal' | 'error';
  signal?:    string;
  errorMsg?:  string;
  krwBalance: number;
}): Promise<void> {
  const isError = opts.kind === 'error';
  await send({
    embeds: [{
      title:  isError ? '🔴 에이전트 비정상 종료' : '⏹️ 에이전트 정상 종료',
      color:  isError ? 0xED4245 : 0x99AAB5,
      fields: [
        isError
          ? { name: '❌ 오류 내용', value: opts.errorMsg ?? '알 수 없는 오류', inline: false }
          : { name: '📡 종료 신호', value: opts.signal ?? 'SIGTERM',           inline: true  },
        { name: '💰 최종 KRW 잔고', value: krw(opts.krwBalance), inline: true },
      ],
      footer: { text: `종료 시각: ${now()}` },
    }],
  });
}

/** 테스트 메시지 */
export async function notifyTest(): Promise<boolean> {
  const WEBHOOK_URL = process.env['DISCORD_WEBHOOK_URL']?.trim();
  if (!WEBHOOK_URL) return false;
  await send({
    embeds: [{
      title:       '✅ 디스코드 알림 연결 성공',
      color:       0x57F287,
      description: '트레이딩 에이전트가 이 채널로 매수/매도/시작 알림을 발송합니다.',
      fields: [
        { name: '📢 알림 종류', value: '엔진 시작 · 매수 체결 · DCA 매수 · 손절 · 익절', inline: false },
      ],
      footer: { text: `연결 확인: ${now()}` },
    }],
  });
  return true;
}
