'use strict';

const fs = require('fs');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');
const Core = require('../js/core.js');

const W = Core.WIDTH, H = Core.HEIGHT, D = Core.DURATION;
const ROOT = path.join(__dirname, '..');

function render(params, t) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  Core.renderFrame(ctx, params, t);
  return ctx.getImageData(0, 0, W, H);
}

function imgEqual(a, b) {
  let diff = 0;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) diff++;
  return diff;
}

function loopRun(params, label) {
  const fps = 30;
  const frames = fps * D; // 240 frames; transition last -> t=0 is the seam
  let prev = render(params, 0);
  let maxInter = 0, sumInter = 0, interCount = 0;
  let wrapMax = 0, wrapSum = 0, wrapCount = 0;
  const perRound = [];
  const first = prev;
  for (let round = 0; round < 3; round++) {
    let roundWrapMae = 0;
    for (let k = 1; k <= frames; k++) {
      const t = (k % frames) / fps;
      const img = render(params, t);
      const st = Core.diffStats(prev, img);
      if (k === frames) {
        wrapMax = Math.max(wrapMax, st.max);
        roundWrapMae = st.mae;
        wrapSum += st.mae; wrapCount++;
      } else {
        maxInter = Math.max(maxInter, st.max);
        sumInter += st.mae; interCount++;
      }
      prev = img;
    }
    perRound.push(roundWrapMae);
  }
  const seam = Core.diffStats(first, render(params, D));
  return {
    label,
    seamMae: seam.mae,
    seamRmse: seam.rmse,
    seamMax: seam.max,
    seamChangedPct: seam.changedPct,
    wrapMax,
    wrapMeanMae: wrapSum / wrapCount,
    interMax: maxInter,
    interMeanMae: sumInter / interCount,
    wrapToInterRatio: (wrapSum / wrapCount) / (sumInter / interCount),
    wrapMaePerRound: perRound,
    round1Seam: seam
  };
}

const seedArg = process.argv[2] || 'demo-seed-2026';
const raw = Core.makeParams(seedArg);
const corrected = Core.snapParams(raw);

// reproducibility: same seed -> byte-identical params and pixels
const raw2 = Core.makeParams(seedArg);
const sameParams = JSON.stringify(raw) === JSON.stringify(raw2);
const px1 = render(raw, 3.37), px2 = render(raw2, 3.37);
const samePixels = imgEqual(px1, px2) === 0;
const seedNum1 = Core.makeParams(42).seed;
const seedNum2 = Core.makeParams('42').seed;

const rawResult = loopRun(raw, 'raw (correction off)');
const fixedResult = loopRun(corrected, 'corrected (loop-safe)');

// save heatmaps and seam frames as PNG for inspection
function savePng(img, name) {
  const c = createCanvas(W, H);
  c.getContext('2d').putImageData(img, 0, 0);
  fs.writeFileSync(path.join(ROOT, 'artifacts', name), c.toBuffer('image/png'));
}
const rawFirst = render(raw, 0), rawLast = render(raw, D);
const fixFirst = render(corrected, 0), fixLast = render(corrected, D);
const heatRaw = createCanvas(W, H).getContext('2d').createImageData(W, H);
const heatFix = createCanvas(W, H).getContext('2d').createImageData(W, H);
Core.buildHeatmap(rawFirst, rawLast, heatRaw);
Core.buildHeatmap(fixFirst, fixLast, heatFix);
savePng(rawFirst, 'raw-first.png');
savePng(rawLast, 'raw-last.png');
savePng(heatRaw, 'raw-heatmap.png');
savePng(fixFirst, 'corrected-first.png');
savePng(fixLast, 'corrected-last.png');
savePng(heatFix, 'corrected-heatmap.png');

fs.writeFileSync(
  path.join(ROOT, 'artifacts', 'params.sample.json'),
  JSON.stringify({ raw, corrected }, null, 2)
);

const report = {
  seed: seedArg,
  normalizedSeed: raw.seed,
  reproducible: {
    sameParamsForSameSeed: sameParams,
    samePixelsForSameSeed: samePixels,
    numericSeed42: seedNum1,
    stringSeed42: seedNum2
  },
  raw: rawResult,
  corrected: fixedResult,
  improvement: {
    seamMaeReductionPct: (1 - fixedResult.seamMae / rawResult.seamMae) * 100,
    wrapMaxReductionPct: (1 - fixedResult.wrapMax / rawResult.wrapMax) * 100
  }
};
fs.writeFileSync(
  path.join(ROOT, 'artifacts', 'seam-report.json'),
  JSON.stringify(report, null, 2)
);
console.log(JSON.stringify(report, null, 2));

const fail = [];
if (!sameParams || !samePixels) fail.push('reproducibility');
if (rawResult.seamMae < 1) fail.push('raw seam should be visibly broken');
if (fixedResult.seamMae > 0.5) fail.push('corrected seam not closed');
// corrected wrap transition must look like an ordinary frame-to-frame step
if (fixedResult.wrapToInterRatio > 1.25) fail.push('wrap still harder than normal frame step');
// raw mode must show a clearly visible jump at the seam
if (rawResult.wrapToInterRatio < 3) fail.push('raw seam jump not pronounced enough');
// all three loop rounds must behave identically
const r = fixedResult.wrapMaePerRound;
if (Math.max(...r) - Math.min(...r) > 1e-9) fail.push('three rounds are not identical');
if (fail.length) {
  console.error('FAIL:', fail.join(', '));
  process.exit(1);
}
console.log('\nPASS: all seam / loop / reproducibility checks');
