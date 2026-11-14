/*
 * timeline.js — 时间线：把当前曲线作为片段上传，保存后可顺序重复使用
 * 片段仅存贝塞尔控制点与时长，播放时仍由 easing.js 实时求解。
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'easing-tool-timeline-v1';

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (err) {
      return [];
    }
  }

  function Timeline() {
    this.clips = load();
  }

  Timeline.prototype.persist = function () {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.clips));
  };

  Timeline.prototype.addClip = function (preset) {
    var clip = {
      id: 'clip-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      name: preset.name,
      p: preset.p.slice(),
      durationMs: 1200
    };
    this.clips.push(clip);
    this.persist();
    return clip;
  };

  Timeline.prototype.removeAt = function (index) {
    this.clips.splice(index, 1);
    this.persist();
  };

  Timeline.prototype.clear = function () {
    this.clips = [];
    this.persist();
  };

  Timeline.prototype.totalDuration = function () {
    return this.clips.reduce(function (sum, clip) {
      return sum + clip.durationMs;
    }, 0);
  };

  /*
   * 按整条时间线的已播放毫秒数定位片段，返回：
   * { clip, index, localProgress(0..1), globalProgress(0..1) }
   */
  Timeline.prototype.locate = function (elapsedMs) {
    var total = this.totalDuration();
    if (total === 0) return null;
    var t = Math.max(0, Math.min(elapsedMs, total));
    var acc = 0;
    for (var i = 0; i < this.clips.length; i++) {
      var clip = this.clips[i];
      if (t <= acc + clip.durationMs || i === this.clips.length - 1) {
        var local = clip.durationMs === 0 ? 1 : (t - acc) / clip.durationMs;
        return {
          clip: clip,
          index: i,
          localProgress: Math.max(0, Math.min(1, local)),
          globalProgress: t / total
        };
      }
      acc += clip.durationMs;
    }
    return null;
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Timeline: Timeline };
  } else {
    global.EasingTimeline = { Timeline: Timeline };
  }
})(typeof window !== 'undefined' ? window : globalThis);
