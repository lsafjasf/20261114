/* Web Audio 合成：滚筒运转声、裁切声、报警声。无外部音频资源。 */
var PressAudio = (function () {
  "use strict";
  var ctx = null;
  var rollerNodes = null;

  function ensureCtx() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function noiseBuffer(c, seconds) {
    var buf = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /* 滚筒：低频振荡 + 滤波噪声循环 */
  function startRoller() {
    var c = ensureCtx();
    if (rollerNodes) return;
    var hum = c.createOscillator();
    hum.type = "sawtooth";
    hum.frequency.value = 55;
    var humGain = c.createGain();
    humGain.gain.value = 0.05;
    var noise = c.createBufferSource();
    noise.buffer = noiseBuffer(c, 1.5);
    noise.loop = true;
    var bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 320;
    bp.Q.value = 1.2;
    var noiseGain = c.createGain();
    noiseGain.gain.value = 0.08;
    var lfo = c.createOscillator();
    lfo.frequency.value = 2.2;
    var lfoGain = c.createGain();
    lfoGain.gain.value = 0.03;
    lfo.connect(lfoGain).connect(noiseGain.gain);
    hum.connect(humGain).connect(c.destination);
    noise.connect(bp).connect(noiseGain).connect(c.destination);
    hum.start();
    noise.start();
    lfo.start();
    rollerNodes = { hum: hum, noise: noise, lfo: lfo };
  }

  function stopRoller() {
    if (!rollerNodes) return;
    var t = ctx.currentTime;
    try {
      rollerNodes.hum.stop(t + 0.15);
      rollerNodes.noise.stop(t + 0.15);
      rollerNodes.lfo.stop(t + 0.15);
    } catch (e) { /* already stopped */ }
    rollerNodes = null;
  }

  /* 裁切：短促高通噪声 + 低频"咔" */
  function cut() {
    var c = ensureCtx();
    var t = c.currentTime;
    var n = c.createBufferSource();
    n.buffer = noiseBuffer(c, 0.08);
    var hp = c.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1800;
    var g = c.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    n.connect(hp).connect(g).connect(c.destination);
    n.start(t);
    var o = c.createOscillator();
    o.type = "square";
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.07);
    var og = c.createGain();
    og.gain.setValueAtTime(0.2, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(og).connect(c.destination);
    o.start(t);
    o.stop(t + 0.1);
  }

  /* 起皱报警：两声短促蜂鸣 */
  function alarm() {
    var c = ensureCtx();
    var t = c.currentTime;
    for (var i = 0; i < 2; i++) {
      var o = c.createOscillator();
      o.type = "square";
      o.frequency.value = 880;
      var g = c.createGain();
      var t0 = t + i * 0.16;
      g.gain.setValueAtTime(0.12, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);
      o.connect(g).connect(c.destination);
      o.start(t0);
      o.stop(t0 + 0.12);
    }
  }

  return { startRoller: startRoller, stopRoller: stopRoller, cut: cut, alarm: alarm };
})();
