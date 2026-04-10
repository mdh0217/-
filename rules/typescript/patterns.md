# TypeScript 패턴

> JavaScript 패턴(`rules/javascript/patterns.md`)을 TypeScript 특화 내용으로 확장합니다.

## 결과 타입 패턴

예외 대신 명시적 결과 타입을 반환해 타입 안전성을 높입니다.

```ts
type Result<T, E = string> =
  | { ok: true;  value: T }
  | { ok: false; error: E }

function parseConfig(raw: string): Result<Config> {
  try {
    return { ok: true, value: JSON.parse(raw) as Config }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}

// 호출부
const result = parseConfig(raw)
if (!result.ok) {
  console.error('설정 파싱 실패:', result.error)
  return null
}
// result.value가 Config 타입으로 안전하게 사용됨
```

## 빌더 패턴 (설정 객체)

```ts
interface QueryOptions {
  limit: number
  offset: number
  filter?: string
}

class QueryBuilder {
  private options: QueryOptions = { limit: 20, offset: 0 }

  withLimit(n: number): this {
    return Object.assign(Object.create(Object.getPrototypeOf(this)), {
      ...this,
      options: { ...this.options, limit: n }
    })
  }

  withFilter(f: string): this {
    return Object.assign(Object.create(Object.getPrototypeOf(this)), {
      ...this,
      options: { ...this.options, filter: f }
    })
  }

  build(): QueryOptions { return { ...this.options } }
}
```

## 타입 가드 패턴

```ts
// 좁은 타입 가드
function isString(val: unknown): val is string {
  return typeof val === 'string'
}

// 구조 검증 타입 가드
function isHookInput(val: unknown): val is HookInput {
  return (
    typeof val === 'object' &&
    val !== null &&
    'tool_name' in val &&
    typeof (val as HookInput).tool_name === 'string'
  )
}

// 배열 요소 타입 가드
function isStringArray(val: unknown): val is string[] {
  return Array.isArray(val) && val.every(isString)
}
```

## satisfies 연산자

타입 추론을 유지하면서 타입 조건을 검증합니다.

```ts
const config = {
  profile: 'full',
  hooks: ['session-start', 'pre-compact']
} satisfies { profile: 'full' | 'light' | 'off'; hooks: string[] }

// config.profile 은 'full' 리터럴 타입 (string이 아님)
```

## 불변 타입

```ts
// Readonly로 변경 방지
type ImmutableConfig = Readonly<{
  profile: string
  hooks: ReadonlyArray<string>
}>

// as const로 리터럴 타입 고정
const PROFILES = ['full', 'light', 'off'] as const
type Profile = typeof PROFILES[number]  // 'full' | 'light' | 'off'
```

## 제네릭 유틸리티

```ts
// 특정 키를 필수로 만들기
type RequireFields<T, K extends keyof T> = T & Required<Pick<T, K>>

// 특정 키를 제외하기
type Without<T, K extends keyof T> = Omit<T, K>

// 중첩 객체를 선택적으로
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}
```
