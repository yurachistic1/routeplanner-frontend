// Geometry for routes on the map: simplifying and smoothing lines the way
// every mode draws them, and measuring along them. Points are [lon, lat].
// Moved out of loop.js on 2026-11-20 so Loop, GPS art and A to B share it.

// Metres per degree near London, good enough for simplifying.
export const M_LAT = 111320;
export const mLon = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);

// Douglas-Peucker on [lon, lat] points with a tolerance in metres.
export function simplify(pts, tol) {
  return keptIndices(pts, tol).map((i) => pts[i]);
}

// The indices of the points simplify keeps. It always keeps the ends and
// any fixed points, such as where a marked stretch starts or ends.
export function keptIndices(pts, tol, fixed = []) {
  const n = pts.length;
  if (n < 3) return pts.map((_, i) => i);
  const kx = mLon(pts[0][1]);
  const keep = new Uint8Array(n);
  const anchors = [...new Set([0, ...fixed.filter((i) => i > 0 && i < n - 1), n - 1])].sort((a, b) => a - b);
  for (const i of anchors) keep[i] = 1;
  const stack = anchors.slice(1).map((b, j) => [anchors[j], b]);
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = pts[a][0] * kx, ay = pts[a][1] * M_LAT;
    const bx = pts[b][0] * kx, by = pts[b][1] * M_LAT;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-9;
    let max = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i][0] * kx, py = pts[i][1] * M_LAT;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      const ex = ax + t * dx - px, ey = ay + t * dy - py;
      const d = ex * ex + ey * ey;
      if (d > max) { max = d; idx = i; }
    }
    if (max > tol * tol) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}

// Rounds each corner with an arc of (at most) radius metres, Strava style:
// the line stays on the roads and only the sharp corners are softened.
// A corner's arc can't use more than half of either neighbouring segment,
// so short wiggles get small arcs instead of being swallowed.
// If seg is given, it gets, for each point returned, the input segment the
// point lies on (segment i runs from pts[i] to pts[i + 1]). A corner's arc
// belongs to the segment before it up to its middle, then the one after.
export function roundCorners(pts, radius, seg = null) {
  if (pts.length < 3 || radius <= 0) {
    seg?.push(...pts.map((_, i) => Math.max(0, Math.min(i, pts.length - 2))));
    return pts;
  }
  const kx = mLon(pts[0][1]);
  const P = pts.map(([lon, lat]) => [lon * kx, lat * M_LAT]);
  const out = [pts[0]];
  seg?.push(0);
  for (let i = 1; i < P.length - 1; i++) {
    const [ax, ay] = P[i - 1], [bx, by] = P[i], [cx, cy] = P[i + 1];
    const ux = ax - bx, uy = ay - by, vx = cx - bx, vy = cy - by;
    const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
    if (lu < 1e-6 || lv < 1e-6) continue;
    // Angle between the two segments at this corner: π means straight on.
    const cos = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (lu * lv)));
    const angle = Math.acos(cos);
    if (angle > Math.PI * 0.97) { out.push(pts[i]); seg?.push(i); continue; } // nearly straight
    // Distance from the corner to where the arc starts and ends.
    const t = Math.min(radius / Math.tan(angle / 2), lu / 2, lv / 2);
    const p1 = [bx + (ux / lu) * t, by + (uy / lu) * t];
    const p2 = [bx + (vx / lv) * t, by + (vy / lv) * t];
    // Quadratic curve p1 → p2 pulled towards the corner: a near-circular arc.
    const steps = Math.max(2, Math.ceil((Math.PI - angle) / (Math.PI / 12)));
    for (let k = 0; k <= steps; k++) {
      const q = k / steps, a = (1 - q) * (1 - q), b = 2 * (1 - q) * q, c = q * q;
      const x = a * p1[0] + b * bx + c * p2[0], y = a * p1[1] + b * by + c * p2[1];
      out.push([x / kx, y / M_LAT]);
      seg?.push(2 * k <= steps ? i - 1 : i);
    }
  }
  out.push(pts[pts.length - 1]);
  seg?.push(pts.length - 2);
  return out;
}

export const metresPerPixel = (zoom, lat) => (40075016.7 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
// Corner radius on the map, in screen pixels.
export const CORNER_PX = 6;
// A line smoothed for the map at mpp metres per pixel: detail under a pixel
// dropped, corners rounded. The same as loop.js's shapeRoute for a route with no
// marked stretches; GPS art and A to B use it so their routes look the same.
export const smoothLine = (pts, mpp) => roundCorners(simplify(pts, mpp), CORNER_PX * mpp);

// Length of a line in metres (flat-earth, fine at running distances).
export function lineLength(pts) {
  let m = 0;
  for (let i = 1; i < pts.length; i++) m += segLength(pts[i - 1], pts[i]);
  return m;
}
export const segLength = (a, b) => Math.hypot((b[0] - a[0]) * mLon(a[1]), (b[1] - a[1]) * M_LAT);

// Whether a line ([lon, lat] points) ends where it starts, within a few
// metres: then its start marker stands for its finish too.
export const endsMeet = (pts) => pts.length < 2 || segLength(pts[0], pts.at(-1)) < 5;

// The point a fraction f of the way along the line.
export function pointAlong(pts, f) {
  let want = f * lineLength(pts);
  for (let i = 1; i < pts.length; i++) {
    const s = segLength(pts[i - 1], pts[i]);
    if (want <= s && s > 0) {
      const t = want / s;
      return [pts[i - 1][0] + t * (pts[i][0] - pts[i - 1][0]), pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1])];
    }
    want -= s;
  }
  return pts.at(-1);
}
