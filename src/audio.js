/* Web Audio：车流环境声、临界警报、提示音 */
(function () {
  'use strict';
  var ctx = null;
  var master = null;
  var rumbleGain = null;
  var muted = false;
  var lastAlarm = 0;
  var lastSwitchPhase = -1;

  function ensure() {
    if (ctx) return true;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { return false; }
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);
    var len = ctx.sampleRate * 2;
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buf.getChannelData(0);
    var last = 0;
    for (var i = 0; i < len; i++) {
      var white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    var src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 240;
    rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0;
    src.connect(lp).connect(rumbleGain).connect(master);
    src.start();
    return true;
  }

  function beep(freq, dur, type, gain, when) {
    if (!ctx) return;
    var t = ctx.currentTime + (when || 0);
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain || 0.08, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  window.AudioEngine = {
    unlock: function () {
      if (ensure() && ctx.state === 'suspended') ctx.resume();
    },
    start: function () {
      this.unlock();
      if (rumbleGain) rumbleGain.gain.setTargetAtTime(0.05, ctx.currentTime, 0.8);
    },
    duck: function () {
      if (rumbleGain) rumbleGain.gain.setTargetAtTime(0.012, ctx.currentTime, 0.4);
    },
    stop: function () {
      if (rumbleGain) rumbleGain.gain.setTargetAtTime(0, ctx.currentTime, 0.5);
    },
    click: function () {
      this.unlock();
      beep(660, 0.08, 'triangle', 0.05);
    },
    win: function () {
      this.unlock();
      beep(523, 0.25, 'sine', 0.09, 0);
      beep(659, 0.25, 'sine', 0.09, 0.18);
      beep(784, 0.45, 'sine', 0.1, 0.36);
      this.stop();
    },
    lose: function () {
      this.unlock();
      beep(220, 0.35, 'sawtooth', 0.07, 0);
      beep(155, 0.6, 'sawtooth', 0.07, 0.3);
      this.stop();
    },
    toggleMute: function () {
      muted = !muted;
      if (ensure()) master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.05);
      return muted;
    },
    update: function (state) {
      if (!ctx || !state.sim || !state.running) return;
      var sim = state.sim;
      if (rumbleGain) {
        var target = 0.03 + Math.min(0.06, sim.passed / Math.max(1, sim.t) * 0.05);
        rumbleGain.gain.setTargetAtTime(target, ctx.currentTime, 0.6);
      }
      if (sim.switches !== lastSwitchPhase) {
        lastSwitchPhase = sim.switches;
        beep(340, 0.06, 'triangle', 0.03);
      }
      var maxQ = sim.maxQueue();
      var now = ctx.currentTime;
      if (maxQ >= 13 && now - lastAlarm > 0.9) {
        lastAlarm = now;
        beep(880, 0.12, 'square', 0.05);
        beep(880, 0.12, 'square', 0.05, 0.2);
      }
    }
  };
})();
