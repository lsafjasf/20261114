(() => {
  "use strict";

  const DURATION = 360;
  const SAVE_VERSION = 1;
  const NODE_COLORS = ["#c9d5b8", "#e5bf7a", "#8ec4b4", "#d8ad94", "#aeb9dc", "#e6d19c"];
  const NODE_DEFS = [
    { id: "moss", name: "苔阶", type: "SINE / EARTH MEMORY", glyph: "❧", timbre: "moss", x: 0.16, y: 0.76, radius: 0.06, pitch: 196, delay: 0, decay: 3.6 },
    { id: "chime", name: "风铃", type: "FM BELL / WIND", glyph: "✦", timbre: "chime", x: 0.39, y: 0.52, radius: 0.056, pitch: 293.66, delay: 240, decay: 4.2 },
    { id: "water", name: "水影", type: "FILTERED NOISE / WATER", glyph: "◌", timbre: "water", x: 0.48, y: 0.70, radius: 0.058, pitch: 392, delay: 420, decay: 2.8 },
    { id: "firefly", name: "萤火", type: "SINE PULSE / LIGHT", glyph: "✧", timbre: "firefly", x: 0.67, y: 0.47, radius: 0.052, pitch: 587.33, delay: 620, decay: 1.9 },
    { id: "stone", name: "石响", type: "LOW NOISE / STONE", glyph: "▽", timbre: "stone", x: 0.75, y: 0.30, radius: 0.054, pitch: 146.83, delay: 860, decay: 5.2 },
    { id: "moon", name: "月潮", type: "TRIANGLE / NIGHT TIDE", glyph: "☾", timbre: "moon", x: 0.84, y: 0.49, radius: 0.062, pitch: 440, delay: 1120, decay: 6.4 }
  ];
  const DEFAULT_PATH = [
    [0.055, 0.875], [0.10, 0.83], [0.16, 0.76], [0.245, 0.705],
    [0.335, 0.625], [0.39, 0.52], [0.435, 0.44], [0.395, 0.35],
    [0.31, 0.305], [0.265, 0.39], [0.345, 0.48], [0.43, 0.59],
    [0.48, 0.70], [0.565, 0.745], [0.635, 0.69], [0.67, 0.585],
    [0.67, 0.47], [0.69, 0.36], [0.75, 0.30], [0.82, 0.325],
    [0.84, 0.49], [0.90, 0.59], [0.87, 0.70], [0.76, 0.76],
    [0.62, 0.79], [0.47, 0.80], [0.33, 0.82], [0.20, 0.845]
  ];

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const dom = {
    canvas: $("#gardenCanvas"),
    canvasWrap: $("#canvasWrap"),
    nodeSwitcher: $("#nodeSwitcher"),
    modeButtons: $$(".mode-btn"),
    playBtn: $("#playBtn"),
    resetBtn: $("#resetBtn"),
    exportBtn: $("#exportBtn"),
    importJson: $("#importJson"),
    helpBtn: $("#helpBtn"),
    helpDialog: $("#helpDialog"),
    helpClose: $("#helpClose"),
    timeline: $("#timeline"),
    timelineEvents: $("#timelineEvents"),
    playhead: $("#playhead"),
    currentTime: $("#currentTime"),
    transportState: $("#transportState"),
    transportDetail: $("#transportDetail"),
    audioStatus: $("#audioStatus"),
    audioStatusText: $("#audioStatusText"),
    pathStatus: $("#pathStatus"),
    canvasHint: $("#canvasHint"),
    nodeGlyph: $("#nodeGlyph"),
    nodeName: $("#nodeName"),
    nodeType: $("#nodeType"),
    reachBadge: $("#reachBadge"),
    selectionNumber: $("#selectionNumber"),
    pitchValue: $("#pitchValue"),
    noteName: $("#noteName"),
    pitchRange: $("#pitchRange"),
    delayRange: $("#delayRange"),
    decayRange: $("#decayRange"),
    pitchOutput: $("#pitchOutput"),
    delayOutput: $("#delayOutput"),
    decayOutput: $("#decayOutput"),
    wavePreview: $("#wavePreview"),
    volumeRange: $("#volumeRange"),
    toast: $("#toast")
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const lerp = (a, b, amount) => a + (b - a) * amount;
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const formatTime = (seconds) => {
    const safe = clamp(Math.round(seconds), 0, DURATION);
    return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
  };

  function seededValue(index, salt = 0) {
    const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453123;
    return value - Math.floor(value);
  }

  function noteFromFrequency(frequency) {
    const names = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
    const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
    return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
  }

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function makeDefaultState() {
    const nodes = NODE_DEFS.map((node, index) => ({ ...node, color: NODE_COLORS[index] }));
    return {
      version: SAVE_VERSION,
      title: "夜园声景",
      duration: DURATION,
      path: DEFAULT_PATH.map(([x, y]) => ({ x, y })),
      nodes,
      selected: 2,
      mode: "edit",
      isPlaying: false,
      currentTime: 0,
      volume: 0.72
    };
  }

  const state = makeDefaultState();
  const view = {
    width: 0,
    height: 0,
    dpr: 1,
    routePoints: [],
    routeSamples: [],
    routeLength: 0,
    crossings: [],
    hoveredNode: -1,
    draggingNode: -1,
    drawing: false,
    drawPointerId: null,
    scrubPointerId: null,
    lastFrame: performance.now(),
    lastUiUpdate: 0,
    pulses: [],
    lastPulse: null,
    playbackAnchor: 0,
    playbackOffset: 0,
    seekVersion: 0,
    scheduledEvents: new Set(),
    scheduledAmbient: new Set(),
    visualEvents: new Set(),
    reachedEvents: new Set(),
    audioReady: false,
    audioError: "",
    statusMessage: "",
    statusUntil: 0
  };
  let ctx2d = null;
  let toastTimer = 0;

  function showToast(message, isError = false) {
    clearTimeout(toastTimer);
    dom.toast.textContent = message;
    dom.toast.classList.toggle("is-error", isError);
    dom.toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => dom.toast.classList.remove("is-visible"), 2800);
  }

  function catmullRom(p0, p1, p2, p3, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    return {
      x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
      y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
    };
  }

  function rebuildRouteGeometry() {
    const width = view.width;
    const height = view.height;
    if (!width || !height || state.path.length < 2) {
      view.routeSamples = [];
      view.routeLength = 0;
      view.crossings = state.nodes.map((node, nodeIndex) => ({ nodeIndex, time: null, reached: false }));
      return;
    }

    const raw = state.path.map((point) => ({ x: point.x * width, y: point.y * height }));
    const expanded = [{ ...raw[0] }];
    for (let i = 0; i < raw.length - 1; i += 1) {
      const p0 = raw[Math.max(0, i - 1)];
      const p1 = raw[i];
      const p2 = raw[i + 1];
      const p3 = raw[Math.min(raw.length - 1, i + 2)];
      const steps = clamp(Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / 7), 4, 24);
      for (let step = 1; step <= steps; step += 1) {
        expanded.push(catmullRom(p0, p1, p2, p3, step / steps));
      }
    }

    let total = 0;
    const cumulative = [0];
    for (let i = 1; i < expanded.length; i += 1) {
      total += Math.hypot(expanded[i].x - expanded[i - 1].x, expanded[i].y - expanded[i - 1].y);
      cumulative.push(total);
    }

    view.routeLength = total;
    view.routeSamples = expanded.map((point, index) => {
      const prev = expanded[Math.max(0, index - 1)];
      const next = expanded[Math.min(expanded.length - 1, index + 1)];
      return {
        x: point.x / width,
        y: point.y / height,
        px: point.x,
        py: point.y,
        t: total ? cumulative[index] / total : 0,
        angle: Math.atan2(next.y - prev.y, next.x - prev.x)
      };
    });

    view.crossings = state.nodes.map((node, nodeIndex) => {
      const radius = node.radius * Math.min(width, height);
      let hitIndex = -1;
      let bestIndex = 0;
      let bestDistance = Infinity;
      for (let i = 0; i < view.routeSamples.length; i += 1) {
        const sample = view.routeSamples[i];
        const dist = Math.hypot(sample.px - node.x * width, sample.py - node.y * height);
        if (dist < bestDistance) {
          bestDistance = dist;
          bestIndex = i;
        }
        if (dist <= radius) {
          hitIndex = i;
          break;
        }
      }
      const reached = bestDistance <= radius;
      return {
        nodeIndex,
        time: reached ? view.routeSamples[hitIndex >= 0 ? hitIndex : bestIndex].t * DURATION : null,
        closestTime: view.routeSamples[bestIndex]?.t * DURATION ?? null,
        distance: bestDistance,
        radius,
        reached
      };
    });

    renderTimelineEvents();
    updateCanvasReadout();
  }

  function getRoutePose(progress) {
    if (!view.routeSamples.length) {
      return { x: 0.5, y: 0.5, angle: 0, progress: 0 };
    }
    const t = clamp(progress, 0, 1);
    const samples = view.routeSamples;
    let low = 0;
    let high = samples.length - 1;
    while (low < high - 1) {
      const middle = (low + high) >> 1;
      if (samples[middle].t <= t) low = middle;
      else high = middle;
    }
    const a = samples[low];
    const b = samples[high];
    const span = b.t - a.t || 1;
    const amount = clamp((t - a.t) / span, 0, 1);
    return {
      x: lerp(a.x, b.x, amount),
      y: lerp(a.y, b.y, amount),
      angle: a.angle + Math.atan2(Math.sin(b.angle - a.angle), Math.cos(b.angle - a.angle)) * amount,
      progress: t
    };
  }

  function getRouteCanvasPoints(from = 0, to = 1) {
    return view.routeSamples
      .filter((sample) => sample.t >= from && sample.t <= to)
      .map((sample) => ({ x: sample.px, y: sample.py }));
  }

  function getPathDistanceInMeters() {
    return Math.round(view.routeLength * 0.0068);
  }

  function updateCanvasReadout() {
    const touches = view.crossings.filter((crossing) => crossing.reached).length;
    const length = getPathDistanceInMeters();
    dom.pathStatus.textContent = `路径 ${state.path.length} 锚点 · ${length} m · 触及 ${touches}/6`;
  }

  class GardenAudio {
    constructor(volume) {
      this.context = null;
      this.master = null;
      this.bus = null;
      this.reverb = null;
      this.noiseBuffer = null;
      this.sources = [];
      this.ambientBed = null;
      this.volume = volume;
      this.scheduleCount = 0;
    }

    async ensureRunning() {
      if (!this.context) this.createGraph();
      if (this.context.state === "suspended") await this.context.resume();
      return this.context;
    }

    createGraph() {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("此浏览器不支持 Web Audio");
      this.context = new AudioContextClass({ latencyHint: "interactive" });

      const limiter = this.context.createDynamicsCompressor();
      limiter.threshold.value = -12;
      limiter.knee.value = 18;
      limiter.ratio.value = 5;
      limiter.attack.value = 0.006;
      limiter.release.value = 0.25;

      this.master = this.context.createGain();
      this.master.gain.value = this.volume;
      this.bus = this.context.createGain();
      this.bus.gain.value = 0.86;
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.55;
      this.master.connect(this.analyser);

      this.reverb = this.context.createConvolver();
      this.reverb.buffer = this.createImpulse(3.4, 2.8);
      const wet = this.context.createGain();
      wet.gain.value = 0.19;

      this.bus.connect(this.master);
      this.bus.connect(this.reverb);
      this.reverb.connect(wet);
      wet.connect(this.master);
      this.master.connect(limiter);
      limiter.connect(this.context.destination);
      this.noiseBuffer = this.createNoiseBuffer(2.5);
    }

    createNoiseBuffer(duration) {
      const length = Math.floor(this.context.sampleRate * duration);
      const buffer = this.context.createBuffer(2, length, this.context.sampleRate);
      for (let channel = 0; channel < 2; channel += 1) {
        const data = buffer.getChannelData(channel);
        let last = 0;
        for (let i = 0; i < length; i += 1) {
          const white = Math.random() * 2 - 1;
          last = last * 0.82 + white * 0.18;
          data[i] = last * 1.7;
        }
      }
      return buffer;
    }

    createImpulse(duration, decay) {
      const length = Math.floor(this.context.sampleRate * duration);
      const buffer = this.context.createBuffer(2, length, this.context.sampleRate);
      for (let channel = 0; channel < 2; channel += 1) {
        const data = buffer.getChannelData(channel);
        for (let i = 0; i < length; i += 1) {
          const envelope = Math.pow(1 - i / length, decay);
          data[i] = (Math.random() * 2 - 1) * envelope * 0.58;
        }
      }
      return buffer;
    }

    track(source) {
      this.sources.push(source);
      source.addEventListener("ended", () => {
        this.sources = this.sources.filter((item) => item !== source);
      }, { once: true });
    }

    makePanner(node) {
      const panner = this.context.createStereoPanner();
      panner.pan.value = clamp((node.x - 0.5) * 1.15, -0.82, 0.82);
      panner.connect(this.bus);
      panner.connect(this.reverb);
      return panner;
    }

    makeEnvelope(start, peak, attack, decay) {
      const gain = this.context.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(peak, start + Math.max(0.004, attack));
      gain.gain.exponentialRampToValueAtTime(0.0001, start + Math.max(0.03, attack + decay));
      return gain;
    }

    addOscillator(type, frequency, start, duration, destination, detune = 0) {
      const oscillator = this.context.createOscillator();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, start);
      oscillator.detune.setValueAtTime(detune, start);
      oscillator.connect(destination);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.08);
      this.track(oscillator);
      return oscillator;
    }

    addNoise(start, duration, destination) {
      const source = this.context.createBufferSource();
      source.buffer = this.noiseBuffer;
      source.loop = true;
      source.loopStart = Math.random() * 1.5;
      source.connect(destination);
      source.start(start);
      source.stop(start + duration + 0.08);
      this.track(source);
      return source;
    }

    scheduleNode(node, when) {
      if (!this.context || !this.bus) return;
      const start = Math.max(when, this.context.currentTime + 0.012);
      const panner = this.makePanner(node);
      const frequency = clamp(node.pitch, 80, 1000);
      const decay = node.decay;
      this.scheduleCount += 1;

      if (node.timbre === "moss") {
        const mix = this.context.createGain();
        const filter = this.context.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(Math.min(1400, frequency * 4.2), start);
        filter.Q.value = 0.7;
        const env = this.makeEnvelope(start, 0.14, 0.3, decay);
        mix.connect(filter);
        filter.connect(env);
        env.connect(panner);
        this.addOscillator("sine", frequency, start, decay + 0.4, mix);
        this.addOscillator("triangle", frequency * 0.5 + 0.5, start, decay + 0.4, mix, 3);
        this.addOscillator("sine", frequency * 2.008, start + 0.08, decay * 0.65, mix, -5);
        return;
      }

      if (node.timbre === "chime") {
        const env = this.makeEnvelope(start, 0.075, 0.007, decay);
        env.connect(panner);
        const carrier = this.addOscillator("sine", frequency, start, decay, env);
        const modulator = this.context.createOscillator();
        const modGain = this.context.createGain();
        modulator.type = "sine";
        modulator.frequency.setValueAtTime(frequency * 2.703, start);
        modGain.gain.setValueAtTime(frequency * 1.24, start);
        modGain.gain.exponentialRampToValueAtTime(frequency * 0.04, start + decay * 0.72);
        modulator.connect(modGain);
        modGain.connect(carrier.frequency);
        modulator.start(start);
        modulator.stop(start + decay + 0.1);
        this.track(modulator);
        this.addOscillator("sine", frequency * 2.01, start, decay * 0.7, env, 5);
        return;
      }

      if (node.timbre === "water") {
        const filter = this.context.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.setValueAtTime(Math.min(5200, frequency * 3.2), start);
        filter.frequency.exponentialRampToValueAtTime(Math.max(120, frequency * 1.3), start + 0.8);
        filter.Q.value = 2.1;
        const noiseEnv = this.makeEnvelope(start, 0.09, 0.008, Math.min(1.8, decay));
        filter.connect(noiseEnv);
        noiseEnv.connect(panner);
        this.addNoise(start, Math.min(1.8, decay), filter);
        const pingEnv = this.makeEnvelope(start + 0.025, 0.045, 0.006, decay * 0.75);
        pingEnv.connect(panner);
        this.addOscillator("sine", frequency * 2.4, start + 0.025, decay * 0.75, pingEnv);
        return;
      }

      if (node.timbre === "firefly") {
        [0, 0.09, 0.19, 0.31].forEach((offset, index) => {
          const pipEnv = this.makeEnvelope(start + offset, 0.032 / (index * 0.3 + 1), 0.008, decay * (0.72 - index * 0.08));
          pipEnv.connect(panner);
          this.addOscillator("sine", frequency * (1 + index * 0.25), start + offset, decay * 0.8, pipEnv, index * 4 - 6);
        });
        return;
      }

      if (node.timbre === "stone") {
        const filter = this.context.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(520, start);
        filter.frequency.exponentialRampToValueAtTime(95, start + 0.45);
        const noiseEnv = this.makeEnvelope(start, 0.15, 0.004, 0.38);
        filter.connect(noiseEnv);
        noiseEnv.connect(panner);
        this.addNoise(start, 0.45, filter);
        const thump = this.makeEnvelope(start, 0.055, 0.006, decay * 0.55);
        thump.connect(panner);
        const oscillator = this.addOscillator("sine", frequency * 0.5, start, decay * 0.6, thump);
        oscillator.frequency.exponentialRampToValueAtTime(Math.max(35, frequency * 0.24), start + 0.45);
        this.addOscillator("triangle", frequency, start, decay * 0.5, thump, 7);
        return;
      }

      const env = this.makeEnvelope(start, 0.075, 0.65, decay);
      const filter = this.context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(Math.min(1700, frequency * 3), start);
      filter.Q.value = 1.1;
      filter.connect(env);
      env.connect(panner);
      this.addOscillator("triangle", frequency, start, decay + 0.3, filter, -4);
      this.addOscillator("triangle", frequency * 1.006, start + 0.12, decay + 0.2, filter, 6);
      this.addOscillator("sine", frequency * 0.5, start, decay + 0.3, filter, 0);
    }

    scheduleAmbientChirp(frequency, when, duration, pan = 0) {
      if (!this.context || !this.bus) return;
      const start = Math.max(when, this.context.currentTime + 0.01);
      const panner = this.context.createStereoPanner();
      panner.pan.value = clamp(pan, -0.75, 0.75);
      panner.connect(this.bus);
      panner.connect(this.reverb);
      const env = this.makeEnvelope(start, 0.018, 0.03, duration);
      env.connect(panner);
      this.addOscillator("sine", frequency, start, duration, env);
      this.addOscillator("sine", frequency * 1.5, start + 0.018, duration * 0.7, env, 3);
    }

    startAmbient(progress) {
      if (!this.context || this.ambientBed) return;
      const bed = this.context.createGain();
      const filter = this.context.createBiquadFilter();
      filter.type = "lowpass";
      filter.Q.value = 0.55;
      filter.frequency.value = 360;
      bed.gain.value = 0.005;
      filter.connect(bed);
      bed.connect(this.bus);

      const noise = this.context.createBufferSource();
      noise.buffer = this.noiseBuffer;
      noise.loop = true;
      noise.connect(filter);
      noise.start();
      this.track(noise);

      const droneGain = this.context.createGain();
      droneGain.gain.value = 0.018;
      const droneFilter = this.context.createBiquadFilter();
      droneFilter.type = "lowpass";
      droneFilter.frequency.value = 240;
      droneGain.connect(droneFilter);
      droneFilter.connect(bed);

      const droneA = this.context.createOscillator();
      const droneB = this.context.createOscillator();
      droneA.type = "sine";
      droneB.type = "triangle";
      droneA.frequency.value = 55;
      droneB.frequency.value = 82.5;
      droneB.detune.value = -4;
      droneA.connect(droneGain);
      droneB.connect(droneGain);
      droneA.start();
      droneB.start();
      this.track(droneA);
      this.track(droneB);

      this.ambientBed = { bed, filter, droneGain };
      this.setDensity(progress);
    }

    setDensity(progress) {
      if (!this.context || !this.ambientBed) return;
      const now = this.context.currentTime;
      const amount = clamp(progress, 0, 1);
      const level = 0.004 + Math.pow(amount, 1.7) * 0.026;
      this.ambientBed.bed.gain.setTargetAtTime(level, now, 0.8);
      this.ambientBed.filter.frequency.setTargetAtTime(300 + amount * 1500, now, 0.9);
      this.ambientBed.droneGain.gain.setTargetAtTime(0.015 + amount * 0.014, now, 1.1);
    }

    setVolume(value) {
      this.volume = value;
      if (this.master && this.context) {
        this.master.gain.setTargetAtTime(value, this.context.currentTime, 0.05);
      }
    }

    stopAll() {
      if (!this.context) return;
      const now = this.context.currentTime;
      this.sources.forEach((source) => {
        try { source.stop(now); } catch (error) { console.debug("Audio source already stopped"); }
      });
      this.sources = [];
      if (this.ambientBed) {
        this.ambientBed.bed.gain.setTargetAtTime(0.0001, now, 0.03);
        this.ambientBed = null;
      }
    }

    getStats() {
      if (!this.context) return { state: "closed", scheduled: this.scheduleCount, sources: 0 };
      return {
        state: this.context.state,
        sampleRate: this.context.sampleRate,
        currentTime: this.context.currentTime,
        baseLatency: this.context.baseLatency || 0,
        outputLatency: this.context.outputLatency || 0,
        scheduled: this.scheduleCount,
        sources: this.sources.length
      };
    }

    getLevel() {
      if (!this.analyser) return { rms: 0, peak: 0 };
      const data = new Float32Array(this.analyser.fftSize);
      this.analyser.getFloatTimeDomainData(data);
      let sum = 0;
      let peak = 0;
      for (let i = 0; i < data.length; i += 1) {
        sum += data[i] * data[i];
        peak = Math.max(peak, Math.abs(data[i]));
      }
      return { rms: Math.sqrt(sum / data.length), peak };
    }
  }

  const audio = new GardenAudio(state.volume);

  function buildAmbientEvents() {
    const events = [];
    const scale = [196, 220, 261.63, 293.66, 329.63, 392, 440, 523.25];
    for (let index = 0; index < 82; index += 1) {
      const time = 12 + index * 4.2;
      if (time >= DURATION - 3) break;
      const progress = time / DURATION;
      const chance = 0.1 + Math.pow(progress, 1.65) * 0.74;
      if (seededValue(index, 1) > chance) continue;
      const cluster = progress > 0.68 ? 2 : 1;
      for (let voice = 0; voice < cluster; voice += 1) {
        const pitchIndex = Math.floor(seededValue(index, 3 + voice) * scale.length);
        events.push({
          id: `ambient-${index}-${voice}`,
          time: time + voice * (0.16 + seededValue(index, 7) * 0.28),
          frequency: scale[pitchIndex] * (voice ? 2 : 1),
          duration: 0.55 + seededValue(index, 9 + voice) * 1.9,
          pan: (seededValue(index, 11 + voice) - 0.5) * 1.2
        });
      }
    }
    return events.sort((a, b) => a.time - b.time);
  }

  const ambientEvents = buildAmbientEvents();

  function resizeCanvas() {
    const rect = dom.canvasWrap.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    view.width = width;
    view.height = height;
    view.dpr = dpr;
    dom.canvas.width = Math.round(width * dpr);
    dom.canvas.height = Math.round(height * dpr);
    ctx2d = dom.canvas.getContext("2d");
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildStaticScenery();
    rebuildRouteGeometry();
  }

  function blobPath(context, cx, cy, rx, ry, seed = 0) {
    const count = 12;
    const points = [];
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2;
      const wobble = 0.82 + seededValue(i + seed * 13, 2) * 0.24;
      points.push({ x: cx + Math.cos(angle) * rx * wobble, y: cy + Math.sin(angle) * ry * wobble });
    }
    context.beginPath();
    const first = points[0];
    const last = points[points.length - 1];
    context.moveTo((last.x + first.x) / 2, (last.y + first.y) / 2);
    points.forEach((point, index) => {
      const next = points[(index + 1) % count];
      context.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2);
    });
    context.closePath();
  }

  function drawFern(context, originX, originY, angle, length, seed, color) {
    const segments = 5;
    context.save();
    context.translate(originX, originY);
    context.rotate(angle);
    context.strokeStyle = color;
    context.lineWidth = 1;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(0, 0);
    let tipX = 0;
    let tipY = 0;
    for (let i = 1; i <= segments; i += 1) {
      const amount = i / segments;
      tipX = length * amount;
      tipY = -Math.sin(amount * Math.PI * 0.86) * length * 0.18;
      context.lineTo(tipX, tipY);
    }
    context.stroke();

    for (let i = 1; i <= segments; i += 1) {
      const amount = i / segments;
      const x = length * amount;
      const y = -Math.sin(amount * Math.PI * 0.86) * length * 0.18;
      const leafLength = length * (0.33 - amount * 0.12) * (0.8 + seededValue(seed + i, 1) * 0.3);
      for (const direction of [-1, 1]) {
        const spread = 0.82 + seededValue(seed + i, direction + 4) * 0.36;
        context.beginPath();
        context.moveTo(x, y);
        context.quadraticCurveTo(
          x + leafLength * 0.55,
          y + direction * leafLength * spread * 0.48,
          x + leafLength * 0.84,
          y + direction * leafLength * spread
        );
        context.quadraticCurveTo(
          x + leafLength * 0.42,
          y + direction * leafLength * spread * 0.35,
          x,
          y
        );
        context.fillStyle = color;
        context.fill();
      }
    }
    context.restore();
  }

  function buildStaticScenery() {
    const width = view.width;
    const height = view.height;
    if (!width || !height) return;
    const dpr = view.dpr;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const context = canvas.getContext("2d");
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const min = Math.min(width, height);

    const base = context.createLinearGradient(0, 0, width, height);
    base.addColorStop(0, "#081713");
    base.addColorStop(0.54, "#07120f");
    base.addColorStop(1, "#0a100d");
    context.fillStyle = base;
    context.fillRect(0, 0, width, height);

    const moonGlow = context.createRadialGradient(width * 0.79, height * 0.17, 0, width * 0.79, height * 0.17, min * 0.29);
    moonGlow.addColorStop(0, "rgba(214, 206, 169, 0.1)");
    moonGlow.addColorStop(0.36, "rgba(138, 151, 116, 0.04)");
    moonGlow.addColorStop(1, "rgba(5, 12, 9, 0)");
    context.fillStyle = moonGlow;
    context.fillRect(0, 0, width, height);

    context.save();
    context.globalCompositeOperation = "screen";
    const moon = context.createRadialGradient(width * 0.79, height * 0.17, 0, width * 0.79, height * 0.17, min * 0.09);
    moon.addColorStop(0, "rgba(238, 229, 197, 0.44)");
    moon.addColorStop(0.72, "rgba(212, 205, 172, 0.2)");
    moon.addColorStop(1, "rgba(212, 205, 172, 0)");
    context.fillStyle = moon;
    context.beginPath();
    context.arc(width * 0.79, height * 0.17, min * 0.075, 0, Math.PI * 2);
    context.fill();
    context.restore();

    const mist = context.createLinearGradient(0, height * 0.2, 0, height * 0.8);
    mist.addColorStop(0, "rgba(117, 143, 118, 0.025)");
    mist.addColorStop(0.5, "rgba(117, 143, 118, 0.06)");
    mist.addColorStop(1, "rgba(117, 143, 118, 0)");
    context.fillStyle = mist;
    context.fillRect(0, height * 0.16, width, height * 0.6);

    const beds = [
      [0.08, 0.88, 0.19, 0.13, 1], [0.22, 0.77, 0.12, 0.08, 2],
      [0.27, 0.41, 0.12, 0.14, 3], [0.39, 0.84, 0.15, 0.075, 4],
      [0.52, 0.55, 0.17, 0.11, 5], [0.58, 0.84, 0.17, 0.09, 6],
      [0.66, 0.3, 0.12, 0.12, 7], [0.78, 0.72, 0.16, 0.12, 8],
      [0.89, 0.38, 0.12, 0.14, 9], [0.93, 0.84, 0.15, 0.11, 10]
    ];
    beds.forEach(([x, y, rx, ry, seed]) => {
      const cx = x * width;
      const cy = y * height;
      blobPath(context, cx, cy, rx * width, ry * height, seed);
      const bedGradient = context.createRadialGradient(cx - rx * width * 0.2, cy - ry * height * 0.3, 0, cx, cy, Math.max(rx * width, ry * height));
      bedGradient.addColorStop(0, "rgba(31, 54, 40, 0.62)");
      bedGradient.addColorStop(0.64, "rgba(20, 39, 29, 0.5)");
      bedGradient.addColorStop(1, "rgba(10, 24, 17, 0.18)");
      context.fillStyle = bedGradient;
      context.fill();
      context.strokeStyle = "rgba(142, 168, 137, 0.08)";
      context.lineWidth = 1;
      context.stroke();
    });

    for (let i = 0; i < 240; i += 1) {
      const x = seededValue(i, 4) * width;
      const y = height * 0.18 + seededValue(i, 5) * height * 0.76;
      const radius = 0.3 + seededValue(i, 6) * 1.7;
      context.fillStyle = `rgba(146, 166, 133, ${0.025 + seededValue(i, 7) * 0.08})`;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }

    const ferns = [
      [0.02, 0.29, -0.3, 0.14], [0.055, 0.37, 0.2, 0.1], [0.97, 0.72, 2.8, 0.16],
      [0.92, 0.88, -2.75, 0.12], [0.87, 0.12, 2.5, 0.1], [0.73, 0.1, 0.58, 0.075],
      [0.04, 0.77, 0.1, 0.08], [0.38, 0.08, 1.1, 0.08], [0.61, 0.93, -0.7, 0.07],
      [0.31, 0.93, -2.3, 0.06], [0.96, 0.47, 2.7, 0.07], [0.015, 0.58, -0.12, 0.065]
    ];
    ferns.forEach(([x, y, angle, len], index) => {
      drawFern(context, x * width, y * height, angle, len * min, index + 31, "rgba(98, 130, 101, 0.25)");
      drawFern(context, x * width, y * height, angle + 0.42, len * min * 0.73, index + 45, "rgba(74, 105, 80, 0.28)");
    });

    context.save();
    context.strokeStyle = "rgba(105, 131, 104, 0.1)";
    context.lineWidth = 0.8;
    for (let i = 0; i < 9; i += 1) {
      context.beginPath();
      const y = height * (0.16 + i * 0.09);
      context.moveTo(-20, y);
      context.bezierCurveTo(width * 0.22, y - 35, width * 0.55, y + 48, width + 20, y - 12);
      context.stroke();
    }
    context.restore();

    context.save();
    context.strokeStyle = "rgba(2, 7, 5, 0.6)";
    context.lineWidth = 5;
    context.lineCap = "round";
    [[0, 0, 0.22, 0.13], [1, 0, 0.76, 0.09], [1, 1, 0.82, 0.83]].forEach(([sx, sy, ex, ey], i) => {
      context.beginPath();
      context.moveTo(sx * width, sy * height);
      context.bezierCurveTo(
        (sx * 0.74 + ex * 0.26) * width,
        (sy * 0.35 + ey * 0.65) * height + 20 - i * 7,
        (sx * 0.3 + ex * 0.7) * width,
        (sy * 0.72 + ey * 0.28) * height,
        ex * width,
        ey * height
      );
      context.stroke();
    });
    context.restore();

    const vignette = context.createRadialGradient(width * 0.48, height * 0.46, min * 0.16, width * 0.5, height * 0.5, Math.max(width, height) * 0.7);
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(0.74, "rgba(0, 0, 0, 0.1)");
    vignette.addColorStop(1, "rgba(0, 0, 0, 0.48)");
    context.fillStyle = vignette;
    context.fillRect(0, 0, width, height);

    view.background = canvas;
  }

  function traceRoute(context) {
    if (!view.routeSamples.length) return false;
    context.beginPath();
    context.moveTo(view.routeSamples[0].px, view.routeSamples[0].py);
    for (let i = 1; i < view.routeSamples.length; i += 1) {
      context.lineTo(view.routeSamples[i].px, view.routeSamples[i].py);
    }
    return true;
  }

  function drawRoute(context, progress) {
    if (!traceRoute(context)) return;
    context.save();
    context.lineJoin = "round";
    context.lineCap = "round";

    context.strokeStyle = "rgba(1, 5, 3, 0.48)";
    context.lineWidth = 33;
    context.stroke();

    context.strokeStyle = "rgba(46, 64, 49, 0.29)";
    context.lineWidth = 28;
    context.stroke();

    context.strokeStyle = "rgba(151, 166, 136, 0.08)";
    context.lineWidth = 1;
    context.setLineDash([2, 8]);
    context.stroke();
    context.setLineDash([]);

    const pathEnd = getRouteCanvasPoints(0, progress).length;
    if (pathEnd > 1 && progress > 0.0001) {
      context.beginPath();
      context.moveTo(view.routeSamples[0].px, view.routeSamples[0].py);
      for (let i = 1; i < pathEnd; i += 1) {
        context.lineTo(view.routeSamples[i].px, view.routeSamples[i].py);
      }
      context.strokeStyle = "rgba(231, 183, 111, 0.22)";
      context.lineWidth = 1.1;
      context.stroke();
    }

    for (let i = 5; i < view.routeSamples.length - 4; i += 9) {
      const sample = view.routeSamples[i];
      const size = 0.5 + seededValue(i, 41) * 0.8;
      context.fillStyle = `rgba(162, 169, 140, ${0.035 + seededValue(i, 42) * 0.055})`;
      context.beginPath();
      context.ellipse(sample.px, sample.py, size * 1.8, size, sample.angle, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  function addPulse(nodeIndex, kind = "cross") {
    view.pulses.push({
      nodeIndex,
      kind,
      start: performance.now(),
      duration: kind === "audio" ? 2600 : 1900
    });
    if (view.pulses.length > 18) view.pulses.shift();
  }

  function drawNode(context, node, nodeIndex, now) {
    const x = node.x * view.width;
    const y = node.y * view.height;
    const radius = node.radius * Math.min(view.width, view.height);
    const crossing = view.crossings[nodeIndex];
    const selected = nodeIndex === state.selected;
    const reached = crossing?.reached;
    const color = node.color;
    const current = state.currentTime / DURATION;
    const timeToCross = crossing?.time != null ? Math.abs(crossing.time / DURATION - current) : 1;
    const nearing = state.isPlaying && timeToCross < 0.018;
    const alpha = reached ? 1 : 0.52;

    context.save();
    context.globalAlpha = alpha;

    const glow = context.createRadialGradient(x, y, 0, x, y, radius * 1.35);
    glow.addColorStop(0, `${color}1c`);
    glow.addColorStop(0.58, `${color}0a`);
    glow.addColorStop(1, `${color}00`);
    context.fillStyle = glow;
    context.beginPath();
    context.arc(x, y, radius * 1.35, 0, Math.PI * 2);
    context.fill();

    context.strokeStyle = selected ? `${color}9a` : `${color}46`;
    context.lineWidth = selected ? 1.05 : 0.7;
    context.setLineDash([2, 5]);
    context.lineDashOffset = -(now * 0.007 * (nodeIndex % 2 ? -1 : 1));
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.stroke();
    context.setLineDash([]);

    context.strokeStyle = `${color}${selected ? "5c" : "24"}`;
    context.lineWidth = 0.7;
    context.beginPath();
    context.arc(x, y, radius * 0.67, 0, Math.PI * 2);
    context.stroke();

    for (let tick = 0; tick < 4; tick += 1) {
      const angle = tick * Math.PI / 2 + now * 0.00007 * (nodeIndex + 1);
      context.beginPath();
      context.moveTo(x + Math.cos(angle) * (radius + 4), y + Math.sin(angle) * (radius + 4));
      context.lineTo(x + Math.cos(angle) * (radius + 9), y + Math.sin(angle) * (radius + 9));
      context.strokeStyle = `${color}4f`;
      context.stroke();
    }

    view.pulses.forEach((pulse) => {
      if (pulse.nodeIndex !== nodeIndex) return;
      const age = (now - pulse.start) / pulse.duration;
      if (age < 0 || age > 1) return;
      const waveRadius = radius * (0.78 + age * 0.85);
      context.beginPath();
      context.arc(x, y, waveRadius, 0, Math.PI * 2);
      context.strokeStyle = pulse.kind === "audio" ? `rgba(231, 183, 111, ${(1 - age) * 0.7})` : `${color}${Math.round((1 - age) * 120).toString(16).padStart(2, "0")}`;
      context.lineWidth = pulse.kind === "audio" ? 1.2 : 0.8;
      context.stroke();
    });

    if (nearing) {
      const pulse = 0.5 + Math.sin(now * 0.008) * 0.5;
      context.beginPath();
      context.arc(x, y, radius * (0.88 + pulse * 0.08), 0, Math.PI * 2);
      context.strokeStyle = `${color}9f`;
      context.lineWidth = 1.2;
      context.stroke();
    }

    context.shadowColor = color;
    context.shadowBlur = selected ? 14 : 7;
    context.fillStyle = `${color}${selected ? "ff" : "c9"}`;
    context.beginPath();
    context.arc(x, y, selected ? 3.1 : 2.3, 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 0;

    const labelRight = x < view.width * 0.8;
    const labelX = x + (labelRight ? radius + 11 : -radius - 11);
    const labelY = y - 12;
    context.textAlign = labelRight ? "left" : "right";
    context.fillStyle = selected ? "#f1eee2" : "#d0d8cb";
    context.font = "400 11px 'Noto Serif SC', 'Songti SC', Georgia, serif";
    context.fillText(`${String(nodeIndex + 1).padStart(2, "0")} ${node.name}`, labelX, labelY);
    context.fillStyle = selected ? `${color}c9` : "rgba(165, 181, 160, 0.48)";
    context.font = "8px 'Noto Sans SC', 'Avenir Next', 'PingFang SC', sans-serif";
    context.fillText(`${node.pitch.toFixed(1)} HZ${reached ? "" : " · 未触及"}`, labelX, labelY + 11);

    if (selected) {
      context.strokeStyle = `${color}8f`;
      context.lineWidth = 0.8;
      context.beginPath();
      context.arc(x, y, radius * 0.34, 0, Math.PI * 2);
      context.stroke();
    }
    context.restore();
  }

  function drawPlayhead(context, now) {
    const ratio = clamp(state.currentTime / DURATION, 0, 1);
    const pose = getRoutePose(ratio);
    const x = pose.x * view.width;
    const y = pose.y * view.height;
    const trail = getRouteCanvasPoints(Math.max(0, ratio - 0.035), ratio);

    context.save();
    if (trail.length > 1) {
      const gradient = context.createLinearGradient(trail[0].x, trail[0].y, x, y);
      gradient.addColorStop(0, "rgba(231, 183, 111, 0)");
      gradient.addColorStop(1, "rgba(245, 208, 151, 0.65)");
      context.strokeStyle = gradient;
      context.lineWidth = 1.8;
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(trail[0].x, trail[0].y);
      trail.slice(1).forEach((point) => context.lineTo(point.x, point.y));
      context.stroke();
    }

    const breath = (Math.sin(now * 0.0035) + 1) / 2;
    const glow = context.createRadialGradient(x, y, 0, x, y, 34 + breath * 7);
    glow.addColorStop(0, "rgba(255, 231, 182, 0.8)");
    glow.addColorStop(0.16, "rgba(240, 195, 119, 0.48)");
    glow.addColorStop(0.5, "rgba(231, 183, 111, 0.13)");
    glow.addColorStop(1, "rgba(231, 183, 111, 0)");
    context.fillStyle = glow;
    context.beginPath();
    context.arc(x, y, 41, 0, Math.PI * 2);
    context.fill();

    context.strokeStyle = "rgba(244, 211, 152, 0.55)";
    context.lineWidth = 0.8;
    context.beginPath();
    context.arc(x, y, 11 + breath * 2.5, 0, Math.PI * 2);
    context.stroke();

    context.strokeStyle = "rgba(244, 211, 152, 0.22)";
    context.setLineDash([2, 4]);
    context.beginPath();
    context.arc(x, y, 19 + breath * 3, -0.4, Math.PI * 1.45);
    context.stroke();
    context.setLineDash([]);

    context.fillStyle = "#fff0ce";
    context.shadowColor = "#e7b76f";
    context.shadowBlur = 17;
    context.beginPath();
    context.arc(x, y, 3.8, 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 0;

    context.translate(x, y);
    context.rotate(pose.angle);
    context.fillStyle = "rgba(247, 217, 164, 0.9)";
    context.beginPath();
    context.moveTo(22, 0);
    context.lineTo(15, -3.3);
    context.lineTo(15, 3.3);
    context.closePath();
    context.fill();
    context.restore();
  }

  function drawFireflies(context, now, progress) {
    const density = 0.28 + progress * 0.72;
    context.save();
    for (let i = 0; i < 34; i += 1) {
      const baseX = seededValue(i, 16);
      const baseY = 0.2 + seededValue(i, 17) * 0.73;
      const driftX = Math.sin(now * 0.00017 * (0.4 + seededValue(i, 18)) + i) * 10;
      const driftY = Math.cos(now * 0.00013 * (0.5 + seededValue(i, 19)) + i * 1.7) * 7;
      const flicker = 0.22 + (Math.sin(now * 0.0024 + i * 2.1) + 1) * 0.24;
      const x = baseX * view.width + driftX;
      const y = baseY * view.height + driftY;
      const size = 0.45 + seededValue(i, 20) * 1.1;
      context.globalAlpha = flicker * density;
      context.fillStyle = i % 4 === 0 ? "#d9c390" : "#b7cdab";
      context.shadowColor = context.fillStyle;
      context.shadowBlur = 5;
      context.beginPath();
      context.arc(x, y, size, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  function drawFrame(now) {
    if (!ctx2d || !view.width || !view.height) return;
    ctx2d.clearRect(0, 0, view.width, view.height);
    if (view.background) ctx2d.drawImage(view.background, 0, 0, view.width, view.height);

    const progress = clamp(state.currentTime / DURATION, 0, 1);
    drawRoute(ctx2d, progress);
    state.nodes.forEach((node, index) => drawNode(ctx2d, node, index, now));
    drawFireflies(ctx2d, now, progress);
    drawPlayhead(ctx2d, now);

    if (state.mode === "draw") {
      ctx2d.save();
      ctx2d.strokeStyle = "rgba(231, 183, 111, 0.24)";
      ctx2d.setLineDash([3, 5]);
      ctx2d.lineWidth = 1;
      ctx2d.strokeRect(8.5, 8.5, view.width - 17, view.height - 17);
      ctx2d.setLineDash([]);
      ctx2d.restore();
    }
  }

  function buildNodeSwitcher() {
    dom.nodeSwitcher.innerHTML = "";
    state.nodes.forEach((node, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "node-chip";
      button.dataset.index = String(index);
      button.role = "tab";
      button.style.setProperty("--node-color", node.color);
      button.innerHTML = `
        <span class="chip-top">
          <span class="chip-index">${String(index + 1).padStart(2, "0")}</span>
          <span class="chip-dot"></span>
          <span class="chip-name">${node.name}</span>
        </span>
        <span class="chip-freq">${node.pitch.toFixed(1)} HZ</span>
      `;
      button.addEventListener("click", () => selectNode(index));
      dom.nodeSwitcher.appendChild(button);
    });
  }

  function renderWavePreview(node) {
    const width = 236;
    const center = 23;
    const points = [];
    for (let i = 0; i <= 92; i += 1) {
      const x = (i / 92) * width;
      const p = i / 92;
      const envelope = node.timbre === "moon"
        ? Math.pow(Math.sin(p * Math.PI), 1.2)
        : Math.pow(1 - p, node.timbre === "stone" ? 3.5 : 1.6);
      const harmonic = node.timbre === "chime" ? Math.sin(p * Math.PI * 13 + node.pitch * 0.012) * 0.55 : 0;
      const wave = Math.sin(p * Math.PI * (8 + node.pitch / 72)) + harmonic;
      points.push({ x, y: center - wave * envelope * 12 });
    }
    const top = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
    const bottom = points.slice().reverse().map((point, index) => {
      const source = points[points.length - 1 - index];
      return `${source.x.toFixed(1)},${(center + (center - source.y)).toFixed(1)}`;
    }).join(" ");
    dom.wavePreview.innerHTML = `
      <path class="wave-fill" d="M0,${center} L${top.replaceAll(" ", " L")} L${bottom.replaceAll(" ", " L")} Z"/>
      <path d="M${top.replaceAll(" ", " L")}"/>
    `;
  }

  function updateRangeFill(input, min, max) {
    const fill = ((Number(input.value) - min) / (max - min)) * 100;
    input.style.setProperty("--fill", `${fill}%`);
  }

  function renderInspector() {
    const node = state.nodes[state.selected];
    if (!node) return;
    const crossing = view.crossings[state.selected];
    dom.nodeGlyph.textContent = node.glyph;
    dom.nodeGlyph.style.setProperty("--node-color", node.color);
    dom.nodeName.textContent = node.name;
    dom.nodeType.textContent = node.type;
    dom.selectionNumber.textContent = String(state.selected + 1).padStart(2, "0");
    dom.reachBadge.textContent = crossing?.reached ? "路径已触及" : "路径未触及";
    dom.reachBadge.classList.toggle("is-missed", !crossing?.reached);
    dom.pitchValue.textContent = node.pitch.toFixed(1);
    dom.noteName.textContent = noteFromFrequency(node.pitch);
    dom.pitchRange.value = String(node.pitch);
    dom.delayRange.value = String(node.delay);
    dom.decayRange.value = String(node.decay);
    dom.pitchOutput.textContent = `${Math.round(node.pitch)} Hz`;
    dom.delayOutput.textContent = `${Math.round(node.delay)} ms`;
    dom.decayOutput.textContent = `${node.decay.toFixed(1)} s`;
    updateRangeFill(dom.pitchRange, 110, 920);
    updateRangeFill(dom.delayRange, 0, 2400);
    updateRangeFill(dom.decayRange, 0.4, 8);
    document.documentElement.style.setProperty("--selected-node-color", node.color);
    $$(".node-chip").forEach((chip, index) => {
      chip.classList.toggle("is-active", index === state.selected);
      chip.setAttribute("aria-selected", String(index === state.selected));
      const liveNode = state.nodes[index];
      const freq = chip.querySelector(".chip-freq");
      if (freq) freq.textContent = `${liveNode.pitch.toFixed(1)} HZ`;
    });
    const editor = $(".node-editor");
    editor.style.setProperty("--node-color", node.color);
    renderWavePreview(node);
  }

  function selectNode(index) {
    state.selected = clamp(index, 0, state.nodes.length - 1);
    renderInspector();
  }

  function renderTimelineEvents() {
    dom.timelineEvents.innerHTML = "";
    view.timelineNodes = [];
    state.nodes.forEach((node, index) => {
      const crossing = view.crossings[index];
      const marker = document.createElement("span");
      marker.className = "timeline-event";
      marker.style.setProperty("--event-color", node.color);
      marker.title = crossing?.reached
        ? `${node.name} · ${formatTime(crossing.time)} 进入感应圈，${node.delay} ms 后发声`
        : `${node.name} · 路径尚未触及`;
      marker.classList.toggle("is-unreachable", !crossing?.reached);
      if (crossing?.reached) marker.style.left = `${(crossing.time / DURATION) * 100}%`;
      else marker.style.left = `${((index + 0.5) / 7) * 100}%`;
      dom.timelineEvents.appendChild(marker);
      view.timelineNodes.push(marker);
    });
  }

  function updateRangeEndsVisuals() {
    dom.canvasHint.textContent = state.mode === "draw"
      ? "按住拖动，重新画出听者路径"
      : state.isPlaying ? "光点沿路径行进，声音实时合成" : "拖动节点可微调位置";
  }

  function updateTransportUi(now, force = false) {
    if (!force && now - view.lastUiUpdate < 90) return;
    view.lastUiUpdate = now;
    const progress = clamp(state.currentTime / DURATION, 0, 1);
    dom.currentTime.textContent = formatTime(state.currentTime);
    dom.playhead.style.left = `${progress * 100}%`;
    dom.timeline.setAttribute("aria-valuenow", Math.round(state.currentTime));
    dom.playhead.setAttribute("aria-valuetext", formatTime(state.currentTime));
    dom.timeline.style.setProperty("--played", `${progress * 100}%`);

    const nearEvent = view.crossings
      .filter((crossing) => crossing.reached && crossing.time > state.currentTime)
      .sort((a, b) => a.time - b.time)[0];

    if (state.isPlaying) {
      dom.playBtn.classList.add("is-playing");
      dom.playBtn.setAttribute("aria-label", "暂停游园");
      dom.transportState.textContent = "游园进行中";
      dom.transportDetail.textContent = nearEvent
        ? `下一感应 ${state.nodes[nearEvent.nodeIndex].name} · ${formatTime(nearEvent.time)}`
        : "最后一段 · 环境声正在加密";
      dom.audioStatus.classList.add("is-live");
      dom.audioStatusText.textContent = `实时合成 · ${progress < 0.3 ? "疏" : progress < 0.7 ? "渐密" : "盛"}`;
      if (state.statusMessage && now < state.statusUntil) {
        dom.audioStatusText.textContent = state.statusMessage;
      }
    } else {
      dom.playBtn.classList.remove("is-playing");
      dom.playBtn.setAttribute("aria-label", state.currentTime >= DURATION ? "从头重播" : "播放游园");
      dom.audioStatus.classList.remove("is-live");
      if (state.currentTime >= DURATION) {
        dom.transportState.textContent = "游园结束";
        dom.transportDetail.textContent = "六分钟声景已完整生成，可归零重听";
        dom.audioStatusText.textContent = "声场已收束";
      } else if (state.currentTime > 0) {
        dom.transportState.textContent = "游园暂停";
        dom.transportDetail.textContent = `停留于 ${formatTime(state.currentTime)}，可继续行进`;
        dom.audioStatusText.textContent = "静默 · 位置已保留";
      } else {
        dom.transportState.textContent = "准备入场";
        dom.transportDetail.textContent = "按下播放，合成声场将在浏览器内生成";
        dom.audioStatusText.textContent = "静默 · 等待入场";
      }
    }
    updateRangeEndsVisuals();

    view.timelineNodes?.forEach((marker, index) => {
      const crossing = view.crossings[index];
      marker.classList.toggle("is-passed", !!(crossing?.reached && state.currentTime > crossing.time));
      marker.classList.toggle("is-now", !!(crossing?.reached && Math.abs(state.currentTime - crossing.time) < 4));
    });
  }

  function getPlaybackTime() {
    if (!state.isPlaying || !audio.context) return state.currentTime;
    const elapsed = Math.max(0, audio.context.currentTime - view.playbackAnchor);
    return clamp(view.playbackOffset + elapsed, 0, DURATION);
  }

  function markSeekState(time) {
    view.seekVersion += 1;
    view.scheduledEvents.clear();
    view.scheduledAmbient.clear();
    view.visualEvents.clear();
    view.reachedEvents.clear();
    view.pulses = [];
    view.crossings.forEach((crossing, index) => {
      if (!crossing.reached) return;
      if (crossing.time <= time) {
        view.visualEvents.add(`${view.seekVersion}:${index}:visual`);
      }
      if (crossing.time + state.nodes[index].delay / 1000 <= time) {
        view.reachedEvents.add(`${view.seekVersion}:${index}:audio`);
      }
    });
  }

  async function startPlayback() {
    try {
      if (state.currentTime >= DURATION - 0.01) {
        state.currentTime = 0;
        markSeekState(0);
      }
      await audio.ensureRunning();
      view.audioReady = true;
      view.playbackAnchor = audio.context.currentTime;
      view.playbackOffset = state.currentTime;
      state.isPlaying = true;
      view.scheduledEvents.clear();
      view.scheduledAmbient.clear();
      audio.startAmbient(state.currentTime / DURATION);
      updateTransportUi(performance.now(), true);
    } catch (error) {
      view.audioError = error.message;
      state.isPlaying = false;
      showToast(`无法启动合成声场：${error.message}`, true);
      updateTransportUi(performance.now(), true);
    }
  }

  function pausePlayback(silent = false) {
    if (!state.isPlaying) {
      audio.stopAll();
      updateTransportUi(performance.now(), true);
      return;
    }
    state.currentTime = getPlaybackTime();
    state.isPlaying = false;
    audio.stopAll();
    if (!silent) showToast(`游园暂停于 ${formatTime(state.currentTime)}`);
    updateTransportUi(performance.now(), true);
  }

  function seekTo(time, announce = false) {
    const nextTime = clamp(time, 0, DURATION);
    const wasPlaying = state.isPlaying;
    audio.stopAll();
    state.currentTime = nextTime;
    state.isPlaying = false;
    view.playbackOffset = nextTime;
    markSeekState(nextTime);
    if (wasPlaying && audio.context) {
      view.playbackAnchor = audio.context.currentTime;
      state.isPlaying = true;
      audio.startAmbient(nextTime / DURATION);
    }
    updateTransportUi(performance.now(), true);
    if (announce) showToast(`已定位至 ${formatTime(nextTime)}`);
  }

  function detectCrossings() {
    if (!state.isPlaying) return;
    view.crossings.forEach((crossing, index) => {
      if (!crossing.reached) return;
      const node = state.nodes[index];
      const visualKey = `${view.seekVersion}:${index}:visual`;
      const audioKey = `${view.seekVersion}:${index}:audio`;
      if (state.currentTime >= crossing.time && !view.visualEvents.has(visualKey)) {
        view.visualEvents.add(visualKey);
        addPulse(index, "cross");
        state.statusMessage = `${node.name} 感应 · ${node.delay} ms 后发声`;
        state.statusUntil = performance.now() + 2300;
      }
      const soundTime = crossing.time + node.delay / 1000;
      if (state.currentTime >= soundTime && !view.reachedEvents.has(audioKey)) {
        view.reachedEvents.add(audioKey);
        addPulse(index, "audio");
        state.statusMessage = `${node.name} 发声 · 已延迟 ${node.delay} ms`;
        state.statusUntil = performance.now() + 2600;
      }
    });
  }

  function scheduleUpcomingAudio() {
    if (!state.isPlaying || !audio.context) return;
    const current = state.currentTime;
    state.nodes.forEach((node, index) => {
      const crossing = view.crossings[index];
      if (!crossing.reached) return;
      const key = `${view.seekVersion}:${index}:node`;
      if (view.scheduledEvents.has(key)) return;
      const audioTime = crossing.time + node.delay / 1000;
      if (audioTime < current - 0.02) {
        view.scheduledEvents.add(key);
        return;
      }
      const lead = audioTime - current;
      if (lead <= 2.55 && lead >= 0) {
        const when = audio.context.currentTime + Math.max(0.018, lead);
        audio.scheduleNode(node, when);
        view.scheduledEvents.add(key);
      }
    });

    ambientEvents.forEach((event, index) => {
      const key = `${view.seekVersion}:${index}:ambient`;
      if (view.scheduledAmbient.has(key)) return;
      const lead = event.time - current;
      if (lead < -0.02) {
        view.scheduledAmbient.add(key);
        return;
      }
      if (lead <= 3.1 && lead >= 0) {
        audio.scheduleAmbientChirp(
          event.frequency,
          audio.context.currentTime + Math.max(0.012, lead),
          event.duration,
          event.pan
        );
        view.scheduledAmbient.add(key);
      }
    });
    audio.setDensity(current / DURATION);
  }

  function advancePlayback(now) {
    if (!state.isPlaying) {
      detectCrossings();
      return;
    }
    state.currentTime = getPlaybackTime();
    detectCrossings();
    scheduleUpcomingAudio();
    if (state.currentTime >= DURATION) {
      state.currentTime = DURATION;
      state.isPlaying = false;
      audio.stopAll();
      updateTransportUi(now, true);
      showToast("六分钟游园已完整走完 · 声场收束");
    }
  }

  function setMode(mode) {
    if (state.mode === mode) return;
    if (mode === "draw" && state.isPlaying) pausePlayback(true);
    state.mode = mode;
    dom.modeButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.mode === mode));
    dom.canvas.style.cursor = mode === "draw" ? "crosshair" : "default";
    updateRangeEndsVisuals();
    if (mode === "draw") showToast("按住并拖动，重新绘制听者路径");
  }

  function canvasPoint(event) {
    const rect = dom.canvas.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0.015, 0.985),
      y: clamp((event.clientY - rect.top) / rect.height, 0.02, 0.98)
    };
  }

  function hitNode(point) {
    let best = { index: -1, distance: Infinity, radius: 0 };
    state.nodes.forEach((node, index) => {
      const dist = Math.hypot(point.x - node.x, point.y - node.y);
      const radius = node.radius * Math.min(view.width, view.height) / Math.min(view.width, view.height);
      if (dist < best.distance && dist <= Math.max(node.radius + 0.02, 0.075)) {
        best = { index, distance: dist, radius };
      }
    });
    return best.index;
  }

  function onCanvasPointerDown(event) {
    if (event.button !== 0) return;
    const point = canvasPoint(event);
    if (state.mode === "draw") {
      if (state.isPlaying) pausePlayback(true);
      view.pathBackup = state.path.map((point) => ({ ...point }));
      state.path = [point];
      view.drawing = true;
      view.drawPointerId = event.pointerId;
      dom.canvas.setPointerCapture?.(event.pointerId);
      rebuildRouteGeometry();
      return;
    }
    const hit = hitNode(point);
    if (hit >= 0) {
      selectNode(hit);
      const node = state.nodes[hit];
      const hitDistance = Math.hypot(point.x - node.x, point.y - node.y);
      if (hitDistance <= Math.max(node.radius * 0.48, 0.035)) {
        if (state.isPlaying) pausePlayback(true);
        view.draggingNode = hit;
        dom.canvas.setPointerCapture?.(event.pointerId);
      }
    }
  }

  function onCanvasPointerMove(event) {
    const point = canvasPoint(event);
    if (state.mode === "draw" && view.drawing && event.pointerId === view.drawPointerId) {
      const last = state.path[state.path.length - 1];
      if (last && Math.hypot((point.x - last.x) * view.width, (point.y - last.y) * view.height) >= 4) {
        state.path.push(point);
        rebuildRouteGeometry();
      }
      return;
    }
    if (view.draggingNode >= 0) {
      const node = state.nodes[view.draggingNode];
      node.x = clamp(point.x, 0.055, 0.945);
      node.y = clamp(point.y, 0.065, 0.935);
      rebuildRouteGeometry();
      renderInspector();
      return;
    }
    const hovered = hitNode(point);
    view.hoveredNode = hovered;
    dom.canvas.style.cursor = state.mode === "draw" ? "crosshair" : hovered >= 0 ? "grab" : "default";
  }

  function onCanvasPointerUp(event) {
    if (view.drawing && event.pointerId === view.drawPointerId) {
      view.drawing = false;
      view.drawPointerId = null;
      dom.canvas.releasePointerCapture?.(event.pointerId);
      if (state.path.length >= 2) {
        rebuildRouteGeometry();
        const touches = view.crossings.filter((crossing) => crossing.reached).length;
        showToast(`路径已重绘 · 触及 ${touches} / 6 个感应节点`);
      } else {
        state.path = view.pathBackup || state.path;
        rebuildRouteGeometry();
        showToast("路径太短，请在花园中拖出一段完整轨迹", true);
      }
    }
    if (view.draggingNode >= 0) {
      view.draggingNode = -1;
      dom.canvas.releasePointerCapture?.(event.pointerId);
    }
  }

  function validateCoordinate(value, fallback) {
    return Number.isFinite(Number(value)) ? clamp(Number(value), 0.01, 0.99) : fallback;
  }

  function textValue(value, fallback, length = 24) {
    if (typeof value !== "string") return fallback;
    return value.replace(/[<>&"'`]/g, "").trim().slice(0, length) || fallback;
  }

  function exportPayload() {
    return {
      version: SAVE_VERSION,
      title: state.title,
      duration: DURATION,
      path: state.path.map((point) => ({
        x: Number(point.x.toFixed(5)),
        y: Number(point.y.toFixed(5))
      })),
      nodes: state.nodes.map((node) => ({
        id: node.id,
        name: node.name,
        type: node.type,
        glyph: node.glyph,
        timbre: node.timbre,
        color: node.color,
        x: Number(node.x.toFixed(5)),
        y: Number(node.y.toFixed(5)),
        radius: Number(node.radius.toFixed(4)),
        pitch: Math.round(node.pitch * 100) / 100,
        delay: Math.round(node.delay),
        decay: Math.round(node.decay * 10) / 10
      })),
      density: { start: 0.1, end: 0.84 }
    };
  }

  function saveJson() {
    const payload = exportPayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    link.href = url;
    link.download = `nocturne-garden-${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 800);
    showToast("作品 JSON 已保存 · 路径、节点与合成参数均已写入");
  }

  function parseImportedState(data) {
    if (!data || typeof data !== "object") throw new Error("文件中没有有效的作品对象");
    if (!Array.isArray(data.path) || data.path.length < 2) throw new Error("路径至少需要两个锚点");
    if (data.path.length > 500) throw new Error("路径锚点过多，请精简后再导入");
    if (!Array.isArray(data.nodes) || data.nodes.length < 1) throw new Error("作品缺少感应节点");

    const path = data.path
      .filter((point) => point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)))
      .map((point) => ({ x: clamp(Number(point.x), 0.01, 0.99), y: clamp(Number(point.y), 0.01, 0.99) }));
    if (path.length < 2) throw new Error("路径坐标无效");

    const nodes = NODE_DEFS.map((fallback, index) => {
      const source = data.nodes.find((item) => item && item.id === fallback.id) || data.nodes[index] || {};
      const color = /^#[0-9a-f]{6}$/i.test(source.color || "") ? source.color : NODE_COLORS[index];
      return {
        ...fallback,
        color,
        name: textValue(source.name, fallback.name),
        type: textValue(source.type, fallback.type, 36),
        glyph: textValue(source.glyph, fallback.glyph, 3),
        x: validateCoordinate(source.x, fallback.x),
        y: validateCoordinate(source.y, fallback.y),
        radius: clamp(Number(source.radius) || fallback.radius, 0.025, 0.12),
        pitch: clamp(Number(source.pitch) || fallback.pitch, 110, 920),
        delay: clamp(Number(source.delay) || 0, 0, 2400),
        decay: clamp(Number(source.decay) || fallback.decay, 0.4, 8)
      };
    });

    return {
      title: textValue(data.title, "夜园声景", 40),
      path,
      nodes,
      selected: clamp(Number(data.selected) || 0, 0, 5),
      volume: Number.isFinite(Number(data.volume)) ? clamp(Number(data.volume), 0, 1) : state.volume
    };
  }

  function loadImportedData(data) {
    const imported = parseImportedState(data);
    pausePlayback(true);
    state.title = imported.title;
    state.path = imported.path;
    state.nodes = imported.nodes;
    state.selected = imported.selected;
    state.volume = imported.volume;
    state.currentTime = 0;
    state.isPlaying = false;
    state.mode = "edit";
    dom.volumeRange.value = String(state.volume);
    audio.setVolume(state.volume);
    markSeekState(0);
    rebuildRouteGeometry();
    buildNodeSwitcher();
    renderInspector();
    updateTransportUi(performance.now(), true);
    dom.modeButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.mode === "edit"));
    showToast(`已导入「${state.title}」· ${state.path.length} 个路径锚点`);
  }

  async function importFromFile(file) {
    if (!file) return;
    try {
      const content = await file.text();
      const data = JSON.parse(content);
      loadImportedData(data);
    } catch (error) {
      showToast(`导入失败：${error.message}`, true);
    } finally {
      dom.importJson.value = "";
    }
  }

  function bindEvents() {
    dom.modeButtons.forEach((button) => {
      button.addEventListener("click", () => setMode(button.dataset.mode));
    });
    dom.canvas.addEventListener("pointerdown", onCanvasPointerDown);
    dom.canvas.addEventListener("pointermove", onCanvasPointerMove);
    dom.canvas.addEventListener("pointerup", onCanvasPointerUp);
    dom.canvas.addEventListener("pointercancel", onCanvasPointerUp);

    dom.playBtn.addEventListener("click", () => {
      if (state.isPlaying) pausePlayback();
      else startPlayback();
    });

    dom.resetBtn.addEventListener("click", () => {
      const wasPlaying = state.isPlaying;
      pausePlayback(true);
      seekTo(0);
      showToast(wasPlaying ? "已暂停并回到游园起点" : "已回到游园起点");
    });

    const scrub = (event) => {
      const rect = dom.timeline.getBoundingClientRect();
      const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      seekTo(ratio * DURATION);
    };
    dom.timeline.addEventListener("pointerdown", (event) => {
      view.scrubPointerId = event.pointerId;
      dom.timeline.setPointerCapture?.(event.pointerId);
      scrub(event);
    });
    dom.timeline.addEventListener("pointermove", (event) => {
      if (view.scrubPointerId === event.pointerId) scrub(event);
    });
    dom.timeline.addEventListener("pointerup", (event) => {
      if (view.scrubPointerId === event.pointerId) {
        view.scrubPointerId = null;
        dom.timeline.releasePointerCapture?.(event.pointerId);
      }
    });
    dom.timeline.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        seekTo(state.currentTime - 5);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        seekTo(state.currentTime + 5);
      }
    });

    const updateSelected = (property, value) => {
      state.nodes[state.selected][property] = value;
      renderInspector();
    };
    dom.pitchRange.addEventListener("input", () => {
      updateSelected("pitch", Number(dom.pitchRange.value));
    });
    dom.delayRange.addEventListener("input", () => {
      updateSelected("delay", Number(dom.delayRange.value));
    });
    dom.decayRange.addEventListener("input", () => {
      updateSelected("decay", Number(dom.decayRange.value));
    });

    dom.volumeRange.addEventListener("input", () => {
      state.volume = Number(dom.volumeRange.value);
      audio.setVolume(state.volume);
    });
    dom.exportBtn.addEventListener("click", saveJson);
    dom.importJson.addEventListener("change", () => importFromFile(dom.importJson.files[0]));
    dom.helpBtn.addEventListener("click", () => dom.helpDialog.showModal());
    dom.helpClose.addEventListener("click", () => dom.helpDialog.close());
    dom.helpDialog.addEventListener("click", (event) => {
      if (event.target === dom.helpDialog) dom.helpDialog.close();
    });
    window.addEventListener("resize", resizeCanvas);
  }

  function snapshotState() {
    const pose = getRoutePose(state.currentTime / DURATION);
    return {
      version: SAVE_VERSION,
      duration: DURATION,
      isPlaying: state.isPlaying,
      currentTime: Number(state.currentTime.toFixed(3)),
      progress: Number((state.currentTime / DURATION).toFixed(4)),
      mode: state.mode,
      selected: state.selected,
      canvas: { width: view.width, height: view.height },
      routeLength: Number(view.routeLength.toFixed(2)),
      screenPose: {
        x: Number((pose.x * view.width).toFixed(2)),
        y: Number((pose.y * view.height).toFixed(2))
      },
      path: state.path.map((point) => ({ x: point.x, y: point.y })),
      nodes: state.nodes.map((node, index) => ({
        id: node.id,
        name: node.name,
        x: Number(node.x.toFixed(5)),
        y: Number(node.y.toFixed(5)),
        screenX: Number((node.x * view.width).toFixed(2)),
        screenY: Number((node.y * view.height).toFixed(2)),
        radius: node.radius,
        pitch: node.pitch,
        delay: node.delay,
        decay: node.decay,
        crossingTime: view.crossings[index]?.time ?? null,
        soundTime: view.crossings[index]?.time != null
          ? Number((view.crossings[index].time + node.delay / 1000).toFixed(3))
          : null,
        reached: !!view.crossings[index]?.reached
      })),
      audio: { ...audio.getStats(), level: audio.getLevel() }
    };
  }

  function getSyncReport() {
    const current = state.currentTime;
    const pose = getRoutePose(current / DURATION);
    const nodes = state.nodes.map((node, index) => {
      const crossing = view.crossings[index];
      const soundTime = crossing?.time != null ? crossing.time + node.delay / 1000 : null;
      return {
        index,
        name: node.name,
        crossingTime: crossing?.time != null ? Number(crossing.time.toFixed(3)) : null,
        soundTime: soundTime != null ? Number(soundTime.toFixed(3)) : null,
        delayMs: node.delay,
        distanceFromCurrent: crossing?.time != null ? Number((crossing.time - current).toFixed(3)) : null,
        visualTriggered: view.visualEvents.has(`${view.seekVersion}:${index}:visual`),
        soundTriggered: view.reachedEvents.has(`${view.seekVersion}:${index}:audio`),
        audioScheduled: view.scheduledEvents.has(`${view.seekVersion}:${index}:node`)
      };
    });
    return {
      currentTime: Number(current.toFixed(3)),
      isPlaying: state.isPlaying,
      pose: {
        normalized: { x: Number(pose.x.toFixed(5)), y: Number(pose.y.toFixed(5)) },
        screen: { x: Number((pose.x * view.width).toFixed(2)), y: Number((pose.y * view.height).toFixed(2)) }
      },
      clockSource: "AudioContext.currentTime",
      audio: { ...audio.getStats(), level: audio.getLevel() },
      nodes
    };
  }

  function boot() {
    buildNodeSwitcher();
    bindEvents();
    resizeCanvas();
    renderInspector();
    updateTransportUi(performance.now(), true);
    if (window.ResizeObserver) {
      const observer = new ResizeObserver(() => resizeCanvas());
      observer.observe(dom.canvasWrap);
    }
    requestAnimationFrame(function animate(now) {
      advancePlayback(now);
      drawFrame(now);
      updateTransportUi(now);
      requestAnimationFrame(animate);
    });
  }

  window.__nocturne = Object.freeze({
    getState: snapshotState,
    getSyncReport,
    play: startPlayback,
    pause: () => pausePlayback(true),
    seek: (seconds) => seekTo(seconds),
    exportJSON: exportPayload
  });

  boot();
})();
