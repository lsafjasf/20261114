// WebAudio 合成：引擎声随负载/转速变化，风噪随风速变化，事件用短音效反馈
export function createAudioEngine() {
  let ctx = null;
  let engineOsc = null;
  let engineOsc2 = null;
  let engineGain = null;
  let windSource = null;
  let windFilter = null;
  let windGain = null;
  let started = false;

  function ensureContext() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    return ctx;
  }

  return {
    async start() {
      const ac = ensureContext();
      if (!ac || started) return;
      if (ac.state === 'suspended') await ac.resume();
      started = true;

      engineGain = ac.createGain();
      engineGain.gain.value = 0.05;
      engineOsc = ac.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 55;
      engineOsc2 = ac.createOscillator();
      engineOsc2.type = 'triangle';
      engineOsc2.frequency.value = 110;
      const engineFilter = ac.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 420;
      engineOsc.connect(engineFilter);
      engineOsc2.connect(engineFilter);
      engineFilter.connect(engineGain);
      engineGain.connect(ac.destination);
      engineOsc.start();
      engineOsc2.start();

      // 风噪：白噪声经过带通滤波，风速越大增益和频率越高
      const bufferSize = 2 * ac.sampleRate;
      const noiseBuffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
      windSource = ac.createBufferSource();
      windSource.buffer = noiseBuffer;
      windSource.loop = true;
      windFilter = ac.createBiquadFilter();
      windFilter.type = 'bandpass';
      windFilter.frequency.value = 480;
      windFilter.Q.value = 0.6;
      windGain = ac.createGain();
      windGain.gain.value = 0.02;
      windSource.connect(windFilter);
      windFilter.connect(windGain);
      windGain.connect(ac.destination);
      windSource.start();
    },

    update(state) {
      if (!ctx || !started) return;
      const speed = Math.hypot(state.plow.vx, state.plow.vy);
      const loadFactor = 1 + state.plow.load * 0.12;
      const rpm = 46 + speed * 0.22 * loadFactor;
      engineOsc.frequency.setTargetAtTime(rpm, ctx.currentTime, 0.08);
      engineOsc2.frequency.setTargetAtTime(rpm * 2.02, ctx.currentTime, 0.08);
      engineGain.gain.setTargetAtTime(
        0.045 + state.plow.load * 0.012 + (state.plow.braking ? 0.015 : 0),
        ctx.currentTime,
        0.1
      );
      const w = Math.max(0, state.wind);
      windGain.gain.setTargetAtTime(0.012 + w * 0.0035, ctx.currentTime, 0.15);
      windFilter.frequency.setTargetAtTime(380 + w * 42, ctx.currentTime, 0.2);
    },

    crash() {
      if (!ctx || !started) return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(160, t);
      osc.frequency.exponentialRampToValueAtTime(42, t + 0.25);
      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.32);
    },

    rescue() {
      if (!ctx || !started) return;
      const t = ctx.currentTime;
      [523, 659, 784].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t + i * 0.09);
        gain.gain.exponentialRampToValueAtTime(0.12, t + i * 0.09 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.09 + 0.22);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t + i * 0.09);
        osc.stop(t + i * 0.09 + 0.25);
      });
    },
  };
}
