export const GRID_SIZE = 33;
export const MAX_ELEVATION_M = 60;
export const BASE_LEVEL = -0.08;
export const PROFILE_SAMPLES = 97;

export const LAYER_BOUNDS = [0.72, 0.48, 0.24, -0.06];

const PRESET_META = {
  canyon: {
    id: "canyon",
    name: "风蚀峡谷",
    short: "沟谷",
    code: "CANYON / 04",
    seed: 4217,
    water: 0.35,
    cut: 0.68,
    palette: ["#a3956e", "#ca8a5c", "#7d675b", "#3f4d4a"],
    layers: ["坡积层", "暖色砂岩", "页岩", "基岩"],
  },
  mesa: {
    id: "mesa",
    name: "层岩台地",
    short: "台地",
    code: "MESA / 09",
    seed: 9183,
    water: 0.292,
    cut: 0.62,
    palette: ["#b1a071", "#d0a365", "#8d6e59", "#4a5650"],
    layers: ["钙结层", "赭石砂岩", "泥岩", "灰岩"],
  },
  fault: {
    id: "fault",
    name: "断层崖",
    short: "断口",
    code: "RIFT / 17",
    seed: 6729,
    water: 0.40,
    cut: 0.58,
    palette: ["#a39a79", "#b87858", "#746d64", "#394846"],
    layers: ["风积层", "断块砂岩", "砾岩", "片麻岩"],
  },
};

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function hash2(x, y, seed) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 69069);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function valueNoise(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = x - xi;
  const ty = y - yi;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
}

function fbm(x, y, seed, octaves = 4) {
  let value = 0;
  let amplitude = 0.55;
  let frequency = 1;
  let total = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    value += valueNoise(x * frequency, y * frequency, seed + octave * 17) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return value / total;
}

function canyonHeight(x, y, seed) {
  const broad = fbm(x * 2.8 + 0.7, y * 2.4 + 1.1, seed, 5);
  const meander = 0.5 + Math.sin(y * 4.8 + 0.55) * 0.145 + Math.sin(y * 10.6) * 0.025;
  const channel = Math.abs(x - meander);
  const gorge = Math.exp(-Math.pow(channel / 0.075, 2));
  const tributaryY = 0.38 + Math.sin(x * 12.2 + 0.3) * 0.055;
  const tributary = Math.exp(-Math.pow((y - tributaryY) / 0.035, 2)) * Math.exp(-Math.pow((x - 0.33) / 0.2, 2));
  const shoulder = smoothstep(0.08, 0.42, channel) * 0.1;
  const ridge = Math.exp(-Math.pow((x - 0.82) / 0.2, 2)) * 0.09;
  const h = 0.39 + broad * 0.26 + shoulder + ridge - gorge * 0.26 - tributary * 0.13;
  return clamp(h, 0.08, 0.88);
}

function terraceHeight(x, y, seed) {
  const broad = fbm(x * 2.35 + 2.8, y * 2.2 + 0.6, seed, 4);
  const dx = x - 0.54;
  const dy = y - 0.47;
  const dome = Math.exp(-(dx * dx * 2.6 + dy * dy * 2.1) / 0.3);
  const shelf = Math.exp(-Math.pow((y - 0.72 + x * 0.12) / 0.095, 2)) * 0.07;
  let raw = 0.18 + broad * 0.23 + dome * 0.4 + shelf;
  const step = ((raw - 0.13) / 0.68) * 5;
  const baseStep = Math.floor(step);
  const fraction = step - baseStep;
  const terrace = (baseStep + smoothstep(0.76, 1, fraction)) * 0.136 + 0.13;
  return clamp(raw * 0.18 + terrace * 0.82, 0.08, 0.9);
}

function faultHeight(x, y, seed) {
  const broad = fbm(x * 2.65 + 1.4, y * 2.3 + 3.2, seed, 5);
  const ridgeA = Math.exp(-Math.pow((x - 0.38) / 0.27, 2)) * 0.28;
  const ridgeB = Math.exp(-Math.pow((x - 0.7) / 0.2, 2)) * 0.2;
  const gullyY = 0.55 + Math.sin(x * 8.2) * 0.08;
  const gully = Math.exp(-Math.pow((y - gullyY) / 0.045, 2)) * Math.exp(-Math.pow((x - 0.54) / 0.26, 2));
  const raw = 0.24 + broad * 0.23 + ridgeA + ridgeB - gully * 0.12;
  const faultOffset = x < 0.36 + y * 0.18 ? 0.105 : -0.035;
  return clamp(raw + faultOffset, 0.08, 0.9);
}

export function createLayers(presetId) {
  const meta = PRESET_META[presetId] ?? PRESET_META.canyon;
  const names = meta.layers;
  return names.map((name, index) => ({
    id: `layer-${index}`,
    name,
    color: meta.palette[index],
    from: index === 0 ? 1 : LAYER_BOUNDS[index - 1],
    to: LAYER_BOUNDS[index],
  }));
}

export function createTerrain(presetId = "canyon") {
  const meta = PRESET_META[presetId] ?? PRESET_META.canyon;
  const heights = new Float32Array(GRID_SIZE * GRID_SIZE);
  const generators = { canyon: canyonHeight, mesa: terraceHeight, fault: faultHeight };
  const generator = generators[meta.id];
  for (let row = 0; row < GRID_SIZE; row += 1) {
    for (let col = 0; col < GRID_SIZE; col += 1) {
      const x = col / (GRID_SIZE - 1);
      const y = row / (GRID_SIZE - 1);
      heights[row * GRID_SIZE + col] = generator(x, y, meta.seed);
    }
  }
  return {
    presetId: meta.id,
    seed: meta.seed,
    heights,
    layers: createLayers(meta.id),
    waterLevel: meta.water,
    cutPosition: meta.cut,
    faults: meta.id === "fault"
      ? [{ start: [0.35, 0.02], end: [0.56, 0.98], throw: 0.105 }]
      : [],
  };
}

export function sampleHeight(terrain, x, y) {
  const gx = clamp(x) * (GRID_SIZE - 1);
  const gy = clamp(y) * (GRID_SIZE - 1);
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(GRID_SIZE - 1, x0 + 1);
  const y1 = Math.min(GRID_SIZE - 1, y0 + 1);
  const tx = gx - x0;
  const ty = gy - y0;
  const a = terrain.heights[y0 * GRID_SIZE + x0];
  const b = terrain.heights[y0 * GRID_SIZE + x1];
  const c = terrain.heights[y1 * GRID_SIZE + x0];
  const d = terrain.heights[y1 * GRID_SIZE + x1];
  return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
}

export function sampleHeightAtRow(terrain, row, x) {
  const gx = clamp(x) * (GRID_SIZE - 1);
  const x0 = Math.floor(gx);
  const x1 = Math.min(GRID_SIZE - 1, x0 + 1);
  const t = gx - x0;
  const a = terrain.heights[row * GRID_SIZE + x0];
  const b = terrain.heights[row * GRID_SIZE + x1];
  return a + (b - a) * t;
}

export function heightMeters(height) {
  return height * MAX_ELEVATION_M;
}

export function lineIntersectionX(start, end, y) {
  const dy = end[1] - start[1];
  if (Math.abs(dy) < 0.00001) return null;
  const t = (y - start[1]) / dy;
  if (t < 0 || t > 1) return null;
  return start[0] + (end[0] - start[0]) * t;
}

export function faultCrossings(terrain, y = terrain.cutPosition) {
  return terrain.faults
    .map((fault, index) => {
      const x = lineIntersectionX(fault.start, fault.end, y);
      return x === null ? null : { ...fault, index, x };
    })
    .filter(Boolean);
}

export function buildSection(terrain, cutPosition = terrain.cutPosition, samples = PROFILE_SAMPLES) {
  const points = [];
  const gx = clamp(cutPosition) * (GRID_SIZE - 1);
  const row0 = Math.floor(gx);
  const row1 = Math.min(GRID_SIZE - 1, row0 + 1);
  const rowT = gx - row0;
  const crossings = faultCrossings(terrain, cutPosition);

  for (let index = 0; index < samples; index += 1) {
    const x = index / (samples - 1);
    const h0 = sampleHeightAtRow(terrain, row0, x);
    const h1 = sampleHeightAtRow(terrain, row1, x);
    const top = h0 + (h1 - h0) * rowT;
    let throwValue = 0;
    for (const fault of crossings) {
      if (x >= fault.x) throwValue += fault.throw;
    }
    points.push({ x, top, throwValue });
  }

  return {
    cutPosition,
    samples,
    points,
    crossings,
    layers: terrain.layers,
    waterLevel: terrain.waterLevel,
    minTop: Math.min(...points.map((point) => point.top)),
    maxTop: Math.max(...points.map((point) => point.top)),
  };
}

export function cloneTerrain(terrain) {
  return {
    ...terrain,
    heights: new Float32Array(terrain.heights),
    layers: terrain.layers.map((layer) => ({ ...layer })),
    faults: terrain.faults.map((fault) => ({
      ...fault,
      start: [...fault.start],
      end: [...fault.end],
    })),
  };
}

export function createHistory(terrain) {
  return [cloneTerrain(terrain)];
}

export function pushHistory(history, terrain, limit = 24) {
  history.push(cloneTerrain(terrain));
  if (history.length > limit) history.shift();
  return history;
}

export function applyBrush(terrain, x, y, radius, tool = "raise", strength = 0.032) {
  const centerX = clamp(x) * (GRID_SIZE - 1);
  const centerY = clamp(y) * (GRID_SIZE - 1);
  const gridRadius = Math.max(1, radius * (GRID_SIZE - 1));
  const minCol = Math.max(0, Math.floor(centerX - gridRadius));
  const maxCol = Math.min(GRID_SIZE - 1, Math.ceil(centerX + gridRadius));
  const minRow = Math.max(0, Math.floor(centerY - gridRadius));
  const maxRow = Math.min(GRID_SIZE - 1, Math.ceil(centerY + gridRadius));
  const centerHeight = sampleHeight(terrain, x, y);
  const snapshot = new Float32Array(terrain.heights);
  let changed = false;

  for (let row = minRow; row <= maxRow; row += 1) {
    for (let col = minCol; col <= maxCol; col += 1) {
      const dx = col - centerX;
      const dy = row - centerY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > gridRadius) continue;
      const index = row * GRID_SIZE + col;
      const falloff = Math.pow(1 - distance / gridRadius, 1.7);

      if (tool === "raise") {
        terrain.heights[index] = clamp(terrain.heights[index] + strength * falloff, 0.03, 0.94);
      } else if (tool === "lower") {
        terrain.heights[index] = clamp(terrain.heights[index] - strength * falloff, 0.03, 0.94);
      } else if (tool === "carve") {
        const target = clamp(centerHeight - 0.004, 0.03, 0.94);
        const next = terrain.heights[index] > target
          ? terrain.heights[index] + (target - terrain.heights[index]) * (0.48 + falloff * 0.5)
          : terrain.heights[index];
        terrain.heights[index] = clamp(next, 0.03, 0.94);
      } else if (tool === "smooth") {
        let sum = 0;
        let count = 0;
        for (let oy = -1; oy <= 1; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            const rr = row + oy;
            const cc = col + ox;
            if (rr < 0 || rr >= GRID_SIZE || cc < 0 || cc >= GRID_SIZE) continue;
            sum += snapshot[rr * GRID_SIZE + cc];
            count += 1;
          }
        }
        terrain.heights[index] = snapshot[index] + ((sum / count) - snapshot[index]) * 0.34 * falloff;
      }

      if (terrain.heights[index] !== snapshot[index]) changed = true;
    }
  }
  return changed;
}

export function terrainBounds(terrain) {
  let min = Infinity;
  let max = -Infinity;
  for (const height of terrain.heights) {
    if (height < min) min = height;
    if (height > max) max = height;
  }
  return {
    min,
    max,
    minMeters: Math.round(heightMeters(min)),
    maxMeters: Math.round(heightMeters(max)),
  };
}

export function validateSection(terrain, cutPosition = terrain.cutPosition) {
  const section = buildSection(terrain, cutPosition);
  let finite = true;
  let maxError = 0;
  for (const point of section.points) {
    if (!Number.isFinite(point.top) || point.top < 0 || point.top > 1) finite = false;
    const direct = sampleHeight(terrain, point.x, cutPosition);
    maxError = Math.max(maxError, Math.abs(direct - point.top));
  }
  const expectedSamples = PROFILE_SAMPLES;
  return {
    valid: finite && section.points.length === expectedSamples && maxError < 0.000001,
    finite,
    maxError,
    samples: section.points.length,
    minTop: section.minTop,
    maxTop: section.maxTop,
  };
}
