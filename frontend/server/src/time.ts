export const SEC = 1_000;
export const MIN = 60_000;

const hhmmFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Seoul',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** 한국 시각 "19:13" */
export function hhmm(ts: number): string {
  return hhmmFmt.format(ts);
}

/** 한국 시각(KST)으로 만든 epoch ms. month는 1~12. */
export function kst(year: number, month: number, day: number, hour: number, minute: number): number {
  return Date.UTC(year, month - 1, day, hour - 9, minute);
}

/** 시연 시작 시각: 2026-11-14(토) 18:55 출발 */
export const SCENARIO_START = kst(2026, 11, 14, 18, 55);

/** 분 단위 반올림 차이 */
export function diffMin(a: number, b: number): number {
  return Math.round((a - b) / MIN);
}
