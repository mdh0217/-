# TypeScript 테스트 규칙

> JavaScript 테스트 규칙(`rules/javascript/testing.md`)을 TypeScript 특화 내용으로 확장합니다.

## 기본 설정

- 파일 패턴: `*.test.ts`
- 실행: `bun test` 또는 `ts-node tests/run-all.ts`
- 커버리지: `c8` + `tsc --noEmit` 동시 통과 필요

## 테스트 파일 구조

```ts
// tests/lib/parseInput.test.ts
import assert from 'assert'
import { parseInput } from '../../scripts/lib/parseInput'

// 테스트 그룹 — 함수/모듈 단위로 구분
describe('parseInput', () => {
  it('정상 JSON 파싱', () => {
    const result = parseInput<{ tool_name: string }>('{"tool_name":"Bash"}')
    assert.deepStrictEqual(result?.tool_name, 'Bash')
  })

  it('빈 문자열은 null 반환', () => {
    assert.strictEqual(parseInput(''), null)
  })

  it('잘못된 JSON은 null 반환', () => {
    assert.strictEqual(parseInput('not-json'), null)
  })
})
```

## 타입 테스트 (컴파일 타임 검증)

런타임 테스트와 별도로 타입 추론을 검증합니다.

```ts
// tests/types/result.test-d.ts  (타입 전용 — 실행 없음)
import type { Result } from '../../scripts/lib/result'

// 올바른 타입인지 컴파일 타임에 검증
const ok: Result<number> = { ok: true, value: 42 }
const fail: Result<number> = { ok: false, error: '실패' }

// 타입 오류 — 이 줄은 컴파일 실패해야 함
// const wrong: Result<number> = { ok: true, value: 'string' }
```

## 목(Mock) 패턴

```ts
// 외부 의존성 격리
interface FileSystem {
  readFile(path: string): string
  exists(path: string): boolean
}

function createMockFs(files: Record<string, string>): FileSystem {
  return {
    readFile: (p) => {
      if (!(p in files)) { throw new Error(`파일 없음: ${p}`) }
      return files[p]
    },
    exists: (p) => p in files
  }
}

// 테스트에서 사용
const mockFs = createMockFs({ '/config.json': '{"profile":"full"}' })
const result = loadConfig('/config.json', mockFs)
assert.strictEqual(result?.profile, 'full')
```

## 비동기 테스트

```ts
it('비동기 훅 실행', async () => {
  const result = await runHook({ tool_name: 'Bash', tool_input: {} })
  assert.strictEqual(result, null)  // 기본 동작: 차단 없음
})

// 타임아웃 테스트
it('타임아웃 초과 시 null 반환', async () => {
  const result = await Promise.race([
    runSlowOperation(),
    new Promise<null>(resolve => setTimeout(() => resolve(null), 100))
  ])
  assert.strictEqual(result, null)
})
```

## 커버리지 + 타입 체크 동시 실행

```bash
# package.json scripts에 추가
"test:full": "tsc --noEmit && c8 bun test"
```
