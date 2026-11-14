import { MATERIAL_BY_ID, seedToUint } from "./engine.js";

const AudioContextClass = () =>
  globalThis.AudioContext || globalThis.webkitAudioContext;

export class EchoSynth {
  constructor({ onState = () => {} } = {}) {
    this.context = null;
    this.master = null;
    this.analyser = null;
    this.voice = null;
    this.irCache = new Map();
    this.onState = onState;
    this.liveData = null;
  }

  async unlock() {
    if (!AudioContextClass()) {
      throw new Error("当前浏览器不支持 Web Audio");
    }
    if (!this.context) {
      this.context = new AudioContextClass();
      this.master = this.context.createGain();
      this.master.gain.value = 0.8;
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.66;
      this.master.connect(this.analyser);
      this.analyser.connect(this.context.destination);
    }
    if (this.context.state === "suspended") await this.context.resume();
    return this.context;
  }

  async preview(event, doorOpen = false) {
    const context = await this.unlock();
    const material = MATERIAL_BY_ID[event.materialId];
    const now = context.currentTime + 0.045;
    this.stop();
    const voice = this.#buildVoice(context, event, material, doorOpen, now);
    this.voice = voice;
    this.onState({
      playing: true,
      eventId: event.id,
      startedAt: performance.now(),
      duration: voice.duration,
    });
    voice.endTimer = setTimeout(() => {
      if (this.voice !== voice) return;
      this.voice = null;
      this.onState({ playing: false });
    }, voice.duration * 1000 + 60);
    return voice.duration;
  }

  async doorCreak() {
    const context = await this.unlock();
    const now = context.currentTime + 0.02;
    const duration = 0.58;
    const output = context.createGain();
    output.gain.setValueAtTime(0.0001, now);
    output.gain.exponentialRampToValueAtTime(0.16, now + 0.03);
    output.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    output.connect(this.master);

    const scrape = context.createBufferSource();
    scrape.buffer = this.#noiseBuffer(context, seedToUint(`${Date.now()}:creak`), 0.7);
    const scrapeFilter = context.createBiquadFilter();
    scrapeFilter.type = "bandpass";
    scrapeFilter.Q.value = 8;
    scrapeFilter.frequency.setValueAtTime(620, now);
    scrapeFilter.frequency.exponentialRampToValueAtTime(180, now + duration);
    scrape.connect(scrapeFilter);
    scrapeFilter.connect(output);
    scrape.start(now);

    const hinge = context.createOscillator();
    hinge.type = "triangle";
    hinge.frequency.setValueAtTime(96, now);
    hinge.frequency.exponentialRampToValueAtTime(48, now + duration);
    hinge.connect(output);
    hinge.start(now);
    hinge.stop(now + duration);
    scrape.stop(now + duration);
  }

  stop() {
    if (!this.voice) return;
    try {
      this.voice.nodes.forEach((node) => node.stop?.());
      this.voice.gain.disconnect();
    } catch {
      // Nodes may already have ended.
    }
    clearTimeout(this.voice.endTimer);
    this.voice = null;
    this.onState({ playing: false });
  }

  liveWaveform(columns = 72) {
    if (!this.analyser) return null;
    if (!this.liveData) this.liveData = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(this.liveData);
    const values = [];
    const bucket = Math.floor(this.liveData.length / columns);
    for (let index = 0; index < columns; index += 1) {
      let peak = 0;
      const start = index * bucket;
      for (let cursor = 0; cursor < bucket; cursor += 2) {
        peak = Math.max(peak, Math.abs(this.liveData[start + cursor] - 128));
      }
      values.push(peak / 128);
    }
    return values;
  }

  #buildVoice(context, event, material, doorOpen, startAt) {
    const duration = 0.62 + event.wallDistance * 0.045 + (doorOpen ? 0.26 : 0);
    const gain = context.createGain();
    const panner = context.createStereoPanner();
    const dry = context.createGain();
    const wet = context.createGain();
    const convolver = context.createConvolver();
    const nodes = [];

    gain.gain.value = 1;
    panner.pan.value = event.pan;
    dry.gain.value = 0.86;
    wet.gain.value = 0.2 + material.ring * 0.18 + (doorOpen ? 0.12 : 0);
    convolver.buffer = this.#impulse(context, event, material, doorOpen);

    gain.connect(dry);
    gain.connect(wet);
    dry.connect(panner);
    wet.connect(convolver);
    convolver.connect(panner);
    panner.connect(this.master);

    const thump = context.createOscillator();
    thump.type = "sine";
    thump.frequency.setValueAtTime(material.lowHz * (1.08 + (event.lowFreq / 100) * 0.12), startAt);
    thump.frequency.exponentialRampToValueAtTime(material.lowHz * 0.72, startAt + 0.16);
    const thumpGain = context.createGain();
    thumpGain.gain.setValueAtTime(0.0001, startAt);
    thumpGain.gain.exponentialRampToValueAtTime(0.2 + event.lowFreq * 0.0024, startAt + 0.006);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.17 + material.body);
    thump.connect(thumpGain);
    thumpGain.connect(gain);
    thump.start(startAt);
    thump.stop(startAt + 0.32);
    nodes.push(thump);

    const noise = context.createBufferSource();
    noise.buffer = this.#noiseBuffer(
      context,
      event.textureSeed,
      0.38 + material.body,
    );
    const noiseFilter = context.createBiquadFilter();
    noiseFilter.type = material.damp > 0.82 ? "lowpass" : "bandpass";
    noiseFilter.Q.value = 0.55 + material.texture * 1.7;
    noiseFilter.frequency.value = material.grainHz;
    const noiseGain = context.createGain();
    noiseGain.gain.setValueAtTime(0.0001, startAt);
    noiseGain.gain.exponentialRampToValueAtTime(
      0.11 + material.texture * 0.16,
      startAt + 0.008,
    );
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.22 + material.body * 1.6);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(gain);
    noise.start(startAt);
    noise.stop(startAt + noise.buffer.duration);
    nodes.push(noise);

    if (material.ring > 0.06) {
      const ring = context.createOscillator();
      ring.type = "triangle";
      ring.frequency.value = material.grainHz * (0.72 + material.ring * 0.16);
      const ringGain = context.createGain();
      ringGain.gain.setValueAtTime(0.0001, startAt + 0.006);
      ringGain.gain.exponentialRampToValueAtTime(material.ring * 0.11, startAt + 0.012);
      ringGain.gain.exponentialRampToValueAtTime(
        0.0001,
        startAt + 0.2 + material.ring * 0.65,
      );
      ring.connect(ringGain);
      ringGain.connect(gain);
      ring.start(startAt + 0.006);
      ring.stop(startAt + 0.9);
      nodes.push(ring);
    }

    if (material.id === "wood" || material.id === "steel") {
      const bodyTone = context.createOscillator();
      bodyTone.type = "sine";
      bodyTone.frequency.value = material.id === "wood" ? 172 : 724;
      const bodyGain = context.createGain();
      bodyGain.gain.setValueAtTime(0.0001, startAt + 0.002);
      bodyGain.gain.exponentialRampToValueAtTime(
        material.id === "wood" ? 0.08 : 0.055,
        startAt + 0.02,
      );
      bodyGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.38);
      bodyTone.connect(bodyGain);
      bodyGain.connect(gain);
      bodyTone.start(startAt + 0.002);
      bodyTone.stop(startAt + 0.42);
      nodes.push(bodyTone);
    }

    return { gain, panner, nodes, duration, eventId: event.id };
  }

  #impulse(context, event, material, doorOpen) {
    const cacheKey = `${event.id}:${event.textureSeed}:${doorOpen ? "open" : "shut"}`;
    const cached = this.irCache.get(cacheKey);
    if (cached) return cached;

    const sampleRate = context.sampleRate;
    const echoNorm = Math.max(0, Math.min(1, (event.echoMs - 180) / 700));
    const tail = 0.17 + echoNorm * 0.58 + material.damp * 0.08 + (doorOpen ? 0.24 : 0);
    const length = Math.max(1, Math.floor(sampleRate * tail));
    const buffer = context.createBuffer(2, length, sampleRate);
    const random = mulberryLocal(event.textureSeed ^ (doorOpen ? 0x9e3779b9 : 0));
    const wallDelay = Math.min(length - 2, Math.floor(event.wallDistance / 343 * sampleRate));
    const doorDelay = Math.min(length - 2, Math.floor((0.11 + echoNorm * 0.09) * sampleRate));
    const damping = 1.7 + material.damp * 3.2;

    for (let channel = 0; channel < 2; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let index = 0; index < length; index += 1) {
        const progress = index / length;
        const diffuse = (random() * 2 - 1) * Math.pow(1 - progress, damping);
        const early =
          index === wallDelay + channel * 3
            ? (1 - material.damp) * 0.5
            : index === wallDelay * 2 + channel * 5
              ? (1 - material.damp) * 0.2
              : 0;
        const coupled =
          doorOpen && index === doorDelay + channel * 7
            ? 0.28 * (1 - progress)
            : doorOpen && index === doorDelay * 2 + channel * 11
              ? 0.16 * (1 - progress)
              : 0;
        data[index] = diffuse * 0.2 + early + coupled;
      }
    }

    if (this.irCache.size > 24) {
      const oldest = this.irCache.keys().next().value;
      this.irCache.delete(oldest);
    }
    this.irCache.set(cacheKey, buffer);
    return buffer;
  }

  #noiseBuffer(context, seed, seconds) {
    const key = `${seed}:${seconds}`;
    this.noiseCache ||= new Map();
    const cached = this.noiseCache.get(key);
    if (cached) return cached;
    const length = Math.max(1, Math.floor(context.sampleRate * seconds));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    const random = mulberryLocal(seed);
    let smoothed = 0;
    for (let index = 0; index < length; index += 1) {
      const raw = random() * 2 - 1;
      smoothed = smoothed * 0.32 + raw * 0.68;
      data[index] = smoothed;
    }
    if (this.noiseCache.size > 28) {
      this.noiseCache.delete(this.noiseCache.keys().next().value);
    }
    this.noiseCache.set(key, buffer);
    return buffer;
  }
}

export function synthesisProfile(material) {
  return {
    lowHz: material.lowHz,
    grainHz: material.grainHz,
    body: material.body,
    ring: material.ring,
    texture: material.texture,
    damp: material.damp,
  };
}

export function impulseProfile(event, material, doorOpen = false) {
  const echoNorm = Math.max(0, Math.min(1, (event.echoMs - 180) / 700));
  return {
    tail: Math.round(
      (0.17 + echoNorm * 0.58 + material.damp * 0.08 + (doorOpen ? 0.24 : 0)) * 1000,
    ),
    wallDelayMs: Math.round((event.wallDistance / 343) * 1000),
    coupling: doorOpen ? "open" : "sealed",
  };
}

function mulberryLocal(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
