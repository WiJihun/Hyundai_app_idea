import { api, connect, esc, hhmm, won, MODE, patch } from '/common/common.js';
import { initMap, updateMap, setLayer, setFollow, zoomBy, mapState, roadProgress, toRoadKm, nextTurn, arrowSvg, TURN_WORD, fmtDist, LAYER_ORDER, LAYER_NAME, currentRoad, heading, scaleLabel, onMapZoom } from './nav-map.js';
import { ROAD_KM } from './road-route.js';

const $ = (id) => document.getElementById(id);
const EMOJI = { 치킨: '🍗', 피자: '🍕', 버거: '🍔', 분식: '🍢', 카페: '☕' };
const CAT_BG = { 치킨: 'chicken', 피자: 'pizza', 버거: 'burger', 분식: 'snack', 카페: 'cafe' };

/**
 * 음식 그림: 메뉴 이름으로 그림(이모지)과 맛 표시를 고른다.
 * 정차 중 한눈에 고를 수 있게 글보다 그림을 먼저 보여 준다.
 */
const FOOD = [
  [/콜라|사이다/, '🥤'], [/감자튀김/, '🍟'], [/치즈볼|치즈크러스트/, '🧀'], [/갈릭|디핑/, '🧄'],
  [/아메리카노/, '🧋'], [/라떼|커피/, '☕'], [/김밥/, '🍙'], [/순대/, '🌭'], [/튀김/, '🍤'],
  [/떡볶이/, '🍢'], [/버거/, '🍔'], [/피자|마르게리따|고르곤졸라/, '🍕'], [/치킨/, '🍗'],
];
const FLAVOR = [[/청양|고추|양념|로제/, '🌶️'], [/마늘|갈릭/, '🧄'], [/숯불|바베큐/, '🔥'], [/간장/, '🍯'], [/치즈/, '🧀'], [/페퍼로니/, '🥓'], [/불고기/, '🥩'], [/포테이토/, '🥔'], [/베이컨/, '🥓'], [/반반/, '½']];
function foodEmoji(name, category) {
  return FOOD.find(([re]) => re.test(name))?.[1] ?? EMOJI[category] ?? '🍽';
}
/**
 * 메뉴 사진 (배경을 지운 그림, vehicle-web/img/menu). 사진이 없는 메뉴는 이모지로 대신한다.
 * 이름은 정확히 같거나 앞뒤 공백·크기만 다른 경우를 함께 찾는다.
 */
const PHOTO = {
  고추마요치킨: 'chicken-gochu-mayo', 청양마요치킨: 'chicken-cheongyang-mayo', 후라이드치킨: 'chicken-fried', 양념치킨: 'chicken-yangnyeom',
  반반치킨: 'chicken-banban', 간장치킨: 'chicken-ganjang', 마늘치킨: 'chicken-garlic', 숯불바베큐치킨: 'chicken-bbq',
  페퍼로니피자: 'pizza-pepperoni', 불고기피자: 'pizza-bulgogi', 포테이토피자: 'pizza-potato', 마르게리따: 'pizza-margherita', 고르곤졸라: 'pizza-gorgonzola',
  더블치즈버거: 'burger-double-cheese', 베이컨버거: 'burger-bacon',
  '아이스 아메리카노': 'cafe-iced-americano', 카페라떼: 'cafe-latte',
  '콜라 1.25L': 'side-cola-large', '사이다 1.25L': 'side-cider-large', '콜라 500ml': 'side-cola-small',
  치즈볼: 'side-cheese-ball', 감자튀김: 'side-fries', 갈릭디핑소스: 'side-garlic-dip', 치즈크러스트: 'side-cheese-crust',
};
/** 메뉴는 없어도 카테고리 대표 사진(떡볶이 = 분식 사진)으로 쓸 수 있는 것 */
const PHOTO_BY_CAT = { 떡볶이: 'snack' };
const CAT_PHOTO = { 치킨: 'chicken', 피자: 'pizza', 버거: 'burger', 분식: 'snack', 카페: 'cafe' };
const catImg = (category) => (CAT_PHOTO[category] ? `img/cat/${CAT_PHOTO[category]}.webp` : null);
function photoOf(name) {
  if (PHOTO[name]) return `img/menu/${PHOTO[name]}.webp`;
  if (PHOTO_BY_CAT[name]) return `img/cat/${PHOTO_BY_CAT[name]}.webp`;
  return null;
}
/** 음식 그림 칸: 사진(없으면 큰 이모지 + 맛 표시) + (담은 개수) */
function art(name, category, { size = '', qty = 0, flavor = true } = {}) {
  const src = photoOf(name);
  const fl = !src && flavor ? FLAVOR.find(([re]) => re.test(name))?.[1] : null;
  const pic = src
    ? `<img class="ph" src="${src}" alt="" draggable="false" />`
    : `<span class="em">${foodEmoji(name, category)}</span>`;
  return `<span class="art ${CAT_BG[category] ?? ''} ${size} ${src ? 'photo' : ''}" aria-hidden="true">${pic}${fl ? `<span class="fl">${fl}</span>` : ''}${qty ? `<span class="qty">${qty}</span>` : ''}</span>`;
}
const STATE_LABEL = { DRIVING: '주행 중', STOPPED: '정차 중', PARKED: '주차', PICKUP: '매장 수령 중' };

/** data-act 속성: 클릭하면 같은 의도로 서버에 보낸다(터치 = 음성과 같은 흐름) */
const A = (o) => `data-act="${esc(JSON.stringify(o))}"`;

// ───────── Pleos 차량 앱 안에서 실행 중이면 음성·내비를 차량 SDK로 ─────────
// 차량 앱(vehicle-app)의 WebView가 window.DriveOnNative를 넣어 준다:
//   listen()/stopListening() = Pleos SpeechToText, speak()/stopSpeaking() = Pleos TextToSpeech,
//   setWaypoint()/clearWaypoint() = NaviHelper 경유지, openNavi() = Pleos 내비 화면
const NATIVE = window.DriveOnNative ?? null;

// ───────── 음성 안내(TTS) ─────────
let ttsOn = true;
try { ttsOn = localStorage.getItem('driveon.tts') !== '0'; } catch {}
function speak(text) {
  if (!ttsOn || !text) return;
  if (NATIVE) return NATIVE.speak(text);
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ko-KR';
  const v = speechSynthesis.getVoices().find((x) => x.lang && x.lang.startsWith('ko'));
  if (v) u.voice = v;
  u.rate = 1.05;
  speechSynthesis.speak(u);
}
function renderTts() {
  $('tts').classList.toggle('off', !ttsOn);
  $('tts').textContent = ttsOn ? '🔊' : '🔇';
  if (typeof renderMapCtl === 'function' && $('mapCtl').__html) renderMapCtl();
}
$('tts').onclick = () => {
  ttsOn = !ttsOn;
  try { localStorage.setItem('driveon.tts', ttsOn ? '1' : '0'); } catch {}
  if (!ttsOn) NATIVE ? NATIVE.stopSpeaking() : speechSynthesis?.cancel();
  renderTts();
};
renderTts();

// ───────── 입력: 말하기 / 터치 ─────────
async function say(text) {
  text = text.trim();
  if (!text) return;
  showGleo(text, 'user'); // 실제 차량처럼 알아들은 말을 화면 위쪽 말풍선으로 보여 준다
  try {
    reply((await api('/gleo/utterance', { text })).ttsText);
  } catch (e) {
    console.error(e);
  }
}
async function act(a) {
  try {
    reply((await api('/gleo/action', a)).ttsText);
  } catch (e) {
    console.error(e);
  }
}
/** Gleo 대답: 소리로 읽고, 앱 안 질문 판이 안 보이는 화면(주문 현황·미니바)이면 위쪽 안내로도 보여 준다 */
function reply(text) {
  speak(text);
  setTimeout(() => {
    const bubbleShown = !$('split').classList.contains('collapsed') && $('question').innerHTML.trim() !== '';
    if (!bubbleShown && !pay.open) showGleo(text);
  }, 400);
}
// 주문 뒤 기본 상태는 미니바. 미니바를 누르면 그 주문의 전송 대기 화면을 펼친다(자동 전환 없음).
let expandedOrderId = null;
let lastState = null;

document.addEventListener('click', (e) => {
  const pk = e.target.closest('[data-pay]');
  if (pk) return onPayClick(pk.dataset.pay);
  if (e.target.id === 'paySheet') return closePay();
  const u = e.target.closest('[data-ui]');
  if (u) {
    const k = u.dataset.ui;
    if (k === 'pay') return openPay();
    if (k === 'mic') return openGleo();
    if (k === 'list') listForStore = lastState?.session.store?.id ?? null;
    if (k === 'expand' || k === 'collapse') expandedOrderId = k === 'expand' ? lastState?.session.order?.id ?? null : null;
    if (lastState) render(lastState);
    return;
  }
  const b = e.target.closest('[data-act]');
  if (b) act(JSON.parse(b.dataset.act));
  if (!e.target.closest('.gleo-ctl')) closeGleo();
});

// ───────── Gleo (상태바 버튼) ─────────
// 누르면 듣기 시작한다(Chrome·Edge의 음성 인식). 실제 차량에서는 Gleo STT가 대신한다.
// 마이크를 쓸 수 없는 시연 환경을 위해 같은 자리에 입력칸을 함께 연다.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
if (SR) {
  rec = new SR();
  rec.lang = 'ko-KR';
  rec.interimResults = true;
  rec.onresult = (e) => {
    let t = '';
    for (const r of e.results) t += r[0].transcript;
    $('sayInput').value = t;
    if (e.results[e.results.length - 1].isFinal) {
      $('sayInput').value = '';
      closeGleo();
      say(t);
    }
  };
  rec.onend = () => {
    $('gleoBtn').classList.remove('listening');
    $('sayState').textContent = '입력하거나 다시 누르세요';
  };
  rec.onerror = rec.onend;
}
function openGleo() {
  $('sayForm').hidden = false;
  $('gleoBtn').setAttribute('aria-expanded', 'true');
  if (NATIVE) {
    NATIVE.stopSpeaking();
    NATIVE.listen();
    $('gleoBtn').classList.add('listening');
    $('sayState').textContent = '듣고 있어요 · Pleos 음성 인식';
  } else if (rec) {
    speechSynthesis?.cancel();
    try {
      rec.start();
      $('gleoBtn').classList.add('listening');
      $('sayState').textContent = '듣고 있어요';
    } catch {}
  } else {
    $('sayState').textContent = 'Gleo에게';
  }
  $('sayInput').focus();
}
function closeGleo() {
  if ($('sayForm').hidden) return;
  $('sayForm').hidden = true;
  $('gleoBtn').setAttribute('aria-expanded', 'false');
  if (NATIVE) NATIVE.stopListening();
  try { rec?.stop(); } catch {}
}
/** 차량 앱이 Pleos 음성 인식 결과를 넘겨준다: 중간 결과는 말풍선, 최종 결과는 Gleo에게 */
window.driveonHeard = (text, final) => {
  if (!text) return;
  if (!final) {
    $('sayInput').value = text;
    showGleo(text, 'user');
    return;
  }
  $('sayInput').value = '';
  $('gleoBtn').classList.remove('listening');
  closeGleo();
  say(text);
};
window.driveonListenEnded = (msg) => {
  $('gleoBtn').classList.remove('listening');
  $('sayState').textContent = msg || '입력하거나 다시 누르세요';
};
$('gleoBtn').onclick = () => ($('sayForm').hidden ? openGleo() : closeGleo());
$('sayForm').onsubmit = (e) => {
  e.preventDefault();
  const t = $('sayInput').value;
  $('sayInput').value = '';
  closeGleo();
  say(t);
};

/** Gleo 안내를 시스템 알림처럼 잠깐 보여 준다 (소리를 끈 시연에서도 보이게) */
let gleoToastTimer = 0;
function showGleo(text, who = 'gleo') {
  if (!text) return;
  $('gleoToast').className = `gleo-toast ${who}`;
  $('gleoToast').innerHTML = `<span class="dots" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span class="tx">${who === 'user' ? `“${esc(text)}”` : esc(text)}</span>`;
  $('gleoToast').hidden = false;
  clearTimeout(gleoToastTimer);
  gleoToastTimer = setTimeout(() => ($('gleoToast').hidden = true), 5000);
}

// ───────── 렌더링 ─────────
function render(st) {
  lastState = st;
  const s = st.session;
  const o = s.order;
  if (tourExpand && o && s.phase === 'ORDERED') {
    expandedOrderId = o.id;
    tourExpand = false;
  }
  const collapsed = s.phase === 'ORDERED' && o && o.status !== 'CANCELLED' && expandedOrderId !== o.id;
  $('split').classList.toggle('collapsed', !!collapsed);
  renderStatus(st);
  renderNav(st);
  if (collapsed) patch($('live'), liveView(st, o));
  else renderApp(st);
  watchPayment(st);
  if (pay.open) drawPay();
}

// 차량 상태바: 왼쪽 주행 상태 · 가운데 날짜 · 오른쪽 연결 아이콘과 큰 시계 (실제 차량 화면 배치)
const dateFmt = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short' });
const clock12 = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', minute: '2-digit', hour12: true });
const ICON_BT = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 7l10 10-5 4V3l5 4L7 17"/></svg>';
const ICON_SIGNAL = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><rect x="3" y="15" width="3" height="6" rx="1"/><rect x="8.5" y="11" width="3" height="10" rx="1"/><rect x="14" y="7" width="3" height="14" rx="1"/><rect x="19.5" y="3" width="3" height="18" rx="1" opacity=".35"/></svg>';
function renderStatus(st) {
  const c = st.car;
  const traffic =
    c.traffic === 'JAM' ? `<span class="traffic JAM">🚦 정체 +${c.delayMin}분</span>`
    : c.traffic === 'FAST' ? `<span class="traffic FAST">원활 ${c.delayMin}분</span>` : '';
  const [hm, ap] = clock12.format(st.now).split(' ');
  const d = dateFmt.formatToParts(st.now);
  const part = (t) => d.find((p) => p.type === t)?.value ?? '';
  patch($('status'), `
    <span class="badge ${c.state}">${STATE_LABEL[c.state] ?? c.state}</span>
    <span class="speed">${c.speedKmh} km/h</span>
    ${c.source === 'pleos' ? '<span class="tag pleos" title="Pleos 내비(NaviHelper)의 실제 남은 시간으로 계산 중">📡 Pleos 내비</span>' : ''}
    ${traffic}
    ${st.clock.paused ? '<span class="tag bad">일시정지</span>' : st.clock.speed !== 1 ? `<span class="tag">시연 ${st.clock.speed}배속</span>` : ''}
    <span class="date">${part('month')} ${part('day')}일 (${part('weekday')})</span>
    <span class="sys-ic">${ICON_BT}${ICON_SIGNAL}</span>
    <span class="clock">${hm}<small>${ap}</small></span>`);
}

// ───────── 내비: 실제 지도 + 왼쪽 세로 버튼 + 아래 안내 바 (실제 차량 내비 배치) ─────────
const mapReady = initMap($('map'));
const ICON_SEARCH = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>';
const ICON_LAYER = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 2 8l10 5 10-5-10-5Z"/><path d="m2 13 10 5 10-5" opacity=".6"/></svg>';

function renderMapCtl() {
  if (!mapReady) return;
  const { layer, follow } = mapState();
  const st = lastState;
  const left = st ? Math.max(0, ROAD_KM - roadProgress(st.car).km) : ROAD_KM;
  patch($('mapCtl'), `
    <button data-map="search" aria-label="검색 · Gleo에게 말하기">${ICON_SEARCH}</button>
    <button data-map="follow" class="compass ${follow ? 'on' : ''}" aria-label="${follow ? '전체 경로 보기' : '내 차 따라가기'}"><small>${follow ? heading() : 'N'}</small><i></i></button>
    <button data-map="tts" aria-label="안내 음성 켜기/끄기"><small>Nav</small><span class="snd">${ttsOn ? '🔊' : '🔇'}</span></button>
    <button data-map="layer" aria-label="지도 모드 바꾸기 (지금 ${LAYER_NAME[layer]})">${ICON_LAYER}<small>${LAYER_NAME[layer]}</small></button>
    <div class="scale"><button data-map="in" aria-label="확대">＋</button><small>Auto<br/>${scaleLabel()}</small><button data-map="out" aria-label="축소">－</button></div>
    <button data-map="home" aria-label="전체 경로 보기"><span class="hm">🏠</span><small>${left.toFixed(1)} km</small></button>`);
}
document.addEventListener('driveon:mapview', renderMapCtl);
window.addEventListener('driveon:redraw', () => lastState && render(lastState));
document.addEventListener('driveon:storepin', (e) => act({ type: 'SELECT_STORE', storeId: e.detail }));
$('mapCtl').addEventListener('click', (e) => {
  const k = e.target.closest('[data-map]')?.dataset.map;
  if (!k) return;
  e.stopPropagation();
  if (k === 'search') return openGleo();
  if (k === 'layer') setLayer(LAYER_ORDER[(LAYER_ORDER.indexOf(mapState().layer) + 1) % LAYER_ORDER.length]);
  else if (k === 'follow') setFollow(!mapState().follow);
  else if (k === 'home') setFollow(false);
  else if (k === 'tts') $('tts').click();
  else zoomBy(k === 'in' ? 1 : -1);
  renderMapCtl();
  if (lastState) updateMap(lastState);
});
onMapZoom(renderMapCtl);
renderMapCtl();

/** Pleos TBT 종류 → 화면 화살표 */
const TBT_KIND = {
  TURN_LEFT: 'left', TURN_SHARP_L: 'left', TURN_RIGHT: 'right', TURN_SHARP_R: 'right', TURN_KEEP_L: 'keep-left', TURN_KEEP_R: 'keep-right',
  TURN_EXIT_IC_R: 'exit-right', TURN_EXIT_IC_L: 'keep-left', TURN_EXIT_IC_C: 'start', TURN_ENTER_IC_R: 'merge', TURN_ENTER_IC_L: 'merge', TURN_ENTER_IC_C: 'merge',
  TURN_UTURN: 'uturn', TURN_ARRIVE: 'arrive', TURN_STRAIGHT: 'start',
};
/** 포장 들르기: 서버가 경유지를 정하면 차량 앱에 알려 Pleos 내비 경로에 넣는다 (한 번만) */
let nativeWp = null;
function syncNativeNav(c) {
  if (!NATIVE) return;
  const wp = c.waypoint && !c.waypoint.done ? c.waypoint : null;
  const key = wp ? wp.storeId : '';
  if (key === nativeWp) return;
  nativeWp = key;
  if (wp) NATIVE.setWaypoint(wp.pos.lat, wp.pos.lng, wp.name);
  else NATIVE.clearWaypoint();
}
// 길 안내 카드를 누르면 Pleos 내비 화면을 크게 연다
$('turn').addEventListener('click', () => NATIVE?.openNavi());

function renderNav(st) {
  const c = st.car;
  updateMap(st);
  const { km } = roadProgress(c);
  // 실제 내비 값이 오면 남은 거리도 내비 값을 쓴다
  const left = c.source === 'pleos' ? c.remainingKm : Math.max(0, ROAD_KM - km);
  const wp = c.waypoint && !c.waypoint.done ? c.waypoint : null;
  const dp = st.dispatchPoint;
  // 실제 내비(Pleos NaviHelper TBT)가 다음 갈림길을 주면 그것을, 아니면 가상 경로의 갈림길을 보여 준다
  const t = c.arrived ? { kind: 'arrive', inKm: 0, road: '' } : c.tbt ? { kind: TBT_KIND[c.tbt.type] ?? 'start', inKm: c.tbt.distance / 1000, road: c.tbt.description } : nextTurn(km);
  syncNativeNav(c);
  // 길 안내 카드: 큰 화살표 + 남은 거리 + 길 이름
  patch($('turn'), `
    <div class="arrow ${t.kind}">${arrowSvg(t.kind, 58)}</div>
    <div class="tx"><b>${c.arrived ? '도착' : fmtDist(t.inKm)}</b><span>${esc(t.road || TURN_WORD[t.kind] || '')}</span></div>`);
  // 아래 안내 바: 지금 달리는 길 (실제 내비의 '▲ 방축로')
  patch($('road'), `<b>▲</b>${esc(c.navAddress || currentRoad(km) || '경로 안내 중')}`);
  renderMapCtl();
  // 아래 도착 정보: 그림 + 시각 위주
  patch($('eta'), `
    <div class="chip home"><span class="ic">🏠</span><span class="v">${hhmm(c.etaDestination)}</span><small>도착</small></div>
    <div class="chip"><span class="ic">📍</span><span class="v">${left.toFixed(1)}<small>km</small></span></div>
    ${dp && !dp.sent ? `<div class="chip send"><span class="ic">📤</span><span class="v">${hhmm(dp.at)}</span><small>${fmtDist(Math.max(0, toRoadKm(dp.routeKm, c) - km))} 앞</small></div>` : ''}
    ${c.traffic === 'JAM' ? `<div class="chip bad"><span class="ic">🚦</span><span class="v">+${c.delayMin}<small>분</small></span></div>` : ''}
    ${wp ? `<div class="chip wp"><span class="ic">🚩</span><span class="v">${hhmm(c.etaWaypoint)}</span><small>${esc(shortStore(wp.name))}</small></div>` : ''}`);
}

/**
 * DriveOn 앱 창: 배달앱식 화면
 *   위   — Gleo 질문과 빠른 답
 *   가운데 — 홈 · 가게 목록 · 가게 화면 · 주문하기 · 주문 현황
 *   아래 — 민트 장바구니 바 / 결제하기 버튼 / 상태 줄
 */
let listForStore = null; // 가게 화면에서 '가게 목록'을 누른 가게. 다른 가게를 고르면 다시 가게 화면

function renderApp(st) {
  const s = st.session;
  const restricted = st.car.uxRestricted;
  document.querySelector('.app').classList.toggle('restricted', restricted);
  if (s.store?.id !== listForStore && listForStore !== null && !s.store) listForStore = null;

  // 위 판: Gleo 질문 + 빠른 답
  const lastGleo = [...s.transcript].reverse().find((t) => t.who === 'gleo');
  let quick = '';
  const qb = (cls, o, ic, label) => `<button class="${cls}" ${A(o)}><span class="qi">${ic}</span>${label}</button>`;
  if (s.suggestRecent) quick = qb('ans', { type: 'CONFIRM' }, '↻', '지난번 그대로') + qb('', { type: 'DENY' }, '🔄', '다른 메뉴');
  else if (s.phase === 'ASK_UPSELL') quick = qb('ans', { type: 'CONFIRM' }, '🥤', '음료 추가') + qb('', { type: 'DENY' }, '🙅', '괜찮아요');
  else if (s.phase === 'ASK_MODE') quick = qb('ans', { type: 'CHOOSE_MODE', mode: 'DELIVERY' }, '🛵', '배달') + qb('ans', { type: 'CHOOSE_MODE', mode: 'PICKUP' }, '🚗', '포장');
  patch($('question'), !['IDLE', 'ORDERED'].includes(s.phase) && lastGleo ? `<div class="bubble"><span class="g-dot"></span><span>${esc(lastGleo.text)}</span></div><div class="quick">${quick}</div>` : '');

  const showStore = s.store && !s.suggestRecent && listForStore !== s.store.id;
  let body;
  if (s.phase === 'IDLE') body = homeView(s);
  else if (s.phase === 'ORDERED' && s.order) body = orderView(st, s.order, s.notice);
  else if (s.phase === 'ASK_PAY') body = payView(st);
  else if (showStore) body = storeView(st);
  else body = listView(s);
  patch($('appBody'), body);

  // 아래 판
  let bottom;
  if (s.phase === 'ASK_PAY') {
    bottom = `<button class="back-btn" ${A({ type: 'DENY' })} aria-label="메뉴 바꾸기">‹<small>메뉴</small></button>
      <button class="mint cart-bar" data-ui="pay"><span class="cnt">💳</span><span class="lbl">결제하기</span><span class="sum">${won(s.total)}</span></button>`;
  } else if (s.cart.length && s.phase !== 'ORDERED') {
    const count = s.cart.reduce((n, l) => n + l.qty, 0);
    const m = s.mode ?? 'DELIVERY';
    const when = s.preview?.[m]?.display;
    const short = m === 'DELIVERY' && s.store && s.itemsTotal < s.store.minOrder;
    const pics = s.cart.slice(0, 3).map((l) => art(l.name, s.store?.category, { size: 'xs', flavor: false })).join('');
    bottom = `<button class="mint cart-bar ${short ? 'short' : ''}" ${A({ type: 'CONFIRM' })}>
      <span class="pics">${pics}<span class="cnt">${count}</span></span>
      <span class="lbl">${short
        ? `🛵 ${won(s.store.minOrder - s.itemsTotal)} 더 담기`
        : `${m === 'DELIVERY' ? '🛵' : '🚗'} ${MODE[m]} 주문${when ? ` <span class="when">📤 ${when}</span>` : ''}`}</span>
      <span class="sum">${won(s.total)}</span></button>`;
  } else {
    bottom = ''; // 담은 것도 결제할 것도 없으면 아래 판을 비운다
  }
  patch($('minibar'), bottom);
}

/** 화면의 가게 번호: 집 근처 → 가는 길 순서 (Gleo에게 "두 번째 가게"라고 말해도 같은 번호) */
function storeNumbers(h) {
  return new Map([...h.nearHome, ...h.onTheWay].map((c, i) => [c.storeId, i + 1]));
}

const rate = (r) => `<span class="chip-s"><span class="star">★</span>${r.toFixed(1)}</span>`;

function recentCards(h) {
  return h.recent.map((r, i) => `
    <button class="recent-card" ${A({ type: 'REORDER', index: i })}>
      ${art(r.items[0]?.name ?? '', null, { size: 'md' })}
      <span class="txt">
        <span class="nm">${esc(r.items[0]?.name ?? '')}${r.items.length > 1 ? ` +${r.items.length - 1}` : ''}</span>
        <span class="st">${r.mode === 'DELIVERY' ? '🛵' : '🚗'} ${esc(shortStore(r.storeName))} · ${won(r.total)}</span>
      </span>
      <span class="go" aria-label="한 번에 재주문">↻</span>
    </button>`).join('');
}

// 홈: 크게 말하기 버튼 + 그림 카테고리 + 다시 주문
function homeView(s) {
  const cats = Object.keys(EMOJI).map((c) => `<button class="cat ${CAT_BG[c]}" ${A({ type: 'START', category: c })}><img class="ic" src="${catImg(c)}" alt="" draggable="false" /><span>${c}</span></button>`).join('');
  const rc = recentCards(s.home);
  return `<button class="mic-hero" data-ui="mic"><span class="mic">🎙️</span><span class="tx"><b>“치킨 시켜줘”</b><small>Gleo에게 말하기</small></span></button>
    <div class="cat-grid">${cats}</div>
    ${rc ? `<div class="sec"><div class="sec-title"><span class="h-ic">↻</span>다시 주문</div><div class="recent-row">${rc}</div></div>` : ''}`;
}

/** 가게 카드: 큰 음식 그림 + 번호(지도 핀과 같은 번호) + 아이콘 정보 */
function storeCard(c, kind, no, sel) {
  const tops = (c.topItems ?? []).map((t) => t.name).filter(Boolean);
  const top = tops[0] ?? c.category;
  const side = tops.slice(1, 3);
  const extra = kind === 'near'
    ? c.deliveryTip === 0 ? '<span class="chip-s free">🛵 무료</span>' : `<span class="chip-s">🛵 ${(c.deliveryTip / 1000).toFixed(1).replace('.0', '')}천</span>`
    : `<span class="chip-s pick">🚗 +${c.detourMin}분</span>`;
  return `<button class="store-card ${sel ? 'sel' : ''}" ${A({ type: 'SELECT_STORE', storeId: c.storeId })}>
      <span class="pic ${side.length ? 'trio' : ''}">${art(top, c.category, { size: 'lg' })}${side.length ? `<span class="sub">${side.map((n) => art(n, c.category, { size: 'fill', flavor: false })).join('')}</span>` : ''}<span class="no">${no}</span></span>
      <span class="nm">${esc(c.name)}</span>
      <span class="chips">${rate(c.rating)}<span class="chip-s">⏱ ${c.prepMin}분</span>${extra}</span>
    </button>`;
}

// 가게 목록: 그림 카테고리 탭 + 다시 주문 + 집 근처(배달) + 가는 길(포장) 카드
function listView(s) {
  const h = s.home;
  const no = storeNumbers(h);
  const sel = s.store?.id;
  const tabs = Object.keys(EMOJI).map((c) => `<button class="${s.category === c ? 'on' : ''}" ${A({ type: 'START', category: c })}><img class="ti" src="${catImg(c)}" alt="" draggable="false" />${c}</button>`).join('');
  const grid = (arr, kind) => `<div class="store-grid">${arr.map((c) => storeCard(c, kind, no.get(c.storeId), c.storeId === sel)).join('')}</div>`;
  const rc = recentCards(h);
  return `<div class="cat-tabs">${tabs}</div>
    ${rc ? `<div class="sec"><div class="sec-title"><span class="h-ic">↻</span>다시 주문</div><div class="recent-row">${rc}</div></div>` : ''}
    <div class="sec"><div class="sec-title"><span class="h-ic">🏠</span>집 근처 배달<small>🛵 2km 안</small></div>
      ${h.nearHome.length ? grid(h.nearHome, 'near') : '<div class="empty">🏠🚫</div>'}</div>
    <div class="sec"><div class="sec-title"><span class="h-ic">🚗</span>가는 길 포장<small>🕔 5분 안 우회</small></div>
      ${h.onTheWay.length ? grid(h.onTheWay, 'way') : '<div class="empty">🚗🚫</div>'}</div>`;
}

/** 배달/포장 큰 타일: 그림 + 매장 전송 시각 */
function modeTiles(s, m, detourMin) {
  const p = s.preview;
  const tile = (mode, ic, label, sub) => `<button class="mode-tile ${m === mode ? 'on' : ''}" ${A({ type: 'SET_MODE', mode })}>
      <span class="mi">${ic}</span><b>${label}</b><span class="sub">${sub}</span></button>`;
  return `<div class="mode-tiles">
      ${tile('DELIVERY', '🛵', '배달', p?.DELIVERY ? `📤 <span class="time">${p.DELIVERY.display}</span> → 🏠` : '🏠 도착 맞춤')}
      ${tile('PICKUP', '🚗', '포장', p?.PICKUP ? `📤 <span class="time">${p.PICKUP.display}</span>${detourMin != null ? ` · +${detourMin}분` : ''}` : `🏪 들르기${detourMin != null ? ` +${detourMin}분` : ''}`)}
    </div>`;
}

// 가게 화면: 가게 머리 + 배달/포장 타일 + 메뉴 그림 카드(주행 중 대표 메뉴만)
function storeView(st) {
  const s = st.session;
  const store = s.store;
  const restricted = st.car.uxRestricted;
  const m = s.mode ?? 'DELIVERY';
  const card = [...s.home.nearHome, ...s.home.onTheWay].find((c) => c.storeId === store.id);
  const no = storeNumbers(s.home).get(store.id);
  const qtyOf = (id) => s.cart.filter((l) => l.itemId === id).reduce((n, l) => n + l.qty, 0);
  const cardOf = (i) => `
    <button class="menu-card ${qtyOf(i.id) ? 'in' : ''}" ${A({ type: 'ADD_ITEM', itemId: i.id })} aria-label="${esc(i.name)} 담기">
      ${art(i.name, store.category, { size: 'lg', qty: qtyOf(i.id) })}
      ${i.popular ? '<span class="best">👑</span>' : ''}
      <span class="nm">${esc(i.name)}</span>
      <span class="pr">${won(i.price)}</span>
      <span class="plus" aria-hidden="true">＋</span>
    </button>`;
  const popular = store.items.filter((i) => i.popular);
  const rest = store.items.filter((i) => !i.popular);
  const shown = s.menuOpen && !restricted ? store.items : popular;
  const opts = s.cart.length && store.options.length
    ? `<div class="sec"><div class="sec-title"><span class="h-ic">➕</span>같이 담기</div><div class="opts">${store.options.map((o) => `<button ${A({ type: 'ADD_OPTION', optionIds: [o.id] })}>${art(o.name, store.category, { size: 'xs', flavor: false })}<span>${esc(o.name)}</span><b>+${won(o.price)}</b></button>`).join('')}</div></div>`
    : '';
  return `<div class="store-head">
      <button class="back-btn" data-ui="list" aria-label="가게 목록">‹</button>
      ${art(store.items[0]?.name ?? store.category, store.category, { size: 'md' })}
      <div class="hd">
        <h2>${no ? `<span class="no">${no}</span>` : ''}${esc(store.name)}</h2>
        <div class="chips">${rate(store.rating)}<span class="chip-s">⏱ ${Math.max(...store.items.map((i) => i.prepMin))}분</span><span class="chip-s ${store.deliveryTip ? '' : 'free'}">🛵 ${store.deliveryTip ? won(store.deliveryTip) : '무료'}</span><span class="chip-s">🧾 ${won(store.minOrder)}~</span></div>
      </div>
    </div>
    <div class="sec">${modeTiles(s, m, card?.detourMin)}</div>
    <div class="sec"><div class="menu-grid">${shown.map(cardOf).join('')}</div>
    ${rest.length && !(s.menuOpen && !restricted)
      ? restricted
        ? '<div class="hint-line">🚗 주행 중 · 👑 대표 메뉴만 · 🅿️ 정차하면 전체 메뉴</div>'
        : `<button class="more" ${A({ type: 'OPEN_MENU' })}>🍽 전체 메뉴 ${rest.length}개 더 보기</button>`
      : ''}</div>
    ${opts}`;
}

// 주문하기: 배달/포장 타일 · 도착 맞춤 그림 타임라인 · 담은 메뉴(그림+수량) · 결제수단 · 결제금액
function payView(st) {
  const s = st.session;
  const mode = s.mode ?? 'DELIVERY';
  const card = s.cards.find((x) => x.id === s.cardId) ?? s.cards[0];
  const cardIdx = s.cards.indexOf(card);
  const cat = s.store.category;
  const lines = s.cart.map((l, i) => `
    <div class="line">
      ${art(l.name, cat, { size: 'md' })}
      <div class="nm">${esc(l.name)}${l.options.length ? `<span class="opt-pics" title="${esc(l.options.join(', '))}">${l.options.map((n) => `<span class="op">＋${art(n, cat, { size: 'sm', flavor: false })}</span>`).join('')}</span>` : ''}</div>
      <div class="stepper"><button ${A({ type: 'SET_QTY', index: i, qty: l.qty - 1 })} aria-label="빼기">−</button><span>${l.qty}</span><button ${A({ type: 'SET_QTY', index: i, qty: l.qty + 1 })} aria-label="더하기">+</button></div>
      <div class="pr">${won(l.lineTotal)}</div>
    </div>`).join('');
  // 진행 타임라인(지금 → 전송 → 도착)은 결제 뒤 주문 현황에서 보여 준다. 여기서는 메뉴와 금액을 크게.
  return `<div class="sec">${modeTiles(s, mode, null)}</div>
    <div class="sec pay-lines"><div class="sec-title"><span class="h-ic">${EMOJI[cat] ?? '🍽'}</span>${esc(s.store.name)}</div>${lines}</div>
    <div class="sec pay-sum big">
      <button class="paymethod" data-ui="pay"><span class="mini-card ${cardIdx % 2 ? 'silver' : ''}">${esc(card.issuer)}</span>
        <span class="pm"><b>··${esc(card.last4)}</b><small>인카페이먼트</small></span><span class="chg">변경 ›</span></button>
      <div class="sum-col">
        <div class="sum-row"><span>🍽 ${won(s.itemsTotal)}</span><span>🛵 ${won(s.deliveryTip)}</span></div>
        <div class="sum-row total"><span>합계</span><span>${won(s.total)}</span></div>
      </div>
    </div>`;
}

const shortItem = (name) => name.replace(/(치킨|피자|버거)$/, '') || name;
const shortStore = (name) => name.split(' ')[0];
const minutesLeft = (ms) => (ms <= 60_000 ? '곧' : `${Math.ceil(ms / 60_000)}분 남음`);

/** 결제 → 전송 구간과 전송 → 도착 구간의 진행률 (0~1) */
function progress(o, now) {
  const send = o.sentAt ?? o.dispatchAt;
  if (!o.sentAt) return Math.min(1, Math.max(0, (now - o.createdAt) / Math.max(1, send - o.createdAt)));
  return Math.min(1, Math.max(0, (now - send) / Math.max(1, o.pickupEta - send)));
}

// 주문 현황: 큰 시각 · 4단계 진행(결제 완료 → 전송 대기 → 매장 접수 → 도착) · 주문 정보
function orderView(st, o, notice) {
  const place = o.mode === 'DELIVERY' ? '집' : '매장';
  const cat = lastState?.session.home ? [...lastState.session.home.nearHome, ...lastState.session.home.onTheWay].find((c) => c.storeId === o.storeId)?.category : null;
  const pay = o.payment.card ? `··${esc(o.payment.card.last4)}` : '';
  const info = `<div class="sec order-card">
      <div class="pics">${o.lines.slice(0, 3).map((l) => art(l.name, cat, { size: 'md', qty: l.qty > 1 ? l.qty : 0 })).join('')}</div>
      <div class="txt">
        <b>${esc(o.lines.map((l) => l.name).join(', '))}</b>
        <span>${o.mode === 'DELIVERY' ? '🛵' : '🚗'} ${esc(o.storeName)}${o.vehicle ? ` · 🚘 ${esc(o.vehicle.plate)}` : ''}</span>
      </div>
      <div class="amt"><b>${won(o.total)}</b><small>💳 ${pay}</small></div>
    </div>`;
  // idx: 지금 단계(그 앞은 완료). fill: 단계 점 사이 막대 폭(%) — 점 간격 25%, 전체 75%
  const steps = (idx, fill) => {
    const storeStep = o.storeStatus === 'DONE' ? '조리 완료' : o.storeStatus === 'ACCEPTED' ? '조리 중' : '매장 접수';
    const storeIc = o.storeStatus === 'DONE' ? (o.mode === 'DELIVERY' ? '🛵' : '🛍️') : '👨‍🍳';
    const storeTime = o.doneAt ?? o.acceptedAt ?? o.sentAt ?? o.dispatchAt;
    const labels = [['💳', '결제', hhmm(o.createdAt)], ['📤', '매장 전송', hhmm(o.sentAt ?? o.dispatchAt)], [storeIc, storeStep, hhmm(storeTime)], [o.mode === 'DELIVERY' ? '🏠' : '🏪', `${place} 도착`, hhmm(o.pickupEta)]];
    return `<div class="steps4"><div class="fill" style="width:${Math.min(75, Math.max(0, fill)).toFixed(1)}%"></div>
      ${labels.map(([ic, l, t], i) => `<div class="st ${i < idx ? 'done' : i === idx ? 'now' : ''}"><span class="dot">${ic}</span>${l}${t ? `<small>${t}</small>` : ''}</div>`).join('')}</div>`;
  };

  if (o.status === 'SCHEDULED') {
    const sign = o.marginMin >= 0 ? '+' : '−';
    return `<div class="status-head">
        <div class="t1">주문이 예약됐어요</div>
        <div class="p0"><span class="hero-ic">📤</span><span class="big">${hhmm(o.dispatchAt)}</span><span class="left-pill">⏳ ${minutesLeft(o.dispatchAt - st.now)}</span></div>
        ${notice ? `<div class="why">${esc(notice.text)}</div>` : ''}
        ${steps(1, 25 + 25 * progress(o, st.now))}
        <div class="eq" aria-label="${place} 도착 ${hhmm(o.pickupEta)}에서 조리 ${o.prepMin}분${o.mode === 'DELIVERY' ? `, 배달 ${o.deliveryMin}분` : ''}을 빼면 전송 ${hhmm(o.dispatchAt)}">
          <span class="q">${o.mode === 'DELIVERY' ? '🏠' : '🏪'}<b>${hhmm(o.pickupEta)}</b></span>${o.marginMin ? `<i>${sign}</i><span class="q">⏸<b>${Math.abs(o.marginMin)}′</b></span>` : ''}
          <i>−</i><span class="q">👨‍🍳<b>${o.prepMin}′</b></span>${o.mode === 'DELIVERY' ? `<i>−</i><span class="q">🛵<b>${o.deliveryMin}′</b></span>` : ''}
          <i>=</i><span class="q key">📤<b>${hhmm(o.dispatchAt)}</b></span><span class="q auto" title="내비 시간으로 30초마다 다시 계산">🔄</span></div>
      </div>
      ${info}
      <div class="sec act-row"><button data-ui="collapse"><span class="ai">🗺️</span>지도 크게</button><button class="cancel" ${A({ type: 'CANCEL' })}><span class="ai">✕</span>취소 (전송 전 무료)</button></div>`;
  }
  if (o.status === 'SENT') {
    const arrived = !!o.customerArrivedAt;
    return `<div class="status-head">
        <div class="t1">${arrived ? '매장에 도착했어요'
          : o.storeStatus === 'DONE' ? (o.mode === 'DELIVERY' ? '배달을 출발했어요' : '음식이 준비됐어요')
          : o.storeStatus === 'ACCEPTED' ? '매장에서 조리 중이에요'
          : '매장에 주문이 들어갔어요'}</div>
        <div class="p0 sent"><span class="hero-ic">${o.mode === 'DELIVERY' ? '🏠' : '🏪'}</span><span class="big">${o.display.pickupEta}</span><span class="left-pill ok">✓ 📤 ${o.display.sentAt}</span></div>
        ${o.lateMin ? `<div class="why">주문할 때 이미 늦어서 바로 보냈어요. 도착 후 약 ${o.lateMin}분 뒤 받을 수 있어요.</div>` : ''}
        ${steps(arrived ? 4 : 3, arrived ? 75 : 50 + 25 * progress(o, st.now))}
        <div class="eq"><span class="q">🚗<b>${o.display.pickupEta}</b></span><i>·</i><span class="q">${o.mode === 'DELIVERY' ? '🛵' : '🛍️'}<b>${o.display.readyAt}</b></span></div>
      </div>
      ${info}
      <div class="sec act-row"><button data-ui="collapse"><span class="ai">🗺️</span>지도 크게</button><button ${A({ type: 'START' })}><span class="ai">➕</span>새 주문</button></div>`;
  }
  return `<div class="status-head"><div class="t1">주문이 취소됐어요</div><div class="formula">결제도 함께 취소됐어요.</div></div>
    ${info}<div class="sec act-row"><button ${A({ type: 'START' })}><span class="ai">➕</span>새 주문</button></div>`;
}

// 주문 뒤 미니바 (Live Activity): 시각 · 진행 · 메뉴·가게. 누르면 주문 현황
function liveView(st, o) {
  // 실제 차량의 미디어 미니 플레이어처럼: 위쪽 진행 막대 · 음식 그림 · 두 줄 · 둥근 버튼
  const sent = o.status === 'SENT';
  const pct = sent ? 100 : progress(o, st.now) * 100;
  const title = sent
    ? `✓ 📤 ${o.display.sentAt} 전송 · ${o.mode === 'DELIVERY' ? '🏠' : '🏪'} ${o.display.pickupEta}`
    : `📤 ${hhmm(o.dispatchAt)} 전송 · ⏳ ${minutesLeft(o.dispatchAt - st.now)}`;
  return `<span class="mp-bar ${sent ? 'sent' : ''}"><i style="width:${pct.toFixed(1)}%"></i></span>
    ${art(o.lines[0].name, null, { size: 'sm', flavor: false })}
    <span class="mp-tx"><b>${title}</b><small>${esc(shortItem(o.lines[0].name))}${o.lines.length > 1 ? ` 외 ${o.lines.length - 1}` : ''} · ${esc(shortStore(o.storeName))}</small></span>
    <span class="mp-btn" aria-hidden="true">⤢</span>`;
}

// ───────── 인카페이먼트 결제 시트 ─────────
// 지문 센서 대신 차량 안 기능을 조합해 인증한다:
//   등록 차량(번호판) · Pleos 운전자 프로필 · 디지털 키가 자동으로 확인되고,
//   정차 중에는 결제 비밀번호 6자리(보안 키패드), 주행 중에는 Gleo 음성 승인(“응”)으로 마무리한다.
const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const ICON_WAVE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8.5 8a6 6 0 0 1 0 8"/><path d="M12 5.5a10 10 0 0 1 0 13"/><path d="M15.5 3a14 14 0 0 1 0 18"/></svg>';
const pay = { open: false, phase: 'select', pin: '', fail: '', keys: [], closeTimer: 0 };

/** 보안 키패드: 열 때마다 숫자 배치를 섞는다 */
function shuffledKeys() {
  const d = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function openPay(phase = 'select') {
  clearTimeout(pay.closeTimer);
  Object.assign(pay, { open: true, phase, pin: '', fail: '', keys: shuffledKeys() });
  drawPay();
}
function closePay() {
  pay.open = false;
  drawPay();
}
function drawPay() {
  const el = $('paySheet');
  el.hidden = !pay.open;
  if (!pay.open || !lastState) return;
  const s = lastState.session;
  const v = lastState.vehicle ?? { plate: '', model: '', profile: '' };
  const restricted = lastState.car.uxRestricted;
  const idx = Math.max(0, s.cards.findIndex((c) => c.id === s.cardId));
  const amount = pay.phase === 'done' && s.order ? s.order.total : s.total;
  const merchant = pay.phase === 'done' && s.order ? s.order.storeName : s.store?.name ?? '';
  const cards = s.cards.map((c, i) => `
    <button class="cardface ${i % 2 ? 'silver' : ''} ${i === idx ? '' : 'side'}" style="--dx:${(i - idx) * 262}px" data-pay="card:${esc(c.id)}" aria-label="${esc(c.name)} 끝자리 ${esc(c.last4)}">
      <div class="issuer"><span>${esc(c.issuer)}</span>${ICON_WAVE}</div>
      <div class="chip"></div>
      <div class="num"><span>•••• •••• •••• ${esc(c.last4)}</span><small>${esc(c.name.replace(c.issuer, '').trim())}</small></div>
    </button>`).join('');
  // 무엇을 결제하는지: 메뉴 사진 + 이름 × 수량 (결제 완료 뒤에는 주문 내역)
  const cat = s.store?.category ?? null;
  const lineSrc = pay.phase === 'done' && s.order ? s.order.lines : s.cart;
  const lines = (lineSrc ?? []).slice(0, 3).map((l) => `<div class="ln">${art(l.name, cat, { size: 'sm', flavor: false })}<span>${esc(l.name)}</span><small>× ${l.qty}</small></div>`).join('');
  const checks = `<div class="checks">
      <div><span>등록 차량</span><b>${esc(v.plate)} · ${esc(v.model)}</b></div>
      <div><span>운전자 프로필</span><b>${esc(v.profile)}</b></div>
      <div><span>디지털 키</span><b>차 안에서 확인</b></div>
    </div>`;

  let auth;
  if (pay.phase === 'busy') {
    auth = `${checks}<div class="state-ring" aria-hidden="true"></div><div class="lbl">결제 중…</div>`;
  } else if (pay.phase === 'done') {
    auth = `<div class="state-ok">${ICON_CHECK}</div><div class="lbl">결제 완료</div><div class="sub">카드사 승인 알림을 확인하세요</div>`;
  } else if (restricted) {
    auth = `${pay.phase === 'fail' ? `<div class="fail">${esc(pay.fail)}</div>` : ''}${checks}
      <div class="lbl">주행 중에는 음성으로 승인해요</div>
      <div class="sub">결제 비밀번호는 정차 중에만 입력할 수 있어요. Gleo에게 “응”이라고 말하거나 아래 버튼을 누르세요.</div>
      <button class="voice-ok" data-pay="voice">${pay.phase === 'fail' ? '다시 승인하기' : '음성 승인으로 결제 (“응”)'}</button>`;
  } else {
    const k = pay.keys;
    const keys = [...k.slice(0, 9), 'shuffle', k[9], 'back'];
    auth = `${pay.phase === 'fail' ? `<div class="fail">${esc(pay.fail)}</div>` : ''}${checks}
      <div class="lbl">결제 비밀번호 6자리</div>
      <div class="pin-dots" aria-label="${pay.pin.length}자리 입력됨">${[0, 1, 2, 3, 4, 5].map((i) => `<i class="${i < pay.pin.length ? 'on' : ''}"></i>`).join('')}</div>
      <div class="pinpad">${keys.map((x) => x === 'shuffle'
        ? '<button class="fn" data-pay="shuffle">재배열</button>'
        : x === 'back' ? '<button class="fn" data-pay="pin-back" aria-label="지우기">⌫</button>'
        : `<button data-pay="pin-digit:${x}">${x}</button>`).join('')}</div>
      <div class="sub">보안 키패드 · 시연용이라 아무 숫자 6자리면 됩니다</div>`;
  }
  patch(el, `<div class="pay" role="dialog" aria-label="인카페이먼트 결제">
      <span class="grab"></span>
      <div class="top"><b>인카페이먼트</b><span class="mock">모의 결제</span><button class="x" data-pay="close" aria-label="닫기">×</button></div>
      <div class="merchant">${esc(merchant)}</div>
      <div class="amount">${won(amount)}</div>
      <div class="lines">${lines}</div>
      <div class="cards">${cards}</div>
      <div class="dots">${s.cards.map((_, i) => `<i class="${i === idx ? 'on' : ''}"></i>`).join('')}</div>
      <div class="auth">${auth}</div>
    </div>`);
}

async function payNow() {
  pay.phase = 'busy';
  drawPay();
  try {
    const r = await api('/gleo/action', { type: 'CONFIRM', cardId: lastState?.session.cardId });
    speak(r.ttsText);
    if (r.ttsText.startsWith('결제했어요')) finishPay();
    else {
      Object.assign(pay, { phase: 'fail', pin: '', keys: shuffledKeys(), fail: r.ttsText.startsWith('결제가 승인되지') ? '카드 승인이 거절됐어요 (모의)' : r.ttsText });
      drawPay();
    }
  } catch (e) {
    Object.assign(pay, { phase: 'fail', pin: '', fail: '결제 요청에 실패했어요' });
    drawPay();
  }
}
function finishPay() {
  if (!pay.open) Object.assign(pay, { open: true });
  pay.phase = 'done';
  drawPay();
  clearTimeout(pay.closeTimer);
  pay.closeTimer = setTimeout(closePay, 1400);
}

function onPayClick(k) {
  if (k === 'close') return closePay();
  if (k === 'voice') return payNow();
  if (k === 'shuffle') return (pay.keys = shuffledKeys()), drawPay();
  if (k === 'pin-back') return (pay.pin = pay.pin.slice(0, -1)), drawPay();
  if (k.startsWith('pin-digit:')) {
    if (pay.phase === 'busy') return;
    pay.pin += k.slice(10);
    drawPay();
    if (pay.pin.length >= 6) payNow();
    return;
  }
  if (k.startsWith('card:')) {
    const id = k.slice(5);
    if (id !== lastState?.session.cardId) act({ type: 'SELECT_CARD', cardId: id });
  }
}

// ───────── 카드사 앱 승인 알림 ─────────
let toastFor;
let toastTimer = 0;
function showToast(o) {
  const c = o.payment.card ?? { issuer: '카드사', name: '등록 카드', last4: '' };
  patch($('cardToast'), `
    <div class="hd"><span class="logo">카드</span><b>${esc(c.issuer)}</b><span>승인 알림 · 모의</span><span>${hhmm(o.createdAt)}</span></div>
    <div class="amt">${won(o.total)}<small>${esc(o.payment.installment ?? '일시불')} 승인</small></div>
    <div class="mer">${esc(o.storeName)}</div>
    <div class="meta">${esc(c.name)}(${esc(c.last4)}) · 인카페이먼트 · 승인번호 ${esc(o.payment.approvalNo)}</div>`);
  $('cardToast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('cardToast').hidden = true), 6000);
}
/** 새 주문이 생기면(화면 결제든 음성 “응”이든) 결제 완료 표시와 승인 알림을 띄운다 */
function watchPayment(st) {
  const o = st.session.order;
  if (toastFor === undefined) {
    toastFor = o?.id ?? null; // 처음 연결할 때 이미 있던 주문은 알리지 않는다
    return;
  }
  if (o && o.id !== toastFor && o.status !== 'CANCELLED') {
    toastFor = o.id;
    if (tourQuietPay) {
      tourQuietPay = false; // 둘러보기에서 앞 장면을 다시 만드는 결제는 조용히 넘긴다
      return;
    }
    finishPay();
    showToast(o);
  }
}

// ───────── UI 둘러보기(/tour/)에서 보내는 명령 ─────────
let tourExpand = false;
let tourQuietPay = false;
window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || typeof e.data?.type !== 'string') return;
  switch (e.data.type) {
    case 'driveon:resetView':
      expandedOrderId = null;
      listForStore = null;
      tourExpand = !!e.data.expand;
      tourQuietPay = !!e.data.quietPayment;
      clearTimeout(pay.closeTimer);
      pay.open = false;
      $('cardToast').hidden = true;
      $('gleoToast').hidden = true;
      drawPay();
      if (lastState) render(lastState);
      break;
    case 'driveon:openPay':
      openPay();
      break;
    case 'driveon:say':
      say(String(e.data.text ?? ''));
      break;
    case 'driveon:payNow':
      openPay();
      payNow();
      break;
  }
});

// ───────── 연결 ─────────
connect(
  {
    state: render,
    'gleo.say': (d) => {
      speak(d.text);
      showGleo(d.text);
    },
  },
  (ok) => {
    $('conn').textContent = ok ? '서버 연결됨' : '서버 연결 끊김 — 재시도 중';
    $('conn').classList.toggle('off', !ok);
  },
);
