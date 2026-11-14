import type { VirtualCar } from '../car.ts';
import { computeDispatchAt, prepMinFor } from '../dispatch.ts';
import { OrderError, orderView, type Order, type OrderService } from '../orders.ts';
import { buildHome, detourMin, priceOf, type HomeData } from '../recommend.ts';
import { hhmm } from '../time.ts';
import { HOME, ITEM_DESC, PAY_CARDS, VEHICLE, findCard, findStore, metaOf, type Category, type Mode, type OrderLineInput, type Store } from '../world.ts';
import { josa, qtyWord, won } from './korean.ts';
import { RuleBasedNlu, type IntentName, type Nlu, type Parsed } from './nlu.ts';

/**
 * Gleo 대화 관리자 (설계서 2·4-3).
 * 운전 중 발화 원칙: 한 번에 선택지 3개 이하, 한 문장 짧게, 결제 전 금액 반드시 읽기.
 *
 * 웹 프로토타입에서는 서버에 두지만, 실제 앱에서는 차량 앱 안(Gleo AI SDK 위)에서 돈다.
 */
export type Phase = 'IDLE' | 'BROWSE' | 'ASK_UPSELL' | 'ASK_MODE' | 'ASK_PAY' | 'ORDERED';

export interface Session {
  phase: Phase;
  category: Category | null;
  storeId: string | null;
  cart: OrderLineInput[];
  mode: Mode | null;
  /** "지난번 고추마요로 할까요?"처럼 제안 중인 최근 주문 */
  suggestRecent: boolean;
  upsellAsked: boolean;
  menuOpen: boolean;
  orderId: string | null;
  /** 마지막 전송 시각 변경 안내 */
  notice: { orderId: string; text: string; at: number } | null;
  transcript: { who: 'user' | 'gleo'; text: string; ts: number }[];
}

/** 화면 터치도 같은 의도로 처리한다 */
export type UiAction =
  | { type: 'START'; category?: Category }
  | { type: 'SELECT_STORE'; storeId: string }
  | { type: 'ADD_ITEM'; itemId: string; qty?: number; optionIds?: string[] }
  | { type: 'ADD_OPTION'; optionIds: string[] }
  | { type: 'REMOVE_LINE'; index: number }
  | { type: 'REORDER'; index?: number }
  | { type: 'CHOOSE_MODE'; mode: Mode }
  | { type: 'CONFIRM'; cardId?: string }
  | { type: 'SET_QTY'; index: number; qty: number }
  | { type: 'SET_MODE'; mode: Mode }
  | { type: 'SELECT_CARD'; cardId: string }
  | { type: 'DENY' }
  | { type: 'CANCEL' }
  | { type: 'OPEN_MENU' }
  | { type: 'CLOSE_MENU' }
  | { type: 'STATUS' };

/** 계약: Gleo 해석 결과 (P4 → P3) */
export interface GleoResult {
  intent: IntentName;
  storeId?: string;
  itemId?: string;
  qty?: number;
  optionIds?: string[];
  mode?: Mode;
  needsConfirm: boolean;
  ttsText: string;
}

export interface DialogDeps {
  clock: { readonly now: number };
  car: VirtualCar;
  orders: OrderService;
  nlu?: Nlu;
  /** 주문이 예약되면 호출(데모 자동 빨리감기용) */
  onOrderPlaced?: (orderId: string) => void;
}

const UNIT: Record<Category, string> = { 치킨: '마리', 피자: '판', 버거: '개', 분식: '인분', 카페: '잔' };
const MODE_LABEL: Record<Mode, string> = { DELIVERY: '배달', PICKUP: '포장' };

function newSession(): Session {
  return {
    phase: 'IDLE',
    category: null,
    storeId: null,
    cart: [],
    mode: null,
    suggestRecent: false,
    upsellAsked: false,
    menuOpen: false,
    orderId: null,
    notice: null,
    transcript: [],
  };
}

export class GleoDialog {
  session: Session = newSession();
  private deps: DialogDeps;
  private nlu: Nlu;

  constructor(deps: DialogDeps) {
    this.deps = deps;
    this.nlu = deps.nlu ?? new RuleBasedNlu();
  }

  /** 인카페이먼트 결제 카드 (주문이 바뀌어도 유지) */
  cardId: string = PAY_CARDS[0].id;

  reset(): void {
    this.session = newSession();
    this.cardId = PAY_CARDS[0].id;
  }

  private quiet(intent: string, ttsText: string): GleoResult {
    this.say(ttsText);
    const s = this.session;
    return { intent: intent as IntentName, needsConfirm: s.phase === 'ASK_PAY', ttsText };
  }

  /** 주문 화면의 −/+ 수량 버튼. 0이면 그 줄을 뺀다 */
  private setQty(index: number, qty: number): string {
    const s = this.session;
    const line = s.cart[index];
    const store = s.storeId ? findStore(s.storeId) : undefined;
    if (!line || !store) return '바꿀 메뉴가 없어요.';
    const q = Math.max(0, Math.min(20, Math.round(qty)));
    const name = store.items.find((i) => i.id === line.itemId)!.name;
    if (q === 0) {
      s.cart.splice(index, 1);
      if (s.cart.length === 0) {
        s.phase = 'BROWSE';
        return '장바구니가 비었어요. 무엇으로 할까요?';
      }
      return `${josa(name, '을')} 뺐어요. 총 ${won(this.payTotal())}이에요.`;
    }
    line.qty = q;
    return `${name} ${qtyWord(q)} ${UNIT[store.category]}, 총 ${won(this.payTotal())}이에요.`;
  }

  // ───────────────────────── 입력 ─────────────────────────

  /** 음성(텍스트) 입력 */
  async utter(text: string): Promise<GleoResult> {
    this.log('user', text);
    const home = this.home();
    const parsed = this.nlu.parse(text, {
      currentStoreId: this.session.storeId,
      visibleStoreIds: this.visibleStores(home),
    });
    return this.handle(parsed, home);
  }

  /** 화면 터치 입력 */
  async act(a: UiAction): Promise<GleoResult> {
    const home = this.home();
    // 화면에서만 하는 조작: 카드 고르기, 수량 바꾸기 (말 대신 짧은 확인만)
    if (a.type === 'SELECT_CARD' || a.type === 'CONFIRM') {
      if (a.cardId && PAY_CARDS.some((c) => c.id === a.cardId)) this.cardId = a.cardId;
      if (a.type === 'SELECT_CARD') return this.quiet('SELECT_CARD', `${josa(findCard(this.cardId).name, '로')} 결제할게요.`);
    }
    if (a.type === 'SET_QTY') return this.quiet('SET_QTY', this.setQty(a.index, a.qty));
    if (a.type === 'SET_MODE' && (a.mode === 'DELIVERY' || a.mode === 'PICKUP')) {
      // 가게 화면의 배달/포장 탭: 결제 확인 중이면 금액을 다시 읽고, 아니면 조용히 바꾼다
      if (!this.session.storeId) return this.quiet('SET_MODE', '먼저 가게를 골라 주세요.');
      const prefix = this.applyMode(a.mode);
      if (this.session.phase === 'ASK_PAY') return this.quiet('CHOOSE_MODE', `${prefix}${this.askPay()}`);
      return this.quiet('SET_MODE', `${prefix}${josa(MODE_LABEL[a.mode], '로')} 할게요.`);
    }
    const p: Parsed = (() => {
      switch (a.type) {
        case 'START': return { intent: 'START_FOOD_ORDER', category: a.category };
        case 'SELECT_STORE': return { intent: 'SELECT_STORE', storeId: a.storeId };
        case 'ADD_ITEM': return { intent: 'ADD_ITEM', storeId: this.session.storeId ?? undefined, itemId: a.itemId, qty: a.qty ?? 1, optionIds: a.optionIds ?? [] };
        case 'ADD_OPTION': return { intent: 'ADD_OPTION', optionIds: a.optionIds ?? [] };
        case 'REMOVE_LINE': return { intent: 'REMOVE_ITEM', index: a.index };
        case 'REORDER': return { intent: 'REORDER_FAVORITE', index: a.index ?? 0 };
        case 'CHOOSE_MODE': return { intent: 'CHOOSE_MODE', mode: a.mode };
        case 'CONFIRM': return { intent: 'CONFIRM' };
        case 'DENY': return { intent: 'DENY' };
        case 'CANCEL': return { intent: 'CANCEL' };
        case 'OPEN_MENU': return { intent: 'OPEN_MENU' };
        case 'CLOSE_MENU': return { intent: 'CLOSE_MENU' };
        case 'STATUS': return { intent: 'CHECK_ORDER_STATUS' };
      }
    })() ?? { intent: 'UNKNOWN' }; // HTTP로 들어온 알 수 없는 type
    return this.handle(p, home);
  }

  /** 주행 제한 상태가 바뀔 때: 메뉴판이 열려 있으면 축소하고 음성으로 이어받는다 */
  onRestrictionChange(restricted: boolean): string | null {
    if (restricted && this.session.menuOpen) {
      this.session.menuOpen = false;
      return this.say('출발해서 메뉴판을 줄였어요. 이어서 말씀하세요.');
    }
    return null;
  }

  /**
   * 전송 시각이 크게 바뀌었을 때 원인과 결과를 한 문장으로 말한다.
   * 예: "정체로 도착이 6분 늦어져 전송도 19:13에서 19:19로 미뤘어요."
   */
  onDispatchShift(
    o: Order,
    shift: { reason: 'JAM' | 'FAST' | 'ETA' | 'STORE'; from: { dispatchAt: number; pickupEta: number; prepMin: number } },
  ): string | null {
    if (this.session.orderId !== o.id) return null;
    const later = o.dispatchAt > shift.from.dispatchAt;
    const move = `${hhmm(shift.from.dispatchAt)}에서 ${josa(hhmm(o.dispatchAt), '로')} ${later ? '미뤘어요' : '당겼어요'}`;
    let text: string;
    if (shift.reason === 'STORE') {
      const d = Math.abs(o.prepMin - shift.from.prepMin);
      text = o.prepMin > shift.from.prepMin
        ? `매장이 붐벼 조리가 ${d}분 더 걸려서 전송을 ${move}.`
        : `매장 조리가 ${d}분 빨라져 전송을 ${move}.`;
    } else {
      const n = Math.max(1, Math.round(Math.abs(o.pickupEta - shift.from.pickupEta) / 60_000));
      const place = o.mode === 'PICKUP' ? '매장 도착' : '도착';
      const cause = shift.reason === 'JAM' ? '정체로 ' : shift.reason === 'FAST' ? '길이 뚫려 ' : '';
      text = `${cause}${place}이 ${n}분 ${later ? '늦어져' : '빨라져'} 전송도 ${move}.`;
    }
    this.session.notice = { orderId: o.id, text, at: this.deps.clock.now };
    return this.say(text);
  }

  /** 대화 밖에서 생긴 안내(매장 접근·도착 등)를 대화 기록에 남긴다 */
  announce(text: string): void {
    this.say(text);
  }

  /** 주문이 매장으로 전송됐을 때 Gleo 안내 */
  onOrderSent(orderId: string): string | null {
    if (this.session.orderId !== orderId) return null;
    const o = this.deps.orders.get(orderId);
    if (o.lateMin) return null; // 주문 직후 즉시 전송된 경우는 결제 안내에서 이미 말함
    return this.say(o.mode === 'PICKUP' ? '방금 주문을 넣었어요. 매장에 도착하실 즈음 준비돼요.' : '방금 주문을 넣었어요. 집에 도착하실 즈음 도착해요.');
  }

  // ───────────────────────── 처리 ─────────────────────────

  private async handle(p: Parsed, home: HomeData): Promise<GleoResult> {
    const s = this.session;
    let tts: string;

    switch (p.intent) {
      case 'START_FOOD_ORDER':
        tts = this.start(p.category ?? null);
        break;
      case 'REORDER_FAVORITE':
        tts = this.reorder(p.index ?? 0);
        break;
      case 'CHECK_ORDER_STATUS':
        tts = this.status();
        break;
      case 'CANCEL':
        tts = await this.cancel();
        break;
      case 'SELECT_STORE':
        tts = this.selectStore(p, home);
        break;
      case 'OPEN_MENU':
        if (!s.storeId) tts = '먼저 가게를 골라 주세요.';
        else if (this.deps.car.uxRestricted) tts = '메뉴판은 정차 중에 볼 수 있어요. 말로 주문해 주세요.';
        else {
          s.menuOpen = true;
          tts = '메뉴판을 열었어요.';
        }
        break;
      case 'CLOSE_MENU':
        s.menuOpen = false;
        tts = '메뉴판을 닫았어요.';
        break;
      case 'ADD_ITEM':
        tts = this.addItem(p);
        break;
      case 'ADD_OPTION':
        tts = this.addOption(p.optionIds ?? []);
        break;
      case 'REMOVE_ITEM':
        tts = this.removeItem(p);
        break;
      case 'CHOOSE_MODE':
        tts = this.chooseMode(p.mode!);
        break;
      case 'CONFIRM':
        tts = await this.confirm();
        break;
      case 'DENY':
        tts = this.deny();
        break;
      default:
        tts = s.storeId
          ? `${findStore(s.storeId)!.name} 메뉴에서 찾지 못했어요. 다시 말씀해 주세요.`
          : "잘 못 알아들었어요. '치킨 시켜줘'처럼 말씀해 주세요.";
    }

    this.say(tts);
    return {
      intent: p.intent,
      storeId: p.storeId,
      itemId: p.itemId,
      qty: p.qty,
      optionIds: p.optionIds,
      mode: p.mode,
      needsConfirm: s.suggestRecent || s.phase === 'ASK_UPSELL' || s.phase === 'ASK_MODE' || s.phase === 'ASK_PAY',
      ttsText: tts,
    };
  }

  private start(category: Category | null): string {
    const keepOrder = this.session.orderId;
    const transcript = this.session.transcript;
    this.session = { ...newSession(), transcript, orderId: keepOrder, phase: 'BROWSE', category };
    const home = this.home();
    const label = category ?? '음식';

    const recent = home.recent[0];
    if (recent) {
      this.session.storeId = recent.storeId;
      this.session.suggestRecent = true;
      return `지난번 ${josa(recent.items[0].name.replace(/치킨$/, ''), '로')} 할까요, 다른 메뉴를 고를까요?`;
    }
    const names = [...home.nearHome, ...home.onTheWay].slice(0, 3).map((c) => c.name);
    if (names.length === 0) return `근처에 ${label} 가게를 찾지 못했어요.`;
    return `${label} 가게는 ${names.join(', ')}가 있어요. 어디로 할까요?`;
  }

  /** 최근 주문 재주문. index는 호출 화면 '최근 주문' 묶음의 순서와 같다 */
  private reorder(index: number): string {
    const s = this.session;
    const past = this.home().recent[index];
    if (!past) return '최근 주문이 없어요. 무엇을 드시고 싶으세요?';
    const store = findStore(past.storeId)!;
    const transcript = s.transcript;
    this.session = {
      ...newSession(),
      transcript,
      orderId: s.orderId,
      phase: 'BROWSE',
      category: store.category,
      storeId: store.id,
      cart: past.items.map((l) => ({ ...l, optionIds: [...l.optionIds] })),
      upsellAsked: true,
    };
    const prefix = this.applyMode(past.mode);
    return `${prefix}지난번처럼 ${store.name} ${this.askPay()}`;
  }

  private status(): string {
    const id = this.session.orderId;
    if (!id) return '진행 중인 주문이 없어요.';
    const o = this.deps.orders.get(id);
    switch (o.status) {
      case 'SCHEDULED':
        return `${hhmm(o.dispatchAt)}에 매장으로 주문을 넣을 예정이에요. ${o.mode === 'PICKUP' ? '매장' : '집'} 도착 예정은 ${hhmm(o.pickupEta)}이에요.`;
      case 'SENT':
        return `${hhmm(o.sentAt!)}에 매장으로 주문을 넣었어요.`;
      case 'CANCELLED':
        return '주문이 취소됐어요.';
    }
  }

  private async cancel(): Promise<string> {
    const s = this.session;
    if (s.orderId) {
      const o = this.deps.orders.get(s.orderId);
      if (o.status === 'SCHEDULED') {
        await this.deps.orders.cancel(o.id);
        if (this.deps.car.waypoint?.storeId === o.storeId) this.deps.car.clearWaypoint();
        this.session = { ...newSession(), transcript: s.transcript, orderId: o.id };
        return '주문을 취소했어요. 결제도 함께 취소돼요.';
      }
      if (o.status === 'SENT' && s.phase === 'ORDERED') {
        return '이미 매장에 주문이 들어갔어요. 취소는 매장 정책에 따라야 해요.';
      }
    }
    if (s.cart.length || s.phase !== 'IDLE') {
      if (s.mode === 'PICKUP') this.deps.car.clearWaypoint();
      this.session = { ...newSession(), transcript: s.transcript, orderId: s.orderId };
      return '주문을 그만둘게요.';
    }
    return '취소할 주문이 없어요.';
  }

  private selectStore(p: Parsed, home: HomeData): string {
    const s = this.session;
    // "가는 길에" 를 배달/포장 질문의 답으로 말한 경우
    if (p.storeRef === 'ON_THE_WAY' && s.phase === 'ASK_MODE') return this.chooseMode('PICKUP');

    let storeId = p.storeId;
    if (!storeId && p.index !== undefined) storeId = this.visibleStores(home)[p.index];
    if (!storeId && p.storeRef === 'ON_THE_WAY') storeId = home.onTheWay[0]?.storeId;
    if (!storeId && p.storeRef === 'NEAR_HOME') storeId = home.nearHome[0]?.storeId;
    const store = storeId ? findStore(storeId) : undefined;
    if (!store) return p.storeRef === 'ON_THE_WAY' ? '가는 길에 들를 만한 가게가 없어요.' : '그 가게를 찾지 못했어요.';

    if (s.storeId !== store.id) {
      s.cart = [];
      s.menuOpen = false;
      if (s.mode === 'PICKUP') this.deps.car.clearWaypoint();
      s.mode = null;
    }
    s.storeId = store.id;
    s.category = store.category;
    s.suggestRecent = false;
    s.phase = 'BROWSE';
    if (p.mode) s.mode = p.mode;

    const card = [...home.nearHome, ...home.onTheWay].find((c) => c.storeId === store.id);
    const detour = card && home.onTheWay.includes(card) ? ` 가는 길에 ${card.detourMin}분 돌아가요.` : '';
    const top = popular(store).map((i) => i.name);
    const last = top[top.length - 1];
    return `${store.name}요.${detour} ${top.join(', ')}${josa(last, '이').slice(last.length)} 인기예요. 무엇으로 할까요?`;
  }

  private addItem(p: Parsed): string {
    const s = this.session;
    const store = findStore(p.storeId ?? s.storeId ?? '');
    const item = store?.items.find((i) => i.id === p.itemId);
    if (!store || !item) return '그 메뉴는 이 가게에 없어요.';

    let prefix = '';
    if (s.storeId && s.storeId !== store.id && s.cart.length) {
      prefix = `${store.name}로 바꿔서 담을게요. `;
      if (s.mode === 'PICKUP') this.deps.car.clearWaypoint();
      s.cart = [];
      s.mode = null;
      s.upsellAsked = false;
    }
    s.storeId = store.id;
    s.category = store.category;
    s.suggestRecent = false;
    if (s.phase === 'IDLE' || s.phase === 'ORDERED') s.phase = 'BROWSE';

    const qty = p.qty ?? 1;
    const optionIds = p.optionIds ?? [];
    const same = s.cart.find((l) => l.itemId === item.id && sameSet(l.optionIds, optionIds));
    if (same) same.qty += qty;
    else s.cart.push({ itemId: item.id, qty, optionIds });

    // 배달/포장까지 한 번에 말했으면 바로 결제 확인(한 문장 짧게)
    if (p.mode) return `${prefix}${this.applyMode(p.mode)}${this.askPay()}`;
    const line = { itemId: item.id, qty, optionIds };
    return `${prefix}${this.lineText(store, line)}, ${won(priceOf(store.id, line))}이에요. ${this.nextQuestion()}`;
  }

  private addOption(optionIds: string[]): string {
    const s = this.session;
    const store = s.storeId ? findStore(s.storeId) : undefined;
    if (!store || s.cart.length === 0) return '먼저 메뉴를 골라 주세요.';
    const last = s.cart[s.cart.length - 1];
    const names = optionIds.map((id) => store.options.find((o) => o.id === id)?.name).filter(Boolean) as string[];
    for (const id of optionIds) if (!last.optionIds.includes(id)) last.optionIds.push(id);
    s.upsellAsked = true;
    const said = `${josa(names.join(', '), '을')} 추가했어요.`;
    if (s.phase === 'ASK_PAY') return `${said} ${this.askPay()}`;
    return `${said} ${this.nextQuestion()}`;
  }

  private removeItem(p: Parsed): string {
    const s = this.session;
    if (s.cart.length === 0) return '장바구니가 비어 있어요.';
    if (p.index !== undefined) s.cart.splice(p.index, 1);
    else if (p.itemId) s.cart = s.cart.filter((l) => l.itemId !== p.itemId);
    else if (p.optionIds?.length) for (const l of s.cart) l.optionIds = l.optionIds.filter((id) => !p.optionIds!.includes(id));
    else s.cart.pop();

    if (s.cart.length === 0) {
      s.phase = 'BROWSE';
      return '뺐어요. 장바구니가 비었어요. 무엇으로 할까요?';
    }
    if (s.phase === 'ASK_PAY') return `뺐어요. ${this.askPay()}`;
    return '뺐어요.';
  }

  private chooseMode(mode: Mode): string {
    const s = this.session;
    if (s.cart.length === 0) {
      s.mode = mode;
      return `${josa(MODE_LABEL[mode], '로')} 할게요. 메뉴를 먼저 골라 주세요.`;
    }
    return `${this.applyMode(mode)}${this.askPay()}`;
  }

  private async confirm(): Promise<string> {
    const s = this.session;
    if (s.suggestRecent) {
      const past = [...this.deps.orders.recent].sort((a, b) => b.orderedAt - a.orderedAt).find((o) => o.storeId === s.storeId);
      if (past) {
        s.cart = past.items.map((l) => ({ ...l, optionIds: [...l.optionIds] }));
        s.suggestRecent = false;
        const store = findStore(past.storeId)!;
        return `${this.cartText(store)}, ${won(this.cartTotal())}이에요. ${this.nextQuestion()}`;
      }
    }
    switch (s.phase) {
      case 'ASK_UPSELL': {
        const store = findStore(s.storeId!)!;
        const drink = store.options.find((o) => o.drink);
        if (drink) return this.addOption([drink.id]);
        return this.session.mode ? this.askPay() : this.askMode();
      }
      case 'ASK_MODE':
        return '집으로 배달할지, 가는 길에 포장할지 말씀해 주세요.';
      case 'ASK_PAY':
        return this.placeOrder();
      default:
        return s.cart.length ? this.nextQuestion() : '무엇을 주문할까요?';
    }
  }

  private deny(): string {
    const s = this.session;
    if (s.suggestRecent) {
      s.suggestRecent = false;
      const store = findStore(s.storeId!)!;
      const top = popular(store).map((i) => i.name);
      return `그럼 ${store.name}의 ${top.join(', ')} 중에 고르시거나, 다른 가게를 말씀해 주세요.`;
    }
    switch (s.phase) {
      case 'ASK_UPSELL':
        return s.mode ? this.askPay() : this.askMode();
      case 'ASK_PAY':
        s.phase = 'BROWSE';
        return '알겠어요. 바꿀 메뉴를 말씀해 주세요.';
      case 'ASK_MODE':
        return '배달과 포장 중에 골라 주세요.';
      default:
        return '알겠어요.';
    }
  }

  private async placeOrder(): Promise<string> {
    const s = this.session;
    const { car, clock, orders } = this.deps;
    if (!s.storeId || !s.mode || s.cart.length === 0) return this.nextQuestion();
    try {
      const o = await orders.create({
        storeId: s.storeId,
        items: s.cart,
        mode: s.mode,
        eta: { destinationEta: car.etaDestination(clock.now), waypointEta: car.etaWaypoint(clock.now) },
        vehicle: s.mode === 'PICKUP' ? { plate: VEHICLE.plate } : undefined,
        cardId: this.cardId,
      });
      s.orderId = o.id;
      s.phase = 'ORDERED';
      s.menuOpen = false;
      this.deps.onOrderPlaced?.(o.id);
      if (o.lateMin) return `결제했어요. 지금 바로 주문을 넣을게요. 도착 후 약 ${o.lateMin}분 뒤 받으실 수 있어요.`;
      return `결제했어요. ${hhmm(o.dispatchAt)}에 매장으로 주문을 넣을게요.`;
    } catch (e) {
      if (e instanceof OrderError && e.code === 'PAYMENT_FAILED') return '결제가 승인되지 않았어요. 다시 시도할까요?';
      if (e instanceof OrderError) return `주문하지 못했어요. ${e.message}`;
      throw e;
    }
  }

  // ───────────────────────── 도우미 ─────────────────────────

  /** 담은 다음 물어볼 것: 음료 → 배달/포장 → 결제 */
  private nextQuestion(): string {
    const s = this.session;
    const store = findStore(s.storeId!)!;
    const hasDrink = s.cart.some((l) => l.optionIds.some((id) => store.options.find((o) => o.id === id)?.drink));
    if (!s.upsellAsked && !hasDrink && store.options.some((o) => o.drink)) {
      s.upsellAsked = true;
      s.phase = 'ASK_UPSELL';
      return '음료 추가할까요?';
    }
    if (!s.mode) return this.askMode();
    return this.askPay();
  }

  private askMode(): string {
    this.session.phase = 'ASK_MODE';
    return '집으로 배달할까요, 가는 길에 포장할까요?';
  }

  /** 결제 전 메뉴와 금액을 반드시 읽는다 */
  private askPay(): string {
    const s = this.session;
    const store = findStore(s.storeId!)!;
    const meta = metaOf(store.id);
    // 배달앱처럼 배달은 최소주문금액을 넘어야 한다(포장은 제한 없음)
    if (s.mode === 'DELIVERY' && this.cartTotal() < meta.minOrder) {
      s.phase = 'BROWSE';
      return `배달 최소주문금액은 ${won(meta.minOrder)}이에요. ${won(meta.minOrder - this.cartTotal())} 더 담거나 포장으로 바꿔 주세요.`;
    }
    s.phase = 'ASK_PAY';
    const tip = this.tip();
    return `${this.cartText(store)}, ${tip ? `배달팁 ${won(tip)} 포함 ` : ''}${josa(MODE_LABEL[s.mode!], '로')} ${won(this.payTotal())} 결제할까요?`;
  }

  /** 지금 수령 방식의 배달팁 (포장이면 0) */
  private tip(): number {
    const s = this.session;
    return s.storeId && s.mode !== 'PICKUP' ? metaOf(s.storeId).deliveryTip : 0;
  }

  /** 총 결제금액 = 메뉴 + 배달팁 */
  private payTotal(): number {
    return this.cartTotal() + this.tip();
  }

  /** 배달/포장을 정하고 포장이면 매장을 내비 경유지로 추가한다 */
  private applyMode(mode: Mode): string {
    const s = this.session;
    const { car } = this.deps;
    s.mode = mode;
    if (mode === 'PICKUP') {
      const store = findStore(s.storeId!)!;
      car.setWaypoint(store.id, store.name, store.pos, detourMin(car.position, store.pos, HOME));
      return `${josa(store.name, '을')} 경유지로 추가했어요. `;
    }
    if (car.waypoint) car.clearWaypoint();
    return '';
  }

  private lineText(store: Store, l: OrderLineInput): string {
    const item = store.items.find((i) => i.id === l.itemId)!;
    const opts = l.optionIds.map((id) => store.options.find((o) => o.id === id)?.name).filter(Boolean);
    return `${item.name} ${qtyWord(l.qty)} ${UNIT[store.category]}${opts.length ? `에 ${opts.join(', ')}` : ''}`;
  }

  private cartText(store: Store): string {
    return this.session.cart.map((l) => this.lineText(store, l)).join(', ');
  }

  private cartTotal(): number {
    const s = this.session;
    return s.cart.reduce((sum, l) => sum + priceOf(s.storeId!, l), 0);
  }

  private home(): HomeData {
    const { car, orders } = this.deps;
    return buildHome(car.position, HOME, orders.recent, this.session.category ?? undefined);
  }

  private visibleStores(home: HomeData): string[] {
    return [...home.nearHome, ...home.onTheWay].map((c) => c.storeId);
  }

  private log(who: 'user' | 'gleo', text: string): void {
    this.session.transcript.push({ who, text, ts: this.deps.clock.now });
    if (this.session.transcript.length > 30) this.session.transcript.shift();
  }

  private say(text: string): string {
    this.log('gleo', text);
    return text;
  }

  /** 미리보기: 지금 결제하면 몇 시에 전송되는지 (배달/포장 각각) */
  private preview(store: Store) {
    const { car, clock, orders } = this.deps;
    const s = this.session;
    if (s.cart.length === 0) return null;
    const prepMin = prepMinFor(s.cart.map((l) => store.items.find((i) => i.id === l.itemId)!.prepMin), orders.congestionOf(store.id));
    const now = clock.now;
    const delivery = computeDispatchAt({ mode: 'DELIVERY', pickupEta: car.etaDestination(now), prepMin, deliveryMin: store.deliveryMin });
    const wpEta =
      car.waypoint?.storeId === store.id ? car.etaWaypoint(now) : estimateWaypointEta(car, now, store);
    const pickup = wpEta ? computeDispatchAt({ mode: 'PICKUP', pickupEta: wpEta, prepMin, deliveryMin: 0 }) : null;
    return {
      prepMin,
      deliveryMin: store.deliveryMin,
      DELIVERY: { dispatchAt: delivery, display: hhmm(delivery) },
      PICKUP: pickup ? { dispatchAt: pickup, display: hhmm(pickup) } : null,
    };
  }

  /** 차량 화면이 그릴 상태 */
  view() {
    const s = this.session;
    const store = s.storeId ? findStore(s.storeId) : undefined;
    const home = this.home();
    const order = s.orderId ? this.deps.orders.orders.get(s.orderId) : undefined;
    return {
      phase: s.phase,
      category: s.category,
      suggestRecent: s.suggestRecent,
      menuOpen: s.menuOpen,
      mode: s.mode,
      home,
      store: store
        ? {
            id: store.id,
            name: store.name,
            category: store.category,
            items: store.items.map((i) => ({ ...i, desc: ITEM_DESC[i.id] ?? '' })),
            options: store.options,
            unit: UNIT[store.category],
            ...metaOf(store.id),
          }
        : null,
      /** 인카페이먼트 등록 카드와 지금 고른 카드 */
      cards: PAY_CARDS,
      cardId: this.cardId,
      itemsTotal: store ? this.cartTotal() : 0,
      deliveryTip: store ? this.tip() : 0,
      cart: store
        ? s.cart.map((l) => ({
            ...l,
            name: store.items.find((i) => i.id === l.itemId)!.name,
            options: l.optionIds.map((id) => store.options.find((o) => o.id === id)!.name),
            lineTotal: priceOf(store.id, l),
          }))
        : [],
      total: store ? this.payTotal() : 0,
      preview: store && s.phase !== 'ORDERED' ? this.preview(store) : null,
      order: order ? orderView(order) : null,
      notice: s.notice && s.notice.orderId === s.orderId ? s.notice : null,
      transcript: s.transcript.slice(-8),
    };
  }
}

function popular(store: Store) {
  return store.items.filter((i) => i.popular).concat(store.items.filter((i) => !i.popular)).slice(0, 2);
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

function estimateWaypointEta(car: VirtualCar, now: number, store: Store): number | null {
  const saved = { wp: car.waypoint, done: car.waypointDone };
  car.setWaypoint(store.id, store.name, store.pos, detourMin(car.position, store.pos, HOME));
  const eta = car.etaWaypoint(now);
  car.waypoint = saved.wp;
  car.waypointDone = saved.done;
  return eta;
}
