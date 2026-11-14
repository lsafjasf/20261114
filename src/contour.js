// Contour extraction: intersect a horizontal plane y = level with the
// triangle mesh, then link crossing segments into connected polylines/loops.
// Every segment remembers its source triangle id for synchronized highlighting.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Contour = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EPS = 1e-9;

  function endpointKey(point, terrain) {
    // Snap to a grid vertex when the point coincides with one; otherwise use
    // quantized coordinates. Adjacent triangles crossing the same mesh edge
    // therefore always produce the same key.
    const n = terrain.resolution;
    const gi = Math.round((point.x + 0.5) * n);
    const gj = Math.round((point.z + 0.5) * n);
    if (gi >= 0 && gi <= n && gj >= 0 && gj <= n) {
      const v = terrain.vertexAt(gi, gj);
      const dx = v.x - point.x;
      const dz = v.z - point.z;
      if (dx * dx + dz * dz < 1e-12) return 'v' + v.index;
    }
    const qx = Math.round(point.x * 1e7);
    const qz = Math.round(point.z * 1e7);
    return 'q' + qx + ':' + qz;
  }

  function edgeCrossing(p1, p2, level) {
    const d1 = p1.h - level;
    const d2 = p2.h - level;
    if (Math.abs(d1) < EPS) return { x: p1.x, y: p1.h, z: p1.z };
    if (Math.abs(d2) < EPS) return { x: p2.x, y: p2.h, z: p2.z };
    if ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) {
      const t = d1 / (d1 - d2);
      return {
        x: p1.x + (p2.x - p1.x) * t,
        y: level,
        z: p1.z + (p2.z - p1.z) * t,
      };
    }
    return null;
  }

  // Returns { level, segments, polylines, stats }.
  function extractContour(terrain, level) {
    const segments = [];
    const adjacency = new Map();

    function touch(key, segmentId) {
      let list = adjacency.get(key);
      if (!list) {
        list = [];
        adjacency.set(key, list);
      }
      list.push(segmentId);
    }

    for (const tri of terrain.triangles) {
      const pts = tri.v.map((id) => terrain.vertices[id]);
      const crossings = [];
      for (let e = 0; e < 3; e++) {
        const hit = edgeCrossing(pts[e], pts[(e + 1) % 3], level);
        if (hit) crossings.push(hit);
      }
      // Deduplicate crossings that collapse onto the same grid vertex
      // (plane passing exactly through a mesh vertex).
      const unique = [];
      for (const c of crossings) {
        if (!unique.some((u) => u.x === c.x && u.z === c.z)) unique.push(c);
      }
      if (unique.length < 2) continue;
      // A triangle can produce at most one segment; with a vertex exactly on
      // the plane we may see 2 or 3 crossings, and 3 reduces to the segment
      // joining the two non-vertex boundary intersections.
      let pA;
      let pB;
      if (unique.length === 2) {
        pA = unique[0];
        pB = unique[1];
      } else {
        const onVertex = unique.filter((p) => endpointKey(p, terrain).charAt(0) === 'v');
        const interior = unique.filter((p) => endpointKey(p, terrain).charAt(0) !== 'v');
        if (interior.length === 2) {
          pA = interior[0];
          pB = interior[1];
        } else if (onVertex.length >= 2) {
          pA = onVertex[0];
          pB = onVertex[1];
        } else {
          pA = unique[0];
          pB = unique[1];
        }
      }
      const id = segments.length;
      const keyA = endpointKey(pA, terrain);
      const keyB = endpointKey(pB, terrain);
      if (keyA === keyB) continue;
      segments.push({
        id,
        triangleId: tri.id,
        a: pA,
        b: pB,
        keyA,
        keyB,
      });
      touch(keyA, id);
      touch(keyB, id);
    }

    // Link segments into polylines (open) and loops (closed). Walk every open
    // endpoint first; any segments left over form closed loops. Starting only
    // from endpoints prevents a single chain from being split into pieces.
    const used = new Set();
    const polylines = [];

    function otherKey(seg, key) {
      return seg.keyA === key ? seg.keyB : seg.keyA;
    }

    function walk(startId, startKey) {
      const chain = [];
      let currentKey = startKey;
      let nextId = startId;
      while (nextId != null && !used.has(nextId)) {
        used.add(nextId);
        const seg = segments[nextId];
        chain.push(seg);
        const exitKey = otherKey(seg, currentKey);
        const candidates = (adjacency.get(exitKey) || []).filter((sid) => !used.has(sid));
        nextId = candidates.length ? candidates[0] : null;
        currentKey = exitKey;
      }
      return chain;
    }

    // 1) Open polylines: one walk per degree-1 endpoint.
    for (const [key, ids] of adjacency) {
      if (ids.length !== 1) continue;
      const startId = ids[0];
      if (used.has(startId)) continue;
      const chain = walk(startId, key);
      polylines.push(buildPolyline(chain, key, false, segments));
    }

    // 2) Closed loops: every remaining segment belongs to a degree-2 loop.
    for (const seg of segments) {
      if (used.has(seg.id)) continue;
      const chain = walk(seg.id, seg.keyA);
      polylines.push(buildPolyline(chain, seg.keyA, true, segments));
    }

    let loopCount = 0;
    let openCount = 0;
    let totalLength = 0;
    for (const line of polylines) {
      if (line.closed) loopCount++;
      else openCount++;
      for (const sid of line.segmentIds) {
        const s = segments[sid];
        totalLength += Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z);
      }
    }

    return {
      level,
      segments,
      polylines,
      stats: {
        segmentCount: segments.length,
        polylineCount: polylines.length,
        loopCount,
        openCount,
        totalLength,
      },
    };
  }

  function buildPolyline(chain, startKey, closed, segments) {
    const points = [];
    let incoming = startKey;
    for (const seg of chain) {
      points.push(seg.keyA === incoming ? seg.a : seg.b);
      incoming = seg.keyA === incoming ? seg.keyB : seg.keyA;
    }
    const last = chain[chain.length - 1];
    if (closed) {
      // Close the loop visually.
      points.push({ x: points[0].x, y: points[0].y, z: points[0].z });
    } else {
      points.push(last.keyA === incoming ? last.a : last.b);
    }
    return {
      closed,
      points,
      segmentIds: chain.map((s) => s.id),
      triangleIds: chain.map((s) => s.triangleId),
    };
  }

  return { extractContour, edgeCrossing, endpointKey };
});
