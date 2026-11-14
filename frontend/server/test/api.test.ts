import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { startServer } from '../src/index.ts';
import { kst } from '../src/time.ts';

const { server } = startServer(0, '127.0.0.1');
await new Promise<void>((r) => (server.listening ? r() : server.once('listening', () => r())));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => new Promise<void>((r) => server.close(() => r())));

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json()) as any };
}

test('GET /home: 최근 주문 · 집 근처 · 가는 길', async () => {
  const r = await call('GET', '/home?lat=37.4979&lng=127.0276&destLat=37.3655&destLng=127.112&category=치킨');
  assert.equal(r.status, 200);
  assert.equal(r.json.recent[0].storeId, 's01');
  assert.ok(r.json.nearHome.length <= 3 && r.json.onTheWay.length <= 3);
  assert.ok(r.json.onTheWay.every((c: any) => c.detourMin <= 5));
});

test('GET /stores/{id}/menu: 계약 형식', async () => {
  const r = await call('GET', '/stores/s01/menu');
  assert.equal(r.status, 200);
  assert.equal(r.json.storeId, 's01');
  const m02 = r.json.items.find((i: any) => i.id === 'm02');
  assert.deepEqual({ name: m02.name, price: m02.price, prepMin: m02.prepMin }, { name: '청양마요치킨', price: 21900, prepMin: 20 });
  assert.ok(m02.options.some((o: any) => o.name === '콜라 1.25L'));
  assert.equal((await call('GET', '/stores/nope/menu')).status, 404);
});

test('POST /orders → /eta(30초마다) → GET → cancel', async () => {
  const eta = kst(2026, 11, 14, 19, 40);
  const created = await call('POST', '/orders', {
    storeId: 's01',
    items: [{ itemId: 'm02', qty: 1, optionIds: [] }],
    mode: 'DELIVERY',
    eta: { destinationEta: eta },
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.status, 'SCHEDULED');
  assert.equal(created.json.total, 21900);
  assert.equal(created.json.display.dispatchAt, '19:13');

  const id = created.json.id;
  const moved = await call('POST', `/orders/${id}/eta`, { destinationEta: new Date(kst(2026, 11, 14, 19, 46)).toISOString() });
  assert.equal(moved.json.display.dispatchAt, '19:19');

  assert.equal((await call('GET', `/orders/${id}`)).json.display.pickupEta, '19:46');
  const cancelled = await call('POST', `/orders/${id}/cancel`);
  assert.equal(cancelled.json.status, 'CANCELLED');
});

test('잘못된 주문은 400, 메뉴에 없는 항목은 거절', async () => {
  const eta = { destinationEta: kst(2026, 11, 14, 19, 40) };
  const bad = await call('POST', '/orders', { storeId: 's01', items: [{ itemId: 'm99', qty: 1 }], mode: 'DELIVERY', eta });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error, 'UNKNOWN_ITEM');
  const noWp = await call('POST', '/orders', { storeId: 's01', items: [{ itemId: 'm01', qty: 1 }], mode: 'PICKUP', eta });
  assert.equal(noWp.status, 400);
  assert.equal((await call('POST', '/orders', { storeId: 's01' })).status, 400);
});

test('Gleo 발화 API와 정적 화면', async () => {
  const r = await call('POST', '/gleo/utterance', { text: '글레오, 치킨 시켜줘' });
  assert.equal(r.json.intent, 'START_FOOD_ORDER');
  assert.equal(r.json.ttsText, '지난번 고추마요로 할까요, 다른 메뉴를 고를까요?');
  for (const p of ['/', '/car/', '/pos/', '/demo/']) {
    const res = await fetch(base + p);
    assert.equal(res.status, 200, p);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
  }
  assert.equal((await fetch(base + '/car/..%2f..%2fpackage.json')).status, 404);
});
