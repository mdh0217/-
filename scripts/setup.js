'use strict'

/**
 * 프로젝트 초기 셋업 스크립트
 *
 * 새 환경에서 이 저장소를 처음 세팅할 때 실행합니다.
 * 사용법: node scripts/setup.js
 *         node scripts/setup.js --skip-install   (의존성 설치 건너뜀)
 *         node scripts/setup.js --skip-git       (git 초기화 건너뜀)
 *         node scripts/setup.js --check          (상태 확인만)
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const args = process.argv.slice(2)

const SKIP_INSTALL = args.includes('--skip-install')
const SKIP_GIT = args.includes('--skip-git')
const CHECK_ONLY = args.includes('--check')

// ── 색상 헬퍼 ─────────────────────────────────────────────────────
const ok = msg => console.log(`  ✓  ${msg}`)
const warn = msg => console.warn(`  ⚠  ${msg}`)
const err = msg => console.error(`  ✗  ${msg}`)
const info = msg => console.log(`  →  ${msg}`)
const header = msg => console.log(`\n── ${msg} ──────────────────────────────`)

// ── 필수 디렉토리 목록 ───────────────────────────────────────────
const REQUIRED_DIRS = [
  'scripts/lib',
  'scripts/hooks',
  'tests/lib',
  'tests/hooks',
  'skills',
  'rules',
  'migrations',
  'hooks',
]

// ── 필수 파일 목록 ──────────────────────────────────────────────
const REQUIRED_FILES = [
  { path: 'package.json',               desc: '패키지 설정' },
  { path: 'eslint.config.js',           desc: 'ESLint 설정' },
  { path: '.gitignore',                 desc: 'Git 무시 목록' },
  { path: '.env.example',               desc: '환경 변수 예시' },
  { path: 'tests/run-all.js',           desc: '테스트 러너' },
  { path: 'scripts/hooks/run-with-flags.js', desc: '훅 래퍼' },
  { path: 'scripts/sync-skills.js',     desc: '스킬 동기화' },
  { path: 'hooks/hooks.json',           desc: 'Claude Code 훅 설정' },
  { path: '.claude/identity.json',      desc: 'Claude 정체성 설정' },
  { path: '.claude/rules/node.md',      desc: 'Node.js 규칙' },
]

// ── 1단계: 디렉토리 점검/생성 ───────────────────────────────────
header('1단계: 디렉토리 구조')

let dirIssues = 0
for (const dir of REQUIRED_DIRS) {
  const full = path.join(ROOT, dir)
  if (fs.existsSync(full)) {
    ok(dir)
  } else {
    if (CHECK_ONLY) {
      err(`누락: ${dir}`)
      dirIssues++
    } else {
      fs.mkdirSync(full, { recursive: true })
      ok(`생성됨: ${dir}`)
    }
  }
}

// ── 2단계: 필수 파일 점검 ───────────────────────────────────────
header('2단계: 필수 파일')

let fileIssues = 0
for (const { path: relPath, desc } of REQUIRED_FILES) {
  const full = path.join(ROOT, relPath)
  if (fs.existsSync(full)) {
    ok(`${relPath}  (${desc})`)
  } else {
    err(`누락: ${relPath}  (${desc})`)
    fileIssues++
  }
}

// ── 3단계: .env 파일 점검 ───────────────────────────────────────
header('3단계: 환경 변수')

const envFile = path.join(ROOT, '.env')
if (!fs.existsSync(envFile)) {
  if (CHECK_ONLY) {
    warn('.env 파일 없음 — .env.example 을 복사해서 만들어 주세요')
  } else {
    fs.copyFileSync(path.join(ROOT, '.env.example'), envFile)
    info('.env.example → .env 복사 완료 (값을 채워주세요)')
  }
} else {
  ok('.env 존재')

  // 필수 환경변수 확인
  const envContent = fs.readFileSync(envFile, 'utf8')
  const requiredVars = ['GITHUB_TOKEN', 'EXA_API_KEY']
  for (const v of requiredVars) {
    const line = envContent.split('\n').find(l => l.startsWith(`${v}=`))
    if (!line || line.split('=')[1].trim() === '') {
      warn(`${v} 값이 비어있습니다`)
    } else {
      ok(`${v} 설정됨`)
    }
  }
}

// ── 4단계: Git 초기화 ───────────────────────────────────────────
if (!SKIP_GIT) {
  header('4단계: Git')

  const gitDir = path.join(ROOT, '.git')
  if (fs.existsSync(gitDir)) {
    ok('git 저장소 이미 초기화됨')
  } else if (!CHECK_ONLY) {
    try {
      execSync('git init', { cwd: ROOT, stdio: 'pipe' })
      ok('git init 완료')

      // 최초 커밋
      execSync('git add package.json eslint.config.js .gitignore .env.example', {
        cwd: ROOT, stdio: 'pipe'
      })
      execSync('git commit -m "chore: 프로젝트 초기 셋업"', {
        cwd: ROOT, stdio: 'pipe'
      })
      ok('최초 커밋 완료')
    } catch (e) {
      warn('git 초기화 실패: ' + e.message)
    }
  } else {
    err('git 저장소 없음 — git init 을 실행하세요')
  }
}

// ── 5단계: 의존성 설치 ──────────────────────────────────────────
if (!SKIP_INSTALL && !CHECK_ONLY) {
  header('5단계: 의존성 설치')

  const pkgManager = (() => {
    try { execSync('bun --version', { stdio: 'pipe' }); return 'bun' } catch {}
    try { execSync('npm --version', { stdio: 'pipe' }); return 'npm' } catch {}
    return null
  })()

  if (!pkgManager) {
    warn('bun 또는 npm을 찾을 수 없습니다. 수동으로 의존성을 설치해 주세요.')
  } else {
    try {
      info(`${pkgManager} install 실행 중...`)
      execSync(`${pkgManager} install`, { cwd: ROOT, stdio: 'inherit' })
      ok('의존성 설치 완료')
    } catch (e) {
      err('의존성 설치 실패: ' + e.message)
    }
  }
}

// ── 6단계: 스킬 동기화 ──────────────────────────────────────────
if (!CHECK_ONLY) {
  header('6단계: 스킬 동기화')
  try {
    execSync(`node "${path.join(ROOT, 'scripts', 'sync-skills.js')}"`, {
      cwd: ROOT, stdio: 'inherit'
    })
  } catch (e) {
    warn('스킬 동기화 실패: ' + e.message)
  }
}

// ── 최종 요약 ───────────────────────────────────────────────────
header('셋업 완료')

if (CHECK_ONLY) {
  const total = dirIssues + fileIssues
  if (total === 0) {
    ok('모든 항목 정상')
  } else {
    err(`문제 ${total}개 발견 — node scripts/setup.js 를 실행하여 해결하세요`)
    process.exit(1)
  }
} else {
  info('다음 단계:')
  console.log('    1. .env 파일에 GITHUB_TOKEN, EXA_API_KEY 값 채우기')
  console.log('    2. bun run test  — 테스트 실행')
  console.log('    3. bun run lint  — 린트 실행')
  console.log('    4. bun run lint:md  — 마크다운 린트 실행')
}
