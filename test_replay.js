/* 用与页面 main.js 相同的规则回放演示序列，验证能完整完成抓取放置。 */
const A = require('./arm.js');
const fs = require('fs');
eval(fs.readFileSync(__dirname + '/demo_sequence.js', 'utf8')
  .replace('const DEMO_SEQUENCE', 'globalThis.DEMO_SEQUENCE'));

let cur = DEMO_SEQUENCE[0].q.slice();
let piece = { x: A.PIECE_HOME.x, y: A.PIECE_HOME.y };
let carrying = false, placed = false;
const dt = 1 / 120;

for (let i = 1; i < DEMO_SEQUENCE.length; i++) {
  const target = DEMO_SEQUENCE[i].q;
  let steps = 0;
  while (!A.reached(cur, target)) {
    const r = A.stepJoints(cur, target, dt);
    cur = r.q;
    // 与页面相同的抓取/释放判定
    const f = A.fk(cur);
    const gx = f.tip.x + Math.cos(f.a4) * 6;
    const gy = f.tip.y + Math.sin(f.a4) * 6;
    if (!carrying && !placed && cur[4] < 0.35 && cur[5] < 0.35 &&
        Math.hypot(gx - piece.x, gy - piece.y) < 16) carrying = true;
    if (carrying && cur[4] > 0.6 && cur[5] > 0.6) {
      carrying = false;
      const inF = piece.x > A.FIXTURE_R.x && piece.x < A.FIXTURE_R.x + A.FIXTURE_R.w;
      const inP = piece.x > A.PALLET_L.x && piece.x < A.PALLET_L.x + A.PALLET_L.w;
      piece.y = inF || inP ? 445 : A.GROUND_Y - A.PIECE_R;
      if (inF && Math.abs(piece.x - A.DROP_ZONE.x) < 25) placed = true;
    }
    if (carrying) { piece.x = gx; piece.y = gy; }
    const hit = A.checkCollision({ q: cur, carrying, piece });
    if (hit) { console.error('回放碰撞 [' + DEMO_SEQUENCE[i].label + ']: ' + hit); process.exit(1); }
    if (++steps > 20000) { console.error('回放超时: ' + DEMO_SEQUENCE[i].label); process.exit(1); }
  }
}

if (!placed) { console.error('回放结束但工件未放入夹具', piece); process.exit(1); }
console.log('页面规则回放验证通过：工件已放入夹具 (' + piece.x.toFixed(1) + ', ' + piece.y.toFixed(1) + ')');
