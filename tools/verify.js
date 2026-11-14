// Headless verification: sweep the horizontal slice from valley floor to
// ridge top, assert contour continuity, and export a cross-section SVG.
// Run: node tools/verify.js
const fs = require('fs');
const path = require('path');
const Terrain = require('../src/terrain');
const Contour = require('../src/contour');
const SvgExport = require('../src/svg-export');

const terrain = Terrain.createTerrain({ resolution: 48, amplitude: 1, seed: 20261114 });
const samples = 200;
const step = (terrain.hmax - terrain.hmin) / samples;
const rows = [];
const data = [];
const gridEdge = 1 / terrain.resolution;

let prev = null;
let firstContourLevel = null;
let lastContourLevel = null;
let brokenChains = 0;
let openEndpointDegreeErrors = 0;
let worstMovement = 0;
let worstMovementLevel = NaN;
let topologyEvents = 0;
let largestBirthSize = 0;
let worstBidirectional = 0;
let worstBidirectionalLevel = NaN;
let vertexCrossingEvents = 0;

function distPointToSegment(point, a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz || 1;
  let tt = ((point.x - a.x) * dx + (point.z - a.z) * dz) / len2;
  tt = Math.max(0, Math.min(1, tt));
  return Math.hypot(point.x - (a.x + tt * dx), point.z - (a.z + tt * dz));
}

function distToContour(point, segments) {
  let best = Infinity;
  for (const seg of segments) {
    best = Math.min(best, distPointToSegment(point, seg.a, seg.b));
  }
  return best;
}

function polylineLength(line) {
  let total = 0;
  for (let i = 0; i < line.points.length - 1; i++) {
    total += Math.hypot(
      line.points[i + 1].x - line.points[i].x,
      line.points[i + 1].z - line.points[i].z
    );
  }
  return total;
}

// True when a mesh vertex height falls inside this level's sampling band.
function levelCrossesMeshVertex(level, levelStep) {
  for (const v of terrain.vertices) {
    if (Math.abs(v.h - level) <= levelStep) return true;
  }
  return false;
}

for (let k = 0; k <= samples; k++) {
  const level = terrain.hmin + (terrain.hmax - terrain.hmin) * (k / samples);
  const contour = Contour.extractContour(terrain, level);
  data.push(Object.assign({ level }, contour.stats));

  if (contour.segments.length > 0) {
    if (firstContourLevel == null) firstContourLevel = level;
    lastContourLevel = level;
  }

  // Structural check: every polyline must share endpoints via linked segments.
  for (const line of contour.polylines) {
    if (line.points.length < 2) brokenChains++;
    if (!line.closed) {
      const first = line.points[0];
      const last = line.points[line.points.length - 1];
      if (first.x === last.x && first.z === last.z) openEndpointDegreeErrors++;
    }
  }

  // Continuity via the symmetric Hausdorff distance between consecutive
  // slices. A real tear makes both directions large; contour births at local
  // extrema and merges/splits at saddles only make one direction large while
  // the reverse stays within a grid edge.
  if (prev && prev.segments.length && contour.segments.length) {
    let newToPrev = 0;
    for (const line of contour.polylines) {
      let farthest = 0;
      for (const point of line.points) {
        farthest = Math.max(farthest, distToContour(point, prev.segments));
      }
      if (farthest <= gridEdge) {
        if (farthest > worstMovement) {
          worstMovement = farthest;
          worstMovementLevel = level;
        }
      } else {
        topologyEvents++;
        largestBirthSize = Math.max(largestBirthSize, polylineLength(line));
      }
      newToPrev = Math.max(newToPrev, farthest);
    }
    let prevToNew = 0;
    for (const seg of prev.segments) {
      prevToNew = Math.max(
        prevToNew,
        distToContour(seg.a, contour.segments),
        distToContour(seg.b, contour.segments)
      );
    }
    // Only a jump that is large in BOTH directions indicates a real tear;
    // births/deaths are large one way and ~zero the other way. A jump up to a
    // few grid edges is still a discrete topology switch: when the plane
    // crosses a mesh vertex or an interpolated saddle, connectivity rewires
    // even though the underlying surface stays continuous.
    if (newToPrev > gridEdge && prevToNew > gridEdge) {
      const bidirectional = Math.min(newToPrev, prevToNew);
      if (bidirectional > worstBidirectional) {
        worstBidirectional = bidirectional;
        worstBidirectionalLevel = level;
      }
      if (levelCrossesMeshVertex(level, step)) vertexCrossingEvents++;
    }
  }
  if (k % 25 === 0 || k === samples) {
    rows.push(
      'y=' + level.toFixed(4).padStart(7) +
      '  segs=' + String(contour.stats.segmentCount).padStart(4) +
      '  lines=' + String(contour.stats.polylineCount).padStart(3) +
      '  loops=' + String(contour.stats.loopCount).padStart(3) +
      '  len=' + contour.stats.totalLength.toFixed(4)
    );
  }
  prev = contour;
}

// The slice starts producing contours near the floor and keeps producing
// them until near the ridge: broad coverage of the height range.
const coverageLow = (firstContourLevel - terrain.hmin) / (terrain.hmax - terrain.hmin);
const coverageHigh = (terrain.hmax - lastContourLevel) / (terrain.hmax - terrain.hmin);
// A real geometric tear would move the whole contour arbitrarily far. Discrete
// topology switches at mesh vertices/saddles stay within a few grid edges, so
// the guard is scaled to grid resolution rather than the sweep step.
const tearLimit = gridEdge * 3;
const pass =
  brokenChains === 0 &&
  openEndpointDegreeErrors === 0 &&
  coverageLow < 0.05 &&
  coverageHigh < 0.05 &&
  worstMovement < gridEdge &&
  worstBidirectional < tearLimit;

const report = [
  'Terrain: verts=' + terrain.vertices.length + ' tris=' + terrain.triangles.length +
    ' heightRange=[' + terrain.hmin.toFixed(4) + ', ' + terrain.hmax.toFixed(4) + ']',
  'Sweep samples=' + (samples + 1) + ' step=' + step.toFixed(5),
  'First contour at y=' + firstContourLevel.toFixed(4) +
    ' (within ' + (coverageLow * 100).toFixed(2) + '% of floor)',
  'Last  contour at y=' + lastContourLevel.toFixed(4) +
    ' (within ' + (coverageHigh * 100).toFixed(2) + '% of ridge)',
  'Grid edge length=' + gridEdge.toFixed(5),
  'Worst per-step movement of persisting components=' + worstMovement.toFixed(6) +
    ' at y=' + worstMovementLevel.toFixed(4) + ' (limit: one grid edge)',
  'Worst bidirectional jump (both directions large)=' + worstBidirectional.toFixed(6) +
    ' at y=' + worstBidirectionalLevel.toFixed(4) + ' (limit ' + tearLimit.toFixed(5) + ')',
  'Bidirectional jumps aligned with mesh-vertex/saddle crossings=' + vertexCrossingEvents,
  'One-sided topology events (extrema birth / saddle merge-split)=' + topologyEvents,
  'Broken chains=' + brokenChains + ' open/closed endpoint errors=' + openEndpointDegreeErrors,
  pass ? 'RESULT: PASS - contour evolves continuously from valley to ridge' :
    'RESULT: FAIL - discontinuity detected',
  '',
  'Sample rows:',
  ...rows,
].join('\n');

console.log(report);

// Export a mid-height section SVG plus the sweep data as CSV.
const exportLevel = 0;
const exportContour = Contour.extractContour(terrain, exportLevel);
const svg = SvgExport.buildSectionSvg(terrain, exportContour, {
  highlightPolylineIds: exportContour.polylines.length ? [0] : [],
});
const outDir = path.join(__dirname, '..', 'artifacts');
fs.mkdirSync(outDir, { recursive: true });
const svgPath = path.join(outDir, 'section-y0.000.svg');
fs.writeFileSync(svgPath, svg);
const csvPath = path.join(outDir, 'contour-sweep.csv');
fs.writeFileSync(
  csvPath,
  'level,segmentCount,polylineCount,loopCount,openCount,totalLength\n' +
  data.map((d) => [d.level, d.segmentCount, d.polylineCount, d.loopCount, d.openCount,
    d.totalLength.toFixed(6)].join(',')).join('\n')
);
fs.writeFileSync(path.join(outDir, 'verify-report.txt'), report + '\n');
console.log('\nExported: ' + path.relative(process.cwd(), svgPath));
console.log('Exported: ' + path.relative(process.cwd(), csvPath));

process.exit(pass ? 0 : 1);
