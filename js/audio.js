// Web Audio：风噪声 + 帆面抖动 + 事件音效
var SailAudio = (function () {
  'use strict';
  var ctx = null;
  var master, windGain, windFilter, flapGain, flapFilter, flapLfo, flapLfoGain;
  var muted = false;
  var started = false;

  function makeNoiseBuffer() {
    var len = ctx.sampleRate * 2;
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    var last = 0;
    for (var i = 0; i < len; i++) {
      // 粉红化白噪声，更接近风声
      var white = Math.random() * 2 - 1;
      last = last * 0.94 + white * 0.06;
      d[i] = last * 6;
    }
    return buf;
  }

  function start() {
    if (started) return;
    started = true;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);

    var noiseBuf = makeNoiseBuffer();

    // 风声层：噪声 -> 带通，截止频率随风力
    var windSrc = ctx.createBufferSource();
    windSrc.buffer = noiseBuf; windSrc.loop = true;
    windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 400;
    windFilter.Q.value = 0.6;
    windGain = ctx.createGain();
    windGain.gain.value = 0;
    windSrc.connect(windFilter).connect(windGain).connect(master);
    windSrc.start();

    // 帆抖动层：噪声 -> 高通，LFO 调制增益模拟拍打
    var flapSrc = ctx.createBufferSource();
    flapSrc.buffer = noiseBuf; flapSrc.loop = true;
    flapSrc.playbackRate.value = 1.7;
    flapFilter = ctx.createBiquadFilter();
    flapFilter.type = 'highpass';
    flapFilter.frequency.value = 900;
    flapGain = ctx.createGain();
    flapGain.gain.value = 0;
    flapLfo = ctx.createOscillator();
    flapLfo.type = 'square';
    flapLfo.frequency.value = 8;
    flapLfoGain = ctx.createGain();
    flapLfoGain.gain.value = 0;
    flapLfo.connect(flapLfoGain).connect(flapGain.gain);
    flapSrc.connect(flapFilter).connect(flapGain).connect(master);
    flapSrc.start();
    flapLfo.start();
  }

  // 每帧更新：windSpeed 视风速 m/s，luff 帆抖动 0..1，heel 横倾 rad
  function update(windSpeed, luff, heel) {
    if (!started || !ctx) return;
    var t = ctx.currentTime;
    var w = Math.min(windSpeed / 16, 1.4);
    windFilter.frequency.setTargetAtTime(220 + w * 900, t, 0.15);
    windFilter.Q.setTargetAtTime(0.5 + w * 1.6, t, 0.2);
    windGain.gain.setTargetAtTime(muted ? 0 : w * w * 0.5, t, 0.12);
    // 帆抖动：luff 越大拍打越快越响，音色更糙
    var f = Math.min(luff, 1);
    flapLfo.frequency.setTargetAtTime(4 + f * 11, t, 0.1);
    flapFilter.frequency.setTargetAtTime(700 + f * 1600, t, 0.1);
    var flapLevel = muted ? 0 : f * 0.4;
    flapGain.gain.setTargetAtTime(flapLevel * 0.5, t, 0.08);
    flapLfoGain.gain.setTargetAtTime(flapLevel * 0.5, t, 0.08);
  }

  function blip(freq, dur, type, vol) {
    if (!started || muted) return;
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol || 0.25, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g).connect(master);
    o.start();
    o.stop(ctx.currentTime + dur);
  }

  function event(name) {
    if (!started) return;
    if (name === 'buoy') { blip(660, 0.18, 'sine', 0.3); setTimeout(function () { blip(880, 0.3, 'sine', 0.3); }, 140); }
    else if (name === 'rock') { blip(90, 0.4, 'sawtooth', 0.5); }
    else if (name === 'capsize' || name === 'sink') { blip(140, 1.2, 'sawtooth', 0.4); blip(70, 1.6, 'triangle', 0.4); }
    else if (name === 'finish') { [523, 659, 784, 1047].forEach(function (f, i) { setTimeout(function () { blip(f, 0.35, 'sine', 0.3); }, i * 160); }); }
  }

  function toggleMute() { muted = !muted; return muted; }
  function resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }

  return { start: start, update: update, event: event, toggleMute: toggleMute, resume: resume };
})();
