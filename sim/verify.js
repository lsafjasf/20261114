/* 物理模型回归：验证“总量变化同时改变饱和度与明度”，而非简单 RGB 缩放 */
const M = require('../js/mixing.js');

const fixedHue = [40, 70, 15, 0];
const rows = [];
for (const k of [0.25, 0.5, 1, 1.5]) {
  const amounts = fixedHue.map(v => Math.round(v * k));
  const r = M.mix(amounts);
  const chroma = Math.hypot(r.lab[1], r.lab[2]);
  const hueAngle = (Math.atan2(r.lab[2], r.lab[1]) * 180 / Math.PI + 360) % 360;
  rows.push({
    倍数: k, 配比: amounts.join('/'), HEX: r.hex,
    Lab色相: hueAngle.toFixed(1) + '°', Lab色度: chroma.toFixed(1),
    Lab明度: r.lab[0].toFixed(1), 总量: r.total
  });
}
console.table(rows);

const hues = rows.map(r => parseFloat(r.Lab色相));
const chromas = rows.map(r => parseFloat(r.Lab色度));
const lights = rows.map(r => parseFloat(r.Lab明度));
const hueDrift = Math.max(...hues) - Math.min(...hues);
const chromaGrows = chromas.every((v, i) => i === 0 || v > chromas[i - 1]);
const lightFalls = lights.every((v, i) => i === 0 || v < lights[i - 1]);
console.log('Lab 色相角漂移:', hueDrift.toFixed(1) + '°',
  '| Lab 色度随总量上升:', chromaGrows ? '是' : '否',
  '| Lab 明度随总量下降:', lightFalls ? '是' : '否');
if (hueDrift > 8 || !chromaGrows || !lightFalls) process.exit(1);
console.log('物理模型校验通过：总量变化同时驱动色度与明度，色相保持稳定。');
