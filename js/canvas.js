// Canvas 视图：旋钮（可拖拽）、四段波形、10 秒场景时间线与播放头。
// 所有界面元素均由 Canvas 2D 实时绘制，不使用任何图片资源。

import { KNOBS, SEGMENTS } from './engine.js';
import { SCENE_DURATION, SEGMENT_DURATION, gainToDb } from './util.js';

const KNOB_R = 21;
const KNOB_PITCH = 70;
const PANEL_H = 196;

const norm01 = (v, min, max) => Math.min(1, Math.max(0, (v - min) / (max - min)));

export class FoleyCanvas {
  constructor(canvas, params, waveforms, onKnobChange, onSegmentSelect) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.params = params;
    this.waveforms = waveforms; // 每段 AudioBuffer（可能为 null）
    this.onKnobChange = onKnobChange;
    this.onSegmentSelect = onSegmentSelect;
    this.selected = 0;
    this.playhead = -1; // 秒；<0 表示未播放
    this.knobRects = [];
    this.panelRects = [];
    this.drag = null;
    this.bindPointer();
    this.resize();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const width = 1180;
    const height = 520;
    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = width;
    this.height = height;
    this.draw();
  }

  setWaveforms(waveforms) {
    this.waveforms = waveforms;
    this.draw();
  }

  setSelected(index) {
    this.selected = index;
    this.draw();
  }

  setPlayhead(t) {
    this.playhead = t;
    this.draw();
  }

  bindPointer() {
    const pos = (event) => {
      const rect = this.canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    this.canvas.addEventListener('pointerdown', (event) => {
      const { x, y } = pos(event);
      const knob = this.knobRects.find((k) => Math.hypot(k.cx - x, k.cy - y) <= KNOB_R + 6);
      if (knob) {
        this.drag = { ...knob, startY: y, startValue: this.params[knob.segmentId][knob.def.key] };
        this.canvas.setPointerCapture(event.pointerId);
        return;
      }
      const panel = this.panelRects.find((p) => x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h);
      if (panel) this.onSegmentSelect(panel.index);
    });

    this.canvas.addEventListener('pointermove', (event) => {
      if (!this.drag) {
        const { x, y } = pos(event);
        this.canvas.style.cursor = this.knobRects.some(
          (k) => Math.hypot(k.cx - x, k.cy - y) <= KNOB_R + 6,
        )
          ? 'ns-resize'
          : 'default';
        return;
      }
      const { def, segmentId, startY, startValue } = this.drag;
      const dy = startY - pos(event).y; // 向上拖增大
      const ratio = dy / 140;
      let value = startValue + ratio * (def.max - def.min);
      value = Math.min(def.max, Math.max(def.min, value));
      value = Math.round(value / def.step) * def.step;
      value = Math.min(def.max, Math.max(def.min, Number(value.toFixed(4))));
      if (value !== this.params[segmentId][def.key]) {
        this.params[segmentId][def.key] = value;
        this.onKnobChange(segmentId, def.key, value);
      }
    });

    const endDrag = () => { this.drag = null; };
    this.canvas.addEventListener('pointerup', endDrag);
    this.canvas.addEventListener('pointercancel', endDrag);
  }

  draw() {
    const c = this.ctx;
    c.clearRect(0, 0, this.width, this.height);
    c.fillStyle = '#10141b';
    c.fillRect(0, 0, this.width, this.height);
    this.knobRects = [];
    this.panelRects = [];

    SEGMENTS.forEach((segment, index) => this.drawPanel(c, segment, index));
    this.drawTimeline(c);
  }

  drawPanel(c, segment, index) {
    const pad = 14;
    const gap = 12;
    const w = (this.width - pad * 2 - gap * 3) / 4;
    const x = pad + index * (w + gap);
    const y = 14;
    const active = this.selected === index;
    this.panelRects.push({ x, y, w, h: PANEL_H, index });

    c.save();
    c.fillStyle = active ? '#1b2330' : '#151b25';
    c.strokeStyle = active ? segment.color : '#2a3342';
    c.lineWidth = active ? 2 : 1;
    this.roundRect(c, x, y, w, PANEL_H, 10);
    c.fill();
    c.stroke();

    c.fillStyle = segment.color;
    c.font = 'bold 15px "Noto Sans SC", system-ui, sans-serif';
    c.textAlign = 'left';
    c.fillText(`${index + 1}. ${segment.name}`, x + 12, y + 24);

    const defs = KNOBS[segment.id];
    defs.forEach((def, ki) => {
      const cx = x + 14 + KNOB_R + ki * KNOB_PITCH;
      const cy = y + 66;
      this.drawKnob(c, cx, cy, def, this.params[segment.id][def.key], segment.color);
      this.knobRects.push({ cx, cy, segmentId: segment.id, def });
      c.fillStyle = '#9fb0c3';
      c.font = '10px "Noto Sans SC", system-ui, sans-serif';
      c.textAlign = 'center';
      c.fillText(def.label, cx, cy + KNOB_R + 16);
      c.fillStyle = '#d7e1ee';
      c.font = 'bold 10px "Noto Sans SC", system-ui, sans-serif';
      c.fillText(`${this.params[segment.id][def.key]}${def.unit}`, cx, cy + KNOB_R + 30);
    });

    this.drawWaveform(c, x + 12, y + 128, w - 24, 52, this.waveforms[index], segment.color);
    c.restore();
  }

  drawKnob(c, cx, cy, def, value, color) {
    const n = norm01(value, def.min, def.max);
    const angleMin = -Math.PI * 0.75;
    const angleMax = Math.PI * 0.75;
    const angle = angleMin + n * (angleMax - angleMin);

    c.save();
    c.beginPath();
    c.arc(cx, cy, KNOB_R + 3, 0, Math.PI * 2);
    c.strokeStyle = '#2c3647';
    c.lineWidth = 3;
    c.stroke();

    c.beginPath();
    c.arc(cx, cy, KNOB_R + 3, angleMin, angle);
    c.strokeStyle = color;
    c.lineWidth = 3;
    c.stroke();

    const grad = c.createRadialGradient(cx - 6, cy - 6, 4, cx, cy, KNOB_R);
    grad.addColorStop(0, '#3a475c');
    grad.addColorStop(1, '#202836');
    c.beginPath();
    c.arc(cx, cy, KNOB_R, 0, Math.PI * 2);
    c.fillStyle = grad;
    c.fill();

    c.strokeStyle = '#e6edf6';
    c.lineWidth = 2.5;
    c.beginPath();
    c.moveTo(cx, cy);
    c.lineTo(cx + Math.sin(angle) * (KNOB_R - 6), cy - Math.cos(angle) * (KNOB_R - 6));
    c.stroke();
    c.restore();
  }

  drawWaveform(c, x, y, w, h, buffer, color) {
    c.save();
    c.fillStyle = '#0c1017';
    this.roundRect(c, x, y, w, h, 6);
    c.fill();
    c.strokeStyle = '#222b39';
    c.stroke();
    c.beginPath();
    c.rect(x, y, w, h);
    c.clip();
    c.strokeStyle = '#1d2735';
    c.beginPath();
    c.moveTo(x, y + h / 2);
    c.lineTo(x + w, y + h / 2);
    c.stroke();

    if (!buffer) {
      c.fillStyle = '#5b6b80';
      c.font = '11px "Noto Sans SC", system-ui, sans-serif';
      c.textAlign = 'center';
      c.fillText('尚未渲染', x + w / 2, y + h / 2 + 4);
      c.restore();
      return;
    }

    const data = buffer.getChannelData(0);
    const step = Math.floor(data.length / w) || 1;
    c.strokeStyle = color;
    c.lineWidth = 1;
    c.beginPath();
    for (let px = 0; px < w; px++) {
      let max = 0;
      const start = px * step;
      for (let i = 0; i < step && start + i < data.length; i++) {
        const abs = Math.abs(data[start + i]);
        if (abs > max) max = abs;
      }
      const amp = (max / 0.7071) * (h / 2 - 3);
      c.moveTo(x + px, y + h / 2 - amp);
      c.lineTo(x + px, y + h / 2 + amp);
    }
    c.stroke();
    c.restore();
  }

  drawTimeline(c) {
    const x = 14;
    const y = 238;
    const w = this.width - 28;
    const h = 96;
    c.fillStyle = '#151b25';
    this.roundRect(c, x, y, w, h, 10);
    c.fill();
    c.strokeStyle = '#2a3342';
    c.stroke();

    c.fillStyle = '#9fb0c3';
    c.font = 'bold 13px "Noto Sans SC", system-ui, sans-serif';
    c.textAlign = 'left';
    c.fillText('场景时间线（10 秒）', x + 12, y + 20);

    const trackX = x + 12;
    const trackW = w - 24;
    const trackY = y + 34;
    const trackH = 34;
    const slotW = trackW / 4;
    SEGMENTS.forEach((segment, index) => {
      c.fillStyle = this.selected === index ? segment.color : '#222d3d';
      this.roundRect(c, trackX + index * slotW + 2, trackY, slotW - 4, trackH, 6);
      c.fill();
      c.fillStyle = this.selected === index ? '#10141b' : '#9fb0c3';
      c.font = 'bold 12px "Noto Sans SC", system-ui, sans-serif';
      c.textAlign = 'center';
      c.fillText(
        `${segment.name}  ${(index * SEGMENT_DURATION).toFixed(1)}–${((index + 1) * SEGMENT_DURATION).toFixed(1)}s`,
        trackX + index * slotW + slotW / 2,
        trackY + trackH / 2 + 4,
      );
    });

    // 秒刻度
    c.strokeStyle = '#39465a';
    c.fillStyle = '#7f90a5';
    c.font = '10px "Noto Sans SC", system-ui, sans-serif';
    for (let s = 0; s <= SCENE_DURATION; s++) {
      const tx = trackX + (s / SCENE_DURATION) * trackW;
      c.beginPath();
      c.moveTo(tx, trackY + trackH + 4);
      c.lineTo(tx, trackY + trackH + 10);
      c.stroke();
      c.textAlign = 'center';
      c.fillText(`${s}s`, tx, trackY + trackH + 22);
    }

    if (this.playhead >= 0) {
      const px = trackX + (this.playhead / SCENE_DURATION) * trackW;
      c.strokeStyle = '#ffd479';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(px, trackY - 2);
      c.lineTo(px, trackY + trackH + 12);
      c.stroke();
    }
  }

  roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
}

export function formatPeak(info) {
  return `峰值 ${info.peak.toFixed(4)}（${info.peakDb.toFixed(2)} dBFS）· 削波样本 ${info.clipped} · ${info.duration.toFixed(3)}s`;
}

export { gainToDb };
