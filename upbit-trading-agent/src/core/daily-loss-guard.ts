/**
 * 일일 손실 한도 감시자 (KST 기준)
 *
 * - 하루 시작 시 총 자산(KRW 잔고 + 오픈 포지션 투자 원금)을 스냅샷으로 저장합니다.
 * - 매 사이클마다 현재 총 자산과 비교해 손실률을 계산합니다.
 * - 손실률이 limitRate 이상이면 breached = true 를 반환합니다.
 * - 날짜가 바뀌면(KST) 스냅샷을 자동 갱신합니다.
 *
 * 총 자산 = KRW 잔고 + 오픈 포지션 투자 원금 합계 (실시간 시세 API 호출 없음)
 */

import * as fs   from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

// ── 타입 ────────────────────────────────────────────────────────────────────

interface DailySnapshot {
  dateKst:     string;   // 'YYYY-MM-DD' KST
  startAssets: number;   // 하루 시작 총 자산 (KRW)
}

interface GuardResult {
  breached:      boolean;
  lossRate:      number;   // 음수 = 손실 (예: -0.04 → -4%)
  startAssets:   number;
  currentAssets: number;
}

// ── 경로 상수 ────────────────────────────────────────────────────────────────

const SNAPSHOT_PATH = path.resolve(process.cwd(), 'data', 'daily-snapshot.json');

// ── 헬퍼 ────────────────────────────────────────────────────────────────────

function getTodayKst(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

// ── DailyLossGuard ────────────────────────────────────────────────────────────

export class DailyLossGuard {
  private snapshot: DailySnapshot | null = null;

  /**
   * @param limitRate 허용 최대 일일 손실 비율 (예: 0.05 = 5%)
   */
  constructor(private readonly limitRate: number) {
    this.load();
  }

  // ── 퍼블릭 API ──────────────────────────────────────────────────────────────

  /**
   * 현재 총 자산과 하루 시작 자산을 비교해 한도 초과 여부를 반환합니다.
   *
   * @param krwBalance   현재 가용 KRW 잔고
   * @param totalInvested 오픈 포지션 total_invested 합계
   */
  check(krwBalance: number, totalInvested: number): GuardResult {
    const todayKst     = getTodayKst();
    const currentAssets = krwBalance + totalInvested;

    // 날짜가 바뀌었거나 스냅샷이 없으면 갱신
    if (this.snapshot === null || this.snapshot.dateKst !== todayKst) {
      this.snapshot = { dateKst: todayKst, startAssets: currentAssets };
      this.save();
      logger.info(`[일일한도] ${todayKst} 기준 자산 초기화: ${Math.round(currentAssets).toLocaleString('ko-KR')}원`);
    }

    const startAssets = this.snapshot.startAssets;
    const lossRate    = startAssets > 0
      ? (currentAssets - startAssets) / startAssets
      : 0;

    const breached = lossRate <= -this.limitRate;

    if (breached) {
      logger.warn(
        `[일일한도] 손실 한도 초과 — ` +
        `시작: ${Math.round(startAssets).toLocaleString('ko-KR')}원 / ` +
        `현재: ${Math.round(currentAssets).toLocaleString('ko-KR')}원 / ` +
        `손실률: ${(lossRate * 100).toFixed(2)}%`,
      );
    }

    return { breached, lossRate, startAssets, currentAssets };
  }

  // ── 내부 IO ─────────────────────────────────────────────────────────────────

  private load(): void {
    try {
      const raw  = fs.readFileSync(SNAPSHOT_PATH, 'utf-8');
      const data = JSON.parse(raw) as DailySnapshot;
      if (typeof data.dateKst === 'string' && typeof data.startAssets === 'number') {
        this.snapshot = data;
      }
    } catch {
      // 파일 없음 또는 파싱 실패 → 다음 check() 에서 새로 생성
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(SNAPSHOT_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(this.snapshot, null, 2), 'utf-8');
    } catch (err) {
      logger.warn(`[일일한도] 스냅샷 저장 실패: ${(err as Error).message}`);
    }
  }
}
