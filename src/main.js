// 主控：单一虚拟时钟驱动音频与画面，管理物体生成、碰撞与停机状态机。

import {
  GATES, OBJECT_COUNT, MAX_FAIL_STREAK, SPAWN_INTERVAL,
  TUNNEL, OBJECT_SPEED, DEFAULT_PARAMS, SOLVED_PARAMS,
  objectX, isGateOpenAt,
} from './core.js';
import { PulseAudio } from './audio.js';
import { Renderer } from './render.js';

const LOOKAHEAD = 0.18;   // 音频预调度窗口（秒）
const FLASH_DECAY = 3.2;

export class App {
  constructor() {
    this.canvas = document.getElementById('stage');
    this.renderer = new Renderer(this.canvas);
    this.audio = new PulseAudio();
    this.audio.onFlash = (gateId) => { this.state.flashes[gateId] = 1; };

    this.state = this.freshState(DEFAULT_PARAMS.map((p) => ({ ...p })));
    this.rafId = 0;
    this.lastWall = 0;
    this.bindUI();
    this.render();
  }

  freshState(params) {
    return {
      vt: 0,                       // 虚拟时间（唯一时钟）
      paused: true,
      running: false,
      halted: false,
      won: false,
      params,
      objects: [],
      nextSpawn: 0,
      nextId: 1,
      spawned: 0,
      passedCount: 0,
      failStreak: 0,
      flashes: [0, 0, 0],
      spawnPulse: 0,
    };
  }

  bindUI() {
    document.getElementById('startBtn').addEventListener('click', () => this.start());
    document.getElementById('pauseBtn').addEventListener('click', () => this.togglePause());
    document.getElementById('resetBtn').addEventListener('click', () => this.reset());
    document.getElementById('solveBtn').addEventListener('click', () => this.applySolution());

    GATES.forEach((gate, gi) => {
      const strength = document.getElementById(`strength-${gi}`);
      const offset = document.getElementById(`offset-${gi}`);
      strength.addEventListener('input', () => {
        this.state.params[gi].strength = Number(strength.value) / 100;
        this.audio.setParams(this.state.params);
        this.readout(gi);
      });
      offset.addEventListener('input', () => {
        this.state.params[gi].offset = Number(offset.value) / 100;
        this.readout(gi);
      });
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') { e.preventDefault(); this.togglePause(); }
    });
  }

  readout(gi) {
    const p = this.state.params[gi];
    document.getElementById(`readout-${gi}`).textContent =
      `强弱 ${p.strength.toFixed(2)} · 偏移 ${p.offset.toFixed(2)}`;
  }

  syncSliders() {
    GATES.forEach((gate, gi) => {
      document.getElementById(`strength-${gi}`).value =
        Math.round(this.state.params[gi].strength * 100);
      document.getElementById(`offset-${gi}`).value =
        Math.round(this.state.params[gi].offset * 100);
      this.readout(gi);
    });
  }

  applySolution() {
    const wasRunning = this.state.running && !this.state.paused;
    this.audio.pause();
    this.state = this.freshState(SOLVED_PARAMS.map((p) => ({ ...p })));
    this.state.paused = true;
    this.syncSliders();
    this.updateHud();
    this.render();
    if (wasRunning) this.start();
  }

  reset() {
    this.audio.pause();
    cancelAnimationFrame(this.rafId);
    this.state = this.freshState(this.state.params.map((p) => ({ ...p })));
    this.syncSliders();
    this.updateHud();
    this.render();
    document.getElementById('pauseBtn').textContent = '继续';
  }

  start() {
    if (this.state.halted) this.reset();
    if (this.state.running && !this.state.paused) return;  // 已在运行，避免重复 RAF
    this.state.paused = false;
    this.state.running = true;
    this.audio.resume(this.state.vt, this.state.params);
    this.lastWall = performance.now();
    cancelAnimationFrame(this.rafId);
    this.loop(this.lastWall);
    document.getElementById('pauseBtn').textContent = '暂停';
  }

  togglePause() {
    if (!this.state.running || this.state.halted || this.state.won) return;
    if (this.state.paused) {
      this.start();
    } else {
      this.state.paused = true;
      this.audio.pause();
      document.getElementById('pauseBtn').textContent = '继续';
    }
  }

  loop = (wall) => {
    this.rafId = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (wall - this.lastWall) / 1000);
    this.lastWall = wall;
    const frozen = this.state.paused || this.state.halted || this.state.won;
    if (!frozen) {
      this.step(dt);
      this.decayFlash(dt);
    }
    this.render();
  };

  decayFlash(dt) {
    for (let i = 0; i < 3; i += 1) {
      this.state.flashes[i] = Math.max(0, this.state.flashes[i] - FLASH_DECAY * dt);
    }
    this.state.spawnPulse = Math.max(0, this.state.spawnPulse - 4 * dt);
  }

  step(dt) {
    const s = this.state;
    s.vt += dt;

    // 生成物体
    while (s.spawned < OBJECT_COUNT && s.nextSpawn <= s.vt) {
      s.objects.push({
        id: s.nextId,
        spawnTime: s.nextSpawn,
        x: TUNNEL.spawnX,
        done: false,
        crashed: false,
        crashTime: 0,
        passedGate: [false, false, false],
      });
      s.nextId += 1;
      s.spawned += 1;
      s.spawnPulse = 1;
      s.nextSpawn += SPAWN_INTERVAL;
    }

    // 物体运动 + 逐闸门精确碰撞
    for (const obj of s.objects) {
      if (obj.done || obj.crashed) continue;
      obj.x = objectX(obj.spawnTime, s.vt);
      for (let gi = 0; gi < GATES.length; gi += 1) {
        if (obj.passedGate[gi]) continue;
        const crossTime = obj.spawnTime + (TUNNEL.gateX[gi] - TUNNEL.spawnX) / OBJECT_SPEED;
        if (crossTime <= s.vt) {
          obj.passedGate[gi] = true;
          if (!isGateOpenAt(GATES[gi], s.params[gi], crossTime)) {
            obj.crashed = true;
            obj.crashTime = s.vt;
            obj.x = TUNNEL.gateX[gi];
            this.registerFail();
            break;
          }
        }
      }
      if (!obj.crashed && obj.x >= TUNNEL.exitX) {
        obj.done = true;
        s.passedCount += 1;
        s.failStreak = 0;
        if (s.passedCount >= OBJECT_COUNT) {
          s.won = true;
          this.audio.pause();
        }
      }
    }

    this.audio.update(s.vt, LOOKAHEAD);
    this.updateHud();
  }

  registerFail() {
    const s = this.state;
    s.failStreak += 1;
    if (s.failStreak >= MAX_FAIL_STREAK) {
      s.halted = true;
      this.audio.pause();
      document.getElementById('pauseBtn').textContent = '已停机';
    }
  }

  updateHud() {
    const s = this.state;
    document.getElementById('passed').textContent = String(s.passedCount).padStart(2, '0');
    document.getElementById('spawned').textContent = String(s.spawned).padStart(2, '0');
    document.getElementById('streak').textContent = String(s.failStreak);
    const status = document.getElementById('status');
    if (s.won) status.textContent = `✔ 十二个物体全部通过（虚拟时刻 ${s.vt.toFixed(2)}s）`;
    else if (s.halted) status.textContent = '■ 已停机：连续三次撞门';
    else if (s.paused) status.textContent = '⏸ 已冻结';
    else status.textContent = `运行中 · 虚拟时刻 ${s.vt.toFixed(2)}s`;
  }

  render() {
    this.renderer.draw(this.state);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
