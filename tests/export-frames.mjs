// 生成关键帧 PNG（原始/差分/叠加）用于人工核对，依赖仅 Node 内置 zlib。
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import {
  DEFAULT_PARAMS,
  FRAME_COUNT,
  HEIGHT,
  WIDTH,
  renderScene,
} from '../js/scene.js';
import { computeDiff, renderView } from '../js/diff.js';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) {
    c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH, 0);
  ihdr.writeUInt32BE(HEIGHT, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = WIDTH * 4;
  const raw = Buffer.alloc((stride + 1) * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1,
    );
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('artifacts/frames', { recursive: true });
const frame = FRAME_COUNT - 1;
const bufA = renderScene(frame, DEFAULT_PARAMS);
const imageData = { data: new Uint8ClampedArray(WIDTH * HEIGHT * 4) };

const rows = [];
for (const hueB of [15, 45, 300]) {
  const paramsB = { ...DEFAULT_PARAMS, sunHue: hueB };
  const bufB = renderScene(frame, paramsB);
  const diff = computeDiff(bufA, bufB, 25);
  for (const mode of ['original', 'diff', 'overlay']) {
    renderView(imageData, bufA, bufB, diff, mode, 25);
    const file = `artifacts/frames/f${frame}_hue${hueB}_${mode}.png`;
    writeFileSync(file, encodePng(imageData.data));
  }
  rows.push({ hueB, ratio: diff.changedRatio, max: [diff.maxX, diff.maxY] });
}

writeFileSync('artifacts/frames/summary.json', JSON.stringify(rows, null, 2));
console.log('已导出 artifacts/frames/：');
for (const row of rows) {
  console.log(
    `  hueB=${row.hueB} 变化比例=${(row.ratio * 100).toFixed(2)}%`,
    `最大点=(${row.max[0]}, ${row.max[1]})`,
  );
}
