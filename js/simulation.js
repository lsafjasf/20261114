// 电梯调度仿真核心（无 DOM 依赖，可在 Node 与浏览器中运行）
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ElevatorSim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FLOORS = 8;              // 楼层数（1..8）
  const CARS = 3;                // 电梯数量
  const CAPACITY = 6;            // 单梯额定载客
  const TIME_LIMIT = 480;        // 时限 8 分钟（秒）
  const STEP = 0.1;              // 仿真步长（秒）
  const PATIENCE = 28;           // 乘客等待忍耐上限（秒）
  const COMPLAINT_LIMIT = 3;     // 投诉上限

  // 速度档位：楼层/秒，启停附加能耗，运行每秒能耗
  // 能耗单位：度（游戏内显示用，已按可读量级缩放）
  const SPEED_PROFILES = {
    slow:   { label: '慢速', speed: 0.5, moveJ: 0.8, energyPerSec: 1.0 },
    medium: { label: '中速', speed: 0.8, moveJ: 1.4, energyPerSec: 1.8 },
    fast:   { label: '快速', speed: 1.2, moveJ: 2.2, energyPerSec: 2.8 },
  };

  const DOOR_TIME = 3;           // 每次开门停靠总时长（秒）
  const DOOR_ENERGY = 0.4;       // 每次开关门能耗
  const IDLE_ENERGY_PER_SEC = 0.05;
  const FULL_LOAD_RATIO = 0.6;   // 满载直驶阈值（载客 ≥4 人）
  const HOME_GRACE = 6;          // 空闲多少秒后才回位

  // 固定的上下班客流：到达时间、起始层、目的层均为确定性
  function buildSchedule() {
    const list = [];
    let pid = 0;
    const add = (time, from, to) =>
      list.push({ id: ++pid, time: Math.round(time * 10) / 10, from, to });

    // 早高峰（0-90s）：大堂密集涌入上行
    const up = [
      [4, 3], [8, 6], [12, 8], [16, 4], [20, 7], [24, 5],
      [28, 8], [32, 2], [36, 6], [40, 3], [44, 7], [48, 5],
      [52, 4], [56, 8], [60, 6], [64, 2], [70, 5], [76, 7],
      [82, 8], [86, 3],
    ];
    up.forEach(([t, to]) => add(t, 1, to));
    // 早高峰少量反向
    add(30, 5, 1); add(50, 7, 1); add(68, 4, 2);

    // 午间双向（110-260s）
    const mid = [
      [112, 6, 2], [126, 2, 7], [140, 8, 3], [154, 1, 5],
      [168, 5, 8], [182, 7, 1], [196, 3, 6], [210, 1, 4],
      [224, 4, 1], [238, 6, 8], [252, 8, 1],
    ];
    mid.forEach(([t, f, to]) => add(t, f, to));

    // 晚高峰（300-430s）：高层密集下行至大堂
    const down = [
      [302, 7, 1], [308, 8, 1], [314, 5, 1], [320, 6, 2],
      [326, 4, 1], [332, 8, 1], [338, 3, 1], [344, 7, 1],
      [350, 5, 1], [356, 6, 1], [362, 8, 3], [368, 4, 1],
      [374, 7, 1], [380, 5, 2], [386, 6, 1], [394, 8, 1],
      [402, 7, 2], [410, 5, 1], [418, 4, 1],
      [424, 6, 1], [429, 8, 1],
    ];
    down.forEach(([t, f, to]) => add(t, f, to));
    // 晚高峰零散上行
    add(330, 1, 6); add(372, 1, 8);

    return list.sort((a, b) => a.time - b.time);
  }

  class Simulation {
    constructor(config) {
      this.config = config;
      this.time = 0;
      this.schedule = buildSchedule().map((p) => ({
        ...p,
        state: 'pending',       // pending -> waiting -> riding -> delivered
        complained: false,
        boardTime: null,
        waitSec: null,
        rideSec: null,
      }));
      this.cars = [];
      for (let i = 0; i < CARS; i++) {
        this.cars.push({
          id: i,
          floor: config.homes[i],
          pos: config.homes[i],     // 连续位置（楼层单位）
          dir: 0,
          mode: 'idle',             // idle | moving | doors
          timer: 0,
          target: null,
          occupants: [],
          strategy: config.strategies[i],
          speedKey: config.speeds[i],
          home: config.homes[i],
          idleTime: 0,
        });
      }
      this.waiting = [];             // 尚在厅外等候的乘客
      this.energy = 0;
      this.stops = 0;
      this.starts = 0;
      this.complaints = 0;
      this.maxWait = 0;
      this.totalWait = 0;
      this.events = [];
      this.finished = false;
      this.result = null;
      this._spawnIdx = 0;
    }

    get delivered() {
      return this.schedule.filter((p) => p.state === 'delivered').length;
    }

    waitingAt(floor) {
      return this.waiting.filter((p) => p.from === floor);
    }

    _emit(type, payload) {
      this.events.push({ t: this.time, type, ...payload });
    }

    _spawnDue() {
      while (this._spawnIdx < this.schedule.length &&
        this.schedule[this._spawnIdx].time <= this.time + 1e-9) {
        const p = this.schedule[this._spawnIdx++];
        p.state = 'waiting';
        this.waiting.push(p);
        this._emit('spawn', { passenger: p.id, floor: p.from });
      }
    }

    _checkTimeouts() {
      for (const p of this.waiting) {
        const waited = this.time - p.time;
        if (!p.complained && waited >= PATIENCE) {
          p.complained = true;
          this.complaints += 1;
          this._emit('complaint', { passenger: p.id, floor: p.from });
        }
        if (waited > this.maxWait) this.maxWait = waited;
      }
    }

    snapshot() {
      return {
        time: this.time,
        energy: this.energy,
        stops: this.stops,
        starts: this.starts,
        complaints: this.complaints,
        delivered: this.delivered,
        total: this.schedule.length,
        maxWait: this.maxWait,
        budget: this.config.budget,
        finished: this.finished,
        result: this.result,
        cars: this.cars.map((c) => ({
          id: c.id,
          pos: c.pos,
          floor: c.floor,
          dir: c.dir,
          mode: c.mode,
          target: c.target,
          home: c.home,
          load: c.occupants.length,
          capacity: CAPACITY,
          strategy: c.strategy,
          speedKey: c.speedKey,
          riders: c.occupants.map((p) => p.id),
        })),
        waiting: this.waiting.map((p) => ({
          id: p.id, from: p.from, to: p.to,
          waited: this.time - p.time, complained: p.complained,
        })),
      };
    }

    _hallRequests() {
      const map = new Map();
      for (const p of this.waiting) {
        const key = p.from + ':' + (p.to > p.from ? 1 : -1);
        if (!map.has(key)) map.set(key, { floor: p.from, dir: p.to > p.from ? 1 : -1 });
      }
      return [...map.values()];
    }

    _full(car) {
      return car.occupants.length >= CAPACITY * FULL_LOAD_RATIO;
    }

    // 选择下一目标楼层；无任务时返回 null（进入空闲回位逻辑）
    _targetFor(car) {
      const dropFloors = [...new Set(car.occupants.map((p) => p.to))];
      let pickups = this._hallRequests();
      if (car.strategy === 'fullload' && this._full(car)) pickups = [];
      if (car.strategy === 'allstop' || car.strategy === 'fullload') {
        const floors = [...new Set([
          ...dropFloors,
          ...pickups.map((q) => q.floor),
        ])];
        if (!floors.length) return null;
        return floors.reduce((best, f) =>
          Math.abs(f - car.pos) < Math.abs(best - car.pos) ? f : best);
      }
      // collective：SCAN 调度，按当前方向扫单
      const dir = car.dir !== 0 ? car.dir : 1;
      const ahead = (f) => dir > 0 ? f > car.pos + 1e-9 : f < car.pos - 1e-9;
      const aheadDrops = dropFloors.filter(ahead);
      const aheadPicks = pickups
        .filter((q) => ahead(q.floor) && q.dir === dir)
        .map((q) => q.floor);
      const aheadAll = [...new Set([...aheadDrops, ...aheadPicks])];
      if (aheadAll.length) {
        return dir > 0 ? Math.min(...aheadAll) : Math.max(...aheadAll);
      }
      // 反向仍有内选：掉头而不是只挑最近层，保持 SCAN 完整性
      if (dropFloors.length) {
        return dir > 0 ? Math.max(...dropFloors) : Math.min(...dropFloors);
      }
      const anyFloors = [...new Set([
        ...dropFloors,
        ...pickups.map((q) => q.floor),
      ])];
      if (!anyFloors.length) return null;
      return anyFloors.reduce((best, f) =>
        Math.abs(f - car.pos) < Math.abs(best - car.pos) ? f : best);
    }

    _alight(car) {
      const staying = [];
      for (const p of car.occupants) {
        if (p.to === car.floor) {
          p.state = 'delivered';
          p.rideSec = this.time - p.boardTime;
          this.totalWait += p.waitSec;
          this._emit('alight', { passenger: p.id, car: car.id, floor: car.floor });
        } else {
          staying.push(p);
        }
      }
      car.occupants = staying;
    }

    _board(car) {
      if (car.strategy === 'fullload' && this._full(car)) return;
      const here = this.waiting.filter((p) => p.from === car.floor);
      for (const p of here) {
        if (car.occupants.length >= CAPACITY) break;
        const pdir = p.to > p.from ? 1 : -1;
        if (car.strategy === 'collective' && car.dir !== 0 && pdir !== car.dir) {
          const sameDirAhead = this._hallRequests()
            .some((q) => q.dir === car.dir &&
              (car.dir > 0 ? q.floor > car.floor : q.floor < car.floor));
          const dropAhead = car.occupants
            .some((r) => car.dir > 0 ? r.to > car.floor : r.to < car.floor);
          if (sameDirAhead || dropAhead) continue;
        }
        car.occupants.push(p);
        p.state = 'riding';
        p.boardTime = this.time;
        p.waitSec = this.time - p.time;
        this.waiting = this.waiting.filter((w) => w.id !== p.id);
        this._emit('board', { passenger: p.id, car: car.id, floor: car.floor });
      }
    }

    _startMoving(car, target) {
      const profile = SPEED_PROFILES[car.speedKey];
      car.target = target;
      car.dir = target > car.pos ? 1 : -1;
      car.mode = 'moving';
      this.starts += 1;
      this.energy += profile.moveJ;
      this._emit('start', { car: car.id, target, dir: car.dir });
    }

    _retarget(car, target) {
      car.target = target;
      car.dir = target > car.pos ? 1 : -1;
      this._emit('retarget', { car: car.id, target });
    }

    _updateCar(car) {
      const profile = SPEED_PROFILES[car.speedKey];
      if (car.mode === 'doors') {
        car.timer -= STEP;
        if (car.timer <= 0) {
          car.mode = 'idle';
          car.target = null;
          car.idleTime = 0;
          this._emit('doorClose', { car: car.id });
        }
        return;
      }
      if (car.mode === 'moving') {
        // 途中复算：原目标若已无需服务（呼叫被邻车接走），立即改派
        if (Math.abs(car.target - car.pos) > 1 + 1e-9) {
          const revised = this._targetFor(car);
          if (revised == null) {
            car.mode = 'idle';
            car.target = null;
            car.dir = 0;
            car.idleTime = 0;
            this._emit('retarget', { car: car.id });
          } else if (revised !== car.target) {
            this._retarget(car, revised);
          }
        }
        const distance = profile.speed * STEP;
        const remaining = Math.abs(car.target - car.pos);
        this.energy += profile.energyPerSec * STEP;
        if (remaining <= distance) {
          car.pos = car.target;
          car.floor = car.target;
          car.dir = 0;
          car.mode = 'doors';
          car.timer = DOOR_TIME;
          car.target = null;
          this.stops += 1;
          this.energy += profile.moveJ + DOOR_ENERGY;
          this._emit('arrive', { car: car.id, floor: car.floor });
          this._alight(car);
          this._board(car);
        } else {
          car.pos += car.dir * distance;
        }
        return;
      }
      // idle：待机耗电 + 寻找任务 / 回位
      this.energy += IDLE_ENERGY_PER_SEC * STEP;
      car.idleTime += STEP;
      const target = this._targetFor(car);
      if (target != null) {
        this._startMoving(car, target);
      } else if (car.floor !== car.home && car.idleTime >= HOME_GRACE) {
        this._startMoving(car, car.home);
        this._emit('homing', { car: car.id, home: car.home });
      }
    }

    step() {
      if (this.finished) return;
      this.time = Math.round((this.time + STEP) * 10) / 10;
      this._spawnDue();
      for (const car of this.cars) this._updateCar(car);
      this._checkTimeouts();
      const allDone = this.delivered === this.schedule.length;
      if (allDone || this.time >= TIME_LIMIT) this._finish(allDone);
    }

    _finish(allDone) {
      this.finished = true;
      const avgWait = this.delivered ? this.totalWait / this.delivered : null;
      const reasons = [];
      if (!allDone) reasons.push(`尚有 ${this.schedule.length - this.delivered} 人未送达`);
      if (this.time > TIME_LIMIT) reasons.push('超过 8 分钟时限');
      if (this.energy > this.config.budget) reasons.push('超出电量预算');
      if (this.complaints > COMPLAINT_LIMIT) reasons.push('投诉数超限');
      this.result = {
        success: reasons.length === 0,
        reasons,
        time: this.time,
        energy: this.energy,
        budget: this.config.budget,
        stops: this.stops,
        starts: this.starts,
        complaints: this.complaints,
        delivered: this.delivered,
        total: this.schedule.length,
        avgWait,
        maxWait: this.maxWait,
      };
      this._emit('finish', { result: this.result });
    }

    runHeadless() {
      let guard = 0;
      while (!this.finished && guard < (TIME_LIMIT / STEP) + 5) {
        this.step();
        guard += 1;
      }
      return this.result;
    }
  }

  return {
    FLOORS, CARS, CAPACITY, TIME_LIMIT, STEP, PATIENCE,
    COMPLAINT_LIMIT, SPEED_PROFILES, DOOR_TIME, DOOR_ENERGY,
    IDLE_ENERGY_PER_SEC, FULL_LOAD_RATIO, HOME_GRACE,
    buildSchedule, Simulation,
  };
});
