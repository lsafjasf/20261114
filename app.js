(() => {
  "use strict";

  const SEED = 0x5eed2603;
  const SAMPLE_RATE = 44100;
  const AMBIENT_DURATION = 18;
  const EVENT_TIMES = [2.7, 8.35, 14.0];
  const MAX_ERRORS = 2;

  const PROFILES = [
    {
      id: 0,
      code: "IMPACT",
      contour: "上行轮廓",
      attack: "硬切起音",
      attackMs: 6,
      f0: 88,
      f1: 126,
      color: "#d8ff63",
      hits: [0, 0.118],
      hitGain: [0.85, 0.55],
      release: 0.92,
      timbre: "square",
      metal: 1760,
    },
    {
      id: 1,
      code: "PNEUMATIC",
      contour: "下降轮廓",
      attack: "气压滑入",
      attackMs: 118,
      f0: 146,
      f1: 97,
      color: "#8cf5cf",
      hits: [0.01, 0.32],
      hitGain: [0.34, 0.2],
      release: 1.34,
      timbre: "sawtooth",
      metal: 1120,
    },
    {
      id: 2,
      code: "SPRING",
      contour: "脉冲轮廓",
      attack: "三连瞬击",
      attackMs: 9,
      f0: 108,
      f1: 121,
      color: "#efb85e",
      hits: [0, 0.078, 0.154],
      hitGain: [0.62, 0.52, 0.43],
      release: 0.76,
      timbre: "triangle",
      metal: 2240,
    },
  ];

  const TARGETS = [
    { id: "T-01", profileId: 0, label: "现场切片 A" },
    { id: "T-02", profileId: 1, label: "现场切片 B" },
    { id: "T-03", profileId: 2, label: "现场切片 C" },
  ];

  const REFERENCES = [
    { id: "R-01", profileId: 1, label: "干燥档案 01" },
    { id: "R-02", profileId: 2, label: "干燥档案 02" },
    { id: "R-03", profileId: 0, label: "干燥档案 03" },
  ];

  const targetById = new Map(TARGETS.map((target) => [target.id, target]));
  const referenceById = new Map(REFERENCES.map((reference) => [reference.id, reference]));
  const profileById = new Map(PROFILES.map((profile) => [profile.id, profile]));

  const state = {
    ready: false,
    selectedTargetId: null,
    locked: new Map(),
    usedReferenceIds: new Set(),
    errors: 0,
    ended: false,
    resultKind: null,
    playback: null,
  };

  const audio = {
    context: null,
    master: null,
    source: null,
    ambientBuffer: null,
    referenceBuffers: new Map(),
    targetAnalysis: [],
    ambientAnalysis: null,
    startedAt: 0,
    duration: 0,
    offset: 0,
    token: 0,
  };

  const dom = {
    targetList: document.querySelector("#targetList"),
    referenceList: document.querySelector("#referenceList"),
    ambientPlay: document.querySelector("#ambientPlay"),
    engineStatus: document.querySelector("#engineStatus"),
    engineStatusText: document.querySelector("#engineStatusText"),
    soundToggle: document.querySelector("#soundToggle"),
    seedLabel: document.querySelector("#seedLabel"),
    errorCount: document.querySelector("#errorCount"),
    matchCount: document.querySelector("#matchCount"),
    progressDots: document.querySelector("#progressDots"),
    activeTargetLabel: document.querySelector("#activeTargetLabel"),
    activeReferenceLabel: document.querySelector("#activeReferenceLabel"),
    lockHint: document.querySelector("#lockHint"),
    lockHelp: document.querySelector(".lock-help"),
    clearSelection: document.querySelector("#clearSelection"),
    interferenceValues: document.querySelector("#interferenceValues"),
    recordBadge: document.querySelector("#recordBadge"),
    canvas: document.querySelector("#spectralCanvas"),
    canvasFrame: document.querySelector("#canvasFrame"),
    canvasLoading: document.querySelector("#canvasLoading"),
    toast: document.querySelector("#toast"),
    modal: document.querySelector("#resultModal"),
    resultKicker: document.querySelector("#resultKicker"),
    resultTitle: document.querySelector("#resultTitle"),
    resultCopy: document.querySelector("#resultCopy"),
    resultCorrect: document.querySelector("#resultCorrect"),
    resultErrors: document.querySelector("#resultErrors"),
    resultSeed: document.querySelector("#resultSeed"),
    restartButton: document.querySelector("#restartButton"),
  };

  const canvasState = {
    width: 0,
    height: 0,
    dpr: 1,
    lastFrame: 0,
  };

  function mulberry32(seed) {
    let value = seed >>> 0;
    return function random() {
      value += 0x6d2b79f5;
      let next = value;
      next = Math.imul(next ^ (next >>> 15), next | 1);
      next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
      return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashSeed(...parts) {
    let value = SEED;
    for (const part of parts) {
      const text = String(part);
      for (let index = 0; index < text.length; index += 1) {
        value ^= text.charCodeAt(index) + (value << 6) + (value >>> 2);
      }
    }
    return value >>> 0;
  }

  function buildInterference() {
    const rng = mulberry32(SEED ^ 0xa53c9e17);
    const targets = TARGETS.map((target) => ({
      targetId: target.id,
      wet: 0.2 + rng() * 0.13,
      noise: 0.018 + rng() * 0.017,
      cutoff: 2350 + rng() * 1750,
      room: 1.5 + rng() * 0.8,
      metalOffset: -180 + rng() * 360,
      drift: (rng() - 0.5) * 5,
    }));
    return {
      targets,
      bedNoise: 0.65 + rng() * 0.2,
      bedLowpass: 1550 + rng() * 550,
      hum: 0.0045 + rng() * 0.0025,
    };
  }

  const interference = buildInterference();
  const interferenceByTarget = new Map(
    interference.targets.map((settings) => [settings.targetId, settings]),
  );

  function correctReferenceFor(targetId) {
    const target = targetById.get(targetId);
    if (!target) return null;
    return REFERENCES.find((reference) => reference.profileId === target.profileId) || null;
  }

  function formatSeed(seed) {
    return `0x${seed.toString(16).toUpperCase().padStart(8, "0")}`;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function dbLabel(linear) {
    return `${Math.round(20 * Math.log10(Math.max(linear, 0.00001)))} dB`;
  }

  function createNoiseBuffer(context, seconds, rng, channels = 1) {
    const length = Math.max(1, Math.floor(context.sampleRate * seconds));
    const buffer = context.createBuffer(channels, length, context.sampleRate);
    for (let channel = 0; channel < channels; channel += 1) {
      const data = buffer.getChannelData(channel);
      let low = 0;
      for (let index = 0; index < length; index += 1) {
        const white = rng() * 2 - 1;
        low = low * 0.94 + white * 0.06;
        data[index] = white * 0.76 + low * 1.4;
      }
    }
    return buffer;
  }

  function createImpulseResponse(context, seconds, decay, seed) {
    const rng = mulberry32(seed);
    const length = Math.floor(context.sampleRate * seconds);
    const impulse = context.createBuffer(2, length, context.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = impulse.getChannelData(channel);
      let damping = 0;
      for (let index = 0; index < length; index += 1) {
        const progress = index / length;
        const noise = rng() * 2 - 1;
        damping = damping * 0.82 + noise * 0.18;
        const envelope = Math.pow(1 - progress, decay * 2.25 + 0.8);
        data[index] = damping * envelope * (1 + Math.sin(index * 0.0031) * 0.1);
      }
    }
    return impulse;
  }

  function scheduleMechanical(context, profile, startTime, settings, destination) {
    const eventGain = context.createGain();
    eventGain.gain.setValueAtTime(0.0001, 0);
    eventGain.gain.exponentialRampToValueAtTime(0.62, startTime + Math.max(0.008, profile.attackMs / 1000));
    eventGain.gain.exponentialRampToValueAtTime(0.0001, startTime + profile.release + 0.58);

    const outputFilter = context.createBiquadFilter();
    outputFilter.type = "lowpass";
    outputFilter.frequency.setValueAtTime(settings.cutoff, 0);
    outputFilter.Q.setValueAtTime(0.7, 0);
    eventGain.connect(outputFilter);
    outputFilter.connect(destination);

    const rng = mulberry32(hashSeed(profile.id, settings.targetId || "dry", "partials"));
    const attack = Math.max(0.004, profile.attackMs / 1000);
    const glideEnd = startTime + 0.68;
    const endTime = startTime + profile.release + 0.7;

    const body = context.createOscillator();
    body.type = "sine";
    body.frequency.setValueAtTime(profile.f0 + settings.drift, startTime);
    body.frequency.exponentialRampToValueAtTime(
      Math.max(30, profile.f1 + settings.drift),
      glideEnd,
    );
    const bodyGain = context.createGain();
    bodyGain.gain.setValueAtTime(0.0001, startTime);
    bodyGain.gain.exponentialRampToValueAtTime(0.35, startTime + attack);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, endTime);
    body.connect(bodyGain);
    bodyGain.connect(eventGain);
    body.start(startTime);
    body.stop(endTime + 0.03);

    const harmonic = context.createOscillator();
    harmonic.type = profile.timbre;
    harmonic.frequency.setValueAtTime(profile.f0 * 1.51 + settings.drift, startTime);
    harmonic.frequency.exponentialRampToValueAtTime(
      Math.max(50, profile.f1 * 1.51 + settings.drift),
      glideEnd,
    );
    const harmonicGain = context.createGain();
    harmonicGain.gain.setValueAtTime(0.0001, startTime);
    harmonicGain.gain.exponentialRampToValueAtTime(
      profile.id === 1 ? 0.045 : 0.07,
      startTime + attack * 1.4,
    );
    harmonicGain.gain.exponentialRampToValueAtTime(0.0001, endTime);
    harmonic.connect(harmonicGain);
    harmonicGain.connect(eventGain);
    harmonic.start(startTime);
    harmonic.stop(endTime + 0.03);

    if (profile.id === 1) {
      const pressure = context.createOscillator();
      pressure.type = "triangle";
      pressure.frequency.setValueAtTime(profile.f0 * 0.48, startTime);
      pressure.frequency.exponentialRampToValueAtTime(profile.f1 * 0.55, startTime + 0.85);
      const pressureGain = context.createGain();
      pressureGain.gain.setValueAtTime(0.0001, startTime);
      pressureGain.gain.exponentialRampToValueAtTime(0.06, startTime + attack * 0.8);
      pressureGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 1.6);
      pressure.connect(pressureGain);
      pressureGain.connect(eventGain);
      pressure.start(startTime);
      pressure.stop(startTime + 1.65);
    }

    const transientNoise = createNoiseBuffer(context, 0.24, rng);
    profile.hits.forEach((hitTime, hitIndex) => {
      const transient = context.createBufferSource();
      transient.buffer = transientNoise;
      const band = context.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.setValueAtTime(
        profile.metal + settings.metalOffset + hitIndex * 130,
        startTime,
      );
      band.Q.setValueAtTime(2.8 + rng() * 1.3, startTime);
      const transientGain = context.createGain();
      const hitAt = startTime + hitTime;
      const hitAttack = Math.max(0.003, profile.attackMs / 1000 * 0.45);
      transientGain.gain.setValueAtTime(0.0001, hitAt);
      transientGain.gain.exponentialRampToValueAtTime(
        profile.hitGain[hitIndex] * 0.31,
        hitAt + hitAttack,
      );
      transientGain.gain.exponentialRampToValueAtTime(
        0.0001,
        hitAt + 0.13 + profile.release * 0.08,
      );
      transient.connect(band);
      band.connect(transientGain);
      transientGain.connect(eventGain);
      transient.start(hitAt);
      transient.stop(hitAt + 0.22);

      const click = context.createOscillator();
      click.type = "square";
      click.frequency.setValueAtTime(profile.metal * 0.23 + hitIndex * 34, hitAt);
      click.frequency.exponentialRampToValueAtTime(
        profile.metal * 0.13,
        hitAt + 0.055,
      );
      const clickGain = context.createGain();
      clickGain.gain.setValueAtTime(0.0001, hitAt);
      clickGain.gain.exponentialRampToValueAtTime(0.022, hitAt + 0.004);
      clickGain.gain.exponentialRampToValueAtTime(0.0001, hitAt + 0.075);
      click.connect(clickGain);
      clickGain.connect(eventGain);
      click.start(hitAt);
      click.stop(hitAt + 0.09);
    });

    return eventGain;
  }

  async function renderReference(profile) {
    const duration = 2.8;
    const context = new OfflineAudioContext(
      2,
      Math.floor(SAMPLE_RATE * duration),
      SAMPLE_RATE,
    );
    const master = context.createGain();
    master.gain.setValueAtTime(0.72, 0);
    master.connect(context.destination);

    const shape = context.createBiquadFilter();
    shape.type = "highpass";
    shape.frequency.setValueAtTime(34, 0);
    shape.Q.setValueAtTime(0.4, 0);
    shape.connect(master);

    scheduleMechanical(
      context,
      profile,
      0.18,
      {
        targetId: `dry-${profile.id}`,
        cutoff: 5100,
        drift: 0,
        metalOffset: 0,
      },
      shape,
    );

    return context.startRendering();
  }

  async function renderAmbient() {
    const context = new OfflineAudioContext(
      2,
      Math.floor(SAMPLE_RATE * AMBIENT_DURATION),
      SAMPLE_RATE,
    );

    const compressor = context.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-17, 0);
    compressor.knee.setValueAtTime(18, 0);
    compressor.ratio.setValueAtTime(3.2, 0);
    compressor.attack.setValueAtTime(0.006, 0);
    compressor.release.setValueAtTime(0.28, 0);
    compressor.connect(context.destination);

    const master = context.createGain();
    master.gain.setValueAtTime(0.76, 0);
    master.connect(compressor);

    const reverb = context.createConvolver();
    reverb.buffer = createImpulseResponse(
      context,
      2.8,
      interference.targets[1].room,
      hashSeed("ambient-room"),
    );
    const reverbGain = context.createGain();
    reverbGain.gain.setValueAtTime(0.78, 0);
    reverb.connect(reverbGain);
    reverbGain.connect(master);

    const bedRng = mulberry32(hashSeed("field-bed"));
    const bedNoise = createNoiseBuffer(context, AMBIENT_DURATION, bedRng);
    const bedSource = context.createBufferSource();
    bedSource.buffer = bedNoise;
    bedSource.loop = true;
    const bedHighpass = context.createBiquadFilter();
    bedHighpass.type = "highpass";
    bedHighpass.frequency.setValueAtTime(42, 0);
    const bedLowpass = context.createBiquadFilter();
    bedLowpass.type = "lowpass";
    bedLowpass.frequency.setValueAtTime(interference.bedLowpass, 0);
    bedLowpass.Q.setValueAtTime(0.35, 0);
    const bedGain = context.createGain();
    bedGain.gain.setValueAtTime(
      interference.targets[0].noise * interference.bedNoise,
      0,
    );
    bedSource.connect(bedHighpass);
    bedHighpass.connect(bedLowpass);
    bedLowpass.connect(bedGain);
    bedGain.connect(master);
    bedSource.start(0);
    bedSource.stop(AMBIENT_DURATION);

    const humRng = mulberry32(hashSeed("mains-hum"));
    [48, 96, 144].forEach((frequency, index) => {
      const hum = context.createOscillator();
      hum.type = "sine";
      hum.frequency.setValueAtTime(frequency + (humRng() - 0.5) * 0.15, 0);
      const humGain = context.createGain();
      humGain.gain.setValueAtTime(interference.hum / (index + 1.2), 0);
      hum.connect(humGain);
      humGain.connect(master);
      hum.start(0);
      hum.stop(AMBIENT_DURATION);
    });

    const fieldPulse = context.createOscillator();
    fieldPulse.type = "sine";
    fieldPulse.frequency.setValueAtTime(0.11, 0);
    const pulseGain = context.createGain();
    pulseGain.gain.setValueAtTime(0.006, 0);
    fieldPulse.connect(pulseGain);
    pulseGain.connect(master);
    fieldPulse.start(0);
    fieldPulse.stop(AMBIENT_DURATION);

    TARGETS.forEach((target, index) => {
      const profile = profileById.get(target.profileId);
      const settings = interferenceByTarget.get(target.id);
      const eventOutput = context.createGain();
      eventOutput.gain.setValueAtTime(0.55, 0);
      const dry = context.createGain();
      dry.gain.setValueAtTime(1 - settings.wet * 0.72, 0);
      const wet = context.createGain();
      wet.gain.setValueAtTime(settings.wet, 0);
      eventOutput.connect(dry);
      dry.connect(master);
      eventOutput.connect(wet);
      wet.connect(reverb);

      scheduleMechanical(
        context,
        profile,
        EVENT_TIMES[index],
        settings,
        eventOutput,
      );
    });

    return context.startRendering();
  }

  function fft(re, im) {
    const size = re.length;
    let target = 0;
    for (let index = 1; index < size; index += 1) {
      let bit = size >> 1;
      while (target & bit) {
        target ^= bit;
        bit >>= 1;
      }
      target ^= bit;
      if (index < target) {
        [re[index], re[target]] = [re[target], re[index]];
        [im[index], im[target]] = [im[target], im[index]];
      }
    }

    for (let length = 2; length <= size; length <<= 1) {
      const angle = (-2 * Math.PI) / length;
      const half = length >> 1;
      for (let start = 0; start < size; start += length) {
        for (let offset = 0; offset < half; offset += 1) {
          const cosine = Math.cos(angle * offset);
          const sine = Math.sin(angle * offset);
          const even = start + offset;
          const odd = even + half;
          const oddRe = re[odd] * cosine - im[odd] * sine;
          const oddIm = re[odd] * sine + im[odd] * cosine;
          re[odd] = re[even] - oddRe;
          im[odd] = im[even] - oddIm;
          re[even] += oddRe;
          im[even] += oddIm;
        }
      }
    }
  }

  function bufferToMono(buffer) {
    const left = buffer.getChannelData(0);
    if (buffer.numberOfChannels === 1) return left;
    const right = buffer.getChannelData(1);
    const mono = new Float32Array(left.length);
    for (let index = 0; index < left.length; index += 1) {
      mono[index] = (left[index] + right[index]) * 0.5;
    }
    return mono;
  }

  function computeSpectrogram(mono, sampleRate, options) {
    const {
      start = 0,
      duration = mono.length / sampleRate,
      columns = 96,
      rows = 34,
      minFrequency = 42,
      maxFrequency = 2800,
      fftSize = 1024,
    } = options;
    const bins = fftSize / 2;
    const half = fftSize / 2;
    const startSample = Math.floor(start * sampleRate);
    const data = new Float32Array(columns * rows);
    const re = new Float32Array(fftSize);
    const im = new Float32Array(fftSize);
    const window = new Float32Array(fftSize);
    for (let index = 0; index < fftSize; index += 1) {
      window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (fftSize - 1));
    }

    let maximum = 0.00001;
    for (let column = 0; column < columns; column += 1) {
      const progress = columns <= 1 ? 0 : column / (columns - 1);
      const center = startSample + Math.floor(progress * duration * sampleRate);
      const first = clamp(center - half, 0, mono.length - fftSize);
      re.fill(0);
      im.fill(0);
      for (let index = 0; index < fftSize; index += 1) {
        const sample = mono[first + index] || 0;
        re[index] = sample * window[index];
      }
      fft(re, im);
      for (let row = 0; row < rows; row += 1) {
        const ratio = rows <= 1 ? 0 : row / (rows - 1);
        const frequency = maxFrequency * Math.pow(minFrequency / maxFrequency, ratio);
        const bin = clamp(Math.round(frequency / (sampleRate / fftSize)), 1, bins - 1);
        const magnitude = Math.sqrt(re[bin] * re[bin] + im[bin] * im[bin]);
        data[column * rows + row] = magnitude;
        maximum = Math.max(maximum, magnitude);
      }
    }

    const normalizer = maximum * 0.032;
    for (let index = 0; index < data.length; index += 1) {
      data[index] = clamp(Math.log1p(data[index] / normalizer) / Math.log1p(31), 0, 1);
    }
    return { columns, rows, data, minFrequency, maxFrequency };
  }

  function analyzeRenderedAudio() {
    const ambientMono = bufferToMono(audio.ambientBuffer);
    audio.ambientAnalysis = computeSpectrogram(ambientMono, SAMPLE_RATE, {
      columns: 320,
      rows: 32,
      duration: AMBIENT_DURATION,
      minFrequency: 38,
      maxFrequency: 3000,
      fftSize: 2048,
    });

    audio.targetAnalysis = TARGETS.map((target, index) => {
      const eventStart = EVENT_TIMES[index] - 0.16;
      return computeSpectrogram(ambientMono, SAMPLE_RATE, {
        columns: 104,
        rows: 34,
        start: eventStart,
        duration: 2.42,
        minFrequency: 42,
        maxFrequency: 2800,
        fftSize: 1024,
      });
    });

    audio.referenceAnalysis = new Map();
    REFERENCES.forEach((reference) => {
      const mono = bufferToMono(audio.referenceBuffers.get(reference.id));
      audio.referenceAnalysis.set(
        reference.id,
        computeSpectrogram(mono, SAMPLE_RATE, {
          columns: 104,
          rows: 30,
          start: 0.1,
          duration: 2.38,
          minFrequency: 42,
          maxFrequency: 3000,
          fftSize: 1024,
        }),
      );
    });
  }

  function wavePointValue(profile, time, wet, jitter) {
    const attack = Math.max(0.006, profile.attackMs / 1000);
    let envelope = 0;
    profile.hits.forEach((hit, index) => {
      const rise = clamp((time - hit) / attack, 0, 1);
      const distance = time - hit;
      if (distance >= 0) {
        envelope += profile.hitGain[index] * Math.exp(-distance / 0.2) * rise;
      }
    });
    const carrier =
      0.58 +
      0.42 * Math.sin(time * (profile.id === 1 ? 34 : 47) + profile.id * 1.7);
    const tail =
      wet > 0
        ? Math.max(0, Math.sin((time - 0.25) * 21)) * Math.exp(-Math.max(0, time - 0.2) / 0.8) * wet
        : 0;
    return clamp((envelope * carrier + tail * 0.16 + jitter * 0.025) * 0.9, 0, 1.1);
  }

  function waveSvg(profile, wet = 0, key = "") {
    const width = 240;
    const height = 42;
    const center = height / 2;
    const points = 72;
    const rng = mulberry32(hashSeed(profile.id, key, "wave"));
    const linePoints = [];
    const echoPoints = [];
    for (let index = 0; index < points; index += 1) {
      const progress = index / (points - 1);
      const time = progress * 1.5;
      const jitter = (rng() - 0.5) * 2;
      const value = wavePointValue(profile, time, wet, jitter);
      const x = progress * width;
      const y = center - value * 15;
      linePoints.push(`${x.toFixed(1)},${y.toFixed(1)}`);
      echoPoints.push(
        `${(x + 8).toFixed(1)},${(center - value * 9 + 3).toFixed(1)}`,
      );
    }
    return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
      <path class="wave-echo" d="M ${echoPoints.join(" L ")}"></path>
      <path class="wave-line" d="M ${linePoints.join(" L ")}"></path>
    </svg>`;
  }

  function lockedReferenceForTarget(targetId) {
    const entry = state.locked.get(targetId);
    return entry ? referenceById.get(entry.referenceId) : null;
  }

  function targetForUsedReference(referenceId) {
    for (const [targetId, entry] of state.locked) {
      if (entry.referenceId === referenceId) return targetById.get(targetId);
    }
    return null;
  }

  function renderCards() {
    dom.targetList.innerHTML = TARGETS.map((target) => {
      const profile = profileById.get(target.profileId);
      const locked = state.locked.get(target.id);
      const selected = state.selectedTargetId === target.id;
      const classes = [
        "specimen",
        "target-specimen",
        selected ? "is-selected" : "",
        locked ? "is-locked" : "",
        locked ? (locked.correct ? "is-correct" : "is-wrong") : "",
      ]
        .filter(Boolean)
        .join(" ");
      const reference = locked ? referenceById.get(locked.referenceId) : null;
      const tag = locked ? (locked.correct ? "MATCHED" : "MISREAD") : selected ? "SELECTED" : "WET / MIXED";
      return `<article
        class="${classes}"
        data-target-id="${target.id}"
        role="button"
        tabindex="${locked ? "-1" : "0"}"
        aria-selected="${selected}"
        aria-label="${target.id} 现场切片${locked ? `，已锁定 ${reference.id}` : "，点击选择"}"
      >
        <div class="specimen-top">
          <span class="specimen-id">${target.id}</span>
          <span class="specimen-tag">${tag}</span>
        </div>
        <div class="mini-wave">${waveSvg(profile, interferenceByTarget.get(target.id).wet, target.id)}</div>
        <div class="specimen-bottom">
          <div class="specimen-meta">
            <strong>${target.label}</strong>
            <span>2.4s</span>
          </div>
          <button
            class="play-button"
            type="button"
            data-play-target="${target.id}"
            ${state.ready ? "" : "disabled"}
          ><i class="play-glyph"></i>试听</button>
        </div>
        <div class="specimen-footline">
          <span>${locked ? `${reference.id} · ${locked.correct ? "轮廓吻合" : "轮廓冲突"}` : "混响 / 底噪 / 低通"}</span>
          <span class="result-tag ${locked ? "is-visible" : ""}">${locked ? (locked.correct ? "LOCK" : "ERROR") : ""}</span>
        </div>
      </article>`;
    }).join("");

    dom.referenceList.innerHTML = REFERENCES.map((reference) => {
      const profile = profileById.get(reference.profileId);
      const linkedTarget = targetForUsedReference(reference.id);
      const locked = Boolean(linkedTarget);
      const correct = locked ? state.locked.get(linkedTarget.id).correct : false;
      const classes = [
        "specimen",
        "reference-card",
        locked ? "is-locked" : "",
        locked ? (correct ? "is-correct" : "is-wrong") : "",
      ]
        .filter(Boolean)
        .join(" ");
      const canLock =
        state.ready && state.selectedTargetId && !state.usedReferenceIds.has(reference.id) && !state.ended;
      const tag = locked ? (correct ? "MATCHED" : "MISREAD") : "DRY / ISOLATED";
      return `<article class="${classes}" data-reference-id="${reference.id}">
        <div class="specimen-top">
          <span class="specimen-id">${reference.id}</span>
          <span class="specimen-tag">${tag}</span>
        </div>
        <div class="mini-wave">${waveSvg(profile, 0, reference.id)}</div>
        <div class="ref-meta-grid">
          <span><small>频率轮廓</small><b>${profile.contour}</b></span>
          <span><small>起音方式</small><b>${profile.attack} · ${profile.attackMs}ms</b></span>
        </div>
        <div class="specimen-bottom">
          <div class="specimen-meta"><strong>${profile.code}</strong></div>
          <div class="card-actions">
            <button
              class="play-button"
              type="button"
              data-play-reference="${reference.id}"
              ${state.ready ? "" : "disabled"}
            ><i class="play-glyph"></i>试听</button>
            <button
              class="lock-button"
              type="button"
              data-lock-reference="${reference.id}"
              ${canLock ? "" : "disabled"}
            >${locked ? "已锁定" : "配对"}</button>
          </div>
        </div>
        <div class="specimen-footline">
          <span>${locked ? `${linkedTarget.id} / ROUTED` : `${reference.label} · 无混响`}</span>
          <span class="result-tag ${locked ? "is-visible" : ""}">${locked ? (correct ? "LOCK" : "ERROR") : ""}</span>
        </div>
      </article>`;
    }).join("");

    paintPlaybackClasses();
  }

  function paintPlaybackClasses() {
    const playback = state.playback;
    const ambientPlaying = playback && playback.kind === "ambient";
    dom.ambientPlay.classList.toggle("is-playing", Boolean(ambientPlaying));
    dom.ambientPlay.setAttribute(
      "aria-label",
      ambientPlaying ? "停止完整环境声" : "播放完整环境声",
    );

    document.querySelectorAll("[data-play-target]").forEach((button) => {
      button.classList.toggle(
        "is-playing",
        Boolean(playback && playback.kind === "target" && playback.id === button.dataset.playTarget),
      );
    });
    document.querySelectorAll("[data-play-reference]").forEach((button) => {
      button.classList.toggle(
        "is-playing",
        Boolean(playback && playback.kind === "reference" && playback.id === button.dataset.playReference),
      );
    });

    const badgeLabel = dom.recordBadge.querySelector("span");
    dom.recordBadge.classList.toggle("is-recording", Boolean(playback));
    if (!playback) {
      badgeLabel.textContent = "LISTENING";
    } else if (playback.kind === "ambient") {
      badgeLabel.textContent = "FIELD / 18s";
    } else {
      badgeLabel.textContent = `${playback.kind === "target" ? "WET" : "DRY"} / ${playback.id}`;
    }
  }

  function updateHud() {
    const lockedCount = state.locked.size;
    const correctCount = [...state.locked.values()].filter((entry) => entry.correct).length;
    dom.seedLabel.textContent = formatSeed(SEED);
    dom.errorCount.textContent = String(state.errors).padStart(2, "0");
    dom.errorCount.classList.toggle("is-error", state.errors > 0);
    dom.matchCount.textContent = String(lockedCount).padStart(2, "0");

    dom.progressDots.innerHTML = TARGETS.map((target) => {
      const entry = state.locked.get(target.id);
      const className = entry ? (entry.correct ? "is-correct" : "is-wrong") : "";
      return `<i class="${className}"></i>`;
    }).join("");

    const selectedTarget = state.selectedTargetId
      ? targetById.get(state.selectedTargetId)
      : null;
    dom.activeTargetLabel.textContent = selectedTarget ? selectedTarget.id : "等待目标";
    dom.activeTargetLabel.classList.toggle("muted", !selectedTarget);
    dom.activeReferenceLabel.textContent = selectedTarget ? "选择右侧参考" : "未选择";
    dom.clearSelection.disabled = !selectedTarget || state.ended;

    dom.lockHelp.classList.remove("is-ready", "is-error");
    if (state.ended) {
      dom.lockHint.textContent =
        state.resultKind === "failure" ? "任务终止 · 请重新开始" : "声场已记录 · 可关闭结果";
      dom.lockHelp.classList.add(state.resultKind === "failure" ? "is-error" : "is-ready");
    } else if (!state.ready) {
      dom.lockHint.textContent = "正在合成确定性声场";
    } else if (!selectedTarget) {
      dom.lockHint.textContent = "先点选一段现场切片";
    } else {
      dom.lockHint.textContent = "在右侧选择参考并锁定";
      dom.lockHelp.classList.add("is-ready");
    }

    const settings = selectedTarget
      ? interferenceByTarget.get(selectedTarget.id)
      : interference.targets[0];
    dom.interferenceValues.innerHTML = `
      <span>WET <b>${Math.round(settings.wet * 100)}%</b></span>
      <span>NOISE <b>${dbLabel(settings.noise)}</b></span>
      <span>LPF <b>${(settings.cutoff / 1000).toFixed(1)}k</b></span>`;

    if (state.ended) {
      dom.recordBadge.querySelector("span").textContent =
        state.resultKind === "failure" ? "TRACE LOST" : `${correctCount}/3 CLOSED`;
      dom.recordBadge.classList.toggle("is-recording", state.resultKind === "failure");
    } else {
      paintPlaybackClasses();
    }
  }

  function setEngineStatus(mode, text) {
    dom.engineStatus.classList.remove("is-working", "is-muted");
    if (mode === "working") dom.engineStatus.classList.add("is-working");
    if (mode === "muted") dom.engineStatus.classList.add("is-muted");
    dom.engineStatusText.textContent = text;
  }

  let toastTimer = 0;
  function showToast(message, tone = "") {
    window.clearTimeout(toastTimer);
    dom.toast.className = "toast";
    if (tone) dom.toast.classList.add(`is-${tone}`);
    dom.toast.textContent = message;
    requestAnimationFrame(() => dom.toast.classList.add("is-visible"));
    toastTimer = window.setTimeout(() => {
      dom.toast.classList.remove("is-visible");
    }, 2600);
  }

  async function ensureAudioContext() {
    if (!audio.context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audio.context = new AudioContextClass();
      const compressor = audio.context.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-14, 0);
      compressor.knee.setValueAtTime(14, 0);
      compressor.ratio.setValueAtTime(2.5, 0);
      compressor.connect(audio.context.destination);
      audio.master = audio.context.createGain();
      audio.master.gain.setValueAtTime(audio.muted ? 0 : 0.9, 0);
      audio.master.connect(compressor);
    }
    if (audio.context.state === "suspended") {
      await audio.context.resume();
    }
  }

  function stopPlayback() {
    audio.token += 1;
    if (audio.source) {
      try {
        audio.source.stop();
      } catch {
        // The source may already have ended.
      }
      audio.source.disconnect();
      audio.source = null;
    }
    state.playback = null;
    paintPlaybackClasses();
    requestCanvasDraw();
  }

  async function startPlayback(kind, id, buffer, options = {}) {
    if (!state.ready || !buffer) return;
    try {
      await ensureAudioContext();
    } catch {
      showToast("浏览器无法启动音频输出。", "error");
      return;
    }

    stopPlayback();
    const token = audio.token;
    const source = audio.context.createBufferSource();
    source.buffer = buffer;
    source.connect(audio.master);
    const offset = options.offset || 0;
    const duration = options.duration || buffer.duration - offset;
    source.start(0, offset, duration);
    audio.source = source;
    audio.startedAt = audio.context.currentTime;
    audio.duration = duration;
    audio.offset = offset;
    state.playback = { kind, id, duration, startedAt: audio.startedAt };
    paintPlaybackClasses();
    requestCanvasDraw();

    source.onended = () => {
      if (audio.token !== token) return;
      audio.source = null;
      state.playback = null;
      paintPlaybackClasses();
      requestCanvasDraw();
    };
  }

  function playAmbient() {
    if (state.playback && state.playback.kind === "ambient") {
      stopPlayback();
      return;
    }
    startPlayback("ambient", "FIELD", audio.ambientBuffer, {
      duration: AMBIENT_DURATION,
    });
  }

  function playTarget(targetId) {
    const index = TARGETS.findIndex((target) => target.id === targetId);
    if (index < 0) return;
    const offset = Math.max(0, EVENT_TIMES[index] - 0.18);
    startPlayback("target", targetId, audio.ambientBuffer, {
      offset,
      duration: 2.55,
    });
  }

  function playReference(referenceId) {
    const buffer = audio.referenceBuffers.get(referenceId);
    startPlayback("reference", referenceId, buffer);
  }

  async function playFeedback(correct) {
    try {
      await ensureAudioContext();
    } catch {
      return;
    }
    const now = audio.context.currentTime;
    const frequencies = correct ? [660, 990] : [190, 142];
    frequencies.forEach((frequency, index) => {
      const oscillator = audio.context.createOscillator();
      const gain = audio.context.createGain();
      oscillator.type = correct ? "sine" : "square";
      oscillator.frequency.setValueAtTime(frequency, now + index * 0.075);
      gain.gain.setValueAtTime(0.0001, now + index * 0.075);
      gain.gain.exponentialRampToValueAtTime(correct ? 0.04 : 0.025, now + index * 0.075 + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.075 + (correct ? 0.16 : 0.25));
      oscillator.connect(gain);
      gain.connect(audio.master);
      oscillator.start(now + index * 0.075);
      oscillator.stop(now + index * 0.075 + (correct ? 0.18 : 0.27));
    });
  }

  function selectTarget(targetId) {
    if (!state.ready) {
      showToast("声场仍在合成，请稍候。");
      return;
    }
    if (state.ended) return;
    if (state.locked.has(targetId)) {
      showToast(`${targetId} 的判断已经锁定，不能更改。`);
      return;
    }
    state.selectedTargetId = state.selectedTargetId === targetId ? null : targetId;
    renderCards();
    updateHud();
    drawCanvas();
  }

  function setMuted(muted) {
    audio.muted = muted;
    if (audio.master && audio.context) {
      audio.master.gain.setTargetAtTime(muted ? 0 : 0.9, audio.context.currentTime, 0.015);
    }
    dom.soundToggle.classList.toggle("is-muted", muted);
    dom.soundToggle.setAttribute("aria-label", muted ? "恢复声音" : "停止所有声音");
    setEngineStatus(muted ? "muted" : "ready", muted ? "AUDIO MUTED" : "SYNTH READY");
    if (muted) {
      stopPlayback();
    }
  }

  function lockReference(referenceId) {
    if (!state.ready || state.ended) return false;
    const targetId = state.selectedTargetId;
    const target = targetById.get(targetId);
    const reference = referenceById.get(referenceId);
    if (!target) {
      showToast("先选择一段现场切片，再锁定参考。");
      return false;
    }
    if (!reference || state.usedReferenceIds.has(referenceId)) {
      showToast("这份参考已经用于其他判断。");
      return false;
    }

    const correct = target.profileId === reference.profileId;
    state.locked.set(targetId, { referenceId, correct });
    state.usedReferenceIds.add(referenceId);
    state.selectedTargetId = null;
    if (!correct) state.errors += 1;
    playFeedback(correct);

    if (correct) {
      showToast(`${targetId} × ${referenceId} 已闭合，频率轮廓吻合。`, "success");
    } else {
      showToast(
        `${targetId} × ${referenceId} 轮廓冲突 · 误判 ${String(state.errors).padStart(2, "0")} / 02`,
        "error",
      );
    }

    const correctCount = [...state.locked.values()].filter((entry) => entry.correct).length;
    if (state.errors >= MAX_ERRORS) {
      state.ended = true;
      state.resultKind = "failure";
    } else if (state.locked.size === TARGETS.length) {
      state.ended = true;
      state.resultKind = correctCount === TARGETS.length ? "success" : "partial";
    }

    renderCards();
    updateHud();
    drawCanvas();

    if (state.ended) {
      const resultKind = state.resultKind;
      window.setTimeout(() => showResult(resultKind), 620);
    }
    return correct;
  }

  function showResult(kind) {
    dom.modal.classList.remove("is-failure", "is-partial");
    const correctCount = [...state.locked.values()].filter((entry) => entry.correct).length;
    if (kind === "failure") {
      dom.modal.classList.add("is-failure");
      dom.resultKicker.textContent = "TRACE TERMINATED / 2 ERRORS";
      dom.resultTitle.textContent = "声场失去可信度。";
      dom.resultCopy.textContent =
        "第二次轮廓冲突已记录，任务被强制终止。误判会锁定判断，但不会抹去声场；重新开始后，seed 与干扰参数保持一致。";
    } else if (kind === "partial") {
      dom.modal.classList.add("is-partial");
      dom.resultKicker.textContent = "FIELD CLOSED / 1 ANOMALY";
      dom.resultTitle.textContent = "声场闭合，但不干净。";
      dom.resultCopy.textContent =
        "三段判断全部锁定，其中一条误判仍在容错范围内。工程记录已保留，频谱连线可继续查看。";
    } else {
      dom.resultKicker.textContent = "ASSAY COMPLETE / CLEAN TRACE";
      dom.resultTitle.textContent = "三段声源已归位。";
      dom.resultCopy.textContent =
        "所有频率轮廓与起音方式均吻合。混响和底噪没有改写机器的原始身份。";
    }
    dom.resultCorrect.textContent = `${correctCount} / 3`;
    dom.resultErrors.textContent = `${state.errors} / 2`;
    dom.resultSeed.textContent = formatSeed(SEED);
    dom.modal.hidden = false;
    window.setTimeout(() => dom.restartButton.focus(), 80);
  }

  function closeResult() {
    dom.modal.hidden = true;
  }

  function restartGame() {
    closeResult();
    stopPlayback();
    state.selectedTargetId = null;
    state.locked.clear();
    state.usedReferenceIds.clear();
    state.errors = 0;
    state.ended = false;
    state.resultKind = null;
    renderCards();
    updateHud();
    drawCanvas();
    showToast("任务已重置，正在使用同一固定 seed。");
  }

  function bindEvents() {
    dom.targetList.addEventListener("click", (event) => {
      const playButton = event.target.closest("[data-play-target]");
      const card = event.target.closest("[data-target-id]");
      if (!card) return;
      if (playButton) {
        if (audio.muted) setMuted(false);
        if (!state.locked.has(card.dataset.targetId)) selectTarget(card.dataset.targetId);
        playTarget(card.dataset.targetId);
        return;
      }
      selectTarget(card.dataset.targetId);
    });

    dom.targetList.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (event.target.closest("button")) return;
      const card = event.target.closest("[data-target-id]");
      if (!card) return;
      event.preventDefault();
      selectTarget(card.dataset.targetId);
    });

    dom.referenceList.addEventListener("click", (event) => {
      const playButton = event.target.closest("[data-play-reference]");
      const lockButton = event.target.closest("[data-lock-reference]");
      if (playButton) {
        if (audio.muted) setMuted(false);
        playReference(playButton.dataset.playReference);
      } else if (lockButton) {
        lockReference(lockButton.dataset.lockReference);
      }
    });

    dom.ambientPlay.addEventListener("click", () => {
      if (audio.muted) setMuted(false);
      playAmbient();
    });

    dom.soundToggle.addEventListener("click", () => setMuted(!audio.muted));

    dom.clearSelection.addEventListener("click", () => {
      state.selectedTargetId = null;
      renderCards();
      updateHud();
      drawCanvas();
    });

    dom.modal.querySelectorAll("[data-close-modal]").forEach((element) => {
      element.addEventListener("click", closeResult);
    });
    dom.restartButton.addEventListener("click", restartGame);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !dom.modal.hidden) closeResult();
    });
  }

  const HEAT_STOPS = [
    [0, 10, 8, 12],
    [0.18, 15, 34, 27],
    [0.4, 24, 91, 71],
    [0.66, 104, 198, 132],
    [0.84, 216, 255, 99],
    [1, 255, 186, 92],
  ];
  const HEAT_LUT = Array.from({ length: 96 }, (_, index) => {
    const value = index / 95;
    let lower = HEAT_STOPS[0];
    let upper = HEAT_STOPS[HEAT_STOPS.length - 1];
    for (let stop = 1; stop < HEAT_STOPS.length; stop += 1) {
      if (value <= HEAT_STOPS[stop][0]) {
        lower = HEAT_STOPS[stop - 1];
        upper = HEAT_STOPS[stop];
        break;
      }
    }
    const mix = (value - lower[0]) / Math.max(0.0001, upper[0] - lower[0]);
    const red = Math.round(lower[1] + (upper[1] - lower[1]) * mix);
    const green = Math.round(lower[2] + (upper[2] - lower[2]) * mix);
    const blue = Math.round(lower[3] + (upper[3] - lower[3]) * mix);
    return `rgb(${red},${green},${blue})`;
  });

  function heatColor(value) {
    return HEAT_LUT[clamp(Math.round(value * 95), 0, 95)];
  }

  function resizeCanvas() {
    const rect = dom.canvasFrame.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    if (canvasState.width === width && canvasState.height === height && canvasState.dpr === dpr) {
      return;
    }
    canvasState.width = width;
    canvasState.height = height;
    canvasState.dpr = dpr;
    dom.canvas.width = Math.floor(width * dpr);
    dom.canvas.height = Math.floor(height * dpr);
  }

  function drawGrid(ctx, width, height) {
    ctx.fillStyle = "#09100c";
    ctx.fillRect(0, 0, width, height);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(216, 255, 99, 0.055)";
    for (let x = 16; x < width; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, height);
      ctx.stroke();
    }
    for (let y = 16; y < height; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(width, y + 0.5);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(216, 255, 99, 0.09)";
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  }

  function drawSpectrogram(ctx, analysis, x, y, width, height) {
    if (!analysis) return;
    ctx.save();
    ctx.fillStyle = "rgba(7, 13, 9, 0.92)";
    ctx.fillRect(x, y, width, height);
    const cellWidth = width / analysis.columns;
    const cellHeight = height / analysis.rows;
    for (let column = 0; column < analysis.columns; column += 1) {
      for (let row = 0; row < analysis.rows; row += 1) {
        const value = analysis.data[column * analysis.rows + row];
        if (value < 0.035) continue;
        ctx.fillStyle = heatColor(value);
        ctx.globalAlpha = clamp(value * 1.35, 0.12, 1);
        ctx.fillRect(
          x + column * cellWidth,
          y + row * cellHeight,
          cellWidth + 0.65,
          cellHeight + 0.65,
        );
      }
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(229, 237, 217, 0.18)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
    ctx.restore();
  }

  function drawCornerBrackets(ctx, x, y, width, height, color, size = 8) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    const corners = [
      [x, y, 1, 1],
      [x + width, y, -1, 1],
      [x, y + height, 1, -1],
      [x + width, y + height, -1, -1],
    ];
    corners.forEach(([cornerX, cornerY, directionX, directionY]) => {
      ctx.beginPath();
      ctx.moveTo(cornerX + directionX * size, cornerY);
      ctx.lineTo(cornerX, cornerY);
      ctx.lineTo(cornerX, cornerY + directionY * size);
      ctx.stroke();
    });
    ctx.restore();
  }

  function playbackPosition() {
    if (!state.playback || !audio.context) return null;
    const elapsed = Math.max(0, audio.context.currentTime - state.playback.startedAt);
    if (state.playback.kind === "ambient") {
      return clamp(elapsed, 0, AMBIENT_DURATION);
    }
    if (state.playback.kind === "target") {
      const targetIndex = TARGETS.findIndex((target) => target.id === state.playback.id);
      return EVENT_TIMES[targetIndex] + elapsed;
    }
    return null;
  }

  function drawAmbient(ctx, width, height) {
    const x = 18;
    const y = 25;
    const panelWidth = width - 36;
    const panelHeight = clamp(height * 0.19, 92, 132);
    ctx.save();
    ctx.font = '7px "EchoSans", "Cascadia Code", "SFMono-Regular", monospace';
    ctx.fillStyle = "rgba(185, 192, 181, 0.72)";
    ctx.textAlign = "left";
    ctx.fillText("AMBIENT FIELD / 18.0 SEC", x, y - 9);
    ctx.textAlign = "right";
    ctx.fillText("38 Hz — 3.0 kHz", width - 18, y - 9);

    drawSpectrogram(ctx, audio.ambientAnalysis, x, y, panelWidth, panelHeight);

    EVENT_TIMES.forEach((eventTime, index) => {
      const markerX = x + (eventTime / AMBIENT_DURATION) * panelWidth;
      const target = TARGETS[index];
      const selected = state.selectedTargetId === target.id;
      const locked = state.locked.get(target.id);
      ctx.strokeStyle = selected
        ? "rgba(216, 255, 99, 0.9)"
        : locked
          ? locked.correct
            ? "rgba(140, 245, 207, 0.55)"
            : "rgba(255, 118, 88, 0.58)"
          : "rgba(229, 237, 217, 0.3)";
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(Math.round(markerX) + 0.5, y);
      ctx.lineTo(Math.round(markerX) + 0.5, y + panelHeight);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(9, 16, 12, 0.9)";
      ctx.fillRect(markerX - 13, y + panelHeight - 15, 26, 12);
      ctx.fillStyle = selected ? "#d8ff63" : "rgba(229, 237, 217, 0.72)";
      ctx.textAlign = "center";
      ctx.font = '7px "EchoSans", "Cascadia Code", "SFMono-Regular", monospace';
      ctx.fillText(target.id, markerX, y + panelHeight - 6);
    });

    const position = playbackPosition();
    if (position !== null) {
      const playheadX = x + (position / AMBIENT_DURATION) * panelWidth;
      if (playheadX >= x && playheadX <= x + panelWidth) {
        const gradient = ctx.createLinearGradient(playheadX, y, playheadX, y + panelHeight);
        gradient.addColorStop(0, "rgba(216, 255, 99, 0)");
        gradient.addColorStop(0.2, "rgba(216, 255, 99, 0.9)");
        gradient.addColorStop(1, "rgba(216, 255, 99, 0.1)");
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(playheadX + 0.5, y);
        ctx.lineTo(playheadX + 0.5, y + panelHeight);
        ctx.stroke();
        ctx.fillStyle = "#d8ff63";
        ctx.beginPath();
        ctx.moveTo(playheadX - 3, y);
        ctx.lineTo(playheadX + 3, y);
        ctx.lineTo(playheadX, y + 4);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawPairingLine(ctx, startX, startY, endX, endY, color, index) {
    const gap = endX - startX;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineCap = "round";
    ctx.globalAlpha = 0.13;
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.bezierCurveTo(startX + gap * 0.44, startY, endX - gap * 0.44, endY, endX, endY);
    ctx.stroke();
    ctx.globalAlpha = 0.94;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.bezierCurveTo(startX + gap * 0.44, startY, endX - gap * 0.44, endY, endX, endY);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    [startX, endX].forEach((x, endIndex) => {
      ctx.beginPath();
      ctx.arc(x, endIndex === 0 ? startY : endY, 2.2, 0, Math.PI * 2);
      ctx.fill();
    });
    const middleX = (startX + endX) / 2;
    const middleY = (startY + endY) / 2;
    ctx.fillStyle = "#09100c";
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(middleX, middleY, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = '6px "EchoSans", "Cascadia Code", monospace';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(index + 1).padStart(2, "0"), middleX, middleY + 0.5);
    ctx.restore();
  }

  function drawMatchMap(ctx, width, height) {
    const top = clamp(height * 0.29, 146, 188);
    const bottom = height - 34;
    const rowHeight = (bottom - top) / TARGETS.length;
    const gap = clamp(width * 0.15, 48, 104);
    const columnWidth = Math.max(102, (width - 36 - gap) / 2);
    const leftX = 18;
    const rightX = width - 18 - columnWidth;
    const stripHeight = clamp(rowHeight - 31, 43, 62);

    ctx.save();
    ctx.font = '7px "EchoSans", "Cascadia Code", "SFMono-Regular", monospace';
    ctx.fillStyle = "rgba(185, 192, 181, 0.62)";
    ctx.textAlign = "left";
    ctx.fillText("TARGET / WET", leftX, top - 14);
    ctx.textAlign = "right";
    ctx.fillText("REFERENCE / DRY", width - 18, top - 14);

    TARGETS.forEach((target, targetIndex) => {
      const centerY = top + rowHeight * (targetIndex + 0.5);
      const stripY = centerY - stripHeight / 2 + 5;
      const selected = state.selectedTargetId === target.id;
      const locked = state.locked.get(target.id);
      const targetPlaying =
        state.playback && state.playback.kind === "target" && state.playback.id === target.id;
      const analysis = audio.targetAnalysis[targetIndex];

      drawSpectrogram(ctx, analysis, leftX, stripY, columnWidth, stripHeight);
      if (selected || targetPlaying) {
        ctx.fillStyle = selected
          ? "rgba(216, 255, 99, 0.075)"
          : "rgba(140, 245, 207, 0.04)";
        ctx.fillRect(leftX, stripY, columnWidth, stripHeight);
        drawCornerBrackets(
          ctx,
          leftX - 2,
          stripY - 2,
          columnWidth + 4,
          stripHeight + 4,
          selected ? "#d8ff63" : "#8cf5cf",
        );
      }
      if (locked) {
        drawCornerBrackets(
          ctx,
          leftX - 2,
          stripY - 2,
          columnWidth + 4,
          stripHeight + 4,
          locked.correct ? "rgba(140, 245, 207, 0.65)" : "rgba(255, 118, 88, 0.65)",
          6,
        );
      }
      ctx.fillStyle = selected ? "#d8ff63" : "rgba(229, 237, 217, 0.84)";
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.font = '7px "EchoSans", "Cascadia Code", "SFMono-Regular", monospace';
      ctx.fillText(target.id, leftX, stripY - 5);
      ctx.fillStyle = "rgba(185, 192, 181, 0.44)";
      ctx.textAlign = "right";
      ctx.fillText(selected ? "SELECTED" : "WET", leftX + columnWidth, stripY - 5);
    });

    REFERENCES.forEach((reference, referenceIndex) => {
      const centerY = top + rowHeight * (referenceIndex + 0.5);
      const stripY = centerY - stripHeight / 2 + 5;
      const linkedTarget = targetForUsedReference(reference.id);
      const linkedCorrect = linkedTarget ? state.locked.get(linkedTarget.id).correct : false;
      const referencePlaying =
        state.playback &&
        state.playback.kind === "reference" &&
        state.playback.id === reference.id;
      const analysis = audio.referenceAnalysis?.get(reference.id);
      const profile = profileById.get(reference.profileId);

      drawSpectrogram(ctx, analysis, rightX, stripY, columnWidth, stripHeight);
      if (referencePlaying) {
        ctx.fillStyle = "rgba(140, 245, 207, 0.05)";
        ctx.fillRect(rightX, stripY, columnWidth, stripHeight);
        drawCornerBrackets(
          ctx,
          rightX - 2,
          stripY - 2,
          columnWidth + 4,
          stripHeight + 4,
          "#8cf5cf",
        );
      }
      if (linkedTarget) {
        drawCornerBrackets(
          ctx,
          rightX - 2,
          stripY - 2,
          columnWidth + 4,
          stripHeight + 4,
          linkedCorrect ? "rgba(140, 245, 207, 0.65)" : "rgba(255, 118, 88, 0.65)",
          6,
        );
      }
      ctx.font = '7px "EchoSans", "Cascadia Code", "SFMono-Regular", monospace';
      ctx.textAlign = "right";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "rgba(229, 237, 217, 0.84)";
      ctx.fillText(reference.id, rightX + columnWidth, stripY - 5);
      ctx.fillStyle = "rgba(185, 192, 181, 0.44)";
      ctx.textAlign = "left";
      const contourArrow = profile.id === 0 ? "↑" : profile.id === 1 ? "↓" : "◌";
      ctx.fillText(`${contourArrow} ${profile.attack}`, rightX, stripY - 5);
    });

    TARGETS.forEach((target, targetIndex) => {
      const entry = state.locked.get(target.id);
      const targetCenterY = top + rowHeight * (targetIndex + 0.5);
      if (!entry) return;
      const referenceIndex = REFERENCES.findIndex(
        (reference) => reference.id === entry.referenceId,
      );
      if (referenceIndex < 0) return;
      const referenceCenterY = top + rowHeight * (referenceIndex + 0.5);
      drawPairingLine(
        ctx,
        leftX + columnWidth + 5,
        targetCenterY,
        rightX - 5,
        referenceCenterY,
        entry.correct ? "#8cf5cf" : "#ff7658",
        targetIndex,
      );
    });

    if (state.selectedTargetId) {
      const targetIndex = TARGETS.findIndex((target) => target.id === state.selectedTargetId);
      const y = top + rowHeight * (targetIndex + 0.5);
      const start = leftX + columnWidth + 5;
      ctx.strokeStyle = "rgba(216, 255, 99, 0.55)";
      ctx.setLineDash([3, 5]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(start, y);
      ctx.lineTo(start + gap * 0.42, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#d8ff63";
      ctx.beginPath();
      ctx.arc(start, y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawLegend(ctx, width, height) {
    ctx.save();
    ctx.font = '6px "EchoSans", "Cascadia Code", "SFMono-Regular", monospace';
    ctx.textBaseline = "middle";
    const y = height - 15;
    const items = [
      ["#8cf5cf", "MATCHED"],
      ["#ff7658", "MISREAD"],
      ["rgba(229, 237, 217, 0.35)", "OPEN"],
    ];
    let x = 18;
    items.forEach(([color, label]) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x + 2, y, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(185, 192, 181, 0.7)";
      ctx.fillText(label, x + 8, y + 0.5);
      x += ctx.measureText(label).width + 28;
    });
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(185, 192, 181, 0.5)";
    ctx.fillText(
      `${state.locked.size}/3 CLOSED · ${state.errors}/2 ERRORS`,
      width - 18,
      y + 0.5,
    );
    ctx.restore();
  }

  function drawCanvas() {
    if (!dom.canvas) return;
    resizeCanvas();
    const ctx = dom.canvas.getContext("2d");
    const { width, height, dpr } = canvasState;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    drawGrid(ctx, width, height);
    drawAmbient(ctx, width, height);
    drawMatchMap(ctx, width, height);
    drawLegend(ctx, width, height);
  }

  function requestCanvasDraw() {
    if (canvasState.frame) return;
    canvasState.frame = requestAnimationFrame(animateCanvas);
  }

  function animateCanvas(timestamp) {
    canvasState.frame = null;
    if (!canvasState.lastFrame || timestamp - canvasState.lastFrame > 52) {
      drawCanvas();
      canvasState.lastFrame = timestamp;
    }
    if (state.playback) requestCanvasDraw();
  }

  async function initialize() {
    dom.seedLabel.textContent = formatSeed(SEED);
    renderCards();
    updateHud();
    bindEvents();

    if ("ResizeObserver" in window) {
      const observer = new ResizeObserver(() => drawCanvas());
      observer.observe(dom.canvasFrame);
    }
    window.addEventListener("resize", drawCanvas, { passive: true });
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => drawCanvas()).catch(() => {});
    }

    try {
      setEngineStatus("working", "SYNTHESIZING");
      dom.canvasLoading.querySelector("p").innerHTML =
        "正在合成声场 <small>OFFLINE AUDIO / FIXED SEED</small>";
      const results = await Promise.all([
        renderAmbient(),
        ...PROFILES.map((profile) => renderReference(profile)),
      ]);
      audio.ambientBuffer = results[0];
      REFERENCES.forEach((reference, index) => {
        audio.referenceBuffers.set(reference.id, results[index + 1]);
      });

      dom.canvasLoading.querySelector("p").innerHTML =
        "正在解析频谱 <small>FFT 1024 / SEEDED INTERFERENCE</small>";
      await new Promise((resolve) => window.setTimeout(resolve, 30));
      analyzeRenderedAudio();
      state.ready = true;
      setEngineStatus("ready", "SYNTH READY");
      dom.canvasLoading.classList.add("is-hidden");
      dom.ambientPlay.disabled = false;
      renderCards();
      updateHud();
      drawCanvas();
    } catch (error) {
      console.error(error);
      setEngineStatus("muted", "SYNTH FAILED");
      dom.canvasLoading.querySelector("p").innerHTML =
        "合成失败 <small>当前浏览器不支持 OfflineAudioContext</small>";
      showToast("音频合成失败，请使用支持 Web Audio 的现代浏览器。", "error");
    }
  }

  window.echoIndex = {
    seed: SEED,
    getSnapshot() {
      const correctCount = [...state.locked.values()].filter((entry) => entry.correct).length;
      return {
        ready: state.ready,
        selectedTargetId: state.selectedTargetId,
        locked: [...state.locked.entries()].map(([targetId, entry]) => ({
          targetId,
          referenceId: entry.referenceId,
          correct: entry.correct,
        })),
        errors: state.errors,
        correctCount,
        ended: state.ended,
        resultKind: state.resultKind,
        playback: state.playback
          ? { kind: state.playback.kind, id: state.playback.id }
          : null,
        seed: formatSeed(SEED),
      };
    },
    getCorrectReference(targetId) {
      return correctReferenceFor(targetId)?.id || null;
    },
    choosePair(targetId, referenceId) {
      if (!state.ready || state.ended) return false;
      state.selectedTargetId = targetId;
      return lockReference(referenceId);
    },
    getDiagnostics() {
      const summarize = (buffer) => {
        if (!buffer) return null;
        const data = buffer.getChannelData(0);
        let peak = 0;
        let energy = 0;
        for (let index = 0; index < data.length; index += 1) {
          const sample = data[index];
          peak = Math.max(peak, Math.abs(sample));
          energy += sample * sample;
        }
        return {
          duration: Number(buffer.duration.toFixed(3)),
          sampleRate: buffer.sampleRate,
          peak: Number(peak.toFixed(4)),
          rms: Number(Math.sqrt(energy / data.length).toFixed(4)),
        };
      };
      return {
        seed: formatSeed(SEED),
        interference: interference.targets,
        ambient: summarize(audio.ambientBuffer),
        references: Object.fromEntries(
          [...audio.referenceBuffers.entries()].map(([id, buffer]) => [id, summarize(buffer)]),
        ),
      };
    },
    reset: restartGame,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
