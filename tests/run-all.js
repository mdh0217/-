'use strict'

/**
 * 전체 테스트 러너
 * 사용법: node tests/run-all.js
 *        node tests/run-all.js --filter hooks   (특정 그룹만 실행)
 *        node tests/run-all.js --verbose        (상세 출력)
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const args = process.argv.slice(2)
const filter = args.find(a => a.startsWith('--filter='))?.split('=')[1] ?? null
const verbose = args.includes('--verbose')

// 테스트 파일 수집 (tests/**/*.test.js)
function collectTests(dir) {
  const results = []
  if (!fs.existsSync(dir)) { return results }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...collectTests(full))
    } else if (entry.name.endsWith('.test.js')) {
      results.push(full)
    }
  }
  return results
}

const testsDir = path.join(ROOT, 'tests')
let testFiles = collectTests(testsDir)

if (filter) {
  testFiles = testFiles.filter(f => f.includes(filter))
  if (testFiles.length === 0) {
    console.error(`[run-all] 필터 "${filter}"에 일치하는 테스트 없음`)
    process.exit(1)
  }
}

if (testFiles.length === 0) {
  console.log('[run-all] 실행할 테스트 파일 없음')
  process.exit(0)
}

console.log(`\n[run-all] 테스트 ${testFiles.length}개 발견\n`)

let passed = 0
let failed = 0
const failures = []

for (const file of testFiles) {
  const rel = path.relative(ROOT, file)
  try {
    execSync(`node "${file}"`, {
      cwd: ROOT,
      stdio: verbose ? 'inherit' : 'pipe'
    })
    console.log(`  ✓  ${rel}`)
    passed++
  } catch (err) {
    console.error(`  ✗  ${rel}`)
    if (verbose && err.stdout) { console.error(err.stdout.toString()) }
    if (err.stderr) { console.error(err.stderr.toString()) }
    failed++
    failures.push(rel)
  }
}

console.log(`\n결과: ${passed}개 통과 / ${failed}개 실패 (총 ${testFiles.length}개)\n`)

if (failed > 0) {
  console.error('실패한 테스트:')
  for (const f of failures) { console.error(`  - ${f}`) }
  process.exit(1)
}
