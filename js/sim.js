(function (root) {
  "use strict";

  const SAFE = {
    temp: 30.0,
    moistureLow: 13.0,
    moistureHigh: 18.4,
    crackFail: 0.72,
    moldFail: 0.52,
    wetFail: 0.96
  };

  const BIN_SEEDS = [
    {
      id: "A",
      code: "01",
      name: "东仓",
      crop: "硬质小麦",
      temp: 24.8,
      moisture: 15.2,
      wetZone: 0.16,
      cracks: 0.04,
      mold: 0,
      hotspot: 0,
      hotspotSeen: false,
      handled: false,
      spoiled: false,
      failReason: ""
    },
    {
      id: "B",
      code: "02",
      name: "中仓",
      crop: "饲用玉米",
      temp: 25.9,
      moisture: 16.4,
      wetZone: 0.31,
      cracks: 0.07,
      mold: 0,
      hotspot: 0,
      hotspotSeen: false,
      handled: false,
      spoiled: false,
      failReason: ""
    },
    {
      id: "C",
      code: "03",
      name: "西仓",
      crop: "酿酒高粱",
      temp: 27.1,
      moisture: 18.1,
      wetZone: 0.58,
      cracks: 0.05,
      mold: 0,
      hotspot: 0,
      hotspotSeen: false,
      handled: false,
      spoiled: false,
      failReason: ""
    }
  ];

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function round(value, digits) {
    const scale = Math.pow(10, digits || 0);
    return Math.round(value * scale) / scale;
  }

  function copyBins() {
    return BIN_SEEDS.map(function (bin) {
      return Object.assign({}, bin);
    });
  }

  function createSim(options) {
    const opts = options || {};
    const state = {
      elapsed: opts.startAt || 0,
      duration: 600,
      status: "running",
      paused: false,
      speed: 4,
      controls: {
        fan: 34,
        vents: [true, true, false],
        sound: true
      },
      turner: {
        activeBin: -1,
        remaining: 0,
        cooldown: 0,
        uses: 0,
        energy: 0
      },
      bins: copyBins(),
      events: [],
      hotspotTriggered: false,
      ticks: 0,
      fanEnergy: 0,
      objective: {
        safeBins: 0,
        hotspotHandled: 0
      },
      lastSnapshot: null
    };
    state.lastSnapshot = snapshot(state);
    return state;
  }

  function addEvent(state, type, message, binId) {
    state.events.unshift({
      t: Math.round(state.elapsed),
      type: type,
      message: message,
      binId: binId || ""
    });
    if (state.events.length > 24) state.events.length = 24;
  }

  function airflowFor(state, index) {
    const vent = state.controls.vents[index] ? 1 : 0.12;
    return (state.controls.fan / 100) * vent;
  }

  function severityFor(bin) {
    if (bin.spoiled) return "failed";
    if (bin.mold > 0.3 || bin.temp > 30.4 || bin.cracks > 0.58 || bin.wetZone > 0.84) {
      return "critical";
    }
    if (bin.mold > 0.08 || bin.temp > 28.7 || bin.moisture > 17.7 || bin.wetZone > 0.66 || bin.cracks > 0.32) {
      return "warning";
    }
    return "safe";
  }

  function activateTurner(state, index) {
    const turner = state.turner;
    if (index < 0 || index > 2 || turner.activeBin !== -1 || turner.cooldown > 0) {
      return false;
    }
    if (state.status !== "running" || state.bins[index].spoiled) return false;
    turner.activeBin = index;
    turner.remaining = 30;
    turner.uses += 1;
    addEvent(state, "turner", "翻谷机进入 " + state.bins[index].name + "，开始打破湿热层。", state.bins[index].id);
    return true;
  }

  function setFan(state, value) {
    state.controls.fan = clamp(Math.round(value), 0, 100);
  }

  function toggleVent(state, index) {
    if (index < 0 || index > 2) return;
    state.controls.vents[index] = !state.controls.vents[index];
    addEvent(
      state,
      "vent",
      state.bins[index].name + "风窗" + (state.controls.vents[index] ? "开启" : "关闭") + "。",
      state.bins[index].id
    );
  }

  function snapshot(state) {
    return {
      elapsed: state.elapsed,
      fan: state.controls.fan,
      vents: state.controls.vents.slice(),
      bins: state.bins.map(function (bin) {
        return {
          id: bin.id,
          temp: round(bin.temp, 1),
          moisture: round(bin.moisture, 1),
          wetZone: round(bin.wetZone, 2),
          cracks: round(bin.cracks, 2),
          mold: round(bin.mold, 2),
          hotspot: round(bin.hotspot, 2),
          severity: severityFor(bin),
          spoiled: bin.spoiled
        };
      })
    };
  }

  function markSpoiled(state, bin, reason) {
    if (bin.spoiled) return;
    bin.spoiled = true;
    bin.failReason = reason;
    addEvent(state, "fail", bin.name + "失守：" + reason + "。", bin.id);
  }

  function adjustTurner(state, dt) {
    const turner = state.turner;
    if (turner.activeBin !== -1) {
      turner.remaining -= dt;
      turner.energy += dt * 1.7;
      if (turner.remaining <= 0) {
        const finishedBin = state.bins[turner.activeBin];
        turner.activeBin = -1;
        turner.remaining = 0;
        turner.cooldown = 45;
        addEvent(state, "turner", finishedBin.name + "翻谷完成，机械进入冷却。", finishedBin.id);
      }
      return;
    }
    if (turner.cooldown > 0) turner.cooldown = Math.max(0, turner.cooldown - dt);
  }

  function updateBin(state, bin, index, dt) {
    const flow = airflowFor(state, index);
    const turnerOn = state.turner.activeBin === index;
    const ventOpen = state.controls.vents[index];

    const moistureGain = 0.00048 + Math.max(0, bin.wetZone - 0.2) * 0.00082 + bin.hotspot * 0.0003;
    const moistureLoss = flow * 0.00375 + (turnerOn ? 0.00055 : 0);
    bin.moisture = clamp(bin.moisture + (moistureGain - moistureLoss) * dt, 10.5, 23);

    const excess = bin.moisture - 16.15;
    let wetRate = excess > 0 ? 0.00016 + excess * 0.0005 : -0.00048;
    wetRate -= flow * 0.00092;
    wetRate -= turnerOn ? 0.0042 : 0;
    bin.wetZone = clamp(bin.wetZone + wetRate * dt, 0, 1);

    if (bin.wetZone > 0.65) {
      bin.mold = clamp(bin.mold + (bin.wetZone - 0.65) * 0.061 * dt, 0, 1);
    } else {
      bin.mold = clamp(bin.mold - 0.0004 * dt, 0, 1);
    }

    const dryness = clamp((flow - 0.48) * 1.1 + (14.8 - bin.moisture) * 0.16, 0, 1);
    if (dryness > 0.01) {
      bin.cracks = clamp(bin.cracks + dryness * 0.0043 * dt, 0, 1);
    } else {
      bin.cracks = clamp(bin.cracks - 0.0006 * dt, 0, 1);
    }

    if (bin.hotspotSeen) {
      if (turnerOn) {
        bin.hotspot = Math.max(0, bin.hotspot - 0.053 * dt);
      } else {
        bin.hotspot = Math.min(1.55, bin.hotspot + 0.0035 * dt);
      }
      if (bin.hotspot < 0.16 && !bin.handled) {
        bin.handled = true;
        addEvent(state, "success", bin.name + "热点已被翻谷机打散，温度恢复受控。", bin.id);
      }
    }

    const respiration = 0.0009 + bin.wetZone * 0.0036 + Math.max(0, bin.moisture - 15.6) * 0.0015;
    const heat = respiration + bin.mold * 0.0025 + bin.hotspot * 0.024;
    const lowHeat = maxLowHeat(bin.temp);
    const cooling = flow * 0.013 + (turnerOn ? 0.018 : 0);
    bin.temp = clamp(bin.temp + (heat + lowHeat - cooling) * dt, 17.5, 44);

    if (bin.temp >= 33.0) markSpoiled(state, bin, "高温失控，呼吸热已超过排热能力");
    if (bin.mold >= SAFE.moldFail) markSpoiled(state, bin, "湿区霉变扩散");
    if (bin.cracks >= SAFE.crackFail) markSpoiled(state, bin, "强风造成局部干裂");
    if (bin.wetZone >= SAFE.wetFail) markSpoiled(state, bin, "湿区越过安全边界");
    if (bin.moisture >= 19.6) markSpoiled(state, bin, "粮堆含水率过高");

    const severity = severityFor(bin);
    const before = bin.lastSeverity || "safe";
    if (severity !== before && (severity === "critical" || severity === "warning")) {
      const label = severity === "critical" ? "临界告警" : "注意";
      addEvent(
        state,
        severity === "critical" ? "alert" : "warn",
        bin.name + label + "：温度 " + bin.temp.toFixed(1) + "°C，含水 " + bin.moisture.toFixed(1) + "%。",
        bin.id
      );
    }
    bin.lastSeverity = severity;
    bin.velocity = flow;
  }

  function maxLowHeat(temp) {
    return Math.max(0, 21.5 - temp) * 0.004;
  }

  function isPreserved(bin) {
    return (
      !bin.spoiled &&
      bin.temp <= 30.6 &&
      bin.moisture <= 18.6 &&
      bin.moisture >= 12.5 &&
      bin.cracks < 0.65 &&
      bin.mold < 0.3 &&
      bin.wetZone < 0.83
    );
  }

  function finish(state, won) {
    if (state.status !== "running") return;
    state.status = won ? "won" : "lost";
    state.paused = true;
    const preserved = state.bins.filter(isPreserved).length;
    const handled = state.objective.hotspotHandled;
    addEvent(
      state,
      won ? "success" : "fail",
      won
        ? "十分钟窗口结束：保住 " + preserved + " 格，热点处置 " + handled + " 处。"
        : "十分钟窗口失守：仅保住 " + preserved + " 格，热点处置 " + handled + " 处。",
      ""
    );
  }

  function refreshObjective(state) {
    state.objective.safeBins = state.bins.filter(function (bin) {
      return !bin.spoiled;
    }).length;
    state.objective.hotspotHandled = state.bins.filter(function (bin) {
      return bin.handled;
    }).length;
  }

  function step(state, dt) {
    if (!state || state.status !== "running" || state.paused) return state;
    let remaining = clamp(Number(dt) || 0, 0, 30);
    while (remaining > 0.0001 && state.status === "running") {
      const slice = Math.min(remaining, 0.125);
      advance(state, slice);
      remaining -= slice;
    }
    return state;
  }

  function advance(state, dt) {
    state.elapsed = Math.min(state.duration, state.elapsed + dt);
    state.ticks += 1;
    state.fanEnergy += (state.controls.fan / 100) * 0.55 * dt;
    adjustTurner(state, dt);

    if (!state.hotspotTriggered && state.elapsed >= 75) {
      const hotBin = state.bins[1];
      state.hotspotTriggered = true;
      hotBin.hotspotSeen = true;
      hotBin.hotspot = Math.max(hotBin.hotspot, 0.62);
      addEvent(state, "alert", "热点扫描：中仓内部出现 37.8°C 局部热团，建议立即翻谷。", hotBin.id);
    }

    for (let index = 0; index < state.bins.length; index += 1) {
      updateBin(state, state.bins[index], index, dt);
    }

    refreshObjective(state);
    const spoiled = state.bins.filter(function (bin) {
      return bin.spoiled;
    }).length;
    if (spoiled >= 2) {
      finish(state, false);
      return;
    }
    if (state.elapsed >= state.duration) {
      const preserved = state.bins.filter(isPreserved).length;
      finish(state, preserved >= 2 && state.objective.hotspotHandled >= 1);
    }
  }

  function runScenario(config) {
    const state = createSim();
    state.controls.fan = config.fan;
    state.controls.vents = config.vents.slice();
    const actions = config.actions || [];
    let actionIndex = 0;
    while (state.status === "running" && state.elapsed < state.duration) {
      while (actionIndex < actions.length && state.elapsed >= actions[actionIndex].at) {
        if (actions[actionIndex].turner !== undefined) {
          root.GrainSim.activateTurner(state, actions[actionIndex].turner);
        }
        actionIndex += 1;
      }
      step(state, 0.5);
    }
    return state;
  }

  function validateScenarios() {
    const rescue = runScenario({
      fan: 68,
      vents: [false, true, true],
      actions: [
        { at: 79, turner: 1 },
        { at: 158, turner: 2 }
      ]
    });
    const mold = runScenario({
      fan: 0,
      vents: [false, false, false],
      actions: []
    });
    const rescueSafe = rescue.bins.filter(isPreserved).length;
    const moldBin = mold.bins[2];
    return {
      rescue: {
        name: "救火式调节",
        passed: rescue.status === "won" && rescueSafe >= 2 && rescue.objective.hotspotHandled >= 1,
        status: rescue.status,
        safeBins: rescueSafe,
        handled: rescue.objective.hotspotHandled,
        detail:
          "关闭东仓风窗，集中 68% 风量冷却中、西仓；热点出现后翻中仓，再翻西仓降湿。"
      },
      mold: {
        name: "湿区霉变",
        passed: mold.status === "lost" && moldBin.spoiled && /霉变/.test(moldBin.failReason),
        status: mold.status,
        safeBins: mold.bins.filter(isPreserved).length,
        detail: "停机并关闭风窗，西仓湿区持续扩张；" + (moldBin.failReason || "未发生霉变") + "。"
      }
    };
  }

  root.GrainSim = {
    SAFE: SAFE,
    createSim: createSim,
    activateTurner: activateTurner,
    setFan: setFan,
    toggleVent: toggleVent,
    severityFor: severityFor,
    snapshot: snapshot,
    step: step,
    isPreserved: isPreserved,
    validateScenarios: validateScenarios
  };
  if (typeof module === "object" && module.exports) {
    module.exports = root.GrainSim;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
