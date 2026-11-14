export const MATERIALS = [
  {
    id: "concrete",
    code: "CON",
    name: "混凝土",
    en: "CONCRETE",
    color: "#d7bf8d",
    lowHz: 74,
    grainHz: 2050,
    body: 0.11,
    ring: 0.05,
    texture: 0.72,
    echoBias: 0.28,
    damp: 0.54,
    note: "密实、短促，低频撞击清晰",
  },
  {
    id: "carpet",
    code: "CPT",
    name: "旧地毯",
    en: "CARPET",
    color: "#b98672",
    lowHz: 96,
    grainHz: 580,
    body: 0.19,
    ring: 0.015,
    texture: 0.28,
    echoBias: -0.2,
    damp: 0.93,
    note: "纤维吸声，高频几乎被吃掉",
  },
  {
    id: "tile",
    code: "TIL",
    name: "釉面砖",
    en: "GLAZED TILE",
    color: "#7fb9b0",
    lowHz: 118,
    grainHz: 3400,
    body: 0.065,
    ring: 0.24,
    texture: 0.62,
    echoBias: 0.52,
    damp: 0.36,
    note: "脆响突出，墙面反射锋利",
  },
  {
    id: "wood",
    code: "WOD",
    name: "旧木地板",
    en: "AGED WOOD",
    color: "#c88c58",
    lowHz: 146,
    grainHz: 1380,
    body: 0.17,
    ring: 0.11,
    texture: 0.44,
    echoBias: 0.08,
    damp: 0.68,
    note: "中低频有木板空腔共振",
  },
  {
    id: "gravel",
    code: "GRV",
    name: "碎石",
    en: "GRAVEL",
    color: "#9ba7aa",
    lowHz: 108,
    grainHz: 920,
    body: 0.14,
    ring: 0.025,
    texture: 0.94,
    echoBias: -0.05,
    damp: 0.78,
    note: "颗粒噪声密集，尾音散乱",
  },
  {
    id: "steel",
    code: "STL",
    name: "金属格栅",
    en: "STEEL GRATE",
    color: "#a8a0dc",
    lowHz: 164,
    grainHz: 4200,
    body: 0.1,
    ring: 0.58,
    texture: 0.66,
    echoBias: 0.64,
    damp: 0.31,
    note: "高频泛音长，网格二次振动",
  },
];

export const MATERIAL_BY_ID = Object.fromEntries(
  MATERIALS.map((material) => [material.id, material]),
);

export const CLUE_WEIGHTS = Object.freeze({
  echo: 0.55,
  pan: 0.25,
  low: 0.2,
});

const EVENT_LABELS = ["A", "B", "C", "D", "E", "F"];
const ECHO_MIN = 180;
const ECHO_MAX = 880;
const MIN_SCORE_GAP = 0.012;

export function normalizeSeed(input) {
  const text = String(input ?? "").trim().toUpperCase().replace(/^B1-?/, "");
  if (/^\d+$/.test(text)) return text.replace(/^0+(?=\d)/, "").slice(0, 10);
  const hash = fnv1a(text || "B1-000000");
  return String(hash).padStart(10, "0").slice(-6);
}

export function seedToUint(seed) {
  return fnv1a(`ECHO:${normalizeSeed(seed)}`);
}

export function mulberry32(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRng(seed, stream = "round") {
  return mulberry32(seedToUint(`${normalizeSeed(seed)}:${stream}`));
}

export function gaitWaveform(material, seed, length = 76) {
  const random = createRng(seed, `wave:${material.id}`);
  const wave = [];
  for (let index = 0; index < length; index += 1) {
    const t = index / (length - 1);
    const attack = Math.min(1, t / 0.055);
    const decay = Math.exp(-t * (10.5 - material.body * 14));
    const thump = Math.sin(t * Math.PI * (8 + material.lowHz / 16)) * 0.52;
    const ring = Math.sin(t * Math.PI * (28 + material.ring * 52)) * material.ring;
    const grains = (random() * 2 - 1) * material.texture * 0.45;
    const scatter = Math.sin(t * 46 + random() * 0.7) * material.texture * 0.18;
    wave.push(clamp((thump + ring + grains + scatter) * attack * decay, -1, 1));
  }
  return wave;
}

export function acousticScore(event) {
  const echoNorm = clamp((event.echoMs - ECHO_MIN) / (ECHO_MAX - ECHO_MIN), 0, 1);
  const panNorm = (event.pan + 1) / 2;
  const lowNorm = event.lowFreq / 100;
  return round(
    CLUE_WEIGHTS.echo * echoNorm +
      CLUE_WEIGHTS.pan * panNorm +
      CLUE_WEIGHTS.low * lowNorm,
    5,
  );
}

export function generateRound(inputSeed = "481516") {
  const seed = normalizeSeed(inputSeed);
  const random = createRng(seed, "layout");
  const shuffledMaterials = shuffle(MATERIALS, random);
  const events = shuffledMaterials.map((material, index) => {
    const echoMs = Math.round(
      ECHO_MIN +
        120 +
        (random() * 0.52 + material.echoBias * 0.36) * (ECHO_MAX - ECHO_MIN - 240),
    );
    const pan = round(clamp((random() * 2 - 1) * 0.88, -0.9, 0.9), 2);
    const lowFreq = Math.round(
      clamp(34 + material.lowHz * 0.3 + (random() - 0.5) * 23, 28, 94),
    );
    const wallDistance = round(
      1.4 + ((echoMs - ECHO_MIN) / (ECHO_MAX - ECHO_MIN)) * 7.2,
      2,
    );
    const event = {
      id: `EV-${String(index + 1).padStart(2, "0")}`,
      label: EVENT_LABELS[index],
      materialId: material.id,
      echoMs,
      pan,
      lowFreq,
      wallDistance,
      textureSeed: seedToUint(`${seed}:sample:${material.id}:${index}`),
    };
    return {
      ...event,
      score: acousticScore(event),
      wave: gaitWaveform(material, `${seed}:${index}`),
    };
  });
  ensureUniqueScores(events);

  const ranked = [...events].sort((left, right) => {
    return left.score - right.score || left.id.localeCompare(right.id);
  });
  ranked.forEach((event, slot) => {
    event.targetSlot = slot;
  });

  return {
    seed,
    events,
    targetOrder: ranked.map((event) => event.id),
    doorOpen: false,
  };
}

function ensureUniqueScores(events) {
  const used = [];
  for (const event of events) {
    let attempt = 0;
    while (
      used.some((score) => Math.abs(score - event.score) < MIN_SCORE_GAP) &&
      attempt < 160
    ) {
      const step = Math.ceil((attempt + 1) / 2) * (attempt % 2 === 0 ? 1 : -1);
      event.lowFreq = Math.round(clamp(event.lowFreq + step, 24, 98));
      event.score = acousticScore(event);
      attempt += 1;
    }
    used.push(event.score);
  }
}

export function evaluateTimeline(round, placement) {
  const mismatches = round.events.filter((event) => {
    return placement.get(event.id) !== event.targetSlot;
  });
  return {
    mismatches: mismatches.length,
    passed: mismatches.length < 2,
    mismatchIds: mismatches.map((event) => event.id),
  };
}

export function formatPan(pan) {
  if (Math.abs(pan) < 0.015) return "C 00";
  return `${pan < 0 ? "L" : "R"} ${String(Math.round(Math.abs(pan) * 100)).padStart(2, "0")}`;
}

export function normalizeComponent(event) {
  return {
    echo: round(clamp((event.echoMs - ECHO_MIN) / (ECHO_MAX - ECHO_MIN), 0, 1), 3),
    pan: round((event.pan + 1) / 2, 3),
    low: round(event.lowFreq / 100, 3),
  };
}

function shuffle(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, places = 2) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}
