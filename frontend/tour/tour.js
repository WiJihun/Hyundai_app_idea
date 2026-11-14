// DriveOn UI 둘러보기: 장면마다 서버 상태를 처음부터 다시 만들고 실제 차량 화면·POS를 띄운다.
import { api, connect, esc, hhmm } from '/common/common.js';

const $ = (id) => document.getElementById(id);

// ───────── 장면을 만드는 도구 ─────────
const say = (text) => api('/gleo/utterance', { text });
const act = (a) => api('/gleo/action', a);
const ctl = (action, value) => api('/demo/control', value === undefined ? { action } : { action, value });
const posStep = (step) => async () => {
  const st = await api('/state');
  const o = st.orders.find((x) => x.status === 'SENT');
  if (o) await api(`/pos/orders/${o.id}/${step}`, {});
};
const toCar = (msg) => $('car').contentWindow?.postMessage(msg, location.origin);
const toPos = (msg) => $('pos').contentWindow?.postMessage({ type: 'driveon:pos', ...msg }, location.origin);
const fresh = async () => {
  await ctl('reset');
  await ctl('autoFastForward', false);
};

// 장면끼리 앞 단계를 이어 붙인다
const S = {};
S.home = async () => fresh();
S.call = async () => { await S.home(); await say('글레오, 치킨 시켜줘'); };
S.store = async () => { await S.call(); await say('이번엔 청양마요로'); };
S.stopped = async () => { await S.store(); await ctl('stop'); await act({ type: 'OPEN_MENU' }); };
S.order = async () => { await S.store(); await say('아니'); await say('배달'); };
S.paid = async () => { await S.order(); await act({ type: 'CONFIRM' }); };
S.jam = async () => { await S.paid(); await ctl('skip', 6); await ctl('jam', 6); };
S.sent = async () => { await S.jam(); await ctl('skipToSend'); };
S.accepted = async () => { await S.sent(); await posStep('accept')(); };
S.done = async () => { await S.accepted(); await posStep('complete')(); };
S.way = async () => { await fresh(); await say('치킨 시켜줘'); await say('가는 길에 있는 데로'); };
S.pickupOrder = async () => { await S.way(); await say('숯불바베큐 하나 포장으로'); };
S.pickupPaid = async () => { await S.pickupOrder(); await act({ type: 'CONFIRM' }); };
S.approach = async () => { await S.pickupPaid(); await ctl('skipToSend'); await ctl('skipToApproach'); };
S.arrive = async () => { await S.pickupPaid(); await ctl('skipToSend'); await ctl('skipToStore'); };

/**
 * 장면 목록
 * view: 차량 화면 표시 옵션 — expand(주문 현황 펼치기), quietPayment(앞 단계 결제의 완료 표시·승인 알림 생략)
 * after: 상태를 만든 뒤 화면에 보낼 명령
 */
const SCENES = [
  { ch: '주문하기 (배달)', id: 'home', title: '대기 화면', run: S.home, pos: { store: 's01', tab: 'NEW' },
    desc: '앱을 처음 열었을 때입니다. 배달앱 홈처럼 말하기 안내, 카테고리, 최근 주문이 있습니다. 운전 중에는 말이 기본이고 터치는 보조입니다.',
    try: ['카테고리 ‘치킨’을 눌러 보세요.', '최근 주문의 ‘한 번에 재주문’을 누르면 바로 결제 확인으로 갑니다.', '위쪽 상태바의 Gleo 버튼을 누르고 “치킨 시켜줘”라고 말하거나 입력해 보세요.'] },
  { ch: '주문하기 (배달)', id: 'call', title: '“글레오, 치킨 시켜줘”', run: S.call,
    desc: '한마디로 가게 목록이 뜹니다. 최근 주문 · 집 근처(배달) · 가는 길(포장) 세 묶음이고, 가게 번호는 지도 핀 번호와 같습니다. Gleo는 지난번 메뉴를 먼저 제안합니다.',
    try: ['위쪽 ‘지난번 그대로’를 누르면 고추마요치킨이 담깁니다.', '가게 줄을 눌러 가게 화면으로 들어가 보세요.', 'Gleo 버튼으로 “두 번째 가게”라고 말해도 2번 가게가 열립니다.'] },
  { ch: '주문하기 (배달)', id: 'store', title: '가게 화면 · 메뉴 담기', run: S.store,
    desc: '“이번엔 청양마요로”라고 말하면 해당 매장 메뉴에서만 찾아 담습니다. 가게 화면 위 배달/포장 탭에는 지금 주문하면 몇 시에 매장으로 보낼지가 보이고, 아래 민트 바에는 담은 개수와 금액이 나옵니다.',
    try: ['메뉴 줄을 눌러 더 담아 보세요.', '배달/포장 탭을 바꾸면 전송 시각이 달라집니다.', '아래 민트 바 ‘배달 주문하기’를 누르면 다음 질문으로 넘어갑니다.'] },
  { ch: '주문하기 (배달)', id: 'stopped', title: '정차 중: 전체 메뉴와 사진', run: S.stopped,
    desc: '신호 대기처럼 차가 서 있으면 사진과 전체 메뉴를 보여 줍니다. 주행 중에는 사진을 숨기고 대표 메뉴만 보여 주는 것이 Pleos 주행 제한 규칙입니다.',
    try: ['‘추가 선택’에서 콜라를 눌러 보세요.', '시연 무대의 데모 패널에서 ‘주행’을 누르면 메뉴판이 줄고 Gleo가 이어받습니다.'] },
  { ch: '주문하기 (배달)', id: 'order', title: '주문하기', run: S.order,
    desc: '배달앱의 주문하기 화면입니다. 배달/포장, “집 도착 19:40에 맞춰 19:13에 매장으로 주문을 넣어요”, 수량, 결제수단(인카페이먼트 · 현대카드), 결제금액이 한 화면에 있습니다. Gleo는 결제 전에 금액을 소리 내어 읽습니다.',
    try: ['수량 −/+ 를 눌러 금액이 바뀌는지 보세요.', '‘가는 길에 포장할게요’로 바꾸면 매장이 내비 경유지로 들어갑니다.', '아래 ‘21,900원 결제하기’를 누르면 결제 시트가 열립니다.'] },

  { ch: '결제 (인카페이먼트)', id: 'pay-sheet', title: '결제 시트: 주행 중 음성 승인', run: S.order, after: () => toCar({ type: 'driveon:openPay' }),
    desc: '현대차 인카페이먼트에 등록된 카드가 넘겨 볼 수 있게 놓입니다. 등록 차량(번호판) · Pleos 운전자 프로필 · 디지털 키는 차가 자동으로 확인하고, 주행 중에는 비밀번호 대신 Gleo 음성 승인(“응”)으로 결제합니다. 모든 결제는 모의 결제입니다.',
    try: ['오른쪽에 살짝 보이는 두 번째 카드를 눌러 카드를 바꿔 보세요.', '‘음성 승인으로 결제’를 누르면 결제가 진행됩니다.', '다음 장면에서 정차 중에는 어떻게 다른지 보세요.'] },
  { ch: '결제 (인카페이먼트)', id: 'pay-pin', title: '결제 시트: 정차 중 결제 비밀번호', run: async () => { await S.order(); await ctl('stop'); }, after: () => toCar({ type: 'driveon:openPay' }),
    desc: '차가 서 있으면 결제 비밀번호 6자리를 보안 키패드로 입력합니다. 키패드 숫자는 열 때마다 섞이고, ‘재배열’로 다시 섞을 수 있습니다. 차량·프로필·디지털 키 확인은 주행 중과 같습니다.',
    try: ['숫자 6개를 눌러 보세요(시연용이라 아무 숫자나 됩니다).', '‘재배열’을 누르면 숫자 배치가 바뀝니다.'] },
  { ch: '결제 (인카페이먼트)', id: 'pay-done', title: '결제 완료 · 카드사 승인 알림', run: S.order, after: () => toCar({ type: 'driveon:payNow' }),
    desc: '승인하면 결제 완료 표시가 잠깐 뜨고, 오른쪽 위에 카드사 앱 승인 알림(금액 · 일시불 · 가맹점 · 승인번호)이 6초 동안 나옵니다. 그다음 앱은 미니바로 줄어듭니다.',
    try: ['오른쪽 위 승인 알림을 확인하세요.', '알림이 사라진 뒤 아래 미니바를 누르면 주문 현황이 열립니다.'] },
  { ch: '결제 (인카페이먼트)', id: 'minibar', title: '주문 뒤 미니바', run: S.paid, view: { quietPayment: true },
    desc: '결제 직후 바로 보내지 않습니다. 내비를 넓게 쓰고 아래에 “19:13 전송 · 18분 남음” 미니바만 남깁니다. 잠금화면 실시간 현황(Live Activity)처럼 시각 → 진행 → 메뉴 순서입니다.',
    try: ['미니바를 눌러 주문 현황을 펼쳐 보세요.', '위 시간 조절에서 ×30을 누르면 남은 시간이 빠르게 줄어듭니다.'] },

  { ch: '기다리기 · 매장 전송', id: 'waiting', title: '주문 현황: 전송 대기', run: S.paid, view: { quietPayment: true, expand: true },
    desc: '배달앱 주문 현황처럼 4단계(결제 완료 → 전송 대기 → 매장 접수 → 도착)로 보여 줍니다. 큰 숫자는 매장 전송 시각이고, 아래 계산식(도착 + 여유 − 조리 − 배달)은 내비 시간으로 30초마다 다시 계산됩니다.',
    try: ['‘접기’로 미니바로 돌아가 보세요.', '‘주문 취소’는 전송 전이라 무료로 취소됩니다.', 'Gleo 버튼으로 “치킨 언제 들어가?”라고 물어보세요.'] },
  { ch: '기다리기 · 매장 전송', id: 'jam', title: '정체 → 전송 시각 미루기', run: S.jam, view: { quietPayment: true, expand: true },
    desc: '정체로 집 도착이 19:40에서 19:46으로 늦어지면 전송도 19:13에서 19:19로 자동으로 밀립니다. 숫자만 조용히 바꾸지 않고, 2분 이상 바뀔 때만 원인과 결과를 한 문장으로 말합니다.',
    try: ['주황색 안내 문장과 지도의 빨간 정체 구간을 보세요.', '데모 패널 ‘원활 −3분’을 누르면 다시 당겨집니다.'] },
  { ch: '기다리기 · 매장 전송', id: 'sent', title: '매장 전송 · POS 신규 주문', run: S.sent, view: { quietPayment: true, expand: true }, pos: { store: 's01', tab: 'NEW' },
    desc: '19:19가 되면 매장 POS에 주문이 ‘딱’ 들어옵니다(시연의 마지막 컷). POS에는 배달 출발 목표와 고객 집 도착 예정이 함께 보입니다. 차에서는 Gleo가 “방금 주문을 넣었어요”라고 알립니다.',
    try: ['오른쪽 POS의 ‘접수하기’를 눌러 보세요. 차량 화면이 ‘조리 중’으로 바뀝니다.'] },
  { ch: '기다리기 · 매장 전송', id: 'accepted', title: '매장 접수 · 조리 중', run: S.accepted, view: { quietPayment: true, expand: true }, pos: { store: 's01', tab: 'ACCEPTED' },
    desc: '매장이 접수하면 POS는 처리중 탭으로 옮기고, 운전자에게는 “바삭마요치킨 정자점에서 주문을 접수했어요”라고 한 번 알립니다. 차량 주문 현황 제목도 ‘매장에서 조리 중이에요’로 바뀝니다.',
    try: ['POS ‘조리 완료 · 배달 출발’을 눌러 보세요.'] },
  { ch: '기다리기 · 매장 전송', id: 'done', title: '조리 완료 · 배달 출발', run: S.done, view: { quietPayment: true, expand: true }, pos: { store: 's01', tab: 'DONE' },
    desc: '조리를 마치면 POS 완료 탭으로 가고, 차량 화면은 ‘배달을 출발했어요’가 됩니다. 실제 배달·수령은 시연 범위 밖입니다.',
    try: ['‘새 주문’을 눌러 처음으로 돌아갈 수 있습니다.'] },

  { ch: '포장 (가는 길)', id: 'way', title: '가는 길 가게 고르기', run: S.way, pos: { store: 's03', tab: 'NEW' },
    desc: '“가는 길에 있는 데로”라고 하면 경로에서 5분 안쪽으로 돌아가는 가게가 열립니다. 포장은 배달팁이 없고 최소주문금액도 없습니다.',
    try: ['배달/포장 탭에서 ‘포장’을 눌러 보세요. 내비에 경유지가 생깁니다.', '대표 메뉴를 눌러 담아 보세요.'] },
  { ch: '포장 (가는 길)', id: 'pickup-order', title: '포장 주문하기 · 경유지 추가', run: S.pickupOrder,
    desc: '“숯불바베큐 하나 포장으로”처럼 메뉴와 수령 방식을 한 번에 말하면 바로 주문하기로 갑니다. 매장이 내비 경유지로 들어가고, 전송 시각은 집이 아니라 매장 도착 시각에 맞춥니다. 매장에는 차량번호가 전달됩니다.',
    try: ['내비의 주황색 네모(경유지)를 확인하세요.', '‘배달로 받을게요’로 바꾸면 배달팁이 붙고 전송 시각이 바뀝니다.'] },
  { ch: '포장 (가는 길)', id: 'approach', title: '매장 직전 안내', run: S.approach, view: { quietPayment: true },
    desc: '포장은 들러야 끝납니다. 매장 0.5km 전에 Gleo가 “곧 길목치킨 판교점에 들러요”라고 한 번만 알려 그냥 지나치지 않게 합니다.',
    try: ['화면 위쪽에 잠깐 뜨는 Gleo 안내를 확인하세요.', '시간을 재생하면 곧 매장에 도착합니다.'] },
  { ch: '포장 (가는 길)', id: 'arrive', title: '매장 도착 · 차량번호로 확인', run: S.arrive, view: { quietPayment: true, expand: true }, pos: { store: 's03', tab: 'NEW' },
    desc: '차가 매장에 닿으면 POS에 초록 띠 “12가 3456 고객이 도착했어요 · 음식을 건네 주세요”가 뜹니다. 드라이브스루 차량번호 인식처럼 매장이 차로 고객을 알아봅니다.',
    try: ['POS의 차량번호와 초록 띠를 확인하세요.', '차량 화면은 ‘매장에 도착했어요’로 바뀝니다.'] },

  { ch: '예외 상황', id: 'pay-fail', title: '결제 거절', run: async () => { await fresh(); await say('늘 먹던 걸로 시켜줘'); await ctl('failNextPayment', true); }, after: () => toCar({ type: 'driveon:payNow' }),
    desc: '카드 승인이 거절되면 결제 시트에 이유를 보여 주고 다시 인증할 수 있게 합니다. Gleo도 “결제가 승인되지 않았어요. 다시 시도할까요?”라고 말합니다.',
    try: ['‘다시 승인하기’를 누르면 이번엔 결제됩니다.'] },
  { ch: '예외 상황', id: 'min-order', title: '배달 최소주문 미달', run: async () => { await fresh(); await say('분식 시켜줘'); await say('분식왕'); await say('떡볶이 배달로'); },
    desc: '배달앱처럼 배달은 최소주문금액을 넘어야 합니다. 모자라면 민트 바가 “5,000원 더 담아 주세요”로 바뀌고, Gleo가 더 담거나 포장으로 바꾸라고 안내합니다.',
    try: ['떡볶이를 한 번 더 눌러 10,000원을 채워 보세요.', '배달/포장 탭에서 ‘포장’을 고르면 바로 주문할 수 있습니다.'] },
  { ch: '예외 상황', id: 'late', title: '이미 늦은 주문', run: async () => { await fresh(); await ctl('skip', 40); await say('늘 먹던 걸로 시켜줘'); await act({ type: 'CONFIRM' }); }, view: { expand: true },
    desc: '도착 5분 전에 주문하면 전송 시각이 이미 지났습니다. 이때는 바로 보내고 “도착 후 약 N분 뒤 받으실 수 있어요”라고 솔직하게 안내합니다.',
    try: ['주황색 안내 문장을 확인하세요.'] },
  { ch: '예외 상황', id: 'busy', title: '매장 혼잡 → 전송 당기기', run: async () => { await S.paid(); await api('/pos/stores/s01/congestion', { extraPrepMin: 10 }); }, view: { quietPayment: true, expand: true }, pos: { store: 's01', tab: 'NEW' },
    desc: '매장이 POS에서 조리 시간을 +10분으로 바꾸면 전송 시각이 19:13에서 19:03으로 당겨지고, Gleo가 “매장이 붐벼 조리가 10분 더 걸려서…”라고 이유를 말합니다. 매장이 입력하는 값은 이것 하나뿐입니다.',
    try: ['POS 위쪽 ‘조리 +’ 버튼을 바꿔 보세요.'] },
  { ch: '예외 상황', id: 'cancel', title: '전송 전 취소', run: S.paid, view: { quietPayment: true }, after: () => toCar({ type: 'driveon:say', text: '주문 취소해줘' }),
    desc: '매장으로 보내기 전에는 무료로 취소되고 결제도 함께 취소됩니다. 이미 보낸 뒤에는 “매장 정책에 따라야 해요”라고 안내합니다.',
    try: ['화면 위쪽 Gleo 안내에서 취소 결과를 확인하세요.', '‘치킨’을 눌러 새로 주문해 보세요.'] },
];

// ───────── 화면 맞춤: 실제 해상도로 그린 뒤 축소 ─────────
function fit(vp) {
  const w = Number(vp.dataset.w), h = Number(vp.dataset.h);
  const s = vp.clientWidth / w;
  const f = vp.querySelector('iframe');
  f.style.width = `${w}px`;
  f.style.height = `${h}px`;
  f.style.transform = `scale(${s})`;
  vp.style.height = `${h * s}px`;
}
const ro = new ResizeObserver((entries) => entries.forEach((e) => fit(e.target)));
['carVp', 'posVp'].forEach((id) => ro.observe($(id)));

// ───────── 장면 목록 ─────────
let current = 0;
let wanted = 0;
let queue = Promise.resolve();

function drawList() {
  let ch = '';
  $('scenes').innerHTML = SCENES.map((sc, i) => {
    const head = sc.ch !== ch ? `<div class="chapter">${esc((ch = sc.ch))}</div>` : '';
    return `${head}<button class="scene ${i === current ? 'on' : ''}" data-i="${i}" type="button"><span class="n">${i + 1}</span>${esc(sc.title)}</button>`;
  }).join('');
}

function caption(sc, i) {
  $('count').textContent = `${i + 1} / ${SCENES.length}`;
  $('chapter').textContent = sc.ch;
  $('title').textContent = sc.title;
  $('desc').textContent = sc.desc;
  $('try').innerHTML = sc.try.map((t) => `<li>${esc(t)}</li>`).join('');
  $('prev').disabled = i === 0;
  $('next').disabled = i === SCENES.length - 1;
  $('err').hidden = true;
}

async function show(i) {
  if (i !== wanted) return; // 더 최근에 고른 장면이 있으면 건너뛴다
  const sc = SCENES[i];
  current = i;
  drawList();
  caption(sc, i);
  history.replaceState(null, '', `#${sc.id}`);
  document.querySelectorAll('.viewport').forEach((v) => v.classList.add('loading'));
  try {
    toCar({ type: 'driveon:resetView', expand: !!sc.view?.expand, quietPayment: !!sc.view?.quietPayment });
    await sc.run();
    await ctl('speed', 1);
    await ctl('resume');
    toPos({ store: sc.pos?.store ?? 's01', tab: sc.pos?.tab ?? 'NEW' });
    await new Promise((r) => setTimeout(r, 350)); // 화면이 새 상태를 받을 시간
    sc.after?.();
  } catch (e) {
    $('err').hidden = false;
    $('err').textContent = `장면을 만들지 못했어요: ${e.message}`;
  } finally {
    document.querySelectorAll('.viewport').forEach((v) => v.classList.remove('loading'));
  }
}
function go(i) {
  wanted = Math.max(0, Math.min(SCENES.length - 1, i));
  queue = queue.then(() => show(wanted));
}

$('scenes').addEventListener('click', (e) => {
  const b = e.target.closest('[data-i]');
  if (b) go(Number(b.dataset.i));
});
$('prev').onclick = () => go(current - 1);
$('next').onclick = () => go(current + 1);
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select')) return;
  if (e.key === 'ArrowRight') go(current + 1);
  if (e.key === 'ArrowLeft') go(current - 1);
});

// ───────── 시간 조절 ─────────
$('time').addEventListener('click', (e) => {
  const b = e.target.closest('[data-t]');
  if (!b) return;
  const t = b.dataset.t;
  if (t === 'pause') ctl('pause');
  else ctl('resume').then(() => ctl('speed', Number(t)));
});
connect({
  state: (st) => {
    const c = st.clock;
    const btn = (t, label, on) => `<button data-t="${t}" class="${on ? 'on' : ''}" type="button">${label}</button>`;
    const html = `<b>${esc(st.display)}</b> 시간 ${btn('pause', '⏸', c.paused)}${btn(1, '×1', !c.paused && c.speed === 1)}${btn(30, '×30', !c.paused && c.speed === 30)}${btn(120, '×120', !c.paused && c.speed === 120)}`;
    if ($('time').__h !== html) $('time').innerHTML = $('time').__h = html;
  },
});

// 시작: 주소의 #장면 또는 첫 장면. 두 화면이 연결될 시간을 조금 준다
const start = Math.max(0, SCENES.findIndex((s) => `#${s.id}` === location.hash));
drawList();
caption(SCENES[start], start);
let loaded = 0;
['car', 'pos'].forEach((id) => $(id).addEventListener('load', () => ++loaded === 2 && setTimeout(() => go(start), 600), { once: true }));

// ───────── 대시보드용 캡처: 모든 장면을 돌며 차량 화면·POS를 저장한다 ─────────
// 저장 위치 dashboard/snapshots/NN.json → 그다음 `npm run build:dashboard`로 한 장짜리 HTML을 만든다.
$('capture').onclick = async () => {
  const btn = $('capture');
  btn.disabled = true;
  const clean = (doc) => {
    const b = doc.body.cloneNode(true);
    b.querySelectorAll('script, #conn, .conn').forEach((e) => e.remove());
    return b.innerHTML;
  };
  try {
    for (let i = 0; i < SCENES.length; i++) {
      btn.textContent = `캡처 중 ${i + 1}/${SCENES.length}`;
      go(i);
      await queue;
      await new Promise((r) => setTimeout(r, 900)); // 결제 완료 표시·알림이 떠 있는 동안 찍는다
      const car = $('car').contentDocument, pos = $('pos').contentDocument;
      const sc = SCENES[i];
      await api(`/dev/snapshot/${i + 1}`, {
        i, id: sc.id, chapter: sc.ch, title: sc.title, desc: sc.desc, tryIt: sc.try,
        car: clean(car), pos: clean(pos),
        posStyle: [...pos.querySelectorAll('head style')].map((s) => s.textContent).join('\n'),
      });
    }
    btn.textContent = '캡처 완료 · npm run build:dashboard';
  } catch (e) {
    btn.textContent = `캡처 실패: ${e.message}`;
  } finally {
    btn.disabled = false;
  }
};
