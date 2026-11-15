import { EventEmitter } from 'node:events';
import { VirtualCar } from './car.ts';
import { SimClock } from './clock.ts';
import { ETA_REPORT_INTERVAL_MS } from './dispatch.ts';
import { GleoDialog } from './gleo/dialog.ts';
import { OrderService, orderView, type Order } from './orders.ts';
import { MockInCarPayment } from './payment.ts';
import { pointAt } from './geo.ts';
import { MIN, hhmm } from './time.ts';
import { STORES, VEHICLE } from './world.ts';

export type DemoAction =
  | 'reset'
  | 'speed'
  | 'pause'
  | 'resume'
  | 'drive'
  | 'stop'
  | 'park'
  | 'jam'
  | 'clearTraffic'
  | 'fast'
  | 'failNextPayment'
  | 'autoFastForward'
  /** 가상 시간 건너뛰기 (UI 둘러보기용) */
  | 'skip'
  | 'skipToSend'
  | 'skipToApproach'
  | 'skipToStore';

/** 전송 시각이 이만큼(분) 이상 바뀌어야 Gleo가 말한다 */
export const SHIFT_ANNOUNCE_MIN = 2;

export type ShiftReason = 'JAM' | 'FAST' | 'ETA' | 'STORE';

/** 포장 매장 직전 안내 거리(km) */
export const APPROACH_KM = 0.5;

function baseline(o: Order) {
  return { dispatchAt: o.dispatchAt, pickupEta: o.pickupEta, prepMin: o.prepMin };
}

/** 결제 직후 자동 빨리감기 배속 (전송되면 1배속으로 돌아온다) */
export const FAST_FORWARD_SPEED = 30;
/** 시뮬레이션 한 스텝의 최대 가상 시간 */
const MAX_STEP_MS = 1_000;

/**
 * 프로토타입 전체 조립: 가상 시계 + 가상 차량 + 주문 서버 + Gleo 대화.
 * HTTP 없이도 돌아가서 테스트에서 그대로 쓴다.
 */
export class DriveOnApp {
  readonly clock = new SimClock();
  readonly car = new VirtualCar();
  readonly payment = new MockInCarPayment();
  readonly orders: OrderService;
  readonly dialog: GleoDialog;
  /** 'gleo.say' {text} · 'pos.order' {order} · 'changed' */
  readonly events = new EventEmitter();
  autoFastForward = true;
  private fastForwarding = false;
  private sinceEtaReport = 0;
  private lastRestricted: boolean;

  constructor() {
    this.orders = new OrderService(this.clock, this.payment);
    this.dialog = new GleoDialog({
      clock: this.clock,
      car: this.car,
      orders: this.orders,
      onOrderPlaced: (id) => this.onOrderPlaced(id),
    });
    this.lastRestricted = this.car.uxRestricted;

    this.orders.events.on('order.sent', (o: Order) => {
      this.sentAtKm.set(o.id, this.car.progressKm);
      const text = this.dialog.onOrderSent(o.id);
      if (text) this.events.emit('gleo.say', { text });
      this.events.emit('pos.order', { kind: 'sent', order: orderView(o) });
      if (this.fastForwarding) {
        this.clock.speed = 1;
        this.fastForwarding = false;
      }
    });
    for (const ev of ['order.created', 'order.updated', 'order.cancelled', 'order.arrived', 'order.accepted', 'order.done']) {
      this.orders.events.on(ev, (o: Order) => this.events.emit('pos.order', { kind: ev.split('.')[1], order: orderView(o) }));
    }
    // 배달앱처럼 매장이 접수하면 운전자에게 한 번 알린다
    this.orders.events.on('order.accepted', (o: Order) => {
      if (this.dialog.session.orderId !== o.id) return;
      this.say(o.mode === 'PICKUP' ? `${o.storeName}에서 주문을 접수했어요.` : `${o.storeName}에서 주문을 접수했어요. 조리를 시작해요.`);
    });
    this.orders.events.on('order.created', (o: Order) => this.announced.set(o.id, baseline(o)));
    this.orders.events.on('order.updated', (o: Order) => this.checkShift(o));
  }

  /** 실제로 매장에 전송된 순간 차가 있던 경로 위치(km) */
  private readonly sentAtKm = new Map<string, number>();

  /**
   * 주문 전송 지점: 진행 중 주문이 '경로 위 어디를 지날 때' 매장으로 들어가는지.
   * 전송 전이면 전송 시각의 예측 위치, 전송 후면 실제 전송 위치.
   */
  sendPoint() {
    const now = this.clock.now;
    const o = this.orders.list().find((x) => x.status !== 'CANCELLED');
    if (!o) return null;
    const sent = o.status === 'SENT';
    const km = sent ? (this.sentAtKm.get(o.id) ?? this.car.progressKm) : this.car.predictKmAt(now, o.dispatchAt);
    return {
      orderId: o.id,
      sent,
      km: Math.round(km * 1000) / 1000,
      pos: pointAt(this.car.route, km),
      at: sent ? (o.sentAt ?? o.dispatchAt) : o.dispatchAt,
      display: hhmm(sent ? (o.sentAt ?? o.dispatchAt) : o.dispatchAt),
    };
  }

  /** 마지막으로 운전자에게 알린 전송 시각(주문별) */
  private readonly announced = new Map<string, { dispatchAt: number; pickupEta: number; prepMin: number }>();

  /**
   * 전송 시각 변화 안내 (카카오내비식 '원인 + 결과' 한 문장).
   * 30초 재계산은 조용히 숫자만 바꾸고, 마지막 안내보다 2분 이상 바뀌었을 때만 말한다.
   */
  private checkShift(o: Order): void {
    if (o.status !== 'SCHEDULED') return;
    const last = this.announced.get(o.id);
    if (!last || Math.abs(o.dispatchAt - last.dispatchAt) < SHIFT_ANNOUNCE_MIN * MIN) return;
    const reason: ShiftReason =
      o.prepMin !== last.prepMin ? 'STORE'
      : this.car.snapshot(this.clock.now).traffic === 'JAM' ? 'JAM'
      : this.car.snapshot(this.clock.now).traffic === 'FAST' ? 'FAST'
      : 'ETA';
    const text = this.dialog.onDispatchShift(o, { reason, from: last });
    this.announced.set(o.id, baseline(o));
    if (text) this.events.emit('gleo.say', { text });
  }

  /** 매장 직전 안내를 이미 한 경유지(매장 id + 주문 id) */
  private approachAnnounced: string | null = null;

  /**
   * 포장은 들러야 끝: 경유지 매장 0.5km 전에 한 번만 안내해 그냥 지나치지 않게 한다.
   * 결제가 끝난 포장 주문이 있을 때만 말한다.
   */
  private checkApproach(): void {
    const wp = this.car.waypoint;
    if (!wp || this.car.waypointDone) return;
    if (wp.routeKm - this.car.progressKm > APPROACH_KM) return;
    const order = this.orders
      .list()
      .find((o) => o.storeId === wp.storeId && o.mode === 'PICKUP' && o.status !== 'CANCELLED' && !o.customerArrivedAt);
    if (!order) return;
    const key = `${wp.storeId}:${order.id}`;
    if (this.approachAnnounced === key) return;
    this.approachAnnounced = key;
    this.say(`곧 ${wp.name}에 들러요. ${order.status === 'SENT' ? '음식이 준비되고 있어요.' : '도착 전에 주문을 넣을게요.'}`);
  }

  private say(text: string): void {
    this.dialog.announce(text);
    this.events.emit('gleo.say', { text });
  }

  private onOrderPlaced(id: string): void {
    const o = this.orders.get(id);
    if (this.autoFastForward && o.status === 'SCHEDULED') {
      this.clock.speed = FAST_FORWARD_SPEED;
      this.fastForwarding = true;
    }
  }

  /** 조건이 맞을 때까지 가상 시간을 1초씩 빠르게 진행한다 (최대 maxMin분) */
  private fastRun(done: () => boolean, maxMin: number): void {
    const { speed, paused } = this.clock;
    this.clock.speed = 1;
    this.clock.paused = false;
    for (let i = 0; i < maxMin * 60 && !done(); i++) this.advance(1000);
    this.clock.speed = speed;
    this.clock.paused = paused;
  }

  /** 실제 경과 시간만큼 가상 세계를 진행한다 */
  advance(realDtMs: number): void {
    let dt = this.clock.advance(realDtMs);
    if (dt <= 0) return;
    // clock.advance가 이미 now를 옮겼으므로, 스텝별로 되감아 가며 처리한다
    const end = this.clock.now;
    this.clock.now = end - dt;
    while (dt > 0) {
      const slice = Math.min(dt, MAX_STEP_MS);
      this.clock.now += slice;
      dt -= slice;
      this.step(slice);
    }
    this.clock.now = end;
  }

  private step(dtMs: number): void {
    const wp = this.car.waypoint;
    const r = this.car.step(dtMs);
    if (r.reachedWaypoint && wp) {
      // 스타벅스 DT Pass처럼 매장이 차로 고객 도착을 안다
      const arrived = this.orders.markCustomerArrived(wp.storeId);
      if (arrived.length) this.say('주문한 매장에 도착했어요. 음식을 받아 가세요.');
    }
    if (r.arrived) this.say('목적지에 도착했어요.');
    this.checkApproach();

    this.sinceEtaReport += dtMs;
    if (this.sinceEtaReport >= ETA_REPORT_INTERVAL_MS) {
      this.sinceEtaReport -= ETA_REPORT_INTERVAL_MS;
      this.reportEtaAll();
    }
    this.orders.tick();

    const restricted = this.car.uxRestricted;
    if (restricted !== this.lastRestricted) {
      this.lastRestricted = restricted;
      const text = this.dialog.onRestrictionChange(restricted);
      if (text) this.events.emit('gleo.say', { text });
    }
  }

  /**
   * 차량 앱이 30초마다 하는 일: 진행 중 주문마다 내비 ETA를 서버에 보고
   * (실제로는 POST /orders/{id}/eta)
   */
  reportEtaAll(): void {
    if (this.car.arrived) return;
    const now = this.clock.now;
    const eta = { destinationEta: this.car.etaDestination(now), waypointEta: this.car.etaWaypoint(now) };
    for (const o of this.orders.orders.values()) {
      if (o.status === 'CANCELLED') continue;
      if (o.mode === 'PICKUP' && eta.waypointEta === null) continue; // 이미 매장을 지남
      this.orders.reportEta(o.id, eta);
    }
  }

  control(action: DemoAction, value?: number | boolean): void {
    switch (action) {
      case 'reset':
        this.clock.reset();
        this.car.reset();
        this.orders.reset();
        this.dialog.reset();
        this.payment.failNext = false;
        this.fastForwarding = false;
        this.announced.clear();
        this.sentAtKm.clear();
        this.approachAnnounced = null;
        this.sinceEtaReport = 0;
        this.lastRestricted = this.car.uxRestricted;
        break;
      case 'speed':
        this.clock.speed = Math.max(0.1, Math.min(120, Number(value) || 1));
        this.fastForwarding = false;
        break;
      case 'pause':
        this.clock.paused = true;
        break;
      case 'resume':
        this.clock.paused = false;
        break;
      case 'drive':
        this.car.setState('DRIVING');
        break;
      case 'stop':
        this.car.setState('STOPPED');
        break;
      case 'park':
        this.car.setState('PARKED');
        break;
      case 'jam':
        this.car.addDelay(Number(value) || 6);
        break;
      case 'fast':
        this.car.addDelay(-(Number(value) || 3));
        break;
      case 'clearTraffic':
        this.car.clearDelay();
        break;
      case 'failNextPayment':
        this.payment.failNext = value !== false;
        break;
      case 'autoFastForward':
        this.autoFastForward = value !== false;
        break;
      case 'skip': {
        const min = Math.max(0, Math.min(120, Number(value) || 0));
        const end = this.clock.now + min * MIN;
        this.fastRun(() => this.clock.now >= end, min);
        break;
      }
      case 'skipToSend': {
        const target = this.orders.list().find((o) => o.status === 'SCHEDULED');
        if (target) this.fastRun(() => target.status !== 'SCHEDULED', 120);
        break;
      }
      case 'skipToApproach':
        this.fastRun(() => {
          const wp = this.car.waypoint;
          return !wp || this.car.waypointDone || wp.routeKm - this.car.progressKm <= APPROACH_KM - 0.05;
        }, 120);
        break;
      case 'skipToStore':
        this.fastRun(() => !this.car.waypoint || this.car.waypointDone, 120);
        break;
      default:
        throw new Error(`unknown demo action: ${String(action)}`);
    }
    // 교통·상태가 바뀌면 바로 ETA를 보고해 화면에 즉시 반영
    if (action !== 'reset') this.reportEtaAll();
    // 주행 제한 변화(메뉴판 축소)는 바로 처리
    const restricted = this.car.uxRestricted;
    if (restricted !== this.lastRestricted) {
      this.lastRestricted = restricted;
      const text = this.dialog.onRestrictionChange(restricted);
      if (text) this.events.emit('gleo.say', { text });
    }
    this.events.emit('changed');
  }

  /**
   * 내비 지도의 '주문 전송 지점': 매장 전송 시각에 차가 있을 경로 위치.
   * 전송 전에는 남은 시간만큼 차를 앞으로 굴려 계산하므로, 정체가 생기면 핀이 경로를 따라 움직인다.
   * 전송 뒤에는 실제로 전송된 순간의 위치에 고정한다.
   */
  private readonly sentKm = new Map<string, number>();
  private dispatchPoint(o: { id: string; status: string; dispatchAt: number } | null | undefined, now: number) {
    if (!o || o.status === 'CANCELLED') return null;
    let km: number;
    let sent = false;
    if (o.status === 'SENT') {
      if (!this.sentKm.has(o.id)) this.sentKm.set(o.id, this.car.progressKm);
      km = this.sentKm.get(o.id)!;
      sent = true;
    } else {
      km = this.car.kmAfter(Math.max(0, o.dispatchAt - now) / 1000);
    }
    return { orderId: o.id, at: o.dispatchAt, routeKm: Math.round(km * 1000) / 1000, pos: this.car.pointAtKm(km), sent };
  }

  state() {
    const now = this.clock.now;
    const session = this.dialog.view();
    return {
      now,
      display: hhmm(now),
      clock: { speed: this.clock.speed, paused: this.clock.paused },
      demo: { autoFastForward: this.autoFastForward, failNextPayment: this.payment.failNext },
      car: this.car.snapshot(now),
      dispatchPoint: this.dispatchPoint(session.order, now),
      sendPoint: this.sendPoint(),
      session,
      orders: this.orders.list().map(orderView),
      vehicle: VEHICLE,
      stores: STORES.map((s) => ({ id: s.id, name: s.name, category: s.category, congestionMin: this.orders.congestionOf(s.id) })),
    };
  }
}
