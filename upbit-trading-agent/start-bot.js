'use strict';

const { spawn } = require('child_process');
const path      = require('path');

const jsScript = path.join(__dirname, 'dist', 'scripts', 'run-paper-trading.js');

const child = spawn(
  process.execPath,
  [jsScript],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      LOOP:         'true',
      INTERVAL_SEC: process.env['INTERVAL_SEC'] ?? '60',
    },
    windowsHide: true,
  },
);

child.on('error', (err) => {
  process.stderr.write(`[start-bot] spawn 실패: ${err.message}\n`);
  process.exit(1);
});
child.on('exit', (code) => process.exit(code ?? 0));

// PM2 stop/restart 신호 전달
process.on('SIGTERM', () => { child.kill('SIGTERM'); });
process.on('SIGINT',  () => { child.kill('SIGINT');  });
