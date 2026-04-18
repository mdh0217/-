/**
 * 웹 서버
 * - /          → public/index.html (정적 파일)
 * - /health    → JSON 헬스체크
 * - 그 외      → public/ 내 파일 서빙, 없으면 404
 *
 * 포트 충돌 처리 (Graceful → Force 2단계):
 *   1. taskkill (without /F) 로 일반 종료 신호 전송
 *   2. GRACEFUL_WAIT_MS 동안 폴링하며 프로세스 소멸 확인
 *   3. 여전히 살아있으면 taskkill /F 로 강제 종료
 *   4. 포트 해제 확인 후 재바인딩
 */

import * as http from 'http';
import * as net  from 'net';
import * as fs   from 'fs';
import * as path from 'path';
import { exec }  from 'child_process';
import { getDatabase } from '../database/db';

const PORT              = parseInt(process.env['HEALTH_PORT'] ?? '3000', 10);
const GRACEFUL_WAIT_MS  = 3_000;  // 일반 종료 후 프로세스 소멸 대기 상한
const PORT_FREE_WAIT_MS = 5_000;  // 포트 해제 최대 대기 (강제 종료 후)
const POLL_INTERVAL_MS  = 300;    // 폴링 주기
const PUBLIC_DIR        = path.resolve(process.cwd(), 'public');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.svg':  'image/svg+xml',
};

// ── 포트 관리 유틸 ────────────────────────────────────────────────────────────

/** netstat으로 포트를 점유 중인 PID 목록 조회 (Windows) */
function findPidsOnPort(port: number): Promise<string[]> {
  return new Promise(resolve => {
    exec(`netstat -ano | findstr ":${port} "`, (_err, stdout) => {
      const pids = new Set<string>();
      for (const line of stdout.split('\n')) {
        const match = line.trim().match(/(\d+)\s*$/);
        if (match && match[1] !== '0') {
          pids.add(match[1]!);
        }
      }
      resolve([...pids]);
    });
  });
}

/**
 * tasklist로 PID 생존 여부 확인 (Windows)
 * 출력에 PID 번호가 포함되어 있으면 살아있는 것으로 판단
 */
function isPidAlive(pid: string): Promise<boolean> {
  return new Promise(resolve => {
    exec(`tasklist /FI "PID eq ${pid}" /NH`, (_err, stdout) => {
      resolve(stdout.includes(pid));
    });
  });
}

/** taskkill (without /F): 일반 종료 신호 전송 */
function sendGracefulSignal(pid: string): Promise<void> {
  return new Promise(resolve => {
    exec(`taskkill /PID ${pid}`, () => resolve()); // 실패해도 진행
  });
}

/** taskkill /F: 강제 종료 */
function forceKillPid(pid: string): Promise<void> {
  return new Promise(resolve => {
    exec(`taskkill /F /PID ${pid}`, (err) => {
      if (err) {
        console.warn(`\x1b[2m  [웹서버] PID ${pid} 강제 종료 실패 (이미 없을 수 있음)\x1b[0m`);
      } else {
        console.log(`\x1b[2m  [웹서버] PID ${pid} 강제 종료 완료\x1b[0m`);
      }
      resolve();
    });
  });
}

/**
 * Graceful → Force 2단계 종료
 *
 * 1. 일반 종료 신호 전송
 * 2. GRACEFUL_WAIT_MS 동안 300ms 간격으로 생존 폴링
 * 3. 여전히 살아있으면 강제 종료
 */
async function killPidGracefully(pid: string): Promise<void> {
  console.log(`\x1b[2m  [웹서버] PID ${pid} — 일반 종료 신호 전송\x1b[0m`);
  await sendGracefulSignal(pid);

  const deadline = Date.now() + GRACEFUL_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    if (!(await isPidAlive(pid))) {
      console.log(`\x1b[2m  [웹서버] PID ${pid} 정상 종료 확인\x1b[0m`);
      return;
    }
  }

  console.warn(
    `\x1b[33m  [웹서버] PID ${pid} ${GRACEFUL_WAIT_MS / 1000}초 후에도 살아있음 — 강제 종료\x1b[0m`,
  );
  await forceKillPid(pid);
}

/** 포트가 비어있는지 확인 (루프백만 테스트) */
function isPortFree(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => { probe.close(); resolve(true); });
    probe.listen(port, '127.0.0.1');
  });
}

/** 포트가 해제될 때까지 폴링 대기 */
async function waitPortFree(port: number): Promise<void> {
  const deadline = Date.now() + PORT_FREE_WAIT_MS;
  while (Date.now() < deadline) {
    if (await isPortFree(port)) return;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`포트 ${port} 해제 대기 시간 초과 (${PORT_FREE_WAIT_MS}ms)`);
}

/** server.listen()을 Promise로 래핑 */
function listenAsync(server: http.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.removeListener('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve();
    };
    server.once('error',     onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

// ── 요청 핸들러 ───────────────────────────────────────────────────────────────

function createRequestHandler(): http.RequestListener {
  return (req, res) => {
    const url = req.url ?? '/';

    // ── 헬스체크 ──────────────────────────────────────────
    if (url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
      return;
    }

    // ── /api/status ───────────────────────────────────────
    if (url === '/api/status') {
      getDatabase().then((db) => {
        const krw             = db.getBalance('KRW');
        const openPositions   = db.getAllOpenPositions();
        const closedPositions = db.getClosedPositions();
        const summary         = db.getSummary();

        const recentTrades = closedPositions.slice(0, 20).map((p) => ({
          id:             p.id,
          market:         p.market,
          opened_at:      p.opened_at,
          closed_at:      p.closed_at,
          avg_price:      p.avg_price,
          exit_price:     p.exit_price,
          total_invested: Math.round(p.total_invested),
          pnl:            p.pnl !== null ? Math.round(p.pnl) : null,
          pnl_rate:       p.pnl_rate,
          exit_reason:    p.exit_reason,
          dca_level:      p.dca_level,
        }));

        let cumulative = 0;
        const equityCurve = closedPositions
          .slice()
          .reverse()
          .map((p) => {
            cumulative += p.pnl ?? 0;
            return { timestamp: p.closed_at, cumulative_pnl: Math.round(cumulative) };
          });

        const body = JSON.stringify({
          timestamp:      new Date().toISOString(),
          balance: {
            krw_available: Math.round(krw?.available ?? 0),
            krw_locked:    Math.round(krw?.locked ?? 0),
          },
          open_positions: openPositions.map((p) => ({
            id:              p.id,
            market:          p.market,
            avg_price:       p.avg_price,
            total_volume:    p.total_volume,
            total_invested:  Math.round(p.total_invested),
            dca_level:       p.dca_level,
            stop_loss_price: Math.round(p.stop_loss_price),
            trailing_active: p.trailing_active,
            peak_price:      p.peak_price,
            opened_at:       p.opened_at,
          })),
          recent_trades: recentTrades,
          summary: {
            total_trades: summary.totalTrades,
            total_pnl:    Math.round(summary.totalPnl),
            win_rate:     summary.winRate,
          },
          equity_curve: equityCurve,
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(body);
      }).catch((err: Error) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
      return;
    }

    // ── 정적 파일 서빙 ────────────────────────────────────
    const urlPath  = url.split('?')[0] ?? '/';
    const relPath  = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
    const filePath = path.join(PUBLIC_DIR, relPath);

    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }
      const ext  = path.extname(filePath).toLowerCase();
      const mime = MIME[ext] ?? 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime });
      res.end(data);
    });
  };
}

// ── 공개 진입점 ───────────────────────────────────────────────────────────────

/**
 * 웹 서버를 시작합니다.
 *
 * 포트 충돌 시:
 *   1. netstat으로 점유 PID 확인
 *   2. taskkill /F로 강제 종료
 *   3. 포트 해제 확인 후 재바인딩
 *
 * 포트 충돌 시 종료 순서:
 *   1. taskkill (graceful) → 2. 3초 폴링 대기 → 3. 필요 시 taskkill /F → 4. 포트 해제 확인 → 5. listen
 *
 * @returns 서버 종료 함수 (shutdown hook용)
 */
export async function startWebServer(): Promise<() => void> {
  const server = http.createServer(createRequestHandler());

  try {
    await listenAsync(server, PORT);
    console.log(`\x1b[2m  웹 서버: http://localhost:${PORT}  |  헬스체크: /health\x1b[0m`);

  } catch (err) {
    const netErr = err as NodeJS.ErrnoException;
    if (netErr.code !== 'EADDRINUSE') throw err;

    console.warn(`\x1b[33m  [웹서버] ${PORT}번 포트 점유 중 — 기존 프로세스 종료 시도...\x1b[0m`);

    // STEP 1: 점유 PID 조회
    const pids = await findPidsOnPort(PORT);

    if (pids.length === 0) {
      console.warn(`\x1b[2m  [웹서버] PID를 찾지 못했습니다. 포트 해제를 기다립니다...\x1b[0m`);
    } else {
      console.log(`\x1b[2m  [웹서버] 종료 대상 PID: ${pids.join(', ')}\x1b[0m`);
      // STEP 2: Graceful → Force 순서로 병렬 종료
      await Promise.all(pids.map(killPidGracefully));
    }

    // STEP 3: 포트 해제 확인 (최대 5초 폴링)
    await waitPortFree(PORT);

    // STEP 4: 재바인딩
    await listenAsync(server, PORT);
    console.log(`\x1b[2m  웹 서버: http://localhost:${PORT}  |  헬스체크: /health\x1b[0m`);
  }

  return () => server.close();
}

// ── 내부 유틸 ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
