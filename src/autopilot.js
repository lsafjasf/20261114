import { centerAt, slopeAt } from './map.js';
import { RESCUE_SPEED_LIMIT } from './sim.js';

const LOOK_AHEAD = 330;

// 确定性自动驾驶：用于验收“完整救援”。依据 seed 固定的地图知识选缺口、控速。
export function autopilotInput(state) {
  const { plow, map } = state;
  const cx = centerAt(map, plow.y);
  let targetOffset = 0;
  let obstacleAhead = null;

  // 找最近的前方冰墙，瞄准其缺口中心
  let nearestWall = null;
  for (const wall of map.walls) {
    const dy = wall.y - plow.y;
    if (dy > 0 && dy < 620 && (!nearestWall || dy < nearestWall.dy)) {
      nearestWall = { wall, dy };
    }
  }
  if (nearestWall) {
    const gapCenter = (nearestWall.wall.gapLeft + nearestWall.wall.gapRight) / 2;
    // 越接近冰墙，越严格对齐缺口；远处只做部分靠拢，避免猛打方向
    const blend = Math.max(0.25, 1 - nearestWall.dy / 620);
    targetOffset = gapCenter * blend;
    obstacleAhead = nearestWall;
  }

  // 侧坡带提前向坡上方压一点抵消横推；没有冰墙目标时才用坡向修正，避免和缺口目标打架
  const slope = slopeAt(map, plow.y + 90);
  if (slope !== 0 && !nearestWall) {
    targetOffset += -Math.sign(slope) * Math.min(34, Math.abs(slope) * 0.22);
  }

  // 受困车辆：接近时把速度压到救援门限以下
  let rescueTarget = null;
  for (const car of map.stranded) {
    if (car.rescued) continue;
    const dy = car.y - plow.y;
    if (dy > 0 && dy < 420) {
      rescueTarget = { car, dy };
      targetOffset = car.x - centerAt(map, plow.y);
      break;
    }
  }

  // 落石预警：落在前方道路上时减速并偏向另一侧
  for (const rock of state.rocks) {
    const dy = rock.y - plow.y;
    if (dy > 0 && dy < 260) {
      targetOffset = (rock.x - cx > 0 ? -46 : 46);
      obstacleAhead = { dy };
    }
  }

  // 强侧坡中额外持续给一点上坡方向的转向量，抵消横推
  if (Math.abs(slope) > 90 && !rescueTarget) {
    targetOffset += -Math.sign(slope) * 10;
  }

  // 道路曲率前馈：中心线在前方的横向变化
  const lookY = Math.min(map.length, plow.y + 120);
  const curvature = centerAt(map, lookY) - centerAt(map, plow.y);
  const targetX = cx + targetOffset + curvature * 0.7;
  const error = targetX - plow.x;
  let steer = 0;
  const steerDeadband = 6;
  if (Math.abs(error) > steerDeadband) {
    // 依据到达目标点的预计时间，计算需要的横向速度修正量
    const eta = Math.max(0.35, 260 / Math.max(60, plow.vy));
    const neededVx = error / eta;
    const pd = (neededVx - plow.vx) / 200;
    steer = Math.max(-1, Math.min(1, pd));
  }

  let throttle = true;
  let brake = false;
  const speed = plow.vy;

  if (rescueTarget && rescueTarget.dy < 170 && speed > RESCUE_SPEED_LIMIT - 25) {
    throttle = false;
    brake = true;
  } else if (obstacleAhead && nearestWall && nearestWall.dy < 230 && speed > 150) {
    throttle = false;
    brake = true;
  } else if (Math.abs(error) > 75 && speed > 220) {
    throttle = false; // 横向偏差大时收油，留出转向余量
  } else if (Math.abs(plow.vx) > 120) {
    throttle = false; // 侧滑征兆时收油，让抓地恢复
  } else if (speed > 300) {
    throttle = false;
  }

  // 强侧坡中限制顺坡方向的猛打，保留向上坡修正的能力
  if (Math.abs(slope) > 90 && Math.sign(steer) === Math.sign(slope)) steer *= 0.4;
  return { throttle, brake, steer };
}

// 侧滑失败脚本：在强侧坡段高速行驶、向坡下打方向，制造失控
export function skidScriptInput(state) {
  const { plow, map } = state;
  const slope = slopeAt(map, plow.y + 40);
  return {
    throttle: true,
    brake: false,
    steer: slope >= 0 ? 1 : -1, // 顺着侧坡方向打满
  };
}
