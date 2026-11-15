import { pointAt, projectOnRoute, type LatLng, type Route } from './geo.ts';
import { BASE_TRIP_MIN, HOME, ROUTE } from './world.ts';

/**
 * 가상 차량 = 실제 차 없이 주행·정차·정체를 재현하는 시뮬레이터 (데모 컨트롤 패널이 조종).
 * 실제 앱에서는 NaviHelper SDK(ETA)와 CarUxRestrictions(주행 제한)가 이 역할을 한다.
 *
 * ETA 모델: ETA = 지금 + 남은거리/기본속도 + 지연(delaySec) + 경유지 체류
 *  - 정체를 넣으면 delaySec가 늘고, 정체가 풀릴 때까지 차는 기본속도의 50%로 달린다.
 *    느리게 달린 만큼 delaySec가 줄어들어서, 정체 중에도 ETA는 일정하게 유지된다.
 *  - 원활(음수 지연)이면 125% 속도로 달리며 ETA가 당겨진다.
 *  - 정차(신호 대기)는 그만큼 ETA가 밀린다.
 */
export type DriveState = 'DRIVING' | 'STOPPED' | 'PARKED';

export interface Waypoint {
  storeId: string;
  name: string;
  pos: LatLng;
  /** 경로 위 위치(km) */
  routeKm: number;
  /** 우회 시간(분) */
  detourMin: number;
}

/** 포장 수령에 걸리는 체류 시간(분) */
const PICKUP_DWELL_MIN = 1;
const JAM_FACTOR = 0.5;
const FAST_FACTOR = 1.25;

export class VirtualCar {
  route: Route;
  baseKmh: number;
  progressKm = 0;
  state: DriveState = 'DRIVING';
  /** 기본 속도 대비 추가로 걸릴 시간(초). +면 정체, −면 원활 */
  delaySec = 0;
  waypoint: Waypoint | null = null;
  waypointDone = false;
  /** 경유지에서 남은 체류 시간(초) */
  dwellSec = 0;
  arrived = false;

  constructor(route: Route = ROUTE) {
    this.route = route;
    this.baseKmh = route.totalKm / (BASE_TRIP_MIN / 60);
  }

  /**
   * 실제 내비(Pleos NaviHelper)가 알려 준 목적지까지 남은 시간·거리.
   * 있으면 도착 예정은 가상 주행 대신 이 값으로 계산한다(보고 사이에는 시계만큼 줄여 나간다).
   */
  nav: { remainSec: number; remainKm: number; at: number; name: string } | null = null;

  setNav(n: { remainSec: number; remainKm: number; at: number; name: string } | null): void {
    this.nav = n;
  }

  reset(): void {
    this.nav = null;
    this.progressKm = 0;
    this.state = 'DRIVING';
    this.delaySec = 0;
    this.waypoint = null;
    this.waypointDone = false;
    this.dwellSec = 0;
    this.arrived = false;
  }

  get speedFactor(): number {
    if (this.delaySec > 0.5) return JAM_FACTOR;
    if (this.delaySec < -0.5) return FAST_FACTOR;
    return 1;
  }

  /** 현재 차속(km/h). 정차·주차·체류 중이면 0 */
  get speedKmh(): number {
    if (this.state !== 'DRIVING' || this.arrived || this.dwellSec > 0) return 0;
    return this.baseKmh * this.speedFactor;
  }

  /** CarUxRestrictions: 주행 중이면 화면 제한이 켜진다 */
  get uxRestricted(): boolean {
    return this.speedKmh > 0;
  }

  get position(): LatLng {
    return pointAt(this.route, this.progressKm);
  }

  get remainingKm(): number {
    return Math.max(0, this.route.totalKm - this.progressKm);
  }

  /** 가상 시간 dtMs만큼 진행 */
  step(dtMs: number): { reachedWaypoint: boolean; arrived: boolean } {
    let dt = dtMs / 1000;
    const out = { reachedWaypoint: false, arrived: false };
    if (this.arrived || this.state !== 'DRIVING') return out;

    if (this.dwellSec > 0) {
      const used = Math.min(dt, this.dwellSec);
      this.dwellSec -= used;
      dt -= used;
      if (dt <= 0) return out;
    }

    // 지연이 0을 넘나들 때 정확히 멈추도록 잘라서 진행한다
    while (dt > 1e-9) {
      const f = this.speedFactor;
      let slice = dt;
      if (f !== 1) {
        const toZero = Math.abs(this.delaySec) / Math.abs(1 - f);
        slice = Math.min(slice, Math.max(toZero, 1e-6));
      }
      const before = this.progressKm;
      this.progressKm += (this.baseKmh * f * slice) / 3600;
      if (f !== 1) {
        this.delaySec -= (1 - f) * slice;
        if (Math.abs(this.delaySec) < 1e-6) this.delaySec = 0;
      }
      dt -= slice;

      if (this.waypoint && !this.waypointDone && before < this.waypoint.routeKm && this.progressKm >= this.waypoint.routeKm) {
        this.progressKm = this.waypoint.routeKm;
        this.waypointDone = true;
        this.dwellSec = (this.waypoint.detourMin + PICKUP_DWELL_MIN) * 60;
        out.reachedWaypoint = true;
        return out;
      }
      if (this.progressKm >= this.route.totalKm) {
        this.progressKm = this.route.totalKm;
        this.arrived = true;
        this.state = 'PARKED';
        out.arrived = true;
        return out;
      }
    }
    return out;
  }

  /**
   * 지금부터 sec초 뒤 차가 있을 경로 위치(km). step()과 같은 이동 모델(정체 50%·원활 125%·경유지 체류)로 앞날을 계산한다.
   * 정차 중이면 지금 다시 출발한다고 본다. 화면의 '주문 전송 지점' 핀에 쓴다.
   */
  kmAfter(sec: number): number {
    const total = this.route.totalKm;
    if (this.arrived) return total;
    const v = this.baseKmh / 3600;
    let t = Math.max(0, sec) - Math.min(Math.max(0, sec), this.dwellSec);
    let km = this.progressKm;
    let delay = this.delaySec;
    let wp = this.waypoint && !this.waypointDone ? this.waypoint : null;
    for (let i = 0; i < 1000 && t > 1e-6 && km < total; i++) {
      const f = delay > 0.5 ? JAM_FACTOR : delay < -0.5 ? FAST_FACTOR : 1;
      const slice = f === 1 ? t : Math.min(t, Math.abs(delay) / Math.abs(1 - f));
      const speed = v * f;
      if (wp && km + speed * slice >= wp.routeKm) {
        const dt = (wp.routeKm - km) / speed;
        km = wp.routeKm;
        t -= dt;
        if (f !== 1) delay -= (1 - f) * dt;
        t -= Math.min(t, (wp.detourMin + PICKUP_DWELL_MIN) * 60);
        wp = null;
        continue;
      }
      km += speed * slice;
      t -= slice;
      if (f !== 1) delay -= (1 - f) * slice;
    }
    return Math.min(km, total);
  }

  /** 경로 위 km 지점의 좌표 */
  pointAtKm(km: number): LatLng {
    return pointAt(this.route, km);
  }

  private baseSecFor(km: number): number {
    return (km / this.baseKmh) * 3600;
  }

  /** 최종 목적지(집) 도착 예정 */
  etaDestination(now: number): number {
    if (this.nav) return toSecond(now + Math.max(0, this.nav.remainSec * 1000 - (now - this.nav.at)));
    if (this.arrived) return now;
    let sec = this.baseSecFor(this.remainingKm) + this.delaySec + this.dwellSec;
    if (this.waypoint && !this.waypointDone) sec += (this.waypoint.detourMin + PICKUP_DWELL_MIN) * 60;
    return toSecond(now + Math.max(0, sec) * 1000);
  }

  /** 경유지(포장 매장) 도착 예정. 경유지가 없거나 이미 지났으면 null */
  etaWaypoint(now: number): number | null {
    if (!this.waypoint || this.waypointDone) return null;
    const km = Math.max(0, this.waypoint.routeKm - this.progressKm);
    const sec = this.baseSecFor(km) + this.waypoint.detourMin * 30 + Math.max(0, this.delaySec);
    return toSecond(now + sec * 1000);
  }

  /**
   * t 시각에 차가 경로 위 어디쯤(km) 있을지 예측한다. 지금부터 계속 달린다고 보고,
   * ETA 와 같은 규칙(정체 중 감속·원활 시 가속·경유지 체류)으로 복제한 차를 미리 달려 본다.
   * → '주문 전송 지점' 핀 위치. 같은 규칙이라 ETA·전송 시각과 어긋나지 않는다.
   */
  predictKmAt(now: number, t: number): number {
    if (t <= now || this.arrived) return this.progressKm;
    const c = new VirtualCar(this.route);
    c.baseKmh = this.baseKmh;
    c.progressKm = this.progressKm;
    c.delaySec = this.delaySec;
    c.waypoint = this.waypoint ? { ...this.waypoint } : null;
    c.waypointDone = this.waypointDone;
    c.dwellSec = this.dwellSec;
    c.state = 'DRIVING';
    let left = t - now;
    while (left > 0 && !c.arrived) {
      const slice = Math.min(left, 2_000);
      c.step(slice);
      left -= slice;
    }
    return c.progressKm;
  }

  /** 포장 매장을 경유지로 추가 (NaviHelper 경유지 추가 역할) */
  setWaypoint(storeId: string, name: string, pos: LatLng, detourMin: number): Waypoint {
    const { km } = projectOnRoute(this.route, pos);
    this.waypoint = { storeId, name, pos, routeKm: Math.max(km, this.progressKm), detourMin };
    this.waypointDone = false;
    return this.waypoint;
  }

  clearWaypoint(): void {
    this.waypoint = null;
    this.waypointDone = false;
    this.dwellSec = 0;
  }

  /** 정체 발생(+분) 또는 정체 해소·원활(−분) */
  addDelay(min: number): void {
    this.delaySec += min * 60;
  }

  clearDelay(): void {
    this.delaySec = 0;
  }

  setState(s: DriveState): void {
    if (this.arrived) return;
    this.state = s;
  }

  snapshot(now: number) {
    const etaDest = this.etaDestination(now);
    const etaWp = this.etaWaypoint(now);
    return {
      position: this.position,
      destination: { name: HOME.name, lat: HOME.lat, lng: HOME.lng },
      progressKm: round1(this.progressKm),
      totalKm: round1(this.route.totalKm),
      remainingKm: round1(this.nav ? this.nav.remainKm : this.remainingKm),
      // 'pleos' = 실제 차량 내비 값(NaviHelper), 'sim' = 가상 주행
      source: this.nav ? ('pleos' as const) : ('sim' as const),
      state: this.dwellSec > 0 ? ('PICKUP' as const) : this.state,
      speedKmh: Math.round(this.speedKmh),
      uxRestricted: this.uxRestricted,
      traffic: this.delaySec > 0.5 ? ('JAM' as const) : this.delaySec < -0.5 ? ('FAST' as const) : ('NORMAL' as const),
      delayMin: Math.round(this.delaySec / 6) / 10,
      etaDestination: etaDest,
      etaWaypoint: etaWp,
      waypoint: this.waypoint ? { ...this.waypoint, done: this.waypointDone } : null,
      arrived: this.arrived,
      routePoints: this.route.points,
    };
  }
}

/** 부동소수 오차로 19:40:00이 19:39:59.999가 되어 "19:39"로 보이는 일을 막는다 */
function toSecond(ts: number): number {
  return Math.round(ts / 1000) * 1000;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
