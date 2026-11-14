'use strict';

/* 坐标约定：地图 x 向东（画面右），z 向北（画面上）。
 * Web Audio 为右手系，故音频坐标 = (x, 高度, -z)，监听者面向北即默认朝向 (0,0,-1)。 */

const MATERIALS = {
  concrete: { label: '混凝土墙', lowpass: 700,  highpass: 50,  atten: 0.10, wet: 0.55, irSeconds: 1.6, irDecay: 2.0 },
  wood:     { label: '木板墙',   lowpass: 2300, highpass: 80,  atten: 0.28, wet: 0.38, irSeconds: 1.0, irDecay: 3.2 },
  glass:    { label: '玻璃墙',   lowpass: 5200, highpass: 260, atten: 0.50, wet: 0.26, irSeconds: 0.7, irDecay: 4.5 },
};

function makeNoiseBuffer(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function makeImpulseResponse(ctx, seconds, decay) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

function setNodePos(node, x, y, z) {
  if (node.positionX) {
    node.positionX.value = x;
    node.positionY.value = y;
    node.positionZ.value = z;
  } else {
    node.setPosition(x, y, z);
  }
}

/* 房间链路：声源总线 -> 材质高/低通 -> 衰减 -> HRTF 声像 -> (干声 + 房间混响) -> 输出 */
function buildRoomChain(ctx, room, out) {
  const mat = MATERIALS[room.material];
  const input = ctx.createGain();
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = mat.highpass;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = mat.lowpass;
  const atten = ctx.createGain();
  atten.gain.value = mat.atten;
  const panner = ctx.createPanner();
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = 1.2;
  panner.rolloffFactor = 0.5;
  setNodePos(panner, room.source.x, 1.5, -room.source.z);
  const convolver = ctx.createConvolver();
  convolver.buffer = makeImpulseResponse(ctx, mat.irSeconds, mat.irDecay);
  const wet = ctx.createGain();
  wet.gain.value = mat.wet;
  input.connect(hp);
  hp.connect(lp);
  lp.connect(atten);
  atten.connect(panner);
  panner.connect(out);
  panner.connect(convolver);
  convolver.connect(wet);
  wet.connect(out);
  return { input, panner };
}

function scheduleFootstep(ctx, bus, noiseBuf, t, foot) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.85 + Math.random() * 0.3;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = (foot ? 320 : 430) + Math.random() * 140;
  bp.Q.value = 1.3;
  const g = ctx.createGain();
  const peak = 0.7 + Math.random() * 0.3;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
  src.connect(bp);
  bp.connect(g);
  g.connect(bus);
  src.start(t, Math.random() * 0.5);
  src.stop(t + 0.25);
}

function startFootsteps(ctx, bus, noiseBuf, tempo) {
  let next = ctx.currentTime + 0.1;
  let foot = 0;
  const timer = setInterval(() => {
    while (next < ctx.currentTime + 0.35) {
      scheduleFootstep(ctx, bus, noiseBuf, next, foot);
      foot ^= 1;
      next += tempo + (foot ? 0.05 : -0.02) + Math.random() * 0.03;
    }
  }, 90);
  return { stop: () => clearInterval(timer) };
}

function scheduleDrip(ctx, bus, t) {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(1700 + Math.random() * 700, t);
  osc.frequency.exponentialRampToValueAtTime(480, t + 0.09);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.9, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
  osc.connect(g);
  g.connect(bus);
  osc.start(t);
  osc.stop(t + 0.3);
}

function startDrips(ctx, bus) {
  let next = ctx.currentTime + 0.15;
  const timer = setInterval(() => {
    while (next < ctx.currentTime + 0.4) {
      scheduleDrip(ctx, bus, next);
      next += 0.7 + Math.random() * 1.1;
    }
  }, 120);
  return { stop: () => clearInterval(timer) };
}

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.active = null;
  }

  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
    this.splitter = this.ctx.createChannelSplitter(2);
    this.master.connect(this.splitter);
    this.analysers = [0, 1].map((i) => {
      const a = this.ctx.createAnalyser();
      a.fftSize = 1024;
      this.splitter.connect(a, i);
      return a;
    });
    this.noiseBuf = makeNoiseBuffer(this.ctx, 1.5);
  }

  setListener(x, z) {
    const l = this.ctx.listener;
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setTargetAtTime(x, t, 0.05);
      l.positionY.setTargetAtTime(1.6, t, 0.05);
      l.positionZ.setTargetAtTime(-z, t, 0.05);
      l.forwardX.setTargetAtTime(0, t, 0.05);
      l.forwardY.setTargetAtTime(0, t, 0.05);
      l.forwardZ.setTargetAtTime(-1, t, 0.05);
      l.upX.setTargetAtTime(0, t, 0.05);
      l.upY.setTargetAtTime(1, t, 0.05);
      l.upZ.setTargetAtTime(0, t, 0.05);
    } else {
      l.setPosition(x, 1.6, -z);
      l.setOrientation(0, 0, -1, 0, 1, 0);
    }
  }

  playRoom(room) {
    this.stopAll();
    const chain = buildRoomChain(this.ctx, room, this.master);
    const handle = room.sound === 'drips'
      ? startDrips(this.ctx, chain.input)
      : startFootsteps(this.ctx, chain.input, this.noiseBuf, room.tempo || 0.55);
    this.active = handle;
  }

  stopAll() {
    if (this.active) {
      this.active.stop();
      this.active = null;
    }
  }

  getLevels() {
    if (!this.ctx) return [0, 0];
    const out = [0, 0];
    const tmp = new Float32Array(512);
    this.analysers.forEach((a, i) => {
      a.getFloatTimeDomainData(tmp);
      let sum = 0;
      for (let k = 0; k < tmp.length; k++) sum += tmp[k] * tmp[k];
      out[i] = Math.sqrt(sum / tmp.length);
    });
    return out;
  }
}

/* 离线渲染探针：用同一套房间链路渲染 1.2s，返回左右声道 RMS 与单声道过零率，
 * 供自动化测试验证方位分离度与材质频段差异。 */
async function renderOfflineProbe(room, opts) {
  const listenerX = opts.listenerX || 0;
  const sourcePos = opts.sourcePos || room.source;
  const seconds = 1.2;
  const rate = 44100;
  const ctx = new OfflineAudioContext(2, Math.floor(rate * seconds), rate);
  setNodePos(ctx.listener, listenerX, 1.6, 0);
  if (ctx.listener.forwardX) {
    ctx.listener.forwardX.value = 0;
    ctx.listener.forwardY.value = 0;
    ctx.listener.forwardZ.value = -1;
    ctx.listener.upX.value = 0;
    ctx.listener.upY.value = 1;
    ctx.listener.upZ.value = 0;
  }
  const out = ctx.createGain();
  out.connect(ctx.destination);
  const probeRoom = Object.assign({}, room, { source: sourcePos });
  const chain = buildRoomChain(ctx, probeRoom, out);
  const noise = makeNoiseBuffer(ctx, seconds);
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  src.connect(chain.input);
  src.start(0);
  const rendered = await ctx.startRendering();
  const l = rendered.getChannelData(0);
  const r = rendered.getChannelData(1);
  const skip = Math.floor(rate * 0.15);
  let sumL = 0;
  let sumR = 0;
  let crossings = 0;
  let prev = 0;
  const n = l.length - skip;
  for (let i = skip; i < l.length; i++) {
    sumL += l[i] * l[i];
    sumR += r[i] * r[i];
    const m = (l[i] + r[i]) * 0.5;
    if ((m >= 0) !== (prev >= 0)) crossings++;
    prev = m;
  }
  return {
    left: Math.sqrt(sumL / n),
    right: Math.sqrt(sumR / n),
    zcr: crossings / (n / rate),
  };
}
