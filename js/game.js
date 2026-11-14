'use strict';

const ROOMS = [
  { id: 'A', name: '房间 A', material: 'concrete', sound: 'footsteps', tempo: 0.55,
    rect: { x1: -5, z1: 1, x2: 0, z2: 5 }, source: { x: -2.5, z: 3 } },
  { id: 'B', name: '房间 B', material: 'wood', sound: 'drips',
    rect: { x1: 0, z1: 1, x2: 5, z2: 5 }, source: { x: 2.5, z: 3 } },
  { id: 'C', name: '房间 C', material: 'glass', sound: 'footsteps', tempo: 0.8,
    rect: { x1: -5, z1: -5, x2: 0, z2: -1 }, source: { x: -2.5, z: -3 } },
];

const DIR_LABELS = {
  'front-left': '左前', 'front-right': '右前',
  'back-left': '左后', 'back-right': '右后',
};

const engine = new AudioEngine();

const state = {
  started: false,
  room: null,
  listenerX: 0,
  listenerZ: 0,
  selectedDir: null,
  revealed: false,
  lastResult: null,
};

function trueQuadrant() {
  const dx = state.room.source.x - state.listenerX;
  const dz = state.room.source.z - state.listenerZ;
  return (dz >= 0 ? 'front' : 'back') + '-' + (dx < 0 ? 'left' : 'right');
}

const $ = (sel) => document.querySelector(sel);

function startRound(forcedRoomId) {
  engine.init();
  if (engine.ctx.state === 'suspended') engine.ctx.resume();
  state.room = forcedRoomId
    ? ROOMS.find((r) => r.id === forcedRoomId)
    : ROOMS[Math.floor(Math.random() * ROOMS.length)];
  state.revealed = false;
  state.lastResult = null;
  state.selectedDir = null;
  engine.setListener(state.listenerX, state.listenerZ);
  engine.playRoom(state.room);
  document.querySelectorAll('.dirs button').forEach((b) => {
    b.disabled = false;
    b.classList.remove('selected');
  });
  $('#pos-slider').disabled = false;
  $('#submit-btn').disabled = true;
  $('#reveal').hidden = true;
  $('#status').textContent = '正在监听…… 拖动滑块改变监听位置，选择方向后提交。';
}

function submitDirection() {
  if (!state.selectedDir || state.revealed) return;
  const actual = trueQuadrant();
  const ok = state.selectedDir === actual;
  state.revealed = true;
  state.lastResult = { ok, guess: state.selectedDir, actual };
  engine.stopAll();
  const resultEl = $('#result');
  resultEl.textContent = ok
    ? `判断正确！声源在你的${DIR_LABELS[actual]}方。`
    : `判断错误。你选了${DIR_LABELS[state.selectedDir]}，实际声源在${DIR_LABELS[actual]}方。`;
  resultEl.className = ok ? 'ok' : 'bad';
  $('#reveal-note').textContent =
    `${state.room.name}（${MATERIALS[state.room.material].label}）内的声源已标出，` +
    '三角形为监听位置，朝向北方。';
  $('#reveal').hidden = false;
  $('#status').textContent = '本轮结束。';
  document.querySelectorAll('.dirs button').forEach((b) => (b.disabled = true));
  $('#submit-btn').disabled = true;
  drawPlan();
}

function drawPlan() {
  const canvas = $('#plan');
  const g = canvas.getContext('2d');
  const scale = 44;
  const ox = canvas.width / 2;
  const oz = canvas.height / 2 + 10;
  const px = (x) => ox + x * scale;
  const pz = (z) => oz - z * scale;
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#10131a';
  g.fillRect(0, 0, canvas.width, canvas.height);

  g.fillStyle = '#1a2030';
  g.fillRect(px(-5.5), pz(1), 11 * scale, 2 * scale);
  g.fillStyle = '#5b6b85';
  g.font = '12px sans-serif';
  g.textAlign = 'center';
  g.fillText('走 廊', px(2.5), pz(0.2));

  const matColors = { concrete: '#3a3f4a', wood: '#4d3d2a', glass: '#274b55' };
  ROOMS.forEach((room) => {
    const { x1, z1, x2, z2 } = room.rect;
    g.fillStyle = matColors[room.material];
    g.fillRect(px(x1), pz(z2), (x2 - x1) * scale, (z2 - z1) * scale);
    g.strokeStyle = '#7c879c';
    g.lineWidth = 2;
    g.strokeRect(px(x1), pz(z2), (x2 - x1) * scale, (z2 - z1) * scale);
    g.fillStyle = '#cfd6e2';
    g.font = '13px sans-serif';
    g.fillText(`${room.name} · ${MATERIALS[room.material].label}`, px((x1 + x2) / 2), pz((z1 + z2) / 2) - 8);
  });

  const s = state.room.source;
  g.strokeStyle = '#e8d44d';
  g.setLineDash([4, 4]);
  g.beginPath();
  g.moveTo(px(state.listenerX), pz(state.listenerZ));
  g.lineTo(px(s.x), pz(s.z));
  g.stroke();
  g.setLineDash([]);

  g.fillStyle = '#ffd75e';
  g.beginPath();
  g.arc(px(s.x), pz(s.z), 8, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#14171c';
  g.font = 'bold 11px sans-serif';
  g.fillText('声', px(s.x), pz(s.z) + 4);

  const lx = px(state.listenerX);
  const lz = pz(state.listenerZ);
  g.fillStyle = '#5aa2e8';
  g.beginPath();
  g.moveTo(lx, lz - 11);
  g.lineTo(lx - 8, lz + 8);
  g.lineTo(lx + 8, lz + 8);
  g.closePath();
  g.fill();
  g.fillStyle = '#9fc6f0';
  g.font = '11px sans-serif';
  g.fillText('监听点（朝北）', lx, lz + 22);
}

function meterLoop() {
  const [l, r] = engine.getLevels();
  $('#meter-l').style.width = Math.min(100, l * 600) + '%';
  $('#meter-r').style.width = Math.min(100, r * 600) + '%';
  requestAnimationFrame(meterLoop);
}

function initUI() {
  $('#start-btn').addEventListener('click', () => {
    state.started = true;
    startRound();
  });
  $('#pos-slider').addEventListener('input', (e) => {
    state.listenerX = parseFloat(e.target.value);
    $('#pos-val').textContent = state.listenerX.toFixed(1) + ' m';
    if (state.started && !state.revealed) engine.setListener(state.listenerX, state.listenerZ);
  });
  document.querySelectorAll('.dirs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.dirs button').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.selectedDir = btn.dataset.dir;
      $('#submit-btn').disabled = false;
    });
  });
  $('#submit-btn').addEventListener('click', submitDirection);
  $('#next-btn').addEventListener('click', () => startRound());
  requestAnimationFrame(meterLoop);
}

initUI();

/* 自动化测试钩子 */
window.__test = {
  startRound: (roomId) => startRound(roomId),
  setListener: (x) => {
    state.listenerX = x;
    $('#pos-slider').value = String(x);
    $('#pos-val').textContent = x.toFixed(1) + ' m';
    engine.setListener(x, state.listenerZ);
  },
  select: (dir) => {
    state.selectedDir = dir;
    document.querySelectorAll('.dirs button').forEach((b) =>
      b.classList.toggle('selected', b.dataset.dir === dir));
    $('#submit-btn').disabled = false;
  },
  submit: submitDirection,
  trueQuadrant,
  probe: (roomId, opts) => {
    const room = ROOMS.find((r) => r.id === roomId);
    return renderOfflineProbe(room, opts || {});
  },
  getState: () => ({
    roomId: state.room && state.room.id,
    listenerX: state.listenerX,
    revealed: state.revealed,
    result: state.lastResult,
    levels: engine.getLevels(),
  }),
};
