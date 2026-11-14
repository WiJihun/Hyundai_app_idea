import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DriveOnApp, FAST_FORWARD_SPEED } from '../src/app.ts';
import { MIN, hhmm } from '../src/time.ts';

/** 가상 시간 simMs만큼 진행 (현재 배속으로 실제 시간 환산) */
function run(app: DriveOnApp, simMs: number): void {
  app.advance(simMs / app.clock.speed);
}

function collectSays(app: DriveOnApp): string[] {
  const says: string[] = [];
  app.events.on('gleo.say', (d: { text: string }) => says.push(d.text));
  return says;
}

test('메인 시나리오: 퇴근길 배달 주문 → 19:13 예약 → 정체로 19:19 → 매장 전송', async () => {
  const app = new DriveOnApp();
  const says = collectSays(app);

  let r = await app.dialog.utter('글레오, 치킨 시켜줘');
  assert.equal(r.ttsText, '지난번 고추마요로 할까요, 다른 메뉴를 고를까요?');
  const home = app.dialog.view().home;
  assert.equal(home.recent[0].items[0].name, '고추마요치킨');
  assert.deepEqual(home.nearHome.map((c) => c.storeId), ['s01', 's02']);
  assert.equal(home.onTheWay[0].storeId, 's03');
  assert.equal(home.onTheWay[0].detourMin, 3);

  r = await app.dialog.utter('이번엔 청양마요로');
  assert.equal(r.ttsText, '청양마요치킨 한 마리, 21,900원이에요. 음료 추가할까요?');
  assert.equal(r.intent, 'ADD_ITEM');
  assert.equal(r.itemId, 'm02');
  assert.equal(r.needsConfirm, true);

  r = await app.dialog.utter('아니');
  assert.equal(r.ttsText, '집으로 배달할까요, 가는 길에 포장할까요?');

  r = await app.dialog.utter('배달');
  assert.equal(r.ttsText, '청양마요치킨 한 마리, 배달로 21,900원 결제할까요?');
  // 결제 전 미리보기: 배달 19:13
  assert.equal(app.dialog.view().preview?.DELIVERY.display, '19:13');

  r = await app.dialog.utter('응');
  assert.equal(r.ttsText, '결제했어요. 19:13에 매장으로 주문을 넣을게요.');
  const order = app.orders.list()[0];
  assert.equal(order.status, 'SCHEDULED');
  assert.equal(order.total, 21900);
  assert.equal(app.clock.speed, FAST_FORWARD_SPEED, '결제 후 자동 빨리감기');

  // 10분 주행 후 정체 발생 → 도착 19:46, 전송 19:19
  run(app, 10 * MIN);
  assert.equal(order.status, 'SCHEDULED');
  app.control('jam', 6);
  assert.equal(hhmm(order.pickupEta), '19:46');
  assert.equal(hhmm(order.dispatchAt), '19:19');
  // 원인과 결과를 한 문장으로 한 번만 말한다
  const shiftSay = '정체로 도착이 6분 늦어져 전송도 19:13에서 19:19로 미뤘어요.';
  assert.deepEqual(says.filter((t) => t.includes('미뤘어요')), [shiftSay]);
  assert.equal(app.dialog.view().notice?.text, shiftSay);
  run(app, 3 * MIN);
  assert.equal(says.filter((t) => t.includes('미뤘어요')).length, 1, '정체 중 ETA가 그대로면 다시 말하지 않는다');

  // 19:19 직전까지는 대기, 지나면 전송
  run(app, order.dispatchAt - app.clock.now - 2000);
  assert.equal(order.status, 'SCHEDULED');
  run(app, 5000);
  assert.equal(order.status, 'SENT');
  assert.equal(hhmm(order.sentAt!), '19:19');
  assert.ok(says.includes('방금 주문을 넣었어요. 집에 도착하실 즈음 도착해요.'));
  assert.equal(app.clock.speed, 1, '전송되면 1배속으로 복귀');

  r = await app.dialog.utter('치킨 언제 들어가?');
  assert.equal(r.ttsText, '19:19에 매장으로 주문을 넣었어요.');
});

test('포장: 경유지 추가, 같은 매장이면 배달보다 늦게 전송', async () => {
  const app = new DriveOnApp();
  await app.dialog.utter('치킨 시켜줘');
  await app.dialog.utter('응'); // 지난번 고추마요
  await app.dialog.utter('콜라 추가');
  const preview = app.dialog.view().preview!;
  assert.ok(preview.PICKUP!.dispatchAt > preview.DELIVERY.dispatchAt, '포장은 매장 도착 기준이라 더 늦게 전송');

  const r = await app.dialog.utter('포장');
  assert.match(r.ttsText, /^바삭마요치킨 정자점을 경유지로 추가했어요\. 고추마요치킨 한 마리에 콜라 1\.25L, 포장으로 22,400원 결제할까요\?$/);
  assert.equal(app.car.waypoint?.storeId, 's01');
  await app.dialog.utter('응');
  const o = app.orders.list()[0];
  assert.equal(o.mode, 'PICKUP');
  assert.equal(o.status, 'SCHEDULED');
  assert.equal(o.pickupEta, app.car.etaWaypoint(app.clock.now));
});

test('가는 길 가게를 골라 포장', async () => {
  const app = new DriveOnApp();
  await app.dialog.utter('치킨 시켜줘');
  let r = await app.dialog.utter('가는 길에 있는 데로');
  assert.match(r.ttsText, /^길목치킨 판교점요\. 가는 길에 3분 돌아가요\./);
  r = await app.dialog.utter('숯불바베큐 하나 포장으로');
  assert.match(r.ttsText, /경유지로 추가했어요\. 숯불바베큐치킨 한 마리, 포장으로 20,500원 결제할까요\?$/);
  await app.dialog.utter('응');
  assert.equal(app.orders.list()[0].storeId, 's03');
});

test('포장은 들러야 끝: 차량번호는 포장에만, 매장 직전 한 번 안내, 도착하면 POS에 표시', async () => {
  const app = new DriveOnApp();
  const says = collectSays(app);
  const posKinds: string[] = [];
  app.events.on('pos.order', (d: { kind: string }) => posKinds.push(d.kind));
  await app.dialog.utter('치킨 시켜줘');
  await app.dialog.utter('가는 길에 있는 데로');
  await app.dialog.utter('숯불바베큐 하나 포장으로');
  await app.dialog.utter('응');
  const o = app.orders.list()[0];
  assert.equal(o.mode, 'PICKUP');
  assert.deepEqual(o.vehicle, { plate: '12가 3456' });

  while (!app.car.waypointDone) run(app, 10_000);
  const approach = says.filter((t) => t.startsWith('곧 길목치킨 판교점에 들러요.'));
  assert.equal(approach.length, 1, says.join(' / '));
  assert.ok(says.indexOf(approach[0]) < says.indexOf('주문한 매장에 도착했어요. 음식을 받아 가세요.'));
  assert.ok(o.customerArrivedAt);
  assert.ok(posKinds.includes('arrived'));
  run(app, 5 * MIN);
  assert.equal(says.filter((t) => t.startsWith('곧 ')).length, 1, '안내는 한 번만');
});

test('배달 주문에는 차량번호를 넘기지 않는다(API로 보내도 무시)', async () => {
  const app = new DriveOnApp();
  const o = await app.orders.create({
    storeId: 's01',
    items: [{ itemId: 'm01', qty: 1, optionIds: [] }],
    mode: 'DELIVERY',
    eta: { destinationEta: app.car.etaDestination(app.clock.now) },
    vehicle: { plate: '12가 3456' },
  });
  assert.equal(o.vehicle, null);
});

test('배달팁은 배달일 때만 더하고, 결제 전 금액에 함께 읽는다', async () => {
  const app = new DriveOnApp();
  await app.dialog.utter('치킨 시켜줘');
  await app.dialog.utter('두 번째 가게'); // 꼬꼬닭: 배달팁 2,000원
  let r = await app.dialog.utter('간장치킨 배달로');
  assert.equal(r.ttsText, '간장치킨 한 마리, 배달팁 2,000원 포함 배달로 21,000원 결제할까요?');
  r = await app.dialog.utter('포장으로 바꿔줘');
  assert.match(r.ttsText, /포장으로 19,000원 결제할까요\?$/);
  r = await app.dialog.act({ type: 'CHOOSE_MODE', mode: 'DELIVERY' });
  await app.dialog.act({ type: 'SELECT_CARD', cardId: 'hc2' });
  await app.dialog.act({ type: 'CONFIRM' });
  const o = app.orders.list()[0];
  assert.deepEqual([o.itemsTotal, o.deliveryTip, o.total], [19000, 2000, 21000]);
  assert.deepEqual(o.payment.card, { issuer: '현대카드', name: '현대카드 가족', last4: '5678' });
});

test('배달 최소주문금액에 못 미치면 더 담거나 포장으로 바꾸라고 한다', async () => {
  const app = new DriveOnApp();
  await app.dialog.utter('분식 시켜줘');
  await app.dialog.utter('분식왕');
  const r = await app.dialog.utter('떡볶이 배달로');
  assert.equal(r.ttsText, '배달 최소주문금액은 10,000원이에요. 5,000원 더 담거나 포장으로 바꿔 주세요.');
  await app.dialog.act({ type: 'SET_QTY', index: 0, qty: 2 });
  assert.equal((await app.dialog.act({ type: 'CONFIRM' })).ttsText, '음료 추가할까요?');
  const r2 = await app.dialog.utter('아니');
  assert.match(r2.ttsText, /배달팁 1,500원 포함 배달로 11,500원 결제할까요\?$/);
});

test('매장 POS: 전송된 주문만 접수 → 조리 완료, 접수하면 운전자에게 알린다', async () => {
  const app = new DriveOnApp();
  const says = collectSays(app);
  await app.dialog.utter('늘 먹던 걸로');
  await app.dialog.utter('응');
  const o = app.orders.list()[0];
  assert.equal(o.storeStatus, null);
  assert.throws(() => app.orders.storeAction(o.id, 'accept'), /아직 매장에 전송되지 않은/);
  run(app, o.dispatchAt - app.clock.now + 1000);
  assert.equal(o.storeStatus, 'NEW');
  assert.throws(() => app.orders.storeAction(o.id, 'complete'), /접수한 주문만/);
  app.orders.storeAction(o.id, 'accept');
  assert.equal(o.storeStatus, 'ACCEPTED');
  assert.ok(says.includes('바삭마요치킨 정자점에서 주문을 접수했어요. 조리를 시작해요.'));
  app.orders.storeAction(o.id, 'complete');
  assert.equal(o.storeStatus, 'DONE');
});

test('둘러보기용 시간 건너뛰기: 분 단위, 전송 시각까지, 포장 매장 직전·도착까지', async () => {
  const app = new DriveOnApp();
  app.control('autoFastForward', false);
  app.control('skip', 5);
  assert.equal(hhmm(app.clock.now), '19:00');
  await app.dialog.utter('치킨 시켜줘');
  await app.dialog.utter('가는 길에 있는 데로');
  await app.dialog.utter('숯불바베큐 하나 포장으로');
  await app.dialog.utter('응');
  const o = app.orders.list()[0];
  app.control('skipToSend');
  assert.equal(o.status, 'SENT');
  app.control('skipToApproach');
  assert.ok(!app.car.waypointDone && app.car.waypoint!.routeKm - app.car.progressKm <= 0.5);
  app.control('skipToStore');
  assert.ok(app.car.waypointDone && o.customerArrivedAt);
  assert.equal(app.clock.speed, 1);
});

test('한마디 재주문: "늘 먹던 걸로" → 바로 결제 확인', async () => {
  const app = new DriveOnApp();
  const r = await app.dialog.utter('늘 먹던 걸로 시켜줘');
  assert.equal(r.ttsText, '지난번처럼 바삭마요치킨 정자점 고추마요치킨 한 마리, 배달로 19,900원 결제할까요?');
  await app.dialog.utter('응');
  assert.equal(app.orders.list()[0].total, 19900);
});

test('이미 늦은 주문은 즉시 전송하고 솔직하게 안내', async () => {
  const app = new DriveOnApp();
  run(app, 40 * MIN); // 19:35, 도착 5분 전
  await app.dialog.utter('늘 먹던 걸로');
  const r = await app.dialog.utter('응');
  assert.match(r.ttsText, /^결제했어요\. 지금 바로 주문을 넣을게요\. 도착 후 약 \d+분 뒤 받으실 수 있어요\.$/);
  assert.equal(app.orders.list()[0].status, 'SENT');
  assert.equal(app.clock.speed, 1, '즉시 전송이면 빨리감기하지 않음');
});

test('취소: 전송 전 무료 취소, 전송 후에는 매장 정책', async () => {
  const app = new DriveOnApp();
  await app.dialog.utter('늘 먹던 걸로');
  await app.dialog.utter('응');
  let r = await app.dialog.utter('주문 취소해줘');
  assert.equal(r.ttsText, '주문을 취소했어요. 결제도 함께 취소돼요.');
  assert.equal(app.orders.list()[0].status, 'CANCELLED');

  await app.dialog.utter('늘 먹던 걸로');
  await app.dialog.utter('응');
  const o = app.orders.list()[0];
  run(app, o.dispatchAt - app.clock.now + 1000);
  assert.equal(o.status, 'SENT');
  r = await app.dialog.utter('취소');
  assert.equal(r.ttsText, '이미 매장에 주문이 들어갔어요. 취소는 매장 정책에 따라야 해요.');
});

test('결제 실패 시 안내하고 다시 시도할 수 있다', async () => {
  const app = new DriveOnApp();
  app.control('failNextPayment', true);
  await app.dialog.utter('늘 먹던 걸로');
  let r = await app.dialog.utter('응');
  assert.equal(r.ttsText, '결제가 승인되지 않았어요. 다시 시도할까요?');
  assert.equal(app.orders.list().length, 0);
  r = await app.dialog.utter('응');
  assert.match(r.ttsText, /^결제했어요\./);
});

test('주행 중에는 메뉴판이 안 열리고, 정차 중 연 메뉴판은 출발하면 줄어든다', async () => {
  const app = new DriveOnApp();
  const says = collectSays(app);
  await app.dialog.utter('치킨 시켜줘');
  let r = await app.dialog.utter('메뉴판 보여줘');
  assert.equal(r.ttsText, '메뉴판은 정차 중에 볼 수 있어요. 말로 주문해 주세요.');
  app.control('stop');
  r = await app.dialog.utter('메뉴판 보여줘');
  assert.equal(app.dialog.view().menuOpen, true);
  app.control('drive');
  assert.equal(app.dialog.view().menuOpen, false);
  assert.ok(says.includes('출발해서 메뉴판을 줄였어요. 이어서 말씀하세요.'));
});

test('매장 혼잡 보정(POS)이 생기면 전송 시각이 앞당겨지고 이유를 말한다', async () => {
  const app = new DriveOnApp();
  const says = collectSays(app);
  await app.dialog.utter('늘 먹던 걸로');
  await app.dialog.utter('응');
  const o = app.orders.list()[0];
  assert.equal(hhmm(o.dispatchAt), '19:13');
  app.orders.setCongestion('s01', 10);
  assert.equal(hhmm(o.dispatchAt), '19:03');
  assert.ok(says.includes('매장이 붐벼 조리가 10분 더 걸려서 전송을 19:13에서 19:03으로 당겼어요.'));
});

test('2분 미만 변화는 조용히 숫자만 바꾸고, 원활해지면 당긴다고 말한다', async () => {
  const app = new DriveOnApp();
  const says = collectSays(app);
  await app.dialog.utter('늘 먹던 걸로');
  await app.dialog.utter('응');
  const o = app.orders.list()[0];
  app.control('stop');
  run(app, 90_000); // 정차 1분 30초 → ETA·전송 1.5분 밀림
  app.control('drive');
  assert.ok(o.dispatchAt > app.orders.get(o.id).etaHistory[0].dispatchAt);
  assert.equal(says.filter((t) => t.includes('전송')).length, 0);
  app.control('fast', 3); // 마지막 안내(19:13) 대비 −1.5분 → 아직 조용히
  assert.equal(says.filter((t) => t.includes('전송')).length, 0);
  app.control('fast', 3); // 누적 −4.5분 → 말한다
  assert.ok(says.some((t) => /^길이 뚫려 도착이 \d분 빨라져 전송도 19:13에서 19:0\d로 당겼어요\.$/.test(t)), says.join(' / ') || '(안내 없음)');
});
