// Procedural undulating terrain: deterministic value-noise fBm sampled on a
// regular triangle grid. No external assets or model loading.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Terrain = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function fract(x) {
    return x - Math.floor(x);
  }

  function hash2(ix, iy, seed) {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function smoothstep(t) {
    return t * t * (3 - 2 * t);
  }

  // Smooth deterministic value noise in [0, 1].
  function valueNoise(x, y, seed) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = smoothstep(x - ix);
    const fy = smoothstep(y - iy);
    const a = hash2(ix, iy, seed);
    const b = hash2(ix + 1, iy, seed);
    const c = hash2(ix, iy + 1, seed);
    const d = hash2(ix + 1, iy + 1, seed);
    const ab = a + (b - a) * fx;
    const cd = c + (d - c) * fx;
    return ab + (cd - ab) * fy;
  }

  // Fractal Brownian motion: layered value noise, output roughly in [0, 1].
  function fbm(x, y, seed) {
    let sum = 0;
    let amplitude = 0.5;
    let frequency = 1;
    let norm = 0;
    for (let octave = 0; octave < 5; octave++) {
      sum += amplitude * valueNoise(x * frequency, y * frequency, seed + octave * 101);
      norm += amplitude;
      amplitude *= 0.5;
      frequency *= 2.05;
    }
    return sum / norm;
  }

  // Height field over the unit square [0,1]x[0,1], normalized so amplitude
  // scales the actual min..max span. hmin/hmax are computed from the grid.
  function createTerrain(options) {
    const opts = options || {};
    const resolution = opts.resolution || 48;
    const seed = opts.seed || 20261114;
    const amplitude = opts.amplitude == null ? 1 : opts.amplitude;

    const n = resolution;
    const vertices = new Array((n + 1) * (n + 1));

    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const x = i / n;
        const z = j / n;
        // A few broad waves plus detail noise give readable hills and valleys.
        const waves =
          0.55 * Math.sin(2.4 * Math.PI * x + 0.7) * Math.cos(2.1 * Math.PI * z) +
          0.3 * Math.sin(5.0 * Math.PI * z + 1.3) +
          0.25 * Math.cos(4.2 * Math.PI * (x + z));
        const noise = fbm(x * 3.2 + 4.1, z * 3.2 - 1.7, seed) * 2 - 1;
        vertices[j * (n + 1) + i] = {
          index: j * (n + 1) + i,
          x: x - 0.5,
          y: 0,
          z: z - 0.5,
          h: waves * 0.65 + noise * 0.35,
        };
      }
    }

    let hmin = Infinity;
    let hmax = -Infinity;
    for (const v of vertices) {
      if (v.h < hmin) hmin = v.h;
      if (v.h > hmax) hmax = v.h;
    }
    const center = (hmin + hmax) / 2;
    const span = hmax - hmin || 1;
    for (const v of vertices) {
      v.h = ((v.h - center) / span) * amplitude;
    }
    hmin = -amplitude / 2;
    hmax = amplitude / 2;

    // Two triangles per grid cell. Keep cell/triangle references so the
    // contour extraction can map segments back to their source triangle.
    const triangles = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i;
        const b = a + 1;
        const c = a + (n + 1);
        const d = c + 1;
        triangles.push({ id: triangles.length, cell: i + j * n, v: [a, b, c] });
        triangles.push({ id: triangles.length, cell: i + j * n, v: [b, d, c] });
      }
    }

    return {
      resolution: n,
      seed,
      amplitude,
      vertices,
      triangles,
      hmin,
      hmax,
      // (i,j) grid lookup shared by renderer and picker.
      vertexAt: function (i, j) {
        return vertices[j * (n + 1) + i];
      },
    };
  }

  return { createTerrain, fbm, valueNoise };
});
