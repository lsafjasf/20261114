/* 八格分镜 · 节拍对齐 —— UI / Canvas / Web Audio */
(function () {
  "use strict";
  var M = window.StoryModel;
  var STORAGE_KEY = "storyboard-beat-project";

  var canvas = document.getElementById("board");
  var ctx = canvas.getContext("2d");
  var totalLenInput = document.getElementById("totalLen");
  var bpmInput = document.getElementById("bpm");
  var playBtn = document.getElementById("playBtn");
  var saveBtn = document.getElementById("saveBtn");
  var loadBtn = document.getElementById("loadBtn");
  var fileInput = document.getElementById("fileInput");
  var statusEl = document.getElementById("status");
  var rowsEl = document.getElementById("panelRows");

  var state;
  try {
    state = M.deserialize(localStorage.getItem(STORAGE_KEY));
  } catch (e) {
    state = M.createDefault(16, 120);
  }

  var playback = { playing: false, startCtxTime: 0, rafId: 0, timerId: 0, nextBeat: 0 };
  var audioCtx = null;
  var selectedPanel = -1;

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, M.serialize(state)); } catch (e) {}
  }

  function setStatus(msg) {
    statusEl.textContent = msg;
    if (msg) setTimeout(function () { statusEl.textContent = ""; }, 2500);
  }

  /* ---------- 面板编辑行 ---------- */
  function buildRows() {
    rowsEl.innerHTML = "";
    state.panels.forEach(function (p, i) {
      var row = document.createElement("div");
      row.className = "prow";
      row.dataset.index = i;

      var title = document.createElement("div");
      title.className = "title";
      title.textContent = "第 " + (i + 1) + " 格";
      if (p.locked) {
        var lock = document.createElement("span");
        lock.className = "locked";
        lock.textContent = "●已手动";
        title.appendChild(lock);
      }
      row.appendChild(title);

      var durLabel = document.createElement("label");
      durLabel.textContent = "时长(s)";
      var durInput = document.createElement("input");
      durInput.type = "number";
      durInput.min = M.MIN_DURATION;
      durInput.step = 0.25;
      durInput.value = p.duration;
      durInput.addEventListener("change", function () {
        M.setPanelDuration(state, i, parseFloat(durInput.value));
        durInput.value = state.panels[i].duration;
        afterChange();
      });
      durLabel.appendChild(durInput);
      row.appendChild(durLabel);

      var shotLabel = document.createElement("label");
      shotLabel.textContent = "镜头";
      var sel = document.createElement("select");
      M.SHOT_TYPES.forEach(function (st) {
        var opt = document.createElement("option");
        opt.value = st.id;
        opt.textContent = st.name;
        sel.appendChild(opt);
      });
      sel.value = p.shotType;
      sel.addEventListener("change", function () {
        M.setPanelShotType(state, i, sel.value);
        afterChange();
      });
      shotLabel.appendChild(sel);
      row.appendChild(shotLabel);

      rowsEl.appendChild(row);
    });
  }

  function refreshRows() {
    var rows = rowsEl.children;
    state.panels.forEach(function (p, i) {
      var row = rows[i];
      if (!row) return;
      row.querySelector('input[type="number"]').value = p.duration;
      row.querySelector("select").value = p.shotType;
      var title = row.querySelector(".title");
      title.textContent = "第 " + (i + 1) + " 格";
      if (p.locked) {
        var lock = document.createElement("span");
        lock.className = "locked";
        lock.textContent = "●已手动";
        title.appendChild(lock);
      }
    });
  }

  function afterChange() {
    persist();
    refreshRows();
    draw();
  }

  /* ---------- Canvas 布局 ---------- */
  var W = canvas.width, H = canvas.height;
  var MARGIN = 30;
  var STRIP_Y = 24, STRIP_H = 250;
  var TRACK_Y = 330, TRACK_H = 150;

  function pxPerSec() {
    return (W - MARGIN * 2) / Math.max(M.totalDuration(state), 0.001);
  }

  function panelRects() {
    var scale = pxPerSec();
    var starts = M.panelStarts(state);
    return starts.map(function (s, i) {
      return { x: MARGIN + s * scale, w: state.panels[i].duration * scale };
    });
  }

  /* 按镜头类型画程序化缩略图：人物占比随景别变化。 */
  function drawThumb(x, y, w, h, shotId, active) {
    var st = M.shotTypeById(shotId);
    var g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, active ? "#2c3550" : "#232838");
    g.addColorStop(1, "#181b25");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);

    var horizon = y + h * 0.62;
    ctx.fillStyle = st.color;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(x, horizon, w, y + h - horizon);
    ctx.globalAlpha = 1;

    var scaleMap = {
      "extreme-long": 0.10, "long": 0.18, "full": 0.30, "medium": 0.45,
      "close": 0.62, "extreme-close": 0.85, "insert": 0, "pov": 0.5
    };
    var s = scaleMap[shotId] != null ? scaleMap[shotId] : 0.3;
    var cx = x + w / 2;
    ctx.fillStyle = st.color;
    if (shotId === "insert") {
      ctx.beginPath();
      ctx.arc(cx, y + h * 0.35, h * 0.12, 0, Math.PI * 2);
      ctx.fill();
    } else if (shotId === "pov") {
      ctx.strokeStyle = st.color;
      ctx.lineWidth = 3;
      ctx.strokeRect(x + w * 0.2, y + h * 0.2, w * 0.6, h * 0.5);
      ctx.beginPath();
      ctx.moveTo(cx - 8, y + h * 0.45); ctx.lineTo(cx + 8, y + h * 0.45);
      ctx.moveTo(cx, y + h * 0.37); ctx.lineTo(cx, y + h * 0.53);
      ctx.stroke();
    } else {
      var bodyH = h * s;
      var headR = bodyH * 0.18;
      var footY = y + h * 0.9;
      var headCY = Math.max(footY - bodyH, y + headR + 2);
      ctx.beginPath();
      ctx.arc(cx, headCY, headR, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(cx - bodyH * 0.14, headCY + headR, bodyH * 0.28, footY - headCY - headR);
    }
  }

  function draw(currentTime) {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#1a1d26";
    ctx.fillRect(0, 0, W, H);

    var rects = panelRects();
    var curPanel = playback.playing ? M.panelAt(state, currentTime) : selectedPanel;

    /* 分镜条 */
    rects.forEach(function (r, i) {
      var p = state.panels[i];
      var active = i === curPanel;
      ctx.save();
      if (active) {
        ctx.shadowColor = "#2f6fed";
        ctx.shadowBlur = 16;
      }
      drawThumb(r.x + 2, STRIP_Y, r.w - 4, STRIP_H - 44, p.shotType, active);
      ctx.restore();

      ctx.strokeStyle = active ? "#2f6fed" : "#343949";
      ctx.lineWidth = active ? 2.5 : 1;
      ctx.strokeRect(r.x + 2, STRIP_Y, r.w - 4, STRIP_H - 44);

      ctx.fillStyle = "#12141b";
      ctx.fillRect(r.x + 2, STRIP_Y + STRIP_H - 44, r.w - 4, 44);
      ctx.fillStyle = "#cdd4e3";
      ctx.font = "bold 13px sans-serif";
      ctx.fillText((i + 1) + ". " + M.shotTypeById(p.shotType).name, r.x + 10, STRIP_Y + STRIP_H - 26);
      ctx.fillStyle = p.locked ? "#f0b64c" : "#8b93a7";
      ctx.font = "12px sans-serif";
      ctx.fillText(p.duration.toFixed(2) + "s" + (p.locked ? " ●" : ""), r.x + 10, STRIP_Y + STRIP_H - 8);

      /* 右缘拖拽手柄 */
      ctx.fillStyle = "#4a5164";
      ctx.fillRect(r.x + r.w - 5, STRIP_Y + STRIP_H / 2 - 18, 4, 36);
    });

    /* 节拍轨 */
    var total = M.totalDuration(state);
    var scale = pxPerSec();
    var beatDur = 60 / state.bpm;
    var beatCount = Math.ceil(total / beatDur - 1e-6);

    ctx.fillStyle = "#12141b";
    ctx.fillRect(MARGIN, TRACK_Y, W - MARGIN * 2, TRACK_H);
    ctx.strokeStyle = "#343949";
    ctx.strokeRect(MARGIN, TRACK_Y, W - MARGIN * 2, TRACK_H);

    /* 当前镜头在节拍轨上的区间高亮，保证与分镜条同步 */
    if (curPanel >= 0) {
      var starts = M.panelStarts(state);
      ctx.fillStyle = "rgba(47,111,237,0.18)";
      ctx.fillRect(MARGIN + starts[curPanel] * scale, TRACK_Y,
        state.panels[curPanel].duration * scale, TRACK_H);
    }

    var curBeat = playback.playing ? Math.floor(currentTime / beatDur) : -1;
    for (var b = 0; b <= beatCount; b++) {
      var bx = MARGIN + b * beatDur * scale;
      if (bx > W - MARGIN + 0.5) break;
      var isBar = b % 4 === 0;
      var isCur = b === curBeat;
      ctx.strokeStyle = isCur ? "#f0b64c" : (isBar ? "#5d6577" : "#333947");
      ctx.lineWidth = isCur ? 3 : (isBar ? 2 : 1);
      ctx.beginPath();
      ctx.moveTo(bx, TRACK_Y + (isBar ? 0 : 14));
      ctx.lineTo(bx, TRACK_Y + TRACK_H);
      ctx.stroke();
      if (isBar) {
        ctx.fillStyle = isCur ? "#f0b64c" : "#8b93a7";
        ctx.font = "11px sans-serif";
        ctx.fillText("|" + (b / 4 + 1), bx + 4, TRACK_Y + 14);
      }
      /* 鼓点提示：kick 每拍、snare 二四拍 */
      ctx.fillStyle = isBar ? "#e06c6c" : (b % 2 === 1 ? "#6c8ae0" : "#4a5164");
      ctx.beginPath();
      ctx.arc(bx, TRACK_Y + TRACK_H - 18, isBar ? 6 : 4, 0, Math.PI * 2);
      ctx.fill();
    }

    /* 播放头（贯穿分镜条与节拍轨） */
    if (playback.playing && currentTime <= total) {
      var px = MARGIN + currentTime * scale;
      ctx.strokeStyle = "#ff5c5c";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, STRIP_Y - 6);
      ctx.lineTo(px, TRACK_Y + TRACK_H);
      ctx.stroke();
      ctx.fillStyle = "#ff5c5c";
      ctx.beginPath();
      ctx.moveTo(px - 6, STRIP_Y - 6);
      ctx.lineTo(px + 6, STRIP_Y - 6);
      ctx.lineTo(px, STRIP_Y + 2);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = "#8b93a7";
    ctx.font = "12px sans-serif";
    ctx.fillText("总时长 " + total.toFixed(2) + "s · " + state.bpm + " BPM · 每拍 " +
      beatDur.toFixed(3) + "s", MARGIN, TRACK_Y + TRACK_H + 24);
  }

  /* ---------- 鼠标交互：拖右缘改时长，点击选格 ---------- */
  var drag = null;

  function canvasPos(e) {
    var r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (canvas.width / r.width),
      y: (e.clientY - r.top) * (canvas.height / r.height)
    };
  }

  function edgeAt(pos) {
    var rects = panelRects();
    for (var i = 0; i < rects.length; i++) {
      if (pos.y >= STRIP_Y && pos.y <= STRIP_Y + STRIP_H &&
          Math.abs(pos.x - (rects[i].x + rects[i].w)) <= 7) return i;
    }
    return -1;
  }

  canvas.addEventListener("mousedown", function (e) {
    var pos = canvasPos(e);
    var idx = edgeAt(pos);
    if (idx >= 0) {
      drag = { index: idx, startX: pos.x, origDur: state.panels[idx].duration };
      e.preventDefault();
      return;
    }
    var rects = panelRects();
    for (var i = 0; i < rects.length; i++) {
      if (pos.x >= rects[i].x && pos.x <= rects[i].x + rects[i].w &&
          pos.y >= STRIP_Y && pos.y <= STRIP_Y + STRIP_H) {
        selectedPanel = i;
        draw();
        return;
      }
    }
  });

  canvas.addEventListener("mousemove", function (e) {
    var pos = canvasPos(e);
    if (drag) {
      var d = drag.origDur + (pos.x - drag.startX) / pxPerSec();
      M.setPanelDuration(state, drag.index, d);
      persist();
      refreshRows();
      draw();
      return;
    }
    canvas.style.cursor = edgeAt(pos) >= 0 ? "ew-resize" : "default";
  });

  window.addEventListener("mouseup", function () {
    if (drag) { drag = null; afterChange(); }
  });

  /* ---------- Web Audio 合成鼓点 ---------- */
  var master = null, noiseBuf = null;

  function ensureAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      master = audioCtx.createGain();
      master.gain.value = 0.8;
      master.connect(audioCtx.destination);
      var len = audioCtx.sampleRate * 0.5;
      noiseBuf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
      var data = noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
  }

  function kick(t) {
    var osc = audioCtx.createOscillator();
    var g = audioCtx.createGain();
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    osc.connect(g); g.connect(master);
    osc.start(t); osc.stop(t + 0.3);
  }

  function snare(t) {
    var src = audioCtx.createBufferSource();
    src.buffer = noiseBuf;
    var bp = audioCtx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 1800; bp.Q.value = 0.8;
    var g = audioCtx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(t); src.stop(t + 0.2);
  }

  function hat(t) {
    var src = audioCtx.createBufferSource();
    src.buffer = noiseBuf;
    var hp = audioCtx.createBiquadFilter();
    hp.type = "highpass"; hp.frequency.value = 7000;
    var g = audioCtx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    src.connect(hp); hp.connect(g); g.connect(master);
    src.start(t); src.stop(t + 0.06);
  }

  /* 前瞻式排程：每拍 kick，二四拍 snare，八分音符 hat */
  function scheduleBeats() {
    var beatDur = 60 / state.bpm;
    var total = M.totalDuration(state);
    while (playback.nextBeat * beatDur < total &&
           playback.startCtxTime + playback.nextBeat * beatDur < audioCtx.currentTime + 0.15) {
      var b = playback.nextBeat;
      var t = playback.startCtxTime + b * beatDur;
      kick(t);
      if (b % 4 === 1 || b % 4 === 3) snare(t);
      hat(t);
      hat(t + beatDur / 2);
      playback.nextBeat++;
    }
    if (playback.nextBeat * beatDur >= total + 1) {
      clearInterval(playback.timerId);
    }
  }

  /* ---------- 播放控制 ---------- */
  function playFrame() {
    var t = audioCtx.currentTime - playback.startCtxTime;
    var total = M.totalDuration(state);
    if (t >= total) { stopPlayback(); draw(); return; }
    draw(t);
    playback.rafId = requestAnimationFrame(playFrame);
  }

  function startPlayback() {
    ensureAudio();
    playback.playing = true;
    playback.startCtxTime = audioCtx.currentTime + 0.06;
    playback.nextBeat = 0;
    playback.timerId = setInterval(scheduleBeats, 25);
    scheduleBeats();
    playback.rafId = requestAnimationFrame(playFrame);
    playBtn.textContent = "■ 停止";
    playBtn.classList.add("playing");
  }

  function stopPlayback() {
    playback.playing = false;
    cancelAnimationFrame(playback.rafId);
    clearInterval(playback.timerId);
    playBtn.textContent = "▶ 播放";
    playBtn.classList.remove("playing");
  }

  playBtn.addEventListener("click", function () {
    if (playback.playing) { stopPlayback(); draw(); }
    else startPlayback();
  });

  /* ---------- 工具栏：总长度 / BPM / 保存 / 载入 ---------- */
  totalLenInput.addEventListener("change", function () {
    M.redistribute(state, parseFloat(totalLenInput.value));
    totalLenInput.value = state.totalLength;
    afterChange();
    setStatus("已按总长度重分配未锁定格子");
  });

  bpmInput.addEventListener("change", function () {
    state.bpm = Math.min(240, Math.max(40, parseInt(bpmInput.value, 10) || 120));
    bpmInput.value = state.bpm;
    afterChange();
  });

  saveBtn.addEventListener("click", function () {
    var blob = new Blob([M.serialize(state)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "storyboard-project.json";
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus("已导出 JSON 工程");
  });

  loadBtn.addEventListener("click", function () { fileInput.click(); });
  fileInput.addEventListener("change", function () {
    var f = fileInput.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        state = M.deserialize(reader.result);
        totalLenInput.value = state.totalLength;
        bpmInput.value = state.bpm;
        buildRows();
        afterChange();
        setStatus("工程已载入");
      } catch (err) {
        setStatus("载入失败：" + err.message);
      }
    };
    reader.readAsText(f);
    fileInput.value = "";
  });

  /* ---------- 初始化 ---------- */
  totalLenInput.value = state.totalLength;
  bpmInput.value = state.bpm;
  buildRows();
  draw();

  /* 供自动化测试探针使用 */
  window.__app = {
    getState: function () { return state; },
    model: M,
    redraw: draw
  };
})();
