export const LOOM_CONFIG = Object.freeze({
  totalRows: 30,
  lengthCm: 10,
  defectLimit: 6,
  openingTolerance: 16,
  idealOpening: 50,
  idealTension: 1.8,
  tensionSafeMin: 1.1,
  tensionSafeMax: 2.55,
  tensionBreakAt: 3.05,
  speedSafeMax: 4.25,
  speedMisalignAt: 5.35,
  minTension: 0.8,
  maxTension: 3.4,
  minSpeed: 1.2,
  maxSpeed: 5.6,
});

export const DEFAULT_SETTINGS = Object.freeze({
  opening: 72,
  tension: 1.8,
  speed: 3.1,
});

export const TEST_SETTINGS = Object.freeze({
  opening: 50,
  tension: 1.8,
  speed: 3.1,
});

const WEFT_COLORS = [
  "#d8b283",
  "#c89169",
  "#e0c29a",
  "#b77a5f",
  "#d2a77b",
  "#c88466",
];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function normalizeSettings(input = {}) {
  return {
    opening: clamp(Number(input.opening ?? 50), 0, 100),
    tension: clamp(
      Number(input.tension ?? LOOM_CONFIG.idealTension),
      LOOM_CONFIG.minTension,
      LOOM_CONFIG.maxTension,
    ),
    speed: clamp(
      Number(input.speed ?? 3.1),
      LOOM_CONFIG.minSpeed,
      LOOM_CONFIG.maxSpeed,
    ),
  };
}

export function syncTargetForRow(rowIndex) {
  const slowDrift = Math.sin(rowIndex * 0.61) * 2.6;
  const fineDrift = Math.sin(rowIndex * 1.43 + 0.7) * 1.1;
  return LOOM_CONFIG.idealOpening + slowDrift + fineDrift;
}

export function assessSettings(settings, rowIndex = 0) {
  const normalized = normalizeSettings(settings);
  const target = syncTargetForRow(rowIndex);
  const syncError = normalized.opening - target;
  const tension = normalized.tension;
  const speed = normalized.speed;

  const syncRisk = clamp(
    (Math.abs(syncError) - LOOM_CONFIG.openingTolerance) /
      (LOOM_CONFIG.openingTolerance * 1.6),
    0,
    1,
  );
  const breakRisk = clamp(
    (tension - LOOM_CONFIG.tensionSafeMax) /
      (LOOM_CONFIG.tensionBreakAt - LOOM_CONFIG.tensionSafeMax),
    0,
    1,
  );
  const slackRisk = clamp(
    (LOOM_CONFIG.tensionSafeMin - tension) / 0.3,
    0,
    1,
  );
  const misalignRisk = clamp(
    (speed - LOOM_CONFIG.speedSafeMax) /
      (LOOM_CONFIG.speedMisalignAt - LOOM_CONFIG.speedSafeMax),
    0,
    1,
  );

  return {
    settings: normalized,
    target,
    syncError,
    syncRisk,
    breakRisk,
    slackRisk,
    misalignRisk,
  };
}

export class LoomSimulation {
  constructor({ seed = 0x220, totalRows = LOOM_CONFIG.totalRows } = {}) {
    this.seed = seed;
    this.totalRows = totalRows;
    this.rng = mulberry32(seed);
    this.status = "idle";
    this.settings = normalizeSettings(DEFAULT_SETTINGS);
    this.rows = [];
    this.defects = 0;
    this.breakages = [];
    this.activePick = null;
    this.failureReason = null;
    this.lastEvent = null;
    this.startedAt = null;
  }

  get progressCm() {
    return (this.rows.length / this.totalRows) * LOOM_CONFIG.lengthCm;
  }

  get isRunning() {
    return this.status === "running";
  }

  get currentTarget() {
    return syncTargetForRow(this.rows.length);
  }

  updateSpeed(speed) {
    this.setSettings({ speed });
  }

  setSettings(partial) {
    this.settings = normalizeSettings({ ...this.settings, ...partial });
    return this.settings;
  }

  start() {
    if (this.status === "idle" || this.status === "paused") {
      this.status = "running";
      this.failureReason = null;
      this.lastEvent = null;
      if (!this.startedAt) this.startedAt = Date.now();
      return true;
    }
    return false;
  }

  pause() {
    if (this.status === "running") {
      this.status = "paused";
      return true;
    }
    return false;
  }

  toggle() {
    if (this.status === "running") {
      this.pause();
    } else {
      this.start();
    }
    return this.status;
  }

  reset() {
    this.rng = mulberry32(this.seed);
    this.status = "idle";
    this.rows = [];
    this.defects = 0;
    this.breakages = [];
    this.activePick = null;
    this.failureReason = null;
    this.lastEvent = null;
    this.startedAt = null;
    this.settings = normalizeSettings(DEFAULT_SETTINGS);
  }

  beginPick() {
    if (this.activePick || this.status !== "running") return this.activePick;

    const rowIndex = this.rows.length;
    const settings = { ...this.settings };
    const target = syncTargetForRow(rowIndex);
    const assessment = assessSettings(settings, rowIndex);
    const noise = (this.rng() - 0.5) * 2.2;
    const syncError = settings.opening - target + noise;
    const defectKinds = [];
    let breakPosition = null;

    if (Math.abs(syncError) > LOOM_CONFIG.openingTolerance) {
      defectKinds.push("diagonal");
    }

    if (assessment.breakRisk > 0 && this.rng() < assessment.breakRisk) {
      breakPosition = 6 + Math.floor(this.rng() * 42);
    }

    if (assessment.slackRisk > 0 && this.rng() < assessment.slackRisk) {
      defectKinds.push("missed");
    }

    if (assessment.misalignRisk > 0 && this.rng() < assessment.misalignRisk) {
      defectKinds.push("misaligned");
    }

    const direction = rowIndex % 2 === 0 ? "right" : "left";
    const duration = (1000 / clamp(settings.speed, 1, 8)) * 0.94;

    this.activePick = {
      rowIndex,
      settings,
      target,
      syncError,
      direction,
      duration,
      progress: 0,
      defectKinds,
      breakPosition,
      color: WEFT_COLORS[rowIndex % WEFT_COLORS.length],
      slant: clamp(syncError / 48, -1, 1),
      shuttleY: 0,
    };
    return this.activePick;
  }

  finishPick() {
    const pick = this.activePick;
    if (!pick) return null;
    this.activePick = null;

    if (pick.breakPosition !== null) {
      this.status = "broken";
      this.failureReason = "thread-break";
      this.breakages.push({
        row: pick.rowIndex,
        position: pick.breakPosition,
        tension: pick.settings.tension,
      });
      this.lastEvent = {
        type: "break",
        row: pick.rowIndex,
        position: pick.breakPosition,
        tension: pick.settings.tension,
      };
      return this.lastEvent;
    }

    const row = {
      index: pick.rowIndex,
      direction: pick.direction,
      color: pick.color,
      target: pick.target,
      tension: pick.settings.tension,
      speed: pick.settings.speed,
      syncError: pick.syncError,
      slant: pick.slant,
      defectKinds: [...pick.defectKinds],
      missed: pick.defectKinds.includes("missed"),
    };
    this.rows.push(row);
    this.defects += row.defectKinds.length;

    this.lastEvent = {
      type: row.defectKinds.length ? "defect" : "pick",
      row,
      defects: row.defectKinds,
    };

    if (this.defects >= LOOM_CONFIG.defectLimit) {
      this.status = "failed";
      this.failureReason = "defect-limit";
    } else if (this.rows.length >= this.totalRows) {
      this.status = "complete";
      this.lastEvent = {
        type: "complete",
        defects: this.defects,
        rows: this.rows.length,
      };
    }

    return this.lastEvent;
  }

  update(deltaMs) {
    if (this.status !== "running") return;
    let remaining = Math.max(0, Math.min(Number(deltaMs) || 0, 2500));
    let guard = 0;

    while (remaining > 0 && this.status === "running" && guard < 12) {
      guard += 1;
      if (!this.activePick) this.beginPick();
      if (!this.activePick) break;

      const left = this.activePick.duration * (1 - this.activePick.progress);
      if (remaining >= left) {
        remaining -= left;
        this.activePick.progress = 1;
        this.finishPick();
      } else {
        this.activePick.progress += remaining / this.activePick.duration;
        remaining = 0;
      }
    }
  }

  weaveNextPick(settings = this.settings) {
    this.setSettings(settings);
    if (this.status === "idle" || this.status === "paused") this.start();
    if (this.status !== "running") return this.lastEvent;
    if (!this.activePick) this.beginPick();
    if (this.activePick) {
      this.activePick.progress = 1;
      this.finishPick();
    }
    return this.lastEvent;
  }

  getSnapshot() {
    const assessment = assessSettings(this.settings, this.rows.length);
    const pick = this.activePick;
    let active = null;

    if (pick) {
      const tensionRelease =
        Math.sin(pick.progress * Math.PI) * (2.3 - pick.settings.tension) * 0.8;
      active = {
        rowIndex: pick.rowIndex,
        direction: pick.direction,
        progress: clamp(pick.progress, 0, 1),
        duration: pick.duration,
        color: pick.color,
        target: pick.target,
        tension: pick.settings.tension,
        speed: pick.settings.speed,
        syncError: pick.syncError,
        slant: pick.slant,
        defectKinds: [...pick.defectKinds],
        shuttleTension: tensionRelease,
      };
    }

    return {
      status: this.status,
      rows: this.rows,
      rowsDone: this.rows.length,
      totalRows: this.totalRows,
      progressCm: this.progressCm,
      defects: this.defects,
      defectLimit: LOOM_CONFIG.defectLimit,
      breakages: [...this.breakages],
      active,
      settings: { ...this.settings },
      target: assessment.target,
      syncError: assessment.syncError,
      risks: {
        sync: assessment.syncRisk,
        break: assessment.breakRisk,
        slack: assessment.slackRisk,
        misalign: assessment.misalignRisk,
      },
      failureReason: this.failureReason,
      success:
        this.status === "complete" &&
        this.defects < LOOM_CONFIG.defectLimit &&
        this.breakages.length === 0,
      lastEvent: this.lastEvent,
    };
  }
}
