# JavaScript 훅 설정

> Claude Code / ECC 훅 PostToolUse 및 PreToolUse 설정 가이드

## 권장 PostToolUse 훅

### ESLint 자동 수정

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "command": "node -e \"const f=process.env.TOOL_INPUT_FILE_PATH||''; if(f.endsWith('.js')&&!f.includes('node_modules')){require('child_process').execSync('npx eslint --fix \"'+f+'\"',{stdio:'pipe'})}\"",
        "description": "JS 파일 수정 후 ESLint 자동 수정"
      }
    ]
  }
}
```

### 마크다운 린트

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "command": "node -e \"const f=process.env.TOOL_INPUT_FILE_PATH||''; if(f.endsWith('.md')&&!f.includes('node_modules')){require('child_process').execSync('npx markdownlint \"'+f+'\"',{stdio:'pipe'})}\"",
        "description": "MD 파일 수정 후 마크다운 린트"
      }
    ]
  }
}
```

## PreToolUse 훅

### 파일 크기 제한 (200줄 — 훅 스크립트 전용)

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write",
        "command": "node scripts/hooks/check-file-size.js",
        "description": "훅 스크립트 200줄 초과 방지"
      }
    ]
  }
}
```

## Stop 훅

### 세션 종료 시 테스트 실행

```json
{
  "hooks": {
    "Stop": [
      {
        "command": "node tests/run-all.js",
        "description": "세션 종료 전 전체 테스트 실행"
      }
    ]
  }
}
```

## 훅 스크립트 작성 규칙

- 반드시 `scripts/hooks/run-with-flags.js` 래퍼 사용
- `ECC_HOOK_PROFILE` 환경변수 게이팅 자동 적용됨
- 오류 시 항상 `exit 0` (도구 실행 차단 금지)
- stderr 로그는 `[훅이름]` 접두사 필수
- 블로킹 훅(PreToolUse): 200ms 이하, 네트워크 호출 금지

```js
// scripts/hooks/my-hook.js
'use strict'

exports.run = async function(rawInput) {
  try {
    const input = JSON.parse(rawInput)
    // 훅 로직
    return input  // 수정된 input 반환 (PreToolUse) 또는 null (PostToolUse)
  } catch (err) {
    console.error('[my-hook] 오류:', err.message)
    return null
  }
}
```
