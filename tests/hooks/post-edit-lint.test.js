'use strict'

/**
 * post-edit-lint.js 단위 테스트
 */

const path = require('path')
const fs = require('fs')
const os = require('os')

const ROOT = path.resolve(__dirname, '../..')
const hookModule = require(path.join(ROOT, 'scripts/hooks/post-edit-lint.js'))

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
  console.log('\n[post-edit-lint] 테스트 시작\n')

  // ── 1. 빈 입력 → null 반환 ────────────────────────────────────
  {
    const result = await hookModule.run('')
    assert('빈 입력은 null 반환', result === null)
  }

  // ── 2. file_path 없는 입력 → null 반환 ───────────────────────
  {
    const result = await hookModule.run(JSON.stringify({ tool_input: {} }))
    assert('file_path 없으면 null 반환', result === null)
  }

  // ── 3. node_modules 경로 → 건너뜀 ────────────────────────────
  {
    const result = await hookModule.run(
      JSON.stringify({ tool_input: { file_path: path.join(ROOT, 'node_modules/foo/bar.js') } })
    )
    assert('node_modules 경로는 건너뜀', result === null)
  }

  // ── 4. .claude 경로 → 건너뜀 ─────────────────────────────────
  {
    const result = await hookModule.run(
      JSON.stringify({ tool_input: { file_path: path.join(ROOT, '.claude/settings.local.json') } })
    )
    assert('.claude 경로는 건너뜀', result === null)
  }

  // ── 5. 존재하지 않는 파일 → null 반환 ────────────────────────
  {
    const result = await hookModule.run(
      JSON.stringify({ tool_input: { file_path: path.join(ROOT, 'nonexistent.js') } })
    )
    assert('존재하지 않는 파일은 null 반환', result === null)
  }

  // ── 6. 실제 .js 파일 → lint 실행 후 null 반환 ────────────────
  {
    const tmpFile = path.join(os.tmpdir(), `ecc-test-${Date.now()}.js`)
    fs.writeFileSync(tmpFile, `'use strict'\nconst x = 1\n`)
    const result = await hookModule.run(
      JSON.stringify({ tool_input: { file_path: tmpFile } })
    )
    fs.unlinkSync(tmpFile)
    assert('.js 파일 처리 후 null 반환 (오류 없음)', result === null)
  }

  // ── 7. JSON 파싱 실패 → null 반환 ────────────────────────────
  {
    const result = await hookModule.run('not-json{{{{')
    assert('잘못된 JSON → null 반환', result === null)
  }

  console.log(`\n결과: ${passed}개 통과 / ${failed}개 실패\n`)
  if (failed > 0) {process.exit(1)}
}

main().catch(err => {
  console.error('[post-edit-lint.test] 예상치 못한 오류:', err.message)
  process.exit(1)
})
