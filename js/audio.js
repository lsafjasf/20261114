/* Web Audio 合成引擎：载波音色、共享带通滤波、白噪声与干扰 */
(function (global) {
  "use strict";
  var NF = global.NF;

  function AudioEngine() {
    this.ctx = null;
    this.voices = {};
    this.analyser = null;
    this._noiseGain = null;
    this._sigFilter = null;
    this._noiseFilter = null;
    this._master = null;
    this._crackle = 0;
  }

  AudioEngine.prototype.init = function () {
    if (this.ctx) { return; }
    var Ctx = global.AudioContext || global.webkitAudioContext;
    var ctx = new Ctx();
    this.ctx = ctx;

    this._master = ctx.createGain();
    this._master.gain.value = 0.6;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.55;
    this._master.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    // 信号通道共享带通滤波（中心 700Hz，Q 随带宽变化）
    this._sigFilter = ctx.createBiquadFilter();
    this._sigFilter.type = "bandpass";
    this._sigFilter.frequency.value = NF.CONST.TONE_CENTER;
    this._sigFilter.connect(this._master);

    // 噪声通道独立带通，收窄带宽时噪声一起被抑制
    this._noiseFilter = ctx.createBiquadFilter();
    this._noiseFilter.type = "bandpass";
    this._noiseFilter.frequency.value = NF.CONST.TONE_CENTER;
    this._noiseGain = ctx.createGain();
    this._noiseGain.gain.value = 0.05;
    this._noiseFilter.connect(this._noiseGain);
    this._noiseGain.connect(this._master);

    this._startNoise();
    this._buildVoices();
    this.updateFilter(1.2);
  };

  AudioEngine.prototype._startNoise = function () {
    var ctx = this.ctx;
    var len = ctx.sampleRate * 2;
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    var last = 0;
    for (var i = 0; i < len; i++) {
      var white = Math.random() * 2 - 1;
      // 粉化噪声，更像短波底噪
      last = (last + 0.02 * white) / 1.02;
      d[i] = last * 3.2 + white * 0.25;
    }
    var src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this._noiseFilter);
    src.start();
  };

  AudioEngine.prototype._buildVoices = function () {
    var self = this, ctx = this.ctx;
    var ids = NF.BEACONS.map(function (b) { return b.id; })
      .concat(["D0", "I1", "I2", "I3"]);
    ids.forEach(function (id) {
      var type = id === "D0" ? "sawtooth"
        : (id[0] === "I" ? "square" : "sine");
      var osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = NF.CONST.TONE_CENTER;
      var harm = ctx.createOscillator();
      harm.type = "sine";
      harm.frequency.value = NF.CONST.TONE_CENTER * 2;
      var hGain = ctx.createGain();
      hGain.gain.value = id[0] === "B" ? 0.28 : 0.12;
      var amp = ctx.createGain();
      amp.gain.value = 0.0001;
      osc.connect(amp);
      harm.connect(hGain);
      hGain.connect(amp);
      amp.connect(self._sigFilter);
      osc.start();
      harm.start();
      self.voices[id] = { osc: osc, harm: harm, amp: amp };
    });
  };

  AudioEngine.prototype.updateFilter = function (bwKhz) {
    if (!this.ctx) { return; }
    var q = Math.max(0.25, NF.CONST.TONE_CENTER / (bwKhz * 1000));
    var now = this.ctx.currentTime;
    [this._sigFilter, this._noiseFilter].forEach(function (f) {
      f.Q.setTargetAtTime(q, now, 0.05);
    });
  };

  AudioEngine.prototype.setVolume = function (v) {
    if (this.ctx) {
      this._master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
    }
  };

  AudioEngine.prototype.update = function (st) {
    if (!this.ctx) { return; }
    var now = this.ctx.currentTime;
    var sigs = NF.getSignals(st);
    var self = this;
    sigs.forEach(function (s) {
      var v = self.voices[s.id];
      if (!v) { return; }
      var f = NF.toneFor(s.freq, st.tuned);
      v.osc.frequency.setTargetAtTime(f, now, 0.03);
      v.harm.frequency.setTargetAtTime(f * 2, now, 0.03);
      var g = s.on ? Math.min(0.55, s.level * 0.5) : 0.0001;
      v.amp.gain.setTargetAtTime(g, now, 0.06);
    });

    // 底噪随时间增强，叠加随机噼啪声
    if (Math.random() < 0.04) { this._crackle = 0.5 + Math.random() * 0.8; }
    this._crackle *= 0.82;
    var n = NF.noiseBase(st.simTime) * (0.8 + Math.random() * 0.5)
      + this._crackle * 0.09;
    this._noiseGain.gain.setTargetAtTime(Math.min(0.5, n), now, 0.05);
  };

  // 输出电平 RMS（0..1）
  AudioEngine.prototype.outputLevel = function () {
    if (!this.analyser) { return 0; }
    var buf = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(buf);
    var sum = 0;
    for (var i = 0; i < buf.length; i++) {
      var x = (buf[i] - 128) / 128;
      sum += x * x;
    }
    return Math.min(1, Math.sqrt(sum / buf.length) * 3);
  };

  NF.AudioEngine = AudioEngine;
})(typeof window !== "undefined" ? window : globalThis);
