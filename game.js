"use strict";

/* ================= 配置 ================= */
const TIME_SCALE = 8;            // 1 真实秒 = 8 游戏秒
const NIGHT_LENGTH = 20 * 60;    // 20 游戏分钟
const FRONT_WARN_T = 7 * 60;     // 冷锋预警时刻
const FRONT_START = 8 * 60;      // 冷锋开始
const FRONT_END = 13 * 60;       // 冷锋结束

const ZONE_DEFS = [
  { name: "叶菜区", plant: "leafy",    safe: [15, 28], ideal: [18, 24], hum: [40, 85], color: "#7ed491" },
  { name: "番茄区", plant: "tomato",   safe: [16, 30], ideal: [20, 28], hum: [35, 80], color: "#e88a7a" },
  { name: "幼苗区", plant: "seedling", safe: [18, 28], ideal: [22, 26], hum: [45, 85], color: "#b7e39a" },
];

const SIM = {
  heatLoss: 0.0028,        // 基础散热系数
  curtainSave: 0.6,        // 保温帘减少的散热比例
  windowLoss: 0.010,       // 开窗额外散热
  diffuse: 0.004,          // 跨区热扩散系数
  heaterPower: 0.09,       // 加热带升温速率
  heaterDrain: 0.022,      // 加热带每秒功率消耗
  toggleCost: 1.5,         // 每次切换设备的功率损耗
  humRise: 0.010,          // 湿度自然上升
  humVent: 0.09,           // 开窗降湿速率
  humHeat: 0.012,          // 加热降湿速率
};

/* ================= 状态 ================= */
const state = {
  running: false,
  over: false,
  win: false,
  t: 0,                    // 游戏秒
  power: 100,
  outside: 12,
  front: false,
  frontWarned: false,
  frontPassed: false,
  selected: 0,
  zones: [],
  snow: [],
  msg: "",
  msgT: 0,
};

function resetState() {
  state.running = true;
  state.over = false;
  state.win = false;
  state.t = 0;
  state.power = 100;
  state.outside = 12;
  state.front = false;
  state.frontWarned = false;
  state.frontPassed = false;
  state.selected = 0;
  state.msg = "";
  state.msgT = 0;
  state.snow = [];
  state.zones = ZONE_DEFS.map((d, i) => ({
    def: d,
    temp: 19 + i,               // 入夜初始余温
    humidity: 62,
    health: 100,
    heater: false,
    window: false,
    curtain: false,
    windowAnim: 0,
    curtainAnim: 0,
    heaterGlow: 0,
    alarm: false,
  }));
}

/* ================= 音频 ================= */
const AudioSys = {
  ctx: null,
  humOsc: null, humGain: null,
  windSrc: null, windGain: null, windFilter: null,
  alarmTimer: 0,

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();

    // 泵机/加热带低鸣
    this.humOsc = this.ctx.createOscillator();
    this.humOsc.type = "sawtooth";
    this.humOsc.frequency.value = 70;
    const humFilter = this.ctx.createBiquadFilter();
    humFilter.type = "lowpass";
    humFilter.frequency.value = 220;
    this.humGain = this.ctx.createGain();
    this.humGain.gain.value = 0;
    this.humOsc.connect(humFilter).connect(this.humGain).connect(this.ctx.destination);
    this.humOsc.start();

    // 风声（冷锋）
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.windSrc = this.ctx.createBufferSource();
    this.windSrc.buffer = buf;
    this.windSrc.loop = true;
    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = "bandpass";
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.6;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0;
    this.windSrc.connect(this.windFilter).connect(this.windGain).connect(this.ctx.destination);
    this.windSrc.start();
  },

  setHum(level) {   // 0..1 加热带开启比例
    if (!this.ctx) return;
    this.humGain.gain.setTargetAtTime(level * 0.10, this.ctx.currentTime, 0.15);
    this.humOsc.frequency.setTargetAtTime(60 + level * 30, this.ctx.currentTime, 0.2);
  },

  setWind(level) {  // 0..1 冷锋强度
    if (!this.ctx) return;
    this.windGain.gain.setTargetAtTime(level * 0.22, this.ctx.currentTime, 0.4);
    this.windFilter.frequency.setTargetAtTime(400 + level * 700, this.ctx.currentTime, 0.4);
  },

  click() {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "square";
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.08, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.08);
    o.connect(g).connect(this.ctx.destination);
    o.start();
    o.stop(this.ctx.currentTime + 0.09);
  },

  alarm(dt, active) {  // 有区域越限时哔哔
    if (!this.ctx) return;
    this.alarmTimer -= dt;
    if (active && this.alarmTimer <= 0) {
      this.alarmTimer = 0.9;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(1040, this.ctx.currentTime);
      o.frequency.setValueAtTime(780, this.ctx.currentTime + 0.12);
      g.gain.setValueAtTime(0.09, this.ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.25);
      o.connect(g).connect(this.ctx.destination);
      o.start();
      o.stop(this.ctx.currentTime + 0.26);
    }
  },
};

/* ================= 模拟 ================= */
function outsideTemp(t) {
  // 入夜基准降温：12°C -> 6°C
  let temp = 12 - 6 * (t / NIGHT_LENGTH);
  // 冷锋：快速俯冲到 -3°C，再缓慢回升
  if (t >= FRONT_START && t < FRONT_END) {
    const p = (t - FRONT_START) / (FRONT_END - FRONT_START);
    const dip = p < 0.4 ? p / 0.4 : 1 - (p - 0.4) / 0.6 * 0.55;
    temp -= 12 * dip;
  }
  return temp;
}

function frontIntensity(t) {
  if (t < FRONT_START || t >= FRONT_END) return 0;
  const p = (t - FRONT_START) / (FRONT_END - FRONT_START);
  return Math.sin(Math.PI * Math.min(1, p * 1.15));
}

function toggle(zone, key) {
  if (!state.running || state.over) return;
  if (key === "heater" && !zone.heater && state.power <= 0) {
    flashMsg("功率储备耗尽，加热带无法启动！");
    return;
  }
  zone[key] = !zone[key];
  state.power = Math.max(0, state.power - SIM.toggleCost);
  AudioSys.click();
}

function flashMsg(text) {
  state.msg = text;
  state.msgT = 2.5;
}

function update(dtReal) {
  if (!state.running || state.over) return;
  const dt = dtReal * TIME_SCALE;      // 游戏秒
  state.t += dt;
  state.outside = outsideTemp(state.t);

  // 冷锋事件流
  if (!state.frontWarned && state.t >= FRONT_WARN_T) {
    state.frontWarned = true;
    flashMsg("⚠ 气象警报：冷锋将在 1 分钟后抵达！");
  }
  if (!state.front && state.t >= FRONT_START && state.t < FRONT_END) {
    state.front = true;
    flashMsg("❄ 冷锋过境！外界温度骤降，抓紧保温！");
  }
  if (state.front && state.t >= FRONT_END) {
    state.front = false;
    state.frontPassed = true;
    flashMsg("✔ 冷锋已过，坚持到天亮！");
  }

  const wind = frontIntensity(state.t);
  AudioSys.setWind(wind);

  // 逐区更新
  let heatersOn = 0;
  for (const z of state.zones) {
    // 散热：基础 + 风冷，保温帘减免，开窗加剧
    let lossK = SIM.heatLoss * (1 + wind * 1.3);
    if (z.curtain) lossK *= 1 - SIM.curtainSave;
    if (z.window) lossK += SIM.windowLoss * (1 + wind);
    z.temp += (state.outside - z.temp) * lossK * dt;

    // 加热带
    if (z.heater) {
      if (state.power > 0) {
        z.temp += SIM.heaterPower * dt;
        state.power = Math.max(0, state.power - SIM.heaterDrain * dt);
        heatersOn++;
      } else {
        z.heater = false;
        flashMsg("功率耗尽，加热带已停机！");
      }
    }

    // 湿度
    z.humidity += SIM.humRise * dt;
    if (z.heater) z.humidity -= SIM.humHeat * dt;
    if (z.window) z.humidity -= SIM.humVent * dt;
    z.humidity = Math.max(15, Math.min(98, z.humidity));

    // 动画插值
    const speed = dtReal * 4;
    z.windowAnim += ((z.window ? 1 : 0) - z.windowAnim) * Math.min(1, speed);
    z.curtainAnim += ((z.curtain ? 1 : 0) - z.curtainAnim) * Math.min(1, speed);
    z.heaterGlow += ((z.heater ? 1 : 0) - z.heaterGlow) * Math.min(1, speed);
  }

  // 跨区热扩散（线性排列：0-1-2）
  for (let i = 0; i < state.zones.length - 1; i++) {
    const a = state.zones[i], b = state.zones[i + 1];
    const flow = (a.temp - b.temp) * SIM.diffuse * dt;
    a.temp -= flow;
    b.temp += flow;
  }

  // 健康与警报
  let anyAlarm = false;
  for (const z of state.zones) {
    const [lo, hi] = z.def.safe;
    let stress = 0;
    if (z.temp < lo) stress += (lo - z.temp) * 0.9;
    if (z.temp > hi) stress += (z.temp - hi) * 0.9;
    const [hLo, hHi] = z.def.hum;
    if (z.humidity < hLo) stress += (hLo - z.humidity) * 0.10;
    if (z.humidity > hHi) stress += (z.humidity - hHi) * 0.12;
    z.alarm = stress > 0.4;
    if (z.alarm) anyAlarm = true;
    if (stress > 0) {
      z.health = Math.max(0, z.health - stress * dt * 0.045);
    } else {
      z.health = Math.min(100, z.health + dt * 0.3);  // 缓慢恢复
    }
    if (z.health <= 0) return endGame(false, `${z.def.name}的作物全部枯死……`);
  }
  AudioSys.alarm(dtReal, anyAlarm);
  AudioSys.setHum(heatersOn / state.zones.length);

  if (state.msgT > 0) state.msgT -= dtReal;

  // 胜利判定
  if (state.t >= NIGHT_LENGTH) {
    endGame(true, "你守住了整座温室，所有作物安然迎来清晨！");
  }
}

function endGame(win, text) {
  state.over = true;
  state.win = win;
  state.running = false;
  AudioSys.setHum(0);
  AudioSys.setWind(0);
  showOverlay(win ? "🌅 守夜成功" : "🥀 守夜失败", text, "再来一夜");
}

/* ================= 渲染 ================= */
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const W = canvas.width, H = canvas.height;
const GROUND = 430;
const ZONE_W = 300;
const ZONE_X = i => 30 + i * ZONE_W;

function tempColor(t) {
  // 蓝(冷) -> 绿(适) -> 红(热)
  const c = Math.max(-5, Math.min(40, t));
  const p = (c + 5) / 45;
  const r = Math.round(60 + 195 * Math.max(0, p - 0.45) * 1.8);
  const g = Math.round(80 + 140 * (1 - Math.abs(p - 0.5) * 2));
  const b = Math.round(120 + 135 * Math.max(0, 0.55 - p) * 1.8);
  return `rgb(${Math.min(255, r)},${Math.min(255, g)},${Math.min(255, b)})`;
}

function draw() {
  const wind = frontIntensity(state.t);
  // 天空
  const sky = ctx.createLinearGradient(0, 0, 0, GROUND);
  if (state.front) {
    sky.addColorStop(0, "#0a1226");
    sky.addColorStop(1, "#1b2b47");
  } else {
    sky.addColorStop(0, "#070c1d");
    sky.addColorStop(1, "#152238");
  }
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, GROUND);

  // 星月
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  for (let i = 0; i < 40; i++) {
    const sx = (i * 173) % W, sy = (i * 97) % 180;
    ctx.globalAlpha = state.front ? 0.15 : 0.3 + (i % 5) * 0.12;
    ctx.fillRect(sx, sy, 2, 2);
  }
  ctx.globalAlpha = state.front ? 0.25 : 0.9;
  ctx.beginPath();
  ctx.arc(880, 60, 26, 0, Math.PI * 2);
  ctx.fillStyle = "#e8ecda";
  ctx.fill();
  ctx.globalAlpha = 1;

  // 冷锋云带
  if (wind > 0) {
    ctx.fillStyle = `rgba(70,90,130,${0.45 * wind})`;
    for (let i = 0; i < 5; i++) {
      const cx = ((state.t * 6 + i * 260) % (W + 300)) - 150;
      ctx.beginPath();
      ctx.ellipse(cx, 50 + i * 22, 150, 26, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawGreenhouse(wind);
  drawSnow(wind);

  // 提示消息
  if (state.msgT > 0) {
    ctx.font = "bold 18px sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(W / 2 - 250, H - 46, 500, 32);
    ctx.fillStyle = "#ffe9a8";
    ctx.fillText(state.msg, W / 2, H - 24);
  }
}

function drawGreenhouse(wind) {
  // 大地
  ctx.fillStyle = "#1a2416";
  ctx.fillRect(0, GROUND, W, H - GROUND);

  // 玻璃拱顶（剖面）
  ctx.strokeStyle = "rgba(150,190,235,0.85)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(20, GROUND);
  ctx.lineTo(20, 240);
  ctx.quadraticCurveTo(W / 2, 60, W - 20, 240);
  ctx.lineTo(W - 20, GROUND);
  ctx.stroke();
  ctx.fillStyle = "rgba(120,160,220,0.06)";
  ctx.fill();

  // 分区立柱
  ctx.strokeStyle = "rgba(150,190,235,0.4)";
  ctx.lineWidth = 2;
  for (let i = 1; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(ZONE_X(i), GROUND);
    ctx.lineTo(ZONE_X(i), 250);
    ctx.stroke();
  }

  for (let i = 0; i < 3; i++) drawZone(i, wind);
}

function drawZone(i, wind) {
  const z = state.zones[i];
  if (!z) return;
  const x = ZONE_X(i), cx = x + ZONE_W / 2;

  // 热区氛围
  const heat = ctx.createRadialGradient(cx, GROUND - 30, 20, cx, GROUND - 30, 190);
  heat.addColorStop(0, tempColor(z.temp).replace("rgb", "rgba").replace(")", ",0.30)"));
  heat.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = heat;
  ctx.fillRect(x - 20, GROUND - 240, ZONE_W + 40, 240);

  // 种植床
  ctx.fillStyle = "#3a2c1c";
  ctx.fillRect(x + 20, GROUND - 26, ZONE_W - 40, 26);
  ctx.fillStyle = "#54402a";
  ctx.fillRect(x + 20, GROUND - 26, ZONE_W - 40, 6);

  // 加热带（床底发光）
  if (z.heaterGlow > 0.02) {
    ctx.save();
    ctx.shadowColor = "#ff7a3c";
    ctx.shadowBlur = 18 * z.heaterGlow;
    ctx.strokeStyle = `rgba(255,${120 + Math.round(80 * z.heaterGlow)},60,${0.9 * z.heaterGlow})`;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x + 26, GROUND - 4);
    ctx.lineTo(x + ZONE_W - 26, GROUND - 4);
    ctx.stroke();
    ctx.restore();
  }

  drawPlants(z, x);

  // 保温帘（自拱顶垂下的棉被）
  if (z.curtainAnim > 0.02) {
    const drop = z.curtainAnim * 150;
    ctx.fillStyle = `rgba(214,190,150,${0.5 * z.curtainAnim})`;
    ctx.fillRect(x + 8, 250 - drop * 0.3, ZONE_W - 16, drop);
    ctx.strokeStyle = `rgba(160,140,100,${0.6 * z.curtainAnim})`;
    for (let k = 1; k < 6; k++) {
      ctx.beginPath();
      ctx.moveTo(x + 8 + k * (ZONE_W - 16) / 6, 250 - drop * 0.3);
      ctx.lineTo(x + 8 + k * (ZONE_W - 16) / 6, 250 - drop * 0.3 + drop);
      ctx.stroke();
    }
  }

  // 通风窗（侧墙翻窗）
  const wx = i === 0 ? 24 : i === 2 ? W - 24 : x + ZONE_W - 4;
  const dir = i === 0 ? 1 : -1;
  ctx.save();
  ctx.translate(wx, 300);
  ctx.rotate(dir * z.windowAnim * -1.1);
  ctx.fillStyle = "rgba(140,180,230,0.55)";
  ctx.fillRect(0, -50, 8, 100);
  ctx.restore();
  if (z.windowAnim > 0.1) {  // 气流线
    ctx.strokeStyle = `rgba(170,210,255,${0.5 * z.windowAnim})`;
    ctx.lineWidth = 1.5;
    for (let k = 0; k < 3; k++) {
      const yy = 270 + k * 30;
      const off = (state.t * 30 + k * 40) % 60;
      ctx.beginPath();
      ctx.moveTo(wx + dir * (14 + off), yy);
      ctx.quadraticCurveTo(wx + dir * (34 + off), yy - 8, wx + dir * (54 + off), yy);
      ctx.stroke();
    }
  }

  // 区名与温度
  ctx.textAlign = "center";
  ctx.font = "bold 15px sans-serif";
  ctx.fillStyle = z.def.color;
  ctx.fillText(z.def.name, cx, 278);
  ctx.font = "bold 22px monospace";
  ctx.fillStyle = tempColor(z.temp);
  ctx.fillText(z.temp.toFixed(1) + "°C", cx, 304);
  ctx.font = "12px sans-serif";
  ctx.fillStyle = "#9fb2d8";
  ctx.fillText(`适温 ${z.def.safe[0]}~${z.def.safe[1]}°C · 湿度 ${Math.round(z.humidity)}%`, cx, 322);
  if (z.alarm) {
    ctx.fillStyle = Math.floor(state.t / 4) % 2 ? "#ff5b5b" : "#ffb1b1";
    ctx.font = "bold 13px sans-serif";
    ctx.fillText("⚠ 胁迫中", cx, 342);
  }
}

function drawPlants(z, x) {
  const health = z.health / 100;
  const wilt = 1 - health;                    // 0 健康 -> 1 枯萎
  const sway = Math.sin(state.t * 0.15 + x) * 2 * frontIntensity(state.t);
  const green = (g) => {
    const r = Math.round(90 + wilt * 90);
    const gg = Math.round(g * (0.45 + 0.55 * health));
    return `rgb(${r},${gg},70)`;
  };

  for (let p = 0; p < 5; p++) {
    const px = x + 50 + p * (ZONE_W - 100) / 4 + sway;
    const base = GROUND - 26;
    ctx.strokeStyle = green(150);
    ctx.fillStyle = green(170);
    ctx.lineWidth = 2;

    if (z.def.plant === "leafy") {
      // 叶菜：低矮莲座叶
      for (let l = 0; l < 6; l++) {
        const ang = -Math.PI / 2 + (l - 2.5) * 0.5 + wilt * (l % 2 ? 0.5 : -0.5);
        const len = (14 + (l % 3) * 5) * (1 - wilt * 0.4);
        ctx.beginPath();
        ctx.ellipse(px + Math.cos(ang) * len * 0.6, base + Math.sin(ang) * len * 0.6,
          len * 0.55, 5, ang, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (z.def.plant === "tomato") {
      // 番茄：高茎 + 果实
      const h = 66 * (1 - wilt * 0.35);
      ctx.beginPath();
      ctx.moveTo(px, base);
      ctx.quadraticCurveTo(px + wilt * 14, base - h * 0.6, px + wilt * 22, base - h);
      ctx.stroke();
      for (let l = 0; l < 4; l++) {
        const ly = base - 14 - l * 13;
        ctx.beginPath();
        ctx.ellipse(px + (l % 2 ? 9 : -9) + wilt * l * 4, ly, 9, 3.5, l % 2 ? 0.4 : -0.4, 0, Math.PI * 2);
        ctx.fill();
      }
      if (health > 0.25) {
        ctx.fillStyle = health > 0.6 ? "#e2544a" : "#9c5b4a";
        for (let f = 0; f < 3; f++) {
          ctx.beginPath();
          ctx.arc(px + (f - 1) * 10 + wilt * 10, base - 24 - f * 12, 4.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else {
      // 幼苗：两片子叶
      const h = 18 * (1 - wilt * 0.5);
      ctx.beginPath();
      ctx.moveTo(px, base);
      ctx.lineTo(px + wilt * 6, base - h);
      ctx.stroke();
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(px + wilt * 6 + s * 6, base - h, 6, 3, s * (0.5 + wilt * 0.7), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function drawSnow(wind) {
  if (wind <= 0.02) { state.snow.length = 0; return; }
  while (state.snow.length < 140 * wind) {
    state.snow.push({ x: Math.random() * W, y: Math.random() * GROUND, s: 1 + Math.random() * 2 });
  }
  ctx.fillStyle = "rgba(230,240,255,0.85)";
  for (const f of state.snow) {
    f.x += (2 + f.s) * wind * 3;
    f.y += f.s * 1.6;
    if (f.x > W) f.x -= W;
    if (f.y > GROUND) { f.y = 0; f.x = Math.random() * W; }
    ctx.fillRect(f.x, f.y, f.s, f.s);
  }
}

/* ================= HUD 与控制面板 ================= */
const hudTime = document.getElementById("hud-time");
const hudOutside = document.getElementById("hud-outside");
const hudPower = document.getElementById("hud-power");
const banner = document.getElementById("banner");
const panelsEl = document.getElementById("panels");
const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlay-title");
const overlayText = document.getElementById("overlay-text");
const startBtn = document.getElementById("start-btn");

function buildPanels() {
  panelsEl.innerHTML = "";
  ZONE_DEFS.forEach((d, i) => {
    const el = document.createElement("div");
    el.className = "zone-panel";
    el.id = `panel-${i}`;
    el.innerHTML = `
      <h3>${d.name}<span class="key-hint">按 ${i + 1} 选中</span></h3>
      <div class="meter"><label>温度</label><div class="bar"><i id="tbar-${i}"></i></div><span class="val" id="tval-${i}"></span></div>
      <div class="meter"><label>湿度</label><div class="bar"><i id="hbar-${i}"></i></div><span class="val" id="hval-${i}"></span></div>
      <div class="meter"><label>健康</label><div class="bar"><i id="pbar-${i}"></i></div><span class="val" id="pval-${i}"></span></div>
      <div class="toggles">
        <button id="btn-h-${i}">加热带 [H]</button>
        <button id="btn-w-${i}">通风窗 [W]</button>
        <button id="btn-c-${i}">保温帘 [C]</button>
      </div>`;
    panelsEl.appendChild(el);
    el.addEventListener("click", () => { state.selected = i; });
    document.getElementById(`btn-h-${i}`).addEventListener("click", () => toggle(state.zones[i], "heater"));
    document.getElementById(`btn-w-${i}`).addEventListener("click", () => toggle(state.zones[i], "window"));
    document.getElementById(`btn-c-${i}`).addEventListener("click", () => toggle(state.zones[i], "curtain"));
  });
}

function setBar(id, pct, color) {
  const el = document.getElementById(id);
  el.style.width = Math.max(0, Math.min(100, pct)) + "%";
  el.style.background = color;
}

function updateHud() {
  const mins = Math.floor(state.t / 60);
  const clockMin = 20 * 60 + mins;   // 从 20:00 开始
  const remain = Math.max(0, NIGHT_LENGTH - state.t);
  hudTime.textContent = `🌙 ${Math.floor(clockMin / 60)}:${String(clockMin % 60).padStart(2, "0")}` +
    `  剩余 ${Math.floor(remain / 60)}:${String(Math.floor(remain % 60)).padStart(2, "0")}`;
  hudOutside.textContent = `外界 ${state.outside.toFixed(1)}°C`;
  hudOutside.classList.toggle("cold", state.outside < 4);
  hudPower.textContent = `⚡ 功率储备 ${Math.round(state.power)}%`;
  hudPower.classList.toggle("low", state.power < 25);

  if (state.front) {
    banner.textContent = "❄ 冷锋过境中 ❄";
    banner.classList.remove("hidden", "warn");
  } else if (state.frontWarned && state.t < FRONT_START) {
    banner.textContent = `⚠ 冷锋 ${Math.ceil((FRONT_START - state.t) / 60)} 分钟后抵达`;
    banner.classList.remove("hidden");
    banner.classList.add("warn");
  } else {
    banner.classList.add("hidden");
  }

  state.zones.forEach((z, i) => {
    const [lo, hi] = z.def.safe;
    const inSafe = z.temp >= lo && z.temp <= hi;
    setBar(`tbar-${i}`, (z.temp + 5) / 45 * 100, tempColor(z.temp));
    const tv = document.getElementById(`tval-${i}`);
    tv.textContent = z.temp.toFixed(1) + "°C";
    tv.classList.toggle("bad", !inSafe);
    const [hLo, hHi] = z.def.hum;
    const humBad = z.humidity < hLo || z.humidity > hHi;
    setBar(`hbar-${i}`, z.humidity, humBad ? "#d98a4a" : "#5a9bd4");
    const hv = document.getElementById(`hval-${i}`);
    hv.textContent = Math.round(z.humidity) + "%";
    hv.classList.toggle("bad", humBad);
    setBar(`pbar-${i}`, z.health, z.health > 60 ? "#6fbf6f" : z.health > 30 ? "#d9b44a" : "#d95a5a");
    document.getElementById(`pval-${i}`).textContent = Math.round(z.health) + "%";

    document.getElementById(`panel-${i}`).classList.toggle("selected", state.selected === i);
    document.getElementById(`btn-h-${i}`).classList.toggle("on", z.heater);
    document.getElementById(`btn-w-${i}`).classList.toggle("on", z.window);
    document.getElementById(`btn-c-${i}`).classList.toggle("on", z.curtain);
  });
}

/* ================= 输入 ================= */
window.addEventListener("keydown", (e) => {
  if (e.key >= "1" && e.key <= "3") { state.selected = Number(e.key) - 1; return; }
  const z = state.zones[state.selected];
  if (!z) return;
  const k = e.key.toLowerCase();
  if (k === "h") toggle(z, "heater");
  if (k === "w") toggle(z, "window");
  if (k === "c") toggle(z, "curtain");
});

/* ================= 覆盖层与主循环 ================= */
function showOverlay(title, text, btnText) {
  overlayTitle.textContent = title;
  overlayText.innerHTML = text;
  startBtn.textContent = btnText;
  overlay.classList.remove("hidden");
}

startBtn.addEventListener("click", () => {
  AudioSys.init();
  if (AudioSys.ctx.state === "suspended") AudioSys.ctx.resume();
  resetState();
  overlay.classList.add("hidden");
});

let last = performance.now();
function loop(now) {
  const dtReal = Math.min(0.1, (now - last) / 1000);
  last = now;
  update(dtReal);
  draw();
  updateHud();
  requestAnimationFrame(loop);
}

resetState();
state.running = false;
buildPanels();
requestAnimationFrame(loop);
