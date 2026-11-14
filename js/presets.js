/* 预设管理：内置手持风格 + localStorage 自定义预设。 */
(function () {
  "use strict";
  const HH = (window.HH = window.HH || globalThis.HH || {}); globalThis.HH = HH;
  const STORE_KEY = "handheld-street-presets-v1";

  /* 通道值域（曲线编辑器纵轴范围）。pan/tilt 单位为场景像素，roll 为度。 */
  HH.CHANNEL_RANGES = {
    pan: { min: -320, max: 320, unit: "px", label: "水平晃动" },
    tilt: { min: -180, max: 180, unit: "px", label: "垂直晃动" },
    roll: { min: -6, max: 6, unit: "°", label: "轻微旋转" },
  };

  function curve(points) {
    return { points: points.map(([t, v]) => ({ t, v })) };
  }

  HH.defaultConfig = function defaultConfig() {
    return {
      pan: curve([
        [0, 0], [0.15, 26], [0.32, -34], [0.5, 18],
        [0.68, -28], [0.85, 22], [1, 0],
      ]),
      tilt: curve([
        [0, 0], [0.2, -14], [0.42, 16], [0.62, -10],
        [0.82, 12], [1, 0],
      ]),
      roll: curve([
        [0, 0], [0.25, 0.9], [0.5, -1.1], [0.75, 0.7], [1, 0],
      ]),
    };
  };

  HH.builtinPresets = [
    {
      name: "轻微手持（默认）",
      builtin: true,
      config: HH.defaultConfig(),
    },
    {
      name: "走路跟拍",
      builtin: true,
      config: {
        pan: curve([
          [0, -10], [0.12, 40], [0.25, -46], [0.38, 36],
          [0.5, -52], [0.62, 42], [0.75, -38], [0.88, 30], [1, 0],
        ]),
        tilt: curve([
          [0, 0], [0.12, 24], [0.25, -26], [0.38, 22],
          [0.5, -28], [0.62, 20], [0.75, -22], [0.88, 16], [1, 0],
        ]),
        roll: curve([
          [0, 0], [0.2, 1.6], [0.4, -1.8], [0.6, 1.4], [0.8, -1.2], [1, 0],
        ]),
      },
    },
    {
      name: "剧烈奔跑（易露边）",
      builtin: true,
      config: {
        pan: curve([
          [0, 0], [0.1, 300], [0.3, -330], [0.5, 360],
          [0.7, -350], [0.9, 320], [1, 0],
        ]),
        tilt: curve([
          [0, 0], [0.15, 150], [0.35, -170], [0.55, 185],
          [0.75, -175], [1, 0],
        ]),
        roll: curve([
          [0, 0], [0.25, 4.5], [0.5, -5], [0.75, 4], [1, 0],
        ]),
      },
    },
  ];

  function readCustom() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (err) {
      console.warn("读取预设失败", err);
      return [];
    }
  }

  function writeCustom(list) {
    localStorage.setItem(STORE_KEY, JSON.stringify(list));
  }

  HH.listPresets = function listPresets() {
    return HH.builtinPresets.map((p) => ({ name: p.name, builtin: true }))
      .concat(readCustom().map((p) => ({ name: p.name, builtin: false })));
  };

  HH.getPreset = function getPreset(name) {
    const all = HH.builtinPresets.concat(readCustom());
    return all.find((p) => p.name === name) || null;
  };

  HH.savePreset = function savePreset(name, config) {
    const list = readCustom().filter((p) => p.name !== name);
    list.push({ name, config: JSON.parse(JSON.stringify(config)) });
    writeCustom(list);
  };

  HH.deletePreset = function deletePreset(name) {
    writeCustom(readCustom().filter((p) => p.name !== name));
  };

  HH.serializePreset = function serializePreset(name, config) {
    return JSON.stringify({
      type: "handheld-street-preset",
      version: 1,
      name,
      config,
    }, null, 2);
  };

  HH.parsePresetFile = function parsePresetFile(text) {
    const data = JSON.parse(text);
    if (!data || data.type !== "handheld-street-preset" || !data.config) {
      throw new Error("不是有效的手持街景预设文件");
    }
    ["pan", "tilt", "roll"].forEach((ch) => {
      if (!Array.isArray(data.config[ch].points)) throw new Error("预设缺少通道 " + ch);
    });
    return { name: data.name || "导入的预设", config: data.config };
  };
})();
