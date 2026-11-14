import type { Mode } from './world.ts';
import { MIN } from './time.ts';

/**
 * 주문 전송 타이밍 — 이 앱의 심장 (설계서 4-1).
 *
 *   전송 시각 = 수령 지점 도착 예정 + 수령 여유 − 조리 시간 − 배달 시간(배달일 때만)
 *
 * - 수령 지점: 배달이면 집(최종 목적지), 포장이면 매장(경유지)
 * - 수령 여유: 배달 +3분(운전자가 먼저 집에 있어야 받음), 포장 −1분(도착하자마자 나와 있게)
 */
export const RECEIVE_MARGIN_MIN: Record<Mode, number> = {
  DELIVERY: 3,
  PICKUP: -1,
};

/** 내비 ETA를 다시 받아 전송 시각을 재계산하는 주기(가상 시간) */
export const ETA_REPORT_INTERVAL_MS = 30_000;

export interface DispatchInput {
  mode: Mode;
  /** 수령 지점 도착 예정 시각(epoch ms) */
  pickupEta: number;
  /** 조리 시간(분): 메뉴별 최대값 + 매장 혼잡 보정 */
  prepMin: number;
  /** 매장→집 배달 시간(분). 포장이면 무시 */
  deliveryMin: number;
}

export function computeDispatchAt(i: DispatchInput): number {
  const delivery = i.mode === 'DELIVERY' ? i.deliveryMin : 0;
  return i.pickupEta + (RECEIVE_MARGIN_MIN[i.mode] - i.prepMin - delivery) * MIN;
}

/** 지금 전송하면 음식이 수령 지점에 준비되는 시각 */
export function readyAtIfSentAt(sentAt: number, i: Pick<DispatchInput, 'mode' | 'prepMin' | 'deliveryMin'>): number {
  const delivery = i.mode === 'DELIVERY' ? i.deliveryMin : 0;
  return sentAt + (i.prepMin + delivery) * MIN;
}

/** 조리 시간 = 담은 메뉴 중 가장 긴 조리 시간 + 매장 혼잡 보정 */
export function prepMinFor(itemPrepMins: number[], congestionMin: number): number {
  return (itemPrepMins.length ? Math.max(...itemPrepMins) : 0) + congestionMin;
}
