// 四段拟音声音的图结构。每段只允许四类 Web Audio 模块：
// 振荡器（OscillatorNode）、噪声（AudioBufferSourceNode 随机样本）、
// 滤波器（BiquadFilterNode）、包络（GainNode 自动化）。

import { applyEnvelope, applyPercEnvelope, createNoiseSource, SEGMENT_DURATION } from './util.js';

// ① 开门：门轴吱呀 —— 扫频锯齿振荡器 + 带通滤波噪声（摩擦质感），缓慢的起伏包络。
export function buildDoor(ctx, t0, output, p) {
  // 振荡器：吱呀声本体，频率随时间缓慢下滑并被 LFO 抖动
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(p.creakBase, t0);
  osc.frequency.linearRampToValueAtTime(p.creakBase * 0.55, t0 + 1.6);

  const lfo = ctx.createOscillator();
  lfo.frequency.value = p.creakRate;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = p.creakDepth;
  lfo.connect(lfoGain).connect(osc.frequency);

  const oscFilter = ctx.createBiquadFilter();
  oscFilter.type = 'bandpass';
  oscFilter.frequency.value = 320;
  oscFilter.Q.value = 4;

  const oscGain = ctx.createGain();
  applyEnvelope(oscGain.gain, t0, [
    [0, 0], [0.18, 0.5], [0.9, 0.34], [1.55, 0.22], [2.1, 0.08], [SEGMENT_DURATION - 0.05, 0],
  ]);

  osc.connect(oscFilter).connect(oscGain).connect(output);
  osc.start(t0);
  osc.stop(t0 + SEGMENT_DURATION);
  lfo.start(t0);
  lfo.stop(t0 + SEGMENT_DURATION);

  // 噪声 -> 带通：门轴摩擦的粗糙气声
  const noise = createNoiseSource(ctx);
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'bandpass';
  noiseFilter.frequency.setValueAtTime(900, t0);
  noiseFilter.frequency.linearRampToValueAtTime(500, t0 + 1.8);
  noiseFilter.Q.value = 1.6;
  const noiseGain = ctx.createGain();
  applyEnvelope(noiseGain.gain, t0, [
    [0, 0], [0.2, p.noiseLevel], [1.2, p.noiseLevel * 0.6], [SEGMENT_DURATION - 0.05, 0],
  ]);
  noise.connect(noiseFilter).connect(noiseGain).connect(output);
  noise.start(t0);
  noise.stop(t0 + SEGMENT_DURATION);
}

// ② 脚步：四个均匀节拍，每步 = 正弦低频“咚” + 低通噪声“擦”。
export function buildFootsteps(ctx, t0, output, p) {
  const steps = 4;
  const spacing = 2.05 / steps;
  for (let i = 0; i < steps; i++) {
    const hit = t0 + 0.22 + i * spacing;

    // 振荡器：脚跟着地的低频冲击，音高快速下坠
    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(p.thumpFreq * 1.7, hit);
    thump.frequency.exponentialRampToValueAtTime(p.thumpFreq, hit + 0.09);
    const thumpFilter = ctx.createBiquadFilter();
    thumpFilter.type = 'lowpass';
    thumpFilter.frequency.value = 420;
    const thumpGain = ctx.createGain();
    applyPercEnvelope(thumpGain.gain, hit, 0.7, p.thumpDecay);
    thump.connect(thumpFilter).connect(thumpGain).connect(output);
    thump.start(hit);
    thump.stop(hit + 0.4);

    // 噪声 -> 低通：鞋底与地面摩擦的短促沙响
    const scuff = createNoiseSource(ctx);
    const scuffFilter = ctx.createBiquadFilter();
    scuffFilter.type = 'lowpass';
    scuffFilter.frequency.value = p.scuffCutoff;
    scuffFilter.Q.value = 0.8;
    const scuffGain = ctx.createGain();
    applyPercEnvelope(scuffGain.gain, hit, p.scuffLevel, 0.16);
    scuff.connect(scuffFilter).connect(scuffGain).connect(output);
    scuff.start(hit);
    scuff.stop(hit + 0.25);
  }
}

// ③ 雨棚：持续雨声（低通噪声主体 + 高通噪声嘶声）+ 随机雨滴（滤波噪声短包络）。
export function buildRain(ctx, t0, output, p) {
  const bed = createNoiseSource(ctx);
  const bedFilter = ctx.createBiquadFilter();
  bedFilter.type = 'lowpass';
  bedFilter.frequency.value = p.rainCutoff;
  bedFilter.Q.value = 0.4;
  const bedGain = ctx.createGain();
  applyEnvelope(bedGain.gain, t0, [
    [0, 0], [0.35, p.rainLevel], [1.9, p.rainLevel * 0.85], [SEGMENT_DURATION - 0.1, 0],
  ]);
  bed.connect(bedFilter).connect(bedGain).connect(output);
  bed.start(t0);
  bed.stop(t0 + SEGMENT_DURATION);

  const hiss = createNoiseSource(ctx);
  const hissFilter = ctx.createBiquadFilter();
  hissFilter.type = 'highpass';
  hissFilter.frequency.value = 5200;
  const hissGain = ctx.createGain();
  applyEnvelope(hissGain.gain, t0, [
    [0, 0], [0.4, p.hissLevel], [SEGMENT_DURATION - 0.1, 0],
  ]);
  hiss.connect(hissFilter).connect(hissGain).connect(output);
  hiss.start(t0);
  hiss.stop(t0 + SEGMENT_DURATION);

  // 雨滴打在棚布上：带通噪声的随机短促包络
  const drops = 26;
  for (let i = 0; i < drops; i++) {
    const hit = t0 + 0.15 + Math.random() * 2.15;
    const drop = createNoiseSource(ctx);
    const dropFilter = ctx.createBiquadFilter();
    dropFilter.type = 'bandpass';
    dropFilter.frequency.value = 1400 + Math.random() * 2600;
    dropFilter.Q.value = 9;
    const dropGain = ctx.createGain();
    applyPercEnvelope(dropGain.gain, hit, p.dropLevel * (0.4 + Math.random() * 0.6), 0.05);
    drop.connect(dropFilter).connect(dropGain).connect(output);
    drop.start(hit);
    drop.stop(hit + 0.08);
  }
}

// ④ 金属碰撞：三个非谐波失谐振荡器（振铃）+ 高通噪声（撞击瞬态），指数衰减。
export function buildClang(ctx, t0, output, p) {
  const hit = t0 + 0.18;

  const strike = createNoiseSource(ctx);
  const strikeFilter = ctx.createBiquadFilter();
  strikeFilter.type = 'highpass';
  strikeFilter.frequency.value = 2400;
  const strikeGain = ctx.createGain();
  applyPercEnvelope(strikeGain.gain, hit, 0.55, 0.12);
  strike.connect(strikeFilter).connect(strikeGain).connect(output);
  strike.start(hit);
  strike.stop(hit + 0.2);

  // 非谐波频率比模拟金属板/管的不谐和振铃
  const ratios = [1, 2.76, 5.4];
  ratios.forEach((ratio, i) => {
    const osc = ctx.createOscillator();
    osc.type = i === 0 ? 'triangle' : 'square';
    osc.frequency.value = p.clangFreq * ratio;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = p.clangFreq * ratio;
    filter.Q.value = 7;
    const gain = ctx.createGain();
    const peak = i === 0 ? 0.32 : 0.16 / i;
    applyPercEnvelope(gain.gain, hit, peak, p.ringDecay * (1 - i * 0.18));
    osc.connect(filter).connect(gain).connect(output);
    osc.start(hit);
    osc.stop(hit + p.ringDecay + 0.1);
  });
}

export const BUILDERS = [buildDoor, buildFootsteps, buildRain, buildClang];
