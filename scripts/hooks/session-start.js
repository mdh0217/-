'use strict'

/**
 * session-start 훅
 * Claude Code 세션 시작 시 실행됩니다.
 *
 * 역할:
 *  - 필수 환경변수 존재 여부 확인
 *  - git 상태 간략 출력
 *  - ECC 훅 프로파일 확인
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const logger = require('../lib/logger')

const HOOK_NAME = 'session-start'
const ROOT = process.cwd()

const REQUIRED_ENV = ['GITHUB_TOKEN', 'EXA_API_KEY']

exports.run = async function run(rawInput) {
  const lines = []

  // 세션 시작 구분선
  logger.divider('START')

  // ── 1. ECC 프로파일 확인 ────────────────────────────────────────
  const profile = process.env.ECC_HOOK_PROFILE ?? 'full'
  lines.push(`[${HOOK_NAME}] ECC 훅 프로파일: ${profile}`)
  logger.info(HOOK_NAME, `ECC 훅 프로파일: ${profile}`)

  // ── 2. 환경변수 점검 ────────────────────────────────────────────
  const missing = REQUIRED_ENV.filter(k => !process.env[k])
  if (missing.length > 0) {
    lines.push(`[${HOOK_NAME}] ⚠  누락된 환경변수: ${missing.join(', ')}`)
    lines.push(`[${HOOK_NAME}]    → .env 파일을 확인하세요`)
    logger.warn(HOOK_NAME, '누락된 환경변수', { missing })
  }

  // ── 3. .env 파일 존재 확인 ──────────────────────────────────────
  const envPath = path.join(ROOT, '.env')
  if (!fs.existsSync(envPath)) {
    lines.push(`[${HOOK_NAME}] ⚠  .env 파일 없음 — .env.example 을 복사하세요`)
    logger.warn(HOOK_NAME, '.env 파일 없음')
  }

  // ── 4. git 상태 확인 ────────────────────────────────────────────
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: ROOT, stdio: 'pipe', encoding: 'utf8'
    }).trim()

    const statusOut = execSync('git status --short', {
      cwd: ROOT, stdio: 'pipe', encoding: 'utf8'
    }).trim()

    const changed = statusOut ? statusOut.split('\n').length : 0
    lines.push(`[${HOOK_NAME}] git: ${branch} (변경 파일 ${changed}개)`)
    logger.info(HOOK_NAME, 'git 상태', { branch, changed })
  } catch {
    lines.push(`[${HOOK_NAME}] git 저장소 없음`)
    logger.warn(HOOK_NAME, 'git 저장소 없음')
  }

  // ── 5. 출력 ─────────────────────────────────────────────────────
  for (const line of lines) { console.error(line) }
  return null  // 세션 시작을 차단하지 않음
}
