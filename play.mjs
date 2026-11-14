import { chromium } from 'playwright';
import fs from 'fs';

const DIR = '/home/hj/userfeedback/uid166';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
page.on('pageerror', e => { console.error('PAGE ERROR:', e.message); process.exit(1); });
await page.goto('file://' + DIR + '/index.html');
await page.waitForFunction(() => window.GAME);

const held = new Set();
async function setKeys(want) {
  for (const k of want) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
  for (const k of [...held]) if (!want.has(k)) { await page.keyboard.up(k); held.delete(k); }
}
const KEYS = [
  { l: 'a', r: 'd', u: 'w', d: 's' },
  { l: 'ArrowLeft', r: 'ArrowRight', u: 'ArrowUp', d: 'ArrowDown' },
];
function keysToward(want, p, from, to) {
  const dx = to.x - from.x, dy = to.y - from.y;
  if (dx > 5) want.add(KEYS[p].r); else if (dx < -5) want.add(KEYS[p].l);
  if (dy > 5) want.add(KEYS[p].d); else if (dy < -5) want.add(KEYS[p].u);
}
const state = () => page.evaluate(() => GAME.state());

async function loadNav(si) {
  const nav = { pts: [], cps: [], cpIdx: [[], []] };
  for (const p of [0, 1]) nav.pts[p] = await page.evaluate(q => GAME.nav(q).pts, p);
  const st = await state();
  nav.cps = st.cps;
  st.cps.forEach((cp, k) => {
    for (const p of [0, 1]) {
      let best = 0, bd = 1e9;
      nav.pts[p].forEach((pt, i) => { const d = dist(pt, cp); if (d < bd) { bd = d; best = i; } });
      nav.cpIdx[p][k] = best;
    }
  });
  return nav;
}

// 演示：P1 按住空格冻结交汇点，P2 拉动冻结点后返回
async function freezeDemo() {
  console.log('[demo] 冻结交汇点，P2 开始拉动…');
  await setKeys(new Set([' ']));
  await sleep(300);
  const j0 = (await state()).J;
  const p2start = (await state()).brushes[1];
  await setKeys(new Set([' ', 'ArrowRight']));
  while (true) {
    const st = await state();
    if (dist(st.brushes[1], p2start) > 90 || st.breaks > 0) break;
    await sleep(20);
  }
  await setKeys(new Set([' ']));
  const j1 = (await state()).J;
  console.log(`[demo] 冻结点被拉动 ${dist(j0, j1).toFixed(1)}px（断裂数 ${(await state()).breaks}）`);
  // P2 返回检查点
  const cp = (await state()).cps[0];
  while (true) {
    const st = await state();
    if (dist(st.brushes[1], cp) < 15) break;
    const want = new Set([' ']);
    keysToward(want, 1, st.brushes[1], cp);
    await setKeys(want);
    await sleep(20);
  }
  await setKeys(new Set());
  await sleep(200);
  console.log('[demo] 解冻，继续绘图');
  const st2 = await state();
  console.log(`[demo] 结束后位置 P1=(${st2.brushes[0].x|0},${st2.brushes[0].y|0}) P2=(${st2.brushes[1].x|0},${st2.brushes[1].y|0})`);
}

// 演示：故意拉断一次绳子（断裂 1/2，仍在允许范围内）
async function breakDemo() {
  console.log('[demo] 故意拉紧绳子直至断裂…');
  await setKeys(new Set([' ']));
  await sleep(300);
  await setKeys(new Set([' ', 'd']));
  while (true) {
    const st = await state();
    if (st.breaks > 0 || !st.frozen) break;
    await sleep(20);
  }
  await setKeys(new Set());
  console.log(`[demo] 绳子断裂，当前断裂数 ${(await state()).breaks}`);
  await sleep(300);
}

// ---------- 主循环：两人同时沿轨迹前进，检查点汇合 ----------
let lastStage = -1, nav = null, idx = [0, 0];
let demoDone = false, breakDone = false;
let freqNear = 0, freqFar = 0;
const t0 = Date.now();

while (Date.now() - t0 < 150000) {
  const st = await state();
  if (st.over) break;
  if (st.stage !== lastStage) {
    lastStage = st.stage;
    nav = await loadNav(st.stage);
    idx = [0, 0];
    console.log(`[stage] 进入第 ${st.stage + 1} 幅`);
    if (st.stage === 1 && !breakDone) { breakDone = true; await breakDemo(); }
    continue;
  }
  if (st.stage === 0 && st.cps[0].hit && !demoDone) { demoDone = true; await freezeDemo(); continue; }

  const want = new Set();
  for (const p of [0, 1]) {
    const b = st.brushes[p];
    const k = nav.cps.findIndex((c, kk) => !st.cps[kk].hit && nav.cpIdx[p][kk] <= idx[p] + 3);
    if (k >= 0) {
      const cp = nav.cps[k];
      if (dist(b, cp) > 18) keysToward(want, p, b, cp); // 到检查点旁等待另一人
    } else {
      while (idx[p] < nav.pts[p].length - 1 && dist(b, nav.pts[p][idx[p]]) < 12) idx[p]++;
      keysToward(want, p, b, nav.pts[p][idx[p]]);
    }
  }
  await setKeys(want);
  const d = dist(st.brushes[0], st.brushes[1]);
  if (d < 60) freqNear = st.freq;
  if (d > 220) freqFar = st.freq;
  await sleep(20);
}
await setKeys(new Set());

const fin = await state();
console.log(`[result] over=${fin.over} win=${fin.win} breaks=${fin.breaks} audio=${fin.audio}`);
console.log(`[audio] 近距离音调 ${freqNear}Hz · 远距离音调 ${freqFar}Hz`);
console.log(`[coverage] P1 ${(fin.coverage[0]*100).toFixed(0)}% P2 ${(fin.coverage[1]*100).toFixed(0)}%`);

fs.mkdirSync(DIR + '/artifacts', { recursive: true });
await page.screenshot({ path: DIR + '/artifacts/final.png' });
const png = await page.evaluate(() => document.getElementById('game').toDataURL());
fs.writeFileSync(DIR + '/artifacts/picture.png', Buffer.from(png.split(',')[1], 'base64'));
await browser.close();
if (!fin.win) { console.error('FAILED'); process.exit(1); }
console.log('DONE');
