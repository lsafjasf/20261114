const RAIN_SAMPLE = [
  0.2, 0.2, 0.3, 0.4, 0.7, 1.1, 1.8, 3.1, 5.2, 8.4, 12.2, 9.6,
  6.1, 3.8, 2.4, 1.6, 1.1, 0.9, 0.7, 0.8, 1.2, 2.6, 5.7, 11.8,
  19.4, 27.6, 21.2, 13.1, 7.4, 4.8, 3.2, 2.8, 6.6, 14.2, 9.8, 5.3,
  2.9, 1.7, 1.1, 0.8, 0.6, 0.5, 0.4, 0.35, 0.3, 0.25, 0.2, 0.15,
];

const WIND_SAMPLE = [
  208, 205, 203, 200, 198, 195, 192, 188, 185, 182, 178, 175,
  173, 170, 174, 180, 188, 197, 207, 218, 226, 232, 238, 244,
  250, 256, 262, 266, 270, 273, 276, 278, 282, 286, 290, 294,
  298, 302, 306, 310, 314, 318, 320, 324, 326, 330, 334, 338,
];

const THUNDER_EVENTS = [
  { hour: 4.42, strength: 0.72, label: "远端雷暴" },
  { hour: 5.08, strength: 0.88, label: "近场脉冲" },
  { hour: 11.66, strength: 1, label: "强对流脉冲" },
  { hour: 12.14, strength: 0.82, label: "二次脉冲" },
  { hour: 16.62, strength: 0.68, label: "锋面脉冲" },
];

const ANOMALIES = [
  {
    id: "storm-front",
    start: 3.5,
    end: 5.5,
    focus: 4.42,
    label: "锋前雷暴",
    detail: "短促雷暴脉冲 · 雨强快速抬升",
    peakRain: 8.4,
  },
  {
    id: "train-echo",
    start: 11,
    end: 13,
    focus: 12.4,
    label: "列车效应",
    detail: "持续强降雨 · 峰值 27.6 mm/h",
    peakRain: 27.6,
  },
  {
    id: "wind-shift",
    start: 15.5,
    end: 17,
    focus: 16.35,
    label: "风向突变",
    detail: "声像跨场 · 雨带快速东移",
    peakRain: 14.2,
  },
];

const TOTAL_HOURS = 24;
const SAMPLE_INTERVAL_HOURS = 0.5;
const REPLAY_SECONDS = 96;
const HOURS_PER_SECOND = TOTAL_HOURS / REPLAY_SECONDS;
const SPEEDS = [1, 1.5, 2, 4];
const TAU = Math.PI * 2;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (a, b, amount) => a + (b - a) * amount;
const invLerp = (a, b, value) => (value - a) / (b - a);
const easeInOut = (value) => (value < 0.5 ? 2 * value * value : 1 - (-2 * value + 2) ** 2 / 2);
const mod = (value, divisor) => ((value % divisor) + divisor) % divisor;

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function channel(value) {
  return Math.round(clamp(value, 0, 255));
}

function rgba(r, g, b, alpha = 1) {
  return `rgba(${channel(r)}, ${channel(g)}, ${channel(b)}, ${alpha})`;
}

function mixColor(from, to, amount) {
  return [
    lerp(from[0], to[0], amount),
    lerp(from[1], to[1], amount),
    lerp(from[2], to[2], amount),
  ];
}

function formatClock(hours) {
  const totalMinutes = Math.round(clamp(hours, 0, TOTAL_HOURS) * 60);
  if (totalMinutes >= TOTAL_HOURS * 60) return "24:00";
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function formatRange(start, end) {
  return `${formatClock(start)}–${formatClock(end)}`;
}

function sampleAt(hours) {
  const position = clamp(hours, 0, TOTAL_HOURS) / SAMPLE_INTERVAL_HOURS;
  const index = Math.min(RAIN_SAMPLE.length - 1, Math.floor(position));
  const nextIndex = Math.min(RAIN_SAMPLE.length - 1, index + 1);
  const amount = position - Math.floor(position);
  return {
    rain: lerp(RAIN_SAMPLE[index], RAIN_SAMPLE[nextIndex], amount),
    wind: lerp(WIND_SAMPLE[index], WIND_SAMPLE[nextIndex], amount),
  };
}

function thunderLevelAt(hours) {
  return THUNDER_EVENTS.reduce((level, event) => {
    const elapsed = hours - event.hour;
    if (elapsed < -0.004 || elapsed > 0.14) return level;
    const envelope = Math.exp(-Math.max(0, elapsed) * 23);
    const flicker = 0.72 + 0.28 * Math.sin(elapsed * 680 + event.strength * 11);
    return Math.max(level, envelope * flicker * event.strength);
  }, 0);
}

function findAnomalyAt(hours) {
  return ANOMALIES.find((anomaly) => hours >= anomaly.start && hours <= anomaly.end);
}

function deriveState(hours, playing, scrubbing) {
  const sample = sampleAt(hours);
  const rainNorm = clamp(sample.rain / 30, 0, 1);
  const pan = clamp(Math.sin((sample.wind * Math.PI) / 180), -1, 1);
  const cloudDensity = clamp(0.18 + rainNorm ** 0.58 * 0.82, 0, 1);
  const riverGlow = clamp(0.12 + rainNorm ** 0.72 * 0.9, 0, 1);
  const daylight = Math.max(0, Math.sin(((hours - 6) / 12) * Math.PI));
  const cityBrightness = clamp(0.2 + (1 - rainNorm) * 0.52 + (1 - daylight) * 0.18, 0, 1);
  const volume = clamp(0.025 + rainNorm ** 0.62 * 0.975, 0, 1);
  const thunder = playing && !scrubbing ? thunderLevelAt(hours) : 0;
  const anomaly = findAnomalyAt(hours);
  return {
    sample,
    rainNorm,
    pan,
    cloudDensity,
    riverGlow,
    cityBrightness,
    volume,
    thunder,
    anomaly,
    windDrift: Math.cos((sample.wind * Math.PI) / 180),
  };
}

function conditionFor(derived) {
  if (derived.thunder > 0.18) return "雷暴短脉冲掠过，低频与闪光同步。";
  if (derived.sample.rain >= 20) return "强降雨压低能见度，河道与声场同时增强。";
  if (derived.sample.rain >= 10) return "雨带稳定推进，城市照度下降，声像偏移。";
  if (derived.sample.rain >= 3) return "中雨穿过流域，云层持续堆积。";
  if (derived.anomaly) return "异常窗口内仍有弱回波，留意后续变化。";
  return "薄云下的稳定细雨，声场靠近中央。";
}

function rainLabel(rain) {
  if (rain >= 20) return "暴雨";
  if (rain >= 10) return "大雨";
  if (rain >= 3) return "中雨";
  if (rain >= 0.8) return "小雨";
  return "微量";
}

function compassName(degrees) {
  const names = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return names[Math.round(mod(degrees, 360) / 22.5) % 16];
}

function panLabel(pan) {
  const amount = Math.round(Math.abs(pan) * 100);
  if (amount < 4) return "C";
  return `${pan < 0 ? "L" : "R"} ${amount}`;
}

class TerrainRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.stars = Array.from({ length: 90 }, (_, index) => {
      const random = seededRandom(701 + index * 31);
      return {
        x: random(),
        y: random() * 0.4,
        size: 0.3 + random() * 1.4,
        alpha: 0.2 + random() * 0.7,
        phase: random() * TAU,
      };
    });
    this.drops = Array.from({ length: 330 }, (_, index) => {
      const random = seededRandom(903 + index * 47);
      return {
        x: random(),
        y: random(),
        length: 0.45 + random() * 0.9,
        speed: 0.45 + random() * 0.8,
        alpha: 0.2 + random() * 0.45,
      };
    });
    this.clouds = [0, 1, 2].map((layer) => {
      const random = seededRandom(1409 + layer * 53);
      return Array.from({ length: layer === 2 ? 6 : 8 }, (_, index) => ({
        x: random(),
        y: 0.075 + random() * (0.13 + layer * 0.06),
        width: 0.08 + random() * 0.16,
        height: 0.026 + random() * 0.045,
        alpha: 0.32 + random() * 0.55,
        phase: random() * TAU,
        index,
      }));
    });
    this.buildings = Array.from({ length: 17 }, (_, index) => {
      const random = seededRandom(2321 + index * 97);
      return {
        offset: index / 17,
        width: 0.018 + random() * 0.035,
        height: 0.032 + random() * 0.11,
        rows: 3 + Math.floor(random() * 5),
        columns: 2 + Math.floor(random() * 3),
        delay: random() * TAU,
      };
    });
    this.lightning = Array.from({ length: THUNDER_EVENTS.length }, (_, index) => {
      const random = seededRandom(3109 + index * 83);
      return Array.from({ length: 14 }, () => ({
        x: random(),
        y: random(),
      }));
    });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  resize() {
    const bounds = this.canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = bounds.width;
    this.height = bounds.height;
    this.canvas.width = Math.round(bounds.width * this.dpr);
    this.canvas.height = Math.round(bounds.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  draw(snapshot, time) {
    if (!this.width || !this.height) this.resize();
    const { width: w, height: h } = this;
    const d = snapshot.derived;
    const hours = snapshot.timeHours;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);
    this.drawSky(d, hours, time);
    this.drawStars(d, hours);
    this.drawMoon(d, hours);
    this.drawClouds(d, hours);
    this.drawRidges(d, hours);
    this.drawCity(d, hours);
    this.drawRiver(d, hours);
    this.drawContours(d, hours);
    this.drawRain(d, hours);
    this.drawLightning(d, hours);
    this.drawAtmosphere(d);
  }

  drawSky(d, hours, time) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const daylight = Math.max(0, Math.sin(((hours - 6) / 12) * Math.PI));
    const top = mixColor([3, 12, 12], [10, 30, 30], daylight * 0.44);
    const horizon = mixColor([9, 32, 29], [26, 61, 53], daylight * 0.5);
    const gradient = ctx.createLinearGradient(0, 0, 0, h * 0.7);
    gradient.addColorStop(0, rgba(top[0], top[1], top[2], 1));
    gradient.addColorStop(0.58, rgba(horizon[0], horizon[1], horizon[2], 1));
    gradient.addColorStop(1, rgba(4, 16, 15, 1));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    const glow = ctx.createRadialGradient(w * 0.63, h * 0.5, 0, w * 0.63, h * 0.5, w * 0.62);
    glow.addColorStop(0, rgba(74, 217, 196, 0.045 + d.rainNorm * 0.07));
    glow.addColorStop(0.48, rgba(28, 91, 78, 0.03 + d.rainNorm * 0.035));
    glow.addColorStop(1, rgba(4, 15, 14, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    const pulse = d.thunder;
    if (pulse > 0.03) {
      ctx.fillStyle = rgba(193, 231, 255, pulse * 0.1);
      ctx.fillRect(0, 0, w, h);
    }
  }

  drawStars(d, hours) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const daylight = Math.max(0, Math.sin(((hours - 6) / 12) * Math.PI));
    const night = 1 - daylight;
    const visibility = night * (1 - d.cloudDensity * 0.8);
    if (visibility < 0.04) return;
    ctx.save();
    for (const star of this.stars) {
      const twinkle = 0.55 + Math.sin(hours * 2.8 + star.phase) * 0.25;
      ctx.globalAlpha = star.alpha * visibility * twinkle;
      ctx.fillStyle = star.size > 1.2 ? "#bdf8e8" : "#d9f1e7";
      ctx.beginPath();
      ctx.arc(star.x * w, star.y * h, star.size, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  drawMoon(d, hours) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const daylight = Math.max(0, Math.sin(((hours - 6) / 12) * Math.PI));
    const opacity = (1 - daylight) * (0.28 + (1 - d.cloudDensity) * 0.42);
    if (opacity < 0.02) return;
    const x = w * 0.79;
    const y = h * 0.17;
    const radius = Math.max(18, w * 0.022);
    const glow = ctx.createRadialGradient(x, y, radius * 0.2, x, y, radius * 4.8);
    glow.addColorStop(0, rgba(205, 247, 235, 0.35 * opacity));
    glow.addColorStop(0.2, rgba(138, 209, 191, 0.12 * opacity));
    glow.addColorStop(1, rgba(45, 93, 83, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, radius * 4.8, 0, TAU);
    ctx.fill();
    ctx.fillStyle = rgba(210, 246, 236, opacity * 0.52);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = rgba(157, 222, 204, opacity * 0.24);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, radius + 10, 0, TAU);
    ctx.stroke();
  }

  drawClouds(d, hours) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    ctx.save();
    this.clouds.forEach((puffs, layer) => {
      const drift = hours * (3.1 + layer * 1.8) * d.windDrift;
      puffs.forEach((puff) => {
        const span = w + puff.width * w * 3;
        const x = mod(puff.x * span + drift * (layer + 1) * 0.7, span) - puff.width * w;
        const bobbing = Math.sin(hours * 0.38 + puff.phase) * 3.5;
        const y = puff.y * h + bobbing;
        const width = puff.width * w * (0.82 + d.cloudDensity * 0.35);
        const height = puff.height * h * (0.8 + d.cloudDensity * 0.5);
        const alpha = puff.alpha * (0.17 + d.cloudDensity * 0.53);
        const gradient = ctx.createRadialGradient(x, y, height * 0.08, x, y, width);
        gradient.addColorStop(0, rgba(47, 73, 67, alpha));
        gradient.addColorStop(0.32, rgba(24, 49, 44, alpha * 0.9));
        gradient.addColorStop(0.74, rgba(15, 35, 32, alpha * 0.48));
        gradient.addColorStop(1, rgba(10, 28, 26, 0));
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.ellipse(x, y, width, height, -0.04, 0, TAU);
        ctx.fill();
        if (layer < 2) {
          ctx.fillStyle = rgba(139, 194, 175, alpha * 0.11);
          ctx.beginPath();
          ctx.ellipse(x - width * 0.16, y - height * 0.24, width * 0.62, height * 0.5, -0.1, 0, TAU);
          ctx.fill();
        }
      });
    });
    ctx.restore();
  }

  drawLightning(d, hours) {
    if (d.thunder < 0.035) return;
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    let eventIndex = 0;
    let best = 0;
    THUNDER_EVENTS.forEach((event, index) => {
      const elapsed = hours - event.hour;
      const score = elapsed >= -0.004 && elapsed < 0.14 ? Math.exp(-Math.max(0, elapsed) * 23) * event.strength : 0;
      if (score > best) {
        best = score;
        eventIndex = index;
      }
    });
    const bolts = this.lightning[eventIndex] || this.lightning[0];
    const startX = w * (0.22 + bolts[0].x * 0.32);
    const endX = w * (0.36 + bolts[8].x * 0.24);
    const top = h * (0.08 + bolts[1].y * 0.06);
    const bottom = h * (0.48 + bolts[9].y * 0.05);
    ctx.save();
    ctx.globalAlpha = clamp(d.thunder * 1.4, 0, 1);
    ctx.strokeStyle = rgba(207, 246, 255, 0.96);
    ctx.shadowColor = rgba(91, 222, 255, 0.9);
    ctx.shadowBlur = 18;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(startX, top);
    for (let index = 0; index < 13; index += 1) {
      const amount = (index + 1) / 13;
      const jitter = (bolts[index].x - 0.5) * w * 0.06;
      ctx.lineTo(lerp(startX, endX, amount) + jitter, lerp(top, bottom, amount));
    }
    ctx.stroke();
    ctx.globalAlpha *= 0.45;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(lerp(startX, endX, 0.4), lerp(top, bottom, 0.4));
    ctx.lineTo(lerp(startX, endX, 0.4) - w * 0.09, lerp(top, bottom, 0.58));
    ctx.lineTo(lerp(startX, endX, 0.4) - w * 0.04, lerp(top, bottom, 0.7));
    ctx.stroke();
    ctx.restore();
  }

  drawRidges(d, hours) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const layers = [
      { base: h * 0.525, amplitude: h * 0.075, color: [8, 26, 24], rim: 0.09 },
      { base: h * 0.555, amplitude: h * 0.105, color: [5, 18, 17], rim: 0.13 },
    ];
    layers.forEach((layer, layerIndex) => {
      const gradient = ctx.createLinearGradient(0, layer.base - h * 0.12, 0, h);
      gradient.addColorStop(0, rgba(layer.color[0], layer.color[1], layer.color[2], 0.97));
      gradient.addColorStop(1, rgba(2, 11, 10, 0.98));
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let x = 0; x <= w + 10; x += 10) {
        const profile = sampleAt((x / w) * TOTAL_HOURS).rain / 30;
        const texture = Math.sin(x * 0.021 + layerIndex * 2.3) * 4 + Math.sin(x * 0.007) * 7;
        const y = layer.base - profile * layer.amplitude - texture;
        if (x === 0) ctx.lineTo(0, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = rgba(107, 220, 190, layer.rim);
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      for (let x = 0; x <= w + 10; x += 10) {
        const profile = sampleAt((x / w) * TOTAL_HOURS).rain / 30;
        const texture = Math.sin(x * 0.021 + layerIndex * 2.3) * 4 + Math.sin(x * 0.007) * 7;
        const y = layer.base - profile * layer.amplitude - texture;
        if (x === 0) ctx.moveTo(0, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    });

    const cursorX = (hours / TOTAL_HOURS) * w;
    const profileY = h * 0.555 - d.rainNorm * h * 0.105;
    const glow = ctx.createRadialGradient(cursorX, profileY, 0, cursorX, profileY, 52);
    glow.addColorStop(0, rgba(200, 239, 116, 0.24));
    glow.addColorStop(0.35, rgba(74, 217, 196, 0.11));
    glow.addColorStop(1, rgba(74, 217, 196, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(cursorX - 52, profileY - 52, 104, 104);
    ctx.strokeStyle = rgba(200, 239, 116, 0.22);
    ctx.setLineDash([2, 5]);
    ctx.beginPath();
    ctx.moveTo(cursorX, profileY);
    ctx.lineTo(cursorX, h * 0.7);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  drawCity(d, hours) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const cityStart = w * 0.69;
    const citySpan = w * 0.27;
    const ground = h * 0.552;
    const luminance = d.cityBrightness;
    const glow = ctx.createRadialGradient(cityStart + citySpan * 0.55, ground, 0, cityStart + citySpan * 0.55, ground, citySpan * 0.9);
    glow.addColorStop(0, rgba(255, 189, 116, 0.07 + luminance * 0.12));
    glow.addColorStop(0.45, rgba(92, 190, 165, 0.03 + luminance * 0.04));
    glow.addColorStop(1, rgba(10, 26, 24, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(cityStart - citySpan * 0.4, ground - citySpan * 0.75, citySpan * 1.8, citySpan * 1.5);

    this.buildings.forEach((building, index) => {
      const x = cityStart + building.offset * citySpan;
      const width = building.width * w;
      const height = building.height * h;
      const top = ground - height;
      ctx.fillStyle = rgba(5, 17, 16, 0.94);
      ctx.fillRect(x, top, width, height);
      ctx.strokeStyle = rgba(124, 176, 159, 0.06 + luminance * 0.05);
      ctx.lineWidth = 0.6;
      ctx.strokeRect(x + 0.5, top + 0.5, width - 1, height - 1);
      const windowWidth = Math.max(1, width / (building.columns * 2.3));
      const windowHeight = Math.max(1, height / (building.rows * 3));
      const startX = x + width * 0.12;
      const startY = top + height * 0.1;
      const stepX = (width * 0.76) / building.columns;
      const stepY = (height * 0.76) / building.rows;
      const flicker = 0.88 + Math.sin(hours * 2.2 + building.delay) * 0.12;
      ctx.fillStyle = index % 4 === 0
        ? rgba(130, 235, 211, 0.16 + luminance * 0.56 * flicker)
        : rgba(255, 190, 119, 0.12 + luminance * 0.52 * flicker);
      for (let row = 0; row < building.rows; row += 1) {
        for (let column = 0; column < building.columns; column += 1) {
          if ((row * 3 + column + index) % 7 === 0 && luminance < 0.42) continue;
          ctx.fillRect(startX + column * stepX, startY + row * stepY, windowWidth, windowHeight);
        }
      }
      if (index === 10 || index === 15) {
        const beaconAlpha = 0.36 + Math.sin(hours * 8 + index) * 0.28;
        ctx.fillStyle = rgba(255, 111, 104, beaconAlpha);
        ctx.shadowColor = rgba(255, 111, 104, 0.9);
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(x + width * 0.5, top - 2, 1.4, 0, TAU);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    });

    ctx.strokeStyle = rgba(196, 226, 215, 0.1 + luminance * 0.08);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cityStart, ground);
    ctx.lineTo(cityStart + citySpan, ground);
    ctx.stroke();
  }

  drawRiver(d, hours) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const glow = d.riverGlow;
    const points = [
      { x: w * 0.57, y: h * 0.515 },
      { x: w * 0.65, y: h * 0.635 },
      { x: w * 0.49, y: h * 0.805 },
      { x: w * 0.36, y: h * 1.035 },
    ];
    const bezier = (amount) => {
      const inverse = 1 - amount;
      return {
        x:
          inverse ** 3 * points[0].x +
          3 * inverse ** 2 * amount * points[1].x +
          3 * inverse * amount ** 2 * points[2].x +
          amount ** 3 * points[3].x,
        y:
          inverse ** 3 * points[0].y +
          3 * inverse ** 2 * amount * points[1].y +
          3 * inverse * amount ** 2 * points[2].y +
          amount ** 3 * points[3].y,
      };
    };
    const tracePath = () => {
      ctx.beginPath();
      const first = bezier(0);
      ctx.moveTo(first.x, first.y);
      for (let index = 1; index <= 32; index += 1) {
        const point = bezier(index / 32);
        ctx.lineTo(point.x, point.y);
      }
    };

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = rgba(74, 217, 196, 0.55);
    ctx.shadowBlur = 12 + glow * 30;
    tracePath();
    ctx.strokeStyle = rgba(56, 177, 154, 0.03 + glow * 0.1);
    ctx.lineWidth = 18 + glow * 32;
    ctx.stroke();
    tracePath();
    ctx.strokeStyle = rgba(105, 239, 210, 0.15 + glow * 0.55);
    ctx.lineWidth = 3 + glow * 7;
    ctx.stroke();
    ctx.shadowBlur = 0;
    tracePath();
    ctx.strokeStyle = rgba(205, 252, 236, 0.2 + glow * 0.5);
    ctx.lineWidth = 0.8 + glow * 1.4;
    ctx.stroke();
    ctx.restore();

    const cityReflection = ctx.createLinearGradient(w * 0.58, h * 0.51, w * 0.67, h * 0.65);
    cityReflection.addColorStop(0, rgba(255, 190, 119, 0.06 + d.cityBrightness * 0.12));
    cityReflection.addColorStop(1, rgba(74, 217, 196, 0));
    ctx.fillStyle = cityReflection;
    ctx.beginPath();
    ctx.moveTo(w * 0.565, h * 0.512);
    ctx.lineTo(w * 0.69, h * 0.512);
    ctx.lineTo(w * 0.63, h * 0.67);
    ctx.lineTo(w * 0.55, h * 0.64);
    ctx.closePath();
    ctx.fill();

    ctx.save();
    ctx.strokeStyle = rgba(192, 249, 230, 0.16 + glow * 0.3);
    ctx.lineWidth = 0.8;
    for (let flow = 0; flow < 11; flow += 1) {
      const amount = mod(flow / 11 + hours * 0.018 + Math.sin(flow * 2.7) * 0.04, 1);
      const point = bezier(amount);
      const next = bezier(Math.min(1, amount + 0.025));
      ctx.globalAlpha = (0.2 + glow * 0.7) * (1 - Math.abs(amount - 0.55) * 0.9);
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(next.x, next.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawContours(d, hours) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    ctx.save();
    ctx.lineWidth = 0.7;
    for (let line = 0; line < 5; line += 1) {
      const baseY = h * 0.735 + line * h * 0.062;
      const amplitude = 2.5 + d.rainNorm * 7 + line * 0.4;
      ctx.strokeStyle = rgba(90, 206, 177, 0.035 + d.rainNorm * 0.05 + line * 0.008);
      ctx.beginPath();
      for (let x = 0; x <= w + 8; x += 8) {
        const y =
          baseY +
          Math.sin(x * 0.012 + hours * 0.32 + line * 1.3) * amplitude +
          Math.sin(x * 0.028 - hours * 0.2 + line) * amplitude * 0.36;
        if (x === 0) ctx.moveTo(0, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  drawRain(d, hours) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const count = Math.floor(38 + d.rainNorm * 270);
    const slant = d.windDrift * 0.18 + d.pan * 0.08;
    const flash = d.thunder * 0.45;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineWidth = 0.65;
    for (let index = 0; index < count; index += 1) {
      const drop = this.drops[index];
      const fall = mod(drop.y * h + hours * 188 * drop.speed, h * 1.12) - h * 0.06;
      const x = mod(drop.x * w + slant * fall * 1.5, w + 50) - 25;
      const length = (4 + drop.length * 10) * (0.55 + d.rainNorm * 0.75);
      const alpha = drop.alpha * (0.1 + d.rainNorm * 0.31) + flash * 0.05;
      ctx.strokeStyle = rgba(154, 225, 211, alpha);
      ctx.beginPath();
      ctx.moveTo(x, fall);
      ctx.lineTo(x - slant * length * 1.7, fall + length);
      ctx.stroke();
    }
    if (d.rainNorm > 0.38) {
      ctx.lineWidth = 0.9;
      for (let index = 0; index < Math.floor(d.rainNorm * 55); index += 1) {
        const drop = this.drops[(index + 70) % this.drops.length];
        const fall = mod(drop.y * h + hours * 245 * drop.speed, h * 1.12) - h * 0.06;
        const x = mod(drop.x * w + slant * fall * 1.5, w + 50) - 25;
        ctx.strokeStyle = rgba(199, 248, 234, drop.alpha * 0.34);
        ctx.beginPath();
        ctx.moveTo(x, fall);
        ctx.lineTo(x - slant * 16, fall + 20);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawAtmosphere(d) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const haze = ctx.createLinearGradient(0, h * 0.33, 0, h * 0.68);
    haze.addColorStop(0, rgba(118, 194, 174, 0));
    haze.addColorStop(0.55, rgba(92, 166, 149, 0.025 + d.rainNorm * 0.04));
    haze.addColorStop(1, rgba(74, 164, 145, 0));
    ctx.fillStyle = haze;
    ctx.fillRect(0, h * 0.33, w, h * 0.35);
    if (d.anomaly) {
      const warning = ctx.createLinearGradient(0, h * 0.52, 0, h);
      warning.addColorStop(0, rgba(255, 117, 110, 0));
      warning.addColorStop(1, rgba(255, 117, 110, 0.025 + d.thunder * 0.05));
      ctx.fillStyle = warning;
      ctx.fillRect(0, h * 0.52, w, h * 0.48);
    }
  }
}

class TimelineRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  resize() {
    const bounds = this.canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = bounds.width;
    this.height = bounds.height;
    this.canvas.width = Math.round(bounds.width * this.dpr);
    this.canvas.height = Math.round(bounds.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  draw(snapshot) {
    if (!this.width || !this.height) this.resize();
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const hours = snapshot.timeHours;
    const progress = hours / TOTAL_HOURS;
    ctx.clearRect(0, 0, w, h);

    const background = ctx.createLinearGradient(0, 0, 0, h);
    background.addColorStop(0, rgba(8, 26, 24, 0.7));
    background.addColorStop(1, rgba(3, 14, 13, 0.92));
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);

    for (let hour = 0; hour <= 24; hour += 2) {
      const x = (hour / 24) * w;
      ctx.strokeStyle = rgba(132, 189, 171, hour % 4 === 0 ? 0.06 : 0.035);
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    const pastWidth = progress * w;
    if (pastWidth > 0) {
      const past = ctx.createLinearGradient(0, 0, pastWidth, 0);
      past.addColorStop(0, rgba(74, 217, 196, 0.01));
      past.addColorStop(1, rgba(74, 217, 196, 0.055));
      ctx.fillStyle = past;
      ctx.fillRect(0, 0, pastWidth, h);
    }

    ANOMALIES.forEach((anomaly) => {
      const startX = (anomaly.start / 24) * w;
      const endX = (anomaly.end / 24) * w;
      const active = hours >= anomaly.start && hours <= anomaly.end;
      const band = ctx.createLinearGradient(0, 0, 0, h);
      band.addColorStop(0, rgba(255, 117, 110, active ? 0.12 : 0.055));
      band.addColorStop(1, rgba(255, 117, 110, 0.015));
      ctx.fillStyle = band;
      ctx.fillRect(startX, 0, endX - startX, h);
      ctx.fillStyle = rgba(255, 117, 110, active ? 0.8 : 0.38);
      ctx.fillRect(startX, 0, endX - startX, 2);
      ctx.strokeStyle = rgba(255, 117, 110, active ? 0.22 : 0.09);
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(startX, 0);
      ctx.lineTo(startX, h);
      ctx.moveTo(endX, 0);
      ctx.lineTo(endX, h);
      ctx.stroke();
    });

    const baseline = h - 7;
    const maxRain = Math.max(...RAIN_SAMPLE);
    const barWidth = w / RAIN_SAMPLE.length;
    RAIN_SAMPLE.forEach((rain, index) => {
      const normalized = Math.sqrt(rain / maxRain);
      const height = 4 + normalized * (h - 21);
      const x = index * barWidth;
      const isPast = (index + 0.5) / RAIN_SAMPLE.length <= progress;
      const color = mixColor([36, 112, 100], [200, 239, 116], normalized);
      ctx.fillStyle = rgba(color[0], color[1], color[2], isPast ? 0.78 : 0.34);
      ctx.fillRect(x + 0.45, baseline - height, Math.max(0.8, barWidth - 0.9), height);
      if (normalized > 0.55) {
        ctx.fillStyle = rgba(235, 255, 238, isPast ? 0.5 : 0.18);
        ctx.fillRect(x + 0.45, baseline - height, Math.max(0.8, barWidth - 0.9), 1);
      }
    });

    ctx.save();
    ctx.strokeStyle = rgba(143, 240, 204, 0.42);
    ctx.lineWidth = 1;
    ctx.beginPath();
    RAIN_SAMPLE.forEach((rain, index) => {
      const x = (index / RAIN_SAMPLE.length) * w;
      const y = baseline - (4 + Math.sqrt(rain / maxRain) * (h - 21));
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();

    THUNDER_EVENTS.forEach((event) => {
      const x = (event.hour / 24) * w;
      ctx.strokeStyle = rgba(255, 137, 128, 0.48);
      ctx.lineWidth = 0.7;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(x, 9);
      ctx.lineTo(x, baseline);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = rgba(255, 137, 128, 0.8);
      ctx.beginPath();
      ctx.moveTo(x, 7);
      ctx.lineTo(x + 3.5, 11);
      ctx.lineTo(x, 15);
      ctx.lineTo(x - 3.5, 11);
      ctx.closePath();
      ctx.fill();
    });

    ctx.strokeStyle = rgba(116, 169, 154, 0.2);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, baseline);
    ctx.lineTo(w, baseline);
    ctx.stroke();
  }
}

class SynthEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.targets = { gain: 0, pan: 0, volume: 0 };
    this.thunderTriggers = 0;
    this.activePulses = [];
    this.noiseBuffer = null;
  }

  async init() {
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("Web Audio is unavailable");
      this.ctx = new AudioContextClass();
      this.buildGraph();
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.ready = true;
    return this.ctx.state;
  }

  buildGraph() {
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.78;
    this.master.connect(ctx.destination);
    this.panner = ctx.createStereoPanner();
    this.panner.pan.value = 0;
    this.panner.connect(this.master);

    this.noiseBuffer = this.createNoiseBuffer(4);

    const highpass = ctx.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 360;
    highpass.Q.value = 0.4;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 3100;
    lowpass.Q.value = 0.45;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    this.rainFilter = lowpass;
    this.rainHighpass = highpass;

    const rainSource = ctx.createBufferSource();
    rainSource.buffer = this.noiseBuffer;
    rainSource.loop = true;
    rainSource.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(this.rainGain);
    this.rainGain.connect(this.panner);
    rainSource.start();

    const bodyFilter = ctx.createBiquadFilter();
    bodyFilter.type = "lowpass";
    bodyFilter.frequency.value = 210;
    bodyFilter.Q.value = 0.55;
    this.bodyGain = ctx.createGain();
    this.bodyGain.gain.value = 0;
    const bodySource = ctx.createBufferSource();
    bodySource.buffer = this.noiseBuffer;
    bodySource.loop = true;
    bodySource.playbackRate.value = 0.64;
    bodySource.connect(bodyFilter);
    bodyFilter.connect(this.bodyGain);
    this.bodyGain.connect(this.panner);
    bodySource.start();

    this.sources = [rainSource, bodySource];
  }

  createNoiseBuffer(seconds) {
    const ctx = this.ctx;
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    const random = seededRandom(157);
    let brown = 0;
    for (let index = 0; index < length; index += 1) {
      const white = random() * 2 - 1;
      brown = brown * 0.76 + white * 0.24;
      data[index] = white * 0.58 + brown * 0.42;
    }
    return buffer;
  }

  setParameters(derived, playing, muted, immediate = false) {
    if (!this.ready || !this.ctx) return;
    const now = this.ctx.currentTime;
    const gain = playing && !muted ? 0.025 + derived.volume * 0.23 : 0;
    const pan = clamp(derived.pan, -1, 1);
    const smoothing = immediate ? 0.002 : 0.075;
    this.rainGain.gain.setTargetAtTime(gain, now, smoothing);
    this.bodyGain.gain.setTargetAtTime(gain * 0.12, now, smoothing);
    this.panner.pan.setTargetAtTime(pan, now, smoothing);
    this.rainFilter.frequency.setTargetAtTime(900 + derived.volume * 6100, now, smoothing);
    this.rainHighpass.frequency.setTargetAtTime(180 + derived.volume * 420, now, smoothing);
    this.targets = { gain, pan, volume: derived.volume };
    if (!playing || muted) this.stopAllPulses();
  }

  triggerThunder(strength = 1) {
    if (!this.ready || !this.ctx || this.muted) return false;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    this.thunderTriggers += 1;

    const rumble = ctx.createBufferSource();
    rumble.buffer = this.noiseBuffer;
    const offset = mod(this.thunderTriggers * 0.73, 3.2);
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.setValueAtTime(720, now);
    lowpass.frequency.exponentialRampToValueAtTime(150, now + 1.3);
    lowpass.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.46 * strength, now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.35);
    rumble.connect(lowpass);
    lowpass.connect(gain);
    gain.connect(this.panner);
    rumble.start(now, offset, 1.45);

    const crack = ctx.createBufferSource();
    crack.buffer = this.noiseBuffer;
    const crackFilter = ctx.createBiquadFilter();
    crackFilter.type = "highpass";
    crackFilter.frequency.value = 1800;
    const crackGain = ctx.createGain();
    crackGain.gain.setValueAtTime(0.0001, now + 0.05);
    crackGain.gain.linearRampToValueAtTime(0.2 * strength, now + 0.072);
    crackGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.29);
    crack.connect(crackFilter);
    crackFilter.connect(crackGain);
    crackGain.connect(this.panner);
    crack.start(now + 0.05, offset + 0.3, 0.26);

    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(52, now);
    sub.frequency.exponentialRampToValueAtTime(32, now + 0.6);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.0001, now);
    subGain.gain.linearRampToValueAtTime(0.09 * strength, now + 0.06);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
    sub.connect(subGain);
    subGain.connect(this.panner);
    sub.start(now);
    sub.stop(now + 0.75);

    const pulse = { nodes: [rumble, crack, sub], stopAt: now + 1.5 };
    this.activePulses.push(pulse);
    setTimeout(() => {
      this.activePulses = this.activePulses.filter((item) => item !== pulse);
    }, 1700);
    return true;
  }

  stopAllPulses() {
    for (const pulse of this.activePulses) {
      for (const node of pulse.nodes) {
        if (typeof node.stop === "function") {
          try {
            node.stop();
          } catch {
            void 0;
          }
        }
      }
    }
    this.activePulses = [];
  }

  setMuted(muted) {
    this.muted = muted;
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(muted ? 0 : 0.78, now, 0.06);
    if (muted) this.stopAllPulses();
  }

  getMetrics() {
    return {
      ready: this.ready,
      state: this.ctx?.state || "none",
      gainTarget: this.targets.gain,
      panTarget: this.targets.pan,
      panActual: this.panner ? this.panner.pan.value : null,
      gainActual: this.rainGain ? this.rainGain.gain.value : null,
      thunderTriggers: this.thunderTriggers,
      muted: this.muted,
    };
  }
}

const state = {
  timeHours: 0,
  playing: false,
  scrubbing: false,
  speedIndex: 0,
  muted: false,
  markers: [],
  lastFrame: 0,
  dragStartX: 0,
  dragMoved: false,
  audioError: "",
  lastRendered: null,
};

const ui = {
  terrainCanvas: document.querySelector("#terrainCanvas"),
  timelineCanvas: document.querySelector("#timelineCanvas"),
  bigClock: document.querySelector("#bigClock"),
  stageRain: document.querySelector("#stageRain"),
  stageVolume: document.querySelector("#stageVolume"),
  stagePan: document.querySelector("#stagePan"),
  stageThunder: document.querySelector("#stageThunder"),
  windText: document.querySelector("#windText"),
  windArrow: document.querySelector("#windArrow"),
  cloudLabel: document.querySelector("#cloudLabel"),
  riverLabel: document.querySelector("#riverLabel"),
  cityLabel: document.querySelector("#cityLabel"),
  heroRain: document.querySelector("#heroRain"),
  rainTag: document.querySelector("#rainTag"),
  conditionText: document.querySelector("#conditionText"),
  volumeValue: document.querySelector("#volumeValue"),
  volumeMeter: document.querySelector("#volumeMeter"),
  panValue: document.querySelector("#panValue"),
  panMarker: document.querySelector("#panMarker"),
  cloudValue: document.querySelector("#cloudValue"),
  cloudMeter: document.querySelector("#cloudMeter"),
  cityValue: document.querySelector("#cityValue"),
  cityMeter: document.querySelector("#cityMeter"),
  markerCount: document.querySelector("#markerCount"),
  anomalyList: document.querySelector("#anomalyList"),
  markerList: document.querySelector("#markerList"),
  emptyMarkers: document.querySelector("#emptyMarkers"),
  clearMarkersBtn: document.querySelector("#clearMarkersBtn"),
  playBtn: document.querySelector("#playBtn"),
  rewindBtn: document.querySelector("#rewindBtn"),
  playheadButton: document.querySelector("#playheadButton"),
  speedBtn: document.querySelector("#speedBtn"),
  speedValue: document.querySelector("#speedValue"),
  muteBtn: document.querySelector("#muteBtn"),
  timelineFrame: document.querySelector("#timelineFrame"),
  playhead: document.querySelector("#playhead"),
  markerPins: document.querySelector("#markerPins"),
  timelineCursor: document.querySelector("#timelineCursor"),
  timelineReadout: document.querySelector("#timelineReadout"),
  engineStatus: document.querySelector("#engineStatus"),
  syncStatus: document.querySelector("#syncStatus"),
  stageHint: document.querySelector("#stageHint"),
  stageCard: document.querySelector(".stage-card"),
};

const terrainRenderer = new TerrainRenderer(ui.terrainCanvas);
const timelineRenderer = new TimelineRenderer(ui.timelineCanvas);
const audio = new SynthEngine();
const notice = document.createElement("div");
notice.className = "notice";
notice.setAttribute("aria-live", "polite");
ui.stageCard.append(notice);

let noticeTimer = 0;
let lastEngineLabel = "";

function setText(node, value) {
  const text = String(value);
  if (node.textContent !== text) node.textContent = text;
}

function showNotice(message, tone = "accent") {
  notice.textContent = message;
  notice.dataset.tone = tone;
  notice.classList.add("is-visible");
  window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => notice.classList.remove("is-visible"), 2100);
}

function hideHint() {
  ui.stageHint.classList.add("is-hidden");
}

function makeSnapshot() {
  const derived = deriveState(state.timeHours, state.playing, state.scrubbing);
  return {
    timeHours: state.timeHours,
    timeLabel: formatClock(state.timeHours),
    playing: state.playing,
    scrubbing: state.scrubbing,
    speed: SPEEDS[state.speedIndex],
    muted: state.muted,
    markers: state.markers.slice(),
    derived,
  };
}

function renderAnomalies() {
  ANOMALIES.forEach((anomaly) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "anomaly-item";
    button.dataset.anomalyId = anomaly.id;
    button.setAttribute("aria-pressed", "false");

    const time = document.createElement("span");
    time.className = "anomaly-time";
    time.textContent = formatRange(anomaly.start, anomaly.end);

    const copy = document.createElement("span");
    copy.className = "anomaly-copy";
    const title = document.createElement("b");
    title.textContent = anomaly.label;
    const detail = document.createElement("small");
    detail.textContent = `${anomaly.detail} · 峰值 ${anomaly.peakRain} mm/h`;
    copy.append(title, detail);

    const add = document.createElement("span");
    add.className = "anomaly-add";
    add.textContent = "+";
    add.setAttribute("aria-hidden", "true");
    button.append(time, copy, add);
    button.addEventListener("click", () => {
      toggleAnomaly(anomaly.id);
      hideHint();
    });
    ui.anomalyList.append(button);
  });
}

function renderMarkers() {
  const count = state.markers.length;
  setText(ui.markerCount, `${count} / ${ANOMALIES.length} 疑点`);
  ui.clearMarkersBtn.disabled = count === 0;
  ui.markerList.replaceChildren();
  ui.markerPins.replaceChildren();

  state.markers.forEach((marker, index) => {
    const row = document.createElement("li");
    row.dataset.markerId = marker.id;
    const number = document.createElement("span");
    number.className = "marker-index";
    number.textContent = String(index + 1).padStart(2, "0");
    const copy = document.createElement("span");
    copy.className = "marker-copy";
    const title = document.createElement("b");
    title.textContent = marker.label;
    const time = document.createElement("span");
    time.textContent = `${formatClock(marker.hour)} · ${formatRange(marker.start, marker.end)}`;
    copy.append(title, time);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "marker-remove";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `移除${marker.label}疑点`);
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      removeMarker(marker.id);
    });
    row.addEventListener("click", () => seek(marker.hour));
    row.append(number, copy, remove);
    ui.markerList.append(row);

    const pin = document.createElement("i");
    pin.className = "marker-pin";
    pin.dataset.index = String(index + 1);
    pin.style.left = `${(marker.hour / TOTAL_HOURS) * 100}%`;
    pin.title = `${marker.label} · ${formatClock(marker.hour)}`;
    ui.markerPins.append(pin);
  });

  ui.emptyMarkers.hidden = count > 0;
  const ids = new Set(state.markers.map((marker) => marker.id));
  ui.anomalyList.querySelectorAll(".anomaly-item").forEach((button) => {
    const marked = ids.has(button.dataset.anomalyId);
    button.classList.toggle("is-marked", marked);
    button.setAttribute("aria-pressed", marked ? "true" : "false");
    const symbol = button.querySelector(".anomaly-add");
    symbol.textContent = marked ? "✓" : "+";
  });
}

function toggleAnomaly(id, options = {}) {
  const anomaly = ANOMALIES.find((item) => item.id === id);
  if (!anomaly) return false;
  const existing = state.markers.findIndex((marker) => marker.id === id);
  if (existing >= 0) {
    state.markers.splice(existing, 1);
    showNotice(`已移除疑点：${anomaly.label}`, "muted");
  } else {
    state.markers.push({
      id: anomaly.id,
      hour: anomaly.focus,
      start: anomaly.start,
      end: anomaly.end,
      label: anomaly.label,
    });
    showNotice(`疑点已记录：${anomaly.label}`, "alert");
  }
  if (options.seek !== false) seek(anomaly.focus);
  else update();
  renderMarkers();
  return true;
}

function removeMarker(id) {
  state.markers = state.markers.filter((marker) => marker.id !== id);
  update();
}

function updateUI(snapshot) {
  const d = snapshot.derived;
  const clock = formatClock(snapshot.timeHours);
  const volumePercent = Math.round(d.volume * 100);
  const cloudPercent = Math.round(d.cloudDensity * 100);
  const riverPercent = Math.round(d.riverGlow * 100);
  const cityPercent = Math.round(d.cityBrightness * 100);

  setText(ui.bigClock, clock);
  setText(ui.stageRain, d.sample.rain.toFixed(1));
  setText(ui.stageVolume, volumePercent);
  setText(ui.stagePan, panLabel(d.pan));
  setText(ui.stageThunder, d.thunder > 0.09 ? "FLASH" : "—");
  setText(ui.windText, `${String(Math.round(d.sample.wind)).padStart(3, "0")}° ${compassName(d.sample.wind)}`);
  setText(ui.cloudLabel, String(cloudPercent).padStart(2, "0"));
  setText(ui.riverLabel, String(riverPercent).padStart(2, "0"));
  setText(ui.cityLabel, String(cityPercent).padStart(2, "0"));
  setText(ui.heroRain, d.sample.rain.toFixed(1));
  setText(ui.rainTag, rainLabel(d.sample.rain));
  setText(ui.conditionText, conditionFor(d));
  setText(ui.volumeValue, `${volumePercent}%`);
  setText(ui.panValue, panLabel(d.pan));
  setText(ui.cloudValue, `${cloudPercent}%`);
  setText(ui.cityValue, `${cityPercent}%`);
  ui.windArrow.style.transform = `rotate(${d.sample.wind}deg)`;
  ui.volumeMeter.style.width = `${volumePercent}%`;
  ui.cloudMeter.style.width = `${cloudPercent}%`;
  ui.cityMeter.style.width = `${cityPercent}%`;
  ui.panMarker.style.left = `${(d.pan + 1) * 50}%`;
  ui.stageThunder.classList.toggle("is-flashing", d.thunder > 0.09);

  const percent = (snapshot.timeHours / TOTAL_HOURS) * 100;
  ui.playhead.style.left = `${percent}%`;
  ui.playhead.classList.toggle("is-near-end", percent > 86);
  const playheadLabel = ui.playhead.querySelector("span");
  if (playheadLabel) setText(playheadLabel, clock);
  setText(ui.timelineReadout, `${clock} / 24:00`);
  ui.timelineFrame.setAttribute("aria-valuenow", String(Math.round(snapshot.timeHours * 60)));
  ui.timelineFrame.setAttribute("aria-valuetext", clock);

  ui.playBtn.classList.toggle("is-playing", snapshot.playing);
  ui.playBtn.setAttribute("aria-label", snapshot.playing ? "暂停" : "播放");
  setText(ui.speedBtn, `${snapshot.speed.toFixed(1)}×`);
  setText(ui.speedValue, `${snapshot.speed.toFixed(1)}×`);
  ui.muteBtn.classList.toggle("is-muted", snapshot.muted);
  ui.muteBtn.setAttribute("aria-label", snapshot.muted ? "取消静音" : "静音");

  ui.anomalyList.querySelectorAll(".anomaly-item").forEach((button) => {
    const anomaly = ANOMALIES.find((item) => item.id === button.dataset.anomalyId);
    const active = anomaly && snapshot.timeHours >= anomaly.start && snapshot.timeHours <= anomaly.end;
    button.classList.toggle("is-active", Boolean(active));
  });

  let engineLabel = "音频待启动";
  let engineClass = "";
  if (state.audioError) {
    engineLabel = "音频启动失败";
    engineClass = "is-error";
  } else if (audio.ready) {
    engineLabel = audio.ctx?.state === "running" ? "合成引擎运行中" : "音频已挂起";
    engineClass = audio.ctx?.state === "running" ? "is-ready" : "";
  }
  if (engineLabel !== lastEngineLabel) {
    ui.engineStatus.className = engineClass;
    ui.engineStatus.innerHTML = `<i></i>${engineLabel}`;
    lastEngineLabel = engineLabel;
  }
  setText(ui.syncStatus, "FRAME SYNC · 0.0 ms");
}

function syncAudio(snapshot, immediate = false, scrub = false) {
  if (!audio.ready) return;
  const derived = scrub
    ? deriveState(snapshot.timeHours, true, false)
    : snapshot.derived;
  audio.setParameters(derived, snapshot.playing, snapshot.muted, immediate);
}

function renderSnapshot(snapshot, timestamp = performance.now()) {
  state.lastRendered = snapshot;
  terrainRenderer.draw(snapshot, timestamp);
  timelineRenderer.draw(snapshot);
  updateUI(snapshot);
}

function update() {
  const snapshot = makeSnapshot();
  syncAudio(snapshot);
  renderSnapshot(snapshot);
  renderMarkers();
  return snapshot;
}

async function setPlaying(playing) {
  if (playing && state.timeHours >= TOTAL_HOURS) state.timeHours = 0;
  if (playing) {
    hideHint();
    try {
      await audio.init();
      audio.setMuted(state.muted);
      state.audioError = "";
    } catch (error) {
      state.audioError = String(error.message || error);
      showNotice("音频上下文不可用，画面仍可探索", "alert");
    }
  }
  state.playing = playing;
  state.lastFrame = performance.now();
  const snapshot = makeSnapshot();
  syncAudio(snapshot, !playing);
  if (playing) triggerThunderNear(state.timeHours);
  renderSnapshot(snapshot);
  return snapshot;
}

function togglePlay() {
  return setPlaying(!state.playing);
}

function seek(hours, options = {}) {
  state.timeHours = clamp(hours, 0, TOTAL_HOURS);
  const snapshot = makeSnapshot();
  if (audio.ready) syncAudio(snapshot, true, options.scrub);
  if (!options.scrub) triggerThunderNear(state.timeHours);
  renderSnapshot(snapshot);
  return snapshot;
}

function triggerThunderCrossings(previous, next) {
  if (!state.playing || state.scrubbing || !audio.ready) return;
  THUNDER_EVENTS.forEach((event) => {
    if (previous < event.hour && next >= event.hour) audio.triggerThunder(event.strength);
  });
}

function triggerThunderNear(hours) {
  if (!state.playing || state.scrubbing || !audio.ready) return;
  const event = THUNDER_EVENTS.find((item) => hours >= item.hour && hours <= item.hour + 0.12);
  if (event) audio.triggerThunder(event.strength);
}

function advancePlayback(timestamp) {
  if (!state.playing || state.scrubbing) return;
  const delta = state.lastFrame ? Math.min(0.09, Math.max(0, (timestamp - state.lastFrame) / 1000)) : 0;
  if (delta <= 0) return;
  const previous = state.timeHours;
  const next = Math.min(TOTAL_HOURS, previous + delta * HOURS_PER_SECOND * SPEEDS[state.speedIndex]);
  state.timeHours = next;
  triggerThunderCrossings(previous, next);
  if (next >= TOTAL_HOURS) {
    state.playing = false;
    state.timeHours = TOTAL_HOURS;
    showNotice("24 小时回放结束", "muted");
  }
}

function animationLoop(timestamp) {
  advancePlayback(timestamp);
  state.lastFrame = timestamp;
  const snapshot = makeSnapshot();
  syncAudio(snapshot);
  renderSnapshot(snapshot, timestamp);
  requestAnimationFrame(animationLoop);
}

function hoursFromPointer(event) {
  const bounds = ui.timelineFrame.getBoundingClientRect();
  const amount = clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
  return amount * TOTAL_HOURS;
}

function updateTimelineCursor(event) {
  const bounds = ui.timelineFrame.getBoundingClientRect();
  const x = clamp(event.clientX - bounds.left, 0, bounds.width);
  ui.timelineCursor.style.left = `${x}px`;
}

function startTimelineDrag(event) {
  if (event.button !== undefined && event.button !== 0) return;
  event.preventDefault();
  hideHint();
  ui.timelineFrame.setPointerCapture(event.pointerId);
  ui.timelineFrame.classList.add("is-dragging");
  state.scrubbing = true;
  state.dragStartX = event.clientX;
  state.dragMoved = false;
  seek(hoursFromPointer(event), { scrub: true });
  updateTimelineCursor(event);
}

function moveTimelineDrag(event) {
  updateTimelineCursor(event);
  if (!state.scrubbing) return;
  if (Math.abs(event.clientX - state.dragStartX) > 4) state.dragMoved = true;
  seek(hoursFromPointer(event), { scrub: true });
}

function endTimelineDrag(event) {
  if (!state.scrubbing) return;
  const hours = hoursFromPointer(event);
  const clicked = !state.dragMoved;
  state.scrubbing = false;
  ui.timelineFrame.classList.remove("is-dragging");
  if (ui.timelineFrame.hasPointerCapture(event.pointerId)) {
    ui.timelineFrame.releasePointerCapture(event.pointerId);
  }
  seek(hours);
  if (clicked) {
    const anomaly = findAnomalyAt(hours);
    if (anomaly) toggleAnomaly(anomaly.id, { seek: false });
    else showNotice("播放头已定位；仅异常窗口可标记", "muted");
  }
  state.lastFrame = performance.now();
}

function cancelTimelineDrag(event) {
  if (!state.scrubbing) return;
  state.scrubbing = false;
  ui.timelineFrame.classList.remove("is-dragging");
  if (event.pointerId !== undefined && ui.timelineFrame.hasPointerCapture(event.pointerId)) {
    ui.timelineFrame.releasePointerCapture(event.pointerId);
  }
  update();
}

function markAtPlayhead() {
  const anomaly = findAnomalyAt(state.timeHours);
  if (!anomaly) {
    showNotice("当前不在异常窗口内", "muted");
    return false;
  }
  toggleAnomaly(anomaly.id, { seek: false });
  return true;
}

function cycleSpeed() {
  state.speedIndex = (state.speedIndex + 1) % SPEEDS.length;
  state.lastFrame = performance.now();
  update();
}

function toggleMute() {
  state.muted = !state.muted;
  audio.setMuted(state.muted);
  update();
}

function bindEvents() {
  ui.playBtn.addEventListener("click", () => {
    togglePlay();
    hideHint();
  });
  ui.rewindBtn.addEventListener("click", () => {
    seek(0, { scrub: false });
    state.lastFrame = performance.now();
    hideHint();
  });
  ui.playheadButton.addEventListener("click", () => {
    markAtPlayhead();
    hideHint();
  });
  ui.speedBtn.addEventListener("click", cycleSpeed);
  ui.muteBtn.addEventListener("click", toggleMute);
  ui.clearMarkersBtn.addEventListener("click", () => {
    state.markers = [];
    update();
    showNotice("疑点记录已清除", "muted");
  });

  ui.timelineFrame.addEventListener("pointerdown", startTimelineDrag);
  ui.timelineFrame.addEventListener("pointermove", moveTimelineDrag);
  ui.timelineFrame.addEventListener("pointerup", endTimelineDrag);
  ui.timelineFrame.addEventListener("pointercancel", cancelTimelineDrag);
  ui.timelineFrame.addEventListener("pointerleave", () => {
    if (!state.scrubbing) ui.timelineCursor.style.opacity = "0";
  });
  ui.timelineFrame.addEventListener("pointerenter", () => {
    ui.timelineCursor.style.opacity = "";
  });
  ui.timelineFrame.addEventListener("keydown", (event) => {
    if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
      event.preventDefault();
      const direction = event.code === "ArrowLeft" ? -1 : 1;
      seek(state.timeHours + direction * (event.shiftKey ? 1 : 0.25));
      hideHint();
    } else if (event.code === "Home") {
      event.preventDefault();
      seek(0);
    } else if (event.code === "End") {
      event.preventDefault();
      seek(TOTAL_HOURS);
    } else if (event.code === "Space") {
      event.preventDefault();
      togglePlay();
      hideHint();
    } else if (event.code === "Enter") {
      event.preventDefault();
      markAtPlayhead();
    }
  });

  document.addEventListener("keydown", (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest("button, input, textarea, select, [role='slider']")) return;
    if (event.code === "Space" && !event.repeat) {
      event.preventDefault();
      togglePlay();
      hideHint();
    } else if (event.code === "KeyM" && !event.repeat) {
      markAtPlayhead();
    } else if (event.code === "KeyS" && !event.repeat) {
      toggleMute();
    }
  });
}

function getSnapshot() {
  const snapshot = makeSnapshot();
  const d = snapshot.derived;
  return {
    timeHours: snapshot.timeHours,
    timeLabel: snapshot.timeLabel,
    playing: snapshot.playing,
    scrubbing: snapshot.scrubbing,
    speed: snapshot.speed,
    muted: snapshot.muted,
    rain: d.sample.rain,
    wind: d.sample.wind,
    rainNorm: d.rainNorm,
    pan: d.pan,
    volume: d.volume,
    cloudDensity: d.cloudDensity,
    riverGlow: d.riverGlow,
    cityBrightness: d.cityBrightness,
    thunder: d.thunder,
    anomalyId: d.anomaly?.id || null,
    markerCount: state.markers.length,
    markerIds: state.markers.map((marker) => marker.id),
    renderedTimeHours: state.lastRendered?.timeHours ?? null,
    renderedTimeLabel: state.lastRendered?.timeLabel ?? null,
    audioReady: audio.ready,
    audioState: audio.ctx?.state || "none",
    audioError: state.audioError,
    clockText: ui.bigClock.textContent,
    timelineText: ui.timelineReadout.textContent,
  };
}

function getSyncReport() {
  const snapshot = makeSnapshot();
  const metrics = audio.getMetrics();
  const expectedGain = snapshot.playing && !snapshot.muted ? 0.025 + snapshot.derived.volume * 0.23 : 0;
  const expectedPan = snapshot.derived.pan;
  const renderedDelta = state.lastRendered
    ? Math.abs(state.lastRendered.timeHours - snapshot.timeHours) / HOURS_PER_SECOND * 1000
    : 0;
  return {
    timeHours: snapshot.timeHours,
    timeLabel: snapshot.timeLabel,
    renderedTimeHours: state.lastRendered?.timeHours ?? null,
    renderedDeltaMs: renderedDelta,
    expectedGain,
    audioGainTarget: metrics.gainTarget,
    gainMatch: Math.abs(metrics.gainTarget - expectedGain) < 0.000001,
    expectedPan,
    audioPanTarget: metrics.panTarget,
    panMatch: Math.abs(metrics.panTarget - expectedPan) < 0.000001,
    clockMatch: ui.bigClock.textContent === snapshot.timeLabel,
    timelineMatch: ui.timelineReadout.textContent === `${snapshot.timeLabel} / 24:00`,
    audioReady: metrics.ready,
    audioState: metrics.state,
    thunderTriggers: metrics.thunderTriggers,
  };
}

function init() {
  renderAnomalies();
  renderMarkers();
  bindEvents();
  update();
  requestAnimationFrame(animationLoop);
}

window.rainTerrain = {
  play: () => setPlaying(true),
  pause: () => setPlaying(false),
  toggle: togglePlay,
  seek: (hours) => seek(hours),
  setTime: (hours) => seek(hours),
  toggleAnomaly,
  markAtPlayhead,
  clearMarkers: () => {
    state.markers = [];
    update();
  },
  setSpeed: (multiplier) => {
    const index = SPEEDS.indexOf(multiplier);
    if (index >= 0) state.speedIndex = index;
    update();
  },
  getSnapshot,
  getSyncReport,
  getAudioMetrics: () => audio.getMetrics(),
  getData: () => ({
    rain: RAIN_SAMPLE.slice(),
    wind: WIND_SAMPLE.slice(),
    thunder: THUNDER_EVENTS.map((event) => ({ ...event })),
    anomalies: ANOMALIES.map((anomaly) => ({ ...anomaly })),
  }),
};

init();
