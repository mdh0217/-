'use strict'

/**
 * ECC 로거 모듈
 *
 * 실행 이벤트를 logs/logs.txt 에 기록합니다.
 * 날짜가 바뀌면 logs/YYYY-MM-DD.txt 로 자동 롤오버됩니다.
 *
 * 사용법:
 *   const logger = require('./scripts/lib/logger')
 *   logger.info('session-start', '세션 시작')
 *   logger.warn('session-start', '환경변수 누락: GITHUB_TOKEN')
 *   logger.error('post-edit-lint', 'ESLint 실패', { file: 'foo.js' })
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '../..')
const LOGS_DIR = path.join(ROOT, 'logs')
const LATEST_LOG = path.join(LOGS_DIR, 'logs.txt')

const LEVELS = { info: 'INFO', warn: 'WARN', error: 'ERROR' }

// ── 내부 유틸 ────────────────────────────────────────────────────

function ensureLogsDir() {
  fs.mkdirSync(LOGS_DIR, { recursive: true })
}

function todayFile() {
  const d = new Date()
  const ymd = d.toISOString().slice(0, 10) // YYYY-MM-DD
  return path.join(LOGS_DIR, `${ymd}.txt`)
}

function timestamp() {
  return new Date().toLocaleString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  })
}

/**
 * 로그 한 줄을 파일에 기록합니다.
 * @param {'info'|'warn'|'error'} level
 * @param {string} source  훅/모듈 이름 (예: 'session-start')
 * @param {string} message
 * @param {object} [meta]  추가 데이터 (선택)
 */
function write(level, source, message, meta) {
  try {
    ensureLogsDir()

    const levelLabel = LEVELS[level] ?? 'INFO'
    const metaPart = meta ? ` | ${JSON.stringify(meta)}` : ''
    const line = `[${timestamp()}] [${levelLabel}] [${source}] ${message}${metaPart}\n`

    // 오늘 날짜 파일에 추가
    fs.appendFileSync(todayFile(), line, 'utf8')

    // logs.txt 에도 동일하게 추가 (항상 최신 로그를 한 곳에서 볼 수 있도록)
    fs.appendFileSync(LATEST_LOG, line, 'utf8')
  } catch {
    // 로그 실패는 프로그램 실행을 막지 않음
  }
}

// ── 퍼블릭 API ───────────────────────────────────────────────────

const logger = {
  /**
   * 일반 정보 로그
   * @param {string} source
   * @param {string} message
   * @param {object} [meta]
   */
  info(source, message, meta) {
    write('info', source, message, meta)
  },

  /**
   * 경고 로그
   * @param {string} source
   * @param {string} message
   * @param {object} [meta]
   */
  warn(source, message, meta) {
    write('warn', source, message, meta)
  },

  /**
   * 오류 로그
   * @param {string} source
   * @param {string} message
   * @param {object} [meta]
   */
  error(source, message, meta) {
    write('error', source, message, meta)
  },

  /**
   * 세션 구분선 기록 (시작/종료 시 가독성을 위해 사용)
   * @param {'START'|'END'} kind
   */
  divider(kind) {
    try {
      ensureLogsDir()
      const line = kind === 'START'
        ? `\n${'─'.repeat(60)}\n[${timestamp()}] 세션 시작\n${'─'.repeat(60)}\n`
        : `[${timestamp()}] 세션 종료\n${'─'.repeat(60)}\n`
      fs.appendFileSync(todayFile(), line, 'utf8')
      fs.appendFileSync(LATEST_LOG, line, 'utf8')
    } catch {
      // 무시
    }
  },

  /**
   * logs.txt 최근 N줄 반환 (미리보기용)
   * @param {number} [n=20]
   * @returns {string}
   */
  tail(n = 20) {
    try {
      if (!fs.existsSync(LATEST_LOG)) { return '(로그 없음)' }
      const lines = fs.readFileSync(LATEST_LOG, 'utf8').split('\n').filter(Boolean)
      return lines.slice(-n).join('\n')
    } catch {
      return '(로그 읽기 실패)'
    }
  },

  /** logs.txt 경로 */
  get path() { return LATEST_LOG },
}

module.exports = logger
