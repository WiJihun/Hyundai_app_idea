import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DriveOnApp, type DemoAction } from './app.ts';
import { OrderError, orderView, type EtaReport, type StoreStep } from './orders.ts';
import { buildHome } from './recommend.ts';
import { CATEGORIES, HOME, findStore, type Category } from './world.ts';
import type { UiAction } from './gleo/dialog.ts';

/**
 * DriveOn 웹 프로토타입 서버.
 *  - 계약 API(설계서 6번): /home, /stores/{id}/menu, /orders ...
 *  - 시연용: /gleo/*, /demo/*, /pos/*, /events(SSE), 정적 화면
 */
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const STATIC: Record<string, string> = {
  '/car/': join(ROOT, 'vehicle-web'),
  '/pos/': join(ROOT, 'pos-sim'),
  '/demo/': join(ROOT, 'demo-panel'),
  '/common/': join(ROOT, 'web-common'),
  '/tour/': join(ROOT, 'tour'),
  '/dashboard/': join(ROOT, 'dashboard'),
  '/voice/': join(ROOT, 'voice-console'),
  '/': join(ROOT, 'stage'),
};
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function startServer(port = Number(process.env.PORT) || 4173, host = process.env.HOST || '127.0.0.1') {
  const app = new DriveOnApp();
  const clients = new Set<ServerResponse>();

  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const broadcast = (event: string, data: unknown) => {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of clients) c.write(msg);
  };

  // 시뮬레이션 루프(실시간 100ms) + 상태 방송(250ms)
  let last = performance.now();
  const loop = setInterval(() => {
    const t = performance.now();
    app.advance(t - last);
    last = t;
  }, 100);
  const pulse = setInterval(() => clients.size && broadcast('state', app.state()), 250);
  app.events.on('gleo.say', (d) => broadcast('gleo.say', d));
  app.events.on('pos.order', (d) => broadcast('pos.order', d));
  app.events.on('changed', () => broadcast('state', app.state()));

  const routes: [string, RegExp, (m: RegExpMatchArray, req: IncomingMessage, url: URL) => Promise<[number, unknown]>][] = [
    // ── 계약 API ──
    ['GET', /^\/home$/, async (_m, _req, url) => {
      const num = (k: string, d: number) => (url.searchParams.has(k) ? Number(url.searchParams.get(k)) : d);
      const pos = app.car.position;
      const cat = url.searchParams.get('category') as Category | null;
      if (cat && !CATEGORIES.includes(cat)) throw new HttpError(400, 'unknown category');
      const cur = { lat: num('lat', pos.lat), lng: num('lng', pos.lng) };
      const dest = { lat: num('destLat', HOME.lat), lng: num('destLng', HOME.lng) };
      if (![cur.lat, cur.lng, dest.lat, dest.lng].every(Number.isFinite)) throw new HttpError(400, 'lat/lng must be numbers');
      return [200, buildHome(cur, dest, app.orders.recent, cat ?? undefined)];
    }],
    ['GET', /^\/stores\/([\w-]+)\/menu$/, async (m) => {
      const s = findStore(m[1]);
      if (!s) throw new HttpError(404, 'store not found');
      return [200, {
        storeId: s.id,
        name: s.name,
        congestionMin: app.orders.congestionOf(s.id),
        items: s.items.map((i) => ({ id: i.id, name: i.name, price: i.price, prepMin: i.prepMin, options: s.options.map(({ id, name, price }) => ({ id, name, price })) })),
      }];
    }],
    ['GET', /^\/orders$/, async () => [200, app.orders.list().map(orderView)]],
    ['POST', /^\/orders$/, async (_m, req) => {
      const b = await body(req);
      const o = await app.orders.create({ storeId: b.storeId, items: b.items, mode: b.mode, eta: etaFrom(b.eta), vehicle: b.vehicle });
      return [201, orderView(o)];
    }],
    ['POST', /^\/orders\/([\w-]+)\/eta$/, async (m, req) => [200, orderView(app.orders.reportEta(m[1], etaFrom(await body(req))))]],
    ['GET', /^\/orders\/([\w-]+)$/, async (m) => [200, orderView(app.orders.get(m[1]))]],
    ['POST', /^\/orders\/([\w-]+)\/cancel$/, async (m) => [200, orderView(await app.orders.cancel(m[1]))]],

    // ── 시연용: Gleo, 데모 패널, POS ──
    ['GET', /^\/state$/, async () => [200, app.state()]],
    // 개발용: UI 둘러보기 장면을 캡처해 한 장짜리 대시보드(dashboard/)를 만들 때 쓴다
    ['POST', /^\/dev\/snapshot\/(\d{1,2})$/, async (m, req) => {
      const snap = await body(req, 4 * 1024 * 1024);
      const dir = join(ROOT, 'dashboard', 'snapshots');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${m[1].padStart(2, '0')}.json`), JSON.stringify(snap));
      return [200, { saved: m[1] }];
    }],
    ['POST', /^\/gleo\/utterance$/, async (_m, req) => {
      const { text } = await body(req);
      if (typeof text !== 'string' || !text.trim() || text.length > 200) throw new HttpError(400, 'text required');
      const r = await app.dialog.utter(text);
      broadcast('state', app.state());
      return [200, r];
    }],
    ['POST', /^\/gleo\/action$/, async (_m, req) => {
      const r = await app.dialog.act((await body(req)) as UiAction);
      broadcast('state', app.state());
      return [200, r];
    }],
    // 차량 앱(Pleos NaviHelper)이 실제 내비의 목적지까지 남은 시간(초)·거리(m)를 보낸다. {clear:true}면 가상 주행으로
    ['POST', /^\/car\/nav$/, async (_m, req) => {
      const b = await body(req);
      if (b.clear) app.setNav(null);
      else {
        const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
        const remainSec = num(b.remainSec), remainMeters = num(b.remainMeters);
        if (remainSec === null || remainMeters === null) throw new HttpError(400, 'remainSec, remainMeters required');
        const wpSec = num(b.waypointSec), wpMeters = num(b.waypointMeters);
        const pos = b.pos && Number.isFinite(b.pos.lat) && Number.isFinite(b.pos.lng)
          ? { lat: Number(b.pos.lat), lng: Number(b.pos.lng), heading: Number(b.pos.heading) || 0 } : null;
        const tbt = b.tbt && typeof b.tbt.type === 'string'
          ? { type: b.tbt.type.slice(0, 40), distance: Number(b.tbt.distance) || 0, description: String(b.tbt.description ?? '').slice(0, 80) } : null;
        app.setNav({
          remainSec, remainKm: remainMeters / 1000,
          waypointSec: wpSec, waypointKm: wpMeters === null ? null : wpMeters / 1000,
          name: typeof b.name === 'string' ? b.name.slice(0, 60) : '',
          pos, tbt, address: typeof b.address === 'string' ? b.address.slice(0, 80) : null,
        });
      }
      broadcast('state', app.state());
      return [200, { source: app.state().car.source }];
    }],
    // 차량 앱이 실제 차량 상태를 보낸다: 주행 중 화면 제한(CarUxRestrictions) · 차속 · 기어. {clear:true}면 가상으로
    ['POST', /^\/car\/vehicle$/, async (_m, req) => {
      const b = await body(req);
      if (b.clear) app.setVehicle(null);
      else app.setVehicle({ speedKmh: Number(b.speedKmh) || 0, restricted: !!b.restricted, gear: typeof b.gear === 'string' ? b.gear.slice(0, 20) : null });
      broadcast('state', app.state());
      return [200, { restricted: app.state().car.uxRestricted }];
    }],
    // 차량 앱이 실제 내비 이벤트를 보낸다: 경유지(포장 매장) 도착 · 목적지 도착
    ['POST', /^\/car\/event$/, async (_m, req) => {
      const { type } = await body(req);
      if (type !== 'waypointArrived' && type !== 'destinationArrived') throw new HttpError(400, 'type: waypointArrived | destinationArrived');
      app.navEvent(type);
      broadcast('state', app.state());
      return [200, { ok: true }];
    }],
    ['POST', /^\/demo\/control$/, async (_m, req) => {
      const { action, value } = await body(req);
      app.control(action as DemoAction, value);
      return [200, app.state()];
    }],
    ['POST', /^\/pos\/orders\/([\w-]+)\/(accept|complete)$/, async (m) => {
      const o = app.orders.storeAction(m[1], m[2] as StoreStep);
      broadcast('state', app.state());
      return [200, orderView(o)];
    }],
    ['POST', /^\/pos\/stores\/([\w-]+)\/congestion$/, async (m, req) => {
      const { extraPrepMin } = await body(req);
      app.orders.setCongestion(m[1], Number(extraPrepMin) || 0);
      broadcast('state', app.state());
      return [200, { storeId: m[1], congestionMin: app.orders.congestionOf(m[1]) }];
    }],
  ];

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://local');
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'content-type');
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();

    if (url.pathname === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(`event: state\ndata: ${JSON.stringify(app.state())}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    try {
      for (const [method, re, fn] of routes) {
        const m = url.pathname.match(re);
        if (m && req.method === method) {
          const [status, out] = await fn(m, req, url);
          return send(res, status, out);
        }
      }
      if (req.method === 'GET') return await serveStatic(url.pathname, res);
      throw new HttpError(404, 'not found');
    } catch (e) {
      if (e instanceof OrderError) return send(res, e.status, { error: e.code, message: e.message });
      if (e instanceof HttpError) return send(res, e.status, { error: 'BAD_REQUEST', message: e.message });
      console.error(e);
      return send(res, 500, { error: 'INTERNAL', message: e instanceof Error ? e.message : String(e) });
    }
  });

  server.listen(port, host, () => {
    const base = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`;
    console.log(`DriveOn 프로토타입: ${base}/  (차량 ${base}/car/ · POS ${base}/pos/ · 데모 패널 ${base}/demo/)`);
  });
  server.on('close', () => {
    clearInterval(loop);
    clearInterval(pulse);
    for (const c of clients) c.end();
  });
  return { server, app };
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  const prefix = Object.keys(STATIC).find((p) => pathname.startsWith(p) || pathname + '/' === p);
  if (!prefix) throw new HttpError(404, 'not found');
  if (pathname + '/' === prefix) {
    res.writeHead(301, { location: prefix });
    return void res.end();
  }
  const base = STATIC[prefix];
  let rel = decodeURIComponent(pathname.slice(prefix.length)) || 'index.html';
  if (rel.endsWith('/')) rel += 'index.html';
  const file = normalize(join(base, rel));
  if (!file.startsWith(base + sep) && file !== base) throw new HttpError(404, 'not found');
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  } catch {
    throw new HttpError(404, 'not found');
  }
}

async function body(req: IncomingMessage, maxBytes = 64 * 1024): Promise<Record<string, any>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > maxBytes) throw new HttpError(413, 'body too large');
    chunks.push(c as Buffer);
  }
  if (!chunks.length) return {};
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof v !== 'object' || v === null) throw new Error();
    return v;
  } catch {
    throw new HttpError(400, 'invalid JSON');
  }
}

/** ETA는 epoch ms 또는 ISO 문자열 둘 다 받는다 */
function etaFrom(b: Record<string, any> | undefined): EtaReport {
  const t = (v: unknown) => (v === null || v === undefined ? null : typeof v === 'number' ? v : Date.parse(String(v)));
  const destinationEta = t(b?.destinationEta);
  const waypointEta = t(b?.waypointEta);
  if (destinationEta === null || Number.isNaN(destinationEta)) throw new HttpError(400, 'destinationEta required (epoch ms or ISO)');
  if (waypointEta !== null && Number.isNaN(waypointEta)) throw new HttpError(400, 'waypointEta invalid');
  return { destinationEta, waypointEta };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer();
}
