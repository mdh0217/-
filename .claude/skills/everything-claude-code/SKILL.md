---
name: everything-claude-code-conventions
description: everything-claude-code 개발 컨벤션 및 패턴. 컨벤셔널 커밋을 사용하는 JavaScript 프로젝트.
---

# Everything Claude Code 컨벤션

> [affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code)에서 2026-03-20에 생성됨

## 개요

이 스킬은 Claude에게 everything-claude-code에서 사용하는 개발 패턴과 컨벤션을 가르칩니다.

## 기술 스택

- **주 언어**: JavaScript
- **아키텍처**: 하이브리드 모듈 구성
- **테스트 위치**: 별도 분리

## 이 스킬을 사용할 때

다음 상황에서 이 스킬을 활성화하세요:
- 이 저장소에 변경을 가할 때
- 기존 패턴에 따라 새 기능을 추가할 때
- 프로젝트 컨벤션에 맞는 테스트를 작성할 때
- 올바른 메시지 형식으로 커밋을 만들 때

## 커밋 컨벤션

500개 커밋 분석을 기반으로 한 커밋 메시지 컨벤션입니다.

### 커밋 스타일: 컨벤셔널 커밋

### 사용되는 접두사

- `fix`
- `test`
- `feat`
- `docs`

### 메시지 작성 지침

- 평균 메시지 길이: ~65자
- 첫 줄은 간결하고 설명적으로 유지
- 명령형 사용 ("기능 추가" 형태, "기능을 추가했습니다" 형태 금지)


*커밋 메시지 예시*

```text
feat(rules): add C# language support
```

*커밋 메시지 예시*

```text
chore(deps-dev): bump flatted (#675)
```

*커밋 메시지 예시*

```text
fix: auto-detect ECC root from plugin cache when CLAUDE_PLUGIN_ROOT is unset (#547) (#691)
```

*커밋 메시지 예시*

```text
docs: add Antigravity setup and usage guide (#552)
```

*커밋 메시지 예시*

```text
feat: add block-no-verify hook for Claude Code and Cursor (#649)
```

## 아키텍처

### 프로젝트 구조: 단일 패키지

이 프로젝트는 **하이브리드** 모듈 구성을 사용합니다.

### 설정 파일

- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `eslint.config.js`
- `package.json`

### 지침

- 이 프로젝트는 하이브리드 구성을 사용합니다
- 새 코드 추가 시 기존 패턴을 따르세요

## 코드 스타일

### 언어: JavaScript

### 이름 규칙

| 요소 | 규칙 |
|---------|------------|
| 파일 | camelCase |
| 함수 | camelCase |
| 클래스 | PascalCase |
| 상수 | SCREAMING_SNAKE_CASE |

### 임포트 스타일: 상대 경로 임포트

### 익스포트 스타일: 혼합 방식


*권장 임포트 스타일*

```typescript
// 상대 경로 임포트 사용
import { Button } from '../components/Button'
import { useAuth } from './hooks/useAuth'
```

## 테스트

### 테스트 프레임워크

특정 테스트 프레임워크가 감지되지 않았습니다 — 저장소의 기존 테스트 패턴을 사용하세요.

### 파일 패턴: `*.test.js`

### 테스트 유형

- **단위 테스트**: 개별 함수와 컴포넌트를 독립적으로 테스트
- **통합 테스트**: 여러 컴포넌트/서비스 간의 상호작용 테스트

### 커버리지

이 프로젝트에는 커버리지 리포팅이 설정되어 있습니다. 80%+ 커버리지를 목표로 하세요.


## 에러 처리

### 에러 처리 스타일: Try-Catch 블록


*표준 에러 처리 패턴*

```typescript
try {
  const result = await riskyOperation()
  return result
} catch (error) {
  console.error('작업 실패:', error)
  throw new Error('사용자 친화적인 메시지')
}
```

## 공통 워크플로우

커밋 패턴 분석을 통해 감지된 워크플로우입니다.

### 데이터베이스 마이그레이션

마이그레이션 파일을 포함한 데이터베이스 스키마 변경

**빈도**: 월 ~2회

**단계**:
1. 마이그레이션 파일 생성
2. 스키마 정의 업데이트
3. 타입 생성/업데이트

**주로 관련되는 파일**:
- `**/schema.*`
- `migrations/*`

### 기능 개발

표준 기능 구현 워크플로우

**빈도**: 월 ~22회

**단계**:
1. 기능 구현 추가
2. 기능에 대한 테스트 추가
3. 문서 업데이트

**주로 관련되는 파일**:
- `manifests/*`
- `schemas/*`
- `**/*.test.*`
- `**/api/**`

### 언어 규칙 추가

코딩 스타일, 훅, 패턴, 보안, 테스트 지침을 포함하여 새 프로그래밍 언어를 규칙 시스템에 추가

**빈도**: 월 ~2회

**단계**:
1. `rules/{언어}/` 아래에 새 디렉토리 생성
2. 언어별 내용으로 coding-style.md, hooks.md, patterns.md, security.md, testing.md 파일 추가
3. 선택적으로 관련 스킬을 참조하거나 링크

**주로 관련되는 파일**:
- `rules/*/coding-style.md`
- `rules/*/hooks.md`
- `rules/*/patterns.md`
- `rules/*/security.md`
- `rules/*/testing.md`

### 새 스킬 추가

워크플로우, 트리거, 사용법을 문서화한 새 스킬을 시스템에 추가

**빈도**: 월 ~4회

**단계**:
1. `skills/{스킬명}/` 아래에 새 디렉토리 생성
2. 문서화된 SKILL.md 추가 (사용 시기, 작동 방식, 예시 등)
3. 선택적으로 `skills/{스킬명}/scripts/`에 스크립트 또는 지원 파일 추가

**주로 관련되는 파일**:
- `skills/*/SKILL.md`
- `skills/*/scripts/*.sh`
- `skills/*/scripts/*.js`

### 새 에이전트 추가

코드 검토, 빌드 오류 해결 등을 위한 새 에이전트를 시스템에 추가

**빈도**: 월 ~2회

**단계**:
1. `agents/{에이전트명}.md` 아래에 새 에이전트 마크다운 파일 생성
2. `AGENTS.md`에 에이전트 등록
3. 선택적으로 README.md와 docs/COMMAND-AGENT-MAP.md 업데이트

**주로 관련되는 파일**:
- `agents/*.md`
- `AGENTS.md`
- `README.md`
- `docs/COMMAND-AGENT-MAP.md`

### 카탈로그 수 동기화

AGENTS.md와 README.md에 문서화된 에이전트, 스킬, 커맨드 수를 실제 저장소 상태와 동기화

**빈도**: 월 ~3회

**단계**:
1. AGENTS.md에서 에이전트, 스킬, 커맨드 수 업데이트
2. README.md(빠른 시작, 비교 표 등)에서 동일한 수 업데이트
3. 선택적으로 다른 문서 파일 업데이트

### 크로스 플랫폼 스킬 사본 추가

여러 플랫폼 호환성을 위해 다양한 에이전트 플랫폼(Codex, Cursor 등)용 스킬 사본 추가

**빈도**: 월 ~2회

**단계**:
1. SKILL.md를 `.agents/skills/{스킬}/SKILL.md` 및/또는 `.cursor/skills/{스킬}/SKILL.md`에 복사 또는 적용
2. 선택적으로 플랫폼별 openai.yaml 또는 설정 파일 추가
3. CONTRIBUTING 템플릿에 맞게 리뷰 피드백 반영

### 훅 추가 또는 업데이트

워크플로우, 품질, 보안 정책을 적용하기 위한 훅 추가 또는 업데이트

**빈도**: 월 ~1회

**단계**:
1. `hooks/` 또는 `scripts/hooks/`에 훅 스크립트 추가 또는 업데이트
2. `hooks/hooks.json` 또는 유사한 설정에 훅 등록
3. 선택적으로 `tests/hooks/`에 테스트 추가 또는 업데이트

### 리뷰 피드백 반영

명확성, 정확성, 컨벤션 정렬을 위해 문서, 스크립트, 설정을 수정하여 코드 리뷰 피드백 반영

**빈도**: 월 ~4회

**단계**:
1. 검토자 의견에 따라 SKILL.md, 에이전트, 커맨드 파일 수정
2. 요청에 따라 예시, 제목, 설정 업데이트
3. 모든 리뷰 피드백이 해결될 때까지 반복


## 모범 사례

코드베이스 분석을 기반으로 한 모범 사례입니다.

### 해야 할 것

- 컨벤셔널 커밋 형식 사용 (feat:, fix: 등)
- `*.test.js` 이름 패턴 준수
- 파일 이름에 camelCase 사용
- 혼합 익스포트 방식 선호

### 하지 말아야 할 것

- 모호한 커밋 메시지 작성 금지
- 새 기능에 대한 테스트 생략 금지
- 토론 없이 기존 패턴에서 벗어나지 말 것

---

*이 스킬은 [ECC Tools](https://ecc.tools)에 의해 자동 생성되었습니다. 팀에 맞게 검토하고 커스터마이즈하세요.*
