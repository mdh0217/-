# JavaScript 패턴

## 모듈 패턴 (CommonJS)

### 단일 책임 모듈

```js
// scripts/lib/parseInput.js
'use strict'

/**
 * stdin 문자열을 JSON으로 파싱합니다.
 * 파싱 실패 시 null 반환 (throw 금지 — 훅 흐름 차단 방지)
 */
function parseInput(raw) {
  if (!raw || typeof raw !== 'string') { return null }
  try {
    return JSON.parse(raw.trim())
  } catch {
    return null
  }
}

module.exports = { parseInput }
```

### 팩토리 함수 패턴

새 인스턴스가 필요한 경우 클래스보다 팩토리 함수를 선호합니다.

```js
// scripts/lib/createLogger.js
'use strict'

function createLogger(prefix) {
  return {
    info:  msg => console.log(`[${prefix}] ${msg}`),
    warn:  msg => console.warn(`[${prefix}] ⚠ ${msg}`),
    error: msg => console.error(`[${prefix}] ✗ ${msg}`)
  }
}

module.exports = { createLogger }
```

## 에러 처리 패턴

### 결과 객체 패턴 (throw 대신)

내부 함수에서는 예외를 던지는 대신 결과 객체를 반환해 흐름을 명시적으로 유지합니다.

```js
// { ok: true, value } 또는 { ok: false, error }
function readConfig(filePath) {
  try {
    const content = require('fs').readFileSync(filePath, 'utf8')
    return { ok: true, value: JSON.parse(content) }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

// 호출부
const result = readConfig('.env.json')
if (!result.ok) {
  console.error('설정 로드 실패:', result.error)
  process.exit(0)  // 훅은 exit 0
}
```

## 비동기 패턴

### 병렬 실행

```js
// 순차 (느림)
const a = await fetchA()
const b = await fetchB()

// 병렬 (권장)
const [a, b] = await Promise.all([fetchA(), fetchB()])
```

### 타임아웃 래퍼

```js
function withTimeout(promise, ms, label = '작업') {
  const timer = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`${label} 타임아웃 (${ms}ms)`)), ms)
  )
  return Promise.race([promise, timer])
}
```

## 훅 스크립트 패턴

### 표준 훅 구조

```js
'use strict'

// 1. 의존성
const fs = require('fs')
const path = require('path')

// 2. 상수
const HOOK_NAME = 'my-hook'
const MAX_SIZE = 200

// 3. 헬퍼 (50줄 이하)
function validate(input) {
  return input && typeof input.tool_name === 'string'
}

// 4. 메인 진입점 (run-with-flags.js 가 호출)
exports.run = async function run(rawInput) {
  const input = JSON.parse(rawInput || '{}')
  if (!validate(input)) { return null }

  // 로직
  return null
}
```

## 불변성 패턴

```js
// 객체 업데이트 — 원본 변경 금지
const updated = { ...original, field: newValue }

// 배열 추가 — 원본 변경 금지
const appended = [...items, newItem]

// 배열 필터 — 원본 변경 금지
const filtered = items.filter(x => x.active)
```
