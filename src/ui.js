import { CONTROL_DEFS, CONTROL_DEFS as DEFS, TRACKS, DURATION, CLIP_THRESHOLD } from './audio.js';

const TAU = Math.PI * 2;
const COLORS = {
  left: '#73f0c5',
  right: '#ffb06a',
  danger: '#ff5f68',
  muted: '#667383',
  grid: '#202a35',
};

function canvasMetrics(canvas) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  const scaledWidth = Math.round(width * dpr);
  const scaledHeight = Math.round(height * dpr);
  if (canvas.width !== scaledWidth || canvas.height !== scaledHeight) {
    canvas.width = scaledWidth;
    canvas.height = scaledHeight;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height, dpr };
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawGrid(ctx, width, height, color = 'rgba(122, 146, 170, 0.09)', step = 18) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  for (let x = 0.5; x < width; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0.5; y < height; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawText(ctx, text, x, y, options = {}) {
  ctx.save();
  ctx.font = options.font || '9px "SFMono-Regular", Consolas, monospace';
  ctx.fillStyle = options.color || COLORS.muted;
  ctx.textAlign = options.align || 'left';
  ctx.textBaseline = options.baseline || 'middle';
  if (options.letterSpacing) ctx.letterSpacing = `${options.letterSpacing}px`;
  ctx.fillText(text, x, y);
  ctx.restore();
}

export class FaderSurface {
  constructor(canvas, side, options) {
    this.canvas = canvas;
    this.side = side;
    this.onControl = options.onControl;
    this.isChanged = () => true;
    this.controls = CONTROL_DEFS[side];
    this.defs = DEFS[side];
    this.activePointers = new Map();
    this.hotKey = null;
    this.hotUntil = 0;
    this.values = {};
    this.meterPeak = 0;
    this._bind();
  }

  _bind() {
    this.canvas.addEventListener('pointerdown', (event) => {
      const index = this.indexAt(event.offsetX);
      if (index < 0) return;
      try {
        this.canvas.setPointerCapture?.(event.pointerId);
      } catch {
        // Synthetic pointers do not own a browser capture target.
      }
      this.activePointers.set(event.pointerId, index);
      this.setFromPointer(index, event.offsetY);
      event.preventDefault();
    });
    this.canvas.addEventListener('pointermove', (event) => {
      const index = this.activePointers.get(event.pointerId);
      if (index === undefined) return;
      this.setFromPointer(index, event.offsetY);
    });
    const finish = (event) => {
      this.activePointers.delete(event.pointerId);
    };
    this.canvas.addEventListener('pointerup', finish);
    this.canvas.addEventListener('pointercancel', finish);

    window.addEventListener('keydown', (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      const mappings = this.side === 'left'
        ? { a: [0, 1], z: [0, -1], s: [1, 1], x: [1, -1], d: [2, 1], c: [2, -1] }
        : { j: [0, 1], m: [0, -1], k: [1, 1], n: [1, -1], l: [2, 1], ',': [2, -1] };
      const mapping = mappings[key];
      if (!mapping || event.repeat) return;
      event.preventDefault();
      const [index, direction] = mapping;
      const def = this.defs[index];
      const next = this.values[def.key] + def.step * direction;
      this.hotKey = def.key;
      this.hotUntil = performance.now() + 650;
      this.onControl(this.side, def.key, next);
    });
  }

  indexAt(x) {
    if (x < 0 || x >= this.canvas.clientWidth) return -1;
    return Math.floor(x / (this.canvas.clientWidth / 3));
  }

  setFromPointer(index, y) {
    const def = this.defs[index];
    const top = 87;
    const bottom = this.canvas.clientHeight - 39;
    const ratio = Math.max(0, Math.min(1, (bottom - y) / (bottom - top)));
    const value = def.min + ratio * (def.max - def.min);
    this.onControl(this.side, def.key, value);
  }

  setValues(values, meterPeak = 0) {
    this.values = { ...values };
    this.meterPeak = meterPeak;
  }

  draw(now = performance.now()) {
    const { ctx, width, height } = canvasMetrics(this.canvas);
    ctx.clearRect(0, 0, width, height);
    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, '#0b1118');
    bg.addColorStop(1, '#080c11');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
    drawGrid(ctx, width, height);

    const slot = width / 3;
    this.defs.forEach((def, index) => {
      this.drawChannel(ctx, def, index, slot, width, height, now);
    });

    ctx.strokeStyle = 'rgba(255,255,255,.04)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height - 27.5);
    ctx.lineTo(width, height - 27.5);
    ctx.stroke();
    drawText(ctx, '监听共享电平表后再做下一步', 14, height - 14, {
      font: '7px "Dual Sans", "SFMono-Regular", Consolas, sans-serif',
      color: '#495666',
    });
  }

  drawChannel(ctx, def, index, slot, width, height, now) {
    const left = index * slot;
    const accent = this.side === 'left' ? COLORS.left : COLORS.right;
    const centerX = left + slot / 2;
    const top = 87;
    const bottom = height - 39;
    const value = this.values[def.key] ?? def.default;
    const ratio = (value - def.min) / (def.max - def.min);
    const handleY = bottom - ratio * (bottom - top);

    ctx.fillStyle = index % 2 === 0 ? 'rgba(255,255,255,.016)' : 'rgba(0,0,0,.08)';
    ctx.fillRect(left + 1, 55, slot - 2, height - 83);

    drawText(ctx, def.label, centerX, 72, {
      align: 'center',
      font: '8px "SFMono-Regular", Consolas, monospace',
      color: '#8a97a8',
      letterSpacing: 0.6,
    });
    drawText(ctx, def.sub, centerX, 84, {
      align: 'center',
      font: '7px "Dual Sans", sans-serif',
      color: '#536172',
    });

    const trackX = centerX - 18;
    const trackTop = top + 20;
    const trackBottom = bottom - 7;
    const trackH = trackBottom - trackTop;
    ctx.fillStyle = '#111821';
    roundRect(ctx, trackX - 2, trackTop, 4, trackH, 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,.075)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i += 1) {
      const y = trackTop + (i / 10) * trackH;
      ctx.beginPath();
      ctx.moveTo(trackX - 7, y + 0.5);
      ctx.lineTo(trackX + 7, y + 0.5);
      ctx.stroke();
    }

    const fillTop = Math.min(trackBottom, Math.max(handleY, trackTop));
    const glow = ctx.createLinearGradient(0, fillTop, 0, trackBottom);
    glow.addColorStop(0, accent);
    glow.addColorStop(1, this.side === 'left' ? '#326a61' : '#75503a');
    ctx.fillStyle = glow;
    roundRect(ctx, trackX - 1, fillTop, 2, Math.max(0, trackBottom - fillTop), 1);
    ctx.fill();

    const active = now < this.hotUntil && this.hotKey === def.key;
    ctx.shadowColor = accent;
    ctx.shadowBlur = active ? 15 : 5;
    ctx.fillStyle = active ? accent : '#c4ced9';
    roundRect(ctx, centerX - 31, handleY - 5.5, 62, 11, 4);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = active ? accent : '#566372';
    ctx.lineWidth = 1;
    roundRect(ctx, centerX - 31, handleY - 5.5, 62, 11, 4);
    ctx.stroke();
    ctx.fillStyle = active ? '#10231e' : '#111820';
    ctx.fillRect(centerX - 22, handleY - 1, 44, 2);

    const valueText = def.format(value);
    drawText(ctx, valueText, centerX, height - 43, {
      align: 'center',
      font: '10px "SFMono-Regular", Consolas, monospace',
      color: active ? accent : '#b9c5d3',
    });

    const meterHeight = Math.min(44, trackH * 0.45);
    const meterX = left + slot - 11;
    const meterY = height - 44 - meterHeight;
    const level = Math.min(1, this.meterPeak * (this.side === 'left' ? 0.82 : 0.64) + 0.025);
    ctx.fillStyle = '#111820';
    roundRect(ctx, meterX, meterY, 3, meterHeight, 1.5);
    ctx.fill();
    const meterGrad = ctx.createLinearGradient(0, meterY, 0, meterY + meterHeight);
    meterGrad.addColorStop(0, this.meterPeak >= CLIP_THRESHOLD ? COLORS.danger : accent);
    meterGrad.addColorStop(0.2, accent);
    meterGrad.addColorStop(1, '#33404b');
    ctx.fillStyle = meterGrad;
    const meterFill = meterHeight * level;
    roundRect(ctx, meterX, meterY + meterHeight - meterFill, 3, meterFill, 1.5);
    ctx.fill();
  }
}

export class ScopeRenderer {
  constructor(canvas, getWaveform) {
    this.canvas = canvas;
    this.getWaveform = getWaveform;
  }

  draw(now, playing) {
    const { ctx, width, height } = canvasMetrics(this.canvas);
    ctx.clearRect(0, 0, width, height);
    const bg = ctx.createLinearGradient(0, 0, width, height);
    bg.addColorStop(0, '#080d12');
    bg.addColorStop(1, '#0b1119');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(112, 138, 163, 0.11)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 16; i += 1) {
      const x = Math.round((i / 16) * width) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let i = 1; i < 4; i += 1) {
      const y = Math.round((i / 4) * height) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();

    ctx.setLineDash([3, 5]);
    ctx.strokeStyle = 'rgba(255, 95, 104, 0.18)';
    ctx.beginPath();
    ctx.moveTo(0, 9.5);
    ctx.lineTo(width, 9.5);
    ctx.moveTo(0, height - 9.5);
    ctx.lineTo(width, height - 9.5);
    ctx.stroke();
    ctx.setLineDash([]);

    const wave = this.getWaveform();
    const center = height / 2;
    const amplitude = height / 2 - 11;
    const step = Math.max(1, Math.floor(wave.length / Math.max(1, width)));
    let peak = 0;
    for (let i = 0; i < wave.length; i += 1) peak = Math.max(peak, Math.abs(wave[i]));

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, '#58c9bb');
    gradient.addColorStop(0.45, '#73f0c5');
    gradient.addColorStop(0.72, '#ffd479');
    gradient.addColorStop(1, '#ff9d66');
    ctx.strokeStyle = gradient;
    ctx.shadowColor = peak > 0.4 ? 'rgba(115, 240, 197, 0.35)' : 'rgba(86, 201, 187, 0.1)';
    ctx.shadowBlur = playing ? 6 : 2;
    ctx.lineWidth = 1.35;
    ctx.beginPath();
    let first = true;
    for (let i = 0; i < wave.length; i += step) {
      const x = (i / (wave.length - 1)) * width;
      const y = center - Math.max(-1, Math.min(1, wave[i] * 1.45)) * amplitude;
      if (first) {
        ctx.moveTo(x, y);
        first = false;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.16;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.restore();

    if (!playing || peak < 0.0005) {
      ctx.strokeStyle = 'rgba(144, 165, 186, 0.22)';
      ctx.beginPath();
      ctx.moveTo(0, center + 0.5);
      ctx.lineTo(width, center + 0.5);
      ctx.stroke();
      drawText(ctx, 'AWAITING TRANSPORT', width - 12, center - 14, {
        align: 'right',
        font: '7px "SFMono-Regular", Consolas, monospace',
        color: '#3f4b59',
        letterSpacing: 1,
      });
    }

    const scanX = ((now / 18) % width);
    ctx.fillStyle = 'rgba(115, 240, 197, 0.06)';
    ctx.fillRect(scanX, 0, 1, height);
  }
}

export class MeterRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.hold = -Infinity;
    this.holdUntil = 0;
  }

  draw(now, peak, rms) {
    const { ctx, width, height } = canvasMetrics(this.canvas);
    ctx.clearRect(0, 0, width, height);
    const peakDb = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
    if (peakDb > this.hold || now > this.holdUntil) {
      this.hold = peakDb;
      this.holdUntil = now + 900;
    }
    const bars = [
      { label: 'L', value: peakDb - 0.35, y: 2, color: '#73f0c5' },
      { label: 'R', value: peakDb + 0.15, y: 26, color: '#ffb06a' },
    ];
    const left = 15;
    const trackWidth = width - left - 3;
    const toRatio = (db) => Math.max(0, Math.min(1, (db + 60) / 60));

    bars.forEach((bar) => {
      drawText(ctx, bar.label, 2, bar.y + 6.5, {
        font: '7px "SFMono-Regular", Consolas, monospace',
        color: '#596777',
      });
      ctx.fillStyle = '#111820';
      roundRect(ctx, left, bar.y + 2, trackWidth, 7, 2);
      ctx.fill();

      const filled = toRatio(bar.value);
      if (filled > 0) {
        const grad = ctx.createLinearGradient(left, 0, left + trackWidth, 0);
        grad.addColorStop(0, '#3d8d80');
        grad.addColorStop(0.38, bar.color);
        grad.addColorStop(0.76, '#e3cd6e');
        grad.addColorStop(0.94, '#ff7066');
        ctx.fillStyle = grad;
        roundRect(ctx, left, bar.y + 2, trackWidth * filled, 7, 2);
        ctx.fill();
      }

      for (let i = 1; i < 24; i += 1) {
        const x = left + (i / 24) * trackWidth;
        ctx.fillStyle = 'rgba(6, 10, 14, 0.52)';
        ctx.fillRect(x, bar.y + 2, 1, 7);
      }

      const holdRatio = toRatio(this.hold);
      if (this.hold > -60) {
        ctx.fillStyle = 'rgba(255,255,255,.68)';
        ctx.fillRect(left + holdRatio * trackWidth, bar.y + 1, 1, 9);
      }
    });
  }
}

function trackEnvelope(trackIndex, xRatio) {
  const phase = trackIndex * 1.73 + 0.3;
  const carrier = Math.abs(Math.sin(xRatio * TAU * (4.5 + trackIndex * 0.35) + phase));
  const second = Math.abs(Math.sin(xRatio * TAU * (11 + trackIndex * 0.8) + phase * 2.2));
  const pulse = 0.35 + 0.65 * Math.pow(carrier, trackIndex < 4 ? 2.1 : 1.2);
  const motion = 0.4 + 0.6 * Math.pow(second, 0.65);
  const slow = 0.72 + Math.sin(xRatio * TAU * 1.3 + phase) * 0.18;
  return Math.min(1, pulse * motion * slow);
}

export class TimelineRenderer {
  constructor(canvas) {
    this.canvas = canvas;
  }

  draw(elapsed, controls, playing) {
    const { ctx, width, height } = canvasMetrics(this.canvas);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#090d12';
    ctx.fillRect(0, 0, width, height);

    const leftPad = width < 600 ? 66 : 84;
    const rightPad = 14;
    const topPad = 20;
    const bottomPad = 14;
    const plotWidth = width - leftPad - rightPad;
    const plotHeight = height - topPad - bottomPad;
    const rowHeight = plotHeight / TRACKS.length;

    for (let second = 0; second <= DURATION; second += 2) {
      const x = leftPad + (second / DURATION) * plotWidth;
      ctx.strokeStyle = second % 8 === 0 ? 'rgba(142,163,181,.14)' : 'rgba(142,163,181,.055)';
      ctx.beginPath();
      ctx.moveTo(x + 0.5, topPad - 3);
      ctx.lineTo(x + 0.5, height - bottomPad + 3);
      ctx.stroke();
      if (second % 8 === 0) {
        drawText(ctx, `${second}s`, x + 3, 10, {
          font: '7px "SFMono-Regular", Consolas, monospace',
          color: '#566475',
        });
      }
    }

    TRACKS.forEach((track, index) => {
      const y = topPad + index * rowHeight;
      const centerY = y + rowHeight / 2;
      const active = track.side === 'left'
        ? controls.left[track.id === 'bass' ? 'low' : 'drums']
        : controls.right.melody;

      if (index % 2 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,.012)';
        ctx.fillRect(0, y, width, rowHeight);
      }
      ctx.strokeStyle = 'rgba(255,255,255,.045)';
      ctx.beginPath();
      ctx.moveTo(0, y + rowHeight + 0.5);
      ctx.lineTo(width, y + rowHeight + 0.5);
      ctx.stroke();

      ctx.fillStyle = track.side === 'left' ? '#73f0c5' : '#ffb06a';
      ctx.beginPath();
      ctx.arc(10, centerY, 2, 0, TAU);
      ctx.fill();
      drawText(ctx, String(index + 1).padStart(2, '0'), 17, centerY, {
        font: '7px "SFMono-Regular", Consolas, monospace',
        color: '#4e5b6b',
      });
      drawText(ctx, track.name, 34, centerY, {
        font: '8px "SFMono-Regular", Consolas, monospace',
        color: '#8b98a8',
      });

      const amp = rowHeight * 0.39 * (0.35 + active * 0.75);
      const points = Math.max(60, Math.floor(plotWidth / 1.5));
      ctx.save();
      ctx.beginPath();
      for (let point = 0; point <= points; point += 1) {
        const ratio = point / points;
        const x = leftPad + ratio * plotWidth;
        const shape = trackEnvelope(index, ratio);
        const wobble = Math.sin(ratio * TAU * (18 + index) + index) * 0.18;
        const level = Math.max(0.03, shape + wobble * 0.08);
        const yTop = centerY - level * amp;
        if (point === 0) ctx.moveTo(x, yTop);
        else ctx.lineTo(x, yTop);
      }
      for (let point = points; point >= 0; point -= 1) {
        const ratio = point / points;
        const x = leftPad + ratio * plotWidth;
        const shape = trackEnvelope(index, ratio);
        const wobble = Math.sin(ratio * TAU * (18 + index) + index) * 0.18;
        const level = Math.max(0.03, shape + wobble * 0.08);
        ctx.lineTo(x, centerY + level * amp);
      }
      ctx.closePath();
      const grad = ctx.createLinearGradient(leftPad, 0, leftPad + plotWidth, 0);
      grad.addColorStop(0, `${track.color}44`);
      grad.addColorStop(0.65, `${track.color}66`);
      grad.addColorStop(1, `${track.color}33`);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = `${track.color}aa`;
      ctx.lineWidth = 0.65;
      ctx.stroke();
      ctx.restore();
    });

    const playX = leftPad + (elapsed / DURATION) * plotWidth;
    ctx.fillStyle = 'rgba(4,8,11,0.44)';
    ctx.fillRect(playX, topPad, width - rightPad - playX, plotHeight);
    ctx.strokeStyle = playing ? '#f7e7ac' : '#c3ced9';
    ctx.lineWidth = 1.2;
    ctx.shadowColor = 'rgba(247,231,172,.5)';
    ctx.shadowBlur = playing ? 8 : 0;
    ctx.beginPath();
    ctx.moveTo(playX + 0.5, topPad - 5);
    ctx.lineTo(playX + 0.5, height - bottomPad + 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#f7e7ac';
    ctx.beginPath();
    ctx.moveTo(playX - 3.5, topPad - 6);
    ctx.lineTo(playX + 4.5, topPad - 6);
    ctx.lineTo(playX + 0.5, topPad);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,.1)';
    ctx.beginPath();
    ctx.moveTo(leftPad, topPad - 3.5);
    ctx.lineTo(width - rightPad, topPad - 3.5);
    ctx.stroke();
  }
}

export function createFaderSurfaces(options) {
  const left = new FaderSurface(document.querySelector('#leftFaders'), 'left', options);
  const right = new FaderSurface(document.querySelector('#rightFaders'), 'right', options);
  return { left, right };
}
