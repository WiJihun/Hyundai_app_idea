import { STORES, findStore, type Category, type Mode, type Store } from '../world.ts';
import { norm, parseQty } from './korean.ts';

/**
 * Gleo 발화 해석기 (설계서 4-3, 계약 'Gleo 해석 결과 P4 → P3').
 *
 * 실제 차량에서는 Gleo AI SDK(STT·LLM)가 이 역할을 하고, LLM에는 해당 매장 메뉴 JSON만
 * 근거로 넘겨 메뉴에 없는 항목을 만들지 않는다. 여기서는 오프라인 시연이 되도록 같은 원칙
 * (매장 메뉴 안에서만 찾기)을 지키는 규칙 기반 해석기로 구현한다. Nlu 인터페이스만 맞추면
 * LLM 기반 구현으로 바꿔 끼울 수 있다.
 */
export type IntentName =
  | 'START_FOOD_ORDER'
  | 'REORDER_FAVORITE'
  | 'CHECK_ORDER_STATUS'
  | 'CANCEL'
  | 'SELECT_STORE'
  | 'OPEN_MENU'
  | 'CLOSE_MENU'
  | 'ADD_ITEM'
  | 'ADD_OPTION'
  | 'REMOVE_ITEM'
  | 'CHOOSE_MODE'
  | 'CONFIRM'
  | 'DENY'
  | 'UNKNOWN';

export interface Parsed {
  intent: IntentName;
  category?: Category;
  storeId?: string;
  /** 화면 묶음 지칭: "가는 길에 있는 데", "집 근처" */
  storeRef?: 'NEAR_HOME' | 'ON_THE_WAY';
  /** "두 번째 가게" → 1 (0부터) */
  index?: number;
  itemId?: string;
  qty?: number;
  optionIds?: string[];
  mode?: Mode;
}

export interface NluContext {
  /** 지금 고른 매장 */
  currentStoreId: string | null;
  /** 화면에 떠 있는 매장들(표시 순서) */
  visibleStoreIds: string[];
}

export interface Nlu {
  parse(text: string, ctx: NluContext): Parsed;
}

const WAKE = /^(헤이)?(글레오|gleo|클레오|글레호)(야|아)?/;

const has = (t: string, ...keys: string[]) => keys.some((k) => t.includes(k));

const CATEGORY_WORDS: [string, Category][] = [
  ['치킨', '치킨'], ['통닭', '치킨'], ['닭', '치킨'],
  ['피자', '피자'],
  ['햄버거', '버거'], ['버거', '버거'],
  ['분식', '분식'], ['떡볶이', '분식'], ['김밥', '분식'], ['순대', '분식'],
  ['커피', '카페'], ['카페', '카페'], ['아메리카노', '카페'], ['라떼', '카페'],
];

const CATEGORY_SUFFIX = /(치킨|피자|버거)$/;

function itemKeys(name: string, aliases: string[] = []): string[] {
  const n = norm(name);
  const keys = [n, ...aliases.map(norm)];
  const stripped = n.replace(CATEGORY_SUFFIX, '');
  if (stripped.length >= 2 && stripped !== n) keys.push(stripped);
  return keys.filter((k) => k.length >= 2);
}

function optionKeys(name: string): string[] {
  const n = norm(name);
  const base = n.replace(/\d+(\.\d+)?(l|ml)$/i, '');
  return [...new Set([n, base])].filter((k) => k.length >= 2);
}

/** text 안에서 가장 긴 키로 매칭되는 메뉴 */
function matchItem(t: string, store: Store): { itemId: string; len: number } | null {
  let best: { itemId: string; len: number } | null = null;
  for (const it of store.items) {
    for (const k of itemKeys(it.name, it.aliases)) {
      if (t.includes(k) && (!best || k.length > best.len)) best = { itemId: it.id, len: k.length };
    }
  }
  return best;
}

function matchOptions(t: string, store: Store): string[] {
  const ids: string[] = [];
  for (const o of store.options) if (optionKeys(o.name).some((k) => t.includes(k))) ids.push(o.id);
  return ids;
}

function storeKeys(s: Store): string[] {
  const n = norm(s.name);
  const first = norm(s.name.split(' ')[0]);
  return [n, first].filter((k) => k.length >= 2);
}

function matchStore(t: string, candidates: Store[]): Store | null {
  let best: { s: Store; len: number } | null = null;
  for (const s of candidates) {
    for (const k of storeKeys(s)) if (t.includes(k) && (!best || k.length > best.len)) best = { s, len: k.length };
  }
  return best?.s ?? null;
}

const ORDINALS: [RegExp, number][] = [
  [/(첫\s*번째|첫째|1번)/, 0],
  [/(두\s*번째|둘째|2번)/, 1],
  [/(세\s*번째|셋째|3번)/, 2],
];

const YES = ['응', '어', '네', '예', '그래', '좋아', '맞아', '오케이', 'ok', '콜', 'ㅇㅇ', '그걸로', '그렇게해', '해줘', '부탁해', '결제해', '결제할게', '주문해', '이대로', '넣어줘', '좋지'];
const NO = ['아니', '아뇨', '아냐', '됐어', '괜찮아', '없어', '필요없', '안할래', '노', '싫어', '다른메뉴', '다른거'];

function startsWithAny(t: string, words: string[]): boolean {
  return words.some((w) => t === w || t.startsWith(w));
}

export class RuleBasedNlu implements Nlu {
  parse(raw: string, ctx: NluContext): Parsed {
    const spaced = raw.trim().replace(WAKE, '').trim();
    const t = norm(spaced).replace(WAKE, '');
    if (!t) return { intent: 'UNKNOWN' };

    const current = ctx.currentStoreId ? findStore(ctx.currentStoreId) ?? null : null;
    const visible = ctx.visibleStoreIds.map((id) => findStore(id)).filter((s): s is Store => !!s);
    const qty = parseQty(spaced) ?? undefined;
    const removing = has(t, '빼', '삭제', '없애');

    let mode: Mode | undefined;
    if (has(t, '포장', '픽업', '들러', '들렀다', '찾으러', '가지러')) mode = 'PICKUP';
    else if (has(t, '배달', '집으로', '집에서받')) mode = 'DELIVERY';

    // 1) 취소·상태·재주문은 최우선
    if (has(t, '취소', '그만할래', '안시킬래')) return { intent: 'CANCEL' };
    if (has(t, '언제', '상태', '어디쯤', '들어갔', '들어가', '몇시에')) return { intent: 'CHECK_ORDER_STATUS' };

    // 2) 메뉴 매칭: 지금 매장 → 화면의 매장 순서로 찾는다 (메뉴에 없는 항목은 만들지 않음)
    const searchStores = [current, ...visible].filter((s, i, a): s is Store => !!s && a.indexOf(s) === i);
    for (const s of searchStores) {
      const m = matchItem(t, s);
      if (m) {
        return {
          intent: removing ? 'REMOVE_ITEM' : 'ADD_ITEM',
          storeId: s.id,
          itemId: m.itemId,
          qty: removing ? undefined : qty ?? 1,
          optionIds: matchOptions(t, s),
          mode,
        };
      }
    }

    if (has(t, '늘먹던', '먹던걸로', '먹던거', '지난번거', '지난번이랑', '지난번처럼', '저번거', '저번처럼', '평소처럼', '똑같이', '늘시키던')) {
      return { intent: 'REORDER_FAVORITE' };
    }

    if (has(t, '메뉴판', '메뉴보여', '메뉴열어', '메뉴좀')) {
      return { intent: has(t, '닫', '꺼', '치워') ? 'CLOSE_MENU' : 'OPEN_MENU' };
    }

    // 3) 옵션만 말한 경우 ("콜라 추가", "치즈볼 빼줘")
    if (current) {
      const opts = matchOptions(t, current);
      if (opts.length) return { intent: removing ? 'REMOVE_ITEM' : 'ADD_OPTION', storeId: current.id, optionIds: opts };
    }

    // 4) 매장 지칭
    const named = matchStore(t, visible.length ? visible : STORES);
    if (named) return { intent: 'SELECT_STORE', storeId: named.id, mode };
    for (const [re, idx] of ORDINALS) if (re.test(spaced)) return { intent: 'SELECT_STORE', index: idx, mode };

    // 5) 배달/포장 선택
    if (mode) return { intent: 'CHOOSE_MODE', mode };
    if (has(t, '가는길')) return { intent: 'SELECT_STORE', storeRef: 'ON_THE_WAY' };
    if (has(t, '집근처', '동네')) return { intent: 'SELECT_STORE', storeRef: 'NEAR_HOME' };

    // 6) 예/아니오
    if (startsWithAny(t, NO)) return { intent: 'DENY' };
    if (startsWithAny(t, YES)) return { intent: 'CONFIRM' };

    // 7) 새 주문 시작
    const cat = CATEGORY_WORDS.find(([w]) => t.includes(w))?.[1];
    if (cat || has(t, '시켜', '주문', '먹고싶', '배고파', '배달시', '뭐먹')) {
      return { intent: 'START_FOOD_ORDER', category: cat };
    }

    return { intent: 'UNKNOWN' };
  }
}
