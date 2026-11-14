(() => {
  "use strict";

  const E = window.NeonEngine;
  const { MIN_VISIBLE, SCENE, clamp, hash, positiveMod } = E;
  const SIGN = SCENE.sign;
  const LETTER_AREA = { x: 56, y: 26, w: SIGN.w - 112, h: SIGN.h - 52 };

  function getLayouts(text) {
    const chars = Array.from(text);
    const slotWidth = LETTER_AREA.w / Math.max(1, chars.length);
    const scale = Math.min(184, LETTER_AREA.h * 0.92, slotWidth * 1.18);
    const glyphWidth = scale * 0.61;
    const totalWidth = slotWidth * chars.length;

    return chars.map((char, index) => {
      const slotX = LETTER_AREA.x + totalWidth * (index / Math.max(1, chars.length));
      return {
        char,
        index,
        slotX,
        slotWidth,
        scale,
        glyphWidth,
        x: slotX + (slotWidth - glyphWidth) / 2,
        y: LETTER_AREA.y + (LETTER_AREA.h - scale) / 2
      };
    });
  }

  function hsla(hue, saturation, lightness, alpha) {
    return `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha})`;
  }

  function strokePaths(ctx, paths, style, width) {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    for (const path of paths) {
      ctx.stroke(path);
    }
  }

  function sweepGradient(ctx, state, alpha, lightness = 58) {
    const gradient = ctx.createLinearGradient(0, 0, 1, 0);
    const pos = state.sweepPos;
    const spread = 0.14 + state.sweep * 0.08;
    const hotAlpha = alpha * (0.45 + state.sweep * 0.95);
    const stops = [
      [0, hsla(state.hue, 100, lightness, alpha)],
      [clamp(pos - spread, 0, 1), hsla(state.hue, 100, lightness, alpha)],
      [clamp(pos, 0, 1), hsla((state.hue + 22) % 360, 100, 91, hotAlpha)],
      [clamp(pos + spread, 0, 1), hsla(state.hue, 100, lightness, alpha)],
      [1, hsla(state.hue, 100, lightness, alpha)]
    ].sort((a, b) => a[0] - b[0]);

    for (const [offset, color] of stops) {
      gradient.addColorStop(offset, color);
    }
    return gradient;
  }

  function drawGlass(ctx, paths, state) {
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.translate(0.028, 0.04);
    strokePaths(ctx, paths, "rgba(2, 4, 8, 0.78)", 0.095);
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    strokePaths(ctx, paths, hsla(state.hue, 38, 9, 0.95), 0.083);
    strokePaths(ctx, paths, hsla(state.hue, 56, 23, 0.28 + state.energy * 0.16), 0.062);
    ctx.restore();
  }

  function drawGlow(ctx, paths, state, time, index) {
    const energy = state.energy;
    const layers = [
      [0.29, 0.025 + energy * 0.016, 44],
      [0.19, 0.045 + energy * 0.035, 50],
      [0.12, 0.09 + energy * 0.11, 58],
      [0.074, 0.35 + energy * 0.39, 63],
      [0.038, 0.60 + energy * 0.35, 78],
      [0.017, 0.73 + energy * 0.25, 94]
    ];

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const [layerIndex, [width, alpha, lightness]] of layers.entries()) {
      if (layerIndex < 3) {
        strokePaths(ctx, paths, sweepGradient(ctx, state, alpha, lightness), width);
        continue;
      }
      paths.forEach((path, pathIndex) => {
        const stutter = Math.sin(time * 16.8 + index * 5.2 + pathIndex * 2.4);
        const segmentEnergy = Math.max(
          MIN_VISIBLE,
          state.energy * (0.86 + stutter * 0.13 + state.fault * 0.02)
        );
        const segmentState = {
          ...state,
          energy: segmentEnergy,
          hue: (state.hue + pathIndex * state.fault * 4) % 360
        };
        ctx.strokeStyle = sweepGradient(ctx, segmentState, alpha, lightness);
        ctx.lineWidth = width;
        ctx.stroke(path);
      });
    }
    ctx.restore();
  }

  function drawSparks(ctx, layout, state, time) {
    const spark = E.sparkState(time, layout.index);
    if (!spark || state.fault < 0.08) {
      return;
    }

    const strength = spark.strength * (0.35 + state.fault * 0.65);
    const originX = layout.x + layout.glyphWidth * (0.42 + hash(spark.seed) * 0.16);
    const originY = layout.y + layout.scale * (0.67 + hash(spark.seed + 3) * 0.29);
    const branches = 5 + Math.floor(hash(spark.seed + 7) * 4);

    ctx.save();
    ctx.translate(originX, originY);
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";

    for (let branch = 0; branch < branches; branch += 1) {
      const angle = hash(spark.seed + branch * 11) * Math.PI * 2;
      const length = 5 + hash(spark.seed + branch * 17) * 21 * strength;
      const bend = (hash(spark.seed + branch * 23) - 0.5) * 10;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(
        Math.cos(angle) * length * 0.45 + bend,
        Math.sin(angle) * length * 0.45,
        Math.cos(angle + 0.08) * length,
        Math.sin(angle + 0.08) * length
      );
      ctx.strokeStyle = hsla(38, 100, 76, 0.56 * strength);
      ctx.lineWidth = 3.2;
      ctx.stroke();
      ctx.strokeStyle = `rgba(255, 250, 224, ${0.9 * strength})`;
      ctx.lineWidth = 0.85;
      ctx.stroke();
    }

    ctx.fillStyle = `rgba(255, 246, 206, ${0.86 * strength})`;
    ctx.beginPath();
    ctx.arc(0, 0, 1.5 + strength * 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawTubeSign(ctx, text, letters, time) {
    const layouts = getLayouts(text);
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    layouts.forEach((layout, index) => {
      const raw = letters[index] || E.DEFAULTS[index % E.DEFAULTS.length];
      const state = E.sampleLetter(raw, time, index);
      const paths = E.glyphPaths(layout.char);
      if (!paths.length) {
        return;
      }

      ctx.save();
      ctx.translate(layout.x, layout.y);
      ctx.scale(layout.scale, layout.scale);
      drawGlass(ctx, paths, state);
      drawGlow(ctx, paths, state, time, index);
      ctx.restore();

      drawSparks(ctx, layout, state, time);
    });

    ctx.restore();
    return layouts;
  }

  E.SIGN = SIGN;
  E.getSignLayouts = getLayouts;
  E.drawTubeSign = drawTubeSign;
  E.drawSparks = drawSparks;
})();
