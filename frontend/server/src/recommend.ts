import { distKm, type LatLng } from './geo.ts';
import { STORES, type Category, type PastOrder, type Store, findStore, metaOf } from './world.ts';

/**
 * 호출 화면 데이터 (설계서 4-0).
 *  1) 최근 주문 3건   2) 집(내비 목적지) 반경 2km 가게   3) 가는 길 우회 5분 이내 가게
 * 위치는 직선거리로 1차 필터만 한다(GPS·Fused Location 역할).
 */
export const NEAR_HOME_KM = 2;
export const ON_THE_WAY_MAX_DETOUR_MIN = 5;
export const GROUP_LIMIT = 3;
/** 직선거리 → 도로거리 보정, 시내 평균 속도 */
const ROAD_FACTOR = 1.3;
const URBAN_KMH = 30;

export function detourMin(cur: LatLng, store: LatLng, dest: LatLng): number {
  const extraKm = distKm(cur, store) + distKm(store, dest) - distKm(cur, dest);
  return Math.max(0, Math.round(((extraKm * ROAD_FACTOR) / URBAN_KMH) * 60));
}

export interface StoreCard {
  storeId: string;
  name: string;
  category: Category;
  pos: LatLng;
  distanceFromHomeKm: number;
  detourMin: number;
  topItems: { id: string; name: string; price: number }[];
  /** 배달앱식 가게 정보 */
  rating: number;
  reviews: number;
  deliveryTip: number;
  minOrder: number;
  /** 대표 메뉴 조리 시간(분) */
  prepMin: number;
}

export interface RecentCard {
  storeId: string;
  storeName: string;
  mode: PastOrder['mode'];
  items: { itemId: string; name: string; qty: number; optionIds: string[] }[];
  total: number;
  orderedAt: number;
}

export interface HomeData {
  recent: RecentCard[];
  nearHome: StoreCard[];
  onTheWay: StoreCard[];
}

function storeCard(s: Store, cur: LatLng, dest: LatLng): StoreCard {
  const top = s.items.filter((i) => i.popular).concat(s.items.filter((i) => !i.popular)).slice(0, 2);
  return {
    storeId: s.id,
    name: s.name,
    category: s.category,
    pos: s.pos,
    distanceFromHomeKm: Math.round(distKm(s.pos, dest) * 10) / 10,
    detourMin: detourMin(cur, s.pos, dest),
    topItems: top.map((i) => ({ id: i.id, name: i.name, price: i.price })),
    ...metaOf(s.id),
    prepMin: top[0]?.prepMin ?? 0,
  };
}

export function priceOf(storeId: string, line: { itemId: string; qty: number; optionIds: string[] }): number {
  const s = findStore(storeId);
  const item = s?.items.find((i) => i.id === line.itemId);
  if (!s || !item) return 0;
  const opt = line.optionIds.reduce((sum, id) => sum + (s.options.find((o) => o.id === id)?.price ?? 0), 0);
  return (item.price + opt) * line.qty;
}

export function recentCard(o: PastOrder): RecentCard | null {
  const s = findStore(o.storeId);
  if (!s) return null;
  return {
    storeId: s.id,
    storeName: s.name,
    mode: o.mode,
    items: o.items.map((l) => ({ ...l, name: s.items.find((i) => i.id === l.itemId)?.name ?? l.itemId })),
    total: o.items.reduce((sum, l) => sum + priceOf(s.id, l), 0),
    orderedAt: o.orderedAt,
  };
}

export function buildHome(cur: LatLng, dest: LatLng, recent: PastOrder[], category?: Category): HomeData {
  const inCat = (s: Store) => !category || s.category === category;

  const recentCards = [...recent]
    .sort((a, b) => b.orderedAt - a.orderedAt)
    .filter((o) => inCat(findStore(o.storeId)!))
    .slice(0, GROUP_LIMIT)
    .map(recentCard)
    .filter((c): c is RecentCard => c !== null);

  const nearHome = STORES.filter((s) => inCat(s) && distKm(s.pos, dest) <= NEAR_HOME_KM)
    .sort((a, b) => distKm(a.pos, dest) - distKm(b.pos, dest))
    .slice(0, GROUP_LIMIT)
    .map((s) => storeCard(s, cur, dest));
  const nearIds = new Set(nearHome.map((c) => c.storeId));

  const remainingKm = distKm(cur, dest);
  const onTheWay = STORES.filter(
    (s) =>
      inCat(s) &&
      !nearIds.has(s.id) &&
      distKm(s.pos, dest) < remainingKm - 0.3 && // 아직 지나치지 않은(앞쪽) 가게
      detourMin(cur, s.pos, dest) <= ON_THE_WAY_MAX_DETOUR_MIN,
  )
    .map((s) => storeCard(s, cur, dest))
    .sort((a, b) => a.detourMin - b.detourMin)
    .slice(0, GROUP_LIMIT);

  return { recent: recentCards, nearHome, onTheWay };
}
