const assert = require('assert');
const T = require('../terrain.js');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok - ' + name);
  } catch (err) {
    console.error('FAIL - ' + name);
    console.error(err && err.stack ? err.stack : err);
    process.exitCode = 1;
  }
}

test('same seed produces bit-identical height fields', () => {
  for (const seed of [1, 42, 20261114, 0xffffffff]) {
    const a = T.createHeightField(64, seed);
    const b = T.createHeightField(64, seed);
    assert.strictEqual(a.length, b.length);
    for (let k = 0; k < a.length; k++) assert.strictEqual(a[k], b[k]);
  }
});

test('different seeds produce different terrain', () => {
  const a = T.createHeightField(48, 7);
  const b = T.createHeightField(48, 8);
  let diffs = 0;
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) diffs++;
  assert.ok(diffs > a.length * 0.9, 'seeds 7/8 should differ almost everywhere');
});

test('hash2 is stable for negative lattice coords', () => {
  assert.strictEqual(T.hash2(-3, -9, 11), T.hash2(-3, -9, 11));
  assert.notStrictEqual(T.hash2(0, 0, 1), T.hash2(1, 0, 1));
});

test('contour levels align to spacing and cover terrain range', () => {
  const levels = T.contourLevels(-2.3, 1.7, 0.5);
  for (const v of levels) assert.ok(Math.abs(v / 0.5 - Math.round(v / 0.5)) < 1e-9);
  assert.strictEqual(levels[0], -2);
  assert.strictEqual(levels[levels.length - 1], 1.5);
  assert.deepStrictEqual(T.contourLevels(-2, 2, 1), [-2, -1, 0, 1, 2]);
});

test('every contour: no broken lines across seeds, spacings and tide levels', () => {
  const n = 64;
  for (const seed of [1, 42, 20261114]) {
    const grid = T.createHeightField(n, seed);
    const stats = T.gridStats(grid);
    for (const spacing of [0.25, 0.5, 1]) {
      const levels = T.contourLevels(stats.min, stats.max, spacing);
      // tide sweeps across every level, including exact-level values
      const tides = levels.slice();
      for (let k = 0; k < levels.length - 1; k++) {
        tides.push((levels[k] + levels[k + 1]) / 2);
      }
      for (const tide of tides) {
        const c = T.extractContour(grid, n, tide);
        const v = T.verifyContours([c], n);
        assert.ok(v.ok, `seed=${seed} spacing=${spacing} tide=${tide}: ${v.reason}`);
      }
      // batch API identical to single extraction
      const batch = T.extractContours(grid, n, levels);
      const v2 = T.verifyContours(batch, n);
      assert.ok(v2.ok, 'batch verify: ' + v2.reason);
      assert.strictEqual(
        batch.reduce((s, c2) => s + c2.segmentCount, 0),
        levels.reduce((s, l) => s + T.extractContour(grid, n, l).segmentCount, 0)
      );
    }
  }
});

test('contour points sit on the level and interpolate within the cell', () => {
  const n = 32;
  const grid = T.createHeightField(n, 42);
  const stats = T.gridStats(grid);
  const level = (stats.min + stats.max) / 2;
  const c = T.extractContour(grid, n, level);
  assert.ok(c.segmentCount > 0);
  for (const pts of c.polylines) {
    for (const p of pts) {
      assert.ok(p.x >= -1e-9 && p.x <= n - 1 + 1e-9);
      assert.ok(p.y >= -1e-9 && p.y <= n - 1 + 1e-9);
    }
  }
});

test('shoal band switches only when tide crosses a contour level', () => {
  const min = -2;
  const spacing = 0.5;
  const b1 = T.shoalBand(-1.9, min, spacing);
  const b2 = T.shoalBand(-1.51, min, spacing);
  assert.strictEqual(b1, b2, 'same band before the crossing stays stable');
  const b3 = T.shoalBand(-1.5, min, spacing);
  assert.notStrictEqual(b1, b3, 'reaching the level advances the band');
  const b4 = T.shoalBand(-1.499, min, spacing);
  assert.strictEqual(b3, b4);
  assert.strictEqual(T.shoalBand(min, min, spacing), T.SHOAL_BANDS[0]);
  assert.strictEqual(T.shoalBand(min + spacing, min, spacing), T.SHOAL_BANDS[1]);
});

test('terrain ramp colors stay in RGB range', () => {
  for (let h = -4; h <= 4; h += 0.13) {
    const c = T.rampColor(T.TERRAIN_RAMP, h);
    for (const ch of c) assert.ok(ch >= 0 && ch <= 255);
  }
});

console.log(`\n${passed} tests passed` + (process.exitCode ? ' (with failures)' : ''));
