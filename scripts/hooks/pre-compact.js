'use strict'

/**
 * pre-compact 훅
 * Claude Code 컨텍스트 압축 직전에 실행됩니다.
 *
 * 역할:
 *  - 현재 작업 상태를 .claude/checkpoints/ 에 스냅샷으로 저장
 *  - git 미커밋 파일 목록 기록
 *  - 압축 전 요약 메시지 출력
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const HOOK_NAME = 'pre-compact'
const ROOT = process.cwd()
const CHECKPOINT_DIR = path.join(ROOT, '.claude', 'checkpoints')

exports.run = async function run(_rawInput) {
  // ── 1. 체크포인트 디렉토리 준비 ─────────────────────────────────
  fs.mkdirSync(CHECKPOINT_DIR, { recursive: true })

  const now = new Date()
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const checkpointFile = path.join(CHECKPOINT_DIR, `${stamp}.md`)

  const lines = [
    `# 체크포인트: ${now.toLocaleString('ko-KR')}`,
    '',
    '## 컨텍스트 압축 시점 스냅샷',
    '',
  ]

  // ── 2. git 상태 기록 ────────────────────────────────────────────
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: ROOT, stdio: 'pipe', encoding: 'utf8'
    }).trim()

    const log = execSync('git log --oneline -5', {
      cwd: ROOT, stdio: 'pipe', encoding: 'utf8'
    }).trim()

    const status = execSync('git status --short', {
      cwd: ROOT, stdio: 'pipe', encoding: 'utf8'
    }).trim()

    lines.push(`## Git 상태`)
    lines.push(`- 브랜치: \`${branch}\``)
    lines.push('')
    lines.push('### 최근 커밋 5개')
    lines.push('```')
    lines.push(log || '(커밋 없음)')
    lines.push('```')
    lines.push('')

    if (status) {
      lines.push('### 미커밋 변경 파일')
      lines.push('```')
      lines.push(status)
      lines.push('```')
    } else {
      lines.push('### 미커밋 변경사항 없음')
    }
  } catch {
    lines.push('> git 저장소 없음')
  }

  // ── 3. 체크포인트 파일 저장 ─────────────────────────────────────
  fs.writeFileSync(checkpointFile, lines.join('\n') + '\n', 'utf8')
  console.error(`[${HOOK_NAME}] 체크포인트 저장: .claude/checkpoints/${stamp}.md`)

  // ── 4. 오래된 체크포인트 정리 (최근 10개만 유지) ─────────────────
  try {
    const files = fs.readdirSync(CHECKPOINT_DIR)
      .filter(f => f.endsWith('.md'))
      .sort()
      .reverse()

    for (const old of files.slice(10)) {
      fs.unlinkSync(path.join(CHECKPOINT_DIR, old))
    }
  } catch {
    // 정리 실패해도 무시
  }

  return null
}
