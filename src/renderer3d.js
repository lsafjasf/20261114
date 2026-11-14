// Canvas 2D software renderer for the triangle-mesh terrain: orbit camera,
// painter's-algorithm depth sort, horizontal slice plane and contour overlay.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Renderer3D = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  // Height -> terrain color (valley green -> ridge warm gray).
  function heightColor(h, hmin, hmax) {
    const t = clamp((h - hmin) / (hmax - hmin || 1), 0, 1);
    const stops = [
      [30, 77, 121],   // deep valley blue-green
      [46, 139, 87],   // green slope
      [181, 166, 116], // dry highland
      [232, 226, 214], // pale ridge
    ];
    const f = t * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(f));
    const k = f - i;
    const a = stops[i];
    const b = stops[i + 1];
    return [
      Math.round(a[0] + (b[0] - a[0]) * k),
      Math.round(a[1] + (b[1] - a[1]) * k),
      Math.round(a[2] + (b[2] - a[2]) * k),
    ];
  }

  function createRenderer(canvas) {
    const ctx = canvas.getContext('2d');

    const view = {
      yaw: 0.7,
      pitch: 0.45,
      scale: 1,
    };

    function rotate(point) {
      const cy = Math.cos(view.yaw);
      const sy = Math.sin(view.yaw);
      const x1 = point.x * cy - point.z * sy;
      const z1 = point.x * sy + point.z * cy;
      const cp = Math.cos(view.pitch);
      const sp = Math.sin(view.pitch);
      const y2 = point.y * cp - z1 * sp;
      const z2 = point.y * sp + z1 * cp;
      return { x: x1, y: y2, z: z2 };
    }

    function project(point, width, height) {
      const r = rotate(point);
      const s = view.scale * Math.min(width, height) * 0.85;
      return {
        x: width / 2 + r.x * s,
        y: height / 2 - r.y * s,
        depth: r.z,
      };
    }

    function shade(base, factor) {
      return 'rgb(' + clamp(Math.round(base[0] * factor), 0, 255) + ',' +
        clamp(Math.round(base[1] * factor), 0, 255) + ',' +
        clamp(Math.round(base[2] * factor), 0, 255) + ')';
    }

    function faceNormal(verts, ids) {
      const a = verts[ids[0]];
      const b = verts[ids[1]];
      const c = verts[ids[2]];
      const ux = b.x - a.x;
      const uy = b.y - a.y;
      const uz = b.z - a.z;
      const vx = c.x - a.x;
      const vy = c.y - a.y;
      const vz = c.z - a.z;
      return {
        x: uy * vz - uz * vy,
        y: uz * vx - ux * vz,
        z: ux * vy - uy * vx,
      };
    }

    function render(terrain, contour, level, options) {
      const opts = options || {};
      const highlight = new Set(opts.highlightSegmentIds || []);
      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      // Sky gradient background.
      const bg = ctx.createLinearGradient(0, 0, 0, height);
      bg.addColorStop(0, '#e8eef6');
      bg.addColorStop(1, '#f7fafc');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      // Draw the slice plane first (opaque-ish quad at y = level).
      const planeCorners = [
        { x: -0.5, y: level, z: -0.5 },
        { x: 0.5, y: level, z: -0.5 },
        { x: 0.5, y: level, z: 0.5 },
        { x: -0.5, y: level, z: 0.5 },
      ].map((p) => project(p, width, height));
      ctx.beginPath();
      ctx.moveTo(planeCorners[0].x, planeCorners[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(planeCorners[i].x, planeCorners[i].y);
      ctx.closePath();
      ctx.fillStyle = 'rgba(59,130,246,0.16)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(29,78,216,0.85)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Project and sort triangles back-to-front.
      const projected = new Array(terrain.vertices.length);
      for (let i = 0; i < terrain.vertices.length; i++) {
        const v = terrain.vertices[i];
        projected[i] = project({ x: v.x, y: v.h, z: v.z }, width, height);
      }
      const drawList = terrain.triangles.map((tri) => {
        const p = tri.v.map((id) => projected[id]);
        const depth = (p[0].depth + p[1].depth + p[2].depth) / 3;
        return { tri, p, depth };
      }).sort((a, b) => b.depth - a.depth);

      for (const item of drawList) {
        const normal = faceNormal(terrain.vertices, item.tri.v);
        const len = Math.hypot(normal.x, normal.y, normal.z) || 1;
        const light = clamp(0.72 + 0.5 * (normal.y / len), 0.55, 1.18);
        const avgH = item.tri.v.reduce((s, id) => s + terrain.vertices[id].h, 0) / 3;
        const color = shade(heightColor(avgH, terrain.hmin, terrain.hmax), light);
        ctx.beginPath();
        ctx.moveTo(item.p[0].x, item.p[0].y);
        ctx.lineTo(item.p[1].x, item.p[1].y);
        ctx.lineTo(item.p[2].x, item.p[2].y);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = 'rgba(15,23,42,0.12)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }

      // Contour overlay, sorted back-to-front, drawn as thick bright strokes.
      const segDraw = contour.segments.map((seg) => {
        const pa = project(seg.a, width, height);
        const pb = project(seg.b, width, height);
        return { seg, pa, pb, depth: (pa.depth + pb.depth) / 2 };
      }).sort((a, b) => b.depth - a.depth);

      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      for (const item of segDraw) {
        const isHi = highlight.has(item.seg.id);
        if (isHi) {
          ctx.beginPath();
          ctx.moveTo(item.pa.x, item.pa.y);
          ctx.lineTo(item.pb.x, item.pb.y);
          ctx.strokeStyle = 'rgba(249,115,22,0.35)';
          ctx.lineWidth = 10;
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.moveTo(item.pa.x, item.pa.y);
        ctx.lineTo(item.pb.x, item.pb.y);
        ctx.strokeStyle = isHi ? '#ea580c' : 'rgba(220,38,38,0.95)';
        ctx.lineWidth = isHi ? 4.5 : 2.2;
        ctx.stroke();
      }
      if (highlight.size) {
        for (const item of segDraw) {
          if (!highlight.has(item.seg.id)) continue;
          for (const p of [item.pa, item.pb]) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
            ctx.fillStyle = '#ea580c';
            ctx.fill();
          }
        }
      }
    }

    // Pick the nearest-to-camera triangle under a screen point.
    function pickTriangle(terrain, sx, sy) {
      const width = canvas.width;
      const height = canvas.height;
      const projected = terrain.vertices.map((v) =>
        project({ x: v.x, y: v.h, z: v.z }, width, height));
      let best = null;
      for (const tri of terrain.triangles) {
        const p = tri.v.map((id) => projected[id]);
        if (!pointInTriangle(sx, sy, p[0], p[1], p[2])) continue;
        const depth = (p[0].depth + p[1].depth + p[2].depth) / 3;
        if (!best || depth > best.depth) best = { triangleId: tri.id, depth };
      }
      return best;
    }

    function pointInTriangle(px, py, a, b, c) {
      const d1 = sign(px, py, a, b);
      const d2 = sign(px, py, b, c);
      const d3 = sign(px, py, c, a);
      const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
      const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
      return !(hasNeg && hasPos);
    }

    function sign(px, py, a, b) {
      return (px - b.x) * (a.y - b.y) - (a.x - b.x) * (py - b.y);
    }

    return { view, rotate, project, render, pickTriangle, heightColor };
  }

  return { createRenderer };
});
