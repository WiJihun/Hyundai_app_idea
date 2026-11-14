import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDispatchAt, prepMinFor, readyAtIfSentAt } from '../src/dispatch.ts';
import { hhmm, kst } from '../src/time.ts';

const at = (h: number, m: number) => kst(2026, 11, 14, h, m);

test('기획서 시나리오: 도착 19:40 + 여유 3 − 조리 20 − 배달 10 = 19:13 전송', () => {
  const t = computeDispatchAt({ mode: 'DELIVERY', pickupEta: at(19, 40), prepMin: 20, deliveryMin: 10 });
  assert.equal(hhmm(t), '19:13');
});

test('정체로 도착이 19:46으로 늦어지면 전송도 19:19로 밀린다', () => {
  const t = computeDispatchAt({ mode: 'DELIVERY', pickupEta: at(19, 46), prepMin: 20, deliveryMin: 10 });
  assert.equal(hhmm(t), '19:19');
});

test('포장은 배달 시간을 빼지 않고 매장 도착 기준(여유 −1분)으로 계산한다', () => {
  const t = computeDispatchAt({ mode: 'PICKUP', pickupEta: at(19, 30), prepMin: 20, deliveryMin: 10 });
  assert.equal(hhmm(t), '19:09');
});

test('조리 시간은 담은 메뉴 중 최대값 + 혼잡 보정', () => {
  assert.equal(prepMinFor([18, 20, 8], 0), 20);
  assert.equal(prepMinFor([18, 20], 5), 25);
});

test('전송 시각에 보내면 수령 지점 도착 + 여유에 맞춰 준비된다', () => {
  const input = { mode: 'DELIVERY' as const, pickupEta: at(19, 40), prepMin: 20, deliveryMin: 10 };
  const ready = readyAtIfSentAt(computeDispatchAt(input), input);
  assert.equal(hhmm(ready), '19:43');
});
