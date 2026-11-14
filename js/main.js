/* 主控：控件绑定、任务判定、主循环 */
(function (global) {
  "use strict";
  var NF = global.NF;

  var st = NF.createState();
  var engine = new NF.AudioEngine();
  var renderer = null;
  var el = {};
  var last = 0, acc = 0, wfAcc = 0, lastFlash = "";

  function $(id) { return document.getElementById(id); }

  function cache() {
    ["ro-clock", "ro-freq", "ro-angle", "ro-bw",
     "ctl-angle", "ctl-angle-val", "ctl-freq", "ctl-freq-val",
     "ctl-bw", "ctl-bw-val", "ctl-vol", "ctl-vol-val",
     "btn-record", "btn-reset", "checklist", "mission-done", "log"
    ].forEach(function (id) { el[id] = $(id); });
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  function log(msg, kind) {
    var li = document.createElement("li");
    if (kind) { li.className = kind; }
    var clock = NF.formatClock(st.simTime).slice(0, 5);
    li.innerHTML = '<span class="t">' + clock + '</span>' + msg;
    el.log.insertBefore(li, el.log.firstChild);
    while (el.log.children.length > 40) {
      el.log.removeChild(el.log.lastChild);
    }
  }

  function refreshReadouts() {
    el["ro-clock"].textContent = NF.formatClock(st.simTime);
    el["ro-freq"].textContent = NF.formatMHz(st.tuned);
    el["ro-angle"].textContent = pad(Math.round(st.heading)) + "°";
    el["ro-bw"].textContent = st.bw.toFixed(1) + " kHz";
    el["ctl-angle-val"].textContent = pad(Math.round(st.heading)) + "°";
    el["ctl-freq-val"].textContent = NF.formatMHz(st.tuned);
    el["ctl-bw-val"].textContent = st.bw.toFixed(1) + " kHz";
    el["ctl-vol-val"].textContent = Math.round(st.volume * 100) + "%";
  }

  function refreshChecklist() {
    Array.prototype.forEach.call(el.checklist.children, function (li) {
      var id = li.getAttribute("data-id");
      var done = id === "D0" ? st.decoyVerified : !!st.locks[id];
      li.classList.toggle("done", !!done);
      if (done && id !== "D0" && !li.dataset.note) {
        var lk = st.locks[id];
        li.dataset.note = "1";
        li.textContent = li.textContent +
          "（" + NF.formatMHz(lk.recorded) + " · 误差 "
          + (lk.error * 1000).toFixed(0) + " Hz）";
        li.insertAdjacentHTML("afterbegin", '<i class="box"></i>');
      }
      if (done && id === "D0" && !li.dataset.note) {
        li.dataset.note = "1";
        li.textContent = li.textContent + "（已确认无法稳定锁定）";
        li.insertAdjacentHTML("afterbegin", '<i class="box"></i>');
      }
    });
    var done = NF.missionComplete(st);
    el["mission-done"].classList.toggle("hidden", !done);
    return done;
  }

  function onRecord() {
    if (!st.started) { return; }
    var r = NF.evaluateLock(st);
    switch (r.result) {
      case "nosignal":
        log("未捕获到足够强度的信号，无法记录。", "bad");
        break;
      case "decoy":
        log("误锁告警：该“信标”频率与方位持续游走，判定为干扰源 D0，"
          + "误锁验证通过。", "bad");
        break;
      case "interferer":
        log("误锁干扰：锁到的是常发邻频台 " + r.signal.id
          + "（" + NF.formatMHz(r.signal.freq) + "），不是断续信标。", "bad");
        break;
      case "freqerr":
        log("频率误差过大：" + r.beacon.name + " 实际约 "
          + NF.formatMHz(r.signal.freq) + "，偏差 "
          + (r.freqErr * 1000).toFixed(0)
          + " Hz（容限 " + (NF.CONST.LOCK_FREQ_TOL * 1000) + " Hz），定位失败。",
          "warn");
        break;
      case "angle":
        log(r.beacon.name + " 信号可闻但天线未对准（偏差 "
          + Math.round(r.angleErr) + "°），请转动天线后重试。", "warn");
        break;
      case "duplicate":
        log(r.beacon.name + " 已完成定位，无需重复记录。", "warn");
        break;
      case "locked":
        log(r.beacon.name + " 定位成功！记录频率 "
          + NF.formatMHz(st.tuned) + "，频率误差 "
          + (r.freqErr * 1000).toFixed(0) + " Hz。", "good");
        break;
    }
    if (refreshChecklist() && lastFlash !== "done") {
      lastFlash = "done";
      log("全部任务完成：三次信标定位 + 一次误锁干扰验证。", "good");
    }
  }

  function bindControls() {
    el["ctl-angle"].addEventListener("input", function (e) {
      st.heading = Number(e.target.value);
      refreshReadouts();
    });
    el["ctl-freq"].addEventListener("input", function (e) {
      st.tuned = Number(e.target.value);
      refreshReadouts();
    });
    el["ctl-bw"].addEventListener("input", function (e) {
      st.bw = Number(e.target.value) / 1000;
      engine.updateFilter(st.bw);
      refreshReadouts();
    });
    el["ctl-vol"].addEventListener("input", function (e) {
      st.volume = Number(e.target.value) / 100;
      engine.setVolume(st.volume);
      refreshReadouts();
    });
    document.querySelectorAll("[data-step]").forEach(function (b) {
      b.addEventListener("click", function () {
        st.heading = (st.heading + Number(b.dataset.step) + 360) % 360;
        el["ctl-angle"].value = st.heading;
        refreshReadouts();
      });
    });
    document.querySelectorAll("[data-fstep]").forEach(function (b) {
      b.addEventListener("click", function () {
        var nextFreq = Number(st.tuned) + Number(b.dataset.fstep);
        st.tuned = Math.max(NF.CONST.F_MIN,
          Math.min(NF.CONST.F_MAX, nextFreq));
        el["ctl-freq"].value = st.tuned;
        refreshReadouts();
      });
    });
    document.querySelectorAll("[data-bw]").forEach(function (b) {
      b.addEventListener("click", function () {
        var next = Number(st.bw) * 1000 + Number(b.dataset.bw);
        next = Math.max(200, Math.min(3000, next));
        st.bw = next / 1000;
        el["ctl-bw"].value = next;
        engine.updateFilter(st.bw);
        refreshReadouts();
      });
    });
    el["btn-record"].addEventListener("click", onRecord);
    el["btn-reset"].addEventListener("click", resetMission);
  }

  function resetMission() {
    st = NF.createState();
    st.started = true;
    el["ctl-angle"].value = st.heading;
    el["ctl-freq"].value = st.tuned;
    el["ctl-bw"].value = st.bw * 1000;
    el["ctl-vol"].value = st.volume * 100;
    Array.prototype.forEach.call(el.checklist.children, function (li) {
      li.classList.remove("done");
      li.removeAttribute("data-note");
      var id = li.getAttribute("data-id");
      var name = { B1: "信标 α 定位", B2: "信标 β 定位",
        B3: "信标 γ 定位", D0: "误锁干扰验证" }[id];
      li.textContent = "";
      li.insertAdjacentHTML("afterbegin", '<i class="box"></i>' + name);
    });
    el["mission-done"].classList.add("hidden");
    el.log.innerHTML = "";
    lastFlash = "";
    engine.updateFilter(st.bw);
    engine.setVolume(st.volume);
    refreshReadouts();
    log("任务重置，重新开始监听。", "warn");
  }

  function frame(now) {
    var dt = Math.min(0.1, (now - last) / 1000 || 0);
    last = now;
    if (st.started) {
      st.simTime += dt;
      acc += dt;
      wfAcc += dt;
      engine.update(st);
      if (wfAcc >= 0.09) {
        wfAcc = 0;
        renderer.drawWaterfall(st);
      }
      renderer.drawCompass(st);
      renderer.drawMeter(engine.outputLevel());
      if (acc >= 0.25) {
        acc = 0;
        refreshReadouts();
      }
    }
    global.requestAnimationFrame(frame);
  }

  function boot() {
    $("boot-overlay").classList.add("hidden");
    engine.init();
    renderer = new NF.Renderer();
    st.started = true;
    engine.updateFilter(st.bw);
    engine.setVolume(st.volume);
    refreshReadouts();
    log("接收机已开机，底噪与邻频干扰将随时间增强。", "good");
    log("目标：定位信标 α / β / γ，并对游动干扰完成一次误锁验证。", "warn");
    global.addEventListener("resize", function () { renderer._resize(); });
    global.requestAnimationFrame(frame);
  }

  global.addEventListener("DOMContentLoaded", function () {
    cache();
    bindControls();
    refreshReadouts();
    $("btn-boot").addEventListener("click", boot);
  });

  // 调试/自动化句柄（不影响正常页面交互）
  NF.app = {
    getState: function () { return st; },
    record: onRecord
  };
})(typeof window !== "undefined" ? window : globalThis);
