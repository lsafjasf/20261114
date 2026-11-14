// Renders the three views to artifacts/*.png using a minimal PNG encoder
// (Node built-in zlib only), so we can visually inspect the output.
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");
const C = require("./noise.js");

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 255];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePNG(rgba, size) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const SIZE = 256;
const seed = 1337;
const octaves = 5;
const bump = 8;
const height = C.generateHeightmap(SIZE, octaves, seed);
const az = (45 * Math.PI) / 180;
const el = (55 * Math.PI) / 180;
const light = { x: Math.cos(el) * Math.cos(az), y: Math.cos(el) * Math.sin(az), z: Math.sin(el) };

const views = {
  heightmap: C.heightToGray(height, SIZE),
  normalmap: C.heightToNormalMap(height, SIZE, bump),
  lighting: C.renderShading(height, SIZE, bump, light, 1),
};
fs.mkdirSync(path.join(__dirname, "artifacts"), { recursive: true });
for (const [name, data] of Object.entries(views)) {
  const file = path.join(__dirname, "artifacts", name + ".png");
  fs.writeFileSync(file, encodePNG(data, SIZE));
  console.log("wrote", file);
}
