// 自检：用同一 seed 连开两台引擎，验证一次成功、一次累计失真失败。
// 成功路径知道 seed 对应的三组频率（引擎内部参数），玩家在界面上只能靠频谱盲调。

import { NoiseEngine } from './engine.js';
import { createInitialState } from './controls.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tick(engine, state, ms) {
  engine.update(state);
  await sleep(ms);
}

async function runSuccess(seed, log) {
  const ctx = new AudioContext();
  const engine = new NoiseEngine(ctx, seed);
  const state = createInitialState();
  log(`[成功局] seed=${seed}，等待参考能量建立…`);
  await sleep(900);
  for (let i = 0; i < 4; i++) engine.update(state);

  // 温和地把三段陷波器逐一贴近三组噪声（不扫频、低 Q 宽陷波，避免失真累积）
  const targets = engine.noiseFrequencies;
  for (let i = 0; i < targets.length; i++) {
    state.notches[i].frequency = targets[i];
    state.notches[i].q = 2;
    engine.setNotch(i, { frequency: targets[i], q: 2 });
    await tick(engine, state, 350);
  }
  // 第四段陷波器与相位保持温和设置
  state.notches[3].frequency = Math.round(targets[2] * 1.5);
  state.notches[3].q = 1;
  engine.setNotch(3, { frequency: state.notches[3].frequency, q: 1 });
  for (let i = 0; i < 2; i++) {
    state.phases[i].wet = 0.2;
    state.phases[i].phaseDeg = 50;
    engine.setPhase(i, { wet: 0.2, phaseDeg: 50 });
    await tick(engine, state, 300);
  }

  let result = null;
  for (let t = 0; t < 120 && !result; t++) {
    const snap = engine.update(state);
    if (snap.state === 'won') result = snap;
    if (snap.state === 'failed') { result = snap; break; }
    await sleep(100);
  }
  const snap = engine.snapshot();
  const pass = snap.state === 'won';
  log(`[成功局] 结果=${snap.state}，残余=${(snap.residualRatio * 100).toFixed(1)}% ` +
    `(阈值 ${snap.goal * 100}%)，累计失真=${snap.distortion.toFixed(1)}%`);
  engine.dispose();
  return { pass, scenario: 'success', ...snap };
}

async function runFailure(seed, log) {
  const ctx = new AudioContext();
  const engine = new NoiseEngine(ctx, seed);
  const state = createInitialState();
  log(`[失败局] seed=${seed}，等待参考能量建立…`);
  await sleep(900);

  // 过度调节：Q 全部拉满，频率来回猛扫，相位对消拉满到极端延迟
  state.notches.forEach((c) => { c.q = 40; });
  engine.notches.forEach((_, i) => engine.setNotch(i, { q: 40 }));
  state.phases.forEach((c) => { c.wet = 1; c.phaseDeg = 180; });
  engine.phases.forEach((_, i) => engine.setPhase(i, { wet: 1, phaseDeg: 180 }));

  let snap = engine.snapshot();
  let sweeps = 0;
  while (snap.state === 'running' && sweeps < 400) {
    for (let i = 0; i < 4; i++) {
      const freq = sweeps % 2 === 0 ? 80 + i * 30 : 3800 - i * 120;
      state.notches[i].frequency = freq;
      engine.setNotch(i, { frequency: freq });
    }
    snap = engine.update(state);
    sweeps++;
    await sleep(60);
  }
  const pass = snap.state === 'failed';
  log(`[失败局] 结果=${snap.state}，累计失真=${snap.distortion.toFixed(1)}%，` +
    `瞬时压力=${(snap.instantStress * 100).toFixed(0)}%，猛扫次数=${sweeps}`);
  engine.dispose();
  return { pass, scenario: 'failure', ...snap };
}

export async function runVerification(seed, log = () => {}) {
  const first = await runSuccess(seed, log);
  const second = await runFailure(seed, log);
  const pass = first.pass && second.pass;
  log(pass
    ? '自检通过：同一 seed 下一次达标成功、一次累计失真失败均复现。'
    : '自检未通过，请检查上方两局结果。');
  return { pass, first, second };
}
