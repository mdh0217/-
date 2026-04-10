# TypeScript 코딩 스타일

> JavaScript 규칙(`rules/javascript/coding-style.md`)을 TypeScript 특화 내용으로 확장합니다.

## 기본 원칙

- TypeScript strict 모드 항상 활성화 (`"strict": true`)
- `any` 타입 사용 금지 — 불가피할 경우 `unknown` 사용 후 타입 가드 적용
- `as` 타입 단언 최소화 — 타입 가드나 `satisfies` 연산자를 먼저 고려

## tsconfig 기준

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node"
  }
}
```

## 타입 정의

### 인터페이스 vs 타입 별칭

- **객체 형태**: `interface` 사용 (확장 가능)
- **유니언·교차 타입, 유틸리티 타입**: `type` 사용

```ts
// 객체 형태 → interface
interface HookInput {
  tool_name: string
  tool_input: Record<string, unknown>
}

// 유니언 → type
type HookResult = HookInput | null
type Profile = 'light' | 'full' | 'off'
```

### 제네릭

```ts
// 구체적인 제약 조건을 사용
function parseResult<T extends Record<string, unknown>>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}
```

## 이름 규칙 (JavaScript 규칙 + 추가)

| 대상 | 규칙 | 예시 |
|------|------|------|
| 인터페이스 | PascalCase | `HookInput`, `SkillConfig` |
| 타입 별칭 | PascalCase | `HookResult`, `Profile` |
| Enum | PascalCase (값은 PascalCase) | `LogLevel.Error` |
| 제네릭 타입 파라미터 | 단일 대문자 또는 설명형 | `T`, `TInput`, `TResult` |

## null / undefined 처리

```ts
// 옵셔널 체이닝 우선
const name = user?.profile?.name ?? '이름 없음'

// 타입 가드
function isHookInput(val: unknown): val is HookInput {
  return (
    typeof val === 'object' &&
    val !== null &&
    typeof (val as HookInput).tool_name === 'string'
  )
}

// as 단언 대신 타입 가드 사용
const input = parseResult(raw)
if (isHookInput(input)) {
  // 여기서 input은 HookInput 타입으로 안전하게 좁혀짐
  console.log(input.tool_name)
}
```

## 임포트

```ts
// 타입만 임포트할 때는 import type 사용 (런타임 번들 크기 절감)
import type { HookInput, HookResult } from './types'
import { parseInput } from './lib/parseInput'
```

## 에러 처리

```ts
// catch의 error는 unknown — 반드시 타입 좁히기
try {
  return JSON.parse(raw)
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  console.error('[hook] 파싱 실패:', message)
  return null
}
```
