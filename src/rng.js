// 确定性随机：mulberry32 + 字符串 seed 哈希。
// 同一 seed 永远产生同样的三组噪声频率。

export function hashSeed(input) {
  const str = String(input).trim();
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

export function mulberry32(seed) {
  let a = hashSeed(seed);
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 在 [lo, hi) 内取一个与 used 保持最小间距（半音）的频率，保证三组分得开。
export function pickFrequencies(seed) {
  const rand = mulberry32(seed);
  const minSemitoneGap = 9;
  const chosen = [];
  let guard = 0;
  while (chosen.length < 3 && guard < 500) {
    guard++;
    const midi = 57 + Math.floor(rand() * 34); // MIDI 57..90 ≈ 220Hz..1480Hz
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const tooClose = chosen.some((m) => Math.abs(m - midi) < minSemitoneGap);
    if (!tooClose) chosen.push(midi);
  }
  return chosen
    .sort((a, b) => a - b)
    .map((midi) => +(440 * Math.pow(2, (midi - 69) / 12)).toFixed(2));
}
