// Drawing a route that goes over itself (A to B, 2026-11-20). People may
// run a street as often as they like: out and back, laps, five laps. Every
// pass keeps its own line, side by side and centred on the street, so a
// doubled stretch reads as two lines rather than one (the user).
//
// Passes are found by shared edges: two legs that use the same street use
// the same points (the router's graph), and a freehand leg retraced is the
// same pair of points. An edge is the same edge whichever way it's run.
//
// routePieces(legs) splits the route into pieces with a steady number of
// passes, lane and kind of path, cut at the same points for every pass
// over a stretch, so each stretch is smoothed once and its lanes stay
// parallel. routeFeatures(pieces, zoom) draws them (the A to B layers in
// main.js read each feature's widths).
//
// How it looks (the user, 2026-11-20, after trying ten laps): the route is
// one line that moves sideways into its lane and out again, easing over a
// short distance, so every lap runs on into the next with no breaks or
// knots. Zoomed out the passes bunch into one thick line, and 10 laps look
// much like 100. From zoom LANES_FROM in they spread out, about LANE_M
// metres apart on the ground, so the lines can be counted.
//
// From LANES_FROM in the route also stops being smoothed (the user,
// 2026-11-23): smoothing only makes the whole route look nicer zoomed out,
// and lanes as wide as a street or more met it in knots at every bend.

import { CORNER_PX, M_LAT, mLon, metresPerPixel, roundCorners, simplify } from "./geometry.js";

// The route's widths at zoom 11 and 16, px: the same as the loop's route
// layers in main.js (W(2.2, 4.5) for the line, W(6, 13) for its halo).
const LINE = [2.2, 4.5];
const HALO = [6, 13];
const LANES_FROM = 19.5; // lanes are counted out from this zoom in, and the route is no longer smoothed (was 17, then 19.5: the user doesn't need laps apart sooner)
const LANE_M = 1.5; // lane centres apart on the ground, so a bundle stays about as wide as the street (was 3.5 m, 25 m wide for 4 laps there and back)
const BAND_M = 3.5; // how far apart the bunched passes are counted, for the band's width
const COUNT_PX = 4; // lanes at least this far apart on screen; with more passes than fit, one band
const SPREAD = 1; // at zoom 13 and out, all the lanes span at most one line width; it doubles each zoom in
const BAND = 3; // bunched up, the band is at most this many line widths
const MAX_PITCH = 2.5; // lane centres never more than this many line widths apart
const LANE_W = 2.5; // a counted-out lane's width, px (COUNT_PX apart leaves a 1.5 px gap)
const EASE_PX = 12; // the shortest a move between lanes takes, px
const EASE_SLOPE = 3; // and it takes at least this many times its sideways distance
const SHARP = (115 * Math.PI) / 180; // a sharper turn puts every lane on its outside (routeFeatures)
const REVERSAL = (176 * Math.PI) / 180; // and sharper than this is turning straight back
const atZoom = ([lo, hi], z) => lo + (hi - lo) * Math.max(0, Math.min(1, (z - 11) / 5));

// Points closer than about 10 cm are the same point.
const key = (p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
export const samePoint = (a, b) => key(a) === key(b);

// legs: [{ points: [[lon, lat], ...], country: [[i, j], ...] }], in order;
// country spans index the leg's points (uncertain paths, dashed).
// Returns [{ coords, n, lane, forward, kind, leg }] in route order: n
// passes over this piece, this pass is lane `lane` (0 the leftmost,
// looking the way the first pass ran), forward if it runs that way too,
// kind "plain" or "country", leg the index of the leg it's part of.
export function routePieces(legs) {
  // Every run along an edge, in order, and how many there are of each.
  const runs = legs.map((leg) => {
    const out = [];
    for (let i = 0; i < leg.points.length - 1; i++) {
      const a = key(leg.points[i]), b = key(leg.points[i + 1]);
      if (a === b) { out.push(null); continue; } // no length: drawn as nothing
      const country = (leg.country ?? []).some(([s, e]) => i >= s && i < e);
      out.push({ a, b, edge: a < b ? `${a}|${b}` : `${b}|${a}`, kind: country ? "country" : "plain" });
    }
    return out;
  });
  // Lanes, edge by edge: each way keeps to its own left, as on British
  // roads, the earliest pass outermost. So passes going the same way stay
  // together and in the same order wherever they meet others, and at a
  // junction they shift across as a group instead of crossing over.
  const passes = new Map(); // edge -> its runs, in route order
  for (const leg of runs) for (const r of leg) if (r) (passes.get(r.edge) ?? passes.set(r.edge, []).get(r.edge)).push(r);
  for (const list of passes.values()) {
    const n = list.length, way = list[0].a;
    let f = 0, b = 0;
    for (const r of list) {
      r.n = n;
      r.forward = r.a === way;
      r.lane = r.forward ? f++ : n - 1 - b++;
    }
  }
  // Where any pass's piece must end, every pass over that point ends its
  // piece too: legs' ends, and wherever passes, lane or kind change.
  const cuts = new Set();
  legs.forEach((leg, li) => {
    cuts.add(key(leg.points[0]));
    cuts.add(key(leg.points.at(-1)));
    const rs = runs[li];
    for (let i = 1; i < rs.length; i++) {
      const p = rs[i - 1], q = rs[i];
      if (!p || !q || p.n !== q.n || p.lane !== q.lane || p.kind !== q.kind || p.forward !== q.forward) cuts.add(key(leg.points[i]));
    }
  });
  const pieces = [];
  legs.forEach((leg, li) => {
    let cur = null;
    runs[li].forEach((r, i) => {
      if (!r) { cur = null; return; }
      if (!cur || cuts.has(r.a)) {
        cur = { coords: [leg.points[i]], n: r.n, lane: r.lane, forward: r.forward, kind: r.kind, leg: li };
        pieces.push(cur);
      }
      cur.coords.push(leg.points[i + 1]);
    });
  });
  return pieces;
}

// How a piece is drawn at zoom z: { d, w, mode, reach }: its sideways
// offset in metres (to the right of the way it's run), its width in px,
// "single", "band" (its passes bunched into one thick line) or "lanes",
// and how far its outermost lane reaches from the middle, metres. W: the
// route's usual width at z, mpp: metres per pixel. Lanes are counted out
// from zoom LANES_FROM, LANE_M apart but at least COUNT_PX on screen and at
// most MAX_PITCH line widths (from 19.5 that cap is what counts: about
// 0.7 m on the ground), when that many fit: up to 100 passes. Every
// lane has the same width, so a pass's line stays one line where the
// number of passes changes.
function laneStyle(p, z, W, mpp) {
  if (p.n < 2) return { d: 0, w: W, mode: "single", reach: 0 };
  const cap = Math.min((SPREAD * W * 2 ** Math.max(0, z - 13)) / (p.n - 1), MAX_PITCH * W);
  if (z < LANES_FROM || cap < COUNT_PX) {
    return { d: 0, w: Math.min(W + (p.n - 1) * Math.min(BAND_M / mpp, cap), BAND * W), mode: "band", reach: 0 };
  }
  const pitch = Math.min(Math.max(LANE_M / mpp, COUNT_PX), cap);
  const side = (p.lane - (p.n - 1) / 2) * (p.forward ? 1 : -1);
  return { d: side * pitch * mpp, w: Math.min(W, LANE_W), mode: "lanes", reach: ((p.n - 1) / 2) * pitch * mpp };
}

// The turn at b, going a → b → c (points in metres, y north): phi, how far
// it turns (0 straight on, π straight back), left, and the two directions.
function turnAt(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1];
  const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
  if (lu < 1e-9 || lv < 1e-9) return { phi: 0, left: false, lu, lv };
  const cos = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (lu * lv)));
  return { phi: Math.acos(cos), left: ux * vy - uy * vx > 0, lu, lv, u: [ux / lu, uy / lu], v: [vx / lv, vy / lv] };
}
const smoothstep = (x) => x * x * (3 - 2 * x);
// How far q is from the segment ab.
function distToSeg(q, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(a[0] + t * dx - q[0], a[1] + t * dy - q[1]);
}
// Where the line a → b, carried on past b, meets the line c → d coming up
// to c, or null.
function lineMeet(a, b, c, d) {
  const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const qx = c[0] - a[0], qy = c[1] - a[1];
  const t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
  return t >= 1 && u <= 0 ? [a[0] + t * rx, a[1] + t * ry] : null;
}
const lerp = (a, b, t) => a + (b - a) * t;
const lerp2 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
// Where segments ab and cd cross, as how far along ab (0-1), or null.
function crossAt(a, b, c, d) {
  const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const qx = c[0] - a[0], qy = c[1] - a[1];
  const t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
  return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9 ? t : null;
}

// GeoJSON for the route at zoom z: the pieces end to end as one line, each
// moved sideways into its lane, easing between lanes, then cut where the
// width or the kind of path changes. Properties: kind, multi (more than one
// pass), lanes (counted out one by one), w and h (line and halo width, px,
// for multi), dim (focus is a leg's index, or a Set of them, and this
// isn't part of it: A to B's Last leg lights up the last leg and dims the
// rest, 2026-11-22; a selected leg lights up with its Lap copies, 2026-11-26).
//
// Turns (the user, 2026-11-23: lanes broke up at turns, junctions and
// waypoints, with hooks, arrowheads and lanes crossing): every lane turns
// about the same centre, like lines on a transit map, so they stay side
// by side and none folds over itself.
export function routeFeatures(pieces, z, focus = -1) {
  if (!pieces.length) return { type: "FeatureCollection", features: [] };
  const lat0 = pieces[0].coords[0][1], kx = mLon(lat0), mpp = metresPerPixel(z, lat0);
  const W = atZoom(LINE, z), H = atZoom(HALO, z);
  const styles = pieces.map((p) => laneStyle(p, z, W, mpp));
  const R0 = CORNER_PX * mpp; // a corner's smallest radius: a single line's, and the inside lane's at a bend
  const smooth = z < LANES_FROM; // zoomed out, single lines and bands are smoothed like loops'; in, they follow the path

  // Each stretch simplified once, the way its first pass ran, and every
  // pass over it uses that same line, so the lanes stay parallel. Zoomed
  // out, a single line or a band gets its corners rounded here, like
  // loops' lines (geometry.js smoothLine); lanes get theirs below.
  const smoothed = new Map();
  const lineOf = (p, s) => {
    const run = p.forward ? p.coords : [...p.coords].reverse();
    const k = `${key(run[0])}>${key(run.at(-1))}#${run.length}@${s.mode}`;
    if (!smoothed.has(k)) smoothed.set(k, s.mode !== "lanes" && smooth ? roundCorners(simplify(run, mpp), R0) : simplify(run, mpp / 2));
    const line = smoothed.get(k);
    return p.forward ? line : [...line].reverse();
  };

  // 1. The route as one line, in metres; seg[i] is the piece of the
  // segment from pts[i] to pts[i + 1].
  let pts = [], seg = [];
  pieces.forEach((p, k) => {
    for (const [lon, lat] of lineOf(p, styles[k])) {
      const q = [lon * kx, lat * M_LAT];
      const last = pts.at(-1);
      if (last && Math.hypot(q[0] - last[0], q[1] - last[1]) < 0.01) continue;
      if (pts.length) seg.push(k);
      pts.push(q);
    }
  });
  if (pts.length < 2) return { type: "FeatureCollection", features: [] };

  // 2. Corners where there are lanes (a single line's or a band's were
  // rounded in lineOf, zoomed out). A bend is
  // rounded with a radius of at least the lanes' reach and R0, so every
  // lane goes round it about the same centre and the inside one still
  // has R0. A sharper turn than SHARP stays a corner: no rounding could
  // fit the lanes inside it without crossing or turning well short of
  // it, so they all move out to its outside (step 4) and go round it in
  // arcs. Turning straight back has no outside: the lanes, each keeping
  // left, are already either side, and go round its far side.
  const cp = [pts[0]], cs = [], corner = [null]; // corner[i]: { back } or { out, shift } where cp[i] stays a corner
  const add = (q, k, c = null) => {
    const last = cp.at(-1);
    if (Math.hypot(q[0] - last[0], q[1] - last[1]) < 0.01) { // the same point (two bends' arcs meet)
      if (c) corner[corner.length - 1] = c;
      return;
    }
    cp.push(q); cs.push(k); corner.push(c);
  };
  for (let i = 1; i < pts.length - 1; i++) {
    const kin = seg[i - 1], kout = seg[i];
    const lanes = styles[kin].mode === "lanes" || styles[kout].mode === "lanes";
    if (!lanes) { add(pts[i], kin); continue; } // a single line or band: rounded already (lineOf), zoomed out; a waypoint stays sharp, so the line reaches it
    const t = turnAt(pts[i - 1], pts[i], pts[i + 1]);
    const reach = Math.max(styles[kin].reach, styles[kout].reach);
    if (t.phi < 1e-3) add(pts[i], kin);
    else if (t.phi > REVERSAL) add(pts[i], kin, { back: true });
    else if (reach > 0 && t.phi > SHARP) add(pts[i], kin, { out: t.left ? 1 : -1, shift: reach });
    else {
      const along = Math.min((reach + R0) * Math.tan(t.phi / 2), t.lu / 2, t.lv / 2);
      const r = along / Math.tan(t.phi / 2), sgn = t.left ? 1 : -1;
      const a = [pts[i][0] - t.u[0] * along, pts[i][1] - t.u[1] * along];
      const c = [a[0] - sgn * t.u[1] * r, a[1] + sgn * t.u[0] * r]; // the arc's centre, on the inside
      const a0 = Math.atan2(a[1] - c[1], a[0] - c[0]);
      const steps = Math.max(2, Math.ceil(t.phi / (Math.PI / 12)));
      for (let q = 0; q <= steps; q++) {
        const ang = a0 + sgn * t.phi * (q / steps);
        add([c[0] + Math.cos(ang) * r, c[1] + Math.sin(ang) * r], 2 * q <= steps ? kin : kout);
      }
    }
  }
  add(pts.at(-1), seg.at(-1));
  pts = cp;
  seg = cs;

  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const from = new Map(), to = new Map(); // each piece's stretch, metres along the route
  seg.forEach((k, i) => {
    if (!from.has(k)) from.set(k, cum[i]);
    to.set(k, cum[i + 1]);
  });

  // 3. Where the offset changes, it eases from one to the other, centred
  // on the change and never using more than 45% of either piece.
  const eases = [];
  for (let i = 1; i < seg.length; i++) {
    const a = seg[i - 1], b = seg[i], da = styles[a].d, db = styles[b].d;
    if (a === b || Math.abs(da - db) < 1e-6) continue;
    const want = Math.max(EASE_PX * mpp, EASE_SLOPE * Math.abs(da - db)) / 2;
    eases.push({ at: cum[i], half: Math.min(want, 0.45 * (cum[i] - from.get(a)), 0.45 * (to.get(b) - cum[i])), da, db });
  }

  // 4. At a sharp corner every lane moves out by as far as the lanes
  // reach, so the inside one runs through the corner and the rest go
  // round it, easing over as far as a change of lane would (and never
  // into the next corner).
  const kept = [];
  corner.forEach((c, i) => { if (c) kept.push(i); });
  const shifts = [];
  kept.forEach((i, j) => {
    const c = corner[i];
    if (c.back) return;
    const prev = j > 0 ? cum[kept[j - 1]] : 0, next = j < kept.length - 1 ? cum[kept[j + 1]] : cum.at(-1);
    const want = Math.max(EASE_PX * mpp, EASE_SLOPE * c.shift);
    shifts.push({ at: cum[i], before: Math.min(want, 0.45 * (cum[i] - prev)), after: Math.min(want, 0.45 * (next - cum[i])), d: c.out * c.shift });
  });
  const shiftAt = (s) => {
    let d = 0;
    for (const sh of shifts) {
      const x = s < sh.at ? (sh.at - s) / sh.before : (s - sh.at) / sh.after;
      if (x < 1) d += sh.d * smoothstep(1 - x);
    }
    return d;
  };

  // 5. Points where each ease starts and ends, and along each shift, then
  // every point's offset.
  const P = [pts[0]], S = [0], K = [], C = [corner[0]]; // points, metres along, piece of the segment ending at each point (K[i] for P[i + 1]), corners
  const marks = [
    ...eases.flatMap((e) => [e.at - e.half, e.at + e.half]),
    ...shifts.flatMap((sh) => Array.from({ length: 13 }, (_, q) => (q < 6 ? sh.at - sh.before * (1 - q / 6) : sh.at + sh.after * ((q - 6) / 6)))),
  ].sort((x, y) => x - y);
  let m = 0;
  for (let i = 1; i < pts.length; i++) {
    while (m < marks.length && marks[m] <= cum[i - 1] + 0.01) m++;
    while (m < marks.length && marks[m] < cum[i] - 0.01) {
      const t = (marks[m] - cum[i - 1]) / (cum[i] - cum[i - 1]);
      P.push(lerp2(pts[i - 1], pts[i], t));
      S.push(marks[m]);
      K.push(seg[i - 1]);
      C.push(null);
      m++;
    }
    P.push(pts[i]);
    S.push(cum[i]);
    K.push(seg[i - 1]);
    C.push(corner[i]);
  }
  const D = new Array(P.length);
  let e = 0;
  for (let i = 0; i < P.length; i++) {
    while (e < eases.length && S[i] > eases[e].at + eases[e].half + 1e-6) e++;
    const ez = eases[e];
    if (ez && S[i] >= ez.at - ez.half - 1e-6) {
      D[i] = ez.half > 0 ? ez.da + ((ez.db - ez.da) * (S[i] - (ez.at - ez.half))) / (2 * ez.half) : (S[i] < ez.at ? ez.da : ez.db);
    } else {
      D[i] = styles[i > 0 ? K[i - 1] : K[0]].d; // a point goes with the segment ending at it
    }
    if (shifts.length) D[i] += shiftAt(S[i]);
  }

  // 6. Every point moved sideways by its offset: along the corner's
  // bisector (a mitre) where the line bends a little; round the outside
  // of a corner in an arc (and round the far side of a turn straight
  // back, where the lanes' arcs nest like a hairpin bend); on the inside,
  // to where the two sides meet, any fold that leaves cut out in step 7.
  const normal = (a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return [dy / l, -dx / l]; // to the right of a → b
  };
  // From v1 to v2 (offsets from p) the way round that passes ahead (u).
  const arc = (p, v1, v2, u) => {
    const a1 = Math.atan2(v1[1], v1[0]), r1 = Math.hypot(...v1), r2 = Math.hypot(...v2);
    let da = Math.atan2(v2[1], v2[0]) - a1;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da <= -Math.PI) da += 2 * Math.PI;
    const mid = a1 + da / 2;
    if (Math.cos(mid) * u[0] + Math.sin(mid) * u[1] < 0) da -= Math.sign(da || 1) * 2 * Math.PI;
    const steps = Math.max(2, Math.ceil(Math.abs(da) / (Math.PI / 12)));
    const out = [];
    for (let s = 0; s <= steps; s++) {
      const q = s / steps, a = a1 + da * q, r = r1 + (r2 - r1) * q;
      out.push([p[0] + Math.cos(a) * r, p[1] + Math.sin(a) * r]);
    }
    return out;
  };
  // outK[j]: piece of the segment ending at out[j + 1]; outD, outS: each point's offset and metres along the route
  let out = [], outK = [], outD = [], outS = [];
  const push = (p, k, d, s) => { if (out.length) outK.push(k); out.push(p); outD.push(d); outS.push(s); };
  for (let i = 0; i < P.length; i++) {
    const d = D[i], p = P[i], s = S[i];
    const kin = i > 0 ? K[i - 1] : K[0], kout = i < K.length ? K[i] : kin;
    if (Math.abs(d) < 1e-6) { push(p, kin, 0, s); continue; }
    const n1 = i > 0 ? normal(P[i - 1], p) : null, n2 = i < P.length - 1 ? normal(p, P[i + 1]) : null;
    if (!n1 || !n2) { const nn = n1 ?? n2; push([p[0] + nn[0] * d, p[1] + nn[1] * d], kin, d, s); continue; }
    const bx = n1[0] + n2[0], by = n1[1] + n2[1], bl = Math.hypot(bx, by), cosHalf = bl / 2;
    // a segment's direction is its right-hand normal turned left: (-ny, nx);
    // turning left when in × out > 0, which works out as u · n2
    const u = [-n1[1], n1[0]], turnLeft = u[0] * n2[0] + u[1] * n2[1] > 0;
    const outside = d > 0 === turnLeft;
    if (!C[i]?.back && cosHalf > 0.97) {
      push([p[0] + (bx / bl) * (d / cosHalf), p[1] + (by / bl) * (d / cosHalf)], kin, d, s);
    } else if (C[i]?.back || outside) {
      arc(p, [n1[0] * d, n1[1] * d], [n2[0] * d, n2[1] * d], u).forEach((q, j) => push(q, j ? kout : kin, d, s));
    } else if (cosHalf > 0.5) {
      push([p[0] + (bx / bl) * (d / cosHalf), p[1] + (by / bl) * (d / cosHalf)], kin, d, s);
    } else {
      push([p[0] + n1[0] * d, p[1] + n1[1] * d], kin, d, s);
      push([p[0] + n2[0] * d, p[1] + n2[1] * d], kout, d, s);
    }
  }

  // 7. Where moving the line sideways folded it over itself (the inside
  // of a bend tighter than the lane's offset, or a stretch too short for
  // its lanes), cut the fold out: drop every point that came out nearer
  // the route close by than its own offset, then any small loop left.
  const maxReach = Math.max(...styles.map((st) => st.reach));
  if (maxReach > 0) {
    const at = (s) => { // the index of the last point of P at or before s
      let lo = 0, hi = S.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (S[mid] <= s) lo = mid; else hi = mid - 1; }
      return lo;
    };
    const tol = mpp / 2;
    const near = (q, s, lim, span) => {
      const i1 = Math.min(at(s + span) + 1, P.length - 1);
      for (let a = at(s - span); a < i1; a++) if (distToSeg(q, P[a], P[a + 1]) < lim) return true;
      return false;
    };
    const ok = out.map((q, i) => {
      const d = Math.abs(outD[i]);
      return i === 0 || i === out.length - 1 || d < 2 * tol || !near(q, outS[i], d - Math.max(tol, 0.03 * d), 2 * d + tol);
    });
    let nO = [out[0]], nK = [], nD = [outD[0]], nS = [outS[0]];
    let last = 0;
    for (let i = 1; i < out.length; i++) {
      if (!ok[i]) continue;
      if (i > last + 1 && last > 0 && i < out.length - 1) {
        // across the gap: where the lines either side meet, if that's close by
        const x = lineMeet(out[last - 1], out[last], out[i], out[i + 1]);
        const reachX = 3 * Math.abs(outD[i]) + tol;
        if (x && Math.hypot(x[0] - out[last][0], x[1] - out[last][1]) < reachX && Math.hypot(x[0] - out[i][0], x[1] - out[i][1]) < reachX) {
          nO.push(x); nK.push(outK[last]); nD.push(outD[last]); nS.push(outS[last]);
        }
      }
      nO.push(out[i]); nK.push(outK[i - 1]); nD.push(outD[i]); nS.push(outS[i]);
      last = i;
    }
    [out, outK, outD, outS] = [nO, nK, nD, nS];

      const WIN = Math.max(12 * maxReach, 30 * mpp);
    // The route between s0 and s1 crosses itself or comes back to where
    // it was (out and back to a waypoint, a lollipop): then a lane
    // crossing itself there is the route's own shape, not a fold.
    const routeReturns = (s0, s1, d) => {
      const i0 = at(s0), i1 = Math.min(at(s1) + 1, P.length - 1);
      const close = Math.max(0.5 * d, tol), apart = 4 * d + tol;
      for (let a = i0; a < i1; a++) {
        for (let b = a + 2; b < i1; b++) {
          if (crossAt(P[a], P[a + 1], P[b], P[b + 1]) !== null) return true;
          if (S[b] - S[a + 1] > apart && distToSeg(P[b], P[a], P[a + 1]) < close) return true;
        }
      }
      return false;
    };
    nO = [out[0]]; nK = []; nD = [outD[0]]; nS = [outS[0]];
    for (let j = 0; j < out.length - 1;) {
      let best = -1, bt = 0;
      for (let k = j + 2; k < out.length - 1 && outS[k] - outS[j + 1] <= WIN; k++) {
        const t = crossAt(out[j], out[j + 1], out[k], out[k + 1]);
        if (t !== null) { best = k; bt = t; }
      }
      // only a small fold: no longer along the route than a few times the
      // lanes' offset there, and not the route's own shape
      let d = 0;
      for (let k = j; k <= best + 1 && best >= 0; k++) d = Math.max(d, Math.abs(outD[k]));
      if (best >= 0 && outS[best + 1] - outS[j] <= 8 * d + 10 * mpp && !routeReturns(outS[j], outS[best + 1], d)) {
        // the crossing, then on along segment best from there
        const x = lerp2(out[j], out[j + 1], bt);
        nO.push(x); nK.push(outK[j]); nD.push(lerp(outD[j], outD[j + 1], bt)); nS.push(lerp(outS[j], outS[j + 1], bt));
        out[best] = x; outD[best] = nD.at(-1); outS[best] = nS.at(-1);
        j = best;
        continue;
      }
      nO.push(out[j + 1]); nK.push(outK[j]); nD.push(outD[j + 1]); nS.push(outS[j + 1]);
      j++;
    }
    [out, outK, outD, outS] = [nO, nK, nD, nS];
  }

  // Last, any back-step left a few pixels long (where points
  // of the route are closer together than its lanes are wide).
  const tiny = 6 * mpp;
  for (let pass = 0; pass < 3; pass++) {
    const keep = out.map(() => true);
    for (let i = 1; i < out.length - 1; i++) {
      const a = out[i - 1], b = out[i], c = out[i + 1];
      const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1];
      const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
      if ((lu < tiny || lv < tiny) && ux * vx + uy * vy < -0.5 * lu * lv) { keep[i] = false; i++; }
    }
    if (keep.every(Boolean)) break;
    const nO = [], nK = [], nD = [], nS = [];
    out.forEach((q, i) => {
      if (!keep[i]) return;
      if (nO.length) nK.push(outK[i - 1]);
      nO.push(q); nD.push(outD[i]); nS.push(outS[i]);
    });
    [out, outK, outD, outS] = [nO, nK, nD, nS];
  }

  // 8. Cut where the width or the kind of path changes; back to lon, lat.
  // A band is the same line for every pass over it, so only the first
  // pass draws it (once, so it doesn't stack up where the line fades,
  // zoomed in, and its dashes stay in step); the others draw only their
  // way in and out of it. The focus leg draws its own over a dimmed one,
  // so it stays lit there too.
  const features = [];
  const lit = focus instanceof Set ? (l) => focus.has(l) : (l) => l === focus;
  const focused = focus instanceof Set ? focus.size > 0 : focus >= 0;
  const dim = (k) => focused && !lit(pieces[k].leg);
  const repeat = (j) => styles[outK[j]].mode === "band" && pieces[outK[j]].lane > 0 && outD[j] === 0 && outD[j + 1] === 0 && !lit(pieces[outK[j]].leg);
  const styleKey = (j) => {
    const s = styles[outK[j]];
    return `${pieces[outK[j]].kind}|${s.mode}|${s.mode === "band" ? s.w.toFixed(2) : ""}|${repeat(j)}|${dim(outK[j])}`;
  };
  let start = 0;
  for (let j = 0; j <= outK.length; j++) {
    if (j < outK.length && (j === start || styleKey(j) === styleKey(start))) continue;
    const k = outK[start], multi = pieces[k].n > 1, w = styles[k].w;
    if (repeat(start)) { start = j; continue; }
    features.push({
      type: "Feature",
      properties: { kind: pieces[k].kind, multi, lanes: styles[k].mode === "lanes", w, h: w + H - W, dim: dim(k) },
      geometry: { type: "LineString", coordinates: out.slice(start, j + 1).map(([x, y]) => [x / kx, y / M_LAT]) },
    });
    start = j;
  }
  return { type: "FeatureCollection", features };
}
