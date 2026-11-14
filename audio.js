(function (root) {
  'use strict';

  function PumpAudio() {
    const ctxState = { ctx: null, master: null, muted: false };
    const voices = { pumps: [], flow: null, flowGain: null };

    function makeNoiseBuffer(ctx) {
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      return buf;
    }

    function ensure() {
      if (ctxState.ctx) return ctxState.ctx;
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC();
      const master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);
      ctxState.ctx = ctx;
      ctxState.master = master;

      const noise = ctx.createBufferSource();
      noise.buffer = makeNoiseBuffer(ctx);
      noise.loop = true;
      const flowFilter = ctx.createBiquadFilter();
      flowFilter.type = 'bandpass';
      flowFilter.frequency.value = 700;
      flowFilter.Q.value = 0.7;
      const flowGain = ctx.createGain();
      flowGain.gain.value = 0;
      noise.connect(flowFilter).connect(flowGain).connect(master);
      noise.start();
      voices.flow = flowFilter;
      voices.flowGain = flowGain;

      for (let i = 0; i < 2; i++) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = 55;
        const sub = ctx.createOscillator();
        sub.type = 'sine';
        sub.frequency.value = 36;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 320;
        osc.connect(lp);
        sub.connect(lp);
        lp.connect(gain).connect(master);
        osc.start();
        sub.start();
        voices.pumps.push({ osc, sub, gain, lp, base: 55 + i * 4 });
      }
      return ctx;
    }

    this.unlock = function () {
      const ctx = ensure();
      if (ctx.state === 'suspended') ctx.resume();
    };

    this.setMuted = function (m) {
      ctxState.muted = m;
      if (ctxState.master) ctxState.master.gain.value = m ? 0 : 0.55;
      return m;
    };

    this.update = function (sim) {
      if (!ctxState.ctx || ctxState.muted) {
        if (ctxState.ctx && ctxState.muted) {
          voices.flowGain.gain.value = 0;
          voices.pumps.forEach((v) => { v.gain.gain.value = 0; });
        }
        return;
      }
      const ctx = ctxState.ctx;
      const t = ctx.currentTime;
      const avgPump = (sim.pools[0].pump + sim.pools[1].pump) / 2;
      voices.pumps.forEach((v, i) => {
        const spd = sim.pools[i].pump;
        const freq = v.base * (0.7 + spd * 0.9);
        v.osc.frequency.setTargetAtTime(freq, t, 0.1);
        v.sub.frequency.setTargetAtTime(freq * 0.66, t, 0.1);
        v.gain.gain.setTargetAtTime(0.02 + spd * 0.07, t, 0.15);
        v.lp.frequency.setTargetAtTime(220 + spd * 360, t, 0.2);
      });
      const flowLevel = Math.min(1, sim.flowTotalIn * 3 + sim.flowTotalDrain * 2);
      voices.flow.frequency.setTargetAtTime(500 + avgPump * 420, t, 0.2);
      voices.flowGain.gain.setTargetAtTime(flowLevel * 0.05, t, 0.2);
    };

    function envelopeBlip(freq, dur, type, vol) {
      const ctx = ensure();
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.setValueAtTime(vol, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      osc.connect(g).connect(ctxState.master);
      osc.start();
      osc.stop(ctx.currentTime + dur + 0.05);
    }

    this.hammer = function (severe) {
      if (ctxState.muted) return;
      const ctx = ensure();
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = makeNoiseBuffer(ctx);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(severe ? 220 : 340, t);
      bp.frequency.exponentialRampToValueAtTime(60, t + 0.5);
      bp.Q.value = 1.4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(severe ? 0.9 : 0.55, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + (severe ? 0.8 : 0.45));
      src.connect(bp).connect(g).connect(ctxState.master);
      src.start(t);
      src.stop(t + 1);
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(120, t);
      osc.frequency.exponentialRampToValueAtTime(38, t + 0.4);
      const og = ctx.createGain();
      og.gain.setValueAtTime(severe ? 0.7 : 0.4, t);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      osc.connect(og).connect(ctxState.master);
      osc.start(t);
      osc.stop(t + 0.55);
    };

    this.alarm = function (critical) {
      if (ctxState.muted) return;
      envelopeBlip(critical ? 880 : 660, 0.16, 'square', critical ? 0.16 : 0.1);
      setTimeout(() => envelopeBlip(critical ? 880 : 660, 0.16, 'square', critical ? 0.16 : 0.1), 190);
    };

    this.cavitation = function () {
      if (ctxState.muted) return;
      const ctx = ensure();
      const src = ctx.createBufferSource();
      src.buffer = makeNoiseBuffer(ctx);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 2600;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.18, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      src.connect(hp).connect(g).connect(ctxState.master);
      src.start();
      src.stop(ctx.currentTime + 0.4);
    };

    this.jingle = function (won) {
      const notes = won ? [523, 659, 784, 1047] : [392, 311, 233, 175];
      notes.forEach((f, i) => setTimeout(() => {
        if (!ctxState.muted) envelopeBlip(f, 0.45, 'triangle', 0.2);
      }, i * 220));
    };

    this.click = function () { envelopeBlip(440, 0.06, 'square', 0.05); };
  }

  root.PumpAudio = PumpAudio;
})(window);
