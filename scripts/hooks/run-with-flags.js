'use strict'

/**
 * 훅 공통 래퍼 (node.md 명세)
 *
 * 모든 훅은 이 래퍼를 통해 실행합니다.
 * - ECC_HOOK_PROFILE 환경변수로 프로파일 게이팅
 * - ECC_DISABLED_HOOKS 환경변수로 개별 훅 비활성화
 * - stdin JSON 파싱 및 에러 시 exit 0 보장
 *
 * 사용법:
 *   node scripts/hooks/run-with-flags.js <hookName> <hookScriptPath>
 *
 * 예시:
 *   node scripts/hooks/run-with-flags.js session-start scripts/hooks/session-start.js
 */

const path = require('path')
const fs = require('fs')

const [,, hookName, hookScriptPath] = process.argv

if (!hookName || !hookScriptPath) {
  console.error('[run-with-flags] 사용법: node run-with-flags.js <훅이름> <스크립트경로>')
  process.exit(0) // 훅 실행을 차단하지 않음
}

// ── 1. 훅 비활성화 확인 ──────────────────────────────────────────
const disabledHooks = (process.env.ECC_DISABLED_HOOKS ?? '')
  .split(',')
  .map(h => h.trim())
  .filter(Boolean)

if (disabledHooks.includes(hookName)) {
  if (process.env.ECC_HOOK_DEBUG) {
    console.error(`[run-with-flags] 훅 비활성화됨: ${hookName}`)
  }
  process.exit(0)
}

// ── 2. 프로파일 게이팅 ───────────────────────────────────────────
const profile = process.env.ECC_HOOK_PROFILE ?? 'full'

if (profile === 'off') {
  process.exit(0)
}

// ── 3. 훅 스크립트 로드 ──────────────────────────────────────────
const scriptAbs = path.resolve(process.cwd(), hookScriptPath)

if (!fs.existsSync(scriptAbs)) {
  console.error(`[run-with-flags] 스크립트 파일 없음: ${scriptAbs}`)
  process.exit(0)
}

let hookModule
try {
  hookModule = require(scriptAbs)
} catch (err) {
  console.error(`[run-with-flags][${hookName}] 모듈 로드 실패:`, err.message)
  process.exit(0)
}

// ── 4. stdin JSON 읽기 ────────────────────────────────────────────
let rawInput = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => { rawInput += chunk })
process.stdin.on('end', async () => {
  try {
    const result = typeof hookModule.run === 'function'
      ? await hookModule.run(rawInput)
      : null

    // 출력이 있으면 stdout으로 전달
    if (result != null) {
      process.stdout.write(typeof result === 'string' ? result : JSON.stringify(result))
    }
  } catch (err) {
    console.error(`[run-with-flags][${hookName}] 실행 중 오류:`, err.message)
    // 항상 exit 0 — 훅 오류로 도구 실행을 차단하지 않음
  }
  process.exit(0)
})
