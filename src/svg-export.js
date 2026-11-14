// Standalone SVG export of a horizontal slice (top-down x/z cross section).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SvgExport = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function escapeXml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Map terrain coordinates (x,z in [-0.5, 0.5]) into SVG pixel space.
  function makeProjector(size, margin) {
    const scale = (size - margin * 2) / 1;
    return function (x, z) {
      return {
        x: margin + (x + 0.5) * scale,
        y: margin + (z + 0.5) * scale,
      };
    };
  }

  function buildSectionSvg(terrain, contour, options) {
    const opts = options || {};
    const size = opts.size || 720;
    const margin = 64;
    const project = makeProjector(size, margin);
    const highlightIds = new Set(opts.highlightPolylineIds || []);
    const stroke = opts.stroke || '#1d4ed8';
    const highlight = opts.highlight || '#f97316';

    const parts = [];
    parts.push(
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size +
        '" viewBox="0 0 ' + size + ' ' + size + '" font-family="Helvetica, Arial, sans-serif">'
    );
    parts.push('<rect width="100%" height="100%" fill="#ffffff"/>');

    // Title and slice metadata.
    parts.push(
      '<text x="' + margin + '" y="30" font-size="18" font-weight="700" fill="#111827">' +
        escapeXml('Horizontal slice y=' + contour.level.toFixed(4)) + '</text>'
    );
    parts.push(
      '<text x="' + (size - margin) + '" y="30" font-size="12" text-anchor="end" fill="#4b5563">' +
        escapeXml(
          'polylines=' + contour.stats.polylineCount +
          ' loops=' + contour.stats.loopCount +
          ' segments=' + contour.stats.segmentCount
        ) + '</text>'
    );

    // Terrain footprint and grid.
    const p00 = project(-0.5, -0.5);
    parts.push(
      '<rect x="' + p00.x + '" y="' + p00.y + '" width="' + (size - margin * 2) +
        '" height="' + (size - margin * 2) + '" fill="#f8fafc" stroke="#94a3b8" stroke-width="1.5"/>'
    );
    for (let t = 1; t < 10; t++) {
      const c = -0.5 + t / 10;
      const px = project(c, -0.5);
      const pz = project(-0.5, c);
      parts.push('<line x1="' + px.x + '" y1="' + margin + '" x2="' + px.x + '" y2="' + (size - margin) +
        '" stroke="#e2e8f0" stroke-width="1"/>');
      parts.push('<line x1="' + margin + '" y1="' + pz.y + '" x2="' + (size - margin) + '" y2="' + pz.y +
        '" stroke="#e2e8f0" stroke-width="1"/>');
    }

    // Axis labels (terrain x horizontally, z vertically).
    const labelStyle = 'font-size="12" fill="#4b5563" text-anchor="middle"';
    for (let t = 0; t <= 4; t++) {
      const value = -0.5 + t * 0.25;
      const px = project(value, -0.5);
      const pz = project(-0.5, value);
      parts.push('<text x="' + px.x + '" y="' + (size - margin + 18) + '" ' + labelStyle + '>' +
        value.toFixed(2) + '</text>');
      parts.push('<text x="' + (margin - 10) + '" y="' + (pz.y + 4) + '" font-size="12" fill="#4b5563" ' +
        'text-anchor="end">' + value.toFixed(2) + '</text>');
    }
    parts.push('<text x="' + (size / 2) + '" y="' + (size - 8) + '" font-size="13" fill="#111827" ' +
      'text-anchor="middle">x</text>');
    parts.push('<text x="' + (margin - 28) + '" y="' + (margin - 8) +
      '" font-size="13" fill="#111827" text-anchor="start">z ↑</text>');

    // Contour polylines.
    contour.polylines.forEach(function (line, index) {
      const d = line.points.map(function (p, pi) {
        const q = project(p.x, p.z);
        return (pi === 0 ? 'M' : 'L') + q.x.toFixed(2) + ' ' + q.y.toFixed(2);
      }).join(' ');
      const isHi = highlightIds.has(index);
      const color = isHi ? highlight : stroke;
      const width = isHi ? 4 : 2;
      parts.push('<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="' + width +
        '" stroke-linejoin="round" stroke-linecap="round" data-polyline="' + index + '"/>');
    });
    parts.push('</svg>');
    return parts.join('\n');
  }

  return { buildSectionSvg, makeProjector };
});
