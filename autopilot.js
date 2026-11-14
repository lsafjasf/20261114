// Cascaded PD autopilot: waypoint -> desired velocity -> coil currents.
// Shared by the browser demo (autopilot toggle) and the Node test rig.
(function (root, factory) {
  const M = factory(typeof module !== "undefined" ? require("./physics.js") : root.Physics);
  if (typeof module !== "undefined" && module.exports) module.exports = M;
  else root.Autopilot = M;
})(typeof self !== "undefined" ? self : this, function (Physics) {
  const CFG = Physics.CFG;

  const TUNE = {
    kpV: 2.6,        // position -> velocity gain (1/s)
    kvV: 3.0,        // velocity -> accel gain (1/s)
    vMax: 150,       // cruise speed px/s
    vLand: 36,       // descent speed near base px/s
    hLand: 26,       // horizontal centering speed while landing px/s
    ringLead: 75,    // aim past the ring so the ball transits decisively
    iBase: 0.12,     // residual current on opposing coils
  };

  function waypoint(s) {
    if (s.phase === "rings") {
      const r = CFG.rings[s.ringIdx];
      if (r) {
        const dx = r.x - s.x, dy = r.y - s.y;
        const d = Math.hypot(dx, dy) || 1;
        return {
          x: r.x + dx / d * TUNE.ringLead,
          y: r.y + dy / d * TUNE.ringLead,
          vMax: TUNE.vMax, hMax: null,
        };
      }
    }
    // landing: first center above the pad, then descend gently
    const cx = (CFG.base.x0 + CFG.base.x1) / 2;
    if (Math.abs(s.x - cx) > 26 || s.y < CFG.base.y - 130) {
      return { x: cx, y: CFG.base.y - 130, vMax: TUNE.vMax, hMax: null };
    }
    // near the ground: hold altitude until the ball is calm, then descend
    if (Math.hypot(s.vx, s.vy) > 28) {
      return { x: cx, y: Math.min(s.y, CFG.base.y - 60), vMax: TUNE.vLand, hMax: TUNE.hLand };
    }
    return { x: cx, y: CFG.base.y - CFG.ballR - 1, vMax: TUNE.vLand, hMax: TUNE.hLand };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // solve a coil pair for a desired 1D force; returns [iNeg, iPos]
  function solvePair(force, dNeg, dPos) {
    const gNeg = CFG.k / Math.pow(dNeg + CFG.d0, 2);
    const gPos = CFG.k / Math.pow(dPos + CFG.d0, 2);
    if (force >= 0) return [TUNE.iBase, Math.sqrt(force / gPos)];
    return [Math.sqrt(-force / gNeg), TUNE.iBase];
  }

  function control(s) {
    const wp = waypoint(s);
    const ex = wp.x - s.x, ey = wp.y - s.y;
    const hMax = wp.hMax || wp.vMax;
    const vxDes = clamp(TUNE.kpV * ex, -hMax, hMax);
    const vyDes = clamp(TUNE.kpV * ey, -wp.vMax, wp.vMax);
    const ax = TUNE.kvV * (vxDes - s.vx);
    const ay = TUNE.kvV * (vyDes - s.vy);

    // net accel = coilForce + g (down) -> required coil force
    const fCx = ax;
    const fCy = ay - CFG.g;

    const dL = Math.hypot(s.x - CFG.coils[0].x, s.y - CFG.coils[0].y);
    const dR = Math.hypot(s.x - CFG.coils[1].x, s.y - CFG.coils[1].y);
    const dT = Math.hypot(s.x - CFG.coils[2].x, s.y - CFG.coils[2].y);
    const dB = Math.hypot(s.x - CFG.coils[3].x, s.y - CFG.coils[3].y);

    const [iL, iR] = solvePair(fCx, dL, dR);
    // vertical: top coil pulls up (negative fy), bottom pulls down (positive fy)
    const [iT, iB] = solvePair(fCy, dT, dB);

    s.targets[0] = clamp(iL, 0, CFG.iMax);
    s.targets[1] = clamp(iR, 0, CFG.iMax);
    s.targets[2] = clamp(iT, 0, CFG.iMax);
    s.targets[3] = clamp(iB, 0, CFG.iMax);
    return s.targets;
  }

  return { control, waypoint, TUNE };
});
