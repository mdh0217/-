# JavaScript 코딩 스타일

> 이 파일은 `.claude/rules/node.md`의 공통 규칙을 확장합니다.

## 파일 구성

- **모듈 시스템**: CommonJS (`require` / `module.exports`). `.mjs` 확장자 파일만 ESM 허용
- **파일 이름**: `scripts/`, `tests/` 는 camelCase — `scripts/lib/parseInput.js`
- **디렉토리 이름**: kebab-case — `skills/deep-research/`
- **최대 줄 수**: 일반 파일 400줄, 훅 스크립트 200줄 (초과 시 `scripts/lib/`에 헬퍼 분리)

## 변수 선언

```js
// 올바름
const MAX_RETRIES = 3
const result = compute()

// 금지
let mutable = 1   // const 가능한 경우 let 사용 금지
var legacy = 2    // var 절대 금지
```

## 함수

- 화살표 함수는 콜백, 단일 표현식에 사용
- 이름 있는 함수 선언은 모듈 최상위 로직에 사용
- 함수 길이 50줄 이하 유지 (초과 시 분리)

```js
// 단순 콜백 → 화살표
const doubled = items.map(x => x * 2)

// 로직이 있는 함수 → 선언식
function parseHookInput(raw) {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}
```

## 이름 규칙

| 대상 | 규칙 | 예시 |
|------|------|------|
| 변수·함수 | camelCase | `hookResult`, `parseInput` |
| 클래스 | PascalCase | `HookRunner`, `SkillLoader` |
| 상수 | SCREAMING_SNAKE_CASE | `MAX_RETRIES`, `DEFAULT_TIMEOUT` |
| 불리언 변수 | `is` / `has` / `can` 접두사 | `isAsync`, `hasError` |
| 파일 (scripts/) | camelCase | `runWithFlags.js` |
| 파일 (skills/, rules/) | kebab-case | `deep-research/` |

## 임포트 순서

1. Node.js 내장 모듈
2. 외부 패키지
3. 내부 모듈 (상대 경로)

```js
// 올바른 순서
const fs = require('fs')
const path = require('path')

const { execSync } = require('child_process')

const parseInput = require('./lib/parseInput')
const { log } = require('../lib/logger')
```

## 비동기

- `async/await` 우선 사용
- `Promise` 체이닝은 3단계 이하
- 훅 스크립트에서 `async` 사용 시 `settings.json`에 `"async": true` 명시

```js
// 올바름
async function fetchData(url) {
  const res = await fetch(url)
  return res.json()
}

// 금지 (콜백 지옥)
fetch(url, function(err, res) {
  res.json(function(err, data) { /* ... */ })
})
```

## 에러 처리

```js
// 모든 async 함수에 try-catch 필수
async function run(input) {
  try {
    const data = JSON.parse(input)
    return process(data)
  } catch (err) {
    console.error('[훅이름] 처리 실패:', err.message)
    return null  // 훅은 항상 exit 0
  }
}
```
