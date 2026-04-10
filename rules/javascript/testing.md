# JavaScript 테스트 규칙

## 기본 원칙

- 테스트 러너: `node tests/run-all.js`
- 파일 패턴: `*.test.js` (테스트 파일임을 명시)
- 구조: `tests/` 는 `scripts/` 를 그대로 미러링
- 커버리지 도구: `c8` → 목표 80% 이상

```
scripts/lib/parseInput.js     →  tests/lib/parseInput.test.js
scripts/hooks/session-start.js →  tests/hooks/session-start.test.js
```

## 테스트 작성 형식 (AAA 패턴)

```js
'use strict'

const assert = require('assert')
const { parseInput } = require('../../scripts/lib/parseInput')

// ── parseInput ──────────────────────────────────────────────────

// 정상 케이스
{
  const result = parseInput('{"tool_name":"Bash"}')
  assert.deepStrictEqual(result, { tool_name: 'Bash' }, '정상 JSON 파싱')
}

// 빈 문자열
{
  const result = parseInput('')
  assert.strictEqual(result, null, '빈 문자열은 null 반환')
}

// 잘못된 JSON
{
  const result = parseInput('not-json')
  assert.strictEqual(result, null, '잘못된 JSON은 null 반환')
}

// null 입력
{
  const result = parseInput(null)
  assert.strictEqual(result, null, 'null 입력은 null 반환')
}

console.log('✓ parseInput 테스트 통과')
```

## 테스트 이름 규칙

테스트 설명은 **동작을 서술**합니다. "무엇을 하는지"가 아니라 "어떤 상황에서 어떤 결과인지".

```js
// 좋음
assert.strictEqual(result, null, '빈 입력 시 null 반환')
assert.strictEqual(result.ok, false, 'API 오류 시 ok가 false')

// 나쁨
assert.strictEqual(result, null, '테스트 1')
assert.strictEqual(result.ok, false, 'parseInput 함수')
```

## 커버리지 실행

```bash
# 커버리지 측정
bun run coverage

# 또는
npx c8 node tests/run-all.js

# 특정 파일만
npx c8 node tests/lib/parseInput.test.js
```

## 훅 통합 테스트

훅 스크립트 테스트는 `run-with-flags.js` 래퍼를 거친 전체 흐름을 검증합니다.

```js
'use strict'

const assert = require('assert')
const { execSync } = require('child_process')
const path = require('path')

const ROOT = path.resolve(__dirname, '../..')

function runHook(hookName, scriptPath, input) {
  const cmd = `node scripts/hooks/run-with-flags.js ${hookName} ${scriptPath}`
  return execSync(cmd, {
    cwd: ROOT,
    input: JSON.stringify(input),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  })
}

// ECC_DISABLED_HOOKS 환경변수로 훅 비활성화 시 빈 출력
{
  const result = execSync(
    `node scripts/hooks/run-with-flags.js session-start scripts/hooks/session-start.js`,
    {
      cwd: ROOT,
      env: { ...process.env, ECC_DISABLED_HOOKS: 'session-start' },
      input: '{}',
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    }
  )
  assert.strictEqual(result.trim(), '', '비활성화된 훅은 빈 출력')
}

console.log('✓ 훅 통합 테스트 통과')
```

## 테스트 격리 원칙

- 각 테스트 블록은 독립적으로 실행 가능해야 함
- 파일 시스템 변경은 임시 디렉토리(`os.tmpdir()`) 사용 후 정리
- 환경변수 변경은 테스트 전후로 복원
- 외부 네트워크 호출 없음 (훅은 offline 실행이 원칙)
