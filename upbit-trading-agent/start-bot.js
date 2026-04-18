/**
 * PM2 진입점 래퍼 (Windows 호환)
 *
 * PM2가 .cmd 파일을 직접 Node.js 스크립트로 해석하는 문제를 우회합니다.
 * ts-node.cmd를 child_process.spawn 으로 실행하고 종료 신호를 전달합니다.
 */

'use strict';

const { spawn } = require('child_process');
const path      = require('path');

const tsNodeCmd = path.join(__dirname, 'node_modules', '.bin', 'ts-node.cmd');
const tsScript  = path.join(__dirname, 'src', 'scripts', 'run-paper-trading.ts');

const child = spawn(
  'cmd.exe',
  ['/c', tsNodeCmd, '--project', 'tsconfig.json', tsScript],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      LOOP:         'true',
      INTERVAL_SEC: process.env['INTERVAL_SEC'] ?? '60',
    },
    shell: false,
  },
);

child.on('exit', (code) => process.exit(code ?? 0));

// PM2 stop/restart 신호 전달
process.on('SIGTERM', () => { child.kill('SIGTERM'); });
process.on('SIGINT',  () => { child.kill('SIGINT');  });
