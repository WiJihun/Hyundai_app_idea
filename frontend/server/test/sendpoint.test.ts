import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DriveOnApp } from '../src/app.ts';
import { hhmm } from '../src/time.ts';

/**
 * 주문 전송 지점(지도 핀): '전송 시각에 차가 있을 경로 위 위치'.
 *  - 예측 위치와 실제 전송 순간의 위치가 같아야 한다(같은 규칙으로 계산).
 *  - 정체가 차 앞에서 생기면 전송 '시각'만 늦어지고 '지점'은 그대로다
 *    (막힌 만큼 그 지점에 늦게 도착하므로). 매장이 붐비면 더 일찍 = 차에 더 가까운 곳에서 보낸다.
 */
async function orderChicken(app: DriveOnApp) {
  app.autoFastForward = false;
  for (const t of ['글레오, 치킨 시켜줘', '이번엔 청양마요로', '아니', '배달', '응']) await app.dialog.utter(t);
  const o = app.orders.list()[0];
  assert.equal(o.status, 'SCHEDULED');
  return o;
}

function run(app: DriveOnApp, simMs: number): void {
  app.advance(simMs / app.clock.speed);
}

test('전송 지점: 예측 위치 = 실제로 전송된 위치', async () => {
  const app = new DriveOnApp();
  const o = await orderChicken(app);
  const sp = app.sendPoint()!;
  assert.equal(sp.display, '19:13');
  assert.equal(sp.sent, false);
  assert.ok(sp.km > app.car.progressKm, '전송 지점은 차 앞쪽 경로 위');
  assert.ok(sp.km < app.car.route.totalKm, '집보다 앞');

  app.control('skipToSend');
  assert.equal(app.orders.get(o.id).status, 'SENT');
  const after = app.sendPoint()!;
  assert.equal(after.sent, true);
  assert.ok(Math.abs(after.km - sp.km) < 0.05, `예측 ${sp.km}km vs 실제 ${after.km}km`);
});

test('전송 지점: 차 앞 정체 → 시각만 19:13→19:19, 지점은 그대로', async () => {
  const app = new DriveOnApp();
  await orderChicken(app);
  run(app, 4 * 60_000);
  const before = app.sendPoint()!;
  app.control('jam');
  const after = app.sendPoint()!;
  assert.equal(before.display, '19:13');
  assert.equal(after.display, '19:19');
  assert.ok(Math.abs(after.km - before.km) < 0.05, `정체 전 ${before.km}km vs 후 ${after.km}km`);
});

test('전송 지점: 매장 혼잡(+10분) → 더 일찍, 차에 더 가까운 곳에서 보낸다', async () => {
  const app = new DriveOnApp();
  const o = await orderChicken(app);
  const before = app.sendPoint()!;
  app.orders.setCongestion(o.storeId, 10);
  const after = app.sendPoint()!;
  assert.equal(hhmm(app.orders.get(o.id).dispatchAt), after.display);
  assert.ok(after.at < before.at, '전송 시각이 앞당겨짐');
  assert.ok(after.km < before.km - 1, `지점이 차 쪽으로 이동: ${before.km}km → ${after.km}km`);
});

test('전송 지점: 주문이 없거나 취소되면 없음', async () => {
  const app = new DriveOnApp();
  assert.equal(app.sendPoint(), null);
  const o = await orderChicken(app);
  await app.orders.cancel(o.id);
  assert.equal(app.sendPoint(), null);
});
