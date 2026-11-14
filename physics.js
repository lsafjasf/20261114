// Shared physics core for the magnetic-levitation ring game.
// Used by the browser game (game.js) and the Node test rig (test_sim.js).
(function (root, factory) {
  const M = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = M;
  else root.Physics = M;
})(typeof self !== "undefined" ? self : this, function () {
  const W = 960;
  const H = 600;

  const CFG = {
    W, H,
    g: 240,               // gravity px/s^2
    k: 3.0e7,             // coil force constant
    d0: 45,               // coil core offset px
    drag: 0.18,           // linear air damping 1/s
    ballR: 10,
    iMax: 2.2,            // max coil current
    lagTau: 0.35,         // current first-order lag (s)
    distTau: 1.1,         // disturbance correlation time (s)
    distSigma: 55,        // disturbance intensity px/s^2
    gustEvery: [3.5, 7],  // gust interval range (s)
    gustMag: 95,          // gust impulse px/s
    coils: [
      { name: "left",   x: 30,  y: 300 },
      { name: "right",  x: 930, y: 300 },
      { name: "top",    x: 480, y: 30  },
      { name: "bottom", x: 480, y: 570 },
    ],
    base: { x0: 420, x1: 540, y: 575 },   // landing pad (top surface)
    rings: [
      { x: 710, y: 400 },
      { x: 280, y: 230 },
      { x: 660, y: 140 },
    ],
    ringIn: 46,           // aperture radius
    ringOut: 58,          // outer radius
    touchPenalty: 4,
    touchCooldown: 0.5,
    landVxMax: 75,
    landVyMax: 85,
    spawn: { x: 480, y: 300 },
  };

  function createState(rand) {
    const rng = rand || Math.random;
    return {
      t: 0,
      x: CFG.spawn.x, y: CFG.spawn.y, vx: 0, vy: 0,
      currents: [0.25, 0.25, 0.9, 0.08],   // actual (lagged); start near hover
      targets: [0.25, 0.25, 0.9, 0.08],    // player-set
      distFx: 0, distFy: 0,     // disturbance force
      gustTimer: 2.5,
      gustFlash: 0,
      ringIdx: 0,               // which ring is active
      ringDone: [false, false, false],
      touchCooldown: 0,
      touchFlash: 0,
      score: 100,
      touches: 0,
      phase: "rings",           // rings -> landing -> success | crashed
      unstable: false,
      landV: 0,
      rng,
      trail: [],
    };
  }

  function coilForces(s) {
    // per-coil attraction force vectors on the ball
    const out = [];
    for (let i = 0; i < 4; i++) {
      const c = CFG.coils[i];
      const dx = c.x - s.x, dy = c.y - s.y;
      const d = Math.hypot(dx, dy) || 1;
      const I = s.currents[i];
      const f = CFG.k * I * I / Math.pow(d + CFG.d0, 2);
      out.push({ fx: f * dx / d, fy: f * dy / d, d });
    }
    return out;
  }

  function step(s, dt) {
    if (s.phase === "success" || s.phase === "crashed") return s;
    s.t += dt;

    // current lag: dI/dt = (target - I)/tau
    for (let i = 0; i < 4; i++) {
      const tgt = Math.max(0, Math.min(CFG.iMax, s.targets[i]));
      s.currents[i] += (tgt - s.currents[i]) * (dt / CFG.lagTau);
    }

    // disturbance: Ornstein-Uhlenbeck drift + random gusts
    const rnd = s.rng;
    const n1 = (rnd() * 2 - 1) + (rnd() * 2 - 1);
    const n2 = (rnd() * 2 - 1) + (rnd() * 2 - 1);
    s.distFx += (-s.distFx / CFG.distTau) * dt + CFG.distSigma * Math.sqrt(dt) * n1;
    s.distFy += (-s.distFy / CFG.distTau) * dt + CFG.distSigma * Math.sqrt(dt) * n2;
    s.gustTimer -= dt;
    if (s.gustTimer <= 0) {
      const a = rnd() * Math.PI * 2;
      const m = CFG.gustMag * (0.6 + 0.8 * rnd());
      s.vx += Math.cos(a) * m;
      s.vy += Math.sin(a) * m * 0.5;
      s.gustFlash = 0.6;
      s.gustTimer = CFG.gustEvery[0] + rnd() * (CFG.gustEvery[1] - CFG.gustEvery[0]);
    }
    s.gustFlash = Math.max(0, s.gustFlash - dt);

    // integrate forces
    let fx = s.distFx, fy = CFG.g + s.distFy;
    const cf = coilForces(s);
    for (const c of cf) { fx += c.fx; fy += c.fy; }
    fx -= CFG.drag * s.vx;
    fy -= CFG.drag * s.vy;
    s.vx += fx * dt;
    s.vy += fy * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;

    s.trail.push({ x: s.x, y: s.y });
    if (s.trail.length > 240) s.trail.shift();

    updateRings(s, dt);
    updateBounds(s);
    return s;
  }

  function updateRings(s, dt) {
    s.touchCooldown = Math.max(0, s.touchCooldown - dt);
    s.touchFlash = Math.max(0, s.touchFlash - dt);
    if (s.phase !== "rings") return;
    const ring = CFG.rings[s.ringIdx];
    if (!ring) { s.phase = "landing"; return; }
    const d = Math.hypot(s.x - ring.x, s.y - ring.y);
    const rIn = CFG.ringIn, rOut = CFG.ringOut, rb = CFG.ballR;
    if (d < rIn - rb * 0.4) {
      // clean pass through the aperture
      s.ringDone[s.ringIdx] = true;
      s.ringIdx++;
      if (s.ringIdx >= CFG.rings.length) s.phase = "landing";
    } else if (d > rIn - rb && d < rOut + rb && s.touchCooldown <= 0) {
      // grazed the ring band
      s.touches++;
      s.score = Math.max(0, s.score - CFG.touchPenalty);
      s.touchCooldown = CFG.touchCooldown;
      s.touchFlash = 0.4;
    }
  }

  function updateBounds(s) {
    const rb = CFG.ballR;
    if (s.x < rb) { s.x = rb; s.vx = Math.abs(s.vx) * 0.4; }
    if (s.x > CFG.W - rb) { s.x = CFG.W - rb; s.vx = -Math.abs(s.vx) * 0.4; }
    if (s.y < rb) { s.y = rb; s.vy = Math.abs(s.vy) * 0.4; }
    if (s.y > CFG.base.y - rb) {
      const onBase = s.x > CFG.base.x0 && s.x < CFG.base.x1;
      const speedOk = Math.abs(s.vy) < CFG.landVyMax && Math.abs(s.vx) < CFG.landVxMax;
      if (s.phase === "landing" && onBase && speedOk) {
        s.y = CFG.base.y - rb;
        s.landV = Math.hypot(s.vx, s.vy);
        s.vx = 0; s.vy = 0;
        s.phase = "success";
      } else if (s.y > CFG.base.y - rb + 2) {
        if (onBase && !speedOk) s.unstable = true;
        s.phase = "crashed";
      }
    }
    if (Math.abs(s.vx) > 900 || Math.abs(s.vy) > 900) s.unstable = true;
  }

  return { CFG, createState, step, coilForces };
});
