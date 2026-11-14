// 应用控制器：连接模型、Web Audio 引擎与 Canvas 渲染，处理旋转/交换与胜负判定。

import {
  createFaultyBoard,
  createSolvedBoard,
  rotateCard,
  swapCards,
  isSolved,
} from './model.js';
import { AudioEngine, OVERLOAD_LIMIT_SECONDS } from './engine.js';
import { Renderer } from './renderer.js';

const PING_INTERVAL = 1.2;

class WorkstationApp {
  constructor() {
    this.canvas = document.getElementById('stage');
    this.canvas.width = 1080;
    this.canvas.height = 560;
    this.renderer = new Renderer(this.canvas);
    this.board = createFaultyBoard();
    this.selectedIndex = null;
    this.engine = null;
    this.ctx = null;
    this.pingTimer = null;
    this.rafId = 0;
    this.running = false;
    this.solved = false;
    this.status = {
      failed: false,
      overloaded: false,
      overloadSeconds: 0,
      rms: 0,
      peak: 0,
    };
    this.bindUi();
    this.renderLoop();
  }

  bindUi() {
    this.startBtn = document.getElementById('start-btn');
    this.resetBtn = document.getElementById('reset-btn');
    this.banner = document.getElementById('banner');
    this.startBtn.addEventListener('click', () => this.start());
    this.resetBtn.addEventListener('click', () => this.reset());
    this.canvas.addEventListener('click', (event) => this.onCanvasClick(event));
  }

  async start() {
    if (this.running) return;
    if (this.ctx) {
      await this.ctx.close().catch(() => {});
      this.ctx = null;
      this.engine = null;
    }
    this.status = {
      failed: false,
      overloaded: false,
      overloadSeconds: 0,
      rms: 0,
      peak: 0,
    };
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    await this.ctx.resume();
    this.engine = new AudioEngine(this.ctx);
    this.engine.buildChain(this.board);
    this.engine.startPings();
    this.pingTimer = setInterval(() => {
      if (!this.engine.failed) this.engine.schedulePing(this.ctx.currentTime + 0.02);
    }, PING_INTERVAL * 1000);
    this.running = true;
    this.startBtn.disabled = true;
    this.setBanner(
      isSolved(this.board)
        ? '链路已通电：当前是正确接法，主信号干净且回声保留'
        : '链路已通电：当前是故障接法，注意过载计时',
      'warn',
    );
  }

  onCanvasClick(event) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const idx = this.renderer.cardAt(
      (event.clientX - rect.left) * scaleX,
      (event.clientY - rect.top) * scaleY,
    );
    if (idx === null) {
      this.selectedIndex = null;
      return;
    }
    if (this.selectedIndex === null) {
      this.selectedIndex = idx;
      return;
    }
    if (this.selectedIndex === idx) {
      // 点击同一节点 = 旋转档位。
      this.board = rotateCard(this.board, this.board[idx].id);
      this.selectedIndex = null;
    } else {
      // 点击两个节点 = 交换槽位。
      this.board = swapCards(this.board, this.selectedIndex, idx);
      this.selectedIndex = null;
    }
    this.rebuildChain();
  }

  rebuildChain() {
    if (this.engine) this.engine.buildChain(this.board);
    if (isSolved(this.board)) {
      this.solved = true;
      this.setBanner('修复成功：主信号干净恢复，回声保留且逐次衰减', 'ok');
    } else if (this.running && !this.status.failed) {
      this.setBanner('链路已重建：实时监听当前接法', 'warn');
    }
  }

  renderLoop(now = 0) {
    if (this.engine && this.running) {
      this.status = this.engine.update(now / 1000);
      if (this.status.failed) this.onFail();
    }
    this.renderer.draw({
      board: this.board,
      selectedIndex: this.selectedIndex,
      status: this.status,
      spectrum: this.engine ? this.engine.getSpectrum() : new Uint8Array(1024),
    });
    this.rafId = requestAnimationFrame((t) => this.renderLoop(t));
  }

  onFail() {
    if (!this.running) return;
    this.running = false;
    clearInterval(this.pingTimer);
    this.ctx.suspend();
    this.setBanner(`失败：错误接法持续过载达到 ${OVERLOAD_LIMIT_SECONDS} 秒，已静音。请复位后重新排障`, 'fail');
    this.startBtn.disabled = false;
    this.startBtn.textContent = '重新通电';
  }

  reset() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.ctx) this.ctx.close().catch(() => {});
    this.ctx = null;
    this.engine = null;
    this.running = false;
    this.solved = false;
    this.selectedIndex = null;
    this.board = createFaultyBoard();
    this.status = {
      failed: false,
      overloaded: false,
      overloadSeconds: 0,
      rms: 0,
      peak: 0,
    };
    this.startBtn.disabled = false;
    this.startBtn.textContent = '通电监听';
    this.setBanner('已复位到固定故障板', 'warn');
  }

  setBanner(text, kind) {
    this.banner.textContent = text;
    this.banner.className = `banner ${kind}`;
  }

  // 供自动化测试直接套用正确解并重建链路。
  applySolvedBoard() {
    this.board = createSolvedBoard();
    this.selectedIndex = null;
    this.rebuildChain();
  }
}

window.WorkstationApp = WorkstationApp;
window.addEventListener('DOMContentLoaded', () => {
  window.app = new WorkstationApp();
});
