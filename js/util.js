// 纯 Web Audio 构建块：噪声缓冲、包络自动化与分贝换算。
// 不加载任何音频文件，噪声由 AudioBuffer 实时填充随机样本生成。

export const SAMPLE_RATE = 44100;
export const SEGMENT_DURATION = 2.5; // 每个场景槽位 2.5s，四段共 10s
export const SCENE_DURATION = 10;
export const TARGET_PEAK = Math.SQRT1_2; // -3 dBFS，留出充足余量避免削波

const noiseCache = new WeakMap();

// 白噪声缓冲（每上下文复用一份），后续由滤波器塑形。
export function getNoiseBuffer(ctx) {
  let buffer = noiseCache.get(ctx);
  if (buffer) return buffer;
  const length = Math.floor(ctx.sampleRate * SCENE_DURATION);
  buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  noiseCache.set(ctx, buffer);
  return buffer;
}

export function createNoiseSource(ctx) {
  const source = ctx.createBufferSource();
  source.buffer = getNoiseBuffer(ctx);
  source.loop = true;
  return source;
}

// points: [[相对时间, 目标值], ...]，线性分段包络。
export function applyEnvelope(param, t0, points) {
  param.setValueAtTime(points[0][1], t0 + points[0][0]);
  for (let i = 1; i < points.length; i++) {
    param.linearRampToValueAtTime(points[i][1], t0 + points[i][0]);
  }
}

// 指数衰减包络（打击类声音：脚步低频、金属振铃）。
export function applyPercEnvelope(param, t0, peak, decay, floor = 0.0001) {
  param.setValueAtTime(floor, t0);
  param.exponentialRampToValueAtTime(peak, t0 + 0.004);
  param.exponentialRampToValueAtTime(floor, t0 + decay);
}

export function dbToGain(db) {
  return Math.pow(10, db / 20);
}

export function gainToDb(gain) {
  return 20 * Math.log10(Math.max(gain, 1e-9));
}

// 统计缓冲峰值与削波样本数。
export function analyzeBuffer(buffer) {
  const data = buffer.getChannelData(0);
  let peak = 0;
  let clipped = 0;
  for (let i = 0; i < data.length; i++) {
    const abs = Math.abs(data[i]);
    if (abs > peak) peak = abs;
    if (abs >= 0.9999) clipped++;
  }
  return {
    peak,
    peakDb: gainToDb(peak),
    clipped,
    duration: buffer.duration,
    samples: data.length,
  };
}

// 线性整体缩放（用于渲染后归一化到目标峰值）。
export function scaleBuffer(buffer, factor) {
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] *= factor;
  return buffer;
}

// 16-bit PCM WAV 编码器（单声道）。
export function encodeWav(buffer) {
  const data = buffer.getChannelData(0);
  const length = data.length;
  const arrayBuffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(arrayBuffer);
  const writeString = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 单声道
  view.setUint32(24, buffer.sampleRate, true);
 view.setUint32(28, buffer.sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, length * 2, true);
  let offset = 44;
  for (let i = 0; i < length; i++, offset += 2) {
    const clamped = Math.max(-1, Math.min(1, data[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return new Blob([arrayBuffer], { type: 'audio/wav' });
}
