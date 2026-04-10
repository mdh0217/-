'use strict'

/**
 * 스킬 동기화 스크립트
 *
 * .claude/skills/ 의 SKILL.md 파일들을 .agents/skills/ 에 미러링합니다.
 * 사용법: node scripts/sync-skills.js
 *         node scripts/sync-skills.js --dry-run  (실제 복사 없이 확인만)
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const SOURCE_DIR = path.join(ROOT, '.claude', 'skills')
const TARGET_DIR = path.join(ROOT, '.agents', 'skills')
const isDryRun = process.argv.includes('--dry-run')

if (!fs.existsSync(SOURCE_DIR)) {
  console.error(`[sync-skills] 소스 디렉토리 없음: ${SOURCE_DIR}`)
  process.exit(1)
}

let synced = 0
let skipped = 0

// .claude/skills/{skillName}/SKILL.md → .agents/skills/{skillName}/SKILL.md
for (const skillName of fs.readdirSync(SOURCE_DIR)) {
  const srcSkill = path.join(SOURCE_DIR, skillName, 'SKILL.md')
  const dstDir = path.join(TARGET_DIR, skillName)
  const dstSkill = path.join(dstDir, 'SKILL.md')

  if (!fs.existsSync(srcSkill)) {
    skipped++
    continue
  }

  const srcContent = fs.readFileSync(srcSkill, 'utf8')

  // 대상 파일이 이미 동일하면 건너뜀
  if (fs.existsSync(dstSkill) && fs.readFileSync(dstSkill, 'utf8') === srcContent) {
    console.log(`  = (동일) ${skillName}/SKILL.md`)
    skipped++
    continue
  }

  if (isDryRun) {
    console.log(`  → (dry-run) ${skillName}/SKILL.md 동기화 예정`)
  } else {
    fs.mkdirSync(dstDir, { recursive: true })
    fs.writeFileSync(dstSkill, srcContent, 'utf8')
    console.log(`  ✓ 동기화: ${skillName}/SKILL.md`)
  }
  synced++
}

console.log(`\n[sync-skills] 완료 — 동기화: ${synced}개, 건너뜀: ${skipped}개`)
if (isDryRun) { console.log('(dry-run 모드 — 실제 파일은 변경되지 않았습니다)') }
