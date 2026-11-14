import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RuleBasedNlu } from '../src/gleo/nlu.ts';
import { josa, parseQty } from '../src/gleo/korean.ts';

const nlu = new RuleBasedNlu();
const none = { currentStoreId: null, visibleStoreIds: [] };
const inS01 = { currentStoreId: 's01', visibleStoreIds: ['s01', 's02', 's03'] };

test('호출: "글레오, 치킨 시켜줘" → 주문 시작(치킨)', () => {
  assert.deepEqual(nlu.parse('글레오, 치킨 시켜줘', none), { intent: 'START_FOOD_ORDER', category: '치킨' });
});

test('메뉴는 지금 매장 메뉴 안에서만 찾는다', () => {
  const p = nlu.parse('이번엔 청양마요로', inS01);
  assert.equal(p.intent, 'ADD_ITEM');
  assert.equal(p.itemId, 'm02');
  assert.equal(p.qty, 1);
  // 매장 맥락이 없으면 메뉴를 지어내지 않는다
  assert.notEqual(nlu.parse('이번엔 청양마요로', none).intent, 'ADD_ITEM');
});

test('수량·옵션·배달/포장을 함께 말해도 해석한다', () => {
  const p = nlu.parse('양념치킨 두 마리에 콜라 포장으로', inS01);
  assert.equal(p.intent, 'ADD_ITEM');
  assert.equal(p.itemId, 'm04');
  assert.equal(p.qty, 2);
  assert.deepEqual(p.optionIds, ['o1']);
  assert.equal(p.mode, 'PICKUP');
});

test('예/아니오, 배달/포장, 재주문, 상태, 취소', () => {
  assert.equal(nlu.parse('응', inS01).intent, 'CONFIRM');
  assert.equal(nlu.parse('이대로 주문해줘', inS01).intent, 'CONFIRM');
  assert.equal(nlu.parse('아니', inS01).intent, 'DENY');
  assert.deepEqual(nlu.parse('배달', inS01), { intent: 'CHOOSE_MODE', mode: 'DELIVERY' });
  assert.deepEqual(nlu.parse('가는 길에 포장할게', inS01), { intent: 'CHOOSE_MODE', mode: 'PICKUP' });
  assert.equal(nlu.parse('늘 먹던 걸로 시켜줘', none).intent, 'REORDER_FAVORITE');
  assert.equal(nlu.parse('치킨 언제 들어가?', none).intent, 'CHECK_ORDER_STATUS');
  assert.equal(nlu.parse('주문 취소해줘', none).intent, 'CANCEL');
});

test('옵션만 말하면 옵션 추가, 매장명·순서로 가게 선택', () => {
  assert.deepEqual(nlu.parse('콜라 추가해줘', inS01), { intent: 'ADD_OPTION', storeId: 's01', optionIds: ['o1'] });
  assert.equal(nlu.parse('길목치킨으로 할래', inS01).storeId, 's03');
  assert.equal(nlu.parse('두 번째 가게', inS01).index, 1);
  assert.equal(nlu.parse('가는 길에 있는 데로', inS01).storeRef, 'ON_THE_WAY');
});

test('한국어 도우미: 조사와 수량', () => {
  assert.equal(josa('고추마요', '로'), '고추마요로');
  assert.equal(josa('간장', '로'), '간장으로');
  assert.equal(josa('마늘', '로'), '마늘로');
  assert.equal(josa('콜라 1.25L', '을'), '콜라 1.25L를');
  assert.equal(parseQty('두 마리'), 2);
  assert.equal(parseQty('3개'), 3);
  assert.equal(parseQty('청양마요'), null);
});
