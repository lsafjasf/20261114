(function () {
  "use strict";

  const WORLD = Object.freeze({ width: 1280, height: 800 });

  const COLORS = Object.freeze({
    ink: "#040b15",
    panel: "rgba(7, 20, 33, 0.86)",
    cyan: "#58e1ee",
    cyanSoft: "#8eeaf2",
    amber: "#ffb24d",
    amberSoft: "#ffd397",
    coral: "#ff685d",
    mint: "#6ff5c6",
    steel: "#627986",
    white: "#e3fbff",
    pod: ["#5ce4f2", "#ffb65b", "#ff7c88"],
  });

  const ARM = Object.freeze({
    baseX: 210,
    baseY: 430,
    upper: 140,
    minReach: 64,
    maxReach: 790,
    startReach: 280,
    elbowBend: -0.13,
    shoulderRadius: 36,
    linkWidth: 24,
    minAngle: -0.5,
    maxAngle: 0.5,
    startAngle: -0.18,
    gripLength: 26,
  });

  const MISSION_TIME = 150;
  const COLLISION_COOLDOWN = 0.55;

  function makePods() {
    return [
      {
        id: "C-01",
        index: 0,
        color: COLORS.pod[0],
        mass: 1.2,
        x: 650,
        y: 238,
        vx: 5.2,
        vy: -2.1,
        angle: -0.1,
        spin: 0.035,
        radius: 30,
        slotX: 1032,
        slotY: 236,
        state: "free",
      },
      {
        id: "C-02",
        index: 1,
        color: COLORS.pod[1],
        mass: 2.1,
        x: 704,
        y: 430,
        vx: -3.8,
        vy: 4.7,
        angle: 0.18,
        spin: -0.028,
        radius: 34,
        slotX: 1032,
        slotY: 430,
        state: "free",
      },
      {
        id: "C-03",
        index: 2,
        color: COLORS.pod[2],
        mass: 3.0,
        x: 646,
        y: 614,
        vx: 3.1,
        vy: -5.6,
        angle: -0.16,
        spin: 0.022,
        radius: 38,
        slotX: 1032,
        slotY: 620,
        state: "free",
      },
    ];
  }

  const WALLS = Object.freeze([
    { x: 68, y: 102, w: 1144, h: 44, side: "top" },
    { x: 68, y: 658, w: 1144, h: 44, side: "bottom" },
    { x: 58, y: 102, w: 24, h: 600, side: "left" },
    { x: 1198, y: 102, w: 24, h: 600, side: "right" },
  ]);

  const BAY = Object.freeze({ x: 78, y: 146, w: 1124, h: 512 });
  const DRIFT_AREA = Object.freeze({ x: 510, y: 158, w: 300, h: 484 });

  function makeStars() {
    let seed = 14821;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    return Array.from({ length: 190 }, (_, index) => ({
      x: random() * WORLD.width,
      y: random() * 720,
      size: random() < 0.86 ? random() * 1.25 + 0.25 : random() * 2.1 + 1,
      alpha: random() * 0.52 + 0.12,
      phase: random() * Math.PI * 2,
      drift: index % 7 === 0 ? random() * 6 + 2 : 0,
    }));
  }

  function distance(ax, ay, bx, by) {
    return Math.hypot(ax - bx, ay - by);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function pointInRect(x, y, rect, padding) {
    const pad = padding || 0;
    return (
      x >= rect.x - pad &&
      x <= rect.x + rect.w + pad &&
      y >= rect.y - pad &&
      y <= rect.y + rect.h + pad
    );
  }

  window.ARM_CONFIG = {
    WORLD,
    COLORS,
    ARM,
    MISSION_TIME,
    COLLISION_COOLDOWN,
    WALLS,
    BAY,
    DRIFT_AREA,
    makePods,
    makeStars,
    distance,
    clamp,
    lerp,
    pointInRect,
  };
})();
