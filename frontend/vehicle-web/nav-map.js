// 내비 지도: 실제 지도 타일(위성 / 일반) 위에 경로·차·집·가게를 올린다.
// 실제 차량 내비처럼 세 가지 지도 모드를 둔다
// - 지도: 밝은 회색 지도(OpenStreetMap 타일을 회색조로 낮춤, 한글 지명)
// - 위성: Esri World Imagery + 도로·지명 겹침(하이브리드)
// - 위성만: 위성 사진만 (차량 내비의 '위성만' 모드)
// Leaflet(전역 L)은 index.html에서 불러온다. 타일을 못 받아도 경로·핀은 그대로 그려진다.
import { esc } from '/common/common.js';
import { ROAD, ROAD_KM, TURNS } from './road-route.js';

const R = (d) => (d * Math.PI) / 180;
export function distKm(a, b) {
  const h = Math.sin(R(b.lat - a.lat) / 2) ** 2 + Math.cos(R(a.lat)) * Math.cos(R(b.lat)) * Math.sin(R(b.lng - a.lng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

// 화면용 도로 경로의 누적 거리
const road = ROAD.map(([lat, lng]) => ({ lat, lng }));
const roadCum = [0];
for (let i = 1; i < road.length; i++) roadCum.push(roadCum[i - 1] + distKm(road[i - 1], road[i]));
const roadTotal = roadCum[roadCum.length - 1];

function roadAt(km) {
  const k = Math.max(0, Math.min(roadTotal, km));
  for (let i = 1; i < road.length; i++) {
    if (k <= roadCum[i]) {
      const seg = roadCum[i] - roadCum[i - 1];
      const t = seg ? (k - roadCum[i - 1]) / seg : 0;
      const a = road[i - 1], b = road[i];
      return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
    }
  }
  return road[road.length - 1];
}
function roadSlice(fromKm, toKm) {
  const out = [roadAt(fromKm)];
  for (let i = 0; i < road.length; i++) if (roadCum[i] > fromKm && roadCum[i] < toKm) out.push(road[i]);
  out.push(roadAt(toKm));
  return out.map((p) => [p.lat, p.lng]);
}
function bearing(a, b) {
  const y = Math.sin(R(b.lng - a.lng)) * Math.cos(R(b.lat));
  const x = Math.cos(R(a.lat)) * Math.sin(R(b.lat)) - Math.sin(R(a.lat)) * Math.cos(R(b.lat)) * Math.cos(R(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** 서버 진행 상황 → 화면 도로 위 위치(km). 서버 경로는 시간 계산용 직선 경로라 비율로 옮긴다 */
export function roadProgress(car) {
  const total = car.totalKm;
  const f = total ? Math.min(1, car.progressKm / total) : 0;
  return { km: f * ROAD_KM, f, serverTotal: total };
}

/** 다음 길 안내: 화살표 종류, 남은 거리, 길 이름 */
export function nextTurn(roadKm) {
  const t = TURNS.find((x) => x.km > roadKm + 0.03) ?? TURNS[TURNS.length - 1];
  return { ...t, inKm: Math.max(0, t.km - roadKm) };
}

// ───── 화살표 그림 (길 안내 카드) ─────
const ARROW = {
  straight: '<path d="M24 42V8M12 20 24 8l12 12"/>',
  start: '<path d="M24 42V8M12 20 24 8l12 12"/>',
  right: '<path d="M16 42V24a6 6 0 0 1 6-6h18M30 8l10 10-10 10"/>',
  left: '<path d="M32 42V24a6 6 0 0 0-6-6H8M18 8 8 18l10 10"/>',
  'keep-right': '<path d="M18 42V28l14-16M22 10h11v11"/><path d="M18 28V8" opacity=".35"/>',
  'exit-right': '<path d="M18 42V28l14-16M22 10h11v11"/><path d="M18 28V8" opacity=".35"/>',
  'keep-left': '<path d="M30 42V28L16 12M26 10H15v11"/><path d="M30 28V8" opacity=".35"/>',
  merge: '<path d="M14 42c0-12 10-14 10-24V8M14 18 24 8l10 10"/><path d="M34 42c0-8-6-12-10-16" opacity=".35"/>',
  uturn: '<path d="M32 42V18a8 8 0 0 0-16 0v14M8 26l8 8 8-8"/>',
  arrive: '<path d="M14 42V8M14 9h20l-5 7 5 7H14"/>',
};
export function arrowSvg(kind, size = 64) {
  return `<svg viewBox="0 0 48 48" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ARROW[kind] ?? ARROW.straight}</svg>`;
}
export const TURN_WORD = {
  straight: '직진', start: '출발', right: '우회전', left: '좌회전', 'keep-right': '오른쪽 길', 'exit-right': '오른쪽 출구',
  'keep-left': '왼쪽 길', merge: '합류', uturn: '유턴', arrive: '도착',
};
export const fmtDist = (km) => (km < 1 ? `${Math.max(10, Math.round((km * 1000) / 10) * 10)}m` : `${km.toFixed(1)}km`);

// ───── 지도 ─────
const LAYERS = {
  sat: () => [
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxNativeZoom: 19, maxZoom: 19, attribution: '위성 © Esri, Maxar, Earthstar Geographics',
    }),
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 19, maxZoom: 19, opacity: 0.85 }),
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 19, maxZoom: 19 }),
  ],
  satonly: () => [
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxNativeZoom: 19, maxZoom: 19, attribution: '위성 © Esri, Maxar, Earthstar Geographics',
    }),
  ],
  map: () => [
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap contributors',
    }),
  ],
};
/** 지도 모드 순서와 이름 (버튼을 누를 때마다 다음 모드) */
export const LAYER_ORDER = ['map', 'sat', 'satonly'];
export const LAYER_NAME = { map: '지도', sat: '위성', satonly: '위성만' };

/** 지금 달리는 길 이름 (지나온 마지막 안내 지점의 길) */
export function currentRoad(roadKm) {
  let road = '';
  for (const t of TURNS) if (t.km <= roadKm + 0.03 && t.road) road = t.road;
  return road;
}
/** 진행 방향(8방위) */
export function heading() {
  const d = view.heading ?? 0;
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(d / 45) % 8];
}

const EMOJI = { 치킨: '🍗', 피자: '🍕', 버거: '🍔', 분식: '🍢', 카페: '☕' };
/** 지도 아이콘 그림 (vehicle-web/img/icon) */
const PIN = { 치킨: 'store-chicken', 피자: 'store-pizza', 버거: 'store-burger', 분식: 'store-snack', 카페: 'store-cafe' };
const ico = (name) => `<img src="img/icon/${name}.webp" alt="" draggable="false" />`;
const view = { map: null, base: [], layer: 'sat', follow: false, fitKey: '', route: {}, marks: {}, stores: new Map() };
try {
  view.layer = localStorage.getItem('driveon.mapLayer') || 'map';
  view.follow = localStorage.getItem('driveon.mapFollow') === '1';
} catch {}

export function mapState() {
  return { layer: view.layer, follow: view.follow };
}

const icon = (html, cls, size, anchor) => L.divIcon({ html, className: `mk ${cls}`, iconSize: size, iconAnchor: anchor ?? [size[0] / 2, size[1] / 2] });

export function initMap(el) {
  if (!window.L) {
    el.innerHTML = '<div class="map-off">지도를 불러오지 못했어요 (인터넷 연결 확인)</div>';
    return false;
  }
  const map = L.map(el, { zoomControl: false, attributionControl: true, zoomSnap: 0.25, fadeAnimation: true });
  map.attributionControl.setPrefix(false);
  view.map = map;
  setLayer(view.layer);
  const line = (cls) => L.polyline([], { className: cls, interactive: false });
  view.route = {
    casing: line('rt-casing').addTo(map),
    all: line('rt-all').addTo(map),
    done: line('rt-done').addTo(map),
    jam: line('rt-jam').addTo(map),
  };
  view.route.casing.setLatLngs(ROAD);
  view.route.all.setLatLngs(ROAD);
  view.marks.office = L.marker(ROAD[0], { icon: icon(ico('office'), 'place', [44, 44]), interactive: false, zIndexOffset: 100 }).addTo(map);
  view.marks.home = L.marker(ROAD[ROAD.length - 1], { icon: icon(`${ico('home')}<b>집</b>`, 'place home', [48, 48]), interactive: false, zIndexOffset: 200 }).addTo(map);
  view.marks.car = L.marker(ROAD[0], { icon: icon(`<i>${ico('car')}</i>`, 'car', [52, 52]), interactive: false, zIndexOffset: 1000 }).addTo(map);
  map.fitBounds(L.latLngBounds(ROAD), { padding: [30, 30] });
  // 화면 나눔이 바뀌면(주문 뒤 내비가 넓어짐) 지도 크기를 다시 잡는다
  new ResizeObserver(() => {
    map.invalidateSize();
    view.fitKey = '';
  }).observe(el);
  // 손으로 지도를 움직이면 따라가기를 멈춘다
  map.on('dragstart', () => {
    if (view.follow) setFollow(false);
  });
  return true;
}

export function setLayer(k) {
  if (!view.map || !LAYERS[k]) return;
  view.base.forEach((l) => l.remove());
  view.base = LAYERS[k]().map((l) => l.addTo(view.map));
  view.base.forEach((l) => l.bringToBack?.());
  view.layer = k;
  view.map.getContainer().dataset.layer = k;
  try { localStorage.setItem('driveon.mapLayer', k); } catch {}
}
export function setFollow(on) {
  view.follow = on;
  view.fitKey = '';
  try { localStorage.setItem('driveon.mapFollow', on ? '1' : '0'); } catch {}
  document.dispatchEvent(new CustomEvent('driveon:mapview'));
}
export function zoomBy(d) {
  view.map?.setZoom(view.map.getZoom() + d);
}
/** 축척 표시: 60px이 실제로 몇 m인지 보기 좋은 숫자로 (차량 내비의 'Auto 50 m') */
export function scaleLabel() {
  const m = view.map;
  if (!m) return '';
  const lat = m.getCenter().lat;
  const meters = ((156543.03 * Math.cos((lat * Math.PI) / 180)) / 2 ** m.getZoom()) * 60;
  const nice = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000].find((n) => n >= meters) ?? 10000;
  return nice >= 1000 ? `${nice / 1000} km` : `${nice} m`;
}
export function onMapZoom(fn) {
  view.map?.on('zoomend', fn);
}

/** 서버 경로 km → 화면 도로 km */
export const toRoadKm = (km, car) => (car.totalKm ? (km / car.totalKm) * ROAD_KM : 0);

/**
 * '주문 전송 지점' 핀: 매장 전송 시각에 차가 있을 자리.
 * 정체로 전송 지점이 바뀌면 원래 자리에 흐린 핀을 잠깐 남기고 점선으로 이어 '밀렸다'를 보여 준다.
 */
const hhmmFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false });
function drawDispatch(dp, car) {
  const map = view.map;
  const d = (view.dispatch ??= { marker: null, ghost: null, link: null, lastKm: null, orderId: null, timer: 0, lastAt: null, prevAt: null, shiftUntil: 0 });
  if (!dp) {
    d.marker?.remove();
    d.ghost?.remove();
    d.link?.remove();
    Object.assign(d, { marker: null, ghost: null, link: null, lastKm: null, orderId: null });
    return;
  }
  const km = Math.min(roadTotal, toRoadKm(dp.routeKm, car));
  const p = roadAt(km);
  // 전송 시각이 1분 넘게 바뀌면 6초 동안 '이전 → 새 시각'을 함께 보여 준다
  if (d.orderId === dp.orderId && d.lastAt != null && Math.abs(dp.at - d.lastAt) >= 60_000 && !dp.sent) {
    d.prevAt = d.lastAt;
    d.shiftUntil = Date.now() + 6000;
    setTimeout(() => window.dispatchEvent(new Event('driveon:redraw')), 6100);
  }
  d.lastAt = dp.at;
  const shifting = Date.now() < d.shiftUntil && d.prevAt != null;
  const time = (shifting ? `<s>${hhmmFmt.format(d.prevAt)}</s><i>→</i>` : '') + hhmmFmt.format(dp.at);
  const html = `<span class="pole"></span><span class="flag"><span class="ic">${dp.sent ? '✅' : '📤'}</span><b>${time}</b><small>${dp.sent ? '주문 전송됨' : '여기서 주문 전송'}</small></span>`;
  const ic = L.divIcon({ html, className: `mk dispatch${dp.sent ? ' sent' : ''}${shifting ? ' shift' : ''}`, iconSize: [0, 0], iconAnchor: [0, 0] });
  if (!d.marker || d.orderId !== dp.orderId) {
    d.marker?.remove();
    d.marker = L.marker([p.lat, p.lng], { icon: ic, interactive: false, zIndexOffset: 1200 }).addTo(map);
    d.marker._html = html;
    d.orderId = dp.orderId;
    d.lastKm = km;
    return;
  }
  if (d.marker._html !== html) (d.marker.setIcon(ic), (d.marker._html = html));
  // 0.3km 넘게 움직이면 원래 자리를 흐리게 남긴다 (정체 → 전송 지점 이동)
  if (!dp.sent && d.lastKm != null && Math.abs(km - d.lastKm) > 0.3) {
    const old = roadAt(d.lastKm);
    d.ghost?.remove();
    d.link?.remove();
    d.ghost = L.marker([old.lat, old.lng], {
      icon: L.divIcon({ html: '<span class="pole"></span><span class="flag"><span class="ic">📤</span><s>전</s></span>', className: 'mk dispatch ghost', iconSize: [0, 0], iconAnchor: [0, 0] }),
      interactive: false, zIndexOffset: 1100,
    }).addTo(map);
    d.link = L.polyline(roadSlice(Math.min(km, d.lastKm), Math.max(km, d.lastKm)), { className: 'rt-shift', interactive: false }).addTo(map);
    clearTimeout(d.timer);
    d.timer = setTimeout(() => {
      d.ghost?.remove();
      d.link?.remove();
      d.ghost = d.link = null;
    }, 6000);
  }
  if (Math.abs(km - (d.lastKm ?? km)) > 0.005) d.marker.setLatLng([p.lat, p.lng]);
  d.lastKm = km;
}

/** 상태가 올 때마다: 차 위치·진행 경로·정체 구간·가게 핀을 옮긴다 */
export function updateMap(st) {
  const map = view.map;
  if (!map) return;
  const c = st.car;
  const { km, serverTotal } = roadProgress(c);
  // 실제 내비(Pleos)가 현재 위치·방향을 주면 차 표시는 그 자리에, 아니면 가상 경로 위에
  const real = c.navPos;
  const pos = real ? { lat: real.lat, lng: real.lng } : roadAt(km);
  const ahead = roadAt(km + 0.15);
  const deg = real ? real.heading : km >= roadTotal - 0.01 ? 0 : bearing(pos, ahead);

  view.route.done.setLatLngs(km > 0.01 ? roadSlice(0, km) : []);
  const jamKm = serverTotal ? (3 / serverTotal) * ROAD_KM : 0;
  view.route.jam.setLatLngs(c.traffic === 'JAM' ? roadSlice(km, Math.min(roadTotal, km + jamKm)) : []);
  view.marks.car.setLatLng([pos.lat, pos.lng]);
  const ci = view.marks.car.getElement()?.querySelector('i');
  if (ci) ci.style.transform = `rotate(${deg.toFixed(0)}deg)`;
  view.heading = deg;

  // 가게 핀: 호출 화면 카드와 같은 번호 + 음식 그림
  const h = st.session.home;
  const stores = [...h.nearHome, ...h.onTheWay];
  const selId = st.session.store?.id;
  const wpId = c.waypoint && !c.waypoint.done ? c.waypoint.storeId : null;
  const seen = new Set();
  stores.forEach((s, i) => {
    seen.add(s.storeId);
    const sel = s.storeId === selId;
    const key = `${i}|${sel}|${s.storeId === wpId}`;
    let m = view.stores.get(s.storeId);
    const html = `${PIN[s.category] ? ico(PIN[s.category]) : `<span class="em">${EMOJI[s.category] ?? '🍽'}</span>`}<b class="no">${i + 1}</b>${sel ? `<em>${esc(s.name)}</em>` : ''}${s.storeId === wpId ? '<span class="wp">🚩</span>' : ''}`;
    // 물방울 핀 그림: 아래 뾰족한 끝이 가게 자리
    const sz = sel ? [56, 64] : [42, 48];
    const ic = icon(html, `store${sel ? ' sel' : ''}`, sz, [sz[0] / 2, sz[1] - 2]);
    if (!m) {
      m = L.marker([s.pos.lat, s.pos.lng], { icon: ic, zIndexOffset: sel ? 900 : 300 }).addTo(map);
      m.on('click', () => document.dispatchEvent(new CustomEvent('driveon:storepin', { detail: m._storeId })));
      view.stores.set(s.storeId, m);
    } else if (m._key !== key) {
      m.setIcon(ic);
      m.setZIndexOffset(sel ? 900 : 300);
    }
    m._key = key;
    m._storeId = s.storeId;
  });
  for (const [id, m] of view.stores) if (!seen.has(id)) (m.remove(), view.stores.delete(id));

  drawDispatch(st.dispatchPoint, c);

  if (view.follow) {
    map.setView([pos.lat, pos.lng], Math.max(map.getZoom(), 15.5), { animate: true });
  } else {
    // 전체 보기: 경로 + 가게가 다 보이게. 가게 목록이 바뀔 때만 다시 맞춘다
    const key = stores.map((s) => s.storeId).join(',') + (real ? '|real' : '');
    if (key !== view.fitKey) {
      view.fitKey = key;
      const b = L.latLngBounds(ROAD);
      if (real) b.extend([real.lat, real.lng]);
      stores.forEach((s) => b.extend([s.pos.lat, s.pos.lng]));
      map.fitBounds(b, { padding: [40, 40], animate: false });
    }
  }
}
