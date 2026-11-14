// 用 mock Canvas 2D 上下文跑完整渲染帧，确保渲染器无运行时错误。
import { createSim, step, fastClose } from '../sim.js';
import { drawScene } from '../render.js';

const calls = [];
const gradient = { addColorStop() {} };
function makeCtx() {
  const target = { canvas: { width: 960, height: 540 } };
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (prop === 'createRadialGradient' || prop === 'createLinearGradient') {
        return () => { calls.push(prop); return gradient; };
      }
      if (prop === 'measureText') return () => ({ width: 10 });
      return (...a) => { calls.push(prop); };
    },
    set(t, prop, value) { t[prop] = value; return true; },
  });
}
const ctx = makeCtx();

const sim = createSim();
for (let i = 0; i < 40; i++) step(sim, 0.05);
fastClose(sim, 0);
for (let i = 0; i < 20; i++) step(sim, 0.025);
drawScene(ctx, sim, 3.21);

const required = ['clearRect', 'beginPath', 'arc', 'moveTo', 'lineTo', 'stroke', 'fillText', 'setLineDash', 'createRadialGradient'];
const missing = required.filter((m) => !calls.includes(m));
if (missing.length) { console.error('缺少绘制调用:', missing); process.exit(1); }
console.log('✅ Canvas 渲染冒烟通过，绘制调用种类:', new Set(calls).size);
