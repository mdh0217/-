'use strict'

/**
 * session-start.js 단위 테스트
 */

const path = require('path')
const hookModule = require(path.join(__dirname, '../../scripts/hooks/session-start.js'))

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
  console.log('\n[session-start] 테스트 시작\n')

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

  // ── 3. ECC_HOOK_PROFILE 확인 ──────────────────────────────────
  {
    const origProfile = process.env.ECC_HOOK_PROFILE
    process.env.ECC_HOOK_PROFILE = 'minimal'
    let threw = false
    try {
      await hookModule.run('')
    } catch {
      threw = true
    }
    process.env.ECC_HOOK_PROFILE = origProfile
    assert('ECC_HOOK_PROFILE=minimal 에서도 정상 동작', !threw)
  }

  console.log(`\n결과: ${passed}개 통과 / ${failed}개 실패\n`)
  if (failed > 0) {process.exit(1)}
}

main().catch(err => {
  console.error('[session-start.test] 예상치 못한 오류:', err.message)
  process.exit(1)
})
