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

test('전송 지점: 전송된 순간 위치에 고정 · 시나리오를 처음으로 돌려 다시 주문해도 이번 위치', async () => {
  const app = new DriveOnApp();
  const first = await orderChicken(app);
  const predicted1 = app.state().dispatchPoint!.routeKm;
  app.control('skipToSend');
  app.control('skip', 5); // 화면이 늦게 읽어도(전송 5분 뒤) 깃발은 전송된 자리
  const km1 = app.state().dispatchPoint!.routeKm;
  assert.ok(Math.abs(km1 - predicted1) < 0.05, `예측 ${predicted1}km vs 깃발 ${km1}km`);
  assert.ok(app.car.progressKm - km1 > 0.5, '차는 이미 한참 앞');

  app.control('reset');
  const second = await orderChicken(app);
  assert.equal(second.id, first.id, '주문 번호가 다시 ord-0001부터 시작한다');
  const predicted2 = app.state().dispatchPoint!.routeKm;
  app.control('skipToSend');
  const dp = app.state().dispatchPoint!;
  assert.equal(dp.sent, true);
  assert.ok(Math.abs(dp.routeKm - predicted2) < 0.05, `예측 ${predicted2}km vs 깃발 ${dp.routeKm}km`);
});

test('전송까지 건너뛰기: 자동 빨리감기 중이면 전송 뒤 1배속으로 돌아온다', async () => {
  const app = new DriveOnApp();
  for (const t of ['글레오, 치킨 시켜줘', '이번엔 청양마요로', '아니', '배달', '응']) await app.dialog.utter(t);
  assert.ok(app.clock.speed > 1, '결제 뒤 자동 빨리감기');
  app.control('skipToSend');
  assert.equal(app.orders.list()[0].status, 'SENT');
  assert.equal(app.clock.speed, 1);
});

test('실제 내비 값(/car/nav): 도착 예정이 내비 남은 시간을 따르고 빨리감기는 꺼진다', async () => {
  const app = new DriveOnApp();
  app.setNav({ remainSec: 18 * 60, remainKm: 6.7, name: '집(정자동)' });
  const s = app.state();
  assert.equal(s.car.source, 'pleos');
  assert.equal(s.car.remainingKm, 6.7);
  assert.equal(hhmm(s.car.etaDestination), hhmm(app.clock.now + 18 * 60_000));
  for (const t of ['글레오, 치킨 시켜줘', '이번엔 청양마요로', '아니', '배달', '응']) await app.dialog.utter(t);
  const o = app.orders.list()[0];
  assert.equal(app.clock.speed, 1, '실제 시간으로 흐름');
  // 집까지 18분 < 조리 20분 + 배달 10분 → 이미 늦어서 바로 보냄
  assert.equal(o.status, 'SENT');
  app.setNav(null);
  assert.equal(app.state().car.source, 'sim');
});

test('실제 차량 상태(/car/vehicle): 주행 중 화면 제한 · 차속이 실제 값을 따른다', async () => {
  const app = new DriveOnApp();
  app.control('stop');
  assert.equal(app.state().car.uxRestricted, false);
  app.setVehicle({ speedKmh: 42, restricted: true, gear: 'DRIVE' });
  const c = app.state().car;
  assert.equal(c.uxRestricted, true);
  assert.equal(c.speedKmh, 42);
  assert.equal(c.gear, 'DRIVE');
  app.setVehicle({ speedKmh: 0, restricted: false, gear: 'PARK' });
  assert.equal(app.state().car.uxRestricted, false);
});

test('실제 내비 경유지: 포장 매장까지 남은 시간 · 도착 이벤트로 POS에 고객 도착', async () => {
  const app = new DriveOnApp();
  app.autoFastForward = false;
  for (const t of ['글레오, 치킨 시켜줘', '가는 길에 있는 데로', '숯불바베큐로', '아니', '포장', '응']) await app.dialog.utter(t);
  const o = app.orders.list()[0];
  assert.equal(o?.mode, 'PICKUP');
  assert.ok(app.state().car.waypoint, '경유지 추가됨');
  app.setNav({ remainSec: 1500, remainKm: 12, waypointSec: 600, waypointKm: 5, name: '집(정자동)' });
  assert.equal(hhmm(app.state().car.etaWaypoint!), hhmm(app.clock.now + 600_000));
  app.navEvent('waypointArrived');
  assert.ok(app.orders.get(o.id).customerArrivedAt, 'POS에 고객 도착');
});
