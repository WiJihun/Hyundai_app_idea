// UI 둘러보기에서 캡처한 장면(dashboard/snapshots/*.json)을 한 장짜리 HTML 대시보드로 묶는다.
// 서버 없이 파일만 열어도 보이도록 CSS·장면 데이터를 모두 넣는다(글꼴만 Google Fonts에서 받는다).
//
//   1) npm start 후 /tour/ 에서 장면을 캡처한다 (README 참고)
//   2) npm run build:dashboard → dashboard/index.html
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const snapDir = join(ROOT, 'dashboard', 'snapshots');
const files = (await readdir(snapDir)).filter((f) => /^\d+\.json$/.test(f)).sort();
if (!files.length) throw new Error('캡처된 장면이 없어요: dashboard/snapshots/*.json');
const scenes = await Promise.all(files.map(async (f) => JSON.parse(await readFile(join(snapDir, f), 'utf8'))));

const themeCss = await readFile(join(ROOT, 'web-common', 'theme.css'), 'utf8');
const carCss = await readFile(join(ROOT, 'vehicle-web', 'car.css'), 'utf8');
const posCss = scenes.find((s) => s.posStyle)?.posStyle ?? '';

// 차량 화면이 쓰는 사진(vehicle-web/img/**/*.webp)을 data URI로 넣는다. 장면 HTML이 실제로 쓰는 것만.
const imgRoot = join(ROOT, 'vehicle-web', 'img');
const used = new Set(scenes.flatMap((s) => [...String(s.car ?? '').matchAll(/img\/([\w\/-]+\.webp)/g)].map((m) => m[1])));
const images = {};
for (const k of used) {
  try {
    images[k] = `data:image/webp;base64,${(await readFile(join(imgRoot, k))).toString('base64')}`;
  } catch {
    console.warn(`사진 없음: img/${k}`);
  }
}

const data = {
  builtAt: new Date().toISOString(),
  images,
  css: { theme: themeCss, car: carCss, pos: posCss },
  scenes: scenes.map(({ id, chapter, title, desc, tryIt, car, pos }) => ({ id, chapter, title, desc, tryIt, car, pos })),
};
// <script> 안에 넣으므로 </script 가 끝나지 않게 막는다
const json = JSON.stringify(data).replace(/</g, '\\u003c');

const template = await readFile(join(ROOT, 'scripts', 'dashboard-template.html'), 'utf8');
const html = template.replace('/*__DATA__*/null', json);
await writeFile(join(ROOT, 'dashboard', 'index.html'), html);
console.log(`dashboard/index.html: 장면 ${scenes.length}개, 사진 ${Object.keys(images).length}장, ${Math.round(html.length / 1024)}KB`);
