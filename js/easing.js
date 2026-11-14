/*
 * easing.js — 缓动曲线数学核心（纯函数，浏览器与 Node 共用）
 *
 * 所有缓动统一表示为三次贝塞尔曲线 B(t)，控制点 P0=(0,0)、P3=(1,1)：
 *   x(t) = 3(1-t)^2 t x1 + 3(1-t) t^2 x2 + t^3
 *   y(t) = 3(1-t)^2 t y1 + 3(1-t) t^2 y2 + t^3
 * 缓动函数 value(u) = y(t)，其中 t 满足 x(t)=u，实时求根得到，
 * 不使用任何预录/预烘焙的动画数据。
 */
(function (global) {
  'use strict';

  var EPSILON = 1e-7;

  function bezierAxis(a, b, t) {
    var oneMinus = 1 - t;
    return 3 * oneMinus * oneMinus * t * a +
           3 * oneMinus * t * t * b +
           t * t * t;
  }

  function bezierAxisDerivative(a, b, t) {
    var oneMinus = 1 - t;
    return 3 * oneMinus * oneMinus * a +
           6 * oneMinus * t * (b - a) +
           3 * t * t * (1 - b);
  }

  function bezierAxisSecondDerivative(a, b, t) {
    return 6 * (1 - t) * (b - 2 * a) + 6 * t * (1 - 2 * b + a);
  }

  /* 求 x(t)=u 的参数 t：牛顿法为主，失败时回退二分法 */
  function solveT(x1, x2, u) {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    var t = u;
    for (var i = 0; i < 12; i++) {
      var x = bezierAxis(x1, x2, t) - u;
      if (Math.abs(x) < EPSILON) return t;
      var dx = bezierAxisDerivative(x1, x2, t);
      if (Math.abs(dx) < 1e-6) break;
      t -= x / dx;
      if (t < 0) t = 0;
      if (t > 1) t = 1;
    }
    var lo = 0, hi = 1;
    t = u;
    while (lo < hi) {
      var xMid = bezierAxis(x1, x2, t);
      if (Math.abs(xMid - u) < EPSILON) return t;
      if (u > xMid) lo = t; else hi = t;
      t = (lo + hi) / 2;
      if (hi - lo < EPSILON) break;
    }
    return t;
  }

  function Easing(x1, y1, x2, y2) {
    this.p = [x1, y1, x2, y2];
  }

  Easing.prototype.valueAt = function (u) {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    var t = solveT(this.p[0], this.p[2], u);
    return bezierAxis(this.p[1], this.p[3], t);
  };

  /* 位移对归一化时间的一阶导 dy/du（即速度量纲） */
  Easing.prototype.velocityAt = function (u) {
    if (u <= 0) u = 0;
    if (u >= 1) u = 1;
    var t = solveT(this.p[0], this.p[2], u);
    var dx = bezierAxisDerivative(this.p[0], this.p[2], t);
    if (Math.abs(dx) > 1e-5) {
      return bezierAxisDerivative(this.p[1], this.p[3], t) / dx;
    }
    /* dx≈0（参数奇点）时用中心差分数值兜底，保证连续 */
    var h = 1e-4;
    var lo = u - h < 0 ? 0 : u - h;
    var hi = u + h > 1 ? 1 : u + h;
    return (this.valueAt(hi) - this.valueAt(lo)) / (hi - lo);
  };

  /* 二阶导 d²y/du²（即加速度量纲），同样解析为主、数值兜底 */
  Easing.prototype.accelerationAt = function (u) {
    if (u <= 0) u = 0;
    if (u >= 1) u = 1;
    var t = solveT(this.p[0], this.p[2], u);
    var x1 = this.p[0], x2 = this.p[2];
    var y1 = this.p[1], y2 = this.p[3];
    var dx = bezierAxisDerivative(x1, x2, t);
    if (Math.abs(dx) > 1e-4) {
      var dy = bezierAxisDerivative(y1, y2, t);
      var dxx = bezierAxisSecondDerivative(x1, x2, t);
      var dyy = bezierAxisSecondDerivative(y1, y2, t);
      return (dyy * dx - dy * dxx) / (dx * dx * dx);
    }
    var h = 1e-3;
    var lo = u - h < 0 ? 0 : u - h;
    var hi = u + h > 1 ? 1 : u + h;
    return (this.velocityAt(hi) - this.velocityAt(lo)) / (hi - lo);
  };

  /* 在 [0,1] 上等距采样，供 Canvas 绘图与连续性检测使用 */
  Easing.prototype.sample = function (count) {
    var out = [];
    for (var i = 0; i <= count; i++) {
      var u = i / count;
      out.push({
        u: u,
        s: this.valueAt(u),
        v: this.velocityAt(u),
        a: this.accelerationAt(u)
      });
    }
    return out;
  };

  var api = {
    Easing: Easing,
    bezierAxis: bezierAxis,
    bezierAxisDerivative: bezierAxisDerivative,
    solveT: solveT
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.EasingCore = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
