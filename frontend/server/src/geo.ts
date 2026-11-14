export interface LatLng {
  lat: number;
  lng: number;
}

const R_KM = 6371;
const rad = (d: number) => (d * Math.PI) / 180;

/** 두 좌표의 직선거리(km, haversine) */
export function distKm(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.sqrt(h));
}

export interface Route {
  points: LatLng[];
  /** points[i]까지의 누적 거리(km) */
  cumKm: number[];
  totalKm: number;
}

export function makeRoute(points: LatLng[]): Route {
  const cumKm = [0];
  for (let i = 1; i < points.length; i++) cumKm.push(cumKm[i - 1] + distKm(points[i - 1], points[i]));
  return { points, cumKm, totalKm: cumKm[cumKm.length - 1] };
}

/** 경로 시작점에서 km만큼 간 지점 */
export function pointAt(route: Route, km: number): LatLng {
  const k = Math.max(0, Math.min(route.totalKm, km));
  for (let i = 1; i < route.points.length; i++) {
    if (k <= route.cumKm[i]) {
      const seg = route.cumKm[i] - route.cumKm[i - 1];
      const t = seg === 0 ? 0 : (k - route.cumKm[i - 1]) / seg;
      const a = route.points[i - 1];
      const b = route.points[i];
      return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
    }
  }
  return route.points[route.points.length - 1];
}

/** 점 p를 경로에 투영: 경로 위 위치(km)와 경로에서 떨어진 거리(km) */
export function projectOnRoute(route: Route, p: LatLng): { km: number; offsetKm: number } {
  // 짧은 거리라 위경도를 평면(km)으로 근사한다.
  const kx = 111.32 * Math.cos(rad(p.lat));
  const ky = 110.57;
  let best = { km: 0, offsetKm: Infinity };
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1];
    const b = route.points[i];
    const ax = (a.lng - p.lng) * kx, ay = (a.lat - p.lat) * ky;
    const bx = (b.lng - p.lng) * kx, by = (b.lat - p.lat) * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    const cx = ax + dx * t, cy = ay + dy * t;
    const off = Math.hypot(cx, cy);
    if (off < best.offsetKm) {
      const seg = route.cumKm[i] - route.cumKm[i - 1];
      best = { km: route.cumKm[i - 1] + seg * t, offsetKm: off };
    }
  }
  return best;
}
