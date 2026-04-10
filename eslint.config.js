'use strict'

const js = require('@eslint/js')

module.exports = [
  js.configs.recommended,
  {
    // 전체 프로젝트 규칙
    rules: {
      'no-var': 'error',
      'prefer-const': 'error',
      'no-console': 'off',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'eqeqeq': ['error', 'always'],
      'curly': ['error', 'all']
    }
  },
  {
    // scripts/hooks — 200줄 초과 경고
    files: ['scripts/hooks/**/*.js'],
    rules: {
      'max-lines': ['warn', { max: 200, skipComments: true }]
    }
  },
  {
    // 테스트 파일
    files: ['tests/**/*.test.js'],
    rules: {
      'no-unused-expressions': 'off'
    }
  },
  {
    ignores: [
      'node_modules/**',
      '.claude/**',
      '.codex/**',
      '.agents/**',
      'coverage/**'
    ]
  }
]
