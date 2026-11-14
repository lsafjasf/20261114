// 应用控制器：串联合成引擎、Canvas 视图、实时预览与 WAV 导出。

import { FoleyCanvas, formatPeak } from './canvas.js';
import {
  DEFAULT_PARAMS,
  SEGMENTS,
  createLivePreview,
  renderScene,
  renderSegment,
} from './engine.js';
import { SCENE_DURATION, TARGET_PEAK, analyzeBuffer, encodeWav, gainToDb } from './util.js';

const params = structuredClone(DEFAULT_PARAMS);
const state = {
  segmentBuffers: [null, null, null, null],
  sceneBuffer: null,
  sceneInfo: null,
  preview: null,
  playing: false,
  playStart: 0,
  raf: 0,
  endTimer: 0,
};

const canvas = document.getElementById('studio');
const statusEl = document.getElementById('status');
const peakEl = document.getElementById('peak');
const foley = new FoleyCanvas(
  canvas,
  params,
  state.segmentBuffers,
  () => {},
  (index) => foley.setSelected(index),
);

function setStatus(text, ok = true) {
  statusEl.textContent = text;
  statusEl.className = ok ? 'status ok' : 'status warn';
}

async function renderAll() {
  setStatus('离线渲染四段声音……');
  const buffers = await Promise.all(
    SEGMENTS.map((_, index) => renderSegment(index, params)),
  );
  state.segmentBuffers = buffers;
  foley.setWaveforms(buffers);

  const result = await renderScene(params);
  state.sceneBuffer = result.buffer;
  state.sceneInfo = result;

  const segmentInfo = buffers.map(analyzeBuffer);
  peakEl.innerHTML = [
    `<strong>四段单检：</strong> ${segmentInfo
      .map((info, i) => `${SEGMENTS[i].name} ${info.peak.toFixed(3)}/${info.clipped}削`)
      .join('　')}`,
    `<strong>整轨渲染前：</strong> ${formatPeak(result.before)}，缩放 ${result.scale.toFixed(3)}`,
    `<strong>整轨终检：</strong> ${formatPeak(result.after)}，目标上限 ${gainToDb(TARGET_PEAK).toFixed(1)} dBFS`,
  ].join('<br>');

  const safe = result.after.peak <= 1 && result.after.clipped === 0;
  setStatus(
    safe
      ? `渲染完成：四段就绪，整轨 ${result.after.duration.toFixed(2)}s，峰值未削波。`
      : '警告：检测到削波样本！',
    safe,
  );
  window.__foleyState = state; // 供自动化测试读取
  return result;
}

function getPreview() {
  if (!state.preview || state.preview.ctx.state === 'closed') state.preview = createLivePreview();
  return state.preview;
}

async function previewSegment() {
  const preview = getPreview();
  await preview.playSegment(foley.selected, params);
  setStatus(`实时预览：${SEGMENTS[foley.selected].name}`);
}

function stopPlayhead() {
  state.playing = false;
  cancelAnimationFrame(state.raf);
  foley.setPlayhead(-1);
}

async function previewScene() {
  if (state.playing) {
    stopPlayhead();
    return;
  }
  const preview = getPreview();
  state.playing = true;
  const { startAt, timer } = await preview.playScene(params, () => {
    stopPlayhead();
    setStatus('整轨回放结束（10 秒场景）。');
  });
  state.endTimer = timer;
  state.playStart = preview.ctx.currentTime;
  setStatus('实时回放完整 10 秒场景……');
  const tick = () => {
    if (!state.playing) return;
    const t = preview.ctx.currentTime - state.playStart;
    if (t >= SCENE_DURATION) {
      stopPlayhead();
      return;
    }
    foley.setPlayhead(Math.max(0, t));
    state.raf = requestAnimationFrame(tick);
  };
  state.raf = requestAnimationFrame(tick);
}

async function exportWav() {
  if (!state.sceneBuffer) await renderAll();
  const blob = encodeWav(state.sceneBuffer);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'foley-scene.wav';
  link.textContent = 'foley-scene.wav';
  document.getElementById('download-slot').replaceChildren(link);

  // 同时把 ArrayBuffer 暴露给自动化脚本（页面本身不依赖测试环境）。
  window.__wavBlob = blob;
  window.__wavBytes = new Uint8Array(await blob.arrayBuffer());
  setStatus(`已导出 16-bit PCM WAV：${blob.size} 字节。`);
  return blob;
}

function stopAll() {
  stopPlayhead();
  clearTimeout(state.endTimer);
  if (state.preview) state.preview.close();
  state.preview = null;
}

document.getElementById('render').addEventListener('click', renderAll);
document.getElementById('preview-segment').addEventListener('click', previewSegment);
document.getElementById('preview-scene').addEventListener('click', previewScene);
document.getElementById('export').addEventListener('click', exportWav);

window.__foleyApi = { renderAll, previewScene, exportWav, stopAll, params, getState: () => state };
setStatus('就绪：点击“渲染四段”开始拟音。');
