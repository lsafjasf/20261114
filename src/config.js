// 固定场景的全部可调参数。物理单位：像素、秒、牛顿（归一化力）。
export const CONFIG = {
  world: { width: 1280, height: 720 },

  // 海流：整体向右（远离沉船），横向带轻微梯度。
  current: { baseX: 34, shearY: 10, noise: 6 },

  boats: {
    mass: 1,
    radius: 17,
    linearDrag: 0.55,
    maxThrust: 480,        // 前船轴向推进力（满油可拉爆缆绳，考验张力管理）
    rearLateral: 130,      // 后船横移推进力
    hullMax: 100
  },

  rope: {
    restLength: 150,
    stiffness: 3.2,
    damping: 1.15,
    safeTension: 400,      // 超过即拉伤船体
    damageRate: 0.16,      // 单位超额张力的损伤速率
    renderWidth: 4
  },

  // 安全区（沉船位于区内左侧）。
  safeZone: { x: 200, y: 360, radius: 165 },
  wreck: { x: 108, y: 360, radius: 30, keepOut: 40 },

  // 固定危险物：岩礁（碰撞）与涡旋（圆形力场）。
  rocks: [
    { x: 486, y: 150, radius: 34 },
    { x: 700, y: 560, radius: 40 }
  ],
  whirlpools: [
    { x: 610, y: 520, radius: 95, strength: 55 },
    { x: 880, y: 235, radius: 90, strength: 50 }
  ],

  start: {
    front: { x: 640, y: 330 },
    rear: { x: 770, y: 360 }
  },

  win: {
    maxSpeed: 26,          // 安全区内驻留允许的最大速度
    holdTime: 1.5
  },

  audio: {
    slackFreq: 70,
    tightFreq: 520,
    masterGain: 0.16
  },

  dt: 1 / 60
};

export const KEYS = {
  thrustForward: ['KeyW'],
  thrustReverse: ['KeyS'],
  rearUp: ['ArrowUp'],
  rearDown: ['ArrowDown'],
  anchorFront: ['ShiftLeft'],
  anchorRear: ['ShiftRight'],
  restart: ['KeyR'],
  autopilot: ['KeyP'],
  mute: ['KeyM']
};
