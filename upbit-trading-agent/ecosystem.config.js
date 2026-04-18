/**
 * PM2 프로세스 설정
 *
 * 사용법:
 *   pm2 start ecosystem.config.js   # 봇 시작
 *   pm2 save                        # 현재 프로세스 목록 저장
 *   pm2 startup                     # 시스템 부팅 시 자동 시작 등록
 *   pm2 logs upbit-bot              # 실시간 로그
 *   pm2 stop upbit-bot              # 봇 정지
 *   pm2 delete upbit-bot            # 프로세스 제거
 */

module.exports = {
  apps: [{
    name:          'upbit-bot',
    // start-bot.js 래퍼를 통해 ts-node 실행 (Windows PM2 호환)
    script:        'start-bot.js',
    autorestart:   true,
    restart_delay: 5000,      // 재시작 전 5초 대기
    max_restarts:  10,         // 최대 10회 재시작 (초과 시 stopped 상태)
    min_uptime:    '30s',      // 30초 미만 종료 시 crash 카운트
    out_file:      'logs/pm2-out.log',
    error_file:    'logs/pm2-err.log',
    merge_logs:    true,
    watch:         false,
    env: {
      NODE_ENV: 'production',
    },
  }],
};
