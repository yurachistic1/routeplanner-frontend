// A to B mode (built 2026-11-20, frontend first; design in ROADMAP "A to
// B", mockups in designs/p2p-mockups/). Tap the map to place points: the
// first is the start, the next the finish, and each tap after that makes
// the old finish a via point and goes on to the new finish. No Generate, no
// distance: the route is whatever you tap.
//
// Each leg is routed the way chosen when it's placed: Pleasant (the loop
// router's taste: parks, quiet streets, paths), Shortest, or Freehand (a
// straight line), with Minimise climb on or off. Changing them sets the
// next leg; tapping their heading (Next leg / Last leg, 2026-11-22) makes
// them re-route the last leg instead, to compare, but nothing older ever
// changes. Tapping the start closes the route into a loop:
// only the start marker shows there, and tapping on carries on from it.
// Routes may go over themselves as often as wanted (laps, out and back);
// each pass gets its own lane on the map (js/lanes.js). Moving or removing
// points is the Edit mode's job, not this one's.
//
// Each leg is asked of the leg service (LEGS_BASE/leg, the backend's
// leg.go) on its own, from the end of the route so far to the tap: it
// knows nothing of the legs before. Answers are kept, so going back and
// forth between routings asks the server once for each.
// Routed points sit on a path or street (the server moves them onto the
// nearest one, and the start with them); after a Freehand leg the next
// routed leg starts with a straight join to the path. A tap that can't be
// routed places nothing and says why in the warning line under the
// routing. Climb and descent are counted here over the whole route, from
// the legs' heights, the way the backend counts a loop's (climbOf).
//
// Like every mode it keeps to its own map source ("p2p") and markers, and
// hides loop mode's route while it's on screen. Page elements: .p2p in the
// deck (#p2p-*) and #p2p-hint, #p2p-distance in the top bar. Body classes
// (CSS reads them in this mode only): p2p-has-point, p2p-has-leg,
// p2p-has-route (the route's part of the panel, as it grows and shrinks),
// p2p-can-undo, p2p-folded, p2p-warnings, p2p-no-details.

import { LEGS_BASE } from "./api.js";
import { lineLength, M_LAT, metresPerPixel, mLon, pointAlong, segLength } from "./geometry.js";
import { routeFeatures, routePieces, samePoint } from "./lanes.js";
import { setSourceVisible } from "./map.js";
import { attachGrip, createSmoother } from "./panel.js";
import { climbOf, heightsAt, renderProfile, shrinkProfile, smoothHeights } from "./profile.js";
import { whyNotHere } from "./spot.js";
import { $, toast } from "./ui.js";

const EMPTY = { type: "FeatureCollection", features: [] };
const body = document.body;
const half = (z) => Math.round(z * 2) / 2;
const km = (m) => (m / 1000).toFixed(1);
const COUNTRY_WARN_M = 100; // as loop.js: uncertain paths are worth a warning from 100 m
const SNAP_WAYPOINT_PX = 22; // a tap this close to a waypoint lands on it
const SNAP_LAST_PX = 6; // but on the last one only this close: a second tap on the same spot
const SNAP_ROUTE_PX = 12; // and this close to the route, on the route
const LAP_NEAR_M = 5; // the route ends on an earlier pass when it's this close to it
const LAP_MIN_M = 50; // and the lap since then is at least this long
// A routed leg that ends this near where it set off, though the tap was
// further, got nowhere: no path comes nearer the tap (see tapAt).
const NOWHERE_M = 10;
// A routed tap (and a Pleasant or Shortest start) must land on a way the
// server can route on, give or take a fingertip on the map (the user,
// 2026-11-21): otherwise a tap on a private road, or a trunk road with
// nowhere to walk, would jump to some other path nearby. In metres, kept
// between 15 and 300 (as the server keeps it).
const TAP_PX = 24;
const MAX_SAVED_M = 250000; // the longest route favourites take (firestore.rules; 60 km until 2026-11-21)
const PROFILE_POINTS = 600; // at most this many heights in the profile
const HEIGHT_STEP_M = 5; // the route's heights are worked on this far apart, as the backend's
// A leg is at most this long in a straight line (the user, 2026-11-20), so
// the server doesn't load the map, and route, across half the country for
// one tap (20 km takes it about a quarter of a second). Longer routes are
// fine: place points on the way. The server refuses longer legs too.
const MAX_LEG_M = 20000;

/**
 * createP2PMode(map, mapReady, opts) wires up the A to B panel and returns
 * { enter, leave } for js/modes.js.
 *   addP2PLayers(map): adds the layers that draw source "p2p" (pieces from
 *     js/lanes.js, with their widths and offsets as properties)
 *   favourites: { toggle(route), has(route), onChange(fn) } from accounts
 *   exportRoute(route): opens the export dialog (js/export.js)
 *   padding(): {top, bottom, left, right}, px, to keep the route clear of
 *     the top bar, the panel and the buttons over the map
 */
export function createP2PMode(map, mapReady, opts) {
  // points: the waypoints, [lon, lat]. Leg i runs from points[i] to
  // points[i + 1]: { routing, minimiseClimb, tap (the tap that placed it,
  // as routeLeg takes it, to route it again; null on a lap's copies),
  // points ([lon, lat], its line), elevation (heights evenly spaced from
  // its first point to its last, as the map has them, or null), country
  // ([[i, j]] spans of uncertain path, by point) }.
  // scope: what a change of routing changes, "next" or "last" (see "the routing").
  const state = { points: [], legs: [], routing: "pleasant", minimiseClimb: false, scope: "next" };
  const undos = []; // earlier { points, legs, session }, newest last
  // The route being made, from the first point until Clear: once hearted,
  // it is that favourite, saved as it changes (link: the favourite's id).
  // Undo after Clear brings back the route and its link with it.
  let session = { link: null };
  let queue = Promise.resolve(); // taps are routed one at a time, in order
  let taps = 0; // taps made, to number them
  const waiting = []; // the numbers of taps not placed yet, oldest first
  const dropped = new Set(); // ones Undo or Clear took back before they were
  let route = null; // the whole route as one (whole()), for the profile, export and favourites
  let pieces = []; // the route split for drawing (js/lanes.js)
  let markers = [];
  let pointMarker = null; // where you are on the profile, on the map
  let shownKey = null; // the half zoom the line on screen was smoothed for

  const mine = () => body.dataset.mode === "p2p";
  const ready = mapReady.then(() => {
    map.addSource("p2p", { type: "geojson", data: EMPTY });
    opts.addP2PLayers(map);
  });

  // ----- the leg service -----
  // POSTs to it as text/plain, so the browser doesn't ask the server first
  // (CORS), and resolves to its JSON answer. Fails with err.reason as the
  // server gives it (too_far, no_path_near with err.end, no_route, no_map,
  // same_point), or "offline".
  async function ask(path, body) {
    let res, data;
    try {
      res = await fetch(`${LEGS_BASE}${path}`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(body) });
      data = await res.json();
    } catch (err) {
      throw Object.assign(new Error("no answer"), { reason: "offline", cause: err });
    }
    if (!res.ok) throw Object.assign(new Error(data?.error ?? res.status), { reason: data?.reason ?? "offline", end: data?.end });
    return data;
  }
  // How near a way a tap at ll must land, in metres (TAP_PX).
  const reachAt = (ll) => Math.round(Math.min(300, Math.max(15, TAP_PX * metresPerPixel(map.getZoom(), ll[1]))));

  // Answers from /leg by request, newest last, and its refusals (not "no
  // answer"): a change of routing re-routes the last leg, so going back to
  // one already seen shows at once and asks nothing.
  const answers = new Map();
  const KEEP_ANSWERS = 100;
  const SETTLED = new Set(["too_far", "no_path_near", "no_route", "no_map", "same_point"]); // the same every time
  async function askLeg(req) {
    const key = JSON.stringify(req);
    let got = answers.get(key);
    if (!got) {
      try {
        got = { data: await ask("/leg", req) };
      } catch (err) {
        if (!SETTLED.has(err.reason)) throw err;
        got = { err };
      }
    }
    answers.delete(key);
    answers.set(key, got);
    if (answers.size > KEEP_ANSWERS) answers.delete(answers.keys().next().value);
    if (got.err) throw got.err;
    return got.data;
  }

  // One leg, for a tap { from, to, join, reach }. join: from stays where
  // it is, off the paths (after a Freehand leg, or a start placed with
  // Freehand), and the leg starts with a straight line to the nearest one.
  // reach: how near a way to must be (reachAt, at the zoom of the tap).
  // Freehand legs are asked too, for their heights; without an answer
  // they're drawn all the same, with none.
  async function routeLeg(tap, { routing, minimiseClimb }) {
    const { from, to, join, reach } = tap;
    const leg = { routing, minimiseClimb, tap, points: [from, to], elevation: null, country: [] };
    let data;
    try {
      // the server doesn't use Minimise climb on Freehand, so one answer does for both
      data = await askLeg({ from: [from[1], from[0]], to: [to[1], to[0]], routing, minimiseClimb: routing !== "freehand" && minimiseClimb, join, reach });
    } catch (err) {
      if (routing === "freehand" && err.reason !== "too_far") return leg;
      throw err;
    }
    return {
      ...leg,
      points: data.path.map(([lat, lon]) => [lon, lat]),
      elevation: data.elevation?.length > 1 ? data.elevation : null,
      country: data.countryPathSpans ?? [],
    };
  }
  // The leg for a tap, routed as settings say, or why there's none:
  // { leg }, or { refused, detail } with a reason as the server gives it.
  async function legFor(tap, settings) {
    const far = segLength(tap.from, tap.to);
    let leg;
    try {
      leg = await routeLeg(tap, settings);
    } catch (err) {
      if (!err.reason) throw err;
      // The nearest spot on a path to the tap is where the route already
      // ends (a tap out past the end of a path, say): say so, unless the
      // tap was as good as on it.
      return { refused: err.reason === "same_point" && far > NOWHERE_M ? "no_nearer" : err.reason, detail: { ...err, at: tap.to } };
    }
    // the same, when the nearest spot is only a step along
    if (settings.routing !== "freehand" && far > 2 * NOWHERE_M && lineLength(leg.points) < NOWHERE_M) return { refused: "no_nearer", detail: {} };
    return { leg };
  }
  // Where a Pleasant or Shortest route can start near a tap: on the nearest
  // way it can route on, within TAP_PX, so a start can't go where no leg
  // could set off (the sea, a private road). Fails as ask does. The server
  // fetches the map round it meanwhile, for the first leg.
  async function startAt(ll) {
    const { point: [lat, lon] } = await ask("/leg/snap", { at: [ll[1], ll[0]], reach: reachAt(ll) });
    return [lon, lat];
  }
  // Wakes the leg service.
  function warm() {
    fetch(`${LEGS_BASE}/leg/warm`).catch(() => {});
  }
  // Starts placed with Freehand, which stay where they were put: the first
  // routed leg joins them to the paths rather than moving them.
  const placedFree = new WeakSet();

  // ----- placing points -----
  // Taps are queued, so quick taps are routed in the order they were made.
  // Undo while one is still on its way takes that one back (see undo).
  function tapAt(ll) {
    const id = ++taps;
    waiting.push(id);
    const { routing, minimiseClimb } = state; // as chosen when tapped
    queue = queue.then(async () => {
      if (dropped.has(id)) return;
      if (!state.points.length) {
        if (routing === "freehand") {
          placedFree.add(ll);
          return commit([ll], []);
        }
        let start;
        try {
          start = await startAt(ll);
        } catch (err) {
          if (!dropped.has(id)) refuse(err.reason, { end: "start", at: ll });
          return;
        }
        if (!dropped.has(id)) commit([start], []);
        return;
      }
      const from = state.points.at(-1);
      if (samePoint(from, ll)) return; // no leg to nowhere
      const far = segLength(from, ll);
      if (far > MAX_LEG_M) return refuse("too_far", { far });
      const join = state.legs.length ? state.legs.at(-1).routing === "freehand" : placedFree.has(state.points[0]);
      const got = await legFor({ from, to: ll, join, reach: reachAt(ll) }, { routing, minimiseClimb });
      if (dropped.has(id)) return;
      if (got.refused) return refuse(got.refused, got.detail);
      const { leg } = got;
      // the first routed leg moves the start onto the path it sets off along
      const points = state.legs.length ? state.points : [leg.points[0]];
      commit([...points, leg.points.at(-1)], [...state.legs, leg]);
    }).finally(() => {
      waiting.splice(waiting.indexOf(id), 1);
      dropped.delete(id);
    }).catch((err) => {
      console.error(err);
      toast("Couldn't add that point. Try again?");
    });
  }
  // ----- laps -----
  // Where the route ends on a spot it came through before (a tap on a
  // waypoint or on the line), Lap adds the lap since then again: from
  // that earlier pass, the same way round, back to here (the user,
  // 2026-11-21). Copied from the legs, so no asking the server.

  // The earlier pass the route's end is on: walking back from the end,
  // past the way in, the first stretch that comes back within LAP_NEAR_M
  // of it (the most recent pass, so the shortest lap). { leg, seg, t,
  // from }: the leg, the segment of its points and how far along it
  // (0-1), and metres from the start; null if there's none.
  function lapAt() {
    const { legs, points } = state;
    if (!legs.length) return null;
    const end = points.at(-1), mx = mLon(end[1]);
    const xy = ([lon, lat]) => [(lon - end[0]) * mx, (lat - end[1]) * M_LAT];
    let start = legs.reduce((sum, leg) => sum + lineLength(leg.points), 0); // where the leg being walked starts
    let left = false, best = null;
    for (let i = legs.length - 1; i >= 0; i--) {
      const pts = legs[i].points;
      start -= lineLength(pts);
      for (let j = pts.length - 2; j >= 0; j--) {
        const [ax, ay] = xy(pts[j]), [bx, by] = xy(pts[j + 1]), dx = bx - ax, dy = by - ay;
        const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
        const d = Math.hypot(ax + t * dx, ay + t * dy);
        if (d > LAP_NEAR_M) {
          if (best) return best; // past the nearest point of that pass
          left = true;
        } else if (left && (!best || d < best.d)) {
          best = { leg: i, seg: j, t, d, from: start + lineLength(pts.slice(0, j + 1)) + t * segLength(pts[j], pts[j + 1]) };
        }
      }
    }
    return best;
  }
  // The lap as legs: the leg the earlier pass is on, from there to its
  // end (starting exactly here), then copies of every leg after it. No
  // tap: a change of routing after a Lap is for the next leg only (the
  // user, 2026-11-22), so the lap stays a true copy.
  function lapLegs(lap) {
    const { legs, points } = state;
    const leg = legs[lap.leg], pts = leg.points;
    const rest = [points.at(-1), ...pts.slice(lap.seg + 1)];
    const out = lineLength(rest) > 1 ? [{ ...leg, tap: null, points: rest, elevation: cutHeights(leg, lap), country: cutSpans(leg.country, lap.seg) }] : [];
    return [...out, ...legs.slice(lap.leg + 1).map((l) => ({ ...l, tap: null }))];
  }
  // The heights from the pass to the leg's end, evenly spaced over that
  // part as a leg's are over the whole of it.
  function cutHeights({ points: pts, elevation: hs }, { seg, t }) {
    if (!hs) return null;
    const length = lineLength(pts), d0 = lineLength(pts.slice(0, seg + 1)) + t * segLength(pts[seg], pts[seg + 1]);
    const n = Math.max(2, Math.round((length - d0) / HEIGHT_STEP_M) + 1);
    return Array.from({ length: n }, (_, k) => {
      const f = ((d0 + (k / (n - 1)) * (length - d0)) / (length || 1)) * (hs.length - 1);
      const i = Math.min(Math.floor(f), hs.length - 2);
      return hs[i] + (f - i) * (hs[i + 1] - hs[i]);
    });
  }
  // Uncertain stretches ([from, to] point indices) after point seg, for
  // the leg's points from seg on, the first being here.
  const cutSpans = (spans, seg) => (spans ?? [])
    .filter(([, e]) => e > seg)
    .map(([s, e]) => [Math.max(0, s - seg), e - seg]);

  // Lap goes in the queue with the taps, so it comes after any still
  // being routed, and Undo can take it back before it's placed.
  function addLap() {
    const id = ++taps;
    waiting.push(id);
    queue = queue.then(() => {
      const lap = dropped.has(id) ? null : lapAt();
      if (!lap) return;
      const legs = lapLegs(lap);
      commit([...state.points, ...legs.map((l) => l.points.at(-1))], [...state.legs, ...legs]);
    }).finally(() => {
      waiting.splice(waiting.indexOf(id), 1);
      dropped.delete(id);
    }).catch((err) => {
      console.error(err);
      toast("Couldn't add the lap. Try again?");
    });
  }

  // Every change goes through here, so Undo can take it back. next: the
  // session it starts (Clear), the route before it saved first.
  function commit(points, legs, next = session) {
    refuse(null);
    if (next !== session) flushSave();
    undos.push({ points: state.points, legs: state.legs, session });
    state.points = points;
    state.legs = legs;
    state.scope = "next"; // a point placed, a lap or Clear ends Last leg
    session = next;
    render();
  }
  // A tap still waiting to be placed goes first, as if it never was.
  // Undo just takes a point away (the user, 2026-11-22): changes of
  // routing aren't Undo steps and the routing stays as it is. Like any
  // change to the route it goes back to Next leg, and drops a re-route
  // still on its way.
  function undo() {
    refuse(null);
    choiceGen++;
    state.scope = "next";
    const pending = waiting.filter((id) => !dropped.has(id));
    if (pending.length) {
      dropped.add(pending.at(-1));
      renderScope();
      return drawLine();
    }
    const last = undos.pop();
    if (!last) return;
    if (last.session !== session) flushSave();
    state.points = last.points;
    state.legs = last.legs;
    session = last.session;
    render();
  }
  // Clear empties the route and starts a new one, not saved until hearted;
  // Undo brings the old one back.
  function clear() {
    for (const id of waiting) dropped.add(id);
    if (state.points.length) commit([], [], { link: null });
  }

  // Where a tap lands: on a waypoint if it's close to one (the start first,
  // so tapping it closes the route), else on the route if it's close to it
  // (so a leg can go back over it exactly), else where it was.
  // The last point only takes a tap right on it (a second tap on the same
  // spot, ignored): 22 px is near 100 m at A to B's usual zoom, and a tap
  // that far out is meant as the next point (the user, 2026-11-21).
  function snap(e) {
    const p = e.point, near = (q) => Math.hypot(q.x - p.x, q.y - p.y);
    const last = state.points.at(-1);
    let best = null, bestD = SNAP_WAYPOINT_PX;
    state.points.forEach((ll, i) => {
      const isLast = samePoint(ll, last);
      const d = near(map.project(ll)) - (i === 0 && !isLast ? 4 : 0);
      if (d < (isLast ? Math.min(bestD, SNAP_LAST_PX) : bestD)) { best = ll; bestD = d; }
    });
    if (best) return best;
    if (route) {
      let onLine = null, lineD = SNAP_ROUTE_PX;
      const px = route.raw.map((ll) => map.project(ll));
      for (let i = 1; i < px.length; i++) {
        const a = px[i - 1], b = px[i], dx = b.x - a.x, dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
        const d = Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
        if (d < lineD) {
          lineD = d;
          const [la, lb] = [route.raw[i - 1], route.raw[i]];
          onLine = [la[0] + t * (lb[0] - la[0]), la[1] + t * (lb[1] - la[1])];
        }
      }
      if (onLine) return onLine;
    }
    return [e.lngLat.lng, e.lngLat.lat];
  }
  map.on("click", (e) => {
    if (!mine()) return;
    tapAt(snap(e));
  });

  // ----- the whole route -----
  // The legs as one route: its line, length, heights (evenly spaced, as
  // js/profile.js wants them), climb and descent, uncertain paths and where
  // the waypoints are along it.
  function whole() {
    const { legs, points } = state;
    if (!legs.length) return null;
    const raw = [points[0]], spans = [];
    const legEnds = []; // metres from the start to each leg's end
    const samples = []; // [metres from the start, height]
    let distance = 0, uncertain = 0;
    for (const leg of legs) {
      const offset = raw.length - 1;
      raw.push(...leg.points.slice(1));
      for (const [s, e] of leg.country ?? []) {
        spans.push([offset + s, offset + e]);
        uncertain += lineLength(leg.points.slice(s, e + 1));
      }
      // a leg's heights run evenly over its own length, as measured here
      const length = lineLength(leg.points), hs = leg.elevation;
      if (hs) hs.forEach((h, k) => samples.push([distance + (k / (hs.length - 1)) * length, h]));
      distance += length;
      legEnds.push(distance);
    }
    const closed = samePoint(points.at(-1), points[0]);
    const r = {
      raw, distance, closed: false, // never smoothed round the end on the chart, even closed
      loopClosed: closed,
      info: { countryPaths: Math.round(uncertain), countryPathSpans: spans },
      marks: legEnds.map((m, i) => ({ m, kind: i === legEnds.length - 1 && !closed ? "finish" : "via" })),
    };
    if (samples.length) Object.assign(r, profileOf(samples, distance));
    return r;
  }
  // The route's heights every HEIGHT_STEP_M from the legs' heights: legs
  // without (Freehand, where the ground's height isn't known) slope
  // straight between the heights either side. Smoothed and counted as the
  // backend does a loop's (climbOf), then averaged down to at most
  // PROFILE_POINTS for the chart, as the backend does (addElevation).
  function profileOf(samples, distance) {
    const n = Math.max(1, Math.round(distance / HEIGHT_STEP_M));
    const step = distance / n;
    const even = [];
    for (let i = 0, k = 1; i <= n; i++) {
      const d = i * step;
      while (k < samples.length - 1 && samples[k][0] < d) k++;
      const [d0, h0] = samples[Math.max(k - 1, 0)], [d1, h1] = samples[k] ?? samples[0];
      const t = d1 > d0 ? Math.max(0, Math.min(1, (d - d0) / (d1 - d0))) : 0;
      even.push(samples.length > 1 ? h0 + t * (h1 - h0) : h0);
    }
    const smoothed = smoothHeights(even, step);
    const { climb, descent } = climbOf(smoothed);
    const parts = Math.min(PROFILE_POINTS, n), halfPart = n / parts / 2;
    const elevation = [];
    for (let i = 0; i <= parts; i++) {
      const at = (i * n) / parts;
      const lo = Math.max(Math.ceil(at - halfPart), 0), hi = Math.min(Math.floor(at + halfPart), n);
      let sum = 0;
      for (let k = lo; k <= hi; k++) sum += smoothed[k];
      elevation.push(Math.round((sum / (hi - lo + 1)) * 10) / 10);
    }
    return { elevation, elevationStep: distance / parts, climb: Math.round(climb), descent: Math.round(descent) };
  }

  // ----- on the map -----
  function drawLine() {
    if (!mine()) return;
    ready.then(() => {
      shownKey = half(map.getZoom());
      const src = map.getSource("p2p");
      if (!pieces.length) return src.setData(EMPTY);
      // Last leg lights up the last leg, the rest dimmed
      src.setData(routeFeatures(pieces, shownKey, state.scope === "last" ? state.legs.length - 1 : -1));
    });
  }
  // Smoothing and the lanes are set in screen pixels, so they're redone
  // when a zoom ends (lanes bunch up zoomed out and spread out zoomed in).
  map.on("zoomend", () => {
    if (mine() && pieces.length && half(map.getZoom()) !== shownKey) drawLine();
  });
  // Start (pink), vias (dark beads) and finish (chequered). Passing the
  // start again keeps it the start, and a closed route has no finish on
  // top of it. They take no taps themselves: a tap near one lands on it
  // (snap), as moving them is the Edit mode's job.
  function placeMarkers() {
    for (const m of markers) m.remove();
    markers = [];
    if (!mine()) return;
    const pts = state.points;
    const add = (ll, cls, label) => {
      const el = document.createElement("div");
      el.className = `wp ${cls}`;
      el.setAttribute("role", "img");
      el.setAttribute("aria-label", label);
      markers.push(new maplibregl.Marker({ element: el }).setLngLat(ll).addTo(map));
    };
    const seen = new Set();
    pts.forEach((ll, i) => {
      if (i === 0) return;
      const last = i === pts.length - 1;
      const k = `${ll[0].toFixed(6)},${ll[1].toFixed(6)}`;
      // a via where the route finishes is under the finish (after a lap, say)
      if (samePoint(ll, pts[0]) || (!last && (seen.has(k) || samePoint(ll, pts.at(-1))))) return;
      seen.add(k);
      add(ll, last ? "wp-fin" : "wp-via", last ? "Finish" : `Via point ${i}`);
    });
    if (pts.length) add(pts[0], "wp-start", "Start"); // last, so it's on top
  }

  // ----- the panel and top bar -----
  const smooth = createSmoother();
  const grip = $("p2p-grip");
  // The grip's label says when folding hides a warning (its pill turns
  // amber then, in CSS).
  function labelGrip() {
    const on = body.classList.contains("p2p-folded");
    const warn = on && body.classList.contains("p2p-warnings");
    grip.setAttribute("aria-label", on ? `Show route details${warn ? ", with a warning" : ""}` : "Hide route details");
  }
  function setFolded(on) {
    grip.setAttribute("aria-expanded", !on);
    if (body.classList.contains("p2p-folded") === on) return;
    const moved = smooth([...document.querySelectorAll(".p2p-fold")], !on, () => { body.classList.toggle("p2p-folded", on); labelGrip(); });
    if (!on) moved.then(keepInView, () => {}); // opened: it may cover the route now
  }
  attachGrip(grip, { isFolded: () => body.classList.contains("p2p-folded"), setFolded });

  // ----- the routing -----
  // The routing and Minimise climb sit under a heading that says what they
  // change (the user, 2026-11-22; UI.md "Scope heading"). Next leg, as it
  // starts: they only set how the next tap is routed, so they can be
  // switched freely mid-route. Tap the heading for Last leg: the chips show
  // the last leg's routing, the map lights that leg up and dims the rest,
  // and each change re-routes it as if its point were tapped again, to
  // compare. One routing either way: what's chosen for the last leg goes
  // on to the next tap. Last leg lasts until the route changes (a point
  // placed, Lap, Clear, Undo; a refused tap places nothing, so it stays),
  // and is only offered when a tap placed the last leg (a lap's copies
  // stay as they are). A change that can't re-route it changes nothing:
  // the routing goes back to the leg's and the pink toast says why.
  const SCOPES = ["next", "last"]; // in the heading's order; maybe a whole-route one later (the user)
  let choiceGen = 0; // counts changes and Undos, so only the newest change is acted on
  const canCompare = () => !!state.legs.at(-1)?.tap;
  function renderChoices() {
    for (const b of document.querySelectorAll("[data-routing]")) {
      const on = b.dataset.routing === state.routing;
      b.classList.toggle("active", on);
      b.setAttribute("aria-checked", on);
    }
    $("p2p-climb").setAttribute("aria-checked", state.minimiseClimb);
  }
  function renderScope() {
    const can = canCompare();
    if (!can) state.scope = "next";
    const last = state.scope === "last", btn = $("p2p-scope");
    btn.disabled = !can;
    $("p2p-title").textContent = last ? "Last leg" : "Next leg";
    $("p2p-scope-dots").style.setProperty("--at", SCOPES.indexOf(state.scope));
    const what = !can ? "" : last ? "Tap to go back to the next leg" : "Tap to compare routings for the last leg";
    btn.setAttribute("aria-label", `${last ? "Last" : "Next"} leg routing${what ? `. ${what}` : ""}`);
    btn.title = what;
    $("p2p-routing").setAttribute("aria-label", `Routing for the ${last ? "last" : "next"} leg`);
  }
  $("p2p-scope").addEventListener("click", () => {
    if (!canCompare()) return;
    state.scope = SCOPES[(SCOPES.indexOf(state.scope) + 1) % SCOPES.length];
    if (state.scope === "last") followLast();
    renderScope();
    drawLine();
  });
  function choose(change) {
    Object.assign(state, change);
    renderChoices();
    if (state.scope !== "last") return; // the next leg's, nothing to re-route
    const gen = ++choiceGen, leg = state.legs.at(-1), want = { routing: state.routing, minimiseClimb: state.minimiseClimb };
    queue = queue.then(() => gen === choiceGen && reroute(leg, want, gen)).catch((err) => {
      console.error(err);
      toast("Couldn't re-route the last leg. Try again?");
    });
  }
  // Freehand doesn't use Minimise climb, so switching it leaves a Freehand leg be.
  const routedAs = (leg, { routing, minimiseClimb }) =>
    leg.routing === routing && (routing === "freehand" || leg.minimiseClimb === minimiseClimb);
  // leg: the last leg when the change was made, the one on show. A tap
  // still on its way then places its own leg first, and that's left be.
  async function reroute(leg, want, gen) {
    if (state.legs.at(-1) !== leg || routedAs(leg, want)) return;
    const got = await legFor(leg.tap, want);
    if (gen !== choiceGen || state.legs.at(-1) !== leg) return; // changed again meanwhile, or Undo, or Clear
    if (got.refused) {
      if (state.scope === "last") followLast();
      return toast(notRerouted(got.refused, got.detail, want), 4500);
    }
    // its new end, and the start too if it's the first leg (as in tapAt)
    const legs = [...state.legs.slice(0, -1), got.leg];
    const points = legs.length > 1 ? state.points.slice(0, -1) : [got.leg.points[0]];
    state.points = [...points, got.leg.points.at(-1)];
    state.legs = legs;
    render();
  }
  // A change of routing that couldn't re-route the last leg, for the pink
  // toast (the user, 2026-11-22: the warning line under the chips grew
  // the panel and moved them from under the finger). same_point: as far
  // as paths go, its point is where it sets off.
  const ROUTING_NAMES = { pleasant: "Pleasant", shortest: "Shortest", freehand: "Freehand" };
  const NOT_REROUTED = {
    no_path_near: ({ end }) => end === "from" ? "no path within 300 m of where it starts" : "its point is off the paths",
    no_nearer: () => "no path comes nearer its point",
    same_point: () => "no path comes nearer its point",
    no_route: () => "no way along paths between its ends",
    no_map: () => "no map data there",
  };
  function notRerouted(reason, detail, { routing, minimiseClimb }) {
    const why = NOT_REROUTED[reason];
    if (!why) return "No answer from the server, so the last leg stays as it was. Try again?";
    return `${ROUTING_NAMES[routing]}${minimiseClimb ? " with Minimise climb" : ""} can't route the last leg: ${why(detail)}. It stays as it was.`;
  }
  // The routing shown becomes the last leg's (going to Last leg, or after
  // a change that couldn't re-route it). A Freehand leg leaves Minimise
  // climb as it is: it doesn't use it.
  function followLast() {
    const leg = state.legs.at(-1);
    if (!leg?.tap) return;
    state.routing = leg.routing;
    if (leg.routing !== "freehand") state.minimiseClimb = leg.minimiseClimb;
    renderChoices();
  }
  $("p2p-routing").addEventListener("click", (e) => {
    const b = e.target.closest("[data-routing]");
    if (!b || b.dataset.routing === state.routing) return;
    choose({ routing: b.dataset.routing });
  });
  $("p2p-climb").addEventListener("click", () => choose({ minimiseClimb: !state.minimiseClimb }));

  function render() {
    route = whole();
    pieces = routePieces(state.legs);
    const n = state.points.length;
    body.classList.toggle("p2p-has-point", n > 0);
    body.classList.toggle("p2p-has-leg", !!route);
    // the top bar: what a tap does next, then (with a route) the distance
    $("p2p-hint").textContent = n ? "Tap to add a point" : "Tap to set start";
    // Undo and Clear: Clear only with something to clear, Undo whenever
    // there's something to take back (a Clear too)
    body.classList.toggle("p2p-can-undo", undos.length > 0);
    $("p2p-undo").disabled = !undos.length;
    $("p2p-clear").hidden = !n;
    // Lap, while the route ends on a spot it came through before (so
    // still there after a lap), with how long the lap is
    const lap = lapAt(), lapLength = lap ? route.distance - lap.from : 0;
    $("p2p-lap").hidden = lapLength < LAP_MIN_M;
    if (lapLength >= LAP_MIN_M) $("p2p-lap-km").textContent = `${km(lapLength)} km`;
    syncHeart();
    scheduleSave(); // a hearted route's favourite follows it
    renderScope(); // Last leg only while a tap placed the last leg (before drawLine: it lights it up)
    placeMarkers();
    drawLine();
    showRoute();
  }

  // The route's part of the panel (the distance, chart, warning, Export
  // and heart) grows in with the first leg, so the panel's top glides up,
  // and then the map moves if it must, so the bigger panel covers none of
  // the route. When Undo or Clear take the last leg away it shrinks out,
  // still showing what it did until it's gone.
  const routeParts = () => [...document.querySelectorAll(".p2p-details, .p2p-actions")];
  let routeShown = body.classList.contains("p2p-has-route"); // where the panel is going
  function fillRoute() {
    if (route) $("p2p-distance").textContent = (route.distance / 1000).toFixed(2);
    renderWarning();
    drawProfile();
    body.classList.toggle("p2p-no-details", !!route && !route.elevation && !body.classList.contains("p2p-warnings"));
  }
  function showRoute() {
    if (!!route === routeShown) {
      if (route) fillRoute();
      return;
    }
    routeShown = !!route;
    if (route) {
      smooth(routeParts(), true, () => { body.classList.add("p2p-has-route"); fillRoute(); }).then(keepInView, () => {});
    } else {
      smooth(routeParts(), false, () => { body.classList.remove("p2p-has-route"); fillRoute(); });
    }
  }
  // Moves the map as little as it can so the whole route is clear of the
  // panel, the top bar and the buttons over the map: a pan if it fits at
  // this zoom, else zoomed out to fit. Never zooms in.
  function keepInView() {
    if (!mine() || !route) return;
    const pad = opts.padding();
    const el = map.getContainer();
    const room = { left: pad.left, top: pad.top, right: el.clientWidth - pad.right, bottom: el.clientHeight - pad.bottom };
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const ll of route.raw) {
      const p = map.project(ll);
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    if (x0 >= room.left && x1 <= room.right && y0 >= room.top && y1 <= room.bottom) return;
    if (x1 - x0 <= room.right - room.left && y1 - y0 <= room.bottom - room.top) {
      const dx = x0 < room.left ? x0 - room.left : x1 > room.right ? x1 - room.right : 0;
      const dy = y0 < room.top ? y0 - room.top : y1 > room.bottom ? y1 - room.bottom : 0;
      map.panBy([dx, dy], { duration: 450 });
      return;
    }
    const sw = map.unproject([x0, y1]), ne = map.unproject([x1, y0]);
    const camera = map.cameraForBounds([sw, ne], { padding: pad, maxZoom: map.getZoom() });
    if (camera) map.easeTo({ ...camera, duration: 550 });
  }

  // A tap that placed no point: the same small warning line, under the
  // routing, until the next point, Undo or Clear. Tap it for the why.
  // reason: as the leg service gives it, or null to hide the line.
  const REFUSED = {
    too_far: ({ far }) => [`Too far: legs up to ${MAX_LEG_M / 1000} km`,
      `That point is ${far ? `${Math.round(far / 1000)} km` : "too far"} from the last one in a straight line. A leg can be up to ${MAX_LEG_M / 1000} km, so routing stays quick. For a longer route, add points along the way.`],
    no_path_near: ({ end }) => end === "from"
      ? ["No paths near the last point", "The last point is more than 300 m from any path or street we can route on, so this leg can't follow one. Use Freehand until you're nearer one."]
      : [end === "start" ? "Can't start there" : "Can't route to that spot",
        "There's no path or street we can route on right there. It may be private or closed, or a road with nowhere to walk, even where the map draws one. Tap on a path or street, or use Freehand."],
    no_nearer: () => ["No path goes nearer", "The closest a path or street comes to that point is where the route already ends. Use Freehand to go off the paths, or tap further along one."],
    no_route: () => ["No route found", "The map knows no way along paths and streets between these points. Try a point nearby, or use Freehand."],
    no_map: () => ["No map data here", "Routing covers the UK for now. Freehand works anywhere."],
    offline: () => ["Couldn't route that leg", "No answer from the server. Check your connection and try again, or use Freehand."],
  };
  // A tap that found nothing to route on says what the map draws there
  // (js/spot.js: a trunk road, a private road, water, with its name), if
  // it can.
  function refuse(reason, detail = {}) {
    $("p2p-refused-box").hidden = !reason || reason === "same_point";
    $("p2p-refused").setAttribute("aria-expanded", false);
    $("p2p-refused-text").hidden = true;
    if ($("p2p-refused-box").hidden) return;
    const specific = reason === "no_path_near" && detail.end !== "from" && detail.at &&
      whyNotHere(map, detail.at, TAP_PX, detail.end === "start");
    const [label, why] = specific || (REFUSED[reason] ?? REFUSED.offline)(detail);
    $("p2p-refused-label").textContent = label;
    $("p2p-refused-text").textContent = why;
  }
  $("p2p-refused").addEventListener("click", () => {
    const open = $("p2p-refused-text").hidden;
    $("p2p-refused").setAttribute("aria-expanded", open);
    $("p2p-refused-text").hidden = !open;
  });

  // Uncertain paths: one small line, tap for the why (route info's card,
  // made small for A to B, 2026-11-20). Dashed on the map, as in loops.
  function renderWarning() {
    const m = route?.info.countryPaths ?? 0;
    const on = m >= COUNTRY_WARN_M;
    body.classList.toggle("p2p-warnings", on);
    labelGrip();
    $("p2p-warn").hidden = !on;
    if (on) $("p2p-warn-label").textContent = `${km(m)} km on uncertain paths`;
    else showWhy(false);
  }
  function showWhy(on) {
    $("p2p-warn").setAttribute("aria-expanded", on);
    $("p2p-warn-text").hidden = !on;
  }
  $("p2p-warn").addEventListener("click", () => showWhy($("p2p-warn-text").hidden));

  // The elevation profile, drawn to the panel's width (so again when that
  // changes), with a dot on the route where you're reading it.
  function drawProfile() {
    renderProfile($("p2p-profile"), route?.elevation ? route : null, { onPoint: markPoint });
  }
  function markPoint(f) {
    if (f === null || !route) {
      pointMarker?.remove();
      pointMarker = null;
      return;
    }
    const at = pointAlong(route.raw, f);
    if (!pointMarker) {
      const el = document.createElement("div");
      el.className = "profile-dot";
      pointMarker = new maplibregl.Marker({ element: el }).setLngLat(at).addTo(map);
    } else {
      pointMarker.setLngLat(at);
    }
  }
  let chartSize = "";
  if ("ResizeObserver" in window) {
    new ResizeObserver(([e]) => {
      const size = `${Math.round(e.contentRect.width)}x${Math.round(e.contentRect.height)}`;
      if (e.contentRect.width === 0) chartSize = "";
      else if (size !== chartSize && route?.elevation) {
        chartSize = size;
        drawProfile();
      }
    }).observe($("p2p-profile").querySelector(".profile-chart"));
  }

  // ----- Undo, Clear, Export, favourite -----
  $("p2p-undo").addEventListener("click", undo);
  $("p2p-lap").addEventListener("click", addLap);
  $("p2p-clear").addEventListener("click", clear);
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  $("p2p-undo").querySelector("kbd").textContent = mac ? "⌘Z" : "Ctrl Z";
  addEventListener("keydown", (e) => {
    if (!mine() || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "z") return;
    if (document.querySelector("dialog[open]") || e.target.closest?.("input, textarea")) return;
    e.preventDefault();
    undo();
  });

  // Favourites keep the line, distance, uncertain paths and heights, like
  // any route (accounts.js), so A to B routes sit with loops and GPS art.
  // The chart's heights are too many to keep (up to 600: firestore.rules
  // takes 400), so they're saved cut down to about 200, as loops' come;
  // the climb was counted on all of them.
  // ----- favourite -----
  // A route you make is more like a document than a found loop: once
  // hearted, the route on screen is that favourite, and every change
  // (a point, Undo, Lap) is saved to it a moment later, so the heart stays
  // filled (the user, 2026-11-21). Unhearting removes it; Clear starts a
  // new route, not saved until hearted. Its id is its own, not its line's,
  // as the line changes.
  const favouriteOf = (r) => ({
    kind: "p2p", raw: r.raw, distance: r.distance, info: r.info,
    ...(r.elevation && { ...shrinkProfile(r.elevation, r.elevationStep), climb: r.climb }),
    ...(session.link && { id: session.link }),
  });
  const newId = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("");
  // Saved: hearted, and still in favourites (it may have been removed in
  // the favourites list since; then it isn't brought back).
  const isSaved = () => !!route && !!session.link && opts.favourites.has(favouriteOf(route));
  function syncHeart() {
    const on = isSaved();
    $("p2p-fav").classList.toggle("on", on);
    $("p2p-fav").setAttribute("aria-pressed", on);
  }
  opts.favourites.onChange(syncHeart);
  $("p2p-fav").addEventListener("click", () => {
    if (!route) return;
    if (isSaved()) {
      clearTimeout(saveTimer);
      saveTimer = 0;
      const fav = favouriteOf(route);
      session.link = null;
      return opts.favourites.toggle(fav); // removes it
    }
    // favourites hold routes up to 250 km (firestore.rules); A to B can go further
    if (route.distance > MAX_SAVED_M) return toast(TOO_LONG);
    session.link = newId();
    tooLongSaid = false;
    opts.favourites.toggle(favouriteOf(route));
  });
  const TOO_LONG = `Favourites hold routes up to ${MAX_SAVED_M / 1000} km for now. Export it as a GPX instead?`;

  // Changes reach the favourite SAVE_AFTER_MS after the last, so quick taps
  // make one write; before Clear, leaving the mode or the page, at once.
  const SAVE_AFTER_MS = 1500;
  let saveTimer = 0;
  let tooLongSaid = false; // said once that a change made it too long to save
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = isSaved() ? setTimeout(saveNow, SAVE_AFTER_MS) : 0;
  }
  function flushSave() {
    if (saveTimer) saveNow();
  }
  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    if (!isSaved()) return;
    if (route.distance > MAX_SAVED_M) {
      if (!tooLongSaid) toast(`Favourites hold routes up to ${MAX_SAVED_M / 1000} km, so yours stays as it was. Export this one as a GPX?`);
      tooLongSaid = true;
      return;
    }
    tooLongSaid = false;
    opts.favourites.update(favouriteOf(route));
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushSave();
  });

  $("p2p-export").addEventListener("click", () => {
    if (!route) return;
    const name = `A to B ${km(route.distance)} km`;
    const points = route.raw.map(([lon, lat]) => [lat, lon]);
    opts.exportRoute?.({
      kind: "p2p",
      distance: route.distance,
      points,
      ...(route.elevation && { heights: heightsAt(route, points), climb: route.climb }),
      gpxName: name,
      fileName: `${name.replaceAll(" ", "-")}.gpx`,
    });
  });

  // ----- switching modes -----
  // Loop mode's route stays as it was, out of sight while this one shows.
  function enter() {
    warm();
    ready.then(() => setSourceVisible(map, "route", false));
    render();
  }
  function leave() {
    flushSave();
    ready.then(() => {
      setSourceVisible(map, "route", true);
      map.getSource("p2p").setData(EMPTY);
    });
    for (const m of markers) m.remove();
    markers = [];
    markPoint(null);
  }

  renderChoices();
  render();

  return { enter, leave };
}
