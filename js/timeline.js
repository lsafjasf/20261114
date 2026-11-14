/* 统一时间线：播放、暂停、单帧、拖动全部读写同一个 currentTime。 */
(function () {
  "use strict";
  const HH = (window.HH = window.HH || globalThis.HH || {}); globalThis.HH = HH;

  HH.Timeline = function Timeline(opts) {
    this.durationSec = opts.durationSec || 4;
    this.fps = opts.fps || 30;
    this.currentTime = 0;
    this.playing = false;
    this.rafId = null;
    this.wallStart = 0;
    this.timelineStart = 0;
    this.onTick = opts.onTick || function () {};
    this.onEnded = opts.onEnded || function () {};
  };

  HH.Timeline.prototype.totalFrames = function () {
    return Math.round(this.durationSec * this.fps);
  };

  HH.Timeline.prototype.currentFrame = function () {
    return Math.min(
      this.totalFrames() - 1,
      Math.round((this.currentTime / this.durationSec) * (this.totalFrames() - 1))
    );
  };

  HH.Timeline.prototype.normalized = function () {
    return this.durationSec ? this.currentTime / this.durationSec : 0;
  };

  HH.Timeline.prototype.play = function () {
    if (this.playing) return;
    if (this.currentTime >= this.durationSec) this.setTime(0);
    this.playing = true;
    this.wallStart = performance.now();
    this.timelineStart = this.currentTime;
    const self = this;
    function loop(now) {
      if (!self.playing) return;
      const t = self.timelineStart + (now - self.wallStart) / 1000;
      if (t >= self.durationSec) {
        self.setTime(self.durationSec);
        self.pause();
        self.onEnded();
        return;
      }
      self.currentTime = t;
      self.onTick();
      self.rafId = requestAnimationFrame(loop);
    }
    this.rafId = requestAnimationFrame(loop);
  };

  HH.Timeline.prototype.pause = function () {
    this.playing = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  };

  HH.Timeline.prototype.stop = function () {
    this.pause();
    this.setTime(0);
  };

  HH.Timeline.prototype.setTime = function (sec) {
    this.currentTime = HH.clamp(sec, 0, this.durationSec);
    if (this.playing) {
      this.wallStart = performance.now();
      this.timelineStart = this.currentTime;
    }
    this.onTick();
  };

  HH.Timeline.prototype.seekFrame = function (frame) {
    const total = this.totalFrames();
    const f = HH.clamp(Math.round(frame), 0, total - 1);
    this.setTime((f / (total - 1)) * this.durationSec);
  };

  HH.Timeline.prototype.step = function (delta) {
    this.pause();
    this.seekFrame(this.currentFrame() + delta);
  };

  HH.Timeline.prototype.setDuration = function (sec) {
    this.pause();
    this.durationSec = Math.max(1, sec);
    this.currentTime = Math.min(this.currentTime, this.durationSec);
    this.onTick();
  };

  HH.Timeline.prototype.setFps = function (fps) {
    this.pause();
    this.fps = fps;
    this.onTick();
  };
})();
