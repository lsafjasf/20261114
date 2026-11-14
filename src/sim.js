import { TRAINS, JUNCTIONS, STATIONS, SIM, SWITCH_ORDER, findJunction, findStation } from './config.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const shortState = (state) => (state === 'cross' ? '越线' : '直行');

export class RailSim {
  constructor({ autoStart = false } = {}) {
    this.started = false;
    this.paused = false;
    this.manual = false;
    this.elapsed = 0;
    this.result = null;
    this.failure = null;
    this.events = [];
    this.eventSeq = 0;
    this.switches = Object.fromEntries(SWITCH_ORDER.map((id) => [id, { state: 'straight' }]));
    this.trains = TRAINS.map((spec) => this._makeTrain(spec));
    if (autoStart) this.start();
  }

  _makeTrain(spec) {
    return {
      spec,
      id: spec.id,
      name: spec.name,
      loop: spec.startLoop,
      p: spec.startP,
      speed: 0,
      status: 'waiting',
      planIndex: 0,
      visited: [],
      stationCount: 0,
      wear: 0,
      emergencyStops: 0,
      hold: null,
      holdCounted: false,
      transition: null,
      protectBraking: false,
      dwellRemaining: 0,
      finishedAt: null,
      done: false,
      derailed: false
    };
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.emit('start', '调度开始：两列车固定间隔发车');
    for (const train of this.trains) {
      if (train.spec.departAt <= 0) {
        train.status = 'running';
        train.speed = 0.006;
        this.emit('depart', `${train.name} 发车，固定间隔 ${SIM.headway.toFixed(1)} 秒`, train);
      } else {
        this.emit('interval', `${train.name} 将在 ${train.spec.departAt.toFixed(1)} 秒后发车`, train);
      }
    }
  }

  reset() {
    this.started = false;
    this.paused = false;
    this.elapsed = 0;
    this.result = null;
    this.failure = null;
    this.events = [];
    this.eventSeq = 0;
    this.switches = Object.fromEntries(SWITCH_ORDER.map((id) => [id, { state: 'straight' }]));
    this.trains = TRAINS.map((spec) => this._makeTrain(spec));
  }

  pause() {
    if (this.result) return;
    this.paused = true;
    this.emit('pause', '调度台已暂停');
  }

  resume() {
    if (this.result) return;
    this.paused = false;
    this.emit('resume', '调度台恢复运行');
  }

  emit(type, message, train = null, junction = null) {
    this.eventSeq += 1;
    this.events.push({
      id: this.eventSeq,
      time: this.elapsed,
      type,
      message,
      trainId: train ? train.id : null,
      junction
    });
    if (this.events.length > 40) this.events.shift();
  }

  getSwitchState(id) {
    return this.switches[id] ? this.switches[id].state : null;
  }

  isSwitchOccupied(id) {
    const junction = findJunction(id);
    if (!junction) return false;
    const jp = junction.p;
    const zone = SIM.switchZone;
    return this.trains.some((train) => {
      if (train.status === 'waiting' || train.done) return false;
      const near = Math.abs(train.p - jp) <= zone || (jp === 0 && Math.abs(train.p - 1) <= zone);
      if (near) return true;
      if (train.transition) {
        const tp = train.transition.p;
        return Math.abs(tp - jp) <= zone || (jp === 0 && Math.abs(tp - 1) <= zone);
      }
      return false;
    });
  }

  setSwitch(id, state, source = 'player') {
    if (!this.switches[id]) return { ok: false, reason: 'unknown' };
    if (state !== 'cross' && state !== 'straight') return { ok: false, reason: 'invalid' };
    if (this.result) return { ok: false, reason: 'finished' };
    if (this.switches[id].state === state) return { ok: false, reason: 'same' };
    if (this.isSwitchOccupied(id)) {
      this.emit('lock', `${id} 岔区被列车占用，道岔锁闭`, null, id);
      return { ok: false, reason: 'occupied' };
    }
    this.switches[id].state = state;
    this.emit('switch', `${id} 道岔扳向${shortState(state)}`, null, id);
    return { ok: true, reason: null };
  }

  toggleSwitch(id, source = 'player') {
    const state = this.switches[id] ? this.switches[id].state : null;
    return this.setSwitch(id, state === 'cross' ? 'straight' : 'cross', source);
  }

  advance(dt, { force = false } = {}) {
    if (!this.started || this.result) return;
    if (this.paused && !force) return;
    let remaining = Math.max(0, Math.min(dt, 2));
    while (remaining > 0.00001 && !this.result) {
      const step = Math.min(remaining, 1 / 60);
      this._step(step);
      remaining -= step;
    }
  }

  _step(dt) {
    this.elapsed += dt;
    for (const train of this.trains) {
      if (train.status === 'waiting' && this.elapsed >= train.spec.departAt) {
        train.status = 'running';
        train.speed = 0.006;
        this.emit('depart', `${train.name} 发车，固定间隔 ${SIM.headway.toFixed(1)} 秒`, train);
      }
    }
    for (const train of this.trains) {
      this._updateTrain(train, dt);
    }
    this._checkSafety();
  }

  _updateTrain(train, dt) {
    if (train.done || train.status === 'waiting') return;
    if (train.transition) {
      train.transition.elapsed += dt;
      if (train.transition.elapsed >= SIM.transitionTime) train.transition = null;
    }
    if (train.status === 'dwell') {
      train.dwellRemaining -= dt;
      if (train.dwellRemaining <= 0) {
        train.status = 'running';
        train.speed = 0.006;
      }
      return;
    }
    if (train.status === 'held') {
      this._tryReleaseHold(train);
      return;
    }
    if (train.protectBraking) {
      this._updateProtectBrake(train, dt);
      return;
    }

    const event = train.spec.plan[train.planIndex];
    if (!event) return;
    const normalSpeed = 1 / SIM.lapTime;

    if (event.kind === 'switch') {
      const junction = findJunction(event.junction);
      const matches = this.switches[event.junction].state === event.state;
      const stopAt = junction.p - SIM.stopBuffer;
      if (!matches) {
        if (train.p >= junction.p - SIM.stopMargin) {
          if (train.status !== 'braking') {
            train.status = 'braking';
            this.emit('brake', `${train.name} 因 ${event.junction} 道岔方向错误紧急制动`, train, event.junction);
          }
          train.speed = Math.max(0, train.speed - SIM.brakeRate * dt);
          train.p += train.speed * dt;
          if (train.speed <= 0.0001 || train.p >= stopAt) {
            this._holdAtSignal(train, event.junction, stopAt);
          }
          return;
        }
      } else if (train.status === 'braking') {
        train.status = 'running';
        this.emit('release', `${train.name} 信号开放，正在加速`, train, event.junction);
      }
      if (train.p >= junction.p) {
        train.p = Math.max(train.p, junction.p);
        this._passSwitch(train, event, junction);
        return;
      }
    }

    if (event.kind === 'station') {
      if (train.p >= event.p) {
        this._arriveStation(train, event);
        return;
      }
    }

    if (event.kind === 'finish' && train.p >= event.p) {
      this._finishTrain(train);
      return;
    }

    if (train.status === 'braking') {
      train.speed = Math.max(0, train.speed - SIM.brakeRate * 0.7 * dt);
      train.p += train.speed * dt;
      return;
    }

    const targetSpeed = normalSpeed;
    train.speed = Math.min(targetSpeed, train.speed + SIM.accel * dt);
    const nextP = train.p + train.speed * dt;

    if (event.kind === 'switch') {
      const junction = findJunction(event.junction);
      if (this.switches[event.junction].state !== event.state && nextP >= junction.p - SIM.stopBuffer) {
        train.p = junction.p - SIM.stopBuffer;
        this._holdAtSignal(train, event.junction, train.p);
        return;
      }
      if (nextP >= junction.p) {
        train.p = junction.p;
        this._passSwitch(train, event, junction);
        return;
      }
    }

    if (event.kind === 'station' && nextP >= event.p) {
      train.p = event.p;
      this._arriveStation(train, event);
      return;
    }
    if (event.kind === 'finish' && nextP >= event.p) {
      train.p = event.p;
      this._finishTrain(train);
      return;
    }
    train.p = nextP;
  }

  _passSwitch(train, event, junction) {
    const oldLoop = train.loop;
    if (event.state === 'cross') {
      const nextLoop = oldLoop === 'outer' ? 'inner' : 'outer';
      train.loop = nextLoop;
      train.transition = { from: oldLoop, to: nextLoop, p: junction.p, elapsed: 0 };
    }
    train.p = Math.max(train.p, junction.p);
    train.planIndex += 1;
    train.status = 'running';
    this.emit('switch-passed', `${train.name} 通过 ${event.junction} 道岔（${shortState(event.state)}）`, train, event.junction);
  }

  _arriveStation(train, event) {
    const station = findStation(event.station);
    if (train.loop !== event.loop) {
      train.planIndex += 1;
      this.emit('missed', `${train.name} 错过 ${station.name}，未进入对应站线`, train);
      return;
    }
    train.p = event.p;
    train.speed = 0;
    train.status = 'dwell';
    train.dwellRemaining = SIM.dwellTime;
    train.planIndex += 1;
    if (!train.visited.includes(event.station)) train.visited.push(event.station);
    train.stationCount = train.visited.length;
    this.emit('station', `${train.name} 停靠 ${station.name}，已完成 ${train.stationCount}/3 站`, train);
  }

  _holdAtSignal(train, junctionId, stopAt) {
    if (train.status === 'held') {
      train.p = Math.min(train.p, stopAt);
      return;
    }
    train.p = Math.min(train.p, stopAt);
    train.speed = 0;
    train.status = 'held';
    train.hold = { type: 'signal', junction: junctionId };
    this.emit('signal-stop', `保护停车：${train.name} 在 ${junctionId} 信号机前停车，道岔方向错误`, train, junctionId);
    if (!train.holdCounted) {
      train.holdCounted = true;
      train.emergencyStops += 1;
      train.wear = Math.min(SIM.maxWear, train.wear + SIM.emergencyWear);
      if (train.wear >= SIM.maxWear) this._derail(train, '轮对磨损超限');
    }
  }

  _tryReleaseHold(train) {
    const hold = train.hold;
    if (!hold) {
      train.status = 'running';
      return;
    }
    if (hold.type === 'signal') {
      const event = train.spec.plan[train.planIndex];
      if (event && event.kind === 'switch' && this.switches[event.junction].state === event.state) {
        train.hold = null;
        train.holdCounted = false;
        train.status = 'running';
        train.speed = 0.006;
        this.emit('signal-clear', `${train.name} 信号开放，从 ${hold.junction} 前恢复运行`, train, hold.junction);
      }
      return;
    }
    if (hold.type === 'block') {
      if (this._aheadGap(train) >= SIM.protectGap + 0.008) {
        train.hold = null;
        train.holdCounted = false;
        train.status = 'running';
        train.speed = 0.006;
        this.emit('block-clear', `${train.name} 前方区间腾空，恢复运行`, train);
      }
    }
  }

  _aheadGap(train) {
    let gap = Infinity;
    for (const other of this.trains) {
      if (other === train || other.done || other.status === 'waiting') continue;
      if (other.loop !== train.loop) continue;
      const delta = other.p - train.p;
      if (delta > 0 && delta < gap) gap = delta;
    }
    return gap;
  }

  _updateProtectBrake(train, dt) {
    const gap = this._aheadGap(train);
    if (gap >= SIM.protectGap + 0.008) {
      train.protectBraking = false;
      train.status = 'running';
      train.speed = 0.006;
      this.emit('block-clear', `${train.name} 前方区间腾空，恢复运行`, train);
      return;
    }
    train.status = 'braking';
    train.speed = Math.max(0, train.speed - SIM.brakeRate * 1.5 * dt);
    train.p += train.speed * dt;
    if (train.speed <= 0.0001 || gap < 0.02) {
      train.protectBraking = false;
      train.status = 'held';
      train.speed = 0;
      train.hold = { type: 'block' };
      if (!train.holdCounted) {
        train.holdCounted = true;
        train.emergencyStops += 1;
        train.wear = Math.min(SIM.maxWear, train.wear + SIM.emergencyWear);
        this.emit('block-stop', `${train.name} 前方区间占用，防护停车`, train);
        if (train.wear >= SIM.maxWear) this._derail(train, '轮对磨损超限');
      }
    }
  }

  _checkSafety() {
    for (const train of this.trains) {
      if (train.done || train.status === 'waiting' || train.status === 'held' || train.status === 'dwell') continue;
      const gap = this._aheadGap(train);
      if (gap < 0.006) {
        this._collision(train, '两列车进入同一轨道区间');
        return;
      }
      if (gap < SIM.protectGap && !train.protectBraking) {
        train.protectBraking = true;
        this.emit('protect-brake', `${train.name} 前方区间占用，自动防护制动`, train);
      }
    }
  }

  _finishTrain(train) {
    if (train.done) return;
    train.done = true;
    train.status = 'done';
    train.speed = 0;
    train.finishedAt = this.elapsed;
    this.emit('done', `${train.name} 完成三站任务，用时 ${this.elapsed.toFixed(1)} 秒`, train);
    if (this.trains.every((item) => item.done) && !this.failure) {
      this.result = 'win';
      this.emit('win', '两列车均完成三站且无脱轨，任务通过');
    }
  }

  _collision(train, reason) {
    if (this.failure) return;
    train.derailed = true;
    this.result = 'fail';
    this.failure = { kind: 'collision', message: reason, trainId: train.id };
    this.emit('fail', `碰撞脱轨：${reason}`, train);
  }

  _derail(train, reason) {
    if (this.failure) return;
    train.derailed = true;
    train.status = 'held';
    train.speed = 0;
    this.result = 'fail';
    this.failure = { kind: 'derail', message: reason, trainId: train.id };
    this.emit('fail', `${train.name} ${reason}，任务失败`, train);
  }

  nextEventFor(train) {
    const event = train.spec.plan[train.planIndex];
    if (!event) return null;
    if (event.kind === 'switch') {
      return { kind: 'switch', junction: event.junction, state: event.state, p: event.p };
    }
    if (event.kind === 'station') {
      return { kind: 'station', station: event.station, loop: event.loop, p: event.p };
    }
    return { kind: 'finish', p: event.p };
  }

  getState() {
    const switchList = SWITCH_ORDER.map((id) => ({
      id,
      state: this.switches[id].state,
      occupied: this.isSwitchOccupied(id)
    }));
    const trains = this.trains.map((train) => ({
      id: train.id,
      name: train.name,
      color: train.spec.color,
      accent: train.spec.accent,
      loop: train.loop,
      p: train.p,
      speed: train.speed,
      status: train.status,
      stationCount: train.stationCount,
      visited: [...train.visited],
      wear: train.wear,
      emergencyStops: train.emergencyStops,
      hold: train.hold ? { ...train.hold } : null,
      transition: train.transition ? { ...train.transition } : null,
      nextEvent: this.nextEventFor(train),
      done: train.done,
      derailed: train.derailed,
      departAt: train.spec.departAt,
      finishedAt: train.finishedAt
    }));
    return {
      started: this.started,
      paused: this.paused,
      manual: this.manual,
      elapsed: this.elapsed,
      result: this.result,
      failure: this.failure ? { ...this.failure } : null,
      trains,
      switches: switchList,
      events: this.events.slice(-9),
      headway: SIM.headway
    };
  }
}

export function createSim(options) {
  return new RailSim(options);
}
