// Web Audio 节拍引擎。
// 唯一时钟是外部的“虚拟时间” vt。内部维护锚点映射 audioTime = vt + offset，
// 所有音符都用该映射排到音频硬件时间轴上。
// 暂停：suspend 上下文并掐断全部在途音符/挂起闪烁；
// 恢复：重新计算锚点（吸收 suspend 期间 currentTime 的任何变化），再按冻结的
//       vt 重新调度。因此声音与闸门画面在暂停时一起冻结、恢复后严格对齐、不漂移。

import { GATES, BAR, gatePeriod } from './core.js';

const TIMBRES = [
  { type: 'sine', gain: 0.32, attack: 0.005, decay: 0.22 },       // 三脉冲：柔和正弦
  { type: 'triangle', gain: 0.26, attack: 0.004, decay: 0.16 },   // 四脉冲：三角波
  { type: 'square', gain: 0.12, attack: 0.003, decay: 0.12 },     // 五脉冲：方波加滤波
];

export class PulseAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.params = null;
    this.nextPulse = GATES.map(() => 0);   // 每个闸门下一个待触发脉冲的虚拟时间
    this.nextBarTime = 0;                  // 下一个小节首拍虚拟时间
    this.active = [];                       // 在途音源与挂起定时器
    this.onFlash = null;                    // (gateId, vt) => 视觉闪烁
    this.running = false;
    this.timeOffset = 0;                    // audioTime - vt
  }

  ensureContext() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
  }

  setParams(params) {
    this.params = params;
  }

  // 虚拟时间 → 音频硬件时间
  toAudioTime(vt) {
    return vt + this.timeOffset;
  }

  // 重新建立锚点：以当前硬件时间对应给定虚拟时间
  reanchor(vt) {
    this.timeOffset = this.ctx.currentTime - vt;
  }

  // 某闸门在虚拟时间 t 之后第一个脉冲的虚拟时间
  firstPulseAtOrAfter(gate, p, t) {
    const period = gatePeriod(gate);
    const origin = p.offset * period;
    const idx = Math.ceil((t - origin) / period - 1e-9);
    return origin + idx * period;
  }

  start(vt, params) {
    this.ensureContext();
    this.params = params;
    this.ctx.resume();
    this.reanchor(vt);
    this.running = true;
    this.nextBarTime = Math.ceil(vt / BAR - 1e-9) * BAR;
    if (this.nextBarTime < vt) this.nextBarTime += BAR;
    this.nextPulse = GATES.map((gate, i) =>
      this.firstPulseAtOrAfter(gate, params[i], vt));
  }

  // 每帧：把 (vt, vt+lookahead] 内的节拍排进音频队列
  update(vt, lookahead) {
    if (!this.running || !this.ctx) return;
    const horizon = vt + lookahead;

    while (this.nextBarTime <= horizon) {
      this.scheduleKick(this.toAudioTime(this.nextBarTime));
      this.nextBarTime += BAR;
    }

    GATES.forEach((gate, gi) => {
      const period = gatePeriod(gate);
      let t = this.nextPulse[gi];
      while (t <= horizon) {
        const when = this.toAudioTime(t);
        this.schedulePulse(gi, when, this.params[gi].strength);
        const flashVt = t;
        const id = gate.id;
        const delayMs = Math.max(0, (when - this.ctx.currentTime) * 1000);
        const timer = window.setTimeout(() => {
          if (this.onFlash && this.running) this.onFlash(id, flashVt);
        }, delayMs);
        this.active.push({ timer });
        t += period;
      }
      this.nextPulse[gi] = t;
    });
  }

  trackSource(osc, gain) {
    const entry = { osc, gain };
    osc.onended = () => {
      const pos = this.active.indexOf(entry);
      if (pos >= 0) this.active.splice(pos, 1);
    };
    this.active.push(entry);
  }

  schedulePulse(gi, when, strength) {
    const ctx = this.ctx;
    const gate = GATES[gi];
    const timbre = TIMBRES[gi];
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = timbre.type;
    osc.frequency.value = gate.freq;
    if (gi === 2) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1800;
      osc.connect(filter);
      filter.connect(gain);
    } else {
      osc.connect(gain);
    }
    gain.connect(this.master);
    const peak = timbre.gain * (0.55 + 0.45 * strength);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(peak, when + timbre.attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + timbre.decay);
    osc.start(when);
    osc.stop(when + timbre.decay + 0.02);
    this.trackSource(osc, gain);
  }

  scheduleKick(when) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, when);
    osc.frequency.exponentialRampToValueAtTime(55, when + 0.12);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(0.28, when + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.2);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(when);
    osc.stop(when + 0.24);
    this.trackSource(osc, gain);
  }

  // 暂停：立即冻结调度并停止一切在途声音，避免冻结期仍有音发出
  pause() {
    if (!this.running && !(this.ctx && this.ctx.state === 'running')) return;
    this.running = false;
    for (const entry of this.active) {
      if (entry.timer) window.clearTimeout(entry.timer);
      if (entry.osc) {
        try { entry.gain.gain.cancelScheduledValues(this.ctx.currentTime); } catch { /* noop */ }
        try { entry.osc.stop(this.ctx.currentTime); } catch { /* noop */ }
      }
    }
    this.active = [];
    if (this.ctx && this.ctx.state !== 'closed') this.ctx.suspend();
  }

  // 恢复：重锚并从冻结的 vt 重新调度，保证无错位、无重复、无丢拍
  resume(vt, params) {
    this.ensureContext();
    this.ctx.resume();
    this.start(vt, params);
  }

  dispose() {
    this.pause();
    if (this.ctx) this.ctx.close();
    this.ctx = null;
  }
}
