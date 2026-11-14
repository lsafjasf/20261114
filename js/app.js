'use strict';

const OBJECT_ORDER = ['soft', 'medium', 'hard'];
const ROUND_NAMES = { soft: '第一次 · 软物', medium: '第二次 · 中等', hard: '第三次 · 硬物' };

class App {
  constructor() {
    this.canvas = document.getElementById('stage');
    this.audio = new MotorAudio();
    this.renderer = new Renderer(this.canvas, OBJECTS[this.currentObjectId()]);
    this.roundIndex = 0;
    this.results = { soft: null, medium: null, hard: null };
    this.sim = null;
    this.rafId = null;
    this.lastT = 0;
    this.params = { pressure: 30, speed: 35, feedback: 30 };
    this.bindUI();
    this.loadObject(0);
    this.loop = this.loop.bind(this);
    this.rafId = requestAnimationFrame(this.loop);
  }

  bindUI() {
    ['pressure', 'speed', 'feedback'].forEach((id) => {
      const el = document.getElementById(id);
      el.addEventListener('input', () => {
        this.params[id] = Number(el.value);
        document.getElementById(`${id}-val`).textContent = el.value;
        this.refreshPreview();
      });
    });
    document.getElementById('start-btn').addEventListener('click', () => this.startRun());
    document.getElementById('reset-btn').addEventListener('click', () => this.resetRound());
    document.getElementById('mute-btn').addEventListener('click', () => {
      const on = this.audio.toggle();
      document.getElementById('mute-btn').textContent = on ? '静音电机声' : '开启电机声';
    });
    document.querySelectorAll('.obj-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        if (this.sim && !this.sim.passed && !this.sim.failed) return;
        this.loadObject(Number(tab.dataset.idx));
      });
    });
  }

  currentObjectId() {
    return OBJECT_ORDER[this.roundIndex];
  }

  loadObject(idx) {
    this.roundIndex = idx;
    const id = this.currentObjectId();
    const def = OBJECTS[id];
    this.renderer.setObject(def);
    document.querySelectorAll('.obj-tab').forEach((t, i) => t.classList.toggle('active', i === idx));
    document.getElementById('obj-title').textContent = `${ROUND_NAMES[id]}：${def.label}`;
    document.getElementById('obj-spec').textContent =
      `安全力上限 ${def.maxSafe}N/指 · 摩擦系数 μ=${def.mu} · 物重 ${def.weight}N · 接触刚度 ${def.stiffness}N/m`;
    const chip = document.getElementById(`chip-${id}`);
    if (this.results[id]) {
      chip.textContent = '✓ 通过';
      chip.className = 'round-chip ok';
    } else {
      chip.textContent = `${ROUND_NAMES[id].split(' · ')[0]} · 待测试`;
      chip.className = 'round-chip';
    }
    this.sim = null;
    this.refreshPreview();
    this.drawIdle();
  }

  refreshPreview() {
    const m = evaluate({ objectId: this.currentObjectId(), ...this.params });
    const set = (id, text, cls) => {
      const el = document.getElementById(id);
      el.textContent = text;
      el.className = 'metric-val ' + cls;
    };
    set('m-peak', `${m.peakForce.toFixed(1)} N`, m.peakForce > OBJECTS[this.currentObjectId()].maxSafe ? 'bad' : 'ok');
    set('m-hold', `${m.holdAvg.toFixed(1)} N`, '');
    set('m-deform', `${m.deformPct.toFixed(1)} %`, m.deformPct > 40 ? 'warn' : 'ok');
    set('m-slip', `${(m.slipRisk * 100).toFixed(0)} %`, m.slipRisk > 0.85 ? 'bad' : m.slipRisk > 0.6 ? 'warn' : 'ok');
    set('m-crush', `${m.crushMargin.toFixed(1)} N`, m.crushMargin < 0 ? 'bad' : 'ok');
    document.getElementById('m-overshoot').textContent = m.overshootForce.toFixed(2);
    document.getElementById('m-threshold').textContent = m.thresholdForce.toFixed(1);
    document.getElementById('m-need').textContent = m.requiredGrip.toFixed(1);
    this.updateSlipBar(m.slipRisk);
    this.updateDeformBar(m.deformPct);
  }

  updateSlipBar(risk) {
    const bar = document.getElementById('slip-bar');
    bar.style.width = `${Math.min(100, risk * 100)}%`;
    bar.className = 'fill ' + (risk > 0.85 ? 'fill-red' : risk > 0.6 ? 'fill-amber' : 'fill-green');
  }

  updateDeformBar(pct) {
    const bar = document.getElementById('deform-bar');
    bar.style.width = `${Math.min(100, pct)}%`;
    bar.className = 'fill ' + (pct > 40 ? 'fill-red' : pct > 22 ? 'fill-amber' : 'fill-green');
  }

  drawIdle() {
    const fake = {
      fingerForces: [0, 0, 0],
      fingerGaps: [GAP, GAP, GAP],
      deformPct: 0,
      slipOffset: 0,
      liftHeight: 0,
      phase: 'idle',
      failed: false,
      reason: '',
    };
    this.renderer.draw(fake, OBJECTS[this.currentObjectId()].maxSafe);
  }

  startRun() {
    if (this.sim && !this.sim.passed && !this.sim.failed) return;
    this.audio.resume();
    this._lastFinished = null;
    this.sim = new GraspSim({ objectId: this.currentObjectId(), ...this.params });
    this.sim.start();
    this.lastT = performance.now();
    this.log(`▶ 开始抓取 ${OBJECTS[this.currentObjectId()].label}（指力 ${this.params.pressure} / 速度 ${this.params.speed} / 阈值 ${this.params.feedback}）`);
    document.getElementById('start-btn').disabled = true;
  }

  resetRound() {
    this.sim = null;
    this._lastFinished = null;
    document.getElementById('start-btn').disabled = false;
    document.getElementById('run-status').textContent = '待运行';
    document.getElementById('run-status').className = 'status-pill';
    this.audio.update(0, 0, 0);
    this.drawIdle();
  }

  finish(sim) {
    const id = this.currentObjectId();
    const m = sim.metrics;
    document.getElementById('start-btn').disabled = false;
    this.audio.update(0, 0, 0);
    if (sim.passed) {
      if (this._lastFinished === sim) return;
      this._lastFinished = sim;
      this.results[id] = { params: { ...this.params }, peak: m.peakForce, slip: m.slipRisk, deform: m.deformPct };
      this.audio.success();
      this.log(`✔ 无损抓取成功：峰值 ${m.peakForce.toFixed(1)}N，形变 ${m.deformPct.toFixed(1)}%，滑移风险 ${(m.slipRisk * 100).toFixed(0)}%`);
      this.markRound(id, true);
      document.getElementById('run-status').textContent = '通过 ✓';
      document.getElementById('run-status').className = 'status-pill pass';
      if (OBJECT_ORDER.every((k) => this.results[k])) this.declareAllPassed();
    } else {
      if (this._lastFinished === sim) return;
      this._lastFinished = sim;
      this.log(`✖ 失败：${sim.reason}（峰值 ${m.peakForce.toFixed(1)}N / 安全 ${OBJECTS[id].maxSafe}N）`);
      this.audio.warn();
      this.markRound(id, false);
      document.getElementById('run-status').textContent = '损伤/滑脱 ✖';
      document.getElementById('run-status').className = 'status-pill fail';
    }
  }

  markRound(id, ok) {
    const el = document.getElementById(`chip-${id}`);
    el.textContent = ok ? '✓ 通过' : '✖ 未通过';
    el.className = 'round-chip ' + (ok ? 'ok' : 'fail');
  }

  declareAllPassed() {
    const el = document.getElementById('overall');
    el.textContent = '🏆 三次抓取全部无损伤完成，考核通过！';
    el.className = 'overall pass';
    this.log('🏆 三种软硬物体全部通过，策略调优完成。');
  }

  log(text) {
    const box = document.getElementById('log');
    const line = document.createElement('div');
    line.className = 'log-line';
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    line.textContent = `[${time}] ${text}`;
    box.prepend(line);
  }

  loop(t) {
    const dt = Math.min(0.05, (t - this.lastT) / 1000 || 0);
    this.lastT = t;
    if (this.sim) {
      this.sim.update(dt);
      const snap = this.sim.snapshot();
      this.renderer.draw(snap, OBJECTS[this.currentObjectId()].maxSafe);
      const load = Math.max(...this.sim.fingerForces) / OBJECTS[this.currentObjectId()].maxSafe;
      this.audio.update(Math.min(1, load), this.params.speed, this.sim.metrics.slipRisk);
      const phaseText = {
        approaching: '闭合中…', compressing: '接触加压…', holding: '稳定持握…',
        lifting: '提升中…', passed: '已通过', failed: '已失败',
      }[snap.phase] || '待运行';
      const pill = document.getElementById('run-status');
      if (!this.sim.passed && !this.sim.failed) pill.textContent = phaseText;
      if (this.sim.passed || this.sim.failed) this.finish(this.sim);
    }
    this.rafId = requestAnimationFrame(this.loop);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
