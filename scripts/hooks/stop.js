'use strict'

/**
 * stop 훅
 * Claude Code 세션 종료 시 실행됩니다.
 *
 * 역할:
 *  - 전체 테스트 실행 (tests/ 디렉토리가 있을 때만)
 *  - .claude/skills → .agents/skills 동기화
 *  - git 변경 파일 요약 출력
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const logger = require('../lib/logger')

const HOOK_NAME = 'stop'
const ROOT = process.cwd()

exports.run = async function run(_rawInput) {
  // ── 1. 테스트 실행 ───────────────────────────────────────────────
  // ECC_SKIP_TESTS=1 이면 재귀 실행 방지 (테스트 중 호출 시)
  const testRunner = path.join(ROOT, 'tests', 'run-all.js')
  const testsDir   = path.join(ROOT, 'tests')

  if (fs.existsSync(testRunner) && process.env.ECC_SKIP_TESTS !== '1') {
    const testFiles = collectTestFiles(testsDir)
    if (testFiles.length > 0) {
      console.error(`[${HOOK_NAME}] 테스트 실행 중 (${testFiles.length}개)...`)
      logger.info(HOOK_NAME, '테스트 실행 시작', { count: testFiles.length })
      try {
        execSync(`node "${testRunner}"`, { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
        console.error(`[${HOOK_NAME}] ✓ 모든 테스트 통과`)
        logger.info(HOOK_NAME, '테스트 전부 통과')
      } catch (err) {
        const out = (err.stdout ?? '') + (err.stderr ?? '')
        console.error(`[${HOOK_NAME}] ✗ 테스트 실패:\n${out.trim()}`)
        logger.error(HOOK_NAME, '테스트 실패', { output: out.trim().slice(0, 300) })
        // 테스트 실패해도 세션 종료는 허용 (exit 0 유지)
      }
    } else {
      console.error(`[${HOOK_NAME}] 테스트 파일 없음 — 건너뜀`)
      logger.info(HOOK_NAME, '테스트 파일 없음')
    }
  } else if (process.env.ECC_SKIP_TESTS === '1') {
    console.error(`[${HOOK_NAME}] 테스트 건너뜀 (ECC_SKIP_TESTS=1)`)
  }

  // ── 2. 스킬 동기화 ──────────────────────────────────────────────
  const syncScript = path.join(ROOT, 'scripts', 'sync-skills.js')
  if (fs.existsSync(syncScript)) {
    try {
      execSync(`node "${syncScript}"`, { cwd: ROOT, stdio: 'pipe' })
      console.error(`[${HOOK_NAME}] ✓ 스킬 동기화 완료`)
      logger.info(HOOK_NAME, '스킬 동기화 완료')
    } catch {
      console.error(`[${HOOK_NAME}] ⚠  스킬 동기화 실패`)
      logger.warn(HOOK_NAME, '스킬 동기화 실패')
    }
  }

  // ── 3. git 변경 요약 ─────────────────────────────────────────────
  try {
    const status = execSync('git status --short', {
      cwd: ROOT, stdio: 'pipe', encoding: 'utf8'
    }).trim()

    if (status) {
      const lines = status.split('\n')
      console.error(`[${HOOK_NAME}] 미커밋 변경 파일 ${lines.length}개:`)
      for (const line of lines.slice(0, 5)) {
        console.error(`  ${line}`)
      }
      if (lines.length > 5) {
        console.error(`  ... 외 ${lines.length - 5}개`)
      }
      logger.info(HOOK_NAME, '미커밋 변경 파일', { count: lines.length, files: lines.slice(0, 5) })
    } else {
      console.error(`[${HOOK_NAME}] 미커밋 변경사항 없음`)
      logger.info(HOOK_NAME, '미커밋 변경사항 없음')
    }
  } catch {
    // git 없으면 무시
  }

  // 세션 종료 구분선
  logger.divider('END')

  return null
}

function collectTestFiles(dir) {
  const results = []
  if (!fs.existsSync(dir)) { return results }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) { results.push(...collectTestFiles(full)) }
    else if (entry.name.endsWith('.test.js')) { results.push(full) }
  }
  return results
}
