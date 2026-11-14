import { CONFIG as C } from './config.js';

// 自动驾驶状态机。输出与真人玩家同构，保证关卡可被“反向救援”打通。
// pull：锚后船，前船逆流左冲建立张力 → reel：锚前船，缆绳把后船绞回来。
export function createPilot() {
  return {
    mode: 'pull',
    timer: 0,
    entryLength: 0,
    label: '收前船（锚后船）'
  };
}

function chooseLane(rear) {
  let target = 360;
  let bestMargin = 60;
  const hazards = [
    ...C.rocks.map((h) => ({ ...h, margin: 46 })),
    ...C.whirlpools.map((h) => ({ ...h, margin: 30 }))
  ];
  for (const h of hazards) {
    if (h.x > rear.x + 60 || h.x < rear.x - 220) continue;
    const dy = rear.y - h.y;
    if (Math.abs(dy) > h.radius + bestMargin) continue;
    target = dy >= 0 ? h.y + h.radius + h.margin : h.y - h.radius - h.margin;
  }
  return target;
}

const insideZone = (b) =>
  Math.hypot(b.x - C.safeZone.x, b.y - C.safeZone.y) + C.boats.radius <= C.safeZone.radius;

export function pilotInput(pilot, world) {
  const f = world.front, r = world.rear;
  const rope = world.rope;
  pilot.timer += C.dt;

  const bothInside = insideZone(f) && insideZone(r);
  if (bothInside) {
    pilot.mode = 'hold';
    pilot.label = '安全区内驻留';
    return { thrust: 0, rearLateral: 0, anchor: 'front' };
  }

  // 后船横向避障（岩礁与涡旋），横向推进随时可用。
  const lane = chooseLane(r);
  let rearLateral = Math.max(-1, Math.min(1, (lane - r.y) / 46));

  // 张力保护：仅在真正接近安全阈值时松油/反推，避免提前泄力。
  let thrust = 1;
  if (rope.tension > C.rope.safeTension * 0.7) thrust = 0;
  if (rope.tension > C.rope.safeTension * 0.85) thrust = -0.5;

  if (pilot.mode === 'pull') {
    pilot.label = '收前船（锚后船）';
    const stretched = rope.length >= C.rope.restLength + 42;
    const tensionHigh = rope.tension >= C.rope.safeTension * 0.95;
    if ((stretched || tensionHigh || pilot.timer > 4) && pilot.timer > 0.8) {
      pilot.mode = 'reel';
      pilot.timer = 0;
      pilot.entryLength = rope.length;
      pilot.label = '锚定前船·收绳';
    }
    return { thrust, rearLateral, anchor: 'rear' };
  }

  // reel：锚住前船，缆绳把后船绞向前船，松弛后进入下一牵引循环。
  pilot.label = '锚定前船·收绳';
  const reeled = pilot.entryLength - rope.length >= 26;
  const nearRest = rope.length <= C.rope.restLength + 8;
  if ((nearRest || reeled || pilot.timer > 3.2) && pilot.timer > 0.4) {
    pilot.mode = 'pull';
    pilot.timer = 0;
    pilot.label = '收前船（锚后船）';
    return { thrust, rearLateral, anchor: null };
  }
  if (rope.tension > C.rope.safeTension * 0.95) rearLateral *= 0.4;
  return { thrust: 0, rearLateral, anchor: 'front' };
}
