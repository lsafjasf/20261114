import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };

const server = createServer(async (req, res) => {
  const path = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  try {
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

let failures = 0;
function check(name, cond, detail = '') {
  const tag = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  console.log(`[${tag}] ${name}${detail ? ' — ' + detail : ''}`);
}

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
await page.goto(base);

// ---------- 1. 声学探针：四个方位的左右声道分离 ----------
const quads = [
  ['front-left', { x: -2.5, z: 3 }],
  ['front-right', { x: 2.5, z: 3 }],
  ['back-left', { x: -2.5, z: -3 }],
  ['back-right', { x: 2.5, z: -3 }],
];
const probe = {};
for (const [quad, pos] of quads) {
  probe[quad] = await page.evaluate(
    ([p]) => window.__test.probe('B', { listenerX: 0, sourcePos: p }),
    [pos],
  );
}
for (const [quad] of quads) {
  const p = probe[quad];
  const expectLeft = quad.endsWith('left');
  check(
    `声学探针 ${quad}: 能量偏向${expectLeft ? '左' : '右'}声道`,
    expectLeft ? p.left > p.right * 1.2 : p.right > p.left * 1.2,
    `L=${p.left.toFixed(4)} R=${p.right.toFixed(4)}`,
  );
}
const frontZcr = (probe['front-left'].zcr + probe['front-right'].zcr) / 2;
const backZcr = (probe['back-left'].zcr + probe['back-right'].zcr) / 2;
check(
  '声学探针: 前/后方位的 HRTF 频谱可区分',
  Math.abs(frontZcr - backZcr) / Math.max(frontZcr, backZcr) > 0.02,
  `front zcr=${frontZcr.toFixed(0)}Hz back zcr=${backZcr.toFixed(0)}Hz`,
);

// ---------- 2. 材质改变频段与衰减 ----------
const mats = {};
for (const id of ['A', 'B', 'C']) {
  mats[id] = await page.evaluate(
    (rid) => window.__test.probe(rid, { listenerX: 0, sourcePos: { x: 0, z: 3 } }),
    id,
  );
}
const loud = (x) => Math.hypot(x.left, x.right);
check(
  '材质频段: 混凝土 < 木板 < 玻璃（过零率递增）',
  mats.A.zcr < mats.B.zcr && mats.B.zcr < mats.C.zcr,
  `混凝土=${mats.A.zcr.toFixed(0)} 木板=${mats.B.zcr.toFixed(0)} 玻璃=${mats.C.zcr.toFixed(0)} Hz`,
);
check(
  '材质衰减: 混凝土 < 木板 < 玻璃（响度递增）',
  loud(mats.A) < loud(mats.B) && loud(mats.B) < loud(mats.C),
  `混凝土=${loud(mats.A).toFixed(4)} 木板=${loud(mats.B).toFixed(4)} 玻璃=${loud(mats.C).toFixed(4)}`,
);

// ---------- 3. 实时引擎：电平表有信号 ----------
await page.click('#start-btn');
let peakL = 0;
let peakR = 0;
for (let i = 0; i < 12; i++) {
  const [l, r] = await page.evaluate(() => window.__test.getState().levels);
  peakL = Math.max(peakL, l);
  peakR = Math.max(peakR, r);
  await page.waitForTimeout(250);
}
check('实时引擎: 电平表 L/R 均检测到信号', peakL > 0.001 && peakR > 0.001,
  `L=${peakL.toFixed(4)} R=${peakR.toFixed(4)}`);

// ---------- 4. 游戏流程：四个方位各提交一次正确答案 ----------
const rounds = [
  ['front-left', 'A', 0],
  ['front-right', 'B', 0],
  ['back-left', 'C', 0],
  ['back-right', 'C', -4],
];
for (const [expect, roomId, lx] of rounds) {
  await page.evaluate(([rid, x]) => {
    window.__test.startRound(rid);
    window.__test.setListener(x);
  }, [roomId, lx]);
  const actual = await page.evaluate(() => window.__test.trueQuadrant());
  check(`布设 ${roomId} 房 / 监听 x=${lx}: 真实方位为 ${expect}`, actual === expect, `actual=${actual}`);
  await page.evaluate((dir) => {
    window.__test.select(dir);
    window.__test.submit();
  }, expect);
  const st = await page.evaluate(() => window.__test.getState());
  const revealed = await page.isVisible('#plan');
  check(`提交 ${expect}: 判定正确且平面图已展示`, st.result.ok === true && st.revealed && revealed);
}

// ---------- 5. 一次错误提交 ----------
await page.evaluate(() => {
  window.__test.startRound('B'); // 真实方位 front-right
  window.__test.setListener(0);
  window.__test.select('back-left');
  window.__test.submit();
});
const wrong = await page.evaluate(() => window.__test.getState());
const wrongText = await page.textContent('#result');
check(
  '错误提交: 判定为错误并提示实际方位',
  wrong.result.ok === false && wrong.result.actual === 'front-right' && wrongText.includes('判断错误'),
  wrongText.trim(),
);

await page.screenshot({ path: join(ROOT, 'artifacts/verify-final.png'), fullPage: true });
await browser.close();
server.close();
console.log(failures === 0 ? '\n全部验证通过 ✔' : `\n${failures} 项验证失败 ✘`);
process.exit(failures === 0 ? 0 : 1);
