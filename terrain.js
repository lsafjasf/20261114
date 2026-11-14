/* Terrain core: deterministic seabed synthesis + marching-squares contours.
 * UMD module, works in both browser and Node (no DOM usage here). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Terrain = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------- deterministic randomness ---------------- */

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Integer lattice hash: same (ix, iy, seed) always gives same value,
   * including for negative lattice coordinates. */
  function hash2(ix, iy, seed) {
    let h = (seed | 0) ^ (ix | 0);
    h = Math.imul(h, 0x27d4eb2d);
    h ^= Math.imul(iy | 0, 0x165667b1);
    h ^= h >>> 15;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  function smooth(t) {
    return t * t * (3 - 2 * t);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /* Smooth value noise on an infinite integer lattice. */
  function valueNoise(x, y, seed) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smooth(x - x0);
    const fy = smooth(y - y0);
    const v00 = hash2(x0, y0, seed);
    const v10 = hash2(x0 + 1, y0, seed);
    const v01 = hash2(x0, y0 + 1, seed);
    const v11 = hash2(x0 + 1, y0 + 1, seed);
    return lerp(lerp(v00, v10, fx), lerp(v01, v11, fx), fy);
  }

  function fbm(x, y, seed, octaves) {
    let sum = 0;
    let amp = 1;
    let ampTotal = 0;
    let freq = 1;
    for (let k = 0; k < octaves; k++) {
      sum += amp * valueNoise(x * freq, y * freq, seed + k * 1013);
      ampTotal += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / ampTotal;
  }

  /* Undulating seabed with ridges, an asymmetric dome and a regional tilt.
   * nx, ny are normalized coordinates in [0, 1]. Pure function of (seed). */
  function heightAt(nx, ny, seed) {
    const base = fbm(nx * 3.2, ny * 3.2, seed, 5);
    const ridgeNoise = fbm(nx * 4.5 + 13.7, ny * 4.5 - 7.1, seed ^ 0x9e3779b9, 4);
    const ridge = 1 - Math.abs(2 * ridgeNoise - 1);
    const r = Math.hypot(nx - 0.5, ny - 0.46) * 2;
    const dome = 1.7 * Math.max(0, 1 - r * r);
    const tilt = 0.55 * (0.5 - ny);
    return (base - 0.5) * 3.4 + (ridge - 0.5) * 1.9 + dome + tilt;
  }

  function createHeightField(n, seed) {
    const grid = new Float64Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        grid[j * n + i] = heightAt(i / (n - 1), j / (n - 1), seed);
      }
    }
    return grid;
  }

  function gridStats(grid) {
    let min = Infinity;
    let max = -Infinity;
    for (let k = 0; k < grid.length; k++) {
      if (grid[k] < min) min = grid[k];
      if (grid[k] > max) max = grid[k];
    }
    return { min, max };
  }

  /* Regular contour levels aligned to spacing, snapped away from float drift. */
  function contourLevels(min, max, spacing) {
    const out = [];
    const k0 = Math.ceil(min / spacing - 1e-9);
    const k1 = Math.floor(max / spacing + 1e-9);
    for (let k = k0; k <= k1; k++) {
      out.push(Math.round(k * spacing * 1e9) / 1e9);
    }
    return out;
  }

  /* ---------------- color ramps ---------------- */

  const TERRAIN_RAMP = [
    { h: -3.2, c: [17, 54, 96] },
    { h: -1.6, c: [33, 102, 145] },
    { h: -0.55, c: [74, 148, 162] },
    { h: -0.08, c: [196, 190, 140] },
    { h: 0.08, c: [214, 198, 141] },
    { h: 0.7, c: [122, 168, 107] },
    { h: 1.6, c: [107, 127, 78] },
    { h: 2.6, c: [138, 122, 99] }
  ];

  function rampColor(ramp, h) {
    if (h <= ramp[0].h) return ramp[0].c.slice();
    const last = ramp[ramp.length - 1];
    if (h >= last.h) return last.c.slice();
    for (let k = 0; k < ramp.length - 1; k++) {
      const a = ramp[k];
      const b = ramp[k + 1];
      if (h >= a.h && h <= b.h) {
        const t = (h - a.h) / (b.h - a.h);
        return [
          Math.round(lerp(a.c[0], b.c[0], t)),
          Math.round(lerp(a.c[1], b.c[1], t)),
          Math.round(lerp(a.c[2], b.c[2], t))
        ];
      }
    }
    return last.c.slice();
  }

  /* Discrete shoal bands: the index advances by one every time the tide
   * crosses a contour level, so the water color switches at crossings. */
  const SHOAL_BANDS = [
    { name: '深海海槽', water: [9, 47, 87], haze: [13, 61, 107] },
    { name: '深水斜坡', water: [14, 74, 124], haze: [21, 92, 145] },
    { name: '浅海海盆', water: [23, 101, 150], haze: [33, 122, 168] },
    { name: '大陆架', water: [38, 130, 165], haze: [58, 152, 180] },
    { name: '潮间浅滩', water: [76, 160, 172], haze: [104, 181, 184] },
    { name: '沙坝沙洲', water: [137, 186, 168], haze: [167, 203, 178] },
    { name: '潮上滩涂', water: [190, 202, 158], haze: [208, 211, 170] },
    { name: '海岸陆地', water: [206, 190, 138], haze: [216, 200, 150] }
  ];

  function shoalBand(tide, min, spacing) {
    // Band index = number of regular contour levels the tide has risen
    // strictly above. At tide == level the new band takes effect, matching
    // the visible "crossing" moment of the contour.
    const crossed = Math.max(0,
      Math.floor((tide - min) / spacing + 1e-9));
    const idx = crossed;
    return SHOAL_BANDS[Math.min(idx, SHOAL_BANDS.length - 1)];
  }

  /* ---------------- marching squares ---------------- */

  /* Grid coordinates: x = column i (0..n-1), y = row j (0..n-1).
   * Edge ids encode an interpolated lattice point so every adjacent
   * cell shares the exact same endpoint -> topologically closed chains. */
  /* Canonical id of a lattice edge so neighboring cells resolve to the
   * same id: horizontal edges run (i,j)->(i+1,j), vertical edges
   * (i,j)->(i,j+1). edge: 0=bottom 1=right 2=top 3=left. */
  function edgeId(edge, cellI, cellJ) {
    const OFF = 100000;
    let i;
    let j;
    let type;
    if (edge === 0) {
      i = cellI; j = cellJ; type = 0;          // bottom horizontal (i, j)
    } else if (edge === 2) {
      i = cellI; j = cellJ + 1; type = 0;      // top horizontal (i, j+1)
    } else if (edge === 1) {
      i = cellI + 1; j = cellJ; type = 1;
    } else {
      i = cellI; j = cellJ; type = 1;
    }
    // unique 53-bit-safe integer for (type, i, j)
    return ((j + OFF) * 200000 + (i + OFF)) * 2 + type + 1;
  }

  function pointOnEdge(edge, i, j, level, n, grid) {
    const g = (x, y) => grid[y * n + x];
    const t = (lo, hi) => (level - lo) / (hi - lo);
    switch (edge) {
      case 0: { // bottom: (i,j) -> (i+1,j)
        return { x: i + t(g(i, j), g(i + 1, j)), y: j };
      }
      case 1: { // right: (i+1,j) -> (i+1,j+1)
        return { x: i + 1, y: j + t(g(i + 1, j), g(i + 1, j + 1)) };
      }
      case 2: { // top: (i,j+1) -> (i+1,j+1)
        return { x: i + t(g(i, j + 1), g(i + 1, j + 1)), y: j + 1 };
      }
      default: { // left: (i,j) -> (i,j+1)
        return { x: i, y: j + t(g(i, j), g(i, j + 1)) };
      }
    }
  }

  function cellSegments(code) {
    // 1=bottom 2=right 4=top 8=left; saddle cases split consistently
    switch (code) {
      case 1: case 14: return [[0, 3]];
      case 2: case 13: return [[0, 1]];
      case 3: case 12: return [[1, 3]];
      case 4: case 11: return [[1, 2]];
      case 6: case 9: return [[0, 2]];
      case 7: case 8: return [[2, 3]];
      case 5: return [[0, 3], [1, 2]];
      case 10: return [[0, 1], [2, 3]];
      default: return [];
    }
  }

  function chainSegments(raw, pointOf, borderEdges) {
    /* Undirected graph whose nodes are canonical edge ids (shared lattice
     * points). Each marching-squares segment joins two nodes. Nodes have
     * degree 2 (ordinary crossing) or 4 (saddle junction). We stitch edges
     * into maximal polylines by deterministic pairing: at every node the
     * incoming edge is connected to the smallest unused outgoing edge id.
     * Because pairing is purely id-based, strands can only terminate on a
     * domain-border node (degree 1) or by closing a loop. No interior open
     * end can ever be produced, so contours never fracture. */
    const adj = new Map(); // edgeId -> [{node, seg}]
    const addAdj = (a, b, segIdx) => {
      if (!adj.has(a)) adj.set(a, []);
      adj.get(a).push({ node: b, seg: segIdx });
      if (!adj.has(b)) adj.set(b, []);
      adj.get(b).push({ node: a, seg: segIdx });
    };
    raw.forEach((seg, k) => addAdj(seg[0], seg[1], k));

    // deterministic ordering at every node makes the result reproducible
    for (const list of adj.values()) {
      list.sort((a, b) => a.node - b.node);
    }

    const usedSeg = new Uint8Array(raw.length);
    const polylines = [];

    const buildFrom = (startNode, startLink) => {
      const pts = [pointOf.get(startNode)];
      let prevNode = startNode;
      let link = startLink;
      let guard = 0;
      while (link && guard++ < raw.length + 2) {
        usedSeg[link.seg] = 1;
        pts.push(pointOf.get(link.node));
        prevNode = link.node;
        if (borderEdges.has(prevNode)) break;
        const peers = adj.get(prevNode);
        const next = peers.find((l) => !usedSeg[l.seg]);
        if (!next) break;
        link = next;
      }
      return pts;
    };

    // 1) open strands: start at every border node
    for (const [node, links] of adj) {
      if (!borderEdges.has(node)) continue;
      for (const link of links) {
        if (usedSeg[link.seg]) continue;
        polylines.push(buildFrom(node, link));
      }
    }

    // 2) remaining segments form closed interior loops
    for (let k = 0; k < raw.length; k++) {
      if (usedSeg[k]) continue;
      const startNode = raw[k][0];
      const startLink = adj.get(startNode).find((l) => l.seg === k);
      const pts = buildFrom(startNode, startLink);
      // buildFrom ends on the start node (same edge id -> same point
      // object); only append an explicit closure if it did not.
      const last = pts[pts.length - 1];
      if (last !== pts[0]) pts.push(pts[0]);
      polylines.push(pts);
    }

    return polylines;
  }

  /* All contour polylines for one level. Points are grid units. */
  function extractContour(grid, n, level) {
    const raw = [];
    const pointOf = new Map();
    const borderEdges = new Set();
    const getPoint = (edge, i, j, isBorder) => {
      const id = edgeId(edge, i, j);
      if (!pointOf.has(id)) {
        pointOf.set(id, pointOnEdge(edge, i, j, level, n, grid));
        if (isBorder) {
          borderEdges.add(id);
        }
      }
      return id;
    };
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const v00 = grid[j * n + i];
        const v10 = grid[j * n + i + 1];
        const v11 = grid[(j + 1) * n + i + 1];
        const v01 = grid[(j + 1) * n + i];
        let code = 0;
        if (v00 > level) code |= 1;
        if (v10 > level) code |= 2;
        if (v11 > level) code |= 4;
        if (v01 > level) code |= 8;
        if (code === 0 || code === 15) continue;
        for (const pair of cellSegments(code)) {
          raw.push([
            getPoint(pair[0], i, j,
              (pair[0] === 0 && j === 0) ||
              (pair[0] === 1 && i === n - 2) ||
              (pair[0] === 2 && j === n - 2) ||
              (pair[0] === 3 && i === 0)),
            getPoint(pair[1], i, j,
              (pair[1] === 0 && j === 0) ||
              (pair[1] === 1 && i === n - 2) ||
              (pair[1] === 2 && j === n - 2) ||
              (pair[1] === 3 && i === 0))
          ]);
        }
      }
    }
    return {
      level,
      polylines: chainSegments(raw, pointOf, borderEdges),
      segmentCount: raw.length
    };
  }

  function extractContours(grid, n, levels) {
    return levels.map((level) => extractContour(grid, n, level));
  }

  /* Structural integrity:
   * 1) every marching-squares segment is consumed exactly once;
   * 2) no zero-length or duplicate segments;
   * 3) every open contour ends on the domain border (an interior open end
   *    would be a fracture), while closed loops return to their start. */
  function verifyContours(contours, n) {
    for (const c of contours) {
      const seen = new Set();
      let consumed = 0;
      for (const pts of c.polylines) {
        if (pts.length < 2) return { ok: false, reason: 'polyline < 2 points' };
        for (let k = 1; k < pts.length; k++) {
          const a = pts[k - 1];
          const b = pts[k];
          if (a.x === b.x && a.y === b.y) {
            return { ok: false, reason: 'zero-length segment' };
          }
          const key = a.x + ',' + a.y + '>' + b.x + ',' + b.y;
          if (seen.has(key)) return { ok: false, reason: 'duplicate segment' };
          seen.add(key);
        }
        consumed += pts.length - 1;
        const onBorder = (p) =>
          Math.abs(p.x) < 1e-9 || Math.abs(p.x - (n - 1)) < 1e-9 ||
          Math.abs(p.y) < 1e-9 || Math.abs(p.y - (n - 1)) < 1e-9;
        const closed = pts[0] === pts[pts.length - 1] ||
          (pts[0].x === pts[pts.length - 1].x && pts[0].y === pts[pts.length - 1].y);
        if (!closed && !(onBorder(pts[0]) && onBorder(pts[pts.length - 1]))) {
          return { ok: false, reason: 'interior open end: contour is broken' };
        }
      }
      if (consumed !== c.segmentCount) {
        return { ok: false, reason: 'segment loss ' + consumed + '/' + c.segmentCount };
      }
      if (seen.size !== c.segmentCount) {
        return { ok: false, reason: 'segment count mismatch' };
      }
    }
    return { ok: true };
  }

  return {
    mulberry32,
    hash2,
    valueNoise,
    fbm,
    heightAt,
    createHeightField,
    gridStats,
    contourLevels,
    rampColor,
    TERRAIN_RAMP,
    SHOAL_BANDS,
    shoalBand,
    edgeId,
    pointOnEdge,
    cellSegments,
    extractContour,
    extractContours,
    verifyContours
  };
});
