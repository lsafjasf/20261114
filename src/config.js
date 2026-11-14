export const WORLD = { width: 1280, height: 720, cx: 640, cy: 360 };

export const LOOPS = {
  outer: { rx: 466, ry: 208, label: '外环' },
  inner: { rx: 304, ry: 136, label: '内环' }
};

export const JUNCTIONS = [
  { id: 'NW', p: 0.25, angle: 225, label: '西北岔', short: 'NW' },
  { id: 'NE', p: 0.5, angle: 315, label: '东北岔', short: 'NE' },
  { id: 'SE', p: 0.75, angle: 45, label: '东南岔', short: 'SE' },
  { id: 'SW', p: 0, angle: 135, label: '西南岔', short: 'SW' }
];

export const STATIONS = [
  { id: 'o-west', loop: 'outer', p: 0.125, name: '西口', code: 'O1' },
  { id: 'i-west', loop: 'inner', p: 0.125, name: '磨坊', code: 'I1' },
  { id: 'o-north', loop: 'outer', p: 0.375, name: '北岸', code: 'O2' },
  { id: 'i-north', loop: 'inner', p: 0.375, name: '林间', code: 'I2' },
  { id: 'o-east', loop: 'outer', p: 0.625, name: '东仓', code: 'O3' },
  { id: 'i-east', loop: 'inner', p: 0.625, name: '内湾', code: 'I3' },
  { id: 'o-south', loop: 'outer', p: 0.875, name: '南桥', code: 'O4' },
  { id: 'i-south', loop: 'inner', p: 0.875, name: '下坡', code: 'I4' }
];

export const TRAINS = [
  {
    id: 'blue',
    name: '蓝隼号',
    color: '#4da3ff',
    accent: '#d8edff',
    startLoop: 'outer',
    startP: 0.03,
    departAt: 0,
    stations: [
      { id: 'o-north', label: '北岸', code: 'O2' },
      { id: 'i-east', label: '内湾', code: 'I3' },
      { id: 'o-south', label: '南桥', code: 'O4' }
    ],
    plan: [
      { kind: 'switch', junction: 'NW', p: 0.25, state: 'straight' },
      { kind: 'station', station: 'o-north', loop: 'outer', p: 0.375 },
      { kind: 'switch', junction: 'NE', p: 0.5, state: 'cross' },
      { kind: 'station', station: 'i-east', loop: 'inner', p: 0.625 },
      { kind: 'switch', junction: 'SE', p: 0.75, state: 'cross' },
      { kind: 'station', station: 'o-south', loop: 'outer', p: 0.875 },
      { kind: 'switch', junction: 'SW', p: 1, state: 'straight' },
      { kind: 'finish', p: 1.001 }
    ]
  },
  {
    id: 'amber',
    name: '琥珀号',
    color: '#f6b73c',
    accent: '#fff1c9',
    startLoop: 'inner',
    startP: 0.03,
    departAt: 10.5,
    stations: [
      { id: 'i-west', label: '磨坊', code: 'I1' },
      { id: 'o-north', label: '北岸', code: 'O2' },
      { id: 'i-south', label: '下坡', code: 'I4' }
    ],
    plan: [
      { kind: 'station', station: 'i-west', loop: 'inner', p: 0.125 },
      { kind: 'switch', junction: 'NW', p: 0.25, state: 'cross' },
      { kind: 'station', station: 'o-north', loop: 'outer', p: 0.375 },
      { kind: 'switch', junction: 'NE', p: 0.5, state: 'cross' },
      { kind: 'switch', junction: 'SE', p: 0.75, state: 'straight' },
      { kind: 'station', station: 'i-south', loop: 'inner', p: 0.875 },
      { kind: 'switch', junction: 'SW', p: 1, state: 'straight' },
      { kind: 'finish', p: 1.001 }
    ]
  }
];

export const SIM = {
  lapTime: 48,
  dwellTime: 2.25,
  headway: 10.5,
  emergencyWear: 18,
  maxWear: 100,
  switchZone: 0.022,
  stopMargin: 0.055,
  stopBuffer: 0.032,
  transitionTime: 0.42,
  protectGap: 0.05,
  brakeRate: 0.035,
  accel: 0.012
};

export const SWITCH_ORDER = ['NW', 'NE', 'SE', 'SW'];

export function findStation(id) {
  return STATIONS.find((station) => station.id === id);
}

export function findJunction(id) {
  return JUNCTIONS.find((junction) => junction.id === id);
}
