/* 页面主逻辑：滑杆目标 -> 限速连续积分 -> 碰撞/保护 -> 渲染与音效 */
const A = ArmCore;
const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
const banner = document.getElementById('banner');
const statusEl = document.getElementById('status');

const JOINT_NAMES = ['肩关节', '肘关节', '腕关节', '夹爪旋转', '左指开合', '右指开合'];
const HOME = [-2.3, 2.2, 0.1, 0, 1, 1];

let cur = HOME.slice();    // 实际关节角（只能连续变化）
let target = HOME.slice(); // 滑杆给出的目标角
let piece = { x: A.PIECE_HOME.x, y: A.PIECE_HOME.y };
let carrying = false;
let placed = false;
let crashed = null;        // 非 null 表示碰撞急停
let protectUntil = 0;      // 超速保护冻结截止时间
let poses = [];            // 记录的姿态序列
let replaying = false;
let replayIndex = 0;
let replayWait = 0;
let lastSpeeds = [0, 0, 0, 0, 0, 0];

/* ---------- 滑杆 ---------- */
const sliderBox = document.getElementById('sliders');
const sliderInputs = [];
JOINT_NAMES.forEach((name, i) => {
  const row = document.createElement('div');
  row.className = 'slider-row';
  const label = document.createElement('label');
  const span = document.createElement('span');
  span.textContent = name;
  const val = document.createElement('span');
  const input = document.createElement('input');
  input.type = 'range';
  input.min = A.Q_MIN[i]; input.max = A.Q_MAX[i]; input.step = 0.01;
  input.value = HOME[i];
  input.addEventListener('input', () => {
    if (replaying) return;
    target[i] = parseFloat(input.value);
    val.textContent = Number(input.value).toFixed(2);
  });
  label.appendChild(span); label.appendChild(val);
  row.appendChild(label); row.appendChild(input);
  sliderBox.appendChild(row);
  sliderInputs.push({ input, val });
});

function syncSliders(q) {
  sliderInputs.forEach((s, i) => {
    s.input.value = q[i];
    s.val.textContent = Number(q[i]).toFixed(2);
  });
}
syncSliders(HOME);

/* ---------- 音效：频率/响度随关节速度 ---------- */
let audioCtx = null, osc = null, gainNode = null;
function ensureAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  osc = audioCtx.createOscillator();
  gainNode = audioCtx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.value = 70;
  gainNode.gain.value = 0;
  osc.connect(gainNode).connect(audioCtx.destination);
  osc.start();
}
window.addEventListener('pointerdown', ensureAudio, { once: true });

function updateAudio() {
  if (!audioCtx) return;
  const speedSum = lastSpeeds.reduce((s, v) => s + Math.abs(v), 0);
  const t = audioCtx.currentTime;
  osc.frequency.setTargetAtTime(70 + speedSum * 55, t, 0.05);
  gainNode.gain.setTargetAtTime(Math.min(0.12, speedSum * 0.035), t, 0.08);
}

/* ---------- 提示条 ---------- */
function showBanner(text, cls) {
  banner.textContent = text;
  banner.className = cls;
}
function hideBanner() { banner.className = ''; }

/* ---------- 抓取 / 释放 ---------- */
function tryGraspRelease() {
  const f = A.fk(cur);
  const gx = f.tip.x + Math.cos(f.a4) * 6;
  const gy = f.tip.y + Math.sin(f.a4) * 6;
  if (!carrying && !placed && cur[4] < 0.35 && cur[5] < 0.35 &&
      Math.hypot(gx - piece.x, gy - piece.y) < 16) {
    carrying = true;
    showBanner('已抓取工件', 'ok');
    setTimeout(hideBanner, 1200);
  }
  if (carrying && cur[4] > 0.6 && cur[5] > 0.6) {
    carrying = false;
    const inFixture = piece.x > A.FIXTURE_R.x && piece.x < A.FIXTURE_R.x + A.FIXTURE_R.w;
    const inPallet = piece.x > A.PALLET_L.x && piece.x < A.PALLET_L.x + A.PALLET_L.w;
    piece.y = inFixture || inPallet ? 445 : A.GROUND_Y - A.PIECE_R;
    if (inFixture && Math.abs(piece.x - A.DROP_ZONE.x) < 25) {
      placed = true;
      showBanner('任务完成！工件已放入夹具', 'ok');
    }
  }
  if (carrying) { piece.x = gx; piece.y = gy; }
}

/* ---------- 主循环 ---------- */
let lastT = performance.now();
function tick(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;

  if (!crashed && now >= protectUntil) {
    const r = A.stepJoints(cur, target, dt);
    if (r.tripped && !replaying) {
      // 需求速度超限：保护停机 1.2s，目标回收到当前姿态
      protectUntil = now + 1200;
      target = cur.slice();
      syncSliders(target);
      showBanner('关节速度超限，保护停机！', 'warn');
      setTimeout(() => { if (!crashed) hideBanner(); }, 1200);
    } else {
      cur = r.q;
      lastSpeeds = r.speeds;
    }
  }

  if (!crashed) {
    tryGraspRelease();
    const hit = A.checkCollision({ q: cur, carrying, piece });
    if (hit) {
      crashed = hit;
      replaying = false;
      showBanner('碰撞：' + hit + '，动作终止！点击“复位”恢复', 'err');
    }
  }

  if (replaying) advanceReplay(now);
  updateAudio();
  render(now);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

/* ---------- 渲染 ---------- */
function drawRect(r, color) {
  ctx.fillStyle = color;
  ctx.fillRect(r.x, r.y, r.w, r.h);
}

function drawSeg(a, b, w, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function drawJoint(p, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
}

function render(now) {
  ctx.clearRect(0, 0, cv.width, cv.height);
  // 地面
  drawRect({ x: 0, y: A.GROUND_Y, w: cv.width, h: cv.height - A.GROUND_Y }, '#1a2130');
  ctx.strokeStyle = '#3a4a66';
  ctx.beginPath(); ctx.moveTo(0, A.GROUND_Y); ctx.lineTo(cv.width, A.GROUND_Y); ctx.stroke();
  // 障碍与台面
  drawRect(A.WALL, crashed ? '#e74c3c' : '#8e5a3a');
  drawRect(A.PALLET_L, '#4a6a8a');
  drawRect(A.FIXTURE_R, '#4a8a5a');
  ctx.fillStyle = '#9fb0cc';
  ctx.font = '12px sans-serif';
  ctx.fillText('左托盘', A.PALLET_L.x + 8, A.PALLET_L.y + 34);
  ctx.fillText('隔墙', A.WALL.x + 6, A.WALL.y - 8);
  ctx.fillText('右夹具', A.FIXTURE_R.x + 8, A.FIXTURE_R.y + 34);
  // 放置目标区
  ctx.strokeStyle = placed ? '#2ecc71' : '#7de6a3';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.arc(A.DROP_ZONE.x, A.DROP_ZONE.y, 16, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  // 工件
  drawJoint(piece, A.PIECE_R, placed ? '#2ecc71' : '#f0a13c');
  drawJoint(piece, 4, '#c47b1e');
  // 机械手
  const f = A.fk(cur);
  const armColor = crashed ? '#e74c3c' : '#7fb2f0';
  drawSeg(f.p0, f.p1, 11, armColor);
  drawSeg(f.p1, f.p2, 9, armColor);
  drawSeg(f.p2, f.p3, 7, armColor);
  drawSeg(f.p3, f.tip, 6, '#b8c8e0');
  drawSeg(f.fL, f.fL2, 4, '#d0d8e8');
  drawSeg(f.fR, f.fR2, 4, '#d0d8e8');
  drawJoint(f.p0, 9, '#54749e');
  drawJoint(f.p1, 7, '#54749e');
  drawJoint(f.p2, 6, '#54749e');
  drawJoint(f.p3, 5, '#8a9ab5');
  // 碰撞红闪
  if (crashed && Math.floor(now / 200) % 2 === 0) {
    ctx.fillStyle = 'rgba(231,76,60,0.12)';
    ctx.fillRect(0, 0, cv.width, cv.height);
  }
  // 状态行
  const spd = lastSpeeds.reduce((s, v) => s + Math.abs(v), 0);
  statusEl.textContent =
    (crashed ? '【急停】' + crashed + '。' :
     placed ? '任务完成！可点击“复位”重新开始。' :
     carrying ? '已抓取工件：搬运中……' : '待机：拖动滑杆控制机械手。') +
    ' 关节总速度 ' + spd.toFixed(2) + ' rad/s';
}

/* ---------- 姿态序列：记录 / 回放 ---------- */
const poseList = document.getElementById('poseList');

function renderPoseList() {
  poseList.innerHTML = '';
  poses.forEach((p, i) => {
    const li = document.createElement('li');
    li.textContent = (p.label || '姿态 ' + (i + 1)) +
      '  [' + p.q.map(v => v.toFixed(2)).join(', ') + ']';
    if (replaying && i === replayIndex) li.className = 'playing';
    poseList.appendChild(li);
  });
}

function advanceReplay(now) {
  if (replayIndex >= poses.length) {
    replaying = false;
    renderPoseList();
    return;
  }
  if (A.reached(cur, target)) {
    if (now < replayWait) return;
    const p = poses[replayIndex];
    target = p.q.slice();
    syncSliders(target);
    renderPoseList();
    replayIndex++;
    replayWait = now + 350; // 到位后稍停，便于逐步观察
  }
}

document.getElementById('btnRecord').addEventListener('click', () => {
  poses.push({ q: target.slice(), label: '姿态 ' + (poses.length + 1) });
  renderPoseList();
});

document.getElementById('btnReplay').addEventListener('click', () => {
  if (!poses.length || crashed) return;
  replaying = true;
  replayIndex = 0;
  replayWait = 0;
  renderPoseList();
});

document.getElementById('btnDemo').addEventListener('click', () => {
  poses = DEMO_SEQUENCE.map(p => ({ q: p.q.slice(), label: p.label }));
  renderPoseList();
});

document.getElementById('btnSave').addEventListener('click', () => {
  localStorage.setItem('armPoseSeq', JSON.stringify(poses));
  showBanner('序列已保存（' + poses.length + ' 帧）', 'ok');
  setTimeout(hideBanner, 1200);
});

document.getElementById('btnLoad').addEventListener('click', () => {
  const s = localStorage.getItem('armPoseSeq');
  if (s) { poses = JSON.parse(s); renderPoseList(); }
});

document.getElementById('btnClear').addEventListener('click', () => {
  poses = [];
  renderPoseList();
});

document.getElementById('btnReset').addEventListener('click', () => {
  crashed = null;
  protectUntil = 0;
  replaying = false;
  target = cur.slice();
  syncSliders(target);
  hideBanner();
  if (placed || !carrying) {
    piece = { x: A.PIECE_HOME.x, y: A.PIECE_HOME.y };
    placed = false;
  }
});
