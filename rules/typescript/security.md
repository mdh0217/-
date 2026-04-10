# TypeScript 보안 규칙

> JavaScript 보안 규칙(`rules/javascript/security.md`)을 TypeScript 특화 내용으로 확장합니다.

## 타입 시스템을 활용한 보안

### any 금지 — 타입 경계 붕괴 방지

```ts
// 금지 — any는 타입 검사 우회
function process(input: any) { return input.exec() }

// 올바름 — unknown + 타입 가드
function process(input: unknown) {
  if (typeof input !== 'string') { throw new Error('문자열만 허용') }
  return input.trim()
}
```

### 외부 데이터 타입 단언 금지

```ts
// 금지 — 런타임 검증 없이 단언
const config = JSON.parse(raw) as Config

// 올바름 — 런타임 검증 후 단언
function parseConfig(raw: string): Config | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isConfig(parsed)) { return null }
    return parsed  // 타입 가드로 안전하게 좁혀짐
  } catch {
    return null
  }
}
```

## 환경변수 타입 안전 접근

```ts
// 타입 안전한 환경변수 헬퍼
function getEnv(key: string): string {
  const val = process.env[key]
  if (!val) { throw new Error(`환경변수 누락: ${key}`) }
  return val
}

// 선택적 환경변수
function getEnvOptional(key: string, fallback = ''): string {
  return process.env[key] ?? fallback
}

// 사용
const token = getEnv('GITHUB_TOKEN')
const profile = getEnvOptional('ECC_HOOK_PROFILE', 'full') as Profile
```

## 경로 처리 보안

```ts
import path from 'path'

// path traversal 방지 — 타입 포함
function safePath(base: string, userInput: string): string {
  const resolved = path.resolve(base, userInput)
  if (!resolved.startsWith(path.resolve(base) + path.sep)) {
    throw new Error(`경로 이탈 감지: ${userInput}`)
  }
  return resolved
}
```

## 직렬화 보안

```ts
// BigInt, 함수 등 직렬화 불가 타입 방어
function safeStringify(val: unknown): string {
  return JSON.stringify(val, (_, v) => {
    if (typeof v === 'bigint') { return v.toString() }
    if (typeof v === 'function') { return undefined }
    return v
  })
}
```

## 의존성 보안

```bash
# 커밋 전 실행
bun audit
npx tsc --noEmit  # 타입 안전성 = 일종의 보안 검사
```

## 로그 보안 (타입 포함)

```ts
// 민감 필드를 제거하는 타입 안전 함수
type Sanitized<T> = Omit<T, 'token' | 'apiKey' | 'password' | 'secret'>

function sanitize<T extends Record<string, unknown>>(obj: T): Sanitized<T> {
  const { token, apiKey, password, secret, ...safe } = obj as Record<string, unknown>
  return safe as Sanitized<T>
}

console.log('[hook] 입력:', JSON.stringify(sanitize(input)))
```
