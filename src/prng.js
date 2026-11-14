// 可复现随机数与噪声层：同一 seed 产生完全一致的序列与随机场。

export function hashSeed(input) {
  if (typeof input === 'number' && Number.isInteger(input)) return input >>> 0;
  let h = 2166136261 >>> 0;
  const str = String(input);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// mulberry32：确定性 32bit PRNG
export function mulberry32(seed) {
  let a = hashSeed(seed) >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

// 基于种子置换表的二维值噪声，配合 fBm 形成缓动随机场。
export class ValueNoise2D {
  constructor(seed) {
    const rand = mulberry32(seed);
    this.grad = new Float32Array(256);
    for (let i = 0; i < 256; i++) this.grad[i] = rand() * 2 - 1;
    this.perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = (rand() * (i + 1)) | 0;
      const tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  at(x, y) {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);
    const g = this.grad;
    const p = this.perm;
    const aa = g[p[(p[xi] + yi) & 255]];
    const ab = g[p[(p[xi] + yi + 1) & 255]];
    const ba = g[p[(p[xi + 1] + yi) & 255]];
    const bb = g[p[(p[xi + 1] + yi + 1) & 255]];
    return lerp(lerp(aa, ba, u), lerp(ab, bb, u), v);
  }

  // 分形布朗运动，输出约在 [-1, 1]。
  fbm(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
    let amp = 0.5;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.at(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }
}
