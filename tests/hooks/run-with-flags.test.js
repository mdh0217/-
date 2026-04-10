'use strict'

/**
 * run-with-flags.js 통합 테스트
 */

const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '../..')
const RUNNER = path.join(ROOT, 'scripts/hooks/run-with-flags.js')

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

function run(args = '', env = {}, stdin = '') {
  try {
    const result = execSync(
      `node "${RUNNER}" ${args}`,
      {
        cwd: ROOT,
        env: { ...process.env, ...env },
        input: stdin,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    )
    return { stdout: result, code: 0 }
  } catch (err) {
    return { stdout: err.stdout ?? '', stderr: err.stderr ?? '', code: err.status ?? 1 }
  }
}

console.log('\n[run-with-flags] 테스트 시작\n')

// ── 1. 인수 없이 실행하면 exit 0 ─────────────────────────────────
{
  const { code } = run()
  assert('인수 없으면 exit 0', code === 0)
}

// ── 2. ECC_HOOK_PROFILE=off 이면 exit 0 ──────────────────────────
{
  const dummyScript = path.join(ROOT, 'tests/hooks/_dummy.js')
  fs.writeFileSync(dummyScript, `exports.run = async () => { throw new Error('should not run') }`)
  const { code } = run(`test-hook "${dummyScript}"`, { ECC_HOOK_PROFILE: 'off' })
  fs.unlinkSync(dummyScript)
  assert('ECC_HOOK_PROFILE=off 이면 스크립트 실행 안 함', code === 0)
}

// ── 3. ECC_DISABLED_HOOKS에 훅 이름 있으면 exit 0 ─────────────────
{
  const dummyScript = path.join(ROOT, 'tests/hooks/_dummy2.js')
  fs.writeFileSync(dummyScript, `exports.run = async () => { throw new Error('should not run') }`)
  const { code } = run(`my-hook "${dummyScript}"`, { ECC_DISABLED_HOOKS: 'my-hook,other' })
  fs.unlinkSync(dummyScript)
  assert('ECC_DISABLED_HOOKS에 포함되면 실행 안 함', code === 0)
}

// ── 4. 존재하지 않는 스크립트 → exit 0 (차단 안 함) ─────────────
{
  const { code } = run(`test-hook "/nonexistent/path.js"`)
  assert('존재하지 않는 스크립트도 exit 0', code === 0)
}

// ── 5. 정상 스크립트 실행 → stdout 반환 ─────────────────────────
{
  const dummyScript = path.join(ROOT, 'tests/hooks/_echo.js')
  fs.writeFileSync(dummyScript, `exports.run = async (raw) => 'pong'`)
  const { code, stdout } = run(`echo-hook "${dummyScript}"`, {}, 'ping')
  fs.unlinkSync(dummyScript)
  assert('정상 스크립트 실행 후 exit 0', code === 0)
  assert('run() 반환값이 stdout으로 출력', stdout.trim() === 'pong')
}

// ── 6. run()이 오류 던져도 exit 0 ──────────────────────────────
{
  const dummyScript = path.join(ROOT, 'tests/hooks/_throw.js')
  fs.writeFileSync(dummyScript, `exports.run = async () => { throw new Error('boom') }`)
  const { code } = run(`throw-hook "${dummyScript}"`)
  fs.unlinkSync(dummyScript)
  assert('run() 오류 시에도 exit 0', code === 0)
}

console.log(`\n결과: ${passed}개 통과 / ${failed}개 실패\n`)
if (failed > 0) {process.exit(1)}
