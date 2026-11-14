// 实时频谱绘制：对数频率轴，只展示公共刻度，绝不标出噪声频率。

const FMIN = 40;
const FMAX = 8000;

export function drawSpectrum(canvas, spectrum, binHz) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // 网格
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  for (let db = -100; db <= -20; db += 20) {
    const y = h - ((db + 110) / 100) * h;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  const gridFreqs = [100, 300, 1000, 3000];
  ctx.fillStyle = 'rgba(138,148,168,0.7)';
  ctx.font = '10px sans-serif';
  gridFreqs.forEach((f) => {
    const x = xFor(f, w);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  });

  // 频谱填充曲线
  ctx.beginPath();
  ctx.moveTo(0, h);
  const maxBin = spectrum.length - 1;
  for (let px = 0; px < w; px++) {
    const freq = freqFor(px / w);
    const bin = Math.min(maxBin, Math.max(1, Math.round(freq / binHz)));
    const db = spectrum[bin];
    const norm = Math.max(0, Math.min(1, (db + 110) / 100));
    const y = h - norm * h;
    ctx.lineTo(px, y);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(79,209,197,0.85)');
  grad.addColorStop(1, 'rgba(79,209,197,0.08)');
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  for (let px = 0; px < w; px++) {
    const freq = freqFor(px / w);
    const bin = Math.min(maxBin, Math.max(1, Math.round(freq / binHz)));
    const db = spectrum[bin];
    const norm = Math.max(0, Math.min(1, (db + 110) / 100));
    const y = h - norm * h;
    if (px === 0) ctx.moveTo(px, y);
    else ctx.lineTo(px, y);
  }
  ctx.strokeStyle = 'rgba(122,162,255,0.9)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function xFor(freq, w) {
  return ((Math.log(freq) - Math.log(FMIN)) / (Math.log(FMAX) - Math.log(FMIN))) * w;
}

function freqFor(t) {
  return FMIN * Math.pow(FMAX / FMIN, t);
}
