// 浏览器端到端：真实键盘事件驱动云台，在固定轨迹上完成 30s 连续锁定。
// 运行: node test/e2e.mjs
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const url = 'file://' + path.join(root, 'index.html');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(url);
await page.waitForFunction(() => window.__game && window.__game.getState().view);
console.log('页面加载成功，画布与模拟循环运行中');

// 与 Node 测试相同的预判 PD 策略，但只通过真实键盘事件操作
const KEYS = { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown' };
const pressed = new Set();
async function setKey(name, on) {
  if (on && !pressed.has(name)) { await page.keyboard.down(KEYS[name]); pressed.add(name); }
  if (!on && pressed.has(name)) { await page.keyboard.up(KEYS[name]); pressed.delete(name); }
}

const start = Date.now();
let result = 'timeout';
let maxSpeed = 0;
while (Date.now() - start < 50000) {
  const s = await page.evaluate(() => {
    const st = window.__game.getState();
    const ang = Sim.targetAngles({ t: st.t + 0.18 });
    return {
      t: st.t, status: st.status, lock: st.lockTimer,
      yaw: st.yaw, pitch: st.pitch, yawVel: st.yawVel, pitchVel: st.pitchVel,
      errYaw: Sim.wrapAngle(ang.yaw - st.yaw),
      errPitch: ang.pitch - st.pitch,
      speed: st.view.speed
    };
  });
  if (s.status !== 'running') { result = s.status; break; }
  maxSpeed = Math.max(maxSpeed, s.speed);
  const ux = Math.max(-1, Math.min(1, 5.0 * s.errYaw - 2.0 * s.yawVel));
  const uy = Math.max(-1, Math.min(1, 5.0 * s.errPitch - 2.0 * s.pitchVel));
  const dead = 0.15;
  await setKey('left', ux < -dead);
  await setKey('right', ux > dead);
  await setKey('up', uy < -dead);
  await setKey('down', uy > dead);
  await page.waitForTimeout(50);
}

const final = await page.evaluate(() => {
  const st = window.__game.getState();
  return { status: st.status, lock: st.lockTimer, t: st.t };
});
await page.screenshot({ path: path.join(root, 'artifacts', 'e2e-final.png') });
await browser.close();

console.log(`结果: ${final.status}, 连续锁定 ${final.lock.toFixed(1)}s, ` +
  `用时 ${final.t.toFixed(1)}s, 峰值转速 ${maxSpeed.toFixed(2)} rad/s`);
if (errors.length) { console.error('页面错误:', errors); process.exit(1); }
if (result !== 'win') { console.error(`未获胜: ${result}`); process.exit(1); }
console.log('E2E 通过：真实键盘操作完成 30s 连续追踪');
