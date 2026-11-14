import { api, connect, esc, hhmm, won, MODE, patch } from '/common/common.js';

const $ = (id) => document.getElementById(id);
const EMOJI = { 치킨: '🍗', 피자: '🍕', 버거: '🍔', 분식: '🍢', 카페: '☕' };
const STATE_LABEL = { DRIVING: '주행 중', STOPPED: '정차 중', PARKED: '주차', PICKUP: '매장 수령 중' };

/** data-act 속성: 클릭하면 같은 의도로 서버에 보낸다(터치 = 음성과 같은 흐름) */
const A = (o) => `data-act="${esc(JSON.stringify(o))}"`;

// ───────── 음성 안내(TTS) ─────────
let ttsOn = true;
try { ttsOn = localStorage.getItem('driveon.tts') !== '0'; } catch {}
function speak(text) {
  if (!ttsOn || !text || !('speechSynthesis' in window)) return;
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
}
$('tts').onclick = () => {
  ttsOn = !ttsOn;
  try { localStorage.setItem('driveon.tts', ttsOn ? '1' : '0'); } catch {}
  if (!ttsOn) speechSynthesis?.cancel();
  renderTts();
};
renderTts();

// ───────── 입력: 말하기 / 터치 ─────────
async function say(text) {
  text = text.trim();
  if (!text) return;
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
  if (rec) {
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
  try { rec?.stop(); } catch {}
}
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
function showGleo(text) {
  if (!text) return;
  $('gleoToast').innerHTML = `<span class="g-dot"></span><span>${esc(text)}</span>`;
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

function renderStatus(st) {
  const c = st.car;
  const traffic =
    c.traffic === 'JAM' ? `<span class="traffic JAM">정체 +${c.delayMin}분</span>`
    : c.traffic === 'FAST' ? `<span class="traffic FAST">원활 ${c.delayMin}분</span>` : '';
  patch($('status'), `
    <span class="clock">${esc(st.display)}</span>
    <span class="badge ${c.state}">${STATE_LABEL[c.state] ?? c.state}</span>
    <span class="speed">${c.speedKmh} km/h</span>
    ${traffic}
    <span class="spacer"></span>
    ${st.clock.paused ? '<span class="tag bad">일시정지</span>' : st.clock.speed !== 1 ? `<span class="tag">시연 ${st.clock.speed}배속</span>` : ''}
    <span class="brand">DriveOn · Pleos Connect</span>`);
}

// 지도: 경로·차·집·가게를 단순 평면 투영으로 그린다(지도 타일 없음)
function distKm(a, b) {
  const r = (d) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
function sliceRoute(pts, fromKm, toKm) {
  const out = [];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const d = distKm(a, b);
    const lerp = (k) => ({ lat: a.lat + (b.lat - a.lat) * k, lng: a.lng + (b.lng - a.lng) * k });
    const s = Math.max(fromKm, acc), e = Math.min(toKm, acc + d);
    if (e > s && d > 0) {
      if (!out.length) out.push(lerp((s - acc) / d));
      out.push(lerp((e - acc) / d));
    }
    acc += d;
  }
  return out;
}

function renderNav(st) {
  const c = st.car;
  const pts = c.routePoints;
  const h = st.session.home;
  const stores = [...h.nearHome, ...h.onTheWay];
  const all = [...pts, ...stores.map((s) => s.pos)];
  const minLat = Math.min(...all.map((p) => p.lat)) - 0.006, maxLat = Math.max(...all.map((p) => p.lat)) + 0.006;
  const minLng = Math.min(...all.map((p) => p.lng)) - 0.008, maxLng = Math.max(...all.map((p) => p.lng)) + 0.008;
  const kx = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
  const W = 560, H = 380;
  const S = Math.min(W / ((maxLng - minLng) * kx), H / (maxLat - minLat));
  const ox = (W - (maxLng - minLng) * kx * S) / 2, oy = (H - (maxLat - minLat) * S) / 2;
  const P = (p) => [(p.lng - minLng) * kx * S + ox, (maxLat - p.lat) * S + oy].map((n) => n.toFixed(1)).join(',');
  const line = (arr) => arr.map(P).join(' ');

  const done = sliceRoute(pts, 0, c.progressKm);
  const jam = c.traffic === 'JAM' ? sliceRoute(pts, c.progressKm, c.progressKm + 3) : [];
  const selId = st.session.store?.id;
  // 호출 화면 카드와 같은 번호를 지도 핀에 찍는다 (Android Place List · CarPlay POI)
  // 가까운 가게끼리 핀이 겹치면 옆으로 밀고 실제 위치까지 가는 선을 긋는다
  const placed = [];
  const storePins = stores.map((s, i) => {
    const [x0, y0] = P(s.pos).split(',').map(Number);
    let x = x0;
    const y = y0;
    while (placed.some(([px, py]) => Math.hypot(px - x, py - y) < 24)) x += 26;
    placed.push([x, y]);
    const sel = s.storeId === selId;
    return `${x !== x0 ? `<line x1="${x0}" y1="${y0}" x2="${x}" y2="${y}" stroke="#5a6b80" stroke-width="1.5"/>` : ''}
      <g class="pin ${sel ? 'sel' : ''}"><circle cx="${x}" cy="${y}" r="11"/>
      <text x="${x}" y="${+y + 4.5}" text-anchor="middle">${i + 1}</text></g>
      ${sel ? `<text class="pin-label sel" x="${+x + 15}" y="${+y + 4}">${esc(s.name)}</text>` : ''}`;
  }).join('');
  const wp = c.waypoint && !c.waypoint.done ? (() => { const [x, y] = P(c.waypoint.pos).split(','); return `<rect class="pin-wp" x="${x - 7}" y="${y - 7}" width="14" height="14" rx="3"/>`; })() : '';
  const [hx, hy] = P(pts[pts.length - 1]).split(',');
  const [sx, sy] = P(pts[0]).split(',');
  const [cx, cy] = P(c.position).split(',');

  const svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="내비 경로">
    <rect class="map-bg" width="${W}" height="${H}" rx="10"/>
    <polyline class="route-all" points="${line(pts)}"/>
    ${done.length > 1 ? `<polyline class="route-done" points="${line(done)}"/>` : ''}
    ${jam.length > 1 ? `<polyline class="route-all route-jam" points="${line(jam)}"/>` : ''}
    ${storePins}
    <circle class="pin-office" cx="${sx}" cy="${sy}" r="5"/><text class="pin-label" x="${+sx + 9}" y="${+sy + 4}">회사</text>
    <circle class="pin-home" cx="${hx}" cy="${hy}" r="8"/><text class="pin-label" x="${+hx + 11}" y="${+hy + 4}" style="fill:var(--ok)">집</text>
    ${wp}
    <circle class="car-dot" cx="${cx}" cy="${cy}" r="9"/>
  </svg>`;

  const eta = `<div class="eta">
      <div><span class="lbl">집 도착</span><span class="big">${hhmm(c.etaDestination)}</span></div>
      <div><span class="lbl">남은 거리</span><b>${c.remainingKm} km</b></div>
      ${c.waypoint && !c.waypoint.done ? `<div><span class="lbl">경유 ${esc(c.waypoint.name)}</span><b>${hhmm(c.etaWaypoint)}</b></div>` : ''}
    </div>`;
  patch($('nav'), svg + eta);
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
  if (s.suggestRecent) quick = `<button class="ans" ${A({ type: 'CONFIRM' })}>지난번 그대로</button><button ${A({ type: 'DENY' })}>다른 메뉴</button>`;
  else if (s.phase === 'ASK_UPSELL') quick = `<button class="ans" ${A({ type: 'CONFIRM' })}>음료 추가</button><button ${A({ type: 'DENY' })}>괜찮아요</button>`;
  else if (s.phase === 'ASK_MODE') quick = `<button class="ans" ${A({ type: 'CHOOSE_MODE', mode: 'DELIVERY' })}>배달</button><button class="ans" ${A({ type: 'CHOOSE_MODE', mode: 'PICKUP' })}>포장</button>`;
  patch($('question'), !['IDLE', 'ORDERED'].includes(s.phase) && lastGleo ? `<div class="bubble"><b>Gleo</b>${esc(lastGleo.text)}</div>${quick}` : '');

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
    bottom = `<button class="text-btn" ${A({ type: 'DENY' })}>메뉴 바꾸기</button>
      <button class="mint cart-bar" data-ui="pay"><span class="lbl">${won(s.total)} 결제하기</span></button>`;
  } else if (s.cart.length && s.phase !== 'ORDERED') {
    const count = s.cart.reduce((n, l) => n + l.qty, 0);
    const m = s.mode ?? 'DELIVERY';
    const when = s.preview?.[m]?.display;
    const short = m === 'DELIVERY' && s.store && s.itemsTotal < s.store.minOrder;
    bottom = `<button class="mint cart-bar" ${A({ type: 'CONFIRM' })}>
      <span class="cnt">${count}</span>
      <span class="lbl">${short
        ? `배달 최소주문 ${won(s.store.minOrder)} · ${won(s.store.minOrder - s.itemsTotal)} 더 담아 주세요`
        : `${MODE[m]} 주문하기${when ? ` <span class="when">· ${when} 매장 전송</span>` : ''}`}</span>
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

const rate = (r, n) => `<span class="star">★</span> <b>${r.toFixed(1)}</b> <span style="color:var(--bm-sub)">(${n.toLocaleString('ko-KR')})</span>`;

function recentCards(h) {
  return h.recent.map((r, i) => `
    <button class="recent-card" ${A({ type: 'REORDER', index: i })}>
      <span class="nm">${esc(r.items.map((x) => `${x.name}${x.qty > 1 ? ` ×${x.qty}` : ''}`).join(', '))}</span>
      <span class="st">${esc(r.storeName)} · ${won(r.total)} · ${MODE[r.mode]}</span>
      <span class="go">한 번에 재주문 ›</span>
    </button>`).join('');
}

// 홈: 말하기 안내 + 카테고리 + 최근 주문
function homeView(s) {
  const cats = Object.entries(EMOJI).map(([c, e]) => `<button ${A({ type: 'START', category: c })}><span class="ic">${e}</span><span>${c}</span></button>`).join('');
  const rc = recentCards(s.home);
  return `<div class="home-search" data-ui="mic">🎙 <span><b>글레오</b>에게 말해 보세요 · “치킨 시켜줘”</span></div>
    <div class="cat-grid">${cats}</div>
    ${rc ? `<div class="sec"><div class="sec-title">최근 주문<small>말 한마디로 다시 주문</small></div><div class="recent-row">${rc}</div></div>` : ''}`;
}

// 가게 목록: 카테고리 탭 + 최근 주문 + 집 근처(배달) + 가는 길(포장)
function listView(s) {
  const h = s.home;
  const no = storeNumbers(h);
  const sel = s.store?.id;
  const tabs = Object.keys(EMOJI).map((c) => `<button class="${s.category === c ? 'on' : ''}" ${A({ type: 'START', category: c })}>${c}</button>`).join('');
  const row = (c, kind) => `
    <button class="store-row ${c.storeId === sel ? 'sel' : ''}" ${A({ type: 'SELECT_STORE', storeId: c.storeId })}>
      <div class="thumb">${EMOJI[c.category] ?? '🍽'}</div>
      <div class="info">
        <div class="nm"><span class="no">${no.get(c.storeId)}</span>${esc(c.name)}</div>
        <div class="l2">${rate(c.rating, c.reviews)} · 조리 ${c.prepMin}분</div>
        <div class="l3">${kind === 'near'
          ? `${c.deliveryTip === 0 ? '<span class="badge-free">무료배달</span>' : `배달팁 ${won(c.deliveryTip)}`} · 최소주문 ${won(c.minOrder)} · 집에서 ${c.distanceFromHomeKm}km`
          : `<span class="badge-pick">포장</span> 가는 길 +${c.detourMin}분 우회 · ${esc(c.topItems[0]?.name ?? '')}`}</div>
      </div>
    </button>`;
  const rc = recentCards(h);
  return `<div class="cat-tabs">${tabs}</div>
    ${rc ? `<div class="sec"><div class="sec-title">최근 주문</div><div class="recent-row">${rc}</div></div>` : ''}
    <div class="sec" style="padding:0"><div class="sec-title" style="padding:16px 18px 0">집 근처 · 배달<small>집에서 2km 안</small></div>
      ${h.nearHome.map((c) => row(c, 'near')).join('') || '<div class="hint-line">집 근처 가게가 없어요</div>'}</div>
    <div class="sec" style="padding:0"><div class="sec-title" style="padding:16px 18px 0">가는 길 · 포장<small>5분 이내 우회</small></div>
      ${h.onTheWay.map((c) => row(c, 'way')).join('') || '<div class="hint-line">가는 길에 들를 가게가 없어요</div>'}</div>`;
}

// 가게 화면: 가게 정보 + 배달/포장 탭 + 대표 메뉴(주행 중) / 전체 메뉴(정차 중)
function storeView(st) {
  const s = st.session;
  const store = s.store;
  const restricted = st.car.uxRestricted;
  const m = s.mode ?? 'DELIVERY';
  const p = s.preview;
  const card = [...s.home.nearHome, ...s.home.onTheWay].find((c) => c.storeId === store.id);
  const qtyOf = (id) => s.cart.filter((l) => l.itemId === id).reduce((n, l) => n + l.qty, 0);
  const row = (i) => `
    <button class="menu-row" ${A({ type: 'ADD_ITEM', itemId: i.id })}>
      <div class="info">
        <span class="nm">${i.popular ? '<span class="badge-best">대표</span>' : ''}${esc(i.name)}</span>
        ${i.desc ? `<span class="ds">${esc(i.desc)}</span>` : ''}
        <span class="pr">${won(i.price)} ${qtyOf(i.id) ? `<span class="in-cart">· ${qtyOf(i.id)}개 담음</span>` : ''}</span>
      </div>
      <div class="thumb">${EMOJI[store.category] ?? '🍽'}</div>
    </button>`;
  const popular = store.items.filter((i) => i.popular);
  const rest = store.items.filter((i) => !i.popular);
  const tab = (mode, label, sub) => `<button class="${m === mode ? 'on' : ''}" ${A({ type: 'SET_MODE', mode })}><b>${label}</b><small>${sub}</small></button>`;
  const opts = s.cart.length && store.options.length
    ? `<div class="sec"><div class="sec-title">추가 선택<small>마지막에 담은 메뉴에 추가</small></div><div class="opts">${store.options.map((o) => `<button ${A({ type: 'ADD_OPTION', optionIds: [o.id] })}>${esc(o.name)} +${won(o.price)}</button>`).join('')}</div></div>`
    : '';
  return `<div class="store-head">
      <div style="text-align:left"><button class="text-btn" data-ui="list" style="text-decoration:none">‹ 가게 목록</button></div>
      <h2>${esc(store.name)}</h2>
      <div class="rate">${rate(store.rating, store.reviews)}</div>
      <div class="facts"><span>최소주문 <b>${won(store.minOrder)}</b></span><span>배달팁 <b>${store.deliveryTip ? won(store.deliveryTip) : '무료'}</b></span><span>조리 약 <b>${Math.max(...store.items.map((i) => i.prepMin))}분</b></span></div>
      <div class="mode-tabs">
        ${tab('DELIVERY', '배달', p ? `<span class="time">${p.DELIVERY.display}</span> 전송 · 집 도착 맞춤` : '집 도착에 맞춰 전송')}
        ${tab('PICKUP', '포장', p?.PICKUP ? `<span class="time">${p.PICKUP.display}</span> 전송 · 매장 경유${card ? ` +${card.detourMin}분` : ''}` : `매장 경유${card ? ` +${card.detourMin}분` : ''} · 배달팁 없음`)}
      </div>
    </div>
    <div class="sec" style="padding:0"><div class="sec-title" style="padding:16px 18px 4px">대표 메뉴</div>${popular.map(row).join('')}</div>
    ${rest.length
      ? s.menuOpen && !restricted
        ? `<div class="sec" style="padding:0"><div class="sec-title" style="padding:16px 18px 4px">전체 메뉴</div>${rest.map(row).join('')}</div>`
        : restricted
          ? '<div class="hint-line">주행 중에는 대표 메뉴만 보여요 · 전체 메뉴는 정차 중에 볼 수 있어요</div>'
          : `<button class="more" ${A({ type: 'OPEN_MENU' })}>전체 메뉴 ${rest.length}개 보기 ›</button>`
      : ''}
    ${opts}`;
}

// 주문하기: 배달/포장 · 도착 맞춤 · 주문 메뉴(수량) · 결제수단 · 결제금액
function payView(st) {
  const s = st.session;
  const c = st.car;
  const mode = s.mode ?? 'DELIVERY';
  const send = s.preview?.[mode]?.display;
  const card = s.cards.find((x) => x.id === s.cardId) ?? s.cards[0];
  const cardIdx = s.cards.indexOf(card);
  const lines = s.cart.map((l, i) => `
    <div class="line">
      <div class="nm">${esc(l.name)}${l.options.length ? `<small>+ ${esc(l.options.join(', '))}</small>` : ''}</div>
      <div class="stepper"><button ${A({ type: 'SET_QTY', index: i, qty: l.qty - 1 })} aria-label="빼기">−</button><span>${l.qty}</span><button ${A({ type: 'SET_QTY', index: i, qty: l.qty + 1 })} aria-label="더하기">+</button></div>
      <div class="pr">${won(l.lineTotal)}</div>
    </div>`).join('');
  const fit = mode === 'DELIVERY'
    ? `집 도착 <b>${hhmm(c.etaDestination)}</b>에 맞춰 ${send ? `<span class="time">${send}</span>에` : ''} 매장으로 주문을 넣어요.`
    : `${esc(s.store.name)} 도착 <b>${hhmm(c.etaWaypoint)}</b>에 맞춰 ${send ? `<span class="time">${send}</span>에` : ''} 주문을 넣어요. 매장이 차량번호로 알아봐요.`;
  return `<div class="order-title">주문하기</div>
    <div class="sec">
      <div class="seg">
        <button class="${mode === 'DELIVERY' ? 'on' : ''}" ${A({ type: 'SET_MODE', mode: 'DELIVERY' })}>배달로 받을게요</button>
        <button class="${mode === 'PICKUP' ? 'on' : ''}" ${A({ type: 'SET_MODE', mode: 'PICKUP' })}>가는 길에 포장할게요</button>
      </div>
      <div class="fit">${fit}</div>
    </div>
    <div class="sec"><div class="sec-title">${esc(s.store.name)}</div>${lines}</div>
    <div class="sec"><div class="sec-title">결제수단</div>
      <div class="paymethod"><span class="mini-card ${cardIdx % 2 ? 'silver' : ''}">${esc(card.issuer)}</span>
        <span><b>인카페이먼트</b><br/><small style="color:var(--bm-sub)">${esc(card.name)} ··${esc(card.last4)} · 일시불</small></span>
        <button class="chg" data-ui="pay">변경</button></div>
    </div>
    <div class="sec"><div class="sec-title">결제금액</div>
      <div class="sum-row"><span>주문금액</span><span>${won(s.itemsTotal)}</span></div>
      <div class="sum-row"><span>배달팁</span><span>${won(s.deliveryTip)}</span></div>
      <div class="sum-row total"><span>총 결제금액</span><span>${won(s.total)}</span></div>
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
  const items = o.lines.map((l) => `${esc(l.name)} ${l.qty}`).join(', ');
  const pay = o.payment.card ? `${esc(o.payment.card.name)}(${esc(o.payment.card.last4)}) ${esc(o.payment.installment)}` : '인카페이먼트';
  const info = `<div class="sec"><div class="sec-title">주문 정보</div><div class="kv">
      <span>가게</span><span>${esc(o.storeName)}</span>
      <span>메뉴</span><span>${items}</span>
      <span>받는 방법</span><span>${MODE[o.mode]}${o.vehicle ? ` · 차량 ${esc(o.vehicle.plate)}` : ''}</span>
      <span>결제</span><span>${pay} · <b>${won(o.total)}</b></span></div></div>`;
  // idx: 지금 단계(그 앞은 완료). fill: 단계 점 사이 막대 폭(%) — 점 간격 25%, 전체 75%
  const steps = (idx, fill) => {
    const storeStep = o.storeStatus === 'DONE' ? '조리 완료' : o.storeStatus === 'ACCEPTED' ? '매장 접수 · 조리 중' : '매장 접수';
    const storeTime = o.doneAt ?? o.acceptedAt ?? o.sentAt ?? o.dispatchAt;
    const labels = [['결제 완료', hhmm(o.createdAt)], ['전송 대기', ''], [storeStep, hhmm(storeTime)], [`${place} 도착`, hhmm(o.pickupEta)]];
    return `<div class="steps4"><div class="fill" style="width:${Math.min(75, Math.max(0, fill)).toFixed(1)}%"></div>
      ${labels.map(([l, t], i) => `<div class="st ${i < idx ? 'done' : i === idx ? 'now' : ''}"><span class="dot"></span>${l}${t ? `<small>${t}</small>` : ''}</div>`).join('')}</div>`;
  };

  if (o.status === 'SCHEDULED') {
    const sign = o.marginMin >= 0 ? '+' : '−';
    return `<div class="status-head">
        <div class="t1">주문이 예약됐어요</div>
        <div class="p0"><span class="big">${hhmm(o.dispatchAt)}</span>매장 전송 예정 · ${minutesLeft(o.dispatchAt - st.now)}</div>
        ${notice ? `<div class="why">${esc(notice.text)}</div>` : ''}
        ${steps(1, 25 + 25 * progress(o, st.now))}
        <div class="formula">${place} 도착 ${hhmm(o.pickupEta)} ${sign} 여유 ${Math.abs(o.marginMin)}분 − 조리 ${o.prepMin}분${o.mode === 'DELIVERY' ? ` − 배달 ${o.deliveryMin}분` : ''} = <b class="time">${hhmm(o.dispatchAt)}</b> · 내비 시간으로 30초마다 다시 계산</div>
      </div>
      ${info}
      <div class="sec act-row"><button data-ui="collapse">접기</button><button class="cancel" ${A({ type: 'CANCEL' })}>주문 취소 (전송 전 무료)</button></div>`;
  }
  if (o.status === 'SENT') {
    const arrived = !!o.customerArrivedAt;
    return `<div class="status-head">
        <div class="t1">${arrived ? '매장에 도착했어요'
          : o.storeStatus === 'DONE' ? (o.mode === 'DELIVERY' ? '배달을 출발했어요' : '음식이 준비됐어요')
          : o.storeStatus === 'ACCEPTED' ? '매장에서 조리 중이에요'
          : '매장에 주문이 들어갔어요'}</div>
        <div class="p0 sent"><span class="big">${o.display.sentAt}</span>매장 전송 완료</div>
        ${o.lateMin ? `<div class="why">주문할 때 이미 늦어서 바로 보냈어요. 도착 후 약 ${o.lateMin}분 뒤 받을 수 있어요.</div>` : ''}
        ${steps(arrived ? 4 : 3, arrived ? 75 : 50 + 25 * progress(o, st.now))}
        <div class="formula">${place} 도착 예정 ${o.display.pickupEta} · ${o.mode === 'DELIVERY' ? '음식 도착 예정' : '음식 준비 예정'} ${o.display.readyAt}</div>
      </div>
      ${info}
      <div class="sec act-row"><button data-ui="collapse">접기</button><button ${A({ type: 'START' })}>새 주문</button></div>`;
  }
  return `<div class="status-head"><div class="t1">주문이 취소됐어요</div><div class="formula">결제도 함께 취소됐어요.</div></div>
    ${info}<div class="sec act-row"><button ${A({ type: 'START' })}>새 주문</button></div>`;
}

// 주문 뒤 미니바 (Live Activity): 시각 · 진행 · 메뉴·가게. 누르면 주문 현황
function liveView(st, o) {
  const what = `<span class="p1">${esc(shortItem(o.lines[0].name))}${o.lines.length > 1 ? ` 외 ${o.lines.length - 1}` : ''} · ${esc(shortStore(o.storeName))}</span>`;
  if (o.status === 'SENT') {
    return `<span class="dot sent"></span><span class="t sent">${o.display.sentAt} 매장으로 전송함</span>
      <span style="color:var(--bm-sub)">${o.mode === 'DELIVERY' ? '집' : '매장'} 도착 ${o.display.pickupEta}</span><span class="prog" style="visibility:hidden"></span>${what}<span class="open">크게 보기</span>`;
  }
  return `<span class="dot"></span><span class="t">${hhmm(o.dispatchAt)} 전송</span><span class="left">${minutesLeft(o.dispatchAt - st.now)}</span>
    <span class="prog"><i style="width:${(progress(o, st.now) * 100).toFixed(1)}%"></i></span>${what}<span class="open">크게 보기</span>`;
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
