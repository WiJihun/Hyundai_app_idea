// 화면 공통: 서버 연결(SSE), API 호출, 표시 형식

const hhmmFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false });
const hhmmssFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

export const hhmm = (ts) => (ts == null ? '–' : hhmmFmt.format(ts));
export const hhmmss = (ts) => (ts == null ? '–' : hhmmssFmt.format(ts));
export const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`;
export const MODE = { DELIVERY: '배달', PICKUP: '포장' };

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** 남은 시간 "3분 20초" (가상 시간 기준) */
export function remain(ms) {
  if (ms <= 0) return '지금';
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m >= 1 ? `${m}분 ${String(s % 60).padStart(2, '0')}초` : `${s}초`;
}

export async function api(path, body) {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.message || res.statusText), { status: res.status, json });
  return json;
}

/**
 * 서버 이벤트 구독. handlers: { state, 'gleo.say', 'pos.order' }
 * 연결 상태는 onStatus(true/false)로 알린다.
 */
export function connect(handlers, onStatus = () => {}) {
  const es = new EventSource('/events');
  es.onopen = () => onStatus(true);
  es.onerror = () => onStatus(false);
  for (const [ev, fn] of Object.entries(handlers)) {
    es.addEventListener(ev, (e) => fn(JSON.parse(e.data)));
  }
  return es;
}

/** 내용이 바뀐 경우에만 innerHTML을 교체해 깜빡임과 포커스 손실을 막는다 */
export function patch(el, html) {
  if (el.__html !== html) {
    el.innerHTML = html;
    el.__html = html;
  }
}
