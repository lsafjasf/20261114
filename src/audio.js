export const DURATION = 32;
export const BPM = 120;
export const BEAT = 60 / BPM;
export const BAR = BEAT * 4;
export const CLIP_THRESHOLD = 0.985;
export const SAMPLE_RATE = 44100;
export const DEFAULT_SAMPLE_RATE = 44100;

export const TRACKS = [
  { id: 'kick', name: 'KICK', side: 'left', color: '#79e9c2', desc: '四拍底鼓' },
  { id: 'snare', name: 'SNARE', side: 'left', color: '#65d6ad', desc: '反拍军鼓' },
  { id: 'hats', name: 'HATS', side: 'left', color: '#55b99f', desc: '切分踩镲' },
  { id: 'bass', name: 'BASS', side: 'left', color: '#468da7', desc: '低频贝斯' },
  { id: 'pad', name: 'PAD', side: 'right', color: '#f2bd72', desc: '和声铺底' },
  { id: 'lead', name: 'LEAD', side: 'right', color: '#f3a45f', desc: '主旋律' },
  { id: 'arp', name: 'ARP', side: 'right', color: '#e68750', desc: '十六分琶音' },
  { id: 'shimmer', name: 'SHIMMER', side: 'right', color: '#d7754b', desc: '高频泛音' },
];

export const CONTROL_DEFS = {
  left: [
    {
      key: 'drums', label: 'DRUM BUS', sub: '鼓组增益', min: 0, max: 1, step: 0.01,
      default: 0.91, format: (v) => `${Math.round(v * 100)}%`,
    },
    {
      key: 'low', label: 'LOW BUS', sub: '低频增益', min: 0, max: 1, step: 0.01,
      default: 0.88, format: (v) => `${Math.round(v * 100)}%`,
    },
    {
      key: 'comp', label: 'BUS COMP', sub: '阈值 · dBFS', min: -24, max: -3, step: 0.1,
      default: -7.5, format: (v) => `${v.toFixed(1)} dB`,
    },
  ],
  right: [
    {
      key: 'melody', label: 'MELODY BUS', sub: '旋律增益', min: 0, max: 1, step: 0.01,
      default: 0.92, format: (v) => `${Math.round(v * 100)}%`,
    },
    {
      key: 'echo', label: 'ECHO', sub: '延迟送回', min: 0, max: 1, step: 0.01,
      default: 0.78, format: (v) => `${Math.round(v * 100)}%`,
    },
    {
      key: 'pan', label: 'PAN', sub: '旋律声像', min: -1, max: 1, step: 0.01,
      default: 0.16, format: (v) => v < -0.02 ? `L ${Math.abs(Math.round(v * 100))}` : v > 0.02 ? `R ${Math.round(v * 100)}` : 'C',
    },
  ],
};

export const DEFAULT_CONTROLS = {
  left: {
    drums: CONTROL_DEFS.left[0].default,
    low: CONTROL_DEFS.left[1].default,
    comp: CONTROL_DEFS.left[2].default,
  },
  right: {
    melody: CONTROL_DEFS.right[0].default,
    echo: CONTROL_DEFS.right[1].default,
    pan: CONTROL_DEFS.right[2].default,
  },
};

export const SAFE_CONTROLS = {
  left: { drums: 0.56, low: 0.5, comp: -17.5 },
  right: { melody: 0.5, echo: 0.34, pan: -0.12 },
};

const TRACK_GAINS = {
  kick: 0.82,
  snare: 0.47,
  hats: 0.2,
  bass: 0.6,
  pad: 0.3,
  lead: 0.27,
  arp: 0.2,
  shimmer: 0.16,
};

const CHORDS = [
  [45, 57, 60, 64, 69],
  [41, 53, 57, 60, 65],
  [48, 52, 55, 60, 64],
  [43, 47, 50, 55, 62],
];

const LEAD_PHRASES = [
  [[0.0, 69], [0.5, 72], [1.0, 76], [1.55, 72]],
  [[0.0, 65], [0.45, 69], [0.95, 72], [1.45, 77]],
  [[0.0, 76], [0.55, 72], [1.0, 67], [1.5, 64]],
  [[0.0, 62], [0.5, 67], [1.0, 71], [1.45, 74]],
];

function midiToHz(note) {
  return 440 * 2 ** ((note - 69) / 12);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function dbToGain(db) {
  return 10 ** (db / 20);
}

function seededNoise(seed = 0x9e3779b9) {
  let value = seed >>> 0;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return ((value >>> 0) / 4294967296) * 2 - 1;
  };
}

function makeNoiseBuffer(ctx, seconds = 0.45) {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const random = seededNoise(0x20261114);
  for (let i = 0; i < length; i += 1) data[i] = random();
  return buffer;
}

function envelope(gain, when, duration, peak, attack = 0.012) {
  const safeDuration = Math.max(0.02, duration);
  gain.setValueAtTime(0.0001, when);
  gain.linearRampToValueAtTime(Math.max(0.0002, peak), when + Math.min(attack, safeDuration * 0.35));
  gain.exponentialRampToValueAtTime(0.0001, when + safeDuration);
}

function addTone(ctx, destination, {
  when,
  duration,
  frequency,
  type = 'sine',
  gain = 0.2,
  attack = 0.01,
  detune = 0,
  filter = null,
}) {
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  const end = when + duration;
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, when);
  if (detune) osc.detune.setValueAtTime(detune, when);
  envelope(amp.gain, when, duration, gain, attack);
  let tail = osc;
  if (filter) {
    const node = ctx.createBiquadFilter();
    node.type = filter.type;
    node.frequency.setValueAtTime(filter.frequency, when);
    node.Q.value = filter.q ?? 0.7;
    tail.connect(node);
    tail = node;
  }
  tail.connect(amp).connect(destination);
  osc.start(when);
  osc.stop(end + 0.03);
  return { osc, amp };
}

function addNoise(ctx, destination, buffer, {
  when,
  duration,
  gain = 0.15,
  type = 'bandpass',
  frequency = 1800,
  q = 0.8,
}) {
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const amp = ctx.createGain();
  source.buffer = buffer;
  source.loop = true;
  source.loopStart = 0;
  source.loopEnd = buffer.duration;
  filter.type = type;
  filter.frequency.setValueAtTime(frequency, when);
  filter.Q.value = q;
  envelope(amp.gain, when, duration, gain, 0.006);
  source.connect(filter).connect(amp).connect(destination);
  source.start(when);
  source.stop(when + duration + 0.02);
  return source;
}

function cloneControls(controls) {
  return {
    left: { ...controls.left },
    right: { ...controls.right },
  };
}

function busGain(value) {
  return 0.12 + clamp(value, 0, 1) * 0.8;
}

export class MixEngine {
  constructor(ctx, controls = DEFAULT_CONTROLS, options = {}) {
    this.ctx = ctx;
    this.offline = Boolean(options.offline);
    this.controls = cloneControls(controls);
    this.noiseBuffer = makeNoiseBuffer(ctx);
    this.clipCount = 0;
    this.onlinePeak = 0;
    this.startTime = ctx.currentTime + (this.offline ? 0 : 0.055);
    this.sourceNodes = [];
    this._active = true;
    this._buildGraph();
    this._scheduleAll();
    if (!this.offline) this._connectMeter();
  }

  _buildGraph() {
    const ctx = this.ctx;
    this.masterComp = ctx.createDynamicsCompressor();
    this.masterComp.ratio.value = 3.4;
    this.masterComp.knee.value = 8;
    this.masterComp.attack.value = 0.006;
    this.masterComp.release.value = 0.24;

    this.masterTrim = ctx.createGain();
    this.masterTrim.gain.setValueAtTime(0.0001, this.startTime);
    this.masterTrim.gain.linearRampToValueAtTime(1.3, this.startTime + 0.06);
    this.masterTrim.gain.setValueAtTime(1.3, this.startTime + DURATION - 0.14);
    this.masterTrim.gain.linearRampToValueAtTime(0.0001, this.startTime + DURATION - 0.01);

    this.drumBus = ctx.createGain();
    this.lowBus = ctx.createGain();
    this.melodyBus = ctx.createGain();

    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = 0.94;
    this.delay = ctx.createDelay(1.2);
    this.delay.delayTime.value = 0.185;
    this.feedback = ctx.createGain();
    this.wetGain = ctx.createGain();
    this.panner = ctx.createStereoPanner();

    this.trackGains = {};
    TRACKS.forEach((track) => {
      const gain = ctx.createGain();
      gain.gain.value = TRACK_GAINS[track.id];
      this.trackGains[track.id] = gain;
      if (track.side === 'left') {
        gain.connect(track.id === 'bass' ? this.lowBus : this.drumBus);
      } else {
        gain.connect(this.melodyBus);
      }
    });

    this.drumBus.connect(this.masterComp);
    this.lowBus.connect(this.masterComp);
    this.melodyBus.connect(this.dryGain).connect(this.panner);
    this.melodyBus.connect(this.delay);
    this.delay.connect(this.feedback).connect(this.delay);
    this.delay.connect(this.wetGain).connect(this.panner);
    this.panner.connect(this.masterComp);
    this.masterComp.connect(this.masterTrim);
    if (this.offline) this.masterTrim.connect(ctx.destination);
    this._applyControls(true);
  }

  _applyControls(immediate = false) {
    const now = this.ctx.currentTime;
    const left = this.controls.left;
    const right = this.controls.right;
    const set = (param, value, smoothing = 0.025) => {
      if (immediate || smoothing <= 0) {
        param.value = value;
      } else {
        param.setTargetAtTime(value, now, smoothing);
      }
    };
    set(this.drumBus.gain, busGain(left.drums));
    set(this.lowBus.gain, busGain(left.low));
    set(this.masterComp.threshold, left.comp);
    set(this.melodyBus.gain, busGain(right.melody));
    set(this.dryGain.gain, 0.94 - right.echo * 0.1);
    set(this.wetGain.gain, 0.04 + right.echo * 0.5);
    set(this.feedback.gain, 0.1 + right.echo * 0.26);
    set(this.panner.pan, right.pan * 0.78);
  }

  setControl(side, key, value) {
    const def = CONTROL_DEFS[side].find((item) => item.key === key);
    if (!def) return;
    this.controls[side][key] = clamp(Number(value), def.min, def.max);
    this._applyControls(false);
  }

  setControls(controls) {
    this.controls = cloneControls(controls);
    this._applyControls(false);
  }

  _connectMeter() {
    const ctx = this.ctx;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.08;
    this.meterData = new Float32Array(this.analyser.fftSize);
    this.masterTrim.connect(this.analyser).connect(ctx.destination);

    this.probe = ctx.createScriptProcessor(2048, 2, 2);
    this.probe.onaudioprocess = (event) => {
      if (!this._active) return;
      for (let channel = 0; channel < event.inputBuffer.numberOfChannels; channel += 1) {
        const data = event.inputBuffer.getChannelData(channel);
        for (let i = 0; i < data.length; i += 1) {
          const peak = Math.abs(data[i]);
          if (peak > this.onlinePeak) this.onlinePeak = peak;
          if (peak >= CLIP_THRESHOLD) {
            this.clipCount += 1;
            if (this.onClip) this.onClip(peak);
          }
        }
      }
      for (let channel = 0; channel < event.outputBuffer.numberOfChannels; channel += 1) {
        event.outputBuffer.getChannelData(channel).fill(0);
      }
    };
    this.masterTrim.connect(this.probe);
    const silent = ctx.createGain();
    silent.gain.value = 0;
    this.probe.connect(silent).connect(ctx.destination);
  }

  _scheduleAll() {
    const bars = Math.ceil(DURATION / BAR);
    for (let bar = 0; bar < bars; bar += 1) {
      const start = this.startTime + bar * BAR;
      const chord = CHORDS[bar % CHORDS.length];
      this._schedulePad(start, chord, bar);
      this._scheduleLead(start, bar);
      for (let beat = 0; beat < 4; beat += 1) {
        const when = start + beat * BEAT;
        this._scheduleKick(when);
        if (beat === 1 || beat === 3) this._scheduleSnare(when);
        this._scheduleHat(when, beat % 2 === 0 ? 1 : 0.68);
        this._scheduleHat(when + BEAT / 2, 0.43);
        this._scheduleBass(when, chord, 0);
        this._scheduleBass(when + BEAT / 2, chord, 1);
        this._scheduleArp(when, chord, beat);
      }
      this._scheduleShimmer(start, chord, bar);
    }
  }

  _register(source) {
    if (source) this.sourceNodes.push(source);
    return source;
  }

  _scheduleKick(when) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(118, when);
    osc.frequency.exponentialRampToValueAtTime(42, when + 0.13);
    amp.gain.setValueAtTime(0.0001, when);
    amp.gain.linearRampToValueAtTime(0.74, when + 0.004);
    amp.gain.exponentialRampToValueAtTime(0.0001, when + 0.28);
    osc.connect(amp).connect(this.trackGains.kick);
    osc.start(when);
    osc.stop(when + 0.31);
    this._register(osc);
  }

  _scheduleSnare(when) {
    const noise = addNoise(this.ctx, this.trackGains.snare, this.noiseBuffer, {
      when,
      duration: 0.16,
      gain: 0.42,
      type: 'bandpass',
      frequency: 1750,
      q: 0.62,
    });
    this._register(noise);
    const body = addTone(this.ctx, this.trackGains.snare, {
      when,
      duration: 0.105,
      frequency: 176,
      type: 'triangle',
      gain: 0.16,
      attack: 0.003,
    });
    this._register(body.osc);
  }

  _scheduleHat(when, velocity) {
    const noise = addNoise(this.ctx, this.trackGains.hats, this.noiseBuffer, {
      when,
      duration: 0.038,
      gain: 0.22 * velocity,
      type: 'highpass',
      frequency: 6100,
      q: 0.45,
    });
    this._register(noise);
  }

  _scheduleBass(when, chord, step) {
    const offsets = [0, 0, 12, 7, 0, 3, 7, 10];
    const note = chord[0] + offsets[step % offsets.length];
    const tone = addTone(this.ctx, this.trackGains.bass, {
      when,
      duration: 0.205,
      frequency: midiToHz(note),
      type: 'sawtooth',
      gain: 0.58,
      attack: 0.009,
      filter: { type: 'lowpass', frequency: 265, q: 2.1 },
    });
    this._register(tone.osc);
  }

  _schedulePad(when, chord, bar) {
    const voicing = chord.slice(1);
    voicing.forEach((note, index) => {
      const tone = addTone(this.ctx, this.trackGains.pad, {
        when,
        duration: 1.94,
        frequency: midiToHz(note - (index === 0 ? 12 : 0)),
        type: index === 0 ? 'sine' : 'triangle',
        gain: 0.1,
        attack: 0.18,
        detune: (index - 1.5) * 3,
        filter: { type: 'lowpass', frequency: 720 + (bar % 3) * 90, q: 0.5 },
      });
      this._register(tone.osc);
    });
  }

  _scheduleLead(when, bar) {
    const phrase = LEAD_PHRASES[bar % LEAD_PHRASES.length];
    phrase.forEach(([offset, note], index) => {
      const next = phrase[index + 1]?.[0] ?? BAR;
      const duration = Math.min(0.36, Math.max(0.18, next - offset - 0.04));
      const tone = addTone(this.ctx, this.trackGains.lead, {
        when: when + offset,
        duration,
        frequency: midiToHz(note),
        type: 'triangle',
        gain: 0.42,
        attack: 0.018,
        filter: { type: 'lowpass', frequency: 2200, q: 0.7 },
      });
      this._register(tone.osc);
    });
  }

  _scheduleArp(when, chord, beat) {
    const order = [1, 2, 3, 1, 4, 3, 2, 1];
    for (let step = 0; step < 4; step += 1) {
      const note = chord[order[(beat * 4 + step) % order.length]];
      const tone = addTone(this.ctx, this.trackGains.arp, {
        when: when + step * (BEAT / 4),
        duration: 0.074,
        frequency: midiToHz(note + 12),
        type: 'square',
        gain: 0.31,
        attack: 0.004,
        filter: { type: 'lowpass', frequency: 1650, q: 1.2 },
      });
      this._register(tone.osc);
    }
  }

  _scheduleShimmer(when, chord, bar) {
    const notes = [chord[4] + 24, chord[3] + 24];
    notes.forEach((note, index) => {
      const tone = addTone(this.ctx, this.trackGains.shimmer, {
        when: when + 0.5 + index * 0.88,
        duration: 0.58 + index * 0.08,
        frequency: midiToHz(note),
        type: 'sine',
        gain: 0.3,
        attack: 0.012,
        detune: bar % 2 ? 5 : -4,
      });
      this._register(tone.osc);
    });
  }

  getWaveform(target = this.meterData) {
    if (!this.analyser) {
      target.fill(0);
      return target;
    }
    this.analyser.getFloatTimeDomainData(target);
    return target;
  }

  getElapsed() {
    return clamp(this.ctx.currentTime - this.startTime, 0, DURATION);
  }

  getClipCount() {
    return this.clipCount;
  }

  dispose() {
    this._active = false;
    this.sourceNodes.forEach((node) => {
      try {
        node.stop?.();
      } catch {
        // A node may already have finished.
      }
    });
    this.probe?.disconnect();
    this.analyser?.disconnect();
    try {
      this.ctx.close();
    } catch {
      // Closing an already closed context is harmless.
    }
  }
}

export function analyseBuffer(buffer) {
  let peak = 0;
  let clippedSamples = 0;
  let rms = 0;
  let sampleCount = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) {
      const value = Math.abs(data[i]);
      if (value > peak) peak = value;
      if (value >= CLIP_THRESHOLD) clippedSamples += 1;
      rms += data[i] * data[i];
      sampleCount += 1;
    }
  }
  const rmsValue = Math.sqrt(rms / Math.max(1, sampleCount));
  return {
    peak,
    peakDb: peak > 0 ? 20 * Math.log10(peak) : -Infinity,
    rmsDb: rmsValue > 0 ? 20 * Math.log10(rmsValue) : -Infinity,
    clippedSamples,
    clipped: clippedSamples > 0,
    duration: buffer.duration,
  };
}

export async function renderOfflineMix(controls) {
  const context = new OfflineAudioContext(2, Math.round(SAMPLE_RATE * DURATION), SAMPLE_RATE);
  new MixEngine(context, controls, { offline: true });
  const buffer = await context.startRendering();
  return { buffer, analysis: analyseBuffer(buffer) };
}

export function encodeWav(buffer) {
  const channels = Math.min(2, buffer.numberOfChannels);
  const frames = buffer.length;
  const bytesPerSample = 2;
  const dataSize = frames * channels * bytesPerSample;
  const array = new ArrayBuffer(44 + dataSize);
  const view = new DataView(array);

  const text = (offset, value) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  text(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, dataSize, true);

  const channelData = [];
  for (let channel = 0; channel < channels; channel += 1) {
    channelData.push(buffer.getChannelData(channel));
  }
  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = clamp(channelData[channel][frame], -1, 1);
      const pcm = sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
      view.setInt16(offset, pcm, true);
      offset += 2;
    }
  }
  return new Blob([array], { type: 'audio/wav' });
}

export { dbToGain, busGain };
