#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# ECC 원클릭 셋업 스크립트 (Bash / WSL / Git Bash)
#
# 사용법:
#   bash setup.sh               # 전체 셋업
#   bash setup.sh --check       # 상태 확인만
#   bash setup.sh --skip-git    # Git 초기화 건너뜀
# ─────────────────────────────────────────────────────────────────

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKIP_GIT=false
CHECK_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --skip-git)   SKIP_GIT=true ;;
    --check)      CHECK_ONLY=true ;;
  esac
done

# ── 색상 출력 헬퍼 ─────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC}  $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC}  $1"; }
err()  { echo -e "  ${RED}✗${NC}  $1"; }
info() { echo -e "  ${CYAN}→${NC}  $1"; }
hdr()  { echo -e "\n── $1 ──────────────────────────────"; }

# ── 1단계: 디렉토리 생성 ───────────────────────────────────────
hdr "1단계: 디렉토리 구조"

DIRS=(
  "scripts/lib"
  "scripts/hooks"
  "tests/lib"
  "tests/hooks"
  "skills"
  "rules"
  "migrations"
  "hooks"
)

for dir in "${DIRS[@]}"; do
  if [ -d "$ROOT/$dir" ]; then
    ok "$dir"
  elif [ "$CHECK_ONLY" = true ]; then
    err "누락: $dir"
  else
    mkdir -p "$ROOT/$dir"
    ok "생성됨: $dir"
  fi
done

# ── 2단계: 필수 파일 점검 ──────────────────────────────────────
hdr "2단계: 필수 파일"

FILES=(
  "package.json:패키지 설정"
  "eslint.config.js:ESLint 설정"
  ".gitignore:Git 무시 목록"
  ".env.example:환경 변수 예시"
  "tests/run-all.js:테스트 러너"
  "scripts/hooks/run-with-flags.js:훅 래퍼"
  "scripts/sync-skills.js:스킬 동기화"
  "hooks/hooks.json:Claude Code 훅 설정"
  ".claude/identity.json:Claude 정체성"
  ".claude/rules/node.md:Node.js 규칙"
)

ISSUES=0
for entry in "${FILES[@]}"; do
  file="${entry%%:*}"
  desc="${entry##*:}"
  if [ -f "$ROOT/$file" ]; then
    ok "$file  ($desc)"
  else
    err "누락: $file  ($desc)"
    ((ISSUES++))
  fi
done

# ── 3단계: .env ────────────────────────────────────────────────
hdr "3단계: 환경 변수"

if [ ! -f "$ROOT/.env" ]; then
  if [ "$CHECK_ONLY" = true ]; then
    warn ".env 없음 — .env.example 을 복사하세요"
  else
    cp "$ROOT/.env.example" "$ROOT/.env"
    info ".env.example → .env 복사 완료 (값을 채워주세요)"
  fi
else
  ok ".env 존재"
  for var in GITHUB_TOKEN EXA_API_KEY; do
    val=$(grep "^${var}=" "$ROOT/.env" | cut -d'=' -f2-)
    if [ -z "$val" ]; then
      warn "$var 값이 비어있습니다"
    else
      ok "$var 설정됨"
    fi
  done
fi

# ── 4단계: Git 초기화 ──────────────────────────────────────────
if [ "$SKIP_GIT" = false ] && [ "$CHECK_ONLY" = false ]; then
  hdr "4단계: Git"
  if [ -d "$ROOT/.git" ]; then
    ok "git 저장소 이미 초기화됨"
  else
    git -C "$ROOT" init
    ok "git init 완료"
    git -C "$ROOT" add package.json eslint.config.js .gitignore .env.example 2>/dev/null || true
    git -C "$ROOT" commit -m "chore: 프로젝트 초기 셋업" 2>/dev/null || warn "최초 커밋 실패 (git config 확인 필요)"
  fi
fi

# ── 5단계: 의존성 설치 ─────────────────────────────────────────
if [ "$CHECK_ONLY" = false ]; then
  hdr "5단계: 의존성 설치"
  if command -v bun &>/dev/null; then
    info "bun install 실행 중..."
    bun install --cwd "$ROOT"
    ok "의존성 설치 완료 (bun)"
  elif command -v npm &>/dev/null; then
    info "npm install 실행 중..."
    npm install --prefix "$ROOT"
    ok "의존성 설치 완료 (npm)"
  else
    warn "bun/npm을 찾을 수 없습니다. 수동으로 설치해 주세요."
  fi
fi

# ── 6단계: 스킬 동기화 ─────────────────────────────────────────
if [ "$CHECK_ONLY" = false ]; then
  hdr "6단계: 스킬 동기화"
  node "$ROOT/scripts/sync-skills.js" || warn "스킬 동기화 실패"
fi

# ── 완료 ───────────────────────────────────────────────────────
hdr "셋업 완료"

if [ "$CHECK_ONLY" = true ]; then
  if [ "$ISSUES" -eq 0 ]; then
    ok "모든 항목 정상"
  else
    err "문제 ${ISSUES}개 발견 — bash setup.sh 를 실행하세요"
    exit 1
  fi
else
  info "다음 단계:"
  echo "    1. .env 파일에 GITHUB_TOKEN, EXA_API_KEY 값 채우기"
  echo "    2. bun run test   — 테스트 실행"
  echo "    3. bun run lint   — 린트 실행"
  echo "    4. bun run lint:md — 마크다운 린트"
fi
