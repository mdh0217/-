'use strict'

/**
 * stop.js 단위 테스트
 */

const path = require('path')
const hookModule = require(path.join(__dirname, '../../scripts/hooks/stop.js'))

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

async function main() {
  console.log('\n[stop] 테스트 시작\n')

  // 재귀 방지: stop 훅이 내부에서 테스트 재실행하지 않도록
  process.env.ECC_SKIP_TESTS = '1'

  // ── 1. run()이 null 반환 (세션 차단 안 함) ───────────────────
  {
    const result = await hookModule.run('')
    assert('null 반환 (세션 차단 안 함)', result === null)
  }

  // ── 2. 오류 없이 완료 ─────────────────────────────────────────
  {
    let threw = false
    try {
      await hookModule.run('')
    } catch {
      threw = true
    }
    assert('예외 없이 완료', !threw)
  }

  console.log(`\n결과: ${passed}개 통과 / ${failed}개 실패\n`)
  if (failed > 0) {process.exit(1)}
}

main().catch(err => {
  console.error('[stop.test] 예상치 못한 오류:', err.message)
  process.exit(1)
})
