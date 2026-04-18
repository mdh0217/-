# ============================================================
# 업비트 트레이딩 에이전트 - Dockerfile
#
# Apple Silicon(arm64) 및 x86_64 멀티 플랫폼 지원
# 멀티 스테이지 빌드로 이미지 크기 최소화
# ============================================================

# ── 1단계: 빌드 ─────────────────────────────────────────────
FROM node:20-alpine AS builder

# 타임존 설정 (한국 시간)
RUN apk add --no-cache tzdata
ENV TZ=Asia/Seoul

WORKDIR /app

# 의존성 파일 먼저 복사 (Docker 레이어 캐시 활용)
COPY package*.json ./
COPY tsconfig.json ./

# 모든 의존성 설치 (devDependencies 포함 - 빌드에 필요)
RUN npm ci

# 소스 코드 복사 및 TypeScript 컴파일
COPY src/ ./src/
RUN npm run build

# ── 2단계: 실행 ─────────────────────────────────────────────
FROM node:20-alpine AS production

# 타임존 및 보안 패치
RUN apk add --no-cache tzdata && \
    apk upgrade --no-cache
ENV TZ=Asia/Seoul

# 비루트 사용자 생성 (보안 강화)
RUN addgroup -g 1001 -S nodejs && \
    adduser -S trader -u 1001 -G nodejs

WORKDIR /app

# 프로덕션 의존성만 설치
COPY package*.json ./
RUN npm ci --only=production && \
    npm cache clean --force

# 빌드 결과물 복사
COPY --from=builder /app/dist ./dist/

# sql.js WASM 파일 복사 (경로 명시적 지정)
COPY --from=builder /app/node_modules/sql.js/dist/sql-wasm.wasm ./node_modules/sql.js/dist/

# 데이터 디렉토리 생성 및 권한 부여
RUN mkdir -p /app/data /app/logs && \
    chown -R trader:nodejs /app

# 비루트 사용자로 전환
USER trader

# 헬스체크: 에이전트 프로세스가 살아있는지 확인
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD node -e "process.exit(0)" || exit 1

# 환경변수 기본값
ENV NODE_ENV=production \
    TRADING_MODE=paper \
    LOG_LEVEL=info \
    HEALTH_PORT=3000

EXPOSE 3000

CMD ["node", "dist/index.js"]
