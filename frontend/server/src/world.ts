import { makeRoute, type LatLng } from './geo.ts';
import { kst } from './time.ts';

/**
 * 시연용 가상 데이터. 실제 브랜드 상표 문제를 피하려고 매장명은 모두 가상이다
 * (설계서 9번 '가상 매장명' 항목).
 */

export type Category = '치킨' | '피자' | '버거' | '분식' | '카페';
export const CATEGORIES: Category[] = ['치킨', '피자', '버거', '분식', '카페'];

export interface MenuOption {
  id: string;
  name: string;
  price: number;
  /** 음료 여부(“음료 추가할까요?” 질문에 사용) */
  drink?: boolean;
}

export interface MenuItem {
  id: string;
  name: string;
  price: number;
  /** 조리 시간(분) */
  prepMin: number;
  /** 음성 인식용 별칭(띄어쓰기 없이) */
  aliases?: string[];
  popular?: boolean;
}

export interface Store {
  id: string;
  name: string;
  category: Category;
  pos: LatLng;
  /** 매장 → 집 배달 시간(분). 데모는 고정값 */
  deliveryMin: number;
  items: MenuItem[];
  options: MenuOption[];
}

export const OFFICE: LatLng & { name: string } = { name: '회사(강남역)', lat: 37.4979, lng: 127.0276 };
export const HOME: LatLng & { name: string } = { name: '집(정자동)', lat: 37.3655, lng: 127.112 };

/** 회사 → 집 퇴근 경로(가상 내비 경로) */
export const ROUTE = makeRoute([
  OFFICE,
  { lat: 37.4846, lng: 127.0342 }, // 양재역
  { lat: 37.47, lng: 127.04 }, // 양재IC
  { lat: 37.44, lng: 127.07 },
  { lat: 37.4, lng: 127.1 }, // 판교IC
  { lat: 37.385, lng: 127.123 }, // 서현
  { lat: 37.37, lng: 127.115 },
  HOME,
]);

/** 시연 차량(가상 번호판). 포장 주문일 때만 매장에 전달한다 */
export const VEHICLE = {
  plate: '12가 3456',
  model: '그랜저',
  /** Pleos 상태바의 프로필 선택에 해당하는 운전자 프로필(결제 인증에 함께 쓴다) */
  profile: '운전자 1',
};

/** 시연 기준: 18:55 출발, 막힘 없으면 19:40 도착(45분) */
export const BASE_TRIP_MIN = 45;

const chickenOptions: MenuOption[] = [
  { id: 'o1', name: '콜라 1.25L', price: 2500, drink: true },
  { id: 'o2', name: '사이다 1.25L', price: 2500, drink: true },
  { id: 'o3', name: '치즈볼', price: 4000 },
  { id: 'o4', name: '감자튀김', price: 3500 },
];
const pizzaOptions: MenuOption[] = [
  { id: 'o1', name: '콜라 1.25L', price: 2500, drink: true },
  { id: 'o5', name: '갈릭디핑소스', price: 500 },
  { id: 'o6', name: '치즈크러스트', price: 3000 },
];
const basicDrinks: MenuOption[] = [{ id: 'o7', name: '콜라 500ml', price: 2000, drink: true }];

export const STORES: Store[] = [
  {
    id: 's01', name: '바삭마요치킨 정자점', category: '치킨', pos: { lat: 37.36, lng: 127.106 }, deliveryMin: 10,
    items: [
      { id: 'm01', name: '고추마요치킨', price: 19900, prepMin: 20, aliases: ['고추마요'], popular: true },
      { id: 'm02', name: '청양마요치킨', price: 21900, prepMin: 20, aliases: ['청양마요', '청양'], popular: true },
      { id: 'm03', name: '후라이드치킨', price: 17000, prepMin: 18, aliases: ['후라이드', '프라이드'] },
      { id: 'm04', name: '양념치킨', price: 18500, prepMin: 18, aliases: ['양념'] },
      { id: 'm05', name: '반반치킨', price: 19000, prepMin: 18, aliases: ['반반', '반반무많이'] },
    ],
    options: chickenOptions,
  },
  {
    id: 's02', name: '꼬꼬닭 정자역점', category: '치킨', pos: { lat: 37.353, lng: 127.105 }, deliveryMin: 12,
    items: [
      { id: 'm11', name: '간장치킨', price: 19000, prepMin: 22, aliases: ['간장'], popular: true },
      { id: 'm12', name: '마늘치킨', price: 20000, prepMin: 22, aliases: ['마늘'] },
      { id: 'm13', name: '후라이드치킨', price: 17500, prepMin: 18, aliases: ['후라이드', '프라이드'], popular: true },
    ],
    options: chickenOptions,
  },
  {
    id: 's03', name: '길목치킨 판교점', category: '치킨', pos: { lat: 37.41, lng: 127.118 }, deliveryMin: 25,
    items: [
      { id: 'm21', name: '숯불바베큐치킨', price: 20500, prepMin: 22, aliases: ['숯불', '바베큐'], popular: true },
      { id: 'm22', name: '후라이드치킨', price: 17000, prepMin: 18, aliases: ['후라이드', '프라이드'] },
      { id: 'm23', name: '고추마요치킨', price: 19500, prepMin: 20, aliases: ['고추마요'] },
    ],
    options: chickenOptions,
  },
  {
    id: 's04', name: '도우앤도우 피자 서현점', category: '피자', pos: { lat: 37.387, lng: 127.126 }, deliveryMin: 15,
    items: [
      { id: 'm31', name: '페퍼로니피자', price: 18900, prepMin: 15, aliases: ['페퍼로니'], popular: true },
      { id: 'm32', name: '불고기피자', price: 21900, prepMin: 15, aliases: ['불고기'] },
      { id: 'm33', name: '포테이토피자', price: 22900, prepMin: 16, aliases: ['포테이토', '감자피자'] },
    ],
    options: pizzaOptions,
  },
  {
    id: 's05', name: '정자동 화덕피자', category: '피자', pos: { lat: 37.364, lng: 127.117 }, deliveryMin: 8,
    items: [
      { id: 'm41', name: '마르게리따', price: 17000, prepMin: 12, aliases: ['마르게리타', '마르게리따'], popular: true },
      { id: 'm42', name: '고르곤졸라', price: 18000, prepMin: 12, aliases: ['고르곤졸라'] },
    ],
    options: pizzaOptions,
  },
  {
    id: 's06', name: '버거하우스 양재점', category: '버거', pos: { lat: 37.483, lng: 127.036 }, deliveryMin: 35,
    items: [
      { id: 'm51', name: '더블치즈버거', price: 9800, prepMin: 8, aliases: ['더블치즈', '치즈버거'], popular: true },
      { id: 'm52', name: '베이컨버거', price: 9500, prepMin: 8, aliases: ['베이컨'] },
    ],
    options: basicDrinks,
  },
  {
    id: 's07', name: '분식왕 정자점', category: '분식', pos: { lat: 37.368, lng: 127.11 }, deliveryMin: 7,
    items: [
      { id: 'm61', name: '떡볶이', price: 5000, prepMin: 10, popular: true },
      { id: 'm62', name: '김밥', price: 3500, prepMin: 5 },
      { id: 'm63', name: '순대', price: 5000, prepMin: 7 },
      { id: 'm64', name: '모둠튀김', price: 5500, prepMin: 10, aliases: ['튀김'] },
    ],
    options: basicDrinks,
  },
  {
    id: 's08', name: '판교 떡볶이공방', category: '분식', pos: { lat: 37.396, lng: 127.108 }, deliveryMin: 18,
    items: [
      { id: 'm71', name: '로제떡볶이', price: 7000, prepMin: 12, aliases: ['로제'], popular: true },
      { id: 'm72', name: '떡볶이', price: 5500, prepMin: 10 },
    ],
    options: basicDrinks,
  },
  {
    id: 's09', name: '모닝브루 커피 서현점', category: '카페', pos: { lat: 37.384, lng: 127.121 }, deliveryMin: 12,
    items: [
      { id: 'm81', name: '아이스 아메리카노', price: 4500, prepMin: 3, aliases: ['아메리카노', '아아'], popular: true },
      { id: 'm82', name: '카페라떼', price: 5000, prepMin: 4, aliases: ['라떼'] },
    ],
    options: [],
  },
  {
    id: 's10', name: '한강치킨 마포점', category: '치킨', pos: { lat: 37.54, lng: 126.945 }, deliveryMin: 60,
    items: [{ id: 'm91', name: '후라이드치킨', price: 16000, prepMin: 18, aliases: ['후라이드'] }],
    options: chickenOptions,
  },
];

/** 배달앱식 가게 정보(가상 값): 별점·리뷰 수·배달팁·최소주문금액 */
export interface StoreMeta {
  rating: number;
  reviews: number;
  /** 배달팁(원). 포장이면 받지 않는다 */
  deliveryTip: number;
  /** 배달 최소주문금액(원). 포장에는 적용하지 않는다 */
  minOrder: number;
}

const STORE_META: Record<string, StoreMeta> = {
  s01: { rating: 4.9, reviews: 2381, deliveryTip: 0, minOrder: 15000 },
  s02: { rating: 4.7, reviews: 1204, deliveryTip: 2000, minOrder: 16000 },
  s03: { rating: 4.8, reviews: 856, deliveryTip: 3000, minOrder: 15000 },
  s04: { rating: 4.6, reviews: 642, deliveryTip: 2500, minOrder: 18000 },
  s05: { rating: 4.9, reviews: 410, deliveryTip: 1000, minOrder: 15000 },
  s06: { rating: 4.5, reviews: 330, deliveryTip: 3000, minOrder: 12000 },
  s07: { rating: 4.8, reviews: 1530, deliveryTip: 1500, minOrder: 10000 },
  s08: { rating: 4.7, reviews: 512, deliveryTip: 2000, minOrder: 12000 },
  s09: { rating: 4.6, reviews: 280, deliveryTip: 2000, minOrder: 8000 },
  s10: { rating: 4.4, reviews: 95, deliveryTip: 3000, minOrder: 16000 },
};

export function metaOf(storeId: string): StoreMeta {
  return STORE_META[storeId] ?? { rating: 0, reviews: 0, deliveryTip: 0, minOrder: 0 };
}

/** 메뉴 한 줄 설명(배달앱 메뉴판 형식). 없는 메뉴는 설명 없이 보여 준다 */
export const ITEM_DESC: Record<string, string> = {
  m01: '고추의 알싸함과 마요의 고소함',
  m02: '청양고추로 더 화끈하게',
  m03: '겉바속촉 기본 후라이드',
  m04: '달콤 매콤 수제 양념',
  m05: '후라이드 반 + 양념 반',
  m11: '짭조름한 간장 소스',
  m12: '통마늘을 듬뿍',
  m21: '숯불에 구운 바베큐 소스',
  m31: '페퍼로니 듬뿍 오리지널',
  m41: '화덕에서 구운 토마토 피자',
  m61: '국물 자작한 옛날 떡볶이',
  m71: '크림과 고추장의 로제 소스',
};

/** 인카페이먼트에 등록된 카드(시연용 가상 카드) */
export interface PayCard {
  id: string;
  issuer: string;
  name: string;
  last4: string;
}
export const PAY_CARDS: PayCard[] = [
  { id: 'hc1', issuer: '현대카드', name: '현대카드 개인', last4: '1234' },
  { id: 'hc2', issuer: '현대카드', name: '현대카드 가족', last4: '5678' },
];
export function findCard(id: string | undefined): PayCard {
  return PAY_CARDS.find((c) => c.id === id) ?? PAY_CARDS[0];
}

export function findStore(id: string): Store | undefined {
  return STORES.find((s) => s.id === id);
}

export interface OrderLineInput {
  itemId: string;
  qty: number;
  optionIds: string[];
}

export type Mode = 'DELIVERY' | 'PICKUP';

export interface PastOrder {
  /** 이 서버에서 만든 주문이면 그 id (취소되면 최근 주문에서 뺀다) */
  orderId?: string;
  storeId: string;
  items: OrderLineInput[];
  mode: Mode;
  orderedAt: number;
}

/** 시연 시작 시점의 주문 이력: “지난번 고추마요” */
export function seedRecentOrders(): PastOrder[] {
  return [
    { storeId: 's01', items: [{ itemId: 'm01', qty: 1, optionIds: [] }], mode: 'DELIVERY', orderedAt: kst(2026, 11, 7, 19, 20) },
    { storeId: 's04', items: [{ itemId: 'm31', qty: 1, optionIds: ['o1'] }], mode: 'PICKUP', orderedAt: kst(2026, 10, 31, 19, 5) },
  ];
}
