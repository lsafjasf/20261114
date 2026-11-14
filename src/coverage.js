/*
 * 基站覆盖核心计算模块（无 DOM 依赖，可在 Node 与浏览器中运行）。
 * 地图单位为米，坐标原点在左上角，角度 0 指向 +X（东），顺时针为正。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Coverage = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var WORLD = { width: 1000, height: 750 };
  var CELL = 5;
  var GRID_W = Math.floor(WORLD.width / CELL);
  var GRID_H = Math.floor(WORLD.height / CELL);
  var SEED = 20261114;

  var TERRAIN = { GRASS: 0, FOREST: 1, WATER: 2, ROCK: 3 };
  var COVERABLE = {};
  COVERABLE[TERRAIN.GRASS] = true;
  COVERABLE[TERRAIN.FOREST] = true;
  COVERABLE[TERRAIN.WATER] = false;
  COVERABLE[TERRAIN.ROCK] = false;

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function smoothstep(t) {
    return t * t * (3 - 2 * t);
  }

  /* 固定种子的双线性插值值噪声，同一种子永远生成同一张地形。 */
  function makeNoise2D(seed, cols, rows) {
    var rand = mulberry32(seed);
    var lattice = new Float32Array(cols * rows);
    for (var i = 0; i < lattice.length; i++) lattice[i] = rand();
    return function noise2D(x, y) {
      var gx = Math.floor(x);
      var gy = Math.floor(y);
      var tx = smoothstep(x - gx);
      var ty = smoothstep(y - gy);
      var x0 = ((gx % cols) + cols) % cols;
      var y0 = ((gy % rows) + rows) % rows;
      var x1 = (x0 + 1) % cols;
      var y1 = (y0 + 1) % rows;
      var v00 = lattice[y0 * cols + x0];
      var v10 = lattice[y0 * cols + x1];
      var v01 = lattice[y1 * cols + x0];
      var v11 = lattice[y1 * cols + x1];
      var top = v00 + (v10 - v00) * tx;
      var bottom = v01 + (v11 - v01) * tx;
      return top + (bottom - top) * ty;
    };
  }

  function createTerrain(seed) {
    if (seed === undefined) seed = SEED;
    var elevNoise = makeNoise2D(seed, 34, 26);
    var moistNoise = makeNoise2D(seed ^ 0x9e3779b9, 16, 12);
    var grid = new Uint8Array(GRID_W * GRID_H);
    var waterCells = 0;
    for (var gy = 0; gy < GRID_H; gy++) {
      for (var gx = 0; gx < GRID_W; gx++) {
        var wx = (gx + 0.5) * CELL;
        var wy = (gy + 0.5) * CELL;
        var broad = elevNoise(wx / 320, wy / 320);
        var detail = elevNoise(wx / 110 + 40, wy / 110 + 40);
        var h = broad * 0.72 + detail * 0.28;
        var moist = moistNoise(wx / 260, wy / 260);
        var t;
        if (h < 0.3) {
          t = TERRAIN.WATER;
          waterCells++;
        } else if (h > 0.72) {
          t = TERRAIN.ROCK;
        } else if (moist > 0.56) {
          t = TERRAIN.FOREST;
        } else {
          t = TERRAIN.GRASS;
        }
        grid[gy * GRID_W + gx] = t;
      }
    }
    return {
      grid: grid,
      gridW: GRID_W,
      gridH: GRID_H,
      cell: CELL,
      seed: seed,
      waterCells: waterCells
    };
  }

  function angleDiff(a, b) {
    var d = (a - b) % 360;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
  }

  function pointInSector(px, py, station) {
    var dx = px - station.x;
    var dy = py - station.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > station.radius) return false;
    if (station.beam >= 359.999) return true;
    var bearing = Math.atan2(dy, dx) * 180 / Math.PI;
    return Math.abs(angleDiff(bearing, station.angle)) <= station.beam / 2;
  }

  function defaultStations() {
    return [
      { id: 0, name: '基站 A', x: 240, y: 210, radius: 260, angle: -20, beam: 90 },
      { id: 1, name: '基站 B', x: 520, y: 430, radius: 280, angle: 95, beam: 100 },
      { id: 2, name: '基站 C', x: 790, y: 230, radius: 240, angle: 205, beam: 90 }
    ];
  }

  return {
    WORLD: WORLD,
    CELL: CELL,
    GRID_W: GRID_W,
    GRID_H: GRID_H,
    SEED: SEED,
    TERRAIN: TERRAIN,
    COVERABLE: COVERABLE,
    mulberry32: mulberry32,
    createTerrain: createTerrain,
    pointInSector: pointInSector,
    angleDiff: angleDiff,
    defaultStations: defaultStations,
    computeCoverage: computeCoverage
  };

  /*
   * 以栅格（CELL 米见方）为单位统计三扇区覆盖：
   * 水域/岩石不可覆盖；同一栅格被多个扇区覆盖记为重叠。
   */
  function computeCoverage(terrain, stations) {
    var gw = terrain.gridW;
    var gh = terrain.gridH;
    var cell = terrain.cell;
    var counts = new Uint8Array(gw * gh);
    var coverable = 0;

    for (var i = 0; i < terrain.grid.length; i++) {
      if (COVERABLE[terrain.grid[i]]) coverable++;
    }

    for (var s = 0; s < stations.length; s++) {
      var st = stations[s];
      var minGx = Math.max(0, Math.floor((st.x - st.radius) / cell));
      var maxGx = Math.min(gw - 1, Math.floor((st.x + st.radius) / cell));
      var minGy = Math.max(0, Math.floor((st.y - st.radius) / cell));
      var maxGy = Math.min(gh - 1, Math.floor((st.y + st.radius) / cell));
      for (var gy = minGy; gy <= maxGy; gy++) {
        for (var gx = minGx; gx <= maxGx; gx++) {
          var idx = gy * gw + gx;
          if (!COVERABLE[terrain.grid[idx]]) continue;
          if (counts[idx] === 255) continue;
          var wx = (gx + 0.5) * cell;
          var wy = (gy + 0.5) * cell;
          if (pointInSector(wx, wy, st)) counts[idx]++;
        }
      }
    }

    var covered = 0;
    var overlap = 0;
    var coverSums = 0;
    for (var k = 0; k < counts.length; k++) {
      var c = counts[k];
      if (c > 0) {
        covered++;
        coverSums += c;
        if (c >= 2) overlap++;
      }
    }
    var blind = coverable - covered;
    var cellArea = cell * cell;
    return {
      counts: counts,
      coverableCells: coverable,
      coveredCells: covered,
      overlapCells: overlap,
      blindCells: blind,
      coverableArea: coverable * cellArea,
      coveredArea: covered * cellArea,
      overlapArea: overlap * cellArea,
      blindArea: blind * cellArea,
      wastedArea: (coverSums - covered) * cellArea,
      coverageRate: coverable === 0 ? 0 : covered / coverable,
      wasteRate: covered === 0 ? 0 : (coverSums - covered) / coverSums
    };
  }
});
