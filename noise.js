// Core procedural generation: seeded value-noise fBm heightmap,
// normal map encoding, and Lambert+specular shading.
// Pure functions shared by the browser page and the Node test.

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.BumpCore = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Deterministic PRNG so the same seed always yields the same field.
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

  // Value noise over a 256x256 lattice built from the seeded PRNG.
  function makeValueNoise(seed) {
    const rand = mulberry32(seed);
    const SIZE = 256;
    const lattice = new Float32Array(SIZE * SIZE);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rand();

    function smooth(t) {
      return t * t * (3 - 2 * t);
    }

    return function noise2(x, y) {
      const xi = Math.floor(x);
      const yi = Math.floor(y);
      const xf = x - xi;
      const yf = y - yi;
      const x0 = ((xi % SIZE) + SIZE) % SIZE;
      const y0 = ((yi % SIZE) + SIZE) % SIZE;
      const x1 = (x0 + 1) % SIZE;
      const y1 = (y0 + 1) % SIZE;
      const v00 = lattice[y0 * SIZE + x0];
      const v10 = lattice[y0 * SIZE + x1];
      const v01 = lattice[y1 * SIZE + x0];
      const v11 = lattice[y1 * SIZE + x1];
      const u = smooth(xf);
      const v = smooth(yf);
      const top = v00 + (v10 - v00) * u;
      const bottom = v01 + (v11 - v01) * u;
      return top + (bottom - top) * v;
    };
  }

  // fBm heightmap. Octaves reuse the SAME seeded lattice, so adding
  // detail layers only appends higher frequencies: lower layers and
  // the overall shape stay identical for a fixed seed.
  function generateHeightmap(size, octaves, seed) {
    const noise2 = makeValueNoise(seed);
    const height = new Float32Array(size * size);
    const baseFreq = 4 / size; // 4 lattice cells across the map
    const persistence = 0.5;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let sum = 0;
        let amp = 1;
        let freq = baseFreq;
        let norm = 0;
        for (let o = 0; o < octaves; o++) {
          sum += noise2(x * freq, y * freq) * amp;
          norm += amp;
          amp *= persistence;
          freq *= 2;
        }
        height[y * size + x] = sum / norm;
      }
    }
    return height;
  }

  // Surface normal from heightfield via central differences.
  // Coordinates clamp at borders (the field is not tileable, so
  // wrapping would paint a colored seam along the edges).
  function normalAt(height, size, x, y, bumpScale) {
    const xm = Math.max(0, x - 1);
    const xp = Math.min(size - 1, x + 1);
    const ym = Math.max(0, y - 1);
    const yp = Math.min(size - 1, y + 1);
    const dx = (height[y * size + xp] - height[y * size + xm]) * bumpScale;
    const dy = (height[yp * size + x] - height[ym * size + x]) * bumpScale;
    const invLen = 1 / Math.sqrt(dx * dx + dy * dy + 1);
    return [-dx * invLen, -dy * invLen, invLen];
  }

  // RGB normal map: n in [-1,1] encoded to [0,255].
  function heightToNormalMap(height, size, bumpScale) {
    const out = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = normalAt(height, size, x, y, bumpScale);
        const i = (y * size + x) * 4;
        out[i] = (n[0] * 0.5 + 0.5) * 255;
        out[i + 1] = (n[1] * 0.5 + 0.5) * 255;
        out[i + 2] = (n[2] * 0.5 + 0.5) * 255;
        out[i + 3] = 255;
      }
    }
    return out;
  }

  // Grayscale view of the heightfield itself.
  function heightToGray(height, size) {
    const out = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      const g = height[i] * 255;
      const j = i * 4;
      out[j] = g;
      out[j + 1] = g;
      out[j + 2] = g;
      out[j + 3] = 255;
    }
    return out;
  }

  // Lighting preview: Lambert diffuse + Blinn specular.
  // light = {x, y, z} unit vector pointing TOWARD the light.
  function renderShading(height, size, bumpScale, light, intensity) {
    const out = new Uint8ClampedArray(size * size * 4);
    const ambient = 0.08;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = normalAt(height, size, x, y, bumpScale);
        const diff = Math.max(
          0,
          n[0] * light.x + n[1] * light.y + n[2] * light.z
        );
        // Blinn half-vector with view = (0,0,1)
        const hx = light.x;
        const hy = light.y;
        const hz = light.z + 1;
        const hl = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1;
        const ndh = Math.max(0, (n[0] * hx + n[1] * hy + n[2] * hz) / hl);
        const spec = Math.pow(ndh, 32) * 0.6;
        const lum = Math.min(1, ambient + intensity * (diff + spec));
        const g = lum * 255;
        const i = (y * size + x) * 4;
        out[i] = g;
        out[i + 1] = g;
        out[i + 2] = g;
        out[i + 3] = 255;
      }
    }
    return out;
  }

  return {
    mulberry32,
    makeValueNoise,
    generateHeightmap,
    normalAt,
    heightToNormalMap,
    heightToGray,
    renderShading,
  };
});
