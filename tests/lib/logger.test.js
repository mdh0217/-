'use strict'

/**
 * scripts/lib/logger.js 단위 테스트
 */

const path = require('path')
const fs = require('fs')
const os = require('os')

// 테스트 전용 logs 경로를 임시 디렉토리로 교체
const ORIG_ROOT = path.resolve(__dirname, '../..')
const TMP_DIR = path.join(os.tmpdir(), `ecc-logger-test-${Date.now()}`)
const TMP_LOGS = path.join(TMP_DIR, 'logs')

// logger 모듈 내부의 ROOT를 직접 바꿀 수 없으므로,
// 실제 logs/ 경로를 테스트 후 정리하는 방식으로 진행
const REAL_LOGS = path.join(ORIG_ROOT, 'logs')

let passed = 0
let failed = 0

function assert(label, condition) {
  if (condition) {
    console.log(`  ✓  ${label}`)
    passed++
  } else {
    console.error(`  ✗  ${label}`)
    failed++
  }
}

function readLatestLog() {
  const logFile = path.join(REAL_LOGS, 'logs.txt')
  if (!fs.existsSync(logFile)) { return '' }
  return fs.readFileSync(logFile, 'utf8')
}

function getLogLineCount() {
  const content = readLatestLog()
  return content ? content.split('\n').filter(Boolean).length : 0
}

async function main() {
  console.log('\n[logger] 테스트 시작\n')

  // logger 로드 (실제 모듈)
  // require 캐시 초기화 후 재로드
  const loggerPath = path.join(ORIG_ROOT, 'scripts/lib/logger.js')
  delete require.cache[require.resolve(loggerPath)]
  const logger = require(loggerPath)

  // ── 1. logger.path가 존재 ─────────────────────────────────────
  assert('logger.path가 문자열', typeof logger.path === 'string')

  // ── 2. info 로그 기록 후 파일에 내용 있음 ──────────────────────
  {
    const before = getLogLineCount()
    logger.info('test', '정보 메시지')
    const after = getLogLineCount()
    assert('info() 호출 후 logs.txt 줄 수 증가', after > before)
  }

  // ── 3. warn 로그 ──────────────────────────────────────────────
  {
    logger.warn('test', '경고 메시지', { key: 'val' })
    const content = readLatestLog()
    assert('warn 로그에 [WARN] 포함', content.includes('[WARN]'))
    assert('warn 메타데이터 기록', content.includes('"key"'))
  }

  // ── 4. error 로그 ─────────────────────────────────────────────
  {
    logger.error('test', '오류 메시지')
    const content = readLatestLog()
    assert('error 로그에 [ERROR] 포함', content.includes('[ERROR]'))
  }

  // ── 5. divider START ──────────────────────────────────────────
  {
    const before = getLogLineCount()
    logger.divider('START')
    const after = getLogLineCount()
    assert('divider(START) 호출 후 줄 수 증가', after > before)
  }

  // ── 6. divider END ────────────────────────────────────────────
  {
    const before = getLogLineCount()
    logger.divider('END')
    const after = getLogLineCount()
    assert('divider(END) 호출 후 줄 수 증가', after > before)
  }

  // ── 7. tail() 반환 ───────────────────────────────────────────
  {
    const tail = logger.tail(5)
    assert('tail()이 문자열 반환', typeof tail === 'string')
    assert('tail()이 비어있지 않음', tail.length > 0)
  }

  // ── 8. tail(n) n줄 이하 반환 ─────────────────────────────────
  {
    const tail = logger.tail(3)
    const lines = tail.split('\n').filter(Boolean)
    assert('tail(3)은 최대 3줄', lines.length <= 3)
  }

  // ── 9. source 이름이 로그에 기록됨 ───────────────────────────
  {
    logger.info('my-source', '소스 테스트')
    const content = readLatestLog()
    assert('source 이름이 로그에 포함', content.includes('[my-source]'))
  }

  // ── 10. 날짜별 파일도 생성됨 ─────────────────────────────────
  {
    const today = new Date().toISOString().slice(0, 10)
    const dateFile = path.join(REAL_LOGS, `${today}.txt`)
    assert(`날짜별 파일(${today}.txt) 생성`, fs.existsSync(dateFile))
  }

  console.log(`\n결과: ${passed}개 통과 / ${failed}개 실패\n`)
  if (failed > 0) {process.exit(1)}
}

main().catch(err => {
  console.error('[logger.test] 예상치 못한 오류:', err.message)
  process.exit(1)
})
