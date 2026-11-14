const assert = require('assert');
const test = require('node:test');
const C = require('../src/coverage.js');

test('固定 seed 生成确定性地形', () => {
  const a = C.createTerrain();
  const b = C.createTerrain(C.SEED);
  const other = C.createTerrain(C.SEED + 1);
  assert.strictEqual(a.seed, C.SEED);
  assert.ok(Buffer.compare(a.grid, b.grid) === 0);
  assert.ok(Buffer.compare(a.grid, other.grid) !== 0);
  const types = new Set(a.grid);
  assert.deepStrictEqual([...types].sort(), [0, 1, 2, 3]);
});

test('扇区判定：距离与方位角共同约束', () => {
  const st = { x: 100, y: 100, radius: 100, angle: 0, beam: 90 };
  assert.strictEqual(C.pointInSector(150, 100, st), true);
  assert.strictEqual(C.pointInSector(100, 150, st), false);
  assert.strictEqual(C.pointInSector(220, 100, st), false);
  const omni = { x: 0, y: 0, radius: 50, angle: 0, beam: 360 };
  assert.strictEqual(C.pointInSector(-40, 30, omni), true);
  assert.strictEqual(C.angleDiff(-170, 170), 20);
});

test('覆盖统计满足面积恒等式', () => {
  const terrain = C.createTerrain();
  const stats = C.computeCoverage(terrain, C.defaultStations());
  assert.strictEqual(
    stats.coveredCells + stats.blindCells,
    stats.coverableCells
  );
  assert.ok(stats.overlapCells <= stats.coveredCells);
  assert.ok(stats.coverageRate >= 0 && stats.coverageRate <= 1);
  assert.ok(stats.wastedArea >= stats.overlapArea);
  assert.strictEqual(stats.coveredArea, stats.coveredCells * C.CELL * C.CELL);
});

test('移动一座基站后覆盖区域与统计同步变化', () => {
  const terrain = C.createTerrain();
  const before = C.defaultStations();
  const beforeStats = C.computeCoverage(terrain, before);

  const after = before.map((s) => Object.assign({}, s));
  after[1].x += 150;
  after[1].y -= 90;
  const afterStats = C.computeCoverage(terrain, after);

  let changedCells = 0;
  for (let i = 0; i < beforeStats.counts.length; i++) {
    if (beforeStats.counts[i] !== afterStats.counts[i]) changedCells++;
  }
  assert.ok(changedCells > 0, '覆盖栅格应随基站移动而变化');
  assert.notStrictEqual(beforeStats.coveredCells, afterStats.coveredCells);
  assert.notStrictEqual(beforeStats.blindCells, afterStats.blindCells);
  assert.strictEqual(afterStats.blindCells, afterStats.coverableCells - afterStats.coveredCells);

  const restored = after.map((s) => Object.assign({}, s));
  restored[1] = Object.assign({}, before[1]);
  const restoredStats = C.computeCoverage(terrain, restored);
  assert.deepStrictEqual(
    Array.from(restoredStats.counts),
    Array.from(beforeStats.counts)
  );
});

test('半径缩小会降低覆盖率并减少重叠浪费', () => {
  const terrain = C.createTerrain();
  const big = C.defaultStations();
  const small = big.map((s) => Object.assign({}, s, { radius: s.radius * 0.5 }));
  const bigStats = C.computeCoverage(terrain, big);
  const smallStats = C.computeCoverage(terrain, small);
  assert.ok(smallStats.coveredCells < bigStats.coveredCells);
  assert.ok(smallStats.blindCells > bigStats.blindCells);
  assert.ok(smallStats.wastedArea <= bigStats.wastedArea);
});
