// UI wiring: render pipeline, hover readout, PNG export, self-test.
(function () {
  "use strict";
  const C = window.BumpCore;
  const SIZE = 256;

  const $ = (id) => document.getElementById(id);
  const cvHeight = $("cvHeight");
  const cvNormal = $("cvNormal");
  const cvLight = $("cvLight");
  const ctxH = cvHeight.getContext("2d");
  const ctxN = cvNormal.getContext("2d");
  const ctxL = cvLight.getContext("2d");

  const inputs = {
    bump: $("inBump"),
    oct: $("inOct"),
    az: $("inAz"),
    el: $("inEl"),
    int: $("inInt"),
    seed: $("inSeed"),
  };
  const outputs = {
    bump: $("oBump"),
    oct: $("oOct"),
    az: $("oAz"),
    el: $("oEl"),
    int: $("oInt"),
    seed: $("oSeed"),
  };

  let height = null; // current Float32Array heightfield

  function params() {
    return {
      bump: parseFloat(inputs.bump.value),
      oct: parseInt(inputs.oct.value, 10),
      az: (parseFloat(inputs.az.value) * Math.PI) / 180,
      el: (parseFloat(inputs.el.value) * Math.PI) / 180,
      int: parseFloat(inputs.int.value),
      seed: parseInt(inputs.seed.value, 10),
    };
  }

  function lightVector(az, el) {
    return {
      x: Math.cos(el) * Math.cos(az),
      y: Math.cos(el) * Math.sin(az),
      z: Math.sin(el),
    };
  }

  function syncLabels(p) {
    outputs.bump.textContent = p.bump.toFixed(1);
    outputs.oct.textContent = String(p.oct);
    outputs.az.textContent = Math.round((p.az * 180) / Math.PI) + "°";
    outputs.el.textContent = Math.round((p.el * 180) / Math.PI) + "°";
    outputs.int.textContent = p.int.toFixed(2);
    outputs.seed.textContent = String(p.seed);
  }

  function putPixels(ctx, data) {
    const img = ctx.createImageData(SIZE, SIZE);
    img.data.set(data);
    ctx.putImageData(img, 0, 0);
  }

  // Full regeneration: only needed when seed or octaves change.
  function regenerate() {
    const p = params();
    syncLabels(p);
    height = C.generateHeightmap(SIZE, p.oct, p.seed);
    putPixels(ctxH, C.heightToGray(height, SIZE));
    repaint();
  }

  // Cheap repaint: bump scale / lighting only.
  function repaint() {
    const p = params();
    syncLabels(p);
    putPixels(ctxN, C.heightToNormalMap(height, SIZE, p.bump));
    putPixels(ctxL, C.renderShading(height, SIZE, p.bump, lightVector(p.az, p.el), p.int));
  }

  // Structure-affecting controls regenerate the heightfield.
  inputs.oct.addEventListener("input", regenerate);
  inputs.seed.addEventListener("input", regenerate);
  // Surface/lighting controls only repaint.
  inputs.bump.addEventListener("input", repaint);
  inputs.az.addEventListener("input", repaint);
  inputs.el.addEventListener("input", repaint);
  inputs.int.addEventListener("input", repaint);

  // Hover readout: pixel coords, height, decoded normal.
  const readout = $("readout");
  function onHover(ev) {
    const rect = ev.currentTarget.getBoundingClientRect();
    const x = Math.floor(((ev.clientX - rect.left) / rect.width) * SIZE);
    const y = Math.floor(((ev.clientY - rect.top) / rect.height) * SIZE);
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE || !height) return;
    const p = params();
    const h = height[y * SIZE + x];
    const n = C.normalAt(height, SIZE, x, y, p.bump);
    readout.textContent =
      `像素 (${x}, ${y})\n` +
      `高度  ${h.toFixed(4)}\n` +
      `法线  (${n[0].toFixed(3)}, ${n[1].toFixed(3)}, ${n[2].toFixed(3)})`;
  }
  [cvHeight, cvNormal, cvLight].forEach((cv) => {
    cv.addEventListener("mousemove", onHover);
  });

  // PNG export for each view.
  function exportPNG(canvas, name) {
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = name;
    a.click();
  }
  $("btnH").addEventListener("click", () => exportPNG(cvHeight, "heightmap.png"));
  $("btnN").addEventListener("click", () => exportPNG(cvNormal, "normalmap.png"));
  $("btnL").addEventListener("click", () => exportPNG(cvLight, "lighting.png"));

  // Self-test: (1) same seed twice -> identical heightfield;
  // (2) changing light direction visibly changes shading.
  function selfTest() {
    const el = $("selftest");
    const a = C.generateHeightmap(SIZE, 5, 1337);
    const b = C.generateHeightmap(SIZE, 5, 1337);
    let identical = a.length === b.length;
    for (let i = 0; identical && i < a.length; i++) identical = a[i] === b[i];

    const l1 = C.renderShading(a, SIZE, 8, lightVector(0, Math.PI / 4), 1);
    const l2 = C.renderShading(a, SIZE, 8, lightVector(Math.PI, Math.PI / 4), 1);
    let diff = 0;
    for (let i = 0; i < l1.length; i += 4) diff += Math.abs(l1[i] - l2[i]);
    const meanDiff = diff / (l1.length / 4);
    const lightOk = meanDiff > 10; // clearly visible average change

    el.innerHTML =
      `自检：<span class="${identical ? "pass" : "fail"}">` +
      `同 seed 两次生成${identical ? "一致 ✓" : "不一致 ✗"}</span><br>` +
      `<span class="${lightOk ? "pass" : "fail"}">` +
      `光源反向平均亮度差 ${meanDiff.toFixed(1)}/255 ` +
      `${lightOk ? "（明暗变化明显 ✓）" : "（变化不足 ✗）"}</span>`;
  }

  regenerate();
  selfTest();
})();
