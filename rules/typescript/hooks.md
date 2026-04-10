# TypeScript 훅 설정

> JavaScript 훅 규칙(`rules/javascript/hooks.md`)을 TypeScript 특화 내용으로 확장합니다.

## 타입 체크 훅 (PostToolUse)

TypeScript 파일 수정 후 컴파일 에러를 즉시 감지합니다.

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "command": "node -e \"const f=process.env.TOOL_INPUT_FILE_PATH||''; if((f.endsWith('.ts')||f.endsWith('.tsx'))&&!f.includes('node_modules')){require('child_process').execSync('npx tsc --noEmit --pretty false',{stdio:'pipe',cwd:process.cwd()})}\"",
        "description": "TS 파일 수정 후 타입 체크"
      }
    ]
  }
}
```

## ESLint (TypeScript 전용)

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "command": "node -e \"const f=process.env.TOOL_INPUT_FILE_PATH||''; if(f.match(/\\.(ts|tsx)$/)&&!f.includes('node_modules')){require('child_process').execSync('npx eslint --fix \"'+f+'\"',{stdio:'pipe'})}\"",
        "description": "TS 파일 수정 후 ESLint 자동 수정"
      }
    ]
  }
}
```

## Stop 훅 — 빌드 검증

```json
{
  "hooks": {
    "Stop": [
      {
        "command": "npx tsc --noEmit",
        "description": "세션 종료 전 전체 타입 체크"
      }
    ]
  }
}
```

## 훅 실행 순서 (권장)

```
PostToolUse 실행 순서:
1. ESLint --fix  (스타일·규칙 자동 수정)
2. tsc --noEmit  (타입 오류 감지)

Stop 실행 순서:
1. tsc --noEmit  (전체 타입 체크)
2. 테스트 실행
```

## TypeScript 훅 스크립트 작성

TypeScript 훅은 컴파일 없이 `ts-node` 또는 `bun`으로 직접 실행하거나, CommonJS JS로 컴파일 후 사용합니다.

```ts
// scripts/hooks/my-hook.ts
import type { HookInput } from '../types'

export async function run(rawInput: string): Promise<HookInput | null> {
  let input: unknown
  try {
    input = JSON.parse(rawInput)
  } catch {
    console.error('[my-hook] 잘못된 JSON')
    return null
  }

  if (!isHookInput(input)) { return null }
  // 로직
  return null
}

function isHookInput(val: unknown): val is HookInput {
  return typeof val === 'object' && val !== null
}
```
