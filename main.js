'use strict';

/* ================= 配置 ================= */
const CFG = {
  L: 1000,          // 索道跨度 (m)
  V_MAX: 22,        // 空载巡航速度 (m/s)
  A_ACC: 1.2,       // 加速度 (m/s^2)
  A_BRAKE: 1.6,     // 正常刹车减速度 (m/s^2)
  STOP_GAP: 40,     // 停靠排队间距 (m)
  COLL_DIST: 18,    // 追尾判定距离 (m)
  POD_COUNT: 3,     // 3 个吊舱 = 3 次往返
  WEAR_BASE: 0.15,  // 满载全速磨损 (%/s)
  DUST_BRAKE: 0.55, // 微尘最大刹车衰减比例
  EMPTY_LOAD: 0.3,  // 返程空载系数
  TIME_LIMIT: 1200, // 任务超时 (s)
};

/* ================= 固定 seed 随机数 ================= */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* 由 seed 生成任务：陨石微尘风暴时间表 + 设备批次 */
function genMission(seed) {
  const rnd = mulberry32(seed);
  const storms = [];
  const n = 2 + Math.floor(rnd() * 2); // 2~3 场风暴
  for (let i = 0; i < n; i++) {
    storms.push({
      start: 30 + rnd() * 220,
      dur: 18 + rnd() * 30,
      intensity: 0.45 + rnd() * 0.55,
    });
  }
  storms.sort((a, b) => a.start - b.start);
  const batches = [];
  for (let i = 0; i < CFG.POD_COUNT; i++) batches.push(0.85 + rnd() * 0.3);
  return { storms, batches };
}

/* ================= 模拟 ================= */
function createSim(params) {
  const sim = {
    params,
    mission: genMission(params.seed),
    t: 0,
    pods: [],
    wear: 0,
    delivered: 0,
    dust: 0,
    brakeFactor: 1,
    tension: 0,
    nextLaunch: 0,
    emergency: false,
    estopTimer: 0,
    estopDone: false,
    over: false,
    success: false,
    fail: null,
    events: [],
  };
  for (let i = 0; i < CFG.POD_COUNT; i++) {
    sim.pods.push({
      id: i, state: 'idle', s: 0, v: 0, dir: 1,
      dwell: 0, loaded: true, batch: sim.mission.batches[i],
    });
  }
  return sim;
}

function simLog(sim, msg, cls) {
  sim.events.push({ t: sim.t, msg, cls: cls || '' });
}

/* 吊舱在停靠队列中的名次（决定停靠点） */
function rankOf(sim, pod) {
  let r = 0;
  for (const q of sim.pods) {
    if (q === pod) continue;
    if (pod.dir === 1) {
      if (q.state === 'dwellB') r++;
      else if (q.state === 'out' && (q.s > pod.s || (q.s === pod.s && q.id < pod.id))) r++;
    } else {
      if (q.state === 'dwellA') r++;
      else if (q.state === 'back' && (q.s < pod.s || (q.s === pod.s && q.id < pod.id))) r++;
    }
  }
  return r;
}

function effLoad(sim, pod) {
  return pod.loaded ? sim.params.load * pod.batch : CFG.EMPTY_LOAD;
}

function dustAt(sim, t) {
  let d = 0;
  for (const st of sim.mission.storms) {
    if (t >= st.start && t <= st.start + st.dur) d = Math.max(d, st.intensity);
  }
  return d;
}

function tryDispatch(sim) {
  if (sim.emergency) return;
  if (sim.t < sim.nextLaunch) return;
  const pod = sim.pods.find(p => p.state === 'idle');
  if (!pod) return;
  // A 站附近被返程吊舱占用时暂缓发车
  for (const q of sim.pods) {
    if ((q.state === 'back' || q.state === 'dwellA') && q.s < 90) return;
    if (q.state === 'out' && q.s < CFG.STOP_GAP + 5) return;
  }
  pod.state = 'out';
  pod.dir = 1;
  pod.s = 0; pod.v = 0;
  sim.nextLaunch = sim.t + sim.params.interval;
  simLog(sim, `吊舱 ${pod.id + 1} 发车（载重 ${(sim.params.load * pod.batch).toFixed(2)}）`);
}

function stepSim(sim, dt) {
  if (sim.over) return;
  sim.t += dt;

  // 微尘风暴 -> 刹车衰减
  const prevDust = sim.dust;
  sim.dust = dustAt(sim, sim.t);
  sim.brakeFactor = 1 - CFG.DUST_BRAKE * sim.dust;
  if (sim.dust > 0 && prevDust === 0) simLog(sim, '⚠ 陨石微尘来袭，刹车效能下降！', 'warn');
  if (sim.dust === 0 && prevDust > 0) simLog(sim, '微尘消散，刹车恢复。');

  // 急停计时（松开 ≥0.8s 后记为一次安全急停）
  if (sim.emergency) sim.estopTimer += dt;
  else {
    if (sim.estopTimer > 0.8 && !sim.estopDone) {
      sim.estopDone = true;
      simLog(sim, '✔ 安全急停完成', 'ok');
    }
    sim.estopTimer = 0;
  }

  tryDispatch(sim);

  const aBrake = CFG.A_BRAKE * sim.brakeFactor;
  let tensionSum = 0, moving = 0;

  for (const pod of sim.pods) {
    if (pod.state === 'dwellB' || pod.state === 'dwellA') {
      pod.dwell -= dt;
      if (pod.dwell <= 0) {
        if (pod.state === 'dwellB') {
          pod.state = 'back'; pod.dir = -1; pod.loaded = false;
          sim.delivered++;
          simLog(sim, `吊舱 ${pod.id + 1} 在 B 穹顶卸货（已交付 ${sim.delivered}/3），开始返程`);
        } else {
          pod.state = 'done';
          simLog(sim, `吊舱 ${pod.id + 1} 返回 A 穹顶，本次往返完成`, 'ok');
        }
      }
      continue;
    }
    if (pod.state !== 'out' && pod.state !== 'back') continue;

    const load = effLoad(sim, pod);
    const vCruise = CFG.V_MAX / (1 + 0.9 * Math.max(0, load - 1));

    if (sim.emergency) {
      pod.v = Math.max(0, pod.v - aBrake * dt);
    } else {
      const rank = rankOf(sim, pod);
      const stopPos = pod.dir === 1 ? CFG.L - rank * CFG.STOP_GAP : rank * CFG.STOP_GAP;
      const d = (stopPos - pod.s) * pod.dir;
      if (d <= 0.6 && pod.v <= 0.8) {
        pod.s = stopPos; pod.v = 0;
        pod.state = pod.dir === 1 ? 'dwellB' : 'dwellA';
        pod.dwell = sim.params.dwell;
        continue;
      }
      const dReq = (pod.v * pod.v) / (2 * aBrake) + pod.v * 0.3;
      if (pod.v > 0 && d <= dReq) pod.v = Math.max(0, pod.v - aBrake * dt);
      else if (pod.v < vCruise) pod.v = Math.min(vCruise, pod.v + CFG.A_ACC * dt);
    }
    pod.s += pod.dir * pod.v * dt;
    if (pod.s < 0) pod.s = 0;
    if (pod.s > CFG.L) pod.s = CFG.L;

    // 磨损：过载平方放大
    sim.wear += CFG.WEAR_BASE * load * load * (pod.v / CFG.V_MAX) * dt;
    tensionSum += load * (0.35 + 0.65 * pod.v / CFG.V_MAX);
    moving++;
  }
  sim.tension = moving ? tensionSum / moving : 0;

  // 追尾检测：同向一组（去程/停靠B、返程/停靠A）
  const groups = [
    sim.pods.filter(p => p.state === 'out' || p.state === 'dwellB'),
    sim.pods.filter(p => p.state === 'back' || p.state === 'dwellA'),
  ];
  for (const g of groups) {
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) {
        if (g[i].state.startsWith('dwell') && g[j].state.startsWith('dwell')) continue;
        if (Math.abs(g[i].s - g[j].s) < CFG.COLL_DIST) {
          sim.over = true; sim.fail = '追尾碰撞';
          simLog(sim, `✖ 吊舱 ${g[i].id + 1} 与 ${g[j].id + 1} 追尾！任务失败`, 'bad');
          return;
        }
      }
    }
  }

  if (sim.wear >= 100) {
    sim.over = true; sim.fail = '绳索磨损断裂';
    simLog(sim, '✖ 绳索磨损达到 100%，索道断裂！任务失败', 'bad');
    return;
  }
  if (sim.t > CFG.TIME_LIMIT) {
    sim.over = true; sim.fail = '任务超时';
    simLog(sim, '✖ 超出任务时限', 'bad');
    return;
  }
  if (sim.delivered === CFG.POD_COUNT && sim.pods.every(p => p.state === 'done')) {
    sim.over = true; sim.success = true;
    simLog(sim, '★ 全部设备送达，3 次往返完成！', 'ok');
  }
}

/* 无头快速校验一个班次是否可行 */
function validateSchedule(params) {
  const sim = createSim(params);
  while (!sim.over) stepSim(sim, 0.05);
  return {
    ok: sim.success,
    fail: sim.fail,
    wear: sim.wear,
    time: sim.t,
    estopPossible: true,
  };
}

/* ================= 渲染 ================= */
const VIEW = {
  W: 960, H: 540,
  groundY: 470,
  ax: 110, bx: 850,   // 两穹顶中心 x
  cableY: 400,        // 索道两端高度
};

function sToX(s) { return VIEW.ax + (s / CFG.L) * (VIEW.bx - VIEW.ax); }

function cablePoint(x, tension) {
  const sag = 34 - Math.min(1, tension) * 14;
  const u = (x - VIEW.ax) / (VIEW.bx - VIEW.ax);
  return VIEW.cableY + sag * Math.sin(Math.PI * Math.max(0, Math.min(1, u)));
}

function makeScenery(seed) {
  const rnd = mulberry32(seed ^ 0x9e3779b9);
  const stars = [];
  for (let i = 0; i < 90; i++) {
    stars.push({ x: rnd() * VIEW.W, y: rnd() * 330, r: rnd() * 1.4 + 0.3, a: 0.3 + rnd() * 0.7 });
  }
  const craters = [];
  for (let i = 0; i < 14; i++) {
    craters.push({ x: rnd() * VIEW.W, y: VIEW.groundY + 8 + rnd() * 55, rx: 12 + rnd() * 34, ry: 3 + rnd() * 7 });
  }
  return { stars, craters };
}

function drawDome(ctx, x, label) {
  const gy = VIEW.groundY, r = 58;
  // 阴影
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(x + 26, gy + 4, r * 1.15, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  // 穹顶
  const grad = ctx.createLinearGradient(x - r, gy - r, x + r, gy);
  grad.addColorStop(0, '#9fb4d8');
  grad.addColorStop(1, '#4a5878');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, gy, r, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#c8d6f2';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // 网格
  ctx.strokeStyle = 'rgba(20,28,50,0.5)';
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.arc(x, gy, (r * i) / 4, Math.PI, 0);
    ctx.stroke();
  }
  // 塔架
  ctx.strokeStyle = '#8fa2c8';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x, gy - r);
  ctx.lineTo(x, VIEW.cableY);
  ctx.stroke();
  ctx.fillStyle = '#eef2ff';
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, x, gy - r - 8);
}

function drawPod(ctx, sim, pod, tension) {
  if (pod.state === 'idle' || pod.state === 'done') return;
  const x = sToX(pod.s);
  const strandOffset = pod.dir === 1 ? 0 : 9; // 复线：返程画在下方一股
  const cy = cablePoint(x, tension) + strandOffset;
  // 月面阴影
  const h = VIEW.groundY - cy;
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  ctx.beginPath();
  ctx.ellipse(x + 20, VIEW.groundY + 3, 16 + h * 0.02, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  // 吊索 + 吊舱
  ctx.strokeStyle = '#aab8d8';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, cy);
  ctx.lineTo(x, cy + 12);
  ctx.stroke();
  const load = effLoad(sim, pod);
  ctx.fillStyle = pod.loaded ? '#e8b45a' : '#6f88b8';
  ctx.strokeStyle = '#1a2238';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.rect(x - 11, cy + 12, 22, 15);
  ctx.fill();
  ctx.stroke();
  // 载重指示
  ctx.fillStyle = '#0b0e1a';
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(load.toFixed(1), x, cy + 23);
  // 编号
  ctx.fillStyle = '#eef2ff';
  ctx.font = '10px sans-serif';
  ctx.fillText(String(pod.id + 1), x, cy - 4);
  // 速度矢量
  if (pod.v > 0.5) {
    ctx.strokeStyle = '#7dffb0';
    ctx.beginPath();
    ctx.moveTo(x, cy + 34);
    ctx.lineTo(x + pod.dir * pod.v * 1.6, cy + 34);
    ctx.stroke();
  }
}

function render(ctx, sim, scenery, dustParts) {
  const { W, H, groundY } = VIEW;
  // 天空
  const sky = ctx.createLinearGradient(0, 0, 0, groundY);
  sky.addColorStop(0, '#03040a');
  sky.addColorStop(1, '#101528');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, groundY);
  // 星空
  for (const st of scenery.stars) {
    ctx.globalAlpha = st.a;
    ctx.fillStyle = '#dfe6f5';
    ctx.fillRect(st.x, st.y, st.r, st.r);
  }
  ctx.globalAlpha = 1;
  // 地球（远景点缀）
  ctx.fillStyle = '#3f6fd8';
  ctx.beginPath();
  ctx.arc(830, 70, 16, 0, Math.PI * 2);
  ctx.fill();
  // 月面
  const gnd = ctx.createLinearGradient(0, groundY, 0, H);
  gnd.addColorStop(0, '#8a8f9e');
  gnd.addColorStop(1, '#5a5e6c');
  ctx.fillStyle = gnd;
  ctx.fillRect(0, groundY, W, H - groundY);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  for (const c of scenery.craters) {
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, c.rx, c.ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // 穹顶
  drawDome(ctx, VIEW.ax, '穹顶 A · 出发');
  drawDome(ctx, VIEW.bx, '穹顶 B · 卸货');
  // 索道（双股）
  ctx.strokeStyle = sim.wear > 70 ? '#ff9d7d' : '#c8d6f2';
  ctx.lineWidth = 2;
  for (const off of [0, 9]) {
    ctx.beginPath();
    for (let x = VIEW.ax; x <= VIEW.bx; x += 10) {
      const y = cablePoint(x, sim.tension) + off;
      if (x === VIEW.ax) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // 吊舱
  for (const pod of sim.pods) drawPod(ctx, sim, pod, sim.tension);
  // 陨石微尘
  if (sim.dust > 0) {
    ctx.fillStyle = `rgba(210,190,150,${0.05 + sim.dust * 0.10})`;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(220,200,160,0.7)';
    for (const p of dustParts) {
      ctx.globalAlpha = p.a * sim.dust;
      ctx.fillRect(p.x, p.y, p.r, p.r);
    }
    ctx.globalAlpha = 1;
  }
  // 急停指示
  if (sim.emergency) {
    ctx.fillStyle = 'rgba(255,60,60,0.9)';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('!! 急停中 !!', W / 2, 40);
  }
}

/* ================= 音效：随张力与速度变化 ================= */
const audio = {
  ctx: null, master: null, hum: null, humGain: null,
  wind: null, windGain: null, windFilter: null, dustGain: null,
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(this.ctx.destination);
    // 索道张力低鸣
    this.hum = this.ctx.createOscillator();
    this.hum.type = 'sawtooth';
    this.hum.frequency.value = 45;
    this.humGain = this.ctx.createGain();
    this.humGain.gain.value = 0;
    this.hum.connect(this.humGain).connect(this.master);
    this.hum.start();
    // 风噪（速度）与微尘噪
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.wind = this.ctx.createBufferSource();
    this.wind.buffer = buf;
    this.wind.loop = true;
    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 400;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0;
    this.wind.connect(this.windFilter).connect(this.windGain).connect(this.master);
    this.wind.start();
    const dustSrc = this.ctx.createBufferSource();
    dustSrc.buffer = buf;
    dustSrc.loop = true;
    dustSrc.playbackRate.value = 0.5;
    const dustFilter = this.ctx.createBiquadFilter();
    dustFilter.type = 'highpass';
    dustFilter.frequency.value = 2000;
    this.dustGain = this.ctx.createGain();
    this.dustGain.gain.value = 0;
    dustSrc.connect(dustFilter).connect(this.dustGain).connect(this.master);
    dustSrc.start();
  },
  update(sim, running) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    let maxV = 0;
    for (const p of sim.pods) maxV = Math.max(maxV, p.v);
    const speedF = maxV / CFG.V_MAX;
    const tension = sim.tension;
    const active = running && !sim.over;
    this.hum.frequency.setTargetAtTime(40 + tension * 55 + speedF * 15, t, 0.1);
    this.humGain.gain.setTargetAtTime(active ? 0.02 + tension * 0.05 + speedF * 0.03 : 0, t, 0.15);
    this.windFilter.frequency.setTargetAtTime(300 + speedF * 1400, t, 0.1);
    this.windGain.gain.setTargetAtTime(active ? speedF * 0.10 : 0, t, 0.15);
    this.dustGain.gain.setTargetAtTime(active ? sim.dust * 0.08 : 0, t, 0.3);
  },
};

/* ================= UI 与主循环 ================= */
const $ = id => document.getElementById(id);
const canvas = $('scene');
const ctx = canvas.getContext('2d');

const ui = {
  interval: $('interval'), dwell: $('dwell'), load: $('load'), seed: $('seed'),
  intervalVal: $('intervalVal'), dwellVal: $('dwellVal'), loadVal: $('loadVal'),
  autoBtn: $('autoBtn'), checkBtn: $('checkBtn'), startBtn: $('startBtn'),
  estopBtn: $('estopBtn'), resetBtn: $('resetBtn'), speed: $('speed'),
  stTime: $('stTime'), stDelivered: $('stDelivered'), stWear: $('stWear'),
  stBrake: $('stBrake'), stDust: $('stDust'), wearBar: $('wearBar'),
  goalTrips: $('goalTrips'), goalEstop: $('goalEstop'),
  log: $('log'), banner: $('banner'),
};

let sim = null;
let scenery = null;
let dustParts = [];
let running = false;
let loggedCount = 0;

function readParams() {
  return {
    interval: +ui.interval.value,
    dwell: +ui.dwell.value,
    load: +ui.load.value,
    seed: +ui.seed.value || 0,
  };
}

function logLine(e) {
  const div = document.createElement('div');
  if (e.cls) div.className = e.cls;
  div.textContent = `[${e.t.toFixed(1)}s] ${e.msg}`;
  ui.log.appendChild(div);
  ui.log.scrollTop = ui.log.scrollHeight;
}

function resetSim() {
  const params = readParams();
  sim = createSim(params);
  scenery = makeScenery(params.seed);
  dustParts = [];
  const rnd = mulberry32(params.seed ^ 0x51ab);
  for (let i = 0; i < 160; i++) {
    dustParts.push({ x: rnd() * VIEW.W, y: rnd() * VIEW.H, r: 1 + rnd() * 2, a: 0.3 + rnd() * 0.7, vx: 10 + rnd() * 30 });
  }
  running = false;
  loggedCount = 0;
  ui.log.innerHTML = '';
  ui.banner.classList.add('hidden');
  ui.startBtn.textContent = '开始';
  ui.estopBtn.disabled = true;
  ui.estopBtn.classList.remove('active');
  ui.estopBtn.textContent = '急停';
  ui.goalTrips.classList.remove('done');
  ui.goalTrips.textContent = '☐ 完成 3 次往返，送完全部设备';
  ui.goalEstop.classList.remove('done');
  ui.goalEstop.textContent = '☐ 执行一次安全急停（≥1s 且无碰撞）';
  logLine({ t: 0, msg: `任务已生成（seed=${params.seed}），${sim.mission.storms.length} 场微尘风暴。建议先「校验班次」。` });
  for (const st of sim.mission.storms) {
    logLine({ t: 0, msg: `预报：${st.start.toFixed(0)}s 起微尘 ${st.dur.toFixed(0)}s，强度 ${(st.intensity * 100).toFixed(0)}%`, cls: 'warn' });
  }
}

function finishBanner() {
  if (!sim.over) return;
  running = false;
  ui.estopBtn.disabled = true;
  ui.estopBtn.classList.remove('active');
  ui.banner.classList.remove('hidden', 'ok', 'bad');
  if (sim.success) {
    const both = sim.estopDone;
    ui.banner.classList.add('ok');
    ui.banner.textContent = both
      ? `任务成功！\n3 次往返完成 + 安全急停 ✔\n用时 ${sim.t.toFixed(0)}s · 磨损 ${sim.wear.toFixed(1)}%`
      : `运输完成！\n但本局未执行急停 —— 再来一局完成第二个目标？\n用时 ${sim.t.toFixed(0)}s · 磨损 ${sim.wear.toFixed(1)}%`;
    ui.goalTrips.classList.add('done');
    ui.goalTrips.textContent = '☑ 完成 3 次往返，送完全部设备';
  } else {
    ui.banner.classList.add('bad');
    ui.banner.textContent = `任务失败：${sim.fail}\n调整班次后重试（可先用「自动排班」）`;
  }
  ui.startBtn.textContent = '开始';
}

function updateHud() {
  ui.stTime.textContent = `${sim.t.toFixed(1)} s`;
  ui.stDelivered.textContent = `${sim.delivered} / ${CFG.POD_COUNT}`;
  ui.stWear.textContent = `${sim.wear.toFixed(1)}%`;
  ui.wearBar.style.width = `${Math.min(100, sim.wear)}%`;
  ui.wearBar.style.background = sim.wear > 70 ? '#ff7d7d' : sim.wear > 40 ? '#ffd27d' : '#7dffb0';
  ui.stBrake.textContent = `${Math.round(sim.brakeFactor * 100)}%`;
  if (sim.dust > 0) {
    ui.stDust.textContent = `微尘：强度 ${(sim.dust * 100).toFixed(0)}% —— 刹车减弱！`;
    ui.stDust.classList.add('warn');
  } else {
    ui.stDust.textContent = '微尘：无';
    ui.stDust.classList.remove('warn');
  }
  if (sim.estopDone) {
    ui.goalEstop.classList.add('done');
    ui.goalEstop.textContent = '☑ 执行一次安全急停（≥1s 且无碰撞）';
  }
  while (loggedCount < sim.events.length) logLine(sim.events[loggedCount++]);
}

let lastTs = 0, acc = 0;
function frame(ts) {
  requestAnimationFrame(frame);
  const dtReal = Math.min(0.1, (ts - lastTs) / 1000 || 0);
  lastTs = ts;
  if (running && sim && !sim.over) {
    acc += dtReal * (+ui.speed.value);
    const step = 0.05;
    while (acc >= step && !sim.over) { stepSim(sim, step); acc -= step; }
    if (sim.over) finishBanner();
  }
  if (sim) {
    // 微尘粒子漂移
    if (sim.dust > 0) {
      for (const p of dustParts) {
        p.x -= p.vx * dtReal * (0.5 + sim.dust);
        if (p.x < -4) { p.x = VIEW.W + 4; p.y = Math.random() * VIEW.H; }
      }
    }
    render(ctx, sim, scenery, dustParts);
    updateHud();
    audio.update(sim, running);
  }
}

/* ---- 控件绑定 ---- */
function bindSliders() {
  ui.interval.oninput = () => { ui.intervalVal.textContent = ui.interval.value; };
  ui.dwell.oninput = () => { ui.dwellVal.textContent = ui.dwell.value; };
  ui.load.oninput = () => { ui.loadVal.textContent = (+ui.load.value).toFixed(1); };
  ui.seed.onchange = () => resetSim();
}

ui.checkBtn.onclick = () => {
  const r = validateSchedule(readParams());
  logLine({
    t: sim ? sim.t : 0,
    msg: r.ok
      ? `✔ 班次可行：预计 ${r.time.toFixed(0)}s 完成，磨损 ${r.wear.toFixed(1)}%`
      : `✘ 班次不可行：${r.fail}（尝试加大间隔 / 降低载重）`,
    cls: r.ok ? 'ok' : 'bad',
  });
};

ui.autoBtn.onclick = () => {
  const base = readParams();
  for (let iv = 15; iv <= 120; iv += 5) {
    const r = validateSchedule({ ...base, interval: iv });
    if (r.ok) {
      ui.interval.value = iv;
      ui.intervalVal.textContent = iv;
      logLine({ t: sim ? sim.t : 0, msg: `✔ 自动排班：间隔 ${iv}s 可行（${r.time.toFixed(0)}s，磨损 ${r.wear.toFixed(1)}%）`, cls: 'ok' });
      return;
    }
  }
  logLine({ t: sim ? sim.t : 0, msg: '✘ 当前载重/停留下无可行间隔，请降低载重或缩短停留', cls: 'bad' });
};

ui.startBtn.onclick = () => {
  audio.init();
  if (sim.over) resetSim();
  running = !running;
  ui.startBtn.textContent = running ? '暂停' : '继续';
  ui.estopBtn.disabled = !running;
};

ui.estopBtn.onclick = () => {
  if (!sim || sim.over) return;
  sim.emergency = !sim.emergency;
  ui.estopBtn.classList.toggle('active', sim.emergency);
  ui.estopBtn.textContent = sim.emergency ? '解除急停' : '急停';
  simLog(sim, sim.emergency ? '!! 急停触发，全部吊舱制动' : '急停解除，恢复运行', sim.emergency ? 'warn' : '');
};

ui.resetBtn.onclick = () => resetSim();

/* ---- 启动 ---- */
bindSliders();
resetSim();
requestAnimationFrame(frame);
