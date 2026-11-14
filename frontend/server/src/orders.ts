import { EventEmitter } from 'node:events';
import { RECEIVE_MARGIN_MIN, computeDispatchAt, prepMinFor, readyAtIfSentAt } from './dispatch.ts';
import type { CardInfo, PaymentProvider } from './payment.ts';
import { MIN, hhmm } from './time.ts';
import { findStore, metaOf, seedRecentOrders, type Mode, type OrderLineInput, type PastOrder, type Store } from './world.ts';

/**
 * 주문 상태 (설계서 4-4)
 *   장바구니(앱) → 결제 완료 → SCHEDULED(전송 대기·예약) → SENT(매장 전송, 시연 끝)
 *   전송 전에는 무료 취소(CANCELLED). 전송 후 조리·배달·수령은 시연 범위 밖.
 */
export type OrderStatus = 'SCHEDULED' | 'SENT' | 'CANCELLED';

export interface EtaReport {
  /** 최종 목적지(집) 도착 예정 epoch ms */
  destinationEta: number;
  /** 경유지(포장 매장) 도착 예정 epoch ms. 포장 주문이면 필수 */
  waypointEta?: number | null;
}

export interface CreateOrderInput {
  storeId: string;
  items: OrderLineInput[];
  mode: Mode;
  eta: EtaReport;
  /** 포장일 때만 매장에 넘기는 차량 정보(개인정보 최소 수집). 배달이면 무시한다 */
  vehicle?: { plate?: string };
  /** 인카페이먼트 등록 카드 id (없으면 기본 카드) */
  cardId?: string;
}

export interface OrderLine {
  itemId: string;
  name: string;
  qty: number;
  optionIds: string[];
  options: { id: string; name: string; price: number }[];
  unitPrice: number;
  lineTotal: number;
}

export interface Order {
  id: string;
  storeId: string;
  storeName: string;
  lines: OrderLine[];
  /** 메뉴 금액 합계 */
  itemsTotal: number;
  /** 배달팁(포장이면 0) */
  deliveryTip: number;
  /** 총 결제금액 = 메뉴 + 배달팁 */
  total: number;
  mode: Mode;
  status: OrderStatus;
  /** 담은 메뉴 중 최대 조리 시간(혼잡 보정 전) */
  itemPrepMin: number;
  prepMin: number;
  deliveryMin: number;
  createdAt: number;
  payment: { provider: string; approvalNo: string; card: CardInfo; installment: string };
  /** 수령 지점 도착 예정 */
  pickupEta: number;
  dispatchAt: number;
  sentAt: number | null;
  cancelledAt: number | null;
  /** 주문 시점에 이미 늦었으면, 도착 후 몇 분 뒤 받는지 */
  lateMin: number | null;
  lastEtaAt: number;
  etaHistory: { at: number; pickupEta: number; dispatchAt: number }[];
  /** 포장 주문의 차량번호 (스타벅스 DT Pass처럼 매장이 차로 고객을 알아본다) */
  vehicle: { plate: string } | null;
  /** 포장 고객이 매장(경유지)에 도착한 시각 */
  customerArrivedAt: number | null;
  /**
   * 매장 쪽 처리 상태 (배달앱 주문접수 화면의 신규 → 처리중 → 완료).
   * 매장 전송(SENT) 뒤에만 의미가 있다.
   */
  storeStatus: 'NEW' | 'ACCEPTED' | 'DONE' | null;
  acceptedAt: number | null;
  doneAt: number | null;
}

export type StoreStep = 'accept' | 'complete';

export class OrderError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface Clock {
  readonly now: number;
}

export class OrderService {
  readonly orders = new Map<string, Order>();
  readonly events = new EventEmitter();
  recent: PastOrder[];
  /** 매장 혼잡 보정(분). POS 시뮬레이터에서 설정 */
  readonly congestion = new Map<string, number>();
  private seq = 0;
  private clock: Clock;
  private payment: PaymentProvider;

  constructor(clock: Clock, payment: PaymentProvider, recent: PastOrder[] = seedRecentOrders()) {
    this.clock = clock;
    this.payment = payment;
    this.recent = recent;
  }

  reset(): void {
    this.orders.clear();
    this.congestion.clear();
    this.recent = seedRecentOrders();
    this.seq = 0;
  }

  get(id: string): Order {
    const o = this.orders.get(id);
    if (!o) throw new OrderError(404, 'NOT_FOUND', '주문을 찾을 수 없어요');
    return o;
  }

  list(): Order[] {
    return [...this.orders.values()].sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
  }

  congestionOf(storeId: string): number {
    return this.congestion.get(storeId) ?? 0;
  }

  /** 메뉴 근거로 주문 줄을 검증하고 가격을 서버에서 다시 계산한다 */
  buildLines(store: Store, items: OrderLineInput[]): OrderLine[] {
    if (!Array.isArray(items) || items.length === 0) throw new OrderError(400, 'EMPTY_CART', '담은 메뉴가 없어요');
    return items.map((l) => {
      const item = store.items.find((i) => i.id === l.itemId);
      if (!item) throw new OrderError(400, 'UNKNOWN_ITEM', `메뉴에 없는 항목: ${l.itemId}`);
      const qty = Number(l.qty);
      if (!Number.isInteger(qty) || qty < 1 || qty > 20) throw new OrderError(400, 'BAD_QTY', '수량이 올바르지 않아요');
      const optionIds = l.optionIds ?? [];
      const options = optionIds.map((id) => {
        const o = store.options.find((x) => x.id === id);
        if (!o) throw new OrderError(400, 'UNKNOWN_OPTION', `옵션에 없는 항목: ${id}`);
        return { id: o.id, name: o.name, price: o.price };
      });
      const unitPrice = item.price + options.reduce((s, o) => s + o.price, 0);
      return { itemId: item.id, name: item.name, qty, optionIds, options, unitPrice, lineTotal: unitPrice * qty };
    });
  }

  private pickupEtaFrom(mode: Mode, eta: EtaReport): number {
    if (mode === 'PICKUP') {
      if (typeof eta.waypointEta !== 'number') throw new OrderError(400, 'NO_WAYPOINT_ETA', '포장 주문에는 매장(경유지) 도착 예정이 필요해요');
      return eta.waypointEta;
    }
    if (typeof eta.destinationEta !== 'number') throw new OrderError(400, 'NO_ETA', '도착 예정 시각이 필요해요');
    return eta.destinationEta;
  }

  async create(input: CreateOrderInput): Promise<Order> {
    const store = findStore(input.storeId);
    if (!store) throw new OrderError(404, 'UNKNOWN_STORE', '매장을 찾을 수 없어요');
    if (input.mode !== 'DELIVERY' && input.mode !== 'PICKUP') throw new OrderError(400, 'BAD_MODE', '배달 또는 포장만 가능해요');
    const lines = this.buildLines(store, input.items);
    const pickupEta = this.pickupEtaFrom(input.mode, input.eta ?? ({} as EtaReport));
    const itemsTotal = lines.reduce((s, l) => s + l.lineTotal, 0);
    const meta = metaOf(store.id);
    if (input.mode === 'DELIVERY' && itemsTotal < meta.minOrder) {
      throw new OrderError(400, 'BELOW_MIN_ORDER', `배달 최소주문금액은 ${meta.minOrder.toLocaleString('ko-KR')}원이에요`);
    }
    const deliveryTip = input.mode === 'DELIVERY' ? meta.deliveryTip : 0;
    const total = itemsTotal + deliveryTip;

    const id = `ord-${String(++this.seq).padStart(4, '0')}`;
    const pay = await this.payment.charge({ orderId: id, amount: total, cardId: input.cardId, merchant: store.name });
    if (!pay.ok) throw new OrderError(402, 'PAYMENT_FAILED', pay.reason);

    const now = this.clock.now;
    const itemPrepMin = prepMinFor(lines.map((l) => store.items.find((i) => i.id === l.itemId)!.prepMin), 0);
    const prepMin = itemPrepMin + this.congestionOf(store.id);
    const order: Order = {
      id,
      storeId: store.id,
      storeName: store.name,
      lines,
      itemsTotal,
      deliveryTip,
      total,
      mode: input.mode,
      status: 'SCHEDULED',
      itemPrepMin,
      prepMin,
      deliveryMin: store.deliveryMin,
      createdAt: now,
      payment: { provider: pay.provider, approvalNo: pay.approvalNo, card: pay.card, installment: pay.installment },
      pickupEta,
      dispatchAt: computeDispatchAt({ mode: input.mode, pickupEta, prepMin, deliveryMin: store.deliveryMin }),
      sentAt: null,
      cancelledAt: null,
      lateMin: null,
      lastEtaAt: now,
      etaHistory: [],
      vehicle:
        input.mode === 'PICKUP' && typeof input.vehicle?.plate === 'string' && input.vehicle.plate.trim()
          ? { plate: input.vehicle.plate.trim().slice(0, 16) }
          : null,
      customerArrivedAt: null,
      storeStatus: null,
      acceptedAt: null,
      doneAt: null,
    };
    order.etaHistory.push({ at: now, pickupEta, dispatchAt: order.dispatchAt });
    this.orders.set(id, order);
    this.recent.push({ orderId: id, storeId: store.id, items: input.items.map((l) => ({ ...l, optionIds: l.optionIds ?? [] })), mode: input.mode, orderedAt: now });
    this.events.emit('order.created', order);

    // 이미 늦은 경우: 즉시 전송하고 솔직하게 안내
    if (order.dispatchAt <= now) {
      const ready = readyAtIfSentAt(now, order);
      order.lateMin = Math.max(1, Math.ceil((ready - pickupEta) / MIN));
      this.send(order);
    }
    return order;
  }

  /** 차량 ETA 보고(30초마다). 전송 전이면 전송 시각을 다시 계산한다 */
  reportEta(id: string, eta: EtaReport): Order {
    const o = this.get(id);
    if (o.status === 'CANCELLED') return o;
    const pickupEta = this.pickupEtaFrom(o.mode, eta);
    o.lastEtaAt = this.clock.now;
    const changed = Math.abs(pickupEta - o.pickupEta) >= 1000;
    o.pickupEta = pickupEta;
    if (o.status === 'SCHEDULED') {
      this.recompute(o);
      this.checkDue(o);
    } else if (changed) {
      // 전송 후 정체: 매장에 '도착 예정 갱신'만 알린다
      this.events.emit('order.updated', o);
    }
    return o;
  }

  private recompute(o: Order): void {
    const prev = o.dispatchAt;
    o.prepMin = o.itemPrepMin + this.congestionOf(o.storeId);
    o.dispatchAt = computeDispatchAt(o);
    if (Math.abs(o.dispatchAt - prev) >= 1000) {
      o.etaHistory.push({ at: this.clock.now, pickupEta: o.pickupEta, dispatchAt: o.dispatchAt });
      if (o.etaHistory.length > 50) o.etaHistory.shift();
      this.events.emit('order.updated', o);
    }
  }

  private checkDue(o: Order): void {
    if (o.status === 'SCHEDULED' && this.clock.now >= o.dispatchAt) this.send(o);
  }

  /** 스케줄러 틱: 전송 시각이 된 주문을 매장으로 보낸다 */
  tick(): Order[] {
    const sent: Order[] = [];
    for (const o of this.orders.values()) {
      if (o.status !== 'SCHEDULED') continue;
      this.checkDue(o);
      if (o.sentAt !== null) sent.push(o);
    }
    return sent;
  }

  setCongestion(storeId: string, extraPrepMin: number): void {
    if (!findStore(storeId)) throw new OrderError(404, 'UNKNOWN_STORE', '매장을 찾을 수 없어요');
    this.congestion.set(storeId, Math.max(0, Math.min(60, Math.round(extraPrepMin))));
    for (const o of this.orders.values()) {
      if (o.storeId === storeId && o.status === 'SCHEDULED') {
        this.recompute(o);
        this.checkDue(o);
      }
    }
  }

  async cancel(id: string): Promise<Order> {
    const o = this.get(id);
    if (o.status === 'CANCELLED') return o;
    if (o.status === 'SENT') {
      throw new OrderError(409, 'ALREADY_SENT', '이미 매장에 전송된 주문이라 매장 정책에 따라 취소해야 해요');
    }
    await this.payment.refund(o.payment.approvalNo, o.total);
    o.status = 'CANCELLED';
    o.cancelledAt = this.clock.now;
    this.recent = this.recent.filter((r) => r.orderId !== o.id);
    this.events.emit('order.cancelled', o);
    return o;
  }

  /** 포장 고객이 매장에 도착했다(차가 경유지에 닿음) → POS에 알린다 */
  markCustomerArrived(storeId: string): Order[] {
    const hit: Order[] = [];
    for (const o of this.orders.values()) {
      if (o.storeId !== storeId || o.mode !== 'PICKUP' || o.status === 'CANCELLED' || o.customerArrivedAt) continue;
      o.customerArrivedAt = this.clock.now;
      this.events.emit('order.arrived', o);
      hit.push(o);
    }
    return hit;
  }

  /** 매장 POS: 주문 접수(신규 → 처리중), 조리 완료(처리중 → 완료) */
  storeAction(id: string, step: StoreStep): Order {
    const o = this.get(id);
    if (o.status !== 'SENT') throw new OrderError(409, 'NOT_SENT', '아직 매장에 전송되지 않은 주문이에요');
    const now = this.clock.now;
    if (step === 'accept') {
      if (o.storeStatus !== 'NEW') throw new OrderError(409, 'ALREADY_ACCEPTED', '이미 접수한 주문이에요');
      o.storeStatus = 'ACCEPTED';
      o.acceptedAt = now;
      this.events.emit('order.accepted', o);
    } else if (step === 'complete') {
      if (o.storeStatus !== 'ACCEPTED') throw new OrderError(409, 'NOT_ACCEPTED', '접수한 주문만 완료할 수 있어요');
      o.storeStatus = 'DONE';
      o.doneAt = now;
      this.events.emit('order.done', o);
    } else {
      throw new OrderError(400, 'BAD_STEP', '알 수 없는 처리 단계예요');
    }
    return o;
  }

  private send(o: Order): void {
    o.status = 'SENT';
    o.sentAt = this.clock.now;
    o.storeStatus = 'NEW';
    this.events.emit('order.sent', o);
  }
}

/** API 응답용: 사람이 읽기 쉬운 시각 문자열을 덧붙인다 */
export function orderView(o: Order) {
  return {
    ...o,
    /** 수령 여유(분): 배달 +3, 포장 −1 */
    marginMin: RECEIVE_MARGIN_MIN[o.mode],
    display: {
      pickupEta: hhmm(o.pickupEta),
      dispatchAt: hhmm(o.dispatchAt),
      sentAt: o.sentAt ? hhmm(o.sentAt) : null,
      readyAt: hhmm(readyAtIfSentAt(o.sentAt ?? o.dispatchAt, o)),
    },
  };
}
