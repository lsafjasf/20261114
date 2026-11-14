/* 盲文标牌排版器 UI：参数 -> 版面 -> SVG 预览 / 灰度高度图 / 导出 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const PX_PER_MM = 10; // 高度图与 PNG 导出分辨率

  const SAMPLE = '无障碍通道 Accessible Route\n请前行50米，乘电梯Elevator至B2层。\n服务热线：138-0011-2026';

  const pinyinFn = (window.pinyinPro && window.pinyinPro.pinyin)
    ? (run) => window.pinyinPro.pinyin(run, { toneType: 'num', type: 'array' })
    : null;

  function readParams() {
    return {
      text: $('inputText').value,
      maxCells: Number($('maxCells').value),
      dotDia: Number($('dotDia').value),
      dotPitch: Number($('dotPitch').value),
      cellPitch: Number($('cellPitch').value),
      linePitch: Number($('linePitch').value),
      margin: Number($('margin').value),
      emboss: document.querySelector('input[name="emboss"]:checked').value,
      withTone: $('withTone').checked,
      showEmpty: $('showEmpty').checked,
    };
  }

  // 版面几何：返回每个点的坐标与整体尺寸
  function computeGeometry(lines, p) {
    const nLines = lines.length;
    const maxLen = Math.max(1, ...lines.map((l) => l.length));
    const width = p.margin * 2 + maxLen * p.cellPitch;
    const height = p.margin * 2 + (nLines - 1) * p.linePitch + 2 * p.dotPitch + p.dotDia;
    const dots = [];   // {x, y} 凸起点中心
    const guides = []; // 空方定位点
    lines.forEach((line, li) => {
      const top = p.margin + li * p.linePitch + p.dotDia / 2;
      line.forEach((mask, ci) => {
        const left = p.margin + ci * p.cellPitch + (p.cellPitch - p.dotPitch) / 2;
        for (let d = 0; d < 6; d++) {
          const x = left + (d < 3 ? 0 : p.dotPitch);
          const y = top + (d % 3) * p.dotPitch;
          if (mask & (1 << d)) dots.push({ x, y });
          else guides.push({ x, y });
        }
      });
    });
    return { width, height, dots, guides, nLines, maxLen };
  }

  // ---- SVG 视觉点阵 ----
  const EMBOSS_DEFS = {
    dome: '<radialGradient id="dotGrad" cx="38%" cy="32%" r="75%">' +
      '<stop offset="0%" stop-color="#ffffff"/><stop offset="45%" stop-color="#e8e2d4"/>' +
      '<stop offset="85%" stop-color="#a89f8c"/><stop offset="100%" stop-color="#7d7462"/></radialGradient>',
    flat: '<radialGradient id="dotGrad" cx="50%" cy="50%" r="65%">' +
      '<stop offset="0%" stop-color="#f4efe3"/><stop offset="62%" stop-color="#f4efe3"/>' +
      '<stop offset="82%" stop-color="#b3aa96"/><stop offset="100%" stop-color="#8a8170"/></radialGradient>',
    cone: '<linearGradient id="dotGrad" x1="0%" y1="0%" x2="100%" y2="100%">' +
      '<stop offset="0%" stop-color="#ffffff"/><stop offset="50%" stop-color="#d9d2c0"/>' +
      '<stop offset="100%" stop-color="#857c6b"/></linearGradient>',
  };

  function buildSVG(geo, p) {
    const r = p.dotDia / 2;
    const parts = [];
    const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${geo.width}mm" height="${geo.height}mm" ` +
      `viewBox="0 0 ${geo.width} ${geo.height}">`;
    parts.push(head);
    parts.push(`<defs>${EMBOSS_DEFS[p.emboss]}</defs>`);
    parts.push(`<rect x="0" y="0" width="${geo.width}" height="${geo.height}" rx="3" fill="#f7f3ea" stroke="#c9c2b2" stroke-width="0.4"/>`);
    if (p.showEmpty) {
      for (const g of geo.guides) {
        parts.push(`<circle cx="${g.x.toFixed(2)}" cy="${g.y.toFixed(2)}" r="${(r * 0.9).toFixed(2)}" fill="none" stroke="#d8d0bd" stroke-width="0.15"/>`);
      }
    }
    const shadow = 0.18;
    for (const d of geo.dots) {
      parts.push(`<circle cx="${(d.x + shadow).toFixed(2)}" cy="${(d.y + shadow).toFixed(2)}" r="${r.toFixed(2)}" fill="rgba(60,50,30,0.28)"/>`);
    }
    for (const d of geo.dots) {
      parts.push(`<circle cx="${d.x.toFixed(2)}" cy="${d.y.toFixed(2)}" r="${r.toFixed(2)}" fill="url(#dotGrad)"/>`);
    }
    parts.push('</svg>');
    return parts.join('');
  }

  // ---- 灰度高度图（模拟触觉） ----
  const HEIGHT_PROFILE = {
    dome: [[0, 1], [0.35, 0.92], [0.7, 0.55], [1, 0]],
    flat: [[0, 1], [0.6, 1], [0.85, 0.45], [1, 0]],
    cone: [[0, 1], [0.5, 0.5], [1, 0]],
  };

  function renderHeightmap(canvas, geo, p) {
    const w = Math.max(1, Math.round(geo.width * PX_PER_MM));
    const h = Math.max(1, Math.round(geo.height * PX_PER_MM));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    const r = (p.dotDia / 2) * PX_PER_MM * 1.25; // 略微外扩模拟触摸扩散
    const profile = HEIGHT_PROFILE[p.emboss];
    for (const d of geo.dots) {
      const cx = d.x * PX_PER_MM;
      const cy = d.y * PX_PER_MM;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      for (const [t, v] of profile) {
        const g = Math.round(v * 255);
        grad.addColorStop(t, `rgb(${g},${g},${g})`);
      }
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---- 导出 ----
  function download(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  function exportSVG(svgText) {
    download(new Blob([svgText], { type: 'image/svg+xml' }), 'braille-sign.svg');
  }

  function exportPNG(svgText, geo) {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(geo.width * PX_PER_MM);
      canvas.height = Math.round(geo.height * PX_PER_MM);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => download(b, 'braille-sign.png'), 'image/png');
    };
    img.src = url;
  }

  // ---- 主渲染 ----
  let lastGeo = null;
  let lastSVG = '';

  function render() {
    const p = readParams();
    const { lines } = window.Braille.convert(p.text, {
      maxCells: p.maxCells,
      withTone: p.withTone,
      pinyinFn,
    });
    const geo = computeGeometry(lines, p);
    lastGeo = geo;
    lastSVG = buildSVG(geo, p);
    $('svgHost').innerHTML = lastSVG;
    renderHeightmap($('heightmap'), geo, p);
    $('unicodeOut').textContent = window.Braille.linesToUnicode(lines);
    const totalCells = lines.reduce((n, l) => n + l.length, 0);
    $('plateInfo').textContent =
      `牌面 ${geo.width.toFixed(0)} × ${geo.height.toFixed(0)} mm · ` +
      `${geo.nLines} 行 · 共 ${totalCells} 方 · 凸点 ${geo.dots.length} 个` +
      (pinyinFn ? '' : ' · ⚠ 拼音库未加载，汉字以满方占位');
  }

  // ---- 事件 ----
  function bind() {
    const ids = ['inputText', 'maxCells', 'dotDia', 'dotPitch', 'cellPitch',
      'linePitch', 'margin', 'withTone', 'showEmpty'];
    let timer = null;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(render, 80); };
    for (const id of ids) $(id).addEventListener('input', schedule);
    document.querySelectorAll('input[name="emboss"]').forEach((el) =>
      el.addEventListener('change', schedule));

    const syncOut = () => {
      for (const id of ['maxCells', 'dotDia', 'dotPitch', 'cellPitch', 'linePitch', 'margin']) {
        $('o_' + id).textContent = $(id).value;
      }
    };
    for (const id of ['maxCells', 'dotDia', 'dotPitch', 'cellPitch', 'linePitch', 'margin']) {
      $(id).addEventListener('input', syncOut);
    }
    syncOut();

    $('sampleBtn').addEventListener('click', () => { $('inputText').value = SAMPLE; render(); });
    $('exportSvg').addEventListener('click', () => exportSVG(lastSVG));
    $('exportPng').addEventListener('click', () => exportPNG(lastSVG, lastGeo));
    $('exportHeight').addEventListener('click', () =>
      $('heightmap').toBlob((b) => download(b, 'braille-heightmap.png'), 'image/png'));
  }

  $('inputText').value = SAMPLE;
  bind();
  render();
})();
