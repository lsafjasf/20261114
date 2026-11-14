/* Procedural WebAudio: pump hum and water noise follow total flow,
 * valve/pump surges trigger a pressure thump, alarms beep while active. */
(function () {
  if (typeof window === 'undefined') return;
  window.AquariumAudio = {
    ctx: null, muted: false,
    init: function () {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.master.connect(ctx.destination);

      // pump hum
      this.hum = ctx.createOscillator();
      this.hum.type = 'sawtooth';
      this.hum.frequency.value = 60;
      var humFilter = ctx.createBiquadFilter();
      humFilter.type = 'lowpass'; humFilter.frequency.value = 240;
      this.humGain = ctx.createGain(); this.humGain.gain.value = 0;
      this.hum.connect(humFilter).connect(this.humGain).connect(this.master);
      this.hum.start();

      // looping water noise
      var len = ctx.sampleRate * 2;
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var data = buf.getChannelData(0);
      for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noise = ctx.createBufferSource();
      this.noise.buffer = buf; this.noise.loop = true;
      var bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.7;
      this.noiseGain = ctx.createGain(); this.noiseGain.gain.value = 0;
      this.noise.connect(bp).connect(this.noiseGain).connect(this.master);
      this.noise.start();

      // bubble oscillator (sump tank aeration)
      this.bubble = ctx.createOscillator();
      this.bubble.type = 'sine'; this.bubble.frequency.value = 380;
      this.bubbleGain = ctx.createGain(); this.bubbleGain.gain.value = 0;
      var lfo = ctx.createOscillator();
      var lfoGain = ctx.createGain();
      lfo.frequency.value = 6; lfoGain.gain.value = 0.03;
      lfo.connect(lfoGain).connect(this.bubbleGain.gain);
      this.bubble.connect(this.bubbleGain).connect(this.master);
      this.bubble.start(); lfo.start();

      this.lastSurge = 0;
      this.lastBeep = 0;
    },
    thump: function (strength) {
      if (!this.ctx) return;
      var ctx = this.ctx, t = ctx.currentTime;
      var osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(180, t);
      osc.frequency.exponentialRampToValueAtTime(45, t + 0.25);
      var g = ctx.createGain();
      g.gain.setValueAtTime(Math.min(0.5, 0.15 + strength * 0.15), t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      osc.connect(g).connect(this.master);
      osc.start(t); osc.stop(t + 0.32);
    },
    beep: function () {
      if (!this.ctx) return;
      var ctx = this.ctx, t = ctx.currentTime;
      var osc = ctx.createOscillator();
      osc.type = 'square'; osc.frequency.value = 880;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      osc.connect(g).connect(this.master);
      osc.start(t); osc.stop(t + 0.14);
    },
    update: function (s) {
      if (!this.ctx) return;
      var ctx = this.ctx, t = ctx.currentTime;
      var flow = s.flow.bc;
      this.hum.frequency.setTargetAtTime(55 + flow * 55, t, 0.1);
      this.humGain.gain.setTargetAtTime(0.02 + flow * 0.05, t, 0.15);
      this.noiseGain.gain.setTargetAtTime(0.01 + flow * 0.10, t, 0.15);
      this.bubbleGain.gain.setTargetAtTime(0.012 * (0.3 + s.flow.bc), t, 0.3);
      if (s.surge > 1.2 && t - this.lastSurge > 0.4) {
        this.thump(s.surge);
        this.lastSurge = t;
      }
      var alarm = s.surgeAlarm > 0 || s.pressureAlarmOn || s.sandActive;
      if (alarm && t - this.lastBeep > 0.9) {
        this.beep();
        this.lastBeep = t;
      }
    },
    setMuted: function (m) {
      this.muted = m;
      if (this.master) this.master.gain.value = m ? 0 : 0.9;
    }
  };
})();
