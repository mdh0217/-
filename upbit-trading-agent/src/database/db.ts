/**
 * 가상 매매 데이터베이스 (sql.js — 순수 WASM, Apple Silicon 호환)
 *
 * 테이블:
 *   virtual_balance  — 가상 KRW/코인 잔고
 *   positions        — 매수 포지션 이력
 *   orders           — 가상 주문 이력
 */

import initSqlJs from 'sql.js';
import type { Database } from 'sql.js';
import * as fs from 'fs';
import * as path from 'path';
import { TRADING } from '../config/constants';
import {
  VirtualBalance,
  Position,
  PositionEntry,
  PositionStatus,
  ExitReason,
  VirtualOrder,
  VirtualOrderSide,
  VirtualOrderType,
  UpbitCandle,
} from '../types/index';

const FEE_RATE        = TRADING.FEE_RATE;
const STOP_LOSS_RATE  = TRADING.STOP_LOSS_RATE;
const DCA_STOP_FACTOR = TRADING.DCA_STOP_FACTOR;

export { FEE_RATE, STOP_LOSS_RATE };

// ─────────────────────────────────────────────────────────────────────────────
// DatabaseManager
// ─────────────────────────────────────────────────────────────────────────────

export class DatabaseManager {
  private readonly db: Database;
  private readonly dbPath: string;

  private constructor(db: Database, dbPath: string) {
    this.db = db;
    this.dbPath = dbPath;
  }

  /** 비동기 팩토리: WASM 로딩 후 DB 초기화 */
  static async create(
    dbPath = process.env['DB_PATH'] ?? './data/trading.db',
  ): Promise<DatabaseManager> {
    const SQL = await initSqlJs({
      locateFile: (file: string) =>
        path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
    });

    const resolved = path.resolve(dbPath);
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const db = fs.existsSync(resolved)
      ? new SQL.Database(fs.readFileSync(resolved))
      : new SQL.Database();

    const mgr = new DatabaseManager(db, resolved);
    mgr.bootstrap();
    return mgr;
  }

  // ── 스키마 생성 ────────────────────────────────────────────────────────────

  private bootstrap(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS virtual_balance (
        currency   TEXT    PRIMARY KEY,
        available  REAL    NOT NULL DEFAULT 0,
        locked     REAL    NOT NULL DEFAULT 0,
        updated_at TEXT    NOT NULL
      );

      CREATE TABLE IF NOT EXISTS positions (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        market        TEXT    NOT NULL,
        status        TEXT    NOT NULL DEFAULT 'open',
        entries       TEXT    NOT NULL,
        avg_price     REAL    NOT NULL,
        total_volume  REAL    NOT NULL,
        total_invested REAL   NOT NULL,
        dca_level     INTEGER NOT NULL DEFAULT 0,
        peak_price    REAL,
        trailing_active INTEGER NOT NULL DEFAULT 0,
        stop_loss_price REAL  NOT NULL,
        opened_at     TEXT    NOT NULL,
        closed_at     TEXT,
        exit_price    REAL,
        pnl           REAL,
        pnl_rate      REAL,
        exit_reason   TEXT
      );

      CREATE TABLE IF NOT EXISTS orders (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        position_id INTEGER NOT NULL,
        market      TEXT    NOT NULL,
        side        TEXT    NOT NULL,
        order_type  TEXT    NOT NULL,
        price       REAL    NOT NULL,
        volume      REAL    NOT NULL,
        amount      REAL    NOT NULL,
        fee         REAL    NOT NULL,
        created_at  TEXT    NOT NULL
      );

      CREATE TABLE IF NOT EXISTS candles (
        market                TEXT    NOT NULL,
        date                  TEXT    NOT NULL,
        candle_date_time_utc  TEXT    NOT NULL,
        candle_date_time_kst  TEXT    NOT NULL,
        open_price            REAL    NOT NULL,
        high_price            REAL    NOT NULL,
        low_price             REAL    NOT NULL,
        close_price           REAL    NOT NULL,
        acc_volume            REAL    NOT NULL,
        acc_price             REAL    NOT NULL,
        ts                    INTEGER NOT NULL,
        PRIMARY KEY (market, date)
      );
    `);
    this.save();
  }

  // ── 잔고 ──────────────────────────────────────────────────────────────────

  getBalance(currency: string): VirtualBalance | null {
    const stmt = this.db.prepare(
      'SELECT currency, available, locked FROM virtual_balance WHERE currency = ?',
    );
    stmt.bind([currency]);
    if (stmt.step()) {
      const row = stmt.getAsObject() as { currency: string; available: number; locked: number };
      stmt.free();
      return row;
    }
    stmt.free();
    return null;
  }

  setBalance(currency: string, available: number, locked: number): void {
    this.db.run(
      `INSERT INTO virtual_balance(currency, available, locked, updated_at)
       VALUES(?, ?, ?, ?)
       ON CONFLICT(currency) DO UPDATE SET
         available  = excluded.available,
         locked     = excluded.locked,
         updated_at = excluded.updated_at`,
      [currency, available, locked, new Date().toISOString()],
    );
  }

  /** KRW 잔고에서 amount만큼 차감 (매수 시 사용) */
  deductKrw(amount: number): void {
    const bal = this.getBalance('KRW');
    const current = bal?.available ?? 0;
    if (current < amount) throw new Error(`잔고 부족: ${current} < ${amount}`);
    this.setBalance('KRW', current - amount, bal?.locked ?? 0);
  }

  /** KRW 잔고에 amount만큼 추가 (매도 시 사용) */
  addKrw(amount: number): void {
    const bal = this.getBalance('KRW');
    this.setBalance('KRW', (bal?.available ?? 0) + amount, bal?.locked ?? 0);
  }

  // ── 포지션 ────────────────────────────────────────────────────────────────

  getOpenPosition(market: string): Position | null {
    const stmt = this.db.prepare(
      "SELECT * FROM positions WHERE market = ? AND status = 'open' LIMIT 1",
    );
    stmt.bind([market]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return this.mapPosition(row);
    }
    stmt.free();
    return null;
  }

  getAllOpenPositions(): Position[] {
    const results = this.db.exec("SELECT * FROM positions WHERE status = 'open'");
    if (!results[0]) return [];
    return results[0].values.map((row) =>
      this.mapPosition(Object.fromEntries(results[0]!.columns.map((c, i) => [c, row[i]]))),
    );
  }

  createPosition(params: {
    market: string;
    entry: PositionEntry;
    stop_loss_price: number;
  }): Position {
    const now = new Date().toISOString();
    const entries = JSON.stringify([params.entry]);
    this.db.run(
      `INSERT INTO positions
       (market, status, entries, avg_price, total_volume, total_invested,
        dca_level, peak_price, trailing_active, stop_loss_price, opened_at)
       VALUES (?,?,?,?,?,?,0,NULL,0,?,?)`,
      [
        params.market,
        'open',
        entries,
        params.entry.price,
        params.entry.volume,
        params.entry.amount,
        params.stop_loss_price,
        now,
      ],
    );

    const pos = this.getOpenPosition(params.market);
    if (!pos) throw new Error('포지션 생성 후 조회 실패');
    return pos;
  }

  addDcaEntry(positionId: number, newEntry: PositionEntry): Position {
    const pos = this.getPositionById(positionId);
    if (!pos) throw new Error(`포지션 ${positionId} 없음`);

    const entries = [...pos.entries, newEntry];
    const totalVolume = entries.reduce((s, e) => s + e.volume, 0);
    const totalInvested = entries.reduce((s, e) => s + e.amount, 0);
    const avgPrice = entries.reduce((s, e) => s + e.price * e.volume, 0) / totalVolume;
    // DCA 후 손절 강화: STOP_LOSS_RATE × DCA_STOP_FACTOR (3% × 0.80 = 2.4%)
    const stopLossPrice = avgPrice * (1 - STOP_LOSS_RATE * DCA_STOP_FACTOR);

    this.db.run(
      `UPDATE positions SET
         entries = ?, avg_price = ?, total_volume = ?, total_invested = ?,
         dca_level = ?, stop_loss_price = ?
       WHERE id = ?`,
      [
        JSON.stringify(entries),
        avgPrice,
        totalVolume,
        totalInvested,
        newEntry.dca_level,
        stopLossPrice,
        positionId,
      ],
    );

    const updated = this.getPositionById(positionId);
    if (!updated) throw new Error('DCA 업데이트 후 조회 실패');
    return updated;
  }

  updateTrailingPeak(positionId: number, peakPrice: number, trailingActive: boolean): void {
    this.db.run(
      'UPDATE positions SET peak_price = ?, trailing_active = ? WHERE id = ?',
      [peakPrice, trailingActive ? 1 : 0, positionId],
    );
  }

  closePosition(
    positionId: number,
    exitPrice: number,
    pnl: number,
    pnlRate: number,
    reason: ExitReason,
  ): void {
    this.db.run(
      `UPDATE positions SET
         status = 'closed', closed_at = ?, exit_price = ?,
         pnl = ?, pnl_rate = ?, exit_reason = ?
       WHERE id = ?`,
      [new Date().toISOString(), exitPrice, pnl, pnlRate, reason, positionId],
    );
  }

  getPositionById(id: number): Position | null {
    const stmt = this.db.prepare('SELECT * FROM positions WHERE id = ?');
    stmt.bind([id]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return this.mapPosition(row);
    }
    stmt.free();
    return null;
  }

  getClosedPositions(market?: string): Position[] {
    const sql = market
      ? "SELECT * FROM positions WHERE status='closed' AND market=? ORDER BY closed_at DESC"
      : "SELECT * FROM positions WHERE status='closed' ORDER BY closed_at DESC";
    const results = market ? this.db.exec(sql, [market]) : this.db.exec(sql);
    if (!results[0]) return [];
    return results[0].values.map((row) =>
      this.mapPosition(Object.fromEntries(results[0]!.columns.map((c, i) => [c, row[i]]))),
    );
  }

  // ── 주문 이력 ─────────────────────────────────────────────────────────────

  logOrder(params: Omit<VirtualOrder, 'id'>): void {
    this.db.run(
      `INSERT INTO orders
       (position_id, market, side, order_type, price, volume, amount, fee, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        params.position_id,
        params.market,
        params.side,
        params.order_type,
        params.price,
        params.volume,
        params.amount,
        params.fee,
        params.created_at,
      ],
    );
  }

  // ── 내부 유틸 ─────────────────────────────────────────────────────────────

  private mapPosition(row: Record<string, unknown>): Position {
    return {
      id: row['id'] as number,
      market: row['market'] as string,
      status: row['status'] as PositionStatus,
      entries: JSON.parse(row['entries'] as string) as PositionEntry[],
      avg_price: row['avg_price'] as number,
      total_volume: row['total_volume'] as number,
      total_invested: row['total_invested'] as number,
      dca_level: row['dca_level'] as number,
      peak_price: row['peak_price'] as number | null,
      trailing_active: (row['trailing_active'] as number) === 1,
      stop_loss_price: row['stop_loss_price'] as number,
      opened_at: row['opened_at'] as string,
      closed_at: (row['closed_at'] as string | null) ?? null,
      exit_price: (row['exit_price'] as number | null) ?? null,
      pnl: (row['pnl'] as number | null) ?? null,
      pnl_rate: (row['pnl_rate'] as number | null) ?? null,
      exit_reason: (row['exit_reason'] as ExitReason | null) ?? null,
    };
  }

  private save(): void {
    const data = this.db.export();
    fs.writeFileSync(this.dbPath, Buffer.from(data));
  }

  /** 셧다운 시 외부에서 강제 저장 호출용 */
  flush(): void {
    this.save();
  }

  /** 특정 마켓의 최근 N일 내 손절 횟수 (쿨다운 판단용) — 실패 시 0 반환 */
  getRecentStopLossCount(market: string, daysBack: number): number {
    try {
      const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
      const results = this.db.exec(
        "SELECT COUNT(*) FROM positions WHERE market=? AND exit_reason='stop_loss' AND closed_at >= ?",
        [market, since],
      );
      return (results[0]?.values[0]?.[0] as number) ?? 0;
    } catch {
      return 0;
    }
  }

  // ── 캔들 캐시 ────────────────────────────────────────────────────────────────

  /** API에서 받은 캔들을 DB에 upsert (오늘 캔들 갱신 포함) */
  upsertCandles(market: string, candles: UpbitCandle[]): void {
    for (const c of candles) {
      const date = c.candle_date_time_kst.slice(0, 10);
      this.db.run(
        `INSERT INTO candles
         (market, date, candle_date_time_utc, candle_date_time_kst,
          open_price, high_price, low_price, close_price, acc_volume, acc_price, ts)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(market, date) DO UPDATE SET
           open_price  = excluded.open_price,
           high_price  = excluded.high_price,
           low_price   = excluded.low_price,
           close_price = excluded.close_price,
           acc_volume  = excluded.acc_volume,
           acc_price   = excluded.acc_price,
           ts          = excluded.ts`,
        [
          market, date,
          c.candle_date_time_utc, c.candle_date_time_kst,
          c.opening_price, c.high_price, c.low_price, c.trade_price,
          c.candle_acc_trade_volume, c.candle_acc_trade_price, c.timestamp,
        ],
      );
    }
    this.save();
  }

  /** DB에서 최근 count개 캔들을 오래된 순으로 반환 */
  getCachedCandles(market: string, count: number): UpbitCandle[] {
    const results = this.db.exec(
      'SELECT * FROM candles WHERE market = ? ORDER BY date DESC LIMIT ?',
      [market, count],
    );
    if (!results[0]) return [];
    return results[0].values
      .map((row) => {
        const r = Object.fromEntries(results[0]!.columns.map((c, i) => [c, row[i]]));
        return {
          market:                  r['market'] as string,
          candle_date_time_utc:    r['candle_date_time_utc'] as string,
          candle_date_time_kst:    r['candle_date_time_kst'] as string,
          opening_price:           r['open_price'] as number,
          high_price:              r['high_price'] as number,
          low_price:               r['low_price'] as number,
          trade_price:             r['close_price'] as number,
          timestamp:               r['ts'] as number,
          candle_acc_trade_price:  r['acc_price'] as number,
          candle_acc_trade_volume: r['acc_volume'] as number,
        } as UpbitCandle;
      })
      .reverse(); // 오래된 것 → 최신 순으로 정렬
  }

  /** 특정 마켓의 캐시된 캔들 수 */
  getCandleCount(market: string): number {
    const results = this.db.exec(
      'SELECT COUNT(*) FROM candles WHERE market = ?',
      [market],
    );
    return (results[0]?.values[0]?.[0] as number) ?? 0;
  }

  /** KST 기준 오늘 하루 청산 통계 (일별 리포트용) */
  getTodayStats(): { trades: number; pnl: number; wins: number } {
    const kstOffsetMs = 9 * 60 * 60 * 1000;
    const kstDate     = new Date(Date.now() + kstOffsetMs).toISOString().slice(0, 10);
    const sinceUtc    = new Date(`${kstDate}T00:00:00+09:00`).toISOString();
    const results = this.db.exec(
      "SELECT COUNT(*), COALESCE(SUM(pnl),0), COALESCE(SUM(CASE WHEN pnl>0 THEN 1 ELSE 0 END),0) FROM positions WHERE status='closed' AND closed_at >= ?",
      [sinceUtc],
    );
    const row = results[0]?.values[0];
    if (!row) return { trades: 0, pnl: 0, wins: 0 };
    return {
      trades: (row[0] as number) || 0,
      pnl:    (row[1] as number) || 0,
      wins:   (row[2] as number) || 0,
    };
  }

  /** 전체 손익 통계 */
  getSummary(): { totalTrades: number; totalPnl: number; winRate: number } {
    const results = this.db.exec(
      "SELECT COUNT(*) as cnt, SUM(pnl) as total_pnl, SUM(CASE WHEN pnl>0 THEN 1 ELSE 0 END) as wins FROM positions WHERE status='closed'",
    );
    const row = results[0]?.values[0];
    if (!row) return { totalTrades: 0, totalPnl: 0, winRate: 0 };
    const cnt = (row[0] as number) || 0;
    const totalPnl = (row[1] as number) || 0;
    const wins = (row[2] as number) || 0;
    return { totalTrades: cnt, totalPnl, winRate: cnt > 0 ? wins / cnt : 0 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 싱글턴
// ─────────────────────────────────────────────────────────────────────────────

let _db: DatabaseManager | null = null;

export async function getDatabase(): Promise<DatabaseManager> {
  if (_db) return _db;
  _db = await DatabaseManager.create();
  return _db;
}

// ─────────────────────────────────────────────────────────────────────────────
// 매수 금액 계산 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

/** KRW amount로 매수할 때의 수량·수수료 계산 (업비트 기준 소수점 8자리 절사) */
export function calcBuyVolume(krwAmount: number, price: number): { volume: number; fee: number } {
  const fee = krwAmount * FEE_RATE;
  const rawVolume = (krwAmount - fee) / price;
  const volume = Math.floor(rawVolume * 1e8) / 1e8; // 최소 주문 단위 0.00000001
  return { volume, fee };
}

/** 수량 매도 시 수취 KRW·수수료 계산 */
export function calcSellReceive(
  volume: number,
  price: number,
): { received: number; fee: number } {
  const gross = volume * price;
  const fee = gross * FEE_RATE;
  return { received: gross - fee, fee };
}
