(function initSkyMedCore(global) {
  "use strict";

  const CONFIG = Object.freeze({
    missionSeconds: 75,
    energyPerPixel: 0.075,
    heatPerEnergy: 0.5,
    weightPerPackage: 0.32,
    flightSpeed: 92,
    takeoffHeatLimit: 85,
    failureHeat: 100,
    usableHeatLimit: 85,
    coolingAmount: 26,
    coolingSeconds: 4,
    swapSeconds: 0
  });

  const PLATFORM_DEFS = Object.freeze([
    {
      id: "HUB",
      short: "HUB",
      name: "中央机库",
      role: "换电 / 冷却",
      x: 260,
      y: 500,
      swap: true,
      color: "#64e8c1"
    },
    {
      id: "T1",
      short: "T1",
      name: "东塔急诊",
      role: "仅冷却",
      x: 740,
      y: 260,
      swap: false,
      color: "#ff8a65"
    },
    {
      id: "T2",
      short: "T2",
      name: "北塔儿科",
      role: "仅冷却",
      x: 245,
      y: 160,
      swap: false,
      color: "#ffd166"
    },
    {
      id: "R1",
      short: "R1",
      name: "南塔中继",
      role: "换电 / 冷却",
      x: 750,
      y: 590,
      swap: true,
      color: "#8fb8ff"
    }
  ]);

  const HEAT_ZONE_DEFS = Object.freeze([
    { id: "HZ-A", name: "热浪 A", x: 505, y: 405, radius: 120, heat: 15 },
    { id: "HZ-B", name: "热浪 B", x: 485, y: 210, radius: 105, heat: 14 },
    { id: "HZ-C", name: "热浪 C", x: 690, y: 535, radius: 85, heat: 12 }
  ]);

  const PACKAGE_DEFS = Object.freeze([
    {
      id: "PKG-A",
      name: "血袋恒温箱",
      code: "MED-A",
      targetId: "T1",
      originId: "HUB",
      color: "#ffc05c"
    },
    {
      id: "PKG-B",
      name: "抗毒血清",
      code: "MED-B",
      targetId: "T2",
      originId: "HUB",
      color: "#ffd166"
    }
  ]);

  const BATTERY_DEFS = Object.freeze([
    { id: "BAT-01", name: "冷备 01", charge: 100, heat: 8 },
    { id: "BAT-02", name: "主电池 02", charge: 82, heat: 18 },
    { id: "BAT-03", name: "备用 03", charge: 64, heat: 42 },
    { id: "BAT-04", name: "临界 04", charge: 48, heat: 78 },
    { id: "BAT-05", name: "冷备 05", charge: 100, heat: 4 }
  ]);

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function round(value, digits) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function platformById(id) {
    return PLATFORM_DEFS.find((platform) => platform.id === id) || null;
  }

  function packageById(game, id) {
    return game.packages.find((item) => item.id === id) || null;
  }

  function batteryById(game, id) {
    return game.batteries.find((item) => item.id === id) || null;
  }

  function installedBattery(game) {
    return batteryById(game, game.installedBatteryId);
  }

  function distanceBetween(from, to) {
    return Math.hypot(to.x - from.x, to.y - from.y);
  }

  function segmentCircleOverlap(from, to, zone) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq === 0) {
      return 0;
    }

    const length = Math.sqrt(lengthSq);
    const projection =
      ((zone.x - from.x) * dx + (zone.y - from.y) * dy) / lengthSq;
    const closestX = from.x + clamp(projection, 0, 1) * dx;
    const closestY = from.y + clamp(projection, 0, 1) * dy;
    const centerDistance = Math.hypot(zone.x - closestX, zone.y - closestY);

    if (centerDistance >= zone.radius) {
      return 0;
    }

    const halfChord = Math.sqrt(zone.radius ** 2 - centerDistance ** 2);
    const startT = projection - halfChord / length;
    const endT = projection + halfChord / length;
    const overlapT = Math.max(0, Math.min(1, endT) - Math.max(0, startT));
    return overlapT * length;
  }

  function routeExposure(from, to) {
    const routeLength = distanceBetween(from, to);
    if (!routeLength) {
      return { total: 0, zones: [] };
    }

    const zones = HEAT_ZONE_DEFS.map((zone) => {
      const overlap = segmentCircleOverlap(from, to, zone);
      return {
        id: zone.id,
        name: zone.name,
        ratio: overlap / routeLength,
        heat: round((overlap / routeLength) * zone.heat, 1)
      };
    }).filter((zone) => zone.ratio > 0);

    return {
      total: round(zones.reduce((sum, zone) => sum + zone.heat, 0), 1),
      zones
    };
  }

  function loadedPackages(game) {
    return game.packages.filter((item) => item.loaded && !item.delivered);
  }

  function deliveredCount(game) {
    return game.packages.filter((item) => item.delivered).length;
  }

  function weightFactor(game) {
    return 1 + loadedPackages(game).length * CONFIG.weightPerPackage;
  }

  function isBatteryUsable(battery) {
    return (
      Boolean(battery) &&
      battery.charge > 0 &&
      battery.heat < CONFIG.usableHeatLimit
    );
  }

  function usableBatteryCount(game) {
    return game.batteries.filter(isBatteryUsable).length;
  }

  function createGame(now) {
    const start = Number.isFinite(now) ? now : 0;
    return {
      version: 1,
      status: "briefing",
      started: false,
      startedAt: null,
      missionEndsAt: null,
      now: start,
      timeLeft: CONFIG.missionSeconds,
      currentPlatformId: "HUB",
      installedBatteryId: "BAT-01",
      selectedDestinationId: null,
      packages: clone(PACKAGE_DEFS).map((item) => ({
        ...item,
        loaded: false,
        delivered: false,
        deliveredAt: null
      })),
      batteries: clone(BATTERY_DEFS).map((item) => ({
        ...item,
        maxCharge: 100
      })),
      flight: null,
      cooling: null,
      routeHistory: [],
      swapCount: 0,
      deliveredCount: 0,
      lastEvent: null,
      lossReason: null,
      log: []
    };
  }

  function pushLog(game, message, now) {
    game.log.unshift({
      message,
      at: Number.isFinite(now) ? now : game.now
    });
    game.log = game.log.slice(0, 12);
  }

  function result(ok, code, message, extra) {
    return {
      ok,
      code: code || (ok ? "ok" : "invalid"),
      message,
      ...(extra || {})
    };
  }

  function startMission(game, now) {
    if (game.status === "won" || game.status === "lost") {
      return result(false, "mission-ended", "任务已经结束");
    }
    if (game.started) {
      return result(true, "already-started", "任务计时已开始");
    }

    const stamp = Number.isFinite(now) ? now : game.now;
    game.started = true;
    game.startedAt = stamp;
    game.missionEndsAt = stamp + CONFIG.missionSeconds * 1000;
    game.timeLeft = CONFIG.missionSeconds;
    game.now = stamp;
    if (game.status === "briefing") {
      game.status = "ready";
    }
    game.lastEvent = { type: "mission-start", at: stamp };
    pushLog(game, "任务开始：75 秒投送窗口已启动。", stamp);
    return result(true, "started", "任务计时开始");
  }

  function ensureMissionStarted(game, now) {
    if (!game.started) {
      return startMission(game, now);
    }
    return result(true, "already-started", "任务计时已开始");
  }

  function togglePackage(game, packageId, now) {
    if (game.status !== "briefing" && game.status !== "ready") {
      return result(false, "drone-busy", "无人机当前无法调整货物");
    }

    const item = packageById(game, packageId);
    if (!item) {
      return result(false, "missing-package", "未找到该医疗包");
    }
    if (item.delivered) {
      return result(false, "delivered", "该医疗包已经送达");
    }
    if (item.originId !== game.currentPlatformId) {
      return result(false, "not-at-origin", "医疗包不在当前平台");
    }
    if (!item.loaded && loadedPackages(game).length >= 2) {
      return result(false, "cargo-full", "货舱已满");
    }

    item.loaded = !item.loaded;
    game.lastEvent = {
      type: item.loaded ? "package-loaded" : "package-unloaded",
      packageId
    };
    pushLog(
      game,
      item.loaded ? `装载 ${item.name}，注意载重耗电。` : `卸下 ${item.name}。`,
      now
    );
    return result(
      true,
      item.loaded ? "loaded" : "unloaded",
      item.loaded ? "医疗包装载完成" : "医疗包已卸下",
      { loaded: item.loaded }
    );
  }

  function selectDestination(game, platformId, now) {
    if (game.status !== "briefing" && game.status !== "ready") {
      return result(false, "drone-busy", "飞行或冷却中不能切换航线");
    }
    const platform = platformById(platformId);
    if (!platform) {
      return result(false, "unknown-platform", "未知平台");
    }
    if (platformId === game.currentPlatformId) {
      return result(false, "same-platform", "无人机已停在该平台");
    }

    game.selectedDestinationId = platformId;
    game.now = Number.isFinite(now) ? now : game.now;
    return result(true, "selected", `已选择 ${platform.name}`, {
      destinationId: platformId
    });
  }

  function getRouteQuote(game, destinationId) {
    const from = platformById(game.currentPlatformId);
    const to = platformById(destinationId);
    const battery = installedBattery(game);
    if (!from || !to || !battery) {
      return null;
    }

    const routeLength = distanceBetween(from, to);
    const factor = weightFactor(game);
    const baseEnergy = routeLength * CONFIG.energyPerPixel;
    const energy = round(baseEnergy * factor, 1);
    const exposure = routeExposure(from, to);
    const heatGain = round(energy * CONFIG.heatPerEnergy + exposure.total, 1);
    const chargeAfter = round(battery.charge - energy, 1);
    const heatAfter = round(battery.heat + heatGain, 1);
    const durationMs = Math.round((routeLength / CONFIG.flightSpeed) * 1000);
    const idleCostFactor = factor - 1;

    let risk = "safe";
    if (
      chargeAfter < 0 ||
      heatAfter >= CONFIG.failureHeat ||
      battery.heat >= CONFIG.takeoffHeatLimit
    ) {
      risk = "danger";
    } else if (
      chargeAfter < 8 ||
      heatAfter >= CONFIG.takeoffHeatLimit ||
      battery.charge < 15
    ) {
      risk = "warning";
    }

    return {
      fromId: from.id,
      toId: to.id,
      routeLength: round(routeLength, 0),
      factor: round(factor, 2),
      overloadPercent: Math.round(idleCostFactor * 100),
      baseEnergy: round(baseEnergy, 1),
      energy,
      zoneHeat: exposure.total,
      zones: exposure.zones,
      heatGain,
      chargeAfter,
      heatAfter,
      durationMs,
      risk
    };
  }

  function installBattery(game, batteryId, now) {
    if (game.status !== "briefing" && game.status !== "ready") {
      return result(false, "drone-busy", "无人机当前无法换电");
    }
    const platform = platformById(game.currentPlatformId);
    if (!platform || !platform.swap) {
      return result(false, "no-swap", "该平台没有换电机械臂");
    }
    const battery = batteryById(game, batteryId);
    if (!battery) {
      return result(false, "missing-battery", "电池架上没有这块电池");
    }
    if (battery.charge <= 0) {
      return result(false, "empty-battery", "这块电池已耗尽");
    }
    if (batteryId === game.installedBatteryId) {
      return result(true, "already-installed", "这块电池已经装机");
    }

    game.installedBatteryId = batteryId;
    game.swapCount += 1;
    game.lastEvent = { type: "battery-swap", batteryId };
    pushLog(game, `换装 ${battery.name}。`, now);
    return result(true, "installed", `${battery.name} 已装机`, { batteryId });
  }

  function startCooling(game, now) {
    if (game.status !== "briefing" && game.status !== "ready") {
      return result(false, "drone-busy", "只能在地面冷却电池");
    }
    const battery = installedBattery(game);
    if (!battery) {
      return result(false, "missing-battery", "当前没有装机电池");
    }
    if (battery.heat <= 0.5) {
      return result(false, "already-cool", "当前电池不需要冷却");
    }

    const stamp = Number.isFinite(now) ? now : game.now;
    ensureMissionStarted(game, stamp);
    game.status = "cooling";
    game.cooling = {
      batteryId: battery.id,
      startedAt: stamp,
      endsAt: stamp + CONFIG.coolingSeconds * 1000
    };
    game.lastEvent = { type: "cooling-start", batteryId: battery.id };
    pushLog(game, `冷却 ${battery.name}，4 秒内无法起飞。`, stamp);
    return result(true, "cooling", "电池冷却中", {
      endsAt: game.cooling.endsAt
    });
  }

  function beginFlight(game, destinationId, now) {
    if (game.status !== "briefing" && game.status !== "ready") {
      return result(false, "drone-busy", "无人机正在飞行或冷却");
    }

    const targetId = destinationId || game.selectedDestinationId;
    const destination = platformById(targetId);
    if (!destination) {
      return result(false, "no-destination", "请先选择目的地");
    }
    if (targetId === game.currentPlatformId) {
      return result(false, "same-platform", "无人机已经在该平台");
    }

    const battery = installedBattery(game);
    if (!battery) {
      return result(false, "missing-battery", "当前没有装机电池");
    }
    if (battery.heat >= CONFIG.takeoffHeatLimit) {
      return result(
        false,
        "thermal-lock",
        "电池热锁：必须先冷却或换电",
        { heat: battery.heat }
      );
    }
    if (battery.charge <= 0) {
      return result(false, "empty-battery", "电池电量耗尽，无法起飞");
    }

    const quote = getRouteQuote(game, targetId);
    const stamp = Number.isFinite(now) ? now : game.now;
    if (!game.started) {
      startMission(game, stamp);
    }
    if (game.started && game.missionEndsAt !== null) {
      const remaining = game.missionEndsAt - stamp;
      if (remaining <= 0) {
        failGame(game, "timeout", stamp);
        return result(false, "timeout", "任务时限已到");
      }
      game.timeLeft = round(remaining / 1000, 2);
    }

    game.status = "flying";
    game.selectedDestinationId = targetId;
    game.cooling = null;
    game.flight = {
      fromId: game.currentPlatformId,
      toId: targetId,
      batteryId: battery.id,
      startedAt: stamp,
      durationMs: quote.durationMs,
      quote,
      startCharge: battery.charge,
      startHeat: battery.heat,
      progress: 0
    };
    game.lastEvent = {
      type: "takeoff",
      fromId: game.currentPlatformId,
      toId: targetId,
      at: stamp
    };
    pushLog(
      game,
      `起飞：${platformById(game.currentPlatformId).short} → ${destination.short}，载重系数 ${quote.factor}。`,
      stamp
    );
    return result(true, "takeoff", `航线已启动：${destination.name}`, {
      quote
    });
  }

  function failGame(game, reason, now) {
    if (game.status === "won" || game.status === "lost") {
      return;
    }
    game.status = "lost";
    game.lossReason = reason;
    game.failedAt = now;
    game.now = now;
    game.lastEvent = {
      type: "failure",
      reason,
      at: now
    };
    pushLog(game, `任务失败：${reason}`, now);
  }

  function winGame(game, now) {
    game.status = "won";
    game.finishedAt = now;
    game.now = now;
    game.lastEvent = { type: "win", at: now, delivered: 2 };
    pushLog(game, "两次医疗投送完成，任务成功。", now);
  }

  function applyArrival(game, now) {
    const flight = game.flight;
    if (!flight) {
      return;
    }

    const battery = batteryById(game, flight.batteryId);
    if (battery) {
      battery.charge = round(Math.max(0, flight.startCharge - flight.quote.energy), 1);
      battery.heat = round(flight.startHeat + flight.quote.heatGain, 1);
    }

    game.currentPlatformId = flight.toId;
    game.status = "ready";
    game.flight = null;
    game.cooling = null;
    game.selectedDestinationId = null;

    const delivered = game.packages.filter(
      (item) =>
        item.loaded &&
        !item.delivered &&
        item.targetId === game.currentPlatformId
    );
    delivered.forEach((item) => {
      item.delivered = true;
      item.loaded = false;
      item.deliveredAt = now;
    });
    game.deliveredCount = deliveredCount(game);

    game.routeHistory.push({
      fromId: flight.fromId,
      toId: flight.toId,
      batteryId: flight.batteryId,
      quote: flight.quote,
      deliveredIds: delivered.map((item) => item.id),
      endedAt: now
    });

    if (delivered.length) {
      game.lastEvent = {
        type: "delivery",
        packageIds: delivered.map((item) => item.id),
        platformId: flight.toId,
        at: now
      };
      delivered.forEach((item) => {
        pushLog(game, `${item.name} 已送达 ${platformById(item.targetId).name}。`, now);
      });
    } else {
      game.lastEvent = {
        type: "arrival",
        platformId: flight.toId,
        at: now
      };
      pushLog(game, `抵达 ${platformById(flight.toId).name}。`, now);
    }

    if (game.deliveredCount >= 2) {
      if (usableBatteryCount(game) > 0) {
        winGame(game, now);
      } else {
        failGame(game, "no-usable-battery", now);
      }
    }
  }

  function tick(game, now) {
    if (game.status === "won" || game.status === "lost") {
      return game.lastEvent;
    }

    const stamp = Number.isFinite(now) ? now : game.now;
    game.now = stamp;
    if (!game.started) {
      return game.lastEvent;
    }

    const remainingMs = game.missionEndsAt - stamp;
    game.timeLeft = round(Math.max(0, remainingMs / 1000), 2);
    if (remainingMs <= 0) {
      failGame(game, "timeout", stamp);
      return game.lastEvent;
    }

    if (game.status === "cooling" && game.cooling) {
      if (stamp >= game.cooling.endsAt) {
        const battery = batteryById(game, game.cooling.batteryId);
        if (battery) {
          battery.heat = round(
            Math.max(0, battery.heat - CONFIG.coolingAmount),
            1
          );
        }
        game.cooling = null;
        game.status = "ready";
        game.lastEvent = { type: "cooling-complete", at: stamp };
        pushLog(game, "电池冷却完成，热锁解除。", stamp);
      }
    }

    if (game.status === "flying" && game.flight) {
      const flight = game.flight;
      const battery = batteryById(game, flight.batteryId);
      const progress = clamp(
        (stamp - flight.startedAt) / flight.durationMs,
        0,
        1
      );
      flight.progress = progress;

      if (battery) {
        const projectedHeat =
          flight.startHeat + flight.quote.heatGain * progress;
        if (projectedHeat >= CONFIG.failureHeat) {
          const failureProgress =
            flight.quote.heatGain > 0
              ? clamp(
                  (CONFIG.failureHeat - flight.startHeat) /
                    flight.quote.heatGain,
                  0,
                  1
                )
              : 0;
          flight.progress = failureProgress;
          battery.charge = round(
            Math.max(0, flight.startCharge - flight.quote.energy * failureProgress),
            1
          );
          battery.heat = CONFIG.failureHeat;
          failGame(game, "thermal-lock", stamp);
          return game.lastEvent;
        }

        battery.charge = round(
          Math.max(0, flight.startCharge - flight.quote.energy * progress),
          1
        );
        battery.heat = round(
          flight.startHeat + flight.quote.heatGain * progress,
          1
        );

        if (battery.charge <= 0 && progress < 1) {
          failGame(game, "battery-empty", stamp);
          return game.lastEvent;
        }
      }

      if (progress >= 1) {
        applyArrival(game, stamp);
      }
    }

    return game.lastEvent;
  }

  function getPlatforms() {
    return clone(PLATFORM_DEFS);
  }

  function getHeatZones() {
    return clone(HEAT_ZONE_DEFS);
  }

  function resetGame(now) {
    return createGame(now);
  }

  const api = {
    CONFIG,
    PLATFORM_DEFS,
    HEAT_ZONE_DEFS,
    PACKAGE_DEFS,
    BATTERY_DEFS,
    createGame,
    resetGame,
    startMission,
    togglePackage,
    selectDestination,
    getRouteQuote,
    routeExposure,
    installBattery,
    startCooling,
    beginFlight,
    tick,
    platformById,
    packageById,
    batteryById,
    installedBattery,
    loadedPackages,
    deliveredCount,
    usableBatteryCount,
    isBatteryUsable,
    weightFactor,
    distanceBetween,
    getPlatforms,
    getHeatZones
  };

  global.SkyMedCore = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
