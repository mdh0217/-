# JavaScript 보안 규칙

> 공통 보안 규칙(`.claude/rules/node.md`)을 JavaScript 특화 내용으로 확장합니다.

## 시크릿 관리

### 절대 금지

```js
// 금지 — 하드코딩된 시크릿
const token = 'ghp_xxxxxxxxxxxx'
const apiKey = 'sk-xxxxxxxxxxxxxxxx'

// 금지 — 코드에 직접 삽입
execSync(`curl -H "Authorization: Bearer ghp_xxx" ${url}`)
```

### 올바른 방법

```js
// 환경변수 사용
const token = process.env.GITHUB_TOKEN
const apiKey = process.env.EXA_API_KEY

// 시작 시 검증
function requireEnv(name) {
  const val = process.env[name]
  if (!val) {
    throw new Error(`필수 환경변수 누락: ${name}`)
  }
  return val
}
```

## 입력 검증

### 외부 입력 처리

```js
// 훅 stdin 입력 — 반드시 검증
exports.run = async function(rawInput) {
  let input
  try {
    input = JSON.parse(rawInput)
  } catch {
    console.error('[hook] 잘못된 JSON 입력')
    return null  // exit 0 보장
  }

  // 타입 검증
  if (typeof input.tool_name !== 'string') { return null }
  if (!Array.isArray(input.tool_input?.content)) { return null }

  // 값 범위 검증
  const MAX_CONTENT_LENGTH = 10_000
  if (input.tool_input.content.length > MAX_CONTENT_LENGTH) {
    console.error('[hook] 입력이 너무 큼')
    return null
  }
}
```

### 파일 경로 검증 (path traversal 방지)

```js
const path = require('path')

function safePath(base, userInput) {
  const resolved = path.resolve(base, userInput)
  // base 디렉토리 밖으로 나가는 경로 차단
  if (!resolved.startsWith(path.resolve(base))) {
    throw new Error(`허용되지 않는 경로: ${userInput}`)
  }
  return resolved
}
```

## 명령어 실행 보안

### 커맨드 인젝션 방지

```js
const { execFileSync } = require('child_process')

// 금지 — 쉘 인젝션 취약
execSync(`git log ${userInput}`)

// 올바름 — 인수를 배열로 분리
execFileSync('git', ['log', '--oneline', userInput], { stdio: 'pipe' })
```

### 실행 경로 제한

```js
// 허용 목록 기반 검증
const ALLOWED_COMMANDS = new Set(['eslint', 'markdownlint', 'node'])

function runSafe(cmd, args) {
  if (!ALLOWED_COMMANDS.has(cmd)) {
    throw new Error(`허용되지 않는 명령어: ${cmd}`)
  }
  return execFileSync(cmd, args, { stdio: 'pipe' })
}
```

## 의존성 보안

- 커밋 전 `bun audit` 또는 `npm audit` 실행
- 의존성은 `devDependencies`에 명확히 분류
- 불필요한 의존성 추가 금지 (YAGNI)
- 패키지 버전 고정 (`"eslint": "^9.0.0"` 형태 유지)

## 로깅 보안

```js
// 금지 — 시크릿/민감 정보 로깅
console.log('토큰:', process.env.GITHUB_TOKEN)
console.log('입력:', JSON.stringify(sensitiveData))

// 올바름 — 존재 여부만 로깅
console.log('GITHUB_TOKEN:', process.env.GITHUB_TOKEN ? '설정됨' : '없음')
```
