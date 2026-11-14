// Generates artifacts/mission_trajectory.svg (autopilot: 3 rings + landing)
// and artifacts/instability.svg (uncontrolled drift) from real simulation runs.
const fs = require("fs");
const P = require("./physics.js");
const A = require("./autopilot.js");

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const C = P.CFG;

function svgScene(title, path, color, extra) {
  const rings = C.rings.map((r, i) =>
    `<circle cx="${r.x}" cy="${r.y}" r="${(C.ringIn + C.ringOut) / 2}" fill="none" stroke="#e0a030" stroke-width="${C.ringOut - C.ringIn}" opacity="0.85"/>` +
    `<text x="${r.x}" y="${r.y + 4}" font-size="12" fill="#888" text-anchor="middle">${i + 1}</text>`
  ).join("\n  ");
  const coils = C.coils.map((c) =>
    `<rect x="${c.x - 18}" y="${c.y - 14}" width="36" height="28" rx="6" fill="#22345e" stroke="#4d9fff" stroke-width="2"/>`
  ).join("\n  ");
  const pts = path.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${C.W}" height="${C.H}" viewBox="0 0 ${C.W} ${C.H}">
  <rect width="${C.W}" height="${C.H}" fill="#0b1226"/>
  <text x="16" y="28" font-size="16" fill="#cfe3ff" font-family="sans-serif">${title}</text>
  <line x1="0" y1="${C.base.y}" x2="${C.W}" y2="${C.base.y}" stroke="#3a4f7e" stroke-width="2"/>
  <rect x="${C.base.x0}" y="${C.base.y}" width="${C.base.x1 - C.base.x0}" height="${C.H - C.base.y}" fill="#5adc8c" opacity="0.3"/>
  ${coils}
  ${rings}
  <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" opacity="0.9"/>
  ${extra || ""}
</svg>
`;
}

// --- mission run ---
const s = P.createState(mulberry32(44));
const dt = 1 / 120;
const path1 = [];
while (s.phase !== "success" && s.phase !== "crashed" && s.t < 120) {
  A.control(s); P.step(s, dt);
  path1.push({ x: s.x, y: s.y });
}
const end1 = `<circle cx="${s.x}" cy="${s.y}" r="8" fill="#7dffa8"/>`;
fs.writeFileSync("artifacts/mission_trajectory.svg",
  svgScene(`Mission: 3 rings + landing  (phase=${s.phase}, score=${s.score}, touches=${s.touches}, t=${s.t.toFixed(1)}s)`, path1, "#ffb84d", end1));

// --- instability run ---
const u = P.createState(mulberry32(99));
u.targets = [0.35, 0.35, 1.1, 0.1];
const path2 = [];
while (u.phase !== "crashed" && u.t < 30) {
  P.step(u, dt);
  path2.push({ x: u.x, y: u.y });
}
const end2 = `<circle cx="${u.x}" cy="${u.y}" r="8" fill="#ff7d7d"/>`;
fs.writeFileSync("artifacts/instability.svg",
  svgScene(`No control, fixed currents + disturbance  (phase=${u.phase}, unstable=${u.unstable}, t=${u.t.toFixed(1)}s)`, path2, "#ff7d7d", end2));

console.log("mission:", s.phase, "score", s.score, "touches", s.touches, "t", s.t.toFixed(1) + "s");
console.log("uncontrolled:", u.phase, "unstable", u.unstable, "t", u.t.toFixed(1) + "s");
console.log("wrote artifacts/mission_trajectory.svg, artifacts/instability.svg");
