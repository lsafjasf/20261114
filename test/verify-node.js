// Node 端验证：node-web-audio-api 提供与浏览器一致的 Web Audio 实现，
// 直接复用 src/engine.js 的离线路径 buildOfflineGraph，验证故障与修复两种接法。

import { OfflineAudioContext } from 'node-web-audio-api';
import {
  createFaultyBoard,
  createSolvedBoard,
  isSolved,
} from '../src/model.js';
import { buildOfflineGraph } from '../src/engine.js';

const DURATION = 12;
const SAMPLE_RATE = 44100;

function assert(condition, message) {
  if (!condition) throw new Error(`断言失败: ${message}`);
}

async function render(board) {
  const ctx = new OfflineAudioContext(1, SAMPLE_RATE * DURATION, SAMPLE_RATE);
  buildOfflineGraph(ctx, board, DURATION);
  const buffer = await ctx.startRendering();
  return buffer.getChannelData(0);
}

// 复刻 engine.update() 的过载判定：0.1s 窗口内出现满幅样本即计为过载窗口，
// 连续 50 个过载窗口（5 秒）判失败；中间出现干净窗口则清零。
function analyze(data) {
  const windowSize = Math.floor(SAMPLE_RATE * 0.1);
  let consecutive = 0;
  let failAt = null;
  let overloadStart = null;
  let longestRun = { start: null, windows: 0 };
  let runStart = null;
  const windowPeaks = [];
  for (let start = 0; start < data.length; start += windowSize) {
    let peak = 0;
    for (let i = start; i < Math.min(start + windowSize, data.length); i += 1) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
    }
    windowPeaks.push(peak);
    // 浏览器中满幅样本被钳到 ±1，Node 原生实现保留浮点，统一以接近/超过满幅判定。
    if (peak >= 0.995) {
      if (overloadStart === null) overloadStart = start / SAMPLE_RATE;
      if (consecutive === 0) runStart = start / SAMPLE_RATE;
      consecutive += 1;
      if (consecutive > longestRun.windows) {
        longestRun = { start: runStart, windows: consecutive };
      }
      if (consecutive >= 50 && failAt === null) {
        failAt = (start + windowSize) / SAMPLE_RATE;
      }
    } else {
      consecutive = 0;
    }
  }

  // 回声检测：最后一个脉冲在 7.25s 触发，7.6s 后只剩逐次衰减的回声拖尾。
  const tailStart = Math.floor(SAMPLE_RATE * (DURATION - 4.4));
  let echoEnergy = 0;
  for (let i = tailStart; i < data.length; i += 1) echoEnergy += data[i] * data[i];
  // 用 0.1s 细窗扫描拖尾包络，再取局部极大值（即每次回声事件）验证逐次衰减。
  const echoWindow = Math.floor(SAMPLE_RATE * 0.1);
  const envelope = [];
  for (let k = 0; k < 12; k += 1) {
    let peak = 0;
    for (let i = tailStart + k * echoWindow;
      i < tailStart + (k + 1) * echoWindow && i < data.length; i += 1) {
      if (Math.abs(data[i]) > peak) peak = Math.abs(data[i]);
    }
    envelope.push(peak);
  }
  const localMaxima = envelope
    .map((value, k) => ({ value, k }))
    .filter(({ value, k }) => value > 0.005
      && value >= (envelope[k - 1] ?? 0)
      && value >= (envelope[k + 1] ?? 0))
    .map(({ value }) => value);
  const significant = localMaxima.slice(0, 3);
  return {
    failAt,
    overloadStart,
    sustainedSeconds: failAt !== null ? failAt - overloadStart : null,
    longestRun,
    echoEnergy,
    echoPeaks: significant,
    rawEchoPeaks: envelope,
    windowPeaks,
  };
}

async function main() {
  const faultyData = await render(createFaultyBoard());
  const solvedData = await render(createSolvedBoard());
  const faulty = analyze(faultyData);
  const solved = analyze(solvedData);

  console.log('故障板分析:', JSON.stringify({
    failAt: faulty.failAt,
    overloadStart: Number(faulty.overloadStart.toFixed(2)),
    longestRunWindows: faulty.longestRun.windows,
    longestRunStart: Number(faulty.longestRun.start.toFixed(2)),
    echoEnergy: Number(faulty.echoEnergy.toFixed(4)),
    latePeaks: faulty.windowPeaks.slice(-8).map((p) => Number(p.toFixed(3))),
  }));
  console.log('修复板分析:', JSON.stringify({
    failAt: solved.failAt,
    echoEnergy: Number(solved.echoEnergy.toFixed(4)),
    echoPeaks: solved.echoPeaks.map((p) => Number(p.toFixed(4))),
  }));

  assert(isSolved(createSolvedBoard()), 'isSolved 应识别正确板');
  assert(!isSolved(createFaultyBoard()), '故障板不应被识别为已修复');
  assert(faulty.failAt !== null, '错误接法必须触发持续过载失败');
  // 引擎规则：连续 50 个 0.1s 过载窗口（即持续 5 秒）判失败。
  assert(faulty.longestRun.windows >= 50,
    `错误接法最长连续过载段应达到 50 个窗口（5 秒），实际 ${faulty.longestRun.windows} 个`);
  const failDelay = faulty.failAt - faulty.longestRun.start;
  assert(Math.abs(failDelay - 5) <= 0.2,
    `应在持续过载开始后 5 秒判失败，实际 ${failDelay.toFixed(2)}s`);
  assert(solved.failAt === null, '修复后不得触发过载失败');
  assert(solved.echoEnergy > 0.01, '修复后必须保留可测量的回声能量');
  const [a, b, c] = solved.echoPeaks;
  assert(solved.echoPeaks.length >= 3,
    `拖尾应至少检测到 3 个回声峰值，实际 ${JSON.stringify(solved.echoPeaks)}`);
  assert(a > b && b > c && a > 0.01,
    `回声应逐次衰减，实际峰值 ${JSON.stringify(solved.echoPeaks)}`);

  console.log('\n全部验证通过：错误接法持续过载 5 秒失败；修复后主信号不过载，回声保留并逐次衰减。');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
