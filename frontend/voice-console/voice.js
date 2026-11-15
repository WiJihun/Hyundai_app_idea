import { api, connect, esc, hhmm, won, MODE } from '/common/common.js';

/**
 * Gleo 음성 주문 콘솔
 *  말(또는 입력) → ① 음성 인식 → ② 의도 파악(NLU) → ③ 대화 상태 → ④ 주문 처리 → ⑤ 음성 답변
 *  각 단계의 결과와 걸린 시간, 'Pleos로 옮기면 무엇으로 바뀌는지'를 함께 보여 준다.
 */
const $ = (id) => document.getElementById(id);

const INTENT_KO = {
  START_FOOD_ORDER: '주문 시작', REORDER_FAVORITE: '늘 먹던 걸로 재주문', CHECK_ORDER_STATUS: '주문 상태 묻기', CANCEL: '주문 취소',
  SELECT_STORE: '가게 고르기', OPEN_MENU: '메뉴판 열기', CLOSE_MENU: '메뉴판 닫기', ADD_ITEM: '메뉴 담기', ADD_OPTION: '추가 메뉴 담기',
  REMOVE_ITEM: '메뉴 빼기', CHOOSE_MODE: '배달·포장 고르기', CONFIRM: '네 (확인)', DENY: '아니요', UNKNOWN: '알아듣지 못함',
};
const PHASE_KO = { IDLE: '대기', BROWSE: '가게·메뉴 고르는 중', ASK_UPSELL: '추가 메뉴 묻는 중', ASK_MODE: '배달·포장 묻는 중', ASK_PAY: '결제 확인 중', ORDERED: '주문 완료' };
const REF_KO = { NEAR_HOME: '집 근처', ON_THE_WAY: '가는 길' };
const EXAMPLES = ['글레오, 치킨 시켜줘', '이번엔 청양마요로', '콜라도 하나', '아니', '배달', '응', '치킨 언제 들어가?', '늘 먹던 걸로 시켜줘', '가는 길에 있는 데로', '취소해줘'];

const STEPS = [
  { ic: '🎙️', name: '음성 인식', now: '브라우저 음성 인식 (Web Speech API · ko-KR)', pleos: 'Pleos SpeechToText SDK · Gleo AI' },
  { ic: '🧠', name: '의도 파악', now: '한국어 규칙 기반 NLU (server/gleo/nlu.ts)', pleos: 'Gleo Interface — App Schema 함수 호출(LLM)' },
  { ic: '🔁', name: '대화 상태', now: '대화 관리 (server/gleo/dialog.ts)', pleos: '그대로 사용' },
  { ic: '🧾', name: '주문 처리', now: '장바구니·주문·전송 시각 계산 (orders.ts · 내비 ETA)', pleos: 'NaviHelper 남은 시간으로 계산' },
  { ic: '🔊', name: '음성 답변', now: '브라우저 음성 합성 (speechSynthesis · ko-KR)', pleos: 'Pleos TextToSpeech SDK' },
];

const turns = [];
let selected = -1;
let last = null; // 마지막 /state

// ───────── 대화창 ─────────
const timeFmt = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
function bubble(who, text, { turn = -1, notice = false, interim = false } = {}) {
  const el = document.createElement('div');
  el.className = `msg ${who}${notice ? ' notice' : ''}${interim ? ' interim' : ''}`;
  if (turn >= 0) el.dataset.turn = turn;
  el.innerHTML = `${who === 'gleo' ? '<span class="av" aria-hidden="true"></span>' : ''}<div class="b">${esc(text)}</div><div class="t">${interim ? '듣는 중…' : (notice ? 'Gleo 알림 · ' : '') + timeFmt.format(new Date())}</div>`;
  $('log').querySelector('.empty')?.remove();
  $('log').append(el);
  $('log').scrollTop = $('log').scrollHeight;
  return el;
}
function emptyLog() {
  $('log').innerHTML = `<div class="empty"><div class="big">🎙️</div>마이크를 누르고 말하거나<br/>아래 예시를 눌러 보세요</div>`;
}
$('log').addEventListener('click', (e) => {
  const m = e.target.closest('.msg[data-turn]');
  if (m) select(+m.dataset.turn);
});
function select(i) {
  selected = i;
  document.querySelectorAll('.msg.sel').forEach((m) => m.classList.remove('sel'));
  document.querySelectorAll(`.msg[data-turn="${i}"]`).forEach((m) => m.classList.add('sel'));
  renderSteps(turns[i], STEPS.length);
}

// ───────── 처리 과정 ─────────
function stepHtml(i, t, shown) {
  const s = STEPS[i];
  const state = !t ? '' : i < shown - 1 ? 'done' : i === shown - 1 ? 'now done' : '';
  let out = '';
  let ms = '';
  if (t && i < shown) {
    if (i === 0) {
      ms = t.stt.ms != null ? `${t.stt.ms} ms` : '';
      out = `<div class="quote">“${esc(t.text)}”</div>
        <div class="kv"><span>입력<b>${t.stt.source === 'mic' ? '🎙️ 음성' : '⌨️ 입력·예시'}</b></span>${t.stt.confidence != null ? `<span>인식 확신도<b>${Math.round(t.stt.confidence * 100)}%</b></span>` : ''}</div>
        ${t.stt.alts?.length ? `<div class="muted">다른 후보: ${t.stt.alts.map((a) => `“${esc(a)}”`).join(' · ')}</div>` : ''}`;
    } else if (i === 1) {
      ms = `${t.ms.nlu} ms`;
      const n = t.nlu ?? { intent: t.intent };
      const slots = [
        n.category && ['카테고리', n.category],
        n.storeName && ['가게', n.storeName],
        n.storeRef && ['가게 묶음', REF_KO[n.storeRef] ?? n.storeRef],
        n.index != null && ['번호', `${n.index + 1}번째`],
        n.itemName && ['메뉴', n.itemName],
        n.qty && ['수량', `${n.qty}개`],
        n.optionNames?.length && ['추가', n.optionNames.join(', ')],
        n.mode && ['방식', MODE[n.mode] ?? n.mode],
      ].filter(Boolean);
      out = `<div class="intent"><b>${esc(INTENT_KO[n.intent] ?? n.intent)}</b><code>${esc(n.intent)}</code></div>
        ${slots.length ? `<div class="kv">${slots.map(([k, v]) => `<span>${k}<b>${esc(v)}</b></span>`).join('')}</div>` : '<div class="muted">추가로 뽑은 정보 없음</div>'}
        <pre>${esc(JSON.stringify(stripNames(n), null, 0))}</pre>
        ${n.intent === 'UNKNOWN' ? '<div class="bad">문장을 이해하지 못했어요 → 다시 말해 달라고 답합니다</div>' : ''}`;
    } else if (i === 2) {
      out = `<div class="arrow"><span class="ph">${esc(PHASE_KO[t.before] ?? t.before)}</span>→<span class="ph to">${esc(PHASE_KO[t.after] ?? t.after)}</span></div>
        ${t.needsConfirm ? '<div class="muted">다음 말로 “응/아니” 확인을 기다려요</div>' : ''}`;
    } else if (i === 3) {
      out = orderHtml(t.snap);
    } else if (i === 4) {
      out = `<div class="quote">${esc(t.tts)}</div><div class="muted">${$('ttsOn').checked && 'speechSynthesis' in window ? '🔊 한국어 음성으로 읽어 줌' : '🔇 음성 답변 꺼짐'}</div>`;
    }
  }
  return `<li class="step ${state}">
      <span class="n">${s.ic}</span>
      <div class="h"><b>${i + 1}. ${s.name}</b><span class="ms">${ms}</span></div>
      <div class="how">지금: ${esc(s.now)} · Pleos로 옮기면: <em>${esc(s.pleos)}</em></div>
      ${out ? `<div class="out">${out}</div>` : ''}
    </li>`;
}
const stripNames = ({ storeName, itemName, optionNames, ...rest }) => rest;

function orderHtml(snap) {
  if (!snap) return '<div class="muted">–</div>';
  const s = snap.session;
  const o = s.order;
  const rows = [];
  if (s.store) rows.push(`<div class="kv"><span>가게<b>${esc(s.store.name)}</b></span>${s.mode ? `<span>방식<b>${MODE[s.mode]}</b></span>` : ''}</div>`);
  if (s.cart?.length) rows.push(`<div class="kv">${s.cart.map((l) => `<span>${esc(l.name)}<b>×${l.qty}</b></span>`).join('')}<span>합계<b>${won(s.total)}</b></span></div>`);
  if (o) {
    rows.push(o.status === 'SCHEDULED'
      ? `<div>📤 매장 전송 예약 <span class="send-time">${hhmm(o.dispatchAt)}</span></div><div class="muted">집 도착 ${hhmm(o.pickupEta)}에 맞춰 조리 ${o.prepMin}분${o.mode === 'DELIVERY' ? ` + 배달 ${o.deliveryMin}분` : ''}을 거꾸로 계산</div>`
      : o.status === 'SENT'
        ? `<div>✅ 매장으로 전송됨 <span class="send-time">${esc(o.display?.sentAt ?? '')}</span></div><div class="muted">집 도착 예정 ${esc(o.display?.pickupEta ?? '')}${o.lateMin ? ` · 이미 늦어 바로 보냄(도착 후 약 ${o.lateMin}분)` : ''}</div>`
        : `<div class="bad">주문 ${esc(o.status)}</div>`);
  }
  if (!rows.length) rows.push(`<div class="muted">${s.phase === 'BROWSE' ? '가게 목록을 보여 줌' : '바뀐 주문 정보 없음'}</div>`);
  return rows.join('');
}

function renderSteps(t, shown) {
  $('steps').innerHTML = STEPS.map((_, i) => stepHtml(i, t, shown)).join('');
  $('flowSub').textContent = t ? `“${t.text}” · 전체 ${t.ms.total} ms` : '말을 하면 여기에 단계가 나타나요';
}

// ───────── 보내기 ─────────
let busy = false;
async function send(text, stt = { source: 'typed' }) {
  text = text.trim();
  if (!text || busy) return;
  busy = true;
  const idx = turns.length;
  bubble('user', text, { turn: idx });
  const t0 = performance.now();
  try {
    const before = last ?? (await api('/state'));
    const t1 = performance.now();
    const res = await api('/gleo/utterance', { text });
    const t2 = performance.now();
    const snap = await api('/state');
    last = snap;
    const t = {
      text, stt, intent: res.intent, nlu: res.nlu, tts: res.ttsText, needsConfirm: res.needsConfirm,
      before: before.session.phase, after: snap.session.phase, snap,
      ms: { nlu: Math.round(t2 - t1), total: Math.round(performance.now() - t0 + (stt.ms ?? 0)) },
    };
    turns.push(t);
    // 단계가 차례로 켜지게
    selected = idx;
    for (let k = 1; k <= STEPS.length; k++) {
      renderSteps(t, k);
      await new Promise((r) => setTimeout(r, 220));
    }
    bubble('gleo', t.tts, { turn: idx });
    select(idx);
    speak(t.tts);
  } catch (e) {
    bubble('gleo', `서버 오류: ${e.message}`, { notice: true });
  } finally {
    busy = false;
  }
}

$('sayForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('sayInput').value;
  $('sayInput').value = '';
  send(v);
});
$('chips').innerHTML = EXAMPLES.map((x) => `<button type="button">${esc(x)}</button>`).join('');
$('chips').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) send(b.textContent);
});
$('reset').addEventListener('click', async () => {
  await api('/demo/control', { action: 'reset' });
  turns.length = 0;
  emptyLog();
  renderSteps(null, 0);
});

// ───────── 음성 답변 (TTS) ─────────
function speak(text) {
  if (!$('ttsOn').checked || !('speechSynthesis' in window) || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ko-KR';
  const v = speechSynthesis.getVoices().find((x) => x.lang?.startsWith('ko'));
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}

// ───────── 음성 인식 (STT) ─────────
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
let interimEl = null;
if (!SR) {
  $('micNote').textContent = '이 브라우저는 음성 인식을 지원하지 않아요. Chrome·Edge에서 열거나 입력칸을 쓰세요.';
  $('mic').disabled = true;
} else {
  $('micNote').textContent = '🎙️를 누르고 한국어로 말하세요. 처음엔 브라우저가 마이크 권한을 물어요.';
}
$('mic').addEventListener('click', () => {
  if (!SR) return;
  if (rec) return rec.stop();
  rec = new SR();
  rec.lang = 'ko-KR';
  rec.interimResults = true;
  rec.maxAlternatives = 3;
  const started = performance.now();
  $('mic').classList.add('on');
  $('micNote').textContent = '듣는 중… 말이 끝나면 자동으로 보내요';
  rec.onresult = (e) => {
    const r = e.results[e.results.length - 1];
    const text = r[0].transcript;
    if (!r.isFinal) {
      if (!interimEl) interimEl = bubble('user', text, { interim: true });
      else interimEl.querySelector('.b').textContent = text;
      return;
    }
    interimEl?.remove();
    interimEl = null;
    const alts = [...r].slice(1).map((a) => a.transcript).filter((a) => a && a !== text);
    send(text, { source: 'mic', confidence: r[0].confidence || null, alts, ms: Math.round(performance.now() - started) });
  };
  rec.onerror = (e) => {
    $('micNote').textContent = e.error === 'not-allowed' ? '마이크 권한이 막혀 있어요. 주소창의 🔒에서 마이크를 허용해 주세요.' : `음성 인식 오류: ${e.error}`;
  };
  rec.onend = () => {
    rec = null;
    interimEl?.remove();
    interimEl = null;
    $('mic').classList.remove('on');
    if ($('micNote').textContent.startsWith('듣는 중')) $('micNote').textContent = '🎙️를 누르고 한국어로 말하세요.';
  };
  rec.start();
});

// ───────── 서버 상태 · Gleo 알림 · 차량 화면 ─────────
function renderState(st) {
  last = st;
  const c = st.car;
  const s = st.session;
  const o = s.order;
  $('state').innerHTML = `
    <div class="row"><span>${c.source === 'pleos' ? '📡 Pleos 내비' : '🧪 가상 주행'}</span><span>🏠 ${hhmm(c.etaDestination)} 도착</span><span>📍 ${c.remainingKm} km</span><span>${c.speedKmh} km/h</span>${st.clock.speed !== 1 ? `<span>시연 ${st.clock.speed}배속</span>` : ''}</div>
    <div class="row"><span>대화: ${esc(PHASE_KO[s.phase] ?? s.phase)}</span>${o ? `<span class="key">${o.status === 'SCHEDULED' ? `📤 ${hhmm(o.dispatchAt)} 전송 예약` : o.status === 'SENT' ? `✅ ${esc(o.display?.sentAt ?? '')} 전송됨` : esc(o.status)}</span>` : ''}</div>`;
}
connect(
  {
    state: renderState,
    'gleo.say': (d) => bubble('gleo', d.text, { notice: true }),
  },
  (ok) => {
    $('conn').textContent = ok ? '● 서버 연결됨' : '서버 연결 끊김';
    $('conn').classList.toggle('ok', ok);
  },
);

function fitCar() {
  const box = $('carFit');
  const s = box.clientWidth / 1920;
  box.style.height = `${720 * s}px`;
  $('carFrame').style.transform = `scale(${s})`;
}
new ResizeObserver(fitCar).observe($('carFit'));

emptyLog();
renderSteps(null, 0);
