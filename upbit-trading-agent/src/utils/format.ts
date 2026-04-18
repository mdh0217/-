/**
 * 공통 포맷 헬퍼
 *
 * 기존 각 파일에 중복 정의되어 있던 포맷 함수를 한곳에서 관리합니다.
 * 모든 함수의 출력 형식은 기존과 완전히 동일합니다.
 */

/** 가격·금액을 원(KRW)으로 포맷 — 소수 이하 반올림 (거래 금액, PnL 등) */
export const krw = (n: number): string =>
  Math.round(n).toLocaleString('ko-KR') + '원';

/**
 * 가격을 원(KRW)으로 포맷 — 소수 그대로 표시
 * 평단가·손절가처럼 원본 정밀도를 유지해야 할 때 사용합니다.
 */
export const fmt = (n: number): string =>
  n.toLocaleString('ko-KR') + '원';

/** 등락률 포맷 — +/- 부호 포함, 소수점 두 자리 */
export const pct = (n: number): string =>
  (n >= 0 ? '+' : '') + (n * 100).toFixed(2) + '%';

/** 거래량을 백만 단위로 포맷 */
export const fmtM = (n: number): string =>
  (n / 1_000_000).toFixed(1) + 'M';
