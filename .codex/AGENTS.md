# Codex CLI용 ECC 가이드

루트 `AGENTS.md`를 Codex 전용 지침으로 보완합니다.

## 모델 추천

| 작업 유형 | 권장 모델 | 비고 |
|-----------|----------|------|
| 일반 코딩, 테스트, 포매팅 | `claude-haiku-4-5-20251001` | 빠름, 비용 효율 |
| 복잡한 기능, 아키텍처 | `claude-opus-4-6` | 깊은 추론 |
| 디버깅, 리팩토링 | `claude-sonnet-4-6` | 균형 |
| 보안 검토 | `claude-opus-4-6` | 최고 정확도 |
| 문서 리서치, API 검증 | `claude-sonnet-4-6` | 정보 검색 |

## 스킬 탐색

스킬은 `.agents/skills/`에서 자동으로 로드됩니다. 각 스킬에는 다음이 포함됩니다:
- `SKILL.md` — 상세 지침과 워크플로우
- `agents/openai.yaml` — Codex 인터페이스 메타데이터

사용 가능한 스킬:
- tdd-workflow — 80%+ 커버리지의 테스트 주도 개발
- security-review — 포괄적인 보안 체크리스트
- coding-standards — 보편적 코딩 표준
- frontend-patterns — React/Next.js 패턴
- frontend-slides — 뷰포트 안전한 HTML 프레젠테이션 및 PPTX-웹 변환
- article-writing — 노트와 음성 참조로부터 장문 작성
- content-engine — 플랫폼별 소셜 콘텐츠 및 재활용
- market-research — 출처가 명시된 시장 및 경쟁사 리서치
- investor-materials — 덱, 메모, 모델, 요약 자료
- investor-outreach — 개인화된 투자자 아웃리치 및 후속 조치
- backend-patterns — API 설계, 데이터베이스, 캐싱
- e2e-testing — Playwright E2E 테스트
- eval-harness — 평가 주도 개발
- strategic-compact — 컨텍스트 관리
- api-design — REST API 설계 패턴
- verification-loop — 빌드, 테스트, 린트, 타입 체크, 보안
- deep-research — firecrawl 및 exa MCP를 활용한 다중 소스 리서치
- exa-search — 웹, 코드, 기업 검색을 위한 Exa MCP 신경망 검색
- claude-api — Anthropic Claude API 패턴 및 SDK
- x-api — 게시, 스레드, 분석을 위한 X/Twitter API 연동
- crosspost — 멀티 플랫폼 콘텐츠 배포
- fal-ai-media — fal.ai를 통한 AI 이미지/비디오/오디오 생성
- dmux-workflows — dmux를 활용한 멀티 에이전트 오케스트레이션

## MCP 서버

프로젝트 로컬 `.codex/config.toml`을 ECC의 기본 Codex 설정으로 사용하세요. 현재 ECC 기준선은 GitHub, Context7, Exa, Memory, Playwright, Sequential Thinking을 활성화합니다. 실제로 필요한 작업이 있을 때만 `~/.codex/config.toml`에 무거운 추가 서버를 설정하세요.

ECC의 Codex 표준 섹션 이름은 `[mcp_servers.context7]`입니다. 런처 패키지는 `@upstash/context7-mcp`로 유지하되, TOML 섹션 이름만 `codex mcp list` 및 참조 설정과의 일관성을 위해 정규화됩니다.

## 멀티 에이전트 지원

Codex는 실험적 `features.multi_agent` 플래그를 통해 멀티 에이전트 워크플로우를 지원합니다.

- `.codex/config.toml`에서 `[features] multi_agent = true`로 활성화
- `[agents.<이름>]` 아래에 프로젝트 로컬 역할 정의
- `.codex/agents/` 아래의 TOML 레이어에 각 역할을 연결

이 저장소의 샘플 역할 설정:
- `.codex/agents/explorer.toml` — 읽기 전용 근거 수집
- `.codex/agents/reviewer.toml` — 정확성/보안 검토
- `.codex/agents/docs-researcher.toml` — API 및 릴리즈 노트 검증

## Claude Code와의 주요 차이점

| 기능 | Claude Code | Codex CLI |
|---------|------------|-----------|
| 훅 | 8가지 이상 이벤트 유형 | 아직 미지원 |
| 컨텍스트 파일 | CLAUDE.md + AGENTS.md | AGENTS.md만 사용 |
| 스킬 | 플러그인으로 로드 | `.agents/skills/` 디렉토리 |
| 커맨드 | `/슬래시` 커맨드 | 지시 기반 |
| MCP | 완전 지원 | `config.toml`로 지원 |

## 훅 없이 보안 적용하기

Codex에는 훅이 없으므로 보안은 지침 기반으로 적용합니다:
1. 시스템 경계에서 항상 입력을 검증하세요
2. 시크릿 하드코딩 금지 — 환경 변수 사용
3. 커밋 전 `npm audit` / `pip audit` 실행
4. 푸시 전마다 `git diff` 검토
5. 설정에서 `sandbox_mode = "workspace-write"` 사용
