'use strict'

/**
 * post-edit-lint 훅  (PostToolUse: Write | Edit)
 * 파일 수정 후 자동으로 린트/포맷을 실행합니다.
 *
 * 지원 파일 유형:
 *  - .js  → ESLint --fix
 *  - .ts  → ESLint --fix + tsc --noEmit (설치된 경우)
 *  - .md  → markdownlint (설치된 경우)
 */

const path = require('path')
const { execSync } = require('child_process')
const fs = require('fs')
const logger = require('../lib/logger')

const HOOK_NAME = 'post-edit-lint'
const ROOT = process.cwd()

// node_modules 안이거나 설정 파일이면 건너뜀
const SKIP_PATTERNS = [
  'node_modules',
  '.git',
  '.claude',
  '.codex',
  '.agents',
  'coverage',
]

exports.run = async function run(rawInput) {
  let input
  try {
    input = JSON.parse(rawInput || '{}')
  } catch {
    return null
  }

  // Write / Edit 도구 입력에서 파일 경로 추출
  const filePath = input?.tool_input?.file_path ?? input?.tool_input?.path ?? null
  if (!filePath || typeof filePath !== 'string') { return null }

  const absPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(ROOT, filePath)

  // 건너뜀 패턴 확인
  const rel = path.relative(ROOT, absPath)
  if (SKIP_PATTERNS.some(p => rel.includes(p))) { return null }

  // 파일이 존재하는지 확인
  if (!fs.existsSync(absPath)) { return null }

  const ext = path.extname(absPath).toLowerCase()

  // ── .js 파일 → ESLint --fix ────────────────────────────────────
  if (ext === '.js') {
    runSilent(`npx eslint --fix "${absPath}"`, `ESLint (.js): ${rel}`)
  }

  // ── .ts / .tsx 파일 → ESLint --fix ────────────────────────────
  if (ext === '.ts' || ext === '.tsx') {
    runSilent(`npx eslint --fix "${absPath}"`, `ESLint (.ts): ${rel}`)
  }

  // ── .md 파일 → markdownlint ────────────────────────────────────
  if (ext === '.md') {
    runSilent(
      `npx markdownlint "${absPath}" --fix 2>/dev/null || true`,
      `markdownlint (.md): ${rel}`
    )
  }

  return null
}

function runSilent(cmd, label) {
  try {
    execSync(cmd, { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
    console.error(`[${HOOK_NAME}] ✓ ${label}`)
    logger.info(HOOK_NAME, label)
  } catch (err) {
    // lint 오류는 경고로만 표시 — 차단 안 함
    const msg = (err.stdout ?? err.message ?? '').toString().split('\n').slice(0, 3).join('\n')
    console.error(`[${HOOK_NAME}] ⚠  ${label}\n  ${msg}`)
    logger.warn(HOOK_NAME, label, { error: msg.trim() })
  }
}
