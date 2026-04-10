# everything-claude-code Node.js 규칙

> ECC 코드베이스에 특화된 규칙입니다. 공통 규칙을 확장합니다.

## 기술 스택

- **런타임**: Node.js >=18 (트랜스파일 없음, 순수 CommonJS)
- **테스트 러너**: `node tests/run-all.js` — 개별 파일은 `node tests/**/*.test.js`
- **린터**: ESLint (`@eslint/js`, flat config)
- **커버리지**: c8
- **문서 린트**: `.md` 파일에 markdownlint-cli 사용

## 파일 컨벤션

- `scripts/` — Node.js 유틸리티, 훅. CommonJS (`require`/`module.exports`)
- `agents/`, `commands/`, `skills/`, `rules/` — YAML 프론트매터가 있는 마크다운
- `tests/` — `scripts/` 구조를 그대로 미러링. 테스트 파일명은 `*.test.js`
- 파일 이름: **소문자 + 하이픈** (예: `session-start.js`, `post-edit-format.js`)

## 코드 스타일

- CommonJS만 사용 — 파일이 `.mjs`로 끝나는 경우가 아니라면 ESM(`import`/`export`) 금지
- TypeScript 사용 금지 — 전체 코드베이스에서 순수 `.js` 파일만 사용
- `let` 보다 `const` 우선 사용; `var` 절대 금지
- 훅 스크립트는 200줄 이내로 유지 — 헬퍼는 `scripts/lib/`에 분리
- 모든 훅은 치명적이지 않은 오류에서 `exit 0` 필수 (도구 실행을 예기치 않게 차단하지 말 것)

## 훅 개발

- 훅 스크립트는 일반적으로 stdin으로 JSON을 받지만, `scripts/hooks/run-with-flags.js`를 통해 라우팅된 훅은 `run(rawInput)`을 내보내고 래퍼가 파싱/게이팅을 처리할 수 있음
- 비동기 훅: `settings.json`에서 `"async": true` 표시, 타임아웃 ≤30초
- 블로킹 훅(PreToolUse, stop): 빠르게 유지(<200ms) — 네트워크 호출 금지
- 모든 훅에 `run-with-flags.js` 래퍼를 사용하여 `ECC_HOOK_PROFILE`과 `ECC_DISABLED_HOOKS` 런타임 게이팅이 작동하도록 할 것
- 파싱 오류 시 항상 exit 0; stderr에 `[훅이름]` 접두사로 로그 남길 것

## 테스트 요구사항

- 커밋 전에 `node tests/run-all.js` 실행
- `scripts/lib/`에 새 스크립트 추가 시 `tests/lib/`에 대응하는 테스트 필요
- 새 훅 추가 시 `tests/hooks/`에 최소 하나의 통합 테스트 필요

## 마크다운 / 에이전트 파일

- 에이전트: `name`, `description`, `tools`, `model`이 있는 YAML 프론트매터
- 스킬: 섹션 구성 — 사용 시기, 작동 방식, 예시
- 커맨드: `description:` 프론트매터 라인 필수
- 커밋 전에 `npx markdownlint-cli '**/*.md' --ignore node_modules` 실행
