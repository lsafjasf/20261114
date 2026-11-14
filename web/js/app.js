/* 经纬织造工作台：Canvas 实时渲染 + 参数持久化 + PNG 导出 */
(function () {
  'use strict';

  const { DEFAULTS, PRESETS, getUnitSize, renderRegion } = window.WeavePatterns;
  const STORE_KEY = 'weave-pattern-params-v1';
  const DISPLAY = 320; // 两个画布的 CSS/属性边长

  const els = {};
  [
    'tileW', 'tileH', 'lineWidth', 'pitchX', 'pitchY',
    'warpColor', 'weftColor', 'bgColor', 'mirrorX', 'mirrorY',
    'tileWVal', 'tileHVal', 'lineWidthVal', 'pitchXVal', 'pitchYVal',
    'singleCanvas', 'gridCanvas', 'showSeams', 'status',
    'exportBtn', 'saveBtn', 'restoreBtn', 'resetBtn',
    'presetRow', 'unitHint', 'singleMeta'
  ].forEach((id) => { els[id] = document.getElementById(id); });

  let params = Object.assign({}, DEFAULTS, { ssaa: 2 });
  let activePreset = 'plain';
  let renderTimer = null;

  const rangeIds = ['tileW', 'tileH', 'lineWidth', 'pitchX', 'pitchY'];

  function readForm() {
    rangeIds.forEach((id) => { params[id] = Number(els[id].value); });
    params.warpColor = els.warpColor.value;
    params.weftColor = els.weftColor.value;
    params.bgColor = els.bgColor.value;
    params.mirrorX = els.mirrorX.checked;
    params.mirrorY = els.mirrorY.checked;
  }

  function writeForm() {
    rangeIds.forEach((id) => { els[id].value = params[id]; });
    els.warpColor.value = params.warpColor;
    els.weftColor.value = params.weftColor;
    els.bgColor.value = params.bgColor;
    els.mirrorX.checked = params.mirrorX;
    els.mirrorY.checked = params.mirrorY;
    syncLabels();
  }

  function syncLabels() {
    els.tileWVal.textContent = `${params.tileW} px`;
    els.tileHVal.textContent = `${params.tileH} px`;
    els.lineWidthVal.textContent = params.lineWidth;
    els.pitchXVal.textContent = params.pitchX;
    els.pitchYVal.textContent = params.pitchY;
  }

  function toCanvas(image) {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext('2d').putImageData(
      new ImageData(image.data, image.width, image.height), 0, 0
    );
    return canvas;
  }

  function drawCover(ctx, source, size) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(source, 0, 0, size, size);
  }

  function flash(message, isError) {
    els.status.textContent = message;
    els.status.style.color = isError ? '#b03a3a' : '#2f7d4f';
    if (!isError) {
      setTimeout(() => { els.status.textContent = ''; }, 2600);
    }
  }

  function render() {
    readForm();
    syncLabels();

    const unit = getUnitSize(params);
    els.unitHint.textContent =
      `当前可平铺无缝单元为 ${unit.width} × ${unit.height} px` +
      (params.mirrorX || params.mirrorY ? '（镜像模式自动包含正反两个朝向）' : '。');
    els.singleMeta.textContent = `导出尺寸 ${unit.width}×${unit.height}`;

    // 单单元：从无限平面原点渲染一个完整无缝单元
    const single = renderRegion(params, unit.width, unit.height, 0, 0, params.ssaa);
    drawCover(els.singleCanvas.getContext('2d'), toCanvas(single), DISPLAY);

    // 四宫格：渲染 2x2 单元区域（跨接缝，与四张单元图数学等价）
    const grid = renderRegion(params, unit.width * 2, unit.height * 2, 0, 0, params.ssaa);
    const gctx = els.gridCanvas.getContext('2d');
    drawCover(gctx, toCanvas(grid), DISPLAY);

    if (els.showSeams.checked) {
      gctx.save();
      gctx.strokeStyle = 'rgba(255, 70, 70, 0.85)';
      gctx.lineWidth = 1.5;
      const half = DISPLAY / 2;
      gctx.strokeRect(half - 0.75, half - 0.75, half + 1.5, half + 1.5);
      gctx.beginPath();
      gctx.moveTo(half, 0); gctx.lineTo(half, DISPLAY);
      gctx.moveTo(0, half); gctx.lineTo(DISPLAY, half);
      gctx.stroke();
      gctx.restore();
    }

    document.querySelectorAll('.preset-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.preset === activePreset);
    });
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      render();
      saveParams(false);
    }, 40);
  }

  function saveParams(announce) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ params, activePreset }));
      if (announce) flash('参数已保存，下次打开自动恢复。');
    } catch (err) {
      flash('保存失败：' + err.message, true);
    }
  }

  function loadStored() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return false;
      const saved = JSON.parse(raw);
      params = Object.assign({}, DEFAULTS, saved.params, { ssaa: 2 });
      activePreset = saved.activePreset || 'plain';
      writeForm();
      return true;
    } catch (err) {
      return false;
    }
  }

  /* CompressionStream('deflate') 产出带 zlib 头与 adler32 的 RFC1950 流，
     与 Node zlib.inflateSync 及标准 PNG 解码器兼容 */
  async function zlibDeflate(bytes) {
    if (typeof CompressionStream === 'undefined') {
      throw new Error('当前浏览器不支持 CompressionStream，无法本地编码 PNG');
    }
    const stream = new Blob([bytes])
      .stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function exportPng() {
    readForm();
    const exportParams = Object.assign({}, params, { ssaa: 3 });
    const unit = getUnitSize(exportParams);
    const image = renderRegion(exportParams, unit.width, unit.height, 0, 0, exportParams.ssaa);
    const png = await window.TinyPNG.encode(image, zlibDeflate);
    const blob = new Blob([png], { type: 'image/png' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `weave-${activePreset}-${unit.width}x${unit.height}.png`;
    link.click();
    URL.revokeObjectURL(url);
    flash(`已导出无缝单元 ${unit.width}×${unit.height} px，可直接任意平铺。`);
  }

  function bindEvents() {
    rangeIds.forEach((id) => {
      els[id].addEventListener('input', scheduleRender);
      els[id].addEventListener('change', scheduleRender);
    });
    ['warpColor', 'weftColor', 'bgColor'].forEach((id) =>
      els[id].addEventListener('input', scheduleRender));
    els.mirrorX.addEventListener('change', scheduleRender);
    els.mirrorY.addEventListener('change', scheduleRender);
    els.showSeams.addEventListener('change', render);

    els.presetRow.addEventListener('click', (event) => {
      const btn = event.target.closest('.preset-btn');
      if (!btn) return;
      activePreset = btn.dataset.preset;
      params = Object.assign({}, DEFAULTS, PRESETS[activePreset], { ssaa: 2 });
      writeForm();
      render();
    });

    els.exportBtn.addEventListener('click', () => {
      exportPng().catch((err) => flash(err.message, true));
    });
    els.saveBtn.addEventListener('click', () => saveParams(true));
    els.restoreBtn.addEventListener('click', () => {
      if (loadStored()) {
        render();
        flash('已恢复上次保存的参数。');
      } else {
        flash('没有找到已保存的参数。', true);
      }
    });
    els.resetBtn.addEventListener('click', () => {
      activePreset = 'plain';
      params = Object.assign({}, DEFAULTS, { ssaa: 2 });
      writeForm();
      render();
      flash('已重置为默认平纹参数。');
    });

  }

  bindEvents();
  if (!loadStored()) {
    params = Object.assign({}, DEFAULTS, PRESETS.plain, { ssaa: 2 });
    activePreset = 'plain';
  }
  writeForm();
  render();
})();
