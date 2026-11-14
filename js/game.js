/* 主控：UI 绑定、连续走纸循环、日志、重置与失败判定。 */
(function () {
  "use strict";
  var L = PressLogic;
  var $ = function (id) { return document.getElementById(id); };

  var sheetCanvas = $("sheetCanvas"), scopeCanvas = $("scopeCanvas"), stackCanvas = $("stackCanvas");
  var adjX = $("adjX"), adjY = $("adjY"), adjP = $("adjP");
  var valX = $("valX"), valY = $("valY"), valP = $("valP");
  var btnRun = $("btnRun"), btnReset = $("btnReset");
  var pressStatus = $("pressStatus"), scopeReadout = $("scopeReadout");
  var tally = $("tally"), logList = $("logList");

  var job = null;
  var timer = null;

  function log(msg, cls) {
    var li = document.createElement("li");
    li.textContent = msg;
    li.className = cls || "info";
    logList.appendChild(li);
    logList.parentElement.scrollTop = logList.parentElement.scrollHeight;
  }

  function fmt(v) { return (v >= 0 ? "+" : "") + v.toFixed(2); }

  function currentDrift() {
    if (!job || job.index >= L.SHEETS_PER_JOB) return { x: 0, y: 0 };
    return job.trend[job.index];
  }

  /* 实时预览：放大镜显示当前补偿下的预估误差（不含走纸抖动） */
  function refreshPreview() {
    var ax = parseFloat(adjX.value), ay = parseFloat(adjY.value);
    var p = parseInt(adjP.value, 10);
    valX.textContent = fmt(ax) + " mm";
    valY.textContent = fmt(ay) + " mm";
    valP.textContent = p + " %";
    var d = currentDrift();
    var ex = d.x - ax, ey = d.y - ay;
    var tol = p < L.PRESSURE_STARVE ? L.TIGHT_TOLERANCE : L.TOLERANCE_MM;
    PressRender.drawScope(scopeCanvas, ex, ey, tol);
    PressRender.drawSheet(sheetCanvas, ex, ey, { wrinkled: p > L.PRESSURE_WRINKLE });
    scopeReadout.textContent = "误差 X " + fmt(ex) + "mm / Y " + fmt(ey) +
      "mm · 容差 " + tol.toFixed(2) + "mm";
  }

  function refreshTally() {
    tally.textContent = "良品 " + job.good + " / " + L.SHEETS_PER_JOB +
      " · 废纸 " + job.waste + "（上限 " + L.MAX_WASTE + "）";
    PressRender.drawStack(stackCanvas, job.history);
  }

  function printOne() {
    var ax = parseFloat(adjX.value), ay = parseFloat(adjY.value);
    var p = parseInt(adjP.value, 10);
    var sheet = job.printNext(ax, ay, p);
    if (!sheet) return;
    PressAudio.cut();
    var r = sheet.result;
    if (r.wrinkled) PressAudio.alarm();
    var tag = r.pass ? "ok" : "bad";
    var reason = r.wrinkled ? "起皱报废" :
      (r.pass ? "套准合格" : "超差 " + r.err.toFixed(2) + "mm");
    log("第 " + sheet.no + " 张：漂移(" + fmt(sheet.drift.x) + "," + fmt(sheet.drift.y) +
        ") 残差(" + fmt(r.errX) + "," + fmt(r.errY) + ") " + reason, tag);
    pressStatus.textContent = "第 " + sheet.no + " 张 · " + reason;
    refreshTally();
    refreshPreview();
    if (job.done) finishJob();
  }

  function finishJob() {
    clearInterval(timer);
    timer = null;
    PressAudio.stopRoller();
    btnRun.disabled = true;
    btnReset.disabled = false;
    if (job.failed) {
      var why = job.waste > L.MAX_WASTE ? "废纸超限" : "良品不足";
      pressStatus.textContent = "订单失败：" + why + "（良品 " + job.good + "）";
      log("订单失败：" + why + "，良品 " + job.good + " / " + L.SHEETS_PER_JOB, "bad");
      PressAudio.alarm();
    } else {
      pressStatus.textContent = "订单完成！良品 " + job.good + " / " + L.SHEETS_PER_JOB;
      log("订单完成，良品 " + job.good + " / " + L.SHEETS_PER_JOB, "ok");
    }
  }

  function startJob() {
    job = L.createJob(L.DEFAULT_SEED);
    logList.innerHTML = "";
    log("开机，seed=" + job.seed + "，目标 " + L.SHEETS_PER_JOB + " 张", "info");
    btnRun.disabled = true;
    btnReset.disabled = true;
    pressStatus.textContent = "走纸中…";
    PressAudio.startRoller();
    refreshTally();
    refreshPreview();
    timer = setInterval(printOne, 1100);
  }

  function resetJob() {
    if (timer) { clearInterval(timer); timer = null; }
    PressAudio.stopRoller();
    job = null;
    logList.innerHTML = "";
    log("已重置：同一 seed，漂移趋势不变，可据此调整补偿策略", "info");
    btnRun.disabled = false;
    btnReset.disabled = true;
    pressStatus.textContent = "待机";
    tally.textContent = "良品 0 / " + L.SHEETS_PER_JOB + " · 废纸 0";
    PressRender.drawStack(stackCanvas, []);
    refreshPreview();
  }

  adjX.addEventListener("input", refreshPreview);
  adjY.addEventListener("input", refreshPreview);
  adjP.addEventListener("input", refreshPreview);
  btnRun.addEventListener("click", startJob);
  btnReset.addEventListener("click", resetJob);

  refreshPreview();
  PressRender.drawStack(stackCanvas, []);
})();
