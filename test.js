// Node-side verification of the acceptance criteria.
const C = require("./noise.js");

const SIZE = 256;
let failures = 0;

function check(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
  if (!ok) failures++;
}

// 1. Same seed twice -> bit-identical heightfield.
const h1 = C.generateHeightmap(SIZE, 5, 1337);
const h2 = C.generateHeightmap(SIZE, 5, 1337);
let identical = h1.length === h2.length;
for (let i = 0; identical && i < h1.length; i++) identical = h1[i] === h2[i];
check("same seed generates identical heightmap twice", identical);

// 1b. Different seed -> different field (seed actually matters).
const h3 = C.generateHeightmap(SIZE, 5, 1338);
let sameAsOtherSeed = true;
for (let i = 0; i < h1.length; i++) {
  if (h1[i] !== h3[i]) { sameAsOtherSeed = false; break; }
}
check("different seed gives different heightmap", !sameAsOtherSeed);

// 1c. Octave change keeps the same base shape (seed preserved).
const coarse = C.generateHeightmap(SIZE, 1, 42);
const detailed = C.generateHeightmap(SIZE, 6, 42);
let dot = 0;
let na = 0;
let nb = 0;
for (let i = 0; i < coarse.length; i++) {
  dot += coarse[i] * detailed[i];
  na += coarse[i] * coarse[i];
  nb += detailed[i] * detailed[i];
}
const corr = dot / (Math.sqrt(na) * Math.sqrt(nb));
check("adding detail layers preserves base shape", corr > 0.8, `corr=${corr.toFixed(3)}`);

// 2. Light direction change visibly alters shading.
function light(azDeg, elDeg) {
  const az = (azDeg * Math.PI) / 180;
  const el = (elDeg * Math.PI) / 180;
  return { x: Math.cos(el) * Math.cos(az), y: Math.cos(el) * Math.sin(az), z: Math.sin(el) };
}
const imgA = C.renderShading(h1, SIZE, 8, light(0, 55), 1);
const imgB = C.renderShading(h1, SIZE, 8, light(180, 55), 1);
let diff = 0;
for (let i = 0; i < imgA.length; i += 4) diff += Math.abs(imgA[i] - imgB[i]);
const meanDiff = diff / (imgA.length / 4);
check("light direction change visibly alters shading", meanDiff > 10,
  `mean delta = ${meanDiff.toFixed(1)}/255`);

// 2b. Intensity change also alters brightness.
const imgC = C.renderShading(h1, SIZE, 8, light(45, 55), 0.5);
const imgD = C.renderShading(h1, SIZE, 8, light(45, 55), 2.0);
let diff2 = 0;
for (let i = 0; i < imgC.length; i += 4) diff2 += Math.abs(imgC[i] - imgD[i]);
const meanDiff2 = diff2 / (imgC.length / 4);
check("intensity change alters brightness", meanDiff2 > 10,
  `mean delta = ${meanDiff2.toFixed(1)}/255`);

// 3. Normal map sanity: bump scale 0 -> flat normals (128,128,255).
const flat = C.heightToNormalMap(h1, SIZE, 0);
check("zero bump scale gives flat normals",
  flat[0] === 128 && flat[1] === 128 && flat[2] === 255,
  `first px = ${flat[0]},${flat[1]},${flat[2]}`);

process.exit(failures ? 1 : 0);
