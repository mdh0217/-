---
name: add-language-rules
description: everything-claude-code에서 언어 규칙을 추가하기 위한 워크플로우 커맨드 스캐폴드.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /add-language-rules

`everything-claude-code`에서 **언어 규칙 추가** 작업을 할 때 이 워크플로우를 사용하세요.

## 목표

코딩 스타일, 훅, 패턴, 보안, 테스트 지침을 포함하여 새 프로그래밍 언어를 규칙 시스템에 추가합니다.

## 관련 파일

- `rules/*/coding-style.md`
- `rules/*/hooks.md`
- `rules/*/patterns.md`
- `rules/*/security.md`
- `rules/*/testing.md`

## 권장 진행 순서

1. 수정하기 전에 현재 상태와 실패 원인을 파악하세요.
2. 워크플로우 목표를 충족하는 최소한의 일관된 변경만 하세요.
3. 수정한 파일에 가장 적합한 검증을 실행하세요.
4. 변경된 내용과 추가 검토가 필요한 항목을 요약하세요.

## 일반적인 커밋 신호

- `rules/{언어}/` 아래에 새 디렉토리 생성
- 언어별 내용으로 coding-style.md, hooks.md, patterns.md, security.md, testing.md 파일 추가
- 관련 스킬을 선택적으로 참조하거나 링크 추가

## 참고사항

- 이것은 스캐폴드이지 고정된 스크립트가 아닙니다.
- 워크플로우가 크게 변화하면 커맨드를 업데이트하세요.
