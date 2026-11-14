// Top-down 2D cross-section view with polyline hit-testing for synchronized
// highlighting against the 3D terrain view.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Section2D = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function createSectionView(canvas) {
    const ctx = canvas.getContext('2d');
    const margin = 34;

    function projector(width, height) {
      const size = Math.min(width, height) - margin * 2;
      return function (x, z) {
        return {
          x: margin + (x + 0.5) * size,
          y: margin + (z + 0.5) * size,
        };
      };
    }

    function render(terrain, contour, options) {
      const opts = options || {};
      const highlightPolylines = new Set(opts.highlightPolylineIds || []);
      const width = canvas.width;
      const height = canvas.height;
      const project = projector(width, height);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);

      // Footprint + light grid.
      const origin = project(-0.5, -0.5);
      const size = Math.min(width, height) - margin * 2;
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(origin.x, origin.y, size, size);
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(origin.x, origin.y, size, size);
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      for (let t = 1; t < 10; t++) {
        const g = origin.x + (t / 10) * size;
        ctx.beginPath();
        ctx.moveTo(g, origin.y);
        ctx.lineTo(g, origin.y + size);
        ctx.stroke();
        const gy = origin.y + (t / 10) * size;
        ctx.beginPath();
        ctx.moveTo(origin.x, gy);
        ctx.lineTo(origin.x + size, gy);
        ctx.stroke();
      }

      // Polylines.
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      contour.polylines.forEach((line, index) => {
        const isHi = highlightPolylines.has(index);
        ctx.beginPath();
        line.points.forEach((p, pi) => {
          const q = project(p.x, p.z);
          if (pi === 0) ctx.moveTo(q.x, q.y);
          else ctx.lineTo(q.x, q.y);
        });
        ctx.strokeStyle = isHi ? '#ea580c' : '#1d4ed8';
        ctx.lineWidth = isHi ? 4 : 2;
        ctx.stroke();
      });

      // Axis ticks/labels.
      ctx.fillStyle = '#475569';
      ctx.font = '10px Helvetica, Arial, sans-serif';
      ctx.textAlign = 'center';
      for (let t = 0; t <= 4; t++) {
        const v = -0.5 + t * 0.25;
        const gx = origin.x + t * 0.25 * size;
        ctx.fillText(v.toFixed(2), gx, origin.y + size + 14);
        const gy = origin.y + t * 0.25 * size;
        ctx.textAlign = 'right';
        ctx.fillText(v.toFixed(2), origin.x - 6, gy + 3);
        ctx.textAlign = 'center';
      }
      ctx.fillStyle = '#0f172a';
      ctx.font = '12px Helvetica, Arial, sans-serif';
      ctx.fillText('x (top-down slice at y=' + contour.level.toFixed(3) + ')', width / 2, height - 6);
      ctx.textAlign = 'left';
      ctx.fillText('z ↑', 6, 14);
    }

    function distanceToSegment(px, py, a, b) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy || 1;
      let t = ((px - a.x) * dx + (py - a.y) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const qx = a.x + t * dx;
      const qy = a.y + t * dy;
      return Math.hypot(px - qx, py - qy);
    }

    // Returns the polyline id under the cursor (within tolerance) or null.
    function pickPolyline(contour, sx, sy, width, height) {
      const project = projector(width, height);
      let best = null;
      contour.polylines.forEach((line, index) => {
        for (let i = 0; i < line.points.length - 1; i++) {
          const a = project(line.points[i].x, line.points[i].z);
          const b = project(line.points[i + 1].x, line.points[i + 1].z);
          const d = distanceToSegment(sx, sy, a, b);
          if (d <= 8 && (!best || d < best.distance)) {
            best = { polylineId: index, distance: d };
          }
        }
      });
      return best;
    }

    return { render, pickPolyline, projector };
  }

  return { createSectionView };
});
