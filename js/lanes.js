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
// much like 100. Zoomed in they spread out, about LANE_M metres apart on
// the ground, so the lines can be counted.

import { CORNER_PX, M_LAT, mLon, metresPerPixel, roundCorners, simplify } from "./geometry.js";

// The route's widths at zoom 11 and 16, px: the same as the loop's route
// layers in main.js (W(2.2, 4.5) for the line, W(6, 13) for its halo).
const LINE = [2.2, 4.5];
const HALO = [6, 13];
const LANE_M = 3.5; // lane centres apart on the ground, zoomed in
const COUNT_PX = 4; // lanes this far apart or more are drawn one by one; closer, as one band
const SPREAD = 1; // at zoom 13 and out, all the lanes span at most one line width; it doubles each zoom in
const BAND = 3; // bunched up, the band is at most this many line widths
const MAX_PITCH = 2.5; // lane centres never more than this many line widths apart
const LANE_W = 2.5; // a counted-out lane's width, px (COUNT_PX apart leaves a 1.5 px gap)
const EASE_PX = 12; // the shortest a move between lanes takes, px
const EASE_SLOPE = 3; // and it takes at least this many times its sideways distance
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
// once they can be LANE_M apart or COUNT_PX on screen, whichever is more:
// ten laps from about zoom 16, twenty from 17. Every lane has the same
// width, so a pass's line stays one line where the number of passes
// changes.
function laneStyle(p, z, W, mpp) {
  if (p.n < 2) return { d: 0, w: W, mode: "single", reach: 0 };
  const cap = (SPREAD * W * 2 ** Math.max(0, z - 13)) / (p.n - 1);
  const pitch = Math.min(LANE_M / mpp, cap, MAX_PITCH * W);
  if (pitch < COUNT_PX) return { d: 0, w: Math.min(W + (p.n - 1) * pitch, BAND * W), mode: "band", reach: 0 };
  const side = (p.lane - (p.n - 1) / 2) * (p.forward ? 1 : -1);
  return { d: side * pitch * mpp, w: Math.min(W, LANE_W), mode: "lanes", reach: ((p.n - 1) / 2) * pitch * mpp };
}

// A line smoothed over about reach metres either side: points every few
// metres, then two passes of a moving average whose window narrows towards
// the ends, so the ends stay put (and pieces still meet). mpp: metres per
// pixel, for dropping the detail that's left under a pixel.
function gentle(run, mpp, reach) {
  const kx = mLon(run[0][1]);
  const xy = run.map(([lon, lat]) => [lon * kx, lat * M_LAT]);
  const step = Math.max(mpp, reach / 3);
  const pts = [xy[0]];
  for (let i = 1; i < xy.length; i++) {
    const [a, b] = [xy[i - 1], xy[i]], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let s = step; s < len; s += step) pts.push([a[0] + ((b[0] - a[0]) * s) / len, a[1] + ((b[1] - a[1]) * s) / len]);
    pts.push(b);
  }
  const half = Math.max(1, Math.round((1.5 * reach) / step));
  let cur = pts;
  for (let pass = 0; pass < 2; pass++) {
    cur = cur.map((p, i) => {
      const h = Math.min(half, i, cur.length - 1 - i);
      let x = 0, y = 0;
      for (let j = i - h; j <= i + h; j++) { x += cur[j][0]; y += cur[j][1]; }
      return [x / (2 * h + 1), y / (2 * h + 1)];
    });
  }
  return simplify(cur.map(([x, y]) => [x / kx, y / M_LAT]), mpp);
}

// GeoJSON for the route at zoom z: the pieces end to end as one line, each
// moved sideways into its lane, easing between lanes, then cut where the
// width or the kind of path changes. Properties: kind, multi (more than one
// pass), lanes (counted out one by one), w and h (line and halo width, px,
// for multi), dim (focus is a leg's index and this isn't part of it: A to
// B's Last leg lights up the last leg and dims the rest, 2026-11-22).
export function routeFeatures(pieces, z, focus = -1) {
  if (!pieces.length) return { type: "FeatureCollection", features: [] };
  const lat0 = pieces[0].coords[0][1], kx = mLon(lat0), mpp = metresPerPixel(z, lat0);
  const W = atZoom(LINE, z), H = atZoom(HALO, z);
  const styles = pieces.map((p) => laneStyle(p, z, W, mpp));

  // Each stretch smoothed once, the way its first pass ran, and every pass
  // over it uses that same line, so the lanes stay parallel. Like loops'
  // lines (geometry.js smoothLine), but where there are lanes it's smoothed
  // over about as far as they reach, so small zigzags (crossing a road from
  // one pavement to the other) become gentle bends that every lane can
  // follow, instead of hairpins.
  const smoothed = new Map();
  const lineOf = (p, s) => {
    const run = p.forward ? p.coords : [...p.coords].reverse();
    const k = `${key(run[0])}>${key(run.at(-1))}#${run.length}@${s.reach.toFixed(2)}`;
    if (!smoothed.has(k)) {
      smoothed.set(k, s.mode === "lanes" ? gentle(run, mpp, s.reach) : roundCorners(simplify(run, mpp), CORNER_PX * mpp));
    }
    const line = smoothed.get(k);
    return p.forward ? line : [...line].reverse();
  };

  // 1. The route as one line, in metres; seg[i] is the piece of the
  // segment from pts[i] to pts[i + 1].
  const pts = [], seg = [];
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
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const from = new Map(), to = new Map(); // each piece's stretch, metres along the route
  seg.forEach((k, i) => {
    if (!from.has(k)) from.set(k, cum[i]);
    to.set(k, cum[i + 1]);
  });

  // 2. Where the offset changes, it eases from one to the other, centred
  // on the change and never using more than 45% of either piece.
  const eases = [];
  for (let i = 1; i < seg.length; i++) {
    const a = seg[i - 1], b = seg[i], da = styles[a].d, db = styles[b].d;
    if (a === b || Math.abs(da - db) < 1e-6) continue;
    const want = Math.max(EASE_PX * mpp, EASE_SLOPE * Math.abs(da - db)) / 2;
    eases.push({ at: cum[i], half: Math.min(want, 0.45 * (cum[i] - from.get(a)), 0.45 * (to.get(b) - cum[i])), da, db });
  }

  // 3. Points where each ease starts and ends, then every point's offset.
  const P = [pts[0]], S = [0], K = []; // points, metres along, piece of the segment ending at each point (K[i] for P[i + 1])
  const marks = eases.flatMap((e) => [e.at - e.half, e.at + e.half]).sort((x, y) => x - y);
  let m = 0;
  for (let i = 1; i < pts.length; i++) {
    while (m < marks.length && marks[m] <= cum[i - 1] + 1e-6) m++;
    while (m < marks.length && marks[m] < cum[i] - 1e-6) {
      const t = (marks[m] - cum[i - 1]) / (cum[i] - cum[i - 1]);
      P.push([pts[i - 1][0] + t * (pts[i][0] - pts[i - 1][0]), pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1])]);
      S.push(marks[m]);
      K.push(seg[i - 1]);
      m++;
    }
    P.push(pts[i]);
    S.push(cum[i]);
    K.push(seg[i - 1]);
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
  }

  // 4. Every point moved sideways by its offset: along the corner's
  // bisector (a mitre), or at a sharp turn round the far side of the corner
  // in an arc (turning back on yourself, the lanes' arcs nest like a
  // hairpin bend); on the inside of a sharp turn, a mitre no longer than
  // twice the offset.
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
    const steps = Math.max(2, Math.ceil(Math.abs(da) / (Math.PI / 10)));
    const pts = [];
    for (let s = 0; s <= steps; s++) {
      const q = s / steps, a = a1 + da * q, r = r1 + (r2 - r1) * q;
      pts.push([p[0] + Math.cos(a) * r, p[1] + Math.sin(a) * r]);
    }
    return pts;
  };
  const out = [], outK = [], outD = []; // outK[j]: piece of the segment ending at out[j + 1]; outD: each point's offset
  const push = (p, k, d) => { if (out.length) outK.push(k); out.push(p); outD.push(d); };
  for (let i = 0; i < P.length; i++) {
    const d = D[i], p = P[i];
    const kin = i > 0 ? K[i - 1] : K[0], kout = i < K.length ? K[i] : kin;
    if (Math.abs(d) < 1e-9) { push(p, kin, 0); continue; }
    const n1 = i > 0 ? normal(P[i - 1], p) : null, n2 = i < P.length - 1 ? normal(p, P[i + 1]) : null;
    if (!n1 || !n2) { const nn = n1 ?? n2; push([p[0] + nn[0] * d, p[1] + nn[1] * d], kin, d); continue; }
    const bx = n1[0] + n2[0], by = n1[1] + n2[1], bl = Math.hypot(bx, by), cosHalf = bl / 2;
    // a segment's direction is its right-hand normal turned left: (-ny, nx);
    // turning left when in × out > 0, which works out as u · n2
    const u = [-n1[1], n1[0]], turnLeft = u[0] * n2[0] + u[1] * n2[1] > 0;
    const outside = d > 0 === turnLeft;
    if (cosHalf > 0.5) {
      push([p[0] + (bx / bl) * (d / cosHalf), p[1] + (by / bl) * (d / cosHalf)], kin, d);
    } else if (cosHalf > 0.26 && !outside) {
      const m = Math.min(1 / cosHalf, 2) * d;
      push([p[0] + (bx / bl) * m, p[1] + (by / bl) * m], kin, d);
    } else {
      const pts = arc(p, [n1[0] * d, n1[1] * d], [n2[0] * d, n2[1] * d], u);
      pts.forEach((q, s) => push(q, s ? kout : kin, d));
    }
  }

  // 5. Cut where the width or the kind of path changes; back to lon, lat.
  // A band is the same line for every pass over it, so only the first
  // pass draws it (once, so it doesn't stack up where the line fades,
  // zoomed in, and its dashes stay in step); the others draw only their
  // way in and out of it. The focus leg draws its own over a dimmed one,
  // so it stays lit there too.
  const features = [];
  const dim = (k) => focus >= 0 && pieces[k].leg !== focus;
  const repeat = (j) => styles[outK[j]].mode === "band" && pieces[outK[j]].lane > 0 && outD[j] === 0 && outD[j + 1] === 0 && pieces[outK[j]].leg !== focus;
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
