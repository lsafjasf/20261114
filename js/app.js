/* 主控制器：把时间线、曲线编辑器、渲染、预设、音频、导出串起来。 */
(function () {
  "use strict";
  const HH = window.HH;
  const $ = (id) => document.getElementById(id);

  const els = {
    stage: $("stage"),
    edgeWarn: $("edgeWarn"),
    edgeWarnDetail: $("edgeWarnDetail"),
    hud: $("hud"),
    play: $("playBtn"),
    pause: $("pauseBtn"),
    stop: $("stopBtn"),
    prev: $("prevFrameBtn"),
    next: $("nextFrameBtn"),
    scrub: $("scrub"),
    readout: $("timeReadout"),
    duration: $("durationInput"),
    fps: $("fpsSelect"),
    safeToggle: $("safeToggle"),
    validate: $("validateBtn"),
    validateMsg: $("validateMsg"),
    exportFrame: $("exportFrameBtn"),
    exportLast: $("exportLastBtn"),
    presetSelect: $("presetSelect"),
    presetName: $("presetName"),
    savePreset: $("savePresetBtn"),
    deletePreset: $("deletePresetBtn"),
    exportPreset: $("exportPresetBtn"),
    importPreset: $("importPresetBtn"),
    importFile: $("importPresetFile"),
    curve: $("curve"),
    addPoint: $("addPointBtn"),
    deletePoint: $("deletePointBtn"),
    resetCurve: $("resetCurveBtn"),
    chTabs: document.querySelectorAll(".ch-tab"),
    audioEnable: $("audioEnableBtn"),
    stepRate: $("stepRate"),
    stepVolume: $("stepVolume"),
  };

  const config = HH.defaultConfig();
  const sceneCanvas = HH.createStreetScene();
  const editor = new HH.CurveEditor(els.curve, config, function () {
    refresh(true);
  });
  const renderer = new HH.Renderer(els.stage, sceneCanvas);
  const audio = new HH.FootstepAudio();

  const margin = HH.safeMargin(HH.SCENE_W, HH.SCENE_H, HH.VIEW_W, HH.VIEW_H);
  editor.safeLimits = {
    pan: { min: -margin.pan, max: margin.pan },
    tilt: { min: -margin.tilt, max: margin.tilt },
  };

  const timeline = new HH.Timeline({
    durationSec: Number(els.duration.value),
    fps: Number(els.fps.value),
    onTick: refresh,
    onEnded: function () {
      audio.stopScheduler();
      validateLastFrame(true);
    },
  });

  function fmtTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  function refresh() {
    const t = timeline.normalized();
    const state = HH.cameraState(config, t);
    const edges = renderer.render(state, t);
    editor.setPlayhead(t);

    const total = timeline.totalFrames();
    const frame = timeline.currentFrame();
    els.scrub.max = total - 1;
    els.scrub.value = frame;
    els.readout.textContent =
      fmtTime(timeline.currentTime) + " / " + fmtTime(timeline.durationSec) +
      " · 帧 " + frame + "/" + (total - 1);

    if (edges.length) {
      els.edgeWarn.hidden = false;
      els.edgeWarnDetail.textContent = edges.join(" / ") + " 侧超出街景边缘";
    } else {
      els.edgeWarn.hidden = true;
    }
  }

  function currentState() {
    return HH.cameraState(config, timeline.normalized());
  }

  /* ---------- 时间线控制 ---------- */
  els.play.addEventListener("click", function () {
    timeline.play();
    audio.startScheduler(
      () => timeline.currentTime, timeline.durationSec
    );
  });

  els.pause.addEventListener("click", function () {
    timeline.pause();
    audio.stopScheduler();
  });

  els.stop.addEventListener("click", function () {
    timeline.stop();
    audio.seek(() => timeline.currentTime, timeline.durationSec, false);
  });

  els.prev.addEventListener("click", function () {
    timeline.step(-1);
    audio.seek(() => timeline.currentTime, timeline.durationSec, false);
  });

  els.next.addEventListener("click", function () {
    timeline.step(1);
    audio.seek(() => timeline.currentTime, timeline.durationSec, false);
  });

  els.scrub.addEventListener("input", function () {
    timeline.pause();
    timeline.seekFrame(Number(els.scrub.value));
    audio.seek(() => timeline.currentTime, timeline.durationSec, false);
  });

  els.duration.addEventListener("change", function () {
    timeline.setDuration(Number(els.duration.value) || 4);
    refresh();
  });

  els.fps.addEventListener("change", function () {
    timeline.setFps(Number(els.fps.value));
    refresh();
  });

  els.safeToggle.addEventListener("change", function () {
    renderer.showSafe = els.safeToggle.checked;
    editor.setSafeVisible(els.safeToggle.checked);
  });

  els.chTabs.forEach((tab) => {
    tab.addEventListener("click", function () {
      els.chTabs.forEach((b) => b.classList.remove("active"));
      tab.classList.add("active");
      editor.setChannel(tab.dataset.ch);
    });
  });

  els.addPoint.addEventListener("click", () => editor.addPoint());
  els.deletePoint.addEventListener("click", () => editor.deleteSelected());
  els.resetCurve.addEventListener("click", () => editor.resetChannel());

  /* ---------- 预设 ---------- */
  function rebuildPresetList(selectName) {
    const list = HH.listPresets();
    els.presetSelect.innerHTML = "";
    list.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.name;
      opt.textContent = (p.builtin ? "◆ " : "● ") + p.name;
      els.presetSelect.appendChild(opt);
    });
    if (selectName) els.presetSelect.value = selectName;
  }

  function applyConfig(src) {
    ["pan", "tilt", "roll"].forEach((ch) => {
      config[ch].points = src[ch].points
        .map((p) => ({ t: HH.clamp(p.t, 0, 1), v: Number(p.v) }))
        .sort((a, b) => a.t - b.t);
    });
    editor.selected = null;
    editor.draw();
    refresh();
  }

  rebuildPresetList();

  els.presetSelect.addEventListener("change", function () {
    const preset = HH.getPreset(els.presetSelect.value);
    if (preset) {
      applyConfig(preset.config);
      els.presetName.value = preset.builtin ? "" : preset.name;
    }
  });

  els.savePreset.addEventListener("click", function () {
    const name = els.presetName.value.trim();
    if (!name) {
      alert("请先输入预设名称");
      return;
    }
    HH.savePreset(name, config);
    rebuildPresetList(name);
    els.presetSelect.value = name;
  });

  els.deletePreset.addEventListener("click", function () {
    const preset = HH.getPreset(els.presetSelect.value);
    if (!preset || preset.builtin) {
      alert("内置预设不可删除");
      return;
    }
    HH.deletePreset(preset.name);
    rebuildPresetList();
    els.presetName.value = "";
  });

  els.exportPreset.addEventListener("click", function () {
    const name = els.presetName.value.trim() ||
      els.presetSelect.value || "未命名预设";
    const blob = new Blob([HH.serializePreset(name, config)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name.replace(/[^\w\u4e00-\u9fa5]+/g, "_") + ".json";
    a.click();
    URL.revokeObjectURL(url);
  });

  els.importPreset.addEventListener("click", () => els.importFile.click());
  els.importFile.addEventListener("change", function () {
    const file = els.importFile.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const preset = HH.parsePresetFile(String(reader.result));
        applyConfig(preset.config);
        els.presetName.value = preset.name;
        HH.savePreset(preset.name, preset.config);
        rebuildPresetList(preset.name);
      } catch (err) {
        alert(err.message);
      }
      els.importFile.value = "";
    };
    reader.readAsText(file);
  });

  /* ---------- 脚步声 ---------- */
  els.audioEnable.addEventListener("click", function () {
    if (audio.enabled) {
      audio.disable();
      els.audioEnable.textContent = "启用脚步声";
    } else {
      audio.enable();
      els.audioEnable.textContent = "关闭脚步声";
      if (timeline.playing) {
        audio.startScheduler(() => timeline.currentTime, timeline.durationSec);
      }
    }
  });

  els.stepRate.addEventListener("change", function () {
    audio.setRate(Number(els.stepRate.value) || 1.8);
    audio.seek(() => timeline.currentTime, timeline.durationSec, timeline.playing);
  });

  els.stepVolume.addEventListener("input", function () {
    audio.setVolume(Number(els.stepVolume.value));
  });

  /* ---------- 校验与导出 ---------- */
  function setValidateMsg(ok, text) {
    els.validateMsg.className = "validate-msg " + (ok ? "ok" : "bad");
    els.validateMsg.textContent = text;
  }

  function validateLastFrame(silent) {
    const endState = HH.cameraState(config, 1);
    const edges = HH.overscanEdges(
      HH.SCENE_W, HH.SCENE_H, HH.VIEW_W, HH.VIEW_H, endState
    );
    if (!edges.length) {
      if (!silent) setValidateMsg(true, "✓ 末尾帧未越出画面，取景框完整落在街景内。");
      return true;
    }
    setValidateMsg(false, "✗ 末尾帧越界：" + edges.join(" / ") + " 侧露出街景边缘。");
    return false;
  }

  els.validate.addEventListener("click", function () {
    const hits = HH.findOvershoot(
      config, timeline.durationSec, timeline.fps,
      { sceneW: HH.SCENE_W, sceneH: HH.SCENE_H, viewW: HH.VIEW_W, viewH: HH.VIEW_H }
    );
    const endOk = validateLastFrame(true);
    if (!hits.length && endOk) {
      setValidateMsg(true, "✓ 全片 " + timeline.totalFrames() +
        " 帧均未露边，末尾帧同样安全。");
    } else if (!hits.length) {
      setValidateMsg(false, "✗ 帧采样未发现越界，但末尾帧校验失败。");
    } else {
      const first = hits[0];
      setValidateMsg(false, "✗ 共 " + hits.length + " 帧露边，首次出现在第 " +
        first.frame + " 帧（" + first.edges.join("/") + "侧）；" +
        (endOk ? "末尾帧安全。" : "末尾帧也越界。"));
    }
  });

  function downloadPng(dataUrl, filename) {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    a.click();
  }

  els.exportFrame.addEventListener("click", function () {
    const dataUrl = renderer.exportFrame(currentState());
    downloadPng(dataUrl, "handheld-frame-" + timeline.currentFrame() + ".png");
    validateLastFrame(true);
  });

  els.exportLast.addEventListener("click", function () {
    const endState = HH.cameraState(config, 1);
    const dataUrl = renderer.exportFrame(endState);
    downloadPng(dataUrl, "handheld-last-frame.png");
    validateLastFrame(false);
  });

  window.HH_APP = { config, timeline, refresh, currentState, renderer, audio };
  refresh();
})();
