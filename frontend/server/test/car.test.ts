import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VirtualCar } from '../src/car.ts';
import { MIN, SCENARIO_START, hhmm } from '../src/time.ts';
import { findStore } from '../src/world.ts';

function drive(car: VirtualCar, now: number, ms: number): number {
  for (let t = 0; t < ms; t += 1000) car.step(1000);
  return now + ms;
}

test('18:55 출발, 막힘 없으면 19:40 도착 예정', () => {
  const car = new VirtualCar();
  assert.equal(hhmm(car.etaDestination(SCENARIO_START)), '19:40');
});

test('평소 주행 중에는 ETA가 그대로 유지된다', () => {
  const car = new VirtualCar();
  const now = drive(car, SCENARIO_START, 10 * MIN);
  assert.equal(hhmm(car.etaDestination(now)), '19:40');
  assert.ok(car.uxRestricted, '주행 중에는 화면 제한이 켜진다');
});

test('정체 +6분 → ETA 19:46, 정체 구간을 지나는 동안에도 19:46 유지', () => {
  const car = new VirtualCar();
  let now = drive(car, SCENARIO_START, 5 * MIN);
  car.addDelay(6);
  assert.equal(hhmm(car.etaDestination(now)), '19:46');
  now = drive(car, now, 8 * MIN);
  assert.equal(hhmm(car.etaDestination(now)), '19:46');
  assert.equal(car.speedFactor, 0.5);
  now = drive(car, now, 6 * MIN); // 지연을 다 소진하면 정상 속도로
  assert.equal(car.speedFactor, 1);
  assert.equal(hhmm(car.etaDestination(now)), '19:46');
});

test('실시간 루프처럼 들쭉날쭉한 간격으로 진행해도 표시가 19:39로 흔들리지 않는다', () => {
  const car = new VirtualCar();
  let now = SCENARIO_START;
  for (let i = 0; i < 2000; i++) {
    const dt = 97.3 + (i % 7) * 3.1;
    car.step(dt);
    now += dt;
    assert.equal(hhmm(car.etaDestination(now)), '19:40');
  }
});

test('뚫리면 당긴다: 원활 −3분 → ETA 19:37', () => {
  const car = new VirtualCar();
  car.addDelay(-3);
  assert.equal(hhmm(car.etaDestination(SCENARIO_START)), '19:37');
  const now = drive(car, SCENARIO_START, 5 * MIN);
  assert.equal(hhmm(car.etaDestination(now)), '19:37');
});

test('정차하면 그만큼 ETA가 밀리고 화면 제한이 꺼진다', () => {
  const car = new VirtualCar();
  car.setState('STOPPED');
  assert.equal(car.uxRestricted, false);
  const now = drive(car, SCENARIO_START, 2 * MIN);
  assert.equal(hhmm(car.etaDestination(now)), '19:42');
});

test('포장 매장을 경유지로 넣으면 매장 ETA가 생기고 집 ETA는 우회만큼 늦어진다', () => {
  const car = new VirtualCar();
  const s = findStore('s03')!;
  car.setWaypoint(s.id, s.name, s.pos, 3);
  const wp = car.etaWaypoint(SCENARIO_START)!;
  assert.ok(wp < car.etaDestination(SCENARIO_START));
  assert.equal(hhmm(car.etaDestination(SCENARIO_START)), '19:44'); // 우회 3 + 수령 1
  // 경유지에 도착하면 체류 후 다시 출발
  let now = SCENARIO_START;
  while (!car.waypointDone) now = drive(car, now, 1000);
  assert.equal(car.etaWaypoint(now), null);
  assert.equal(car.uxRestricted, false, '매장에서 수령 중에는 정차 상태');
  assert.equal(hhmm(car.etaDestination(now)), '19:44');
});

test('주문 전송 지점: kmAfter는 실제로 그만큼 달린 위치와 같다 (정체 포함)', () => {
  const plain = new VirtualCar();
  const predicted = plain.kmAfter(10 * 60);
  drive(plain, SCENARIO_START, 10 * MIN);
  assert.ok(Math.abs(plain.progressKm - predicted) < 0.01);

  const jam = new VirtualCar();
  jam.addDelay(6);
  const jamPredicted = jam.kmAfter(10 * 60);
  assert.ok(jamPredicted < predicted, '정체가 있으면 같은 시간에 덜 간다');
  drive(jam, SCENARIO_START, 10 * MIN);
  assert.ok(Math.abs(jam.progressKm - jamPredicted) < 0.01);
});
