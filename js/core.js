/*
 * LoopCore: deterministic abstract background engine.
 * Pure logic + Canvas 2D rendering, shared by the browser page and Node tests.
 * No images, no network, all randomness comes from a seeded PRNG.
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    global.LoopCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TAU = Math.PI * 2;
  var DURATION = 8; // seconds
  var WIDTH = 640;
  var HEIGHT = 360;

  /* ---------------- deterministic randomness ---------------- */

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashString(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function normalizeSeed(input) {
    if (typeof input === 'number' && isFinite(input)) return input >>> 0;
    if (input === undefined || input === null || input === '') return 1;
    return hashString(String(input));
  }

  /* ---------------- palettes ---------------- */

  var PALETTES = [
    {
      name: 'aurora',
      bg: { hue: 232, sat: 46, light: 10 },
      a: { hue: 188, sat: 85, light: 60 },
      b: { hue: 276, sat: 80, light: 62 },
      c: { hue: 318, sat: 75, light: 60 }
    },
    {
      name: 'ember',
      bg: { hue: 16, sat: 52, light: 11 },
      a: { hue: 24, sat: 90, light: 58 },
      b: { hue: 46, sat: 88, light: 60 },
      c: { hue: 348, sat: 80, light: 60 }
    },
    {
      name: 'lagoon',
      bg: { hue: 196, sat: 48, light: 10 },
      a: { hue: 168, sat: 78, light: 55 },
      b: { hue: 210, sat: 82, light: 62 },
      c: { hue: 96, sat: 70, light: 58 }
    },
    {
      name: 'candy',
      bg: { hue: 268, sat: 42, light: 11 },
      a: { hue: 330, sat: 82, light: 64 },
      b: { hue: 192, sat: 84, light: 62 },
      c: { hue: 262, sat: 78, light: 66 }
    }
  ];

  function hsl(h, s, l, a) {
    h = ((h % 360) + 360) % 360;
    if (a === undefined) return 'hsl(' + h.toFixed(1) + ',' + s + '%,' + l + '%)';
    return 'hsla(' + h.toFixed(1) + ',' + s + '%,' + l + '%,' + a + ')';
  }

  /* ---------------- parameter generation ---------------- */

  var FREQ_FIELDS = [
    'hueFreq', 'freq', 'pulseFreq', 'rotFreq', 'orbitFreq', 'twFreq'
  ];

  function makeParams(seedInput) {
    var seed = normalizeSeed(seedInput);
    var rng = mulberry32(seed);
    function rf(lo, hi) { return lo + rng() * (hi - lo); }
    function pick(arr) { return arr[Math.floor(rng() * arr.length)]; }

    var pal = PALETTES[Math.floor(rng() * PALETTES.length)];
    var inkKeys = ['a', 'b', 'c'];
    function ink() {
      var base = pal[pick(inkKeys)];
      return {
        hue: base.hue + rf(-10, 10),
        sat: clamp(base.sat + rf(-6, 6), 35, 95),
        light: clamp(base.light + rf(-6, 6), 45, 78)
      };
    }

    var params = {
      version: 1,
      duration: DURATION,
      seed: seed,
      size: { width: WIDTH, height: HEIGHT },
      paletteName: pal.name,
      background: {
        hue: pal.bg.hue + rf(-5, 5),
        sat: clamp(pal.bg.sat + rf(-4, 4), 30, 70),
        light: clamp(pal.bg.light + rf(-2, 2), 6, 16),
        hueAmp: rf(6, 16),
        hueFreq: rf(0.11, 0.37),
        huePhase: rf(0, TAU)
      },
      blobs: [],
      shapes: [],
      particles: [],
      ribbons: []
    };

    for (var i = 0; i < 4; i++) {
      var c = ink();
      params.blobs.push({
        cx: rf(0.14, 0.86) * WIDTH,
        cy: rf(0.16, 0.84) * HEIGHT,
        r0: rf(70, 130),
        rAmp: rf(12, 34),
        hue: c.hue, sat: c.sat, light: c.light,
        alpha: rf(0.26, 0.44),
        freq: rf(0.11, 0.44),
        phase: rf(0, TAU),
        driftX: rf(18, 52),
        driftY: rf(14, 44),
        pulseFreq: rf(0.2, 0.6),
        pulsePhase: rf(0, TAU)
      });
    }

    var shapeTypes = ['triangle', 'square', 'diamond', 'ring'];
    for (var s = 0; s < 5; s++) {
      var sc = ink();
      params.shapes.push({
        type: pick(shapeTypes),
        baseX: rf(0.1, 0.9) * WIDTH,
        baseY: rf(0.12, 0.88) * HEIGHT,
        radius: rf(14, 30),
        hue: sc.hue, sat: sc.sat, light: sc.light,
        alpha: rf(0.34, 0.6),
        rotFreq: rf(0.12, 0.55),
        rotPhase: rf(0, TAU),
        orbitFreq: rf(0.1, 0.42),
        orbitPhase: rf(0, TAU),
        orbitAmp: rf(14, 40),
        dir: rng() < 0.5 ? -1 : 1
      });
    }

    for (var p = 0; p < 26; p++) {
      var pc = ink();
      params.particles.push({
        baseX: rf(0.04, 0.96) * WIDTH,
        baseY: rf(0.06, 0.94) * HEIGHT,
        radius: rf(1.5, 4.2),
        hue: pc.hue, sat: pc.sat, light: pc.light,
        alpha: rf(0.5, 0.9),
        freq: rf(0.15, 0.7),
        phase: rf(0, TAU),
        ampX: rf(10, 46),
        ampY: rf(8, 38),
        twFreq: rf(0.3, 0.9),
        twPhase: rf(0, TAU)
      });
    }

    for (var r = 0; r < 3; r++) {
      var rc = ink();
      params.ribbons.push({
        y0: rf(0.2, 0.8) * HEIGHT,
        amp: rf(16, 40),
        lineWidth: rf(2, 4.5),
        hue: rc.hue, sat: rc.sat, light: rc.light,
        alpha: rf(0.24, 0.44),
        freq: rf(0.1, 0.4),
        phase: rf(0, TAU),
        waves: Math.round(rf(2, 4))
      });
    }

    return params;
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* ---------------- loop-safe correction ----------------
   * Every time varying term is sin/cos with frequency f (Hz).
   * Raw params use arbitrary f, so at t = 8 the phase is not closed.
   * Correction snaps f to the nearest k/8 Hz, i.e. an integer number
   * of full cycles inside the 8s clip => last frame equals first frame.
   */

  function snapFreq(f, duration) {
    var cycles = Math.round(f * duration);
    cycles = Math.max(1, cycles);
    return cycles / duration;
  }

  function snapParams(params) {
    var out = JSON.parse(JSON.stringify(params));
    var d = out.duration;
    function fix(obj) {
      for (var i = 0; i < FREQ_FIELDS.length; i++) {
        var key = FREQ_FIELDS[i];
        if (obj[key] !== undefined) obj[key] = snapFreq(obj[key], d);
      }
    }
    fix(out.background);
    out.blobs.forEach(fix);
    out.shapes.forEach(fix);
    out.particles.forEach(fix);
    out.ribbons.forEach(fix);
    out.corrected = true;
    return out;
  }

  function describeSnaps(raw, corrected) {
    var rows = [];
    function walk(label, r, c) {
      FREQ_FIELDS.forEach(function (k) {
        if (r[k] !== undefined) {
          rows.push({
            item: label, field: k,
            raw: round(r[k], 4), corrected: round(c[k], 4),
            cycles: Math.round(c[k] * corrected.duration)
          });
        }
      });
    }
    walk('background', raw.background, corrected.background);
    raw.blobs.forEach(function (b, i) { walk('blob#' + (i + 1), b, corrected.blobs[i]); });
    raw.shapes.forEach(function (b, i) { walk('shape#' + (i + 1), b, corrected.shapes[i]); });
    raw.particles.forEach(function (b, i) { walk('particle#' + (i + 1), b, corrected.particles[i]); });
    raw.ribbons.forEach(function (b, i) { walk('ribbon#' + (i + 1), b, corrected.ribbons[i]); });
    return rows;
  }

  function round(v, n) {
    var m = Math.pow(10, n);
    return Math.round(v * m) / m;
  }

  /* ---------------- frame rendering (Canvas 2D only) ---------------- */

  function renderFrame(ctx, params, t) {
    var W = params.size.width, H = params.size.height;
    var bg = params.background;
    var bgHue = bg.hue + bg.hueAmp * Math.sin(TAU * bg.hueFreq * t + bg.huePhase);
    var grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, hsl(bgHue, bg.sat, bg.light + 6));
    grad.addColorStop(1, hsl(bgHue + 24, bg.sat, Math.max(4, bg.light - 3)));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    drawBlobs(ctx, params, t);
    drawRibbons(ctx, params, t);
    drawShapes(ctx, params, t);
    drawParticles(ctx, params, t);
    drawVignette(ctx, params);
  }

  function drawBlobs(ctx, params, t) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    params.blobs.forEach(function (b) {
      var ang = TAU * b.freq * t + b.phase;
      var x = b.cx + b.driftX * Math.cos(ang) + 0.4 * b.driftX * Math.sin(2 * ang);
      var y = b.cy + b.driftY * Math.sin(ang);
      var r = b.r0 + b.rAmp * Math.sin(TAU * b.pulseFreq * t + b.pulsePhase);
      var hue = b.hue + 18 * Math.sin(2 * ang);
      var g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(1, r));
      g.addColorStop(0, hsl(hue, b.sat, b.light, b.alpha));
      g.addColorStop(1, hsl(hue, b.sat, b.light, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1, r), 0, TAU);
      ctx.fill();
    });
    ctx.restore();
  }

  function drawRibbons(ctx, params, t) {
    var W = params.size.width;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    params.ribbons.forEach(function (rb) {
      var shift = rb.amp * Math.sin(TAU * rb.freq * t + rb.phase);
      ctx.strokeStyle = hsl(rb.hue, rb.sat, rb.light, rb.alpha);
      ctx.lineWidth = rb.lineWidth;
      ctx.beginPath();
      for (var x = 0; x <= W; x += 8) {
        var y = rb.y0 + shift
          + Math.sin((x / W) * TAU * rb.waves + rb.phase + TAU * rb.freq * t) * rb.amp * 0.55;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawShapes(ctx, params, t) {
    params.shapes.forEach(function (s) {
      var oAng = TAU * s.orbitFreq * t + s.orbitPhase;
      var x = s.baseX + s.orbitAmp * Math.cos(oAng);
      var y = s.baseY + s.orbitAmp * 0.7 * Math.sin(oAng);
      var rot = s.dir * TAU * s.rotFreq * t + s.rotPhase;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.strokeStyle = hsl(s.hue, s.sat, s.light, s.alpha);
      ctx.fillStyle = hsl(s.hue, s.sat, s.light, s.alpha * 0.22);
      ctx.lineWidth = 2;
      var r = s.radius;
      ctx.beginPath();
      if (s.type === 'ring') {
        ctx.arc(0, 0, r, 0, TAU);
      } else if (s.type === 'triangle') {
        polygon(ctx, 3, r);
      } else if (s.type === 'square') {
        ctx.rect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6);
      } else {
        polygon(ctx, 4, r);
      }
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    });
  }

  function polygon(ctx, sides, r) {
    for (var i = 0; i < sides; i++) {
      var a = (i / sides) * TAU - Math.PI / 2;
      var px = Math.cos(a) * r, py = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function drawParticles(ctx, params, t) {
    ctx.save();
    params.particles.forEach(function (p) {
      var ang = TAU * p.freq * t + p.phase;
      var x = p.baseX + p.ampX * Math.cos(ang) + p.ampX * 0.35 * Math.sin(2 * ang);
      var y = p.baseY + p.ampY * Math.sin(ang);
      var tw = 0.5 + 0.5 * Math.sin(TAU * p.twFreq * t + p.twPhase);
      var r = p.radius * (0.7 + 0.6 * tw);
      ctx.fillStyle = hsl(p.hue, p.sat, p.light, p.alpha * (0.45 + 0.55 * tw));
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.4, r), 0, TAU);
      ctx.fill();
    });
    ctx.restore();
  }

  function drawVignette(ctx, params) {
    var W = params.size.width, H = params.size.height;
    var g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.32)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  /* ---------------- pixel diff ---------------- */

  function diffStats(imgA, imgB) {
    var a = imgA.data, b = imgB.data;
    var n = a.length;
    var sum = 0, sumSq = 0, max = 0, changed = 0;
    var perChan = [0, 0, 0];
    var rgbCount = n / 4;
    for (var i = 0; i < n; i += 4) {
      var dr = Math.abs(a[i] - b[i]);
      var dg = Math.abs(a[i + 1] - b[i + 1]);
      var db = Math.abs(a[i + 2] - b[i + 2]);
      var d = (dr + dg + db) / 3;
      sum += d;
      sumSq += dr * dr + dg * dg + db * db;
      if (d > max) max = d;
      if (d > 1) changed++;
      perChan[0] += dr; perChan[1] += dg; perChan[2] += db;
    }
    return {
      mae: sum / rgbCount,
      rmse: Math.sqrt(sumSq / (rgbCount * 3)),
      max: max,
      changedPct: (changed / rgbCount) * 100,
      channelMae: {
        r: perChan[0] / rgbCount,
        g: perChan[1] / rgbCount,
        b: perChan[2] / rgbCount
      }
    };
  }

  var HEAT_STOPS = [
    [0, 8, 24], [0, 60, 180], [0, 200, 160],
    [230, 230, 40], [255, 120, 0], [235, 0, 0]
  ];

  function buildHeatmap(imgA, imgB, target) {
    var a = imgA.data, b = imgB.data;
    var out = target.data;
    for (var i = 0, j = 0; i < a.length; i += 4, j += 4) {
      var d = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1])
        + Math.abs(a[i + 2] - b[i + 2])) / 3;
      var norm = Math.min(1, d / 90);
      var pos = norm * (HEAT_STOPS.length - 1);
      var idx = Math.min(HEAT_STOPS.length - 2, Math.floor(pos));
      var f = pos - idx;
      var lo = HEAT_STOPS[idx], hi = HEAT_STOPS[idx + 1];
      out[j] = lo[0] + (hi[0] - lo[0]) * f;
      out[j + 1] = lo[1] + (hi[1] - lo[1]) * f;
      out[j + 2] = lo[2] + (hi[2] - lo[2]) * f;
      out[j + 3] = 255;
    }
    return target;
  }

  return {
    TAU: TAU,
    DURATION: DURATION,
    WIDTH: WIDTH,
    HEIGHT: HEIGHT,
    FREQ_FIELDS: FREQ_FIELDS,
    PALETTES: PALETTES,
    mulberry32: mulberry32,
    normalizeSeed: normalizeSeed,
    makeParams: makeParams,
    snapParams: snapParams,
    describeSnaps: describeSnaps,
    renderFrame: renderFrame,
    diffStats: diffStats,
    buildHeatmap: buildHeatmap
  };
});
