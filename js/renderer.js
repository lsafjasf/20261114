import { CUE_TIMES, DURATION } from './constants.js';

export class Renderer {
  constructor(canvas, engine) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.engine = engine;
    this.waveform = new Uint8Array(2048);
    this.lastFlash = CUE_TIMES.map(() => 0);
    this.raf = 0;
  }

  start() {
    const loop = () => {
      this.draw();
      this.raf = window.requestAnimationFrame(loop);
    };
    this.raf = window.requestAnimationFrame(loop);
  }

  stop() {
    window.cancelAnimationFrame(this.raf);
  }

  draw() {
    const { canvas, ctx } = this;
    const width = canvas.width;
    const height = canvas.height;
    const time = this.engine.getCurrentTime();
    const progress = time / DURATION;

    ctx.clearRect(0, 0, width, height);
    this.drawBackground(width, height, progress);
    this.drawProgressTrack(width, height, progress);
    this.drawOrb(width, height, time);
    this.drawCueMarkers(width, height, time);
    this.drawWaveform(width, height);
    this.updateActiveCue(time);
    this.drawCaption(time, width, height);
  }

  drawBackground(width, height, progress) {
    const gradient = this.ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, '#0b1220');
    gradient.addColorStop(Math.min(1, progress), '#14233d');
    gradient.addColorStop(1, '#0b1220');
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, width, height);
  }

  drawProgressTrack(width, height, progress) {
    const trackY = height - 46;
    this.ctx.fillStyle = '#22304a';
    this.ctx.fillRect(40, trackY, width - 80, 6);
    this.ctx.fillStyle = '#4f9dff';
    this.ctx.fillRect(40, trackY, (width - 80) * progress, 6);
    this.ctx.fillStyle = '#93a1b5';
    this.ctx.font = '12px monospace';
    for (let second = 0; second <= DURATION; second += 5) {
      const x = 40 + ((width - 80) * second) / DURATION;
      this.ctx.fillText(`${second}s`, x - 8, trackY + 24);
    }
  }

  drawOrb(width, height, time) {
    const centerX = 40 + ((width - 80) * (time / DURATION));
    const centerY = 150 + Math.sin(time * 2.2) * 34;
    const pulse = 1 + 0.12 * Math.sin(time * Math.PI * 4);
    const radius = 34 * pulse;
    const gradient = this.ctx.createRadialGradient(centerX, centerY, 4, centerX, centerY, radius * 2);
    gradient.addColorStop(0, 'rgba(124,92,255,.95)');
    gradient.addColorStop(0.5, 'rgba(79,157,255,.55)');
    gradient.addColorStop(1, 'rgba(79,157,255,0)');
    this.ctx.fillStyle = gradient;
    this.ctx.beginPath();
    this.ctx.arc(centerX, centerY, radius * 2, 0, Math.PI * 2);
    this.ctx.fill();
  }

  drawCueMarkers(width, height, time) {
    CUE_TIMES.forEach((cueTime, index) => {
      const x = 40 + ((width - 80) * cueTime) / DURATION;
      const active = time >= cueTime && time < cueTime + 0.5;
      this.ctx.fillStyle = active ? '#ffb020' : 'rgba(124,92,255,.7)';
      this.ctx.fillRect(x - 1.5, 40, 3, height - 100);
      this.ctx.fillStyle = active ? '#ffd780' : '#b9a8ff';
      this.ctx.font = '11px monospace';
      this.ctx.fillText(`${index + 1}`, x - 3, 34);
    });
  }

  drawWaveform(width, height) {
    const analyser = this.engine.getAnalyser();
    if (analyser) {
      analyser.getByteTimeDomainData(this.waveform);
    } else {
      this.waveform.fill(128);
    }
    const centerY = 268;
    this.ctx.lineWidth = 2;
    this.ctx.strokeStyle = '#34c98e';
    this.ctx.beginPath();
    const step = width / this.waveform.length;
    for (let i = 0; i < this.waveform.length; i += 1) {
      const value = (this.waveform[i] - 128) / 128;
      const x = i * step;
      const y = centerY + value * 46;
      if (i === 0) {
        this.ctx.moveTo(x, y);
      } else {
        this.ctx.lineTo(x, y);
      }
    }
    this.ctx.stroke();
  }

  drawCaption(time, width, height) {
    const active = this.activeCue;
    if (!active || time < active.start || time > active.end) {
      return;
    }
    this.ctx.font = 'bold 22px "PingFang SC", "Microsoft YaHei", sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.fillStyle = 'rgba(0,0,0,.55)';
    const textWidth = this.ctx.measureText(active.text).width;
    this.ctx.fillRect(width / 2 - textWidth / 2 - 16, height - 108, textWidth + 32, 34);
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillText(active.text, width / 2, height - 84);
    this.ctx.textAlign = 'left';
  }

  setActiveCueProvider(provider) {
    this.activeCue = null;
    this.cueProvider = provider;
  }

  updateActiveCue(time) {
    if (this.cueProvider) {
      this.activeCue = this.cueProvider(time);
    }
  }
}
