// 引擎：参数模型、离线渲染（单段 / 完整场景）、峰值检查与归一化。

import { BUILDERS } from './sounds.js';
import {
  analyzeBuffer,
  scaleBuffer,
  SAMPLE_RATE,
  SEGMENT_DURATION,
  SCENE_DURATION,
  TARGET_PEAK,
} from './util.js';

export const SEGMENTS = [
  { id: 'door', name: '开门', color: '#e8a13c' },
  { id: 'footsteps', name: '脚步', color: '#58c164' },
  { id: 'rain', name: '雨棚', color: '#4aa3df' },
  { id: 'clang', name: '金属碰撞', color: '#d9636f' },
];

// 每个旋钮：键、标签、范围、步长与单位；默认值即四段声音的出厂调法。
export const KNOBS = {
  door: [
    { key: 'creakBase', label: '吱呀基频', min: 90, max: 320, step: 1, unit: 'Hz' },
    { key: 'creakRate', label: '抖动速率', min: 2, max: 14, step: 0.1, unit: 'Hz' },
    { key: 'creakDepth', label: '抖动深度', min: 4, max: 60, step: 1, unit: 'Hz' },
    { key: 'noiseLevel', label: '摩擦噪声', min: 0.02, max: 0.4, step: 0.01, unit: '' },
  ],
  footsteps: [
    { key: 'thumpFreq', label: '低频落点', min: 55, max: 180, step: 1, unit: 'Hz' },
    { key: 'thumpDecay', label: '低频余韵', min: 0.08, max: 0.45, step: 0.01, unit: 's' },
    { key: 'scuffCutoff', label: '擦声滤波', min: 500, max: 3500, step: 50, unit: 'Hz' },
    { key: 'scuffLevel', label: '擦声音量', min: 0.05, max: 0.6, step: 0.01, unit: '' },
  ],
  rain: [
    { key: 'rainCutoff', label: '雨声低通', min: 600, max: 3200, step: 50, unit: 'Hz' },
    { key: 'rainLevel', label: '雨声音量', min: 0.05, max: 0.5, step: 0.01, unit: '' },
    { key: 'hissLevel', label: '高频嘶声', min: 0.01, max: 0.2, step: 0.005, unit: '' },
    { key: 'dropLevel', label: '雨滴强度', min: 0.05, max: 0.5, step: 0.01, unit: '' },
  ],
  clang: [
    { key: 'clangFreq', label: '金属基频', min: 180, max: 700, step: 1, unit: 'Hz' },
    { key: 'ringDecay', label: '振铃衰减', min: 0.6, max: 2.2, step: 0.05, unit: 's' },
  ],
};

export const DEFAULT_PARAMS = {
  door: { creakBase: 180, creakRate: 6.5, creakDepth: 28, noiseLevel: 0.12 },
  footsteps: { thumpFreq: 95, thumpDecay: 0.2, scuffCutoff: 1700, scuffLevel: 0.28 },
  rain: { rainCutoff: 1500, rainLevel: 0.22, hissLevel: 0.06, dropLevel: 0.22 },
  clang: { clangFreq: 320, ringDecay: 1.4 },
};

export function createOfflineContext(duration) {
  return new OfflineAudioContext(1, Math.ceil(SAMPLE_RATE * duration), SAMPLE_RATE);
}

// 渲染单个场景段（2.5s 槽位，段内静音保留，方便对齐时间线）。
export async function renderSegment(index, params) {
  const segment = SEGMENTS[index];
  const ctx = createOfflineContext(SEGMENT_DURATION);
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);
  BUILDERS[index](ctx, 0, master, params[segment.id]);
  const raw = await ctx.startRendering();
  // 单段同样做峰值安全网：超过目标峰值就整体等比缩放，不做硬削波。
  const info = analyzeBuffer(raw);
  if (info.peak > TARGET_PEAK) scaleBuffer(raw, TARGET_PEAK / info.peak);
  return raw;
}

// 渲染完整 10s 场景：四段依次排在各自 2.5s 槽位中。
export async function renderScene(params) {
  const ctx = createOfflineContext(SCENE_DURATION);
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);
  SEGMENTS.forEach((segment, index) => {
    BUILDERS[index](ctx, index * SEGMENT_DURATION, master, params[segment.id]);
  });
  const raw = await ctx.startRendering();

  // 峰值检查：若超过目标峰值则整体归一化缩放，绝不逐样本硬削波。
  const before = analyzeBuffer(raw);
  let normalized = raw;
  let scale = 1;
  if (before.peak > TARGET_PEAK) {
    scale = TARGET_PEAK / before.peak;
    normalized = scaleBuffer(raw, scale);
  }
  const after = analyzeBuffer(normalized);
  return { buffer: normalized, before, after, scale };
}

// 实时预览：用在线 AudioContext 重放同一个图结构（单段或整段场景）。
export function createLivePreview() {
  const ctx = new AudioContext();
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);
  return {
    _token: 0,
    ctx,
    async playSegment(index, params) {
      await ctx.resume();
      BUILDERS[index](ctx, ctx.currentTime + 0.05, master, params[SEGMENTS[index].id]);
    },
    async playScene(params, onEnd) {
      await ctx.resume();
      const startAt = ctx.currentTime + 0.08;
      SEGMENTS.forEach((segment, index) => {
        BUILDERS[index](ctx, startAt + index * SEGMENT_DURATION, master, params[segment.id]);
      });
      const token = ++this._token;
      const timer = setTimeout(() => {
        if (this._token === token) onEnd && onEnd();
      }, SCENE_DURATION * 1000 + 200);
      return { startAt, timer };
    },
    close() {
      this._token++;
      ctx.close();
    },
  };
}
