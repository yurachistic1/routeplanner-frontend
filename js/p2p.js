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
// each pass gets its own lane on the map (js/lanes.js). Points can be
// dragged somewhere else (2026-11-26, the user: A to B moves its own
// points; the other modes will go to the Edit mode for it), and their legs
// are routed again as they were (see "moving a point"). A long press on a
// leg (a right-click on laptops) offers adding a point there or selecting
// the leg, to change its routing; holding a point and letting go without
// moving (a right-click) offers removing it (see "the map menus").
//
// Each leg is asked of the leg service (LEGS_BASE/leg, the backend's
// leg.go) on its own, from the end of the route so far to the tap: it
// knows nothing of the legs before. Answers are kept, so going back and
// forth between routings asks the server once for each.
// Routed points sit on a path or street (the server moves them onto the
// nearest one, and the start with them); after a Freehand leg the next
// routed leg starts with a straight join to the path. A tap that can't be
// routed places nothing and says why in the pink toast. Climb and descent are counted here over the whole route, from
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
import { frameOnMap, setSourceVisible } from "./map.js";
import { attachGrip, createSmoother } from "./panel.js";
import { createLongPress, createPointDrag } from "./pointdrag.js";
import { climbOf, heightsAt, renderProfile, shrinkProfile, smoothHeights } from "./profile.js";
import { whyNotHere } from "./spot.js";
import { $, hideToast, toast } from "./ui.js";

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
 * { enter, leave, canFocus, focus } for js/modes.js.
 *   addP2PLayers(map): adds the layers that draw source "p2p" (pieces from
 *     js/lanes.js, with their widths and offsets as properties)
 *   favourites: { toggle(route), has(route), onChange(fn) } from accounts
 *   exportRoute(route): opens the export dialog (js/export.js)
 *   padding(): {top, bottom, left, right}, px, to keep the route clear of
 *     the top bar, the panel and the buttons over the map
 *   room(): {left, top, right, bottom}, px in the map: the part of it not
 *     under the top bar, the panel or the buttons over it (a dragged point
 *     stays in it, js/pointdrag.js)
 */
export function createP2PMode(map, mapReady, opts) {
  // points: the waypoints, [lon, lat]. Leg i runs from points[i] to
  // points[i + 1]: { routing, minimiseClimb, tap (the tap that placed it,
  // as routeLeg takes it, to route it again; null on a lap's copies),
  // points ([lon, lat], its line), elevation (heights evenly spaced from
  // its first point to its last, as the map has them, or null), country
  // ([[i, j]] spans of uncertain path, by point) }. A leg joined from two
  // when the point between them was removed also has joined: true (its
  // line isn't routed end to end), mixed (its parts were routed different
  // ways: routed again, it's Shortest), startFree and freeEnd (whether its
  // first and last points are off the paths).
  // scope: what a change of routing changes, "next", "last" or "leg" (see
  // "the routing"); pick: the selected leg's index, while scope is "leg".
  // lap: { length, count } after Lap: how long that lap is and how many
  // times the route runs it now (the counter in Lap's arrow, 2026-11-23),
  // null after anything else
  const state = { points: [], legs: [], routing: "pleasant", minimiseClimb: false, scope: "next", pick: null, lap: null };
  const undos = []; // earlier { points, legs, session, lap, routing (a change of a leg's routing) }, newest last
  const redos = []; // the same, undone, for Redo, the last undone last
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
  // While a point is dragged, and from letting go until its legs are in:
  // { points, legs (the route as it was), moving (the indices of the points
  // that move: it, and its copies a Lap made), touched (the indices of the
  // legs to or from them), ends (the other ends of those legs, as
  // { at, before }: before if it's the leg's start), spot (where it is
  // now), far (metres to the furthest end, and before: whether that one's
  // the leg's start), over (further than a leg can be), id (in the queue,
  // once let go), unfold (moving it folded the panel, to open again
  // after), view (the map's centre and zoom when it was taken, to go back
  // to with it) } (see "moving a point")
  let held = null;
  let heldMarker = null; // its marker
  let heldRuns = []; // the route without the legs being moved, as runs of pieces, drawn meanwhile
  let shownKey = null; // the half zoom the line on screen was smoothed for

  const mine = () => body.dataset.mode === "p2p";
  const ready = mapReady.then(() => {
    map.addSource("p2p", { type: "geojson", data: EMPTY });
    map.addSource("p2p-drag", { type: "geojson", data: EMPTY }); // the dashed line to a dragged point
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
    // as chosen when tapped for the next leg (kept aside while a leg is selected)
    const { routing, minimiseClimb } = state.scope === "leg" && nextChoice ? nextChoice : state;
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
      const join = state.legs.length ? endFree(state.legs.at(-1)) : placedFree.has(state.points[0]);
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
    return sliceHeights(hs, length, d0, length);
  }
  // A leg's heights hs (evenly spaced over its length) from d0 to d1 metres
  // along it, evenly spaced over that part.
  function sliceHeights(hs, length, d0, d1) {
    const n = Math.max(2, Math.round((d1 - d0) / HEIGHT_STEP_M) + 1);
    return Array.from({ length: n }, (_, k) => {
      const f = ((d0 + (k / (n - 1)) * (d1 - d0)) / (length || 1)) * (hs.length - 1);
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
      // the same lap again counts on; any other starts at 2 (once round, then this)
      const length = route.distance - lap.from;
      const count = state.lap && Math.abs(state.lap.length - length) < 1 ? state.lap.count + 1 : 2;
      // Begun from a tap that landed on a point, the lap starts and ends on
      // that point itself, not the tap's own on the same spot, so the lap's
      // first point is one point on every lap, moved and removed with its
      // copies (2026-11-26: removing it left the earlier one behind).
      const end = state.points.at(-1);
      const on = state.points.slice(0, -1).findLast((q) => segLength(q, end) < 1) ?? end;
      // (by place: a lap's legs still end on the tap's own point inside)
      const ends = legs.map((l) => (segLength(l.points.at(-1), end) < 1 ? on : l.points.at(-1)));
      commit([...state.points.slice(0, -1), on, ...ends], [...state.legs, ...legs], session, { length, count });
    }).finally(() => {
      waiting.splice(waiting.indexOf(id), 1);
      dropped.delete(id);
    }).catch((err) => {
      console.error(err);
      toast("Couldn't add the lap. Try again?");
    });
  }

  // ----- reversing -----
  // The route the other way round (the user, 2026-11-26; the button beside
  // the chart's climb and descent, which swap): the same line run back,
  // nothing routed again, so each leg keeps its routing; the finish
  // becomes the start (a loop keeps its start). A Lap's copies stay copies.
  // In the queue with taps, so it comes after any still on their way; an
  // Undo step.
  function reverseRoute() {
    const id = ++taps;
    waiting.push(id);
    queue = queue.then(() => {
      if (dropped.has(id) || !state.legs.length) return;
      const { points, legs } = state, n = points.length;
      const flipped = new Map(); // a line → it the other way, once each (so copies share it)
      const flip = (arr) => {
        if (!arr) return arr;
        if (!flipped.has(arr)) flipped.set(arr, [...arr].reverse());
        return flipped.get(arr);
      };
      const pts = [...points].reverse();
      const back = [...legs].reverse().map((l, k) => {
        const m = l.points.length - 1, from = pts[k], to = pts[k + 1];
        const out = { ...l, points: flip(l.points), elevation: flip(l.elevation), country: (l.country ?? []).map(([s, e]) => [m - e, m - s]) };
        if (l.joined) Object.assign(out, { startFree: l.freeEnd, freeEnd: l.startFree });
        // a re-route as Last leg goes as a tap's would: from its new start, off the paths if its old end was
        out.tap = l.tap ? { from, to, join: endFree(l), reach: reachAt(to) } : null;
        return out;
      });
      if (endFree(legs.at(-1))) placedFree.add(pts[0]); // the new start stays off the paths, as it was put
      commit(pts, back);
    }).finally(() => {
      waiting.splice(waiting.indexOf(id), 1);
      dropped.delete(id);
    }).catch((err) => {
      console.error(err);
      toast("Couldn't reverse the route. Try again?");
    });
  }

  // Every change goes through here, so Undo can take it back. next: the
  // session it starts (Clear), the route before it saved first. lap: as
  // state.lap, for a Lap.
  function commit(points, legs, next = session, lap = null) {
    if (next !== session) flushSave();
    record();
    state.points = points;
    state.legs = legs;
    state.lap = lap;
    resetScope(); // a point placed or moved, a lap or Clear ends Last leg or a selected leg
    session = next;
    render();
  }
  // The route as it is, for Undo to go back to. routing: what changes now
  // is a leg's routing, under Last leg or Selected leg. A new change leaves
  // nothing to redo.
  const snapshot = (routing) => ({ points: state.points, legs: state.legs, session, lap: state.lap, routing });
  function record(routing = false) {
    undos.push(snapshot(routing));
    redos.length = 0;
  }
  // A tap still waiting to be placed goes first, as if it never was. A
  // change of a leg's routing is an Undo step too (the user, 2026-11-26;
  // until then Undo only took points away, and passed over a re-route to
  // the step before it): undoing one stays under Last leg or Selected leg,
  // showing the routing it had. Anything else goes back to Next leg. Undo
  // drops a re-route still on its way.
  function undo() {
    choiceGen++;
    const pending = waiting.filter((id) => !dropped.has(id));
    if (pending.length) {
      resetScope();
      const id = pending.at(-1);
      dropped.add(id);
      if (held?.id === id) { // a point let go: back where it was
        letGo(true);
        return render();
      }
      renderScope();
      return drawLine();
    }
    const last = undos.pop();
    if (!last) return resetScope();
    redos.push(snapshot(last.routing));
    restore(last);
  }
  // Redo (2026-11-26, the user): brings back what Undo took, newest
  // first, until something new is done. Not while a tap is on its way.
  function redo() {
    choiceGen++;
    if (waiting.some((id) => !dropped.has(id))) return;
    const next = redos.pop();
    if (!next) return;
    undos.push(snapshot(next.routing));
    restore(next);
  }
  // Puts back a route kept for Undo or Redo: a change of routing stays
  // under Last leg or Selected leg, showing its routing; anything else goes
  // back to Next leg.
  function restore(step) {
    if (step.session !== session) flushSave();
    state.points = step.points;
    state.legs = step.legs;
    state.lap = step.lap;
    session = step.session;
    if (!step.routing || state.scope === "next") resetScope();
    else if (state.scope === "last") followLast();
    else followPick();
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
  const snap = (e) => snapAt(e.point, [e.lngLat.lng, e.lngLat.lat]);
  // p: px on the map, ll: [lon, lat] there. moving (held): a point is
  // being dragged there, so its old spot and its legs are no targets, and
  // nor are their other ends (a leg to one would be no leg); otherwise as a
  // tap.
  function snapAt(p, ll, moving = null) {
    const near = (q) => Math.hypot(q.x - p.x, q.y - p.y);
    const last = state.points.at(-1);
    let best = null, bestD = SNAP_WAYPOINT_PX;
    state.points.forEach((q, i) => {
      if (moving && (moving.moving.has(i) || moving.ends.some((e) => samePoint(e.at, q)))) return;
      const isLast = !moving && samePoint(q, last);
      const d = near(map.project(q)) - (i === 0 && !isLast ? 4 : 0);
      if (d < (isLast ? Math.min(bestD, SNAP_LAST_PX) : bestD)) { best = q; bestD = d; }
    });
    if (best) return best;
    const lines = !route ? [] : moving ? state.legs.filter((_, k) => !moving.touched.has(k)).map((l) => l.points) : [route.raw];
    let onLine = null, lineD = SNAP_ROUTE_PX;
    for (const raw of lines) {
      const px = raw.map((q) => map.project(q));
      for (let i = 1; i < px.length; i++) {
        const a = px[i - 1], b = px[i], dx = b.x - a.x, dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
        const d = Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
        if (d < lineD) {
          lineD = d;
          const [la, lb] = [raw[i - 1], raw[i]];
          onLine = [la[0] + t * (lb[0] - la[0]), la[1] + t * (lb[1] - la[1])];
        }
      }
    }
    return onLine ?? ll;
  }
  map.on("click", (e) => {
    if (!mine()) return;
    if (tapClosedMenu) return void (tapClosedMenu = false); // it only closed the leg menu
    tapAt(snap(e));
  });

  // ----- moving a point -----
  // Any point can be dragged (the user, 2026-11-26; UI.md "Moving a
  // point"): press and hold it on a touch screen, or drag it with the
  // mouse (a tap is still a tap, and a swipe pans the map). Meanwhile its
  // legs are gone and faint dashed straight lines to their other ends stand
  // in for them, each turning amber past the 20 km a leg can be (with the
  // toast saying so). Let go, it lands as a tap would (snapAt) and its legs
  // are routed again, each the way it was (Pleasant, Shortest or Freehand,
  // and Minimise climb: moving a point changes where its legs go, never
  // how). Points on the same spot are separate (a figure of eight, a tap on
  // an earlier point): the one on top moves, the most recent. But a Lap's
  // copies move with it, so laps stay laps, and where the route closes on
  // its start the start and the finish move together, so it stays closed.
  // Where a tap would be refused, the toast says why and the point springs
  // back, and the map with it, to where it was when the point was taken
  // (the user, 2026-11-26: dragged past 20 km, the route was left off
  // screen). Undo puts it back. On phones the panel folds while the point
  // is held, for more map to drag it over (the user, 2026-11-26), and opens
  // again once it has landed or gone back, unless it was folded already.
  const drag = createPointDrag(map, {
    pick: (node) => (mine() && !held && !waiting.length ? node.closest?.(".wp-drag") ?? null : null),
    room: opts.room,
    grab: (el, on) => { if (on) closeMenu(); el.classList.toggle("wp-held", on); },
    start: holdPoint,
    move: moveHeld,
    end: dropHeld,
    menu: (el, mouse) => openPointMenu(Number(el.dataset.at), mouse),
  });
  // The points that move with point j: it, its Lap copies (which are the
  // same point), and where the route closes on its start, the start and
  // the finish. With the legs to or from them, and those legs' other ends
  // (as { at, before }: before if it's the leg's start), once each.
  // Never more than one end either side (the user, 2026-11-26: three
  // dashed lines to one point never looks right): a Lap begun partway
  // along a leg starts with the rest of that leg, so the point at its end
  // has two points before it, the leg's start and where the Lap began.
  // Then it moves alone (closed: the start and the finish alone). all:
  // every copy whatever its neighbours (removing draws no lines: 2026-11-26,
  // the user found a lap's first point, with the way in as well as the
  // lap's either side, came off only one lap).
  function movingWith(j, all = false) {
    const pts = state.points, n = pts.length;
    const pair = n > 1 && samePoint(pts[n - 1], pts[0]) && (j === 0 || pts[j] === pts[n - 1]);
    const group = (same) => {
      const moving = new Set(pts.map((q, i) => (same(q, i) ? i : -1)).filter((i) => i >= 0));
      const touched = new Set(state.legs.map((_, k) => (moving.has(k) || moving.has(k + 1) ? k : -1)).filter((k) => k >= 0));
      const ends = [];
      for (const k of touched) {
        const before = moving.has(k + 1), at = before ? pts[k] : pts[k + 1];
        if (!ends.some((e) => e.before === before && segLength(e.at, at) < LAP_NEAR_M)) ends.push({ at, before });
      }
      return { moving, touched, ends };
    };
    const copies = group((q) => q === pts[j] || (pair && (q === pts[0] || q === pts[n - 1])));
    const oneEach = [true, false].every((side) => copies.ends.filter((e) => e.before === side).length <= 1);
    return all || oneEach ? copies : group((_, i) => i === j || (pair && (i === 0 || i === n - 1)));
  }
  // Is the start where it was put, off the paths (placed with Freehand, or
  // its first leg Freehand or joined to the paths)? Then it isn't moved
  // onto a path.
  const startFree = () => state.legs.length ? (state.legs[0].joined ? !!state.legs[0].startFree : state.legs[0].routing === "freehand") || !!state.legs[0].tap?.join : placedFree.has(state.points[0]);
  // Is a leg's last point off the paths (Freehand, or a joined leg whose last part was)?
  const endFree = (leg) => (leg.joined ? !!leg.freeEnd : leg.routing === "freehand");
  function holdPoint(el) {
    closeMenu();
    const { points, legs } = state;
    const j = Number(el.dataset.at);
    const { moving, touched, ends } = movingWith(j);
    // the grip shows on phones once there's a leg
    const unfold = getComputedStyle(grip).display !== "none" && !body.classList.contains("p2p-folded");
    const view = { center: map.getCenter(), zoom: map.getZoom() };
    held = { points, legs, j, moving, touched, ends, spot: points[j], far: 0, before: true, over: false, id: 0, unfold, view };
    if (unfold) setFolded(true);
    // the route without its legs, in runs between them
    heldRuns = [];
    let run = [];
    legs.forEach((leg, k) => {
      if (!touched.has(k)) return run.push(leg);
      if (run.length) heldRuns.push(routePieces(run));
      run = [];
    });
    if (run.length) heldRuns.push(routePieces(run));
    placeMarkers();
    drawLine();
    drawHeld();
  }
  function moveHeld(ll, p) {
    if (!held || held.id) return;
    const spot = snapAt(p, ll, held);
    if (samePoint(spot, held.spot)) return;
    held.spot = spot;
    heldMarker?.setLngLat(spot);
    // past the 20 km a leg can be: amber, and the toast says so as it
    // crosses, its distance following the point, gone again back under
    let far = 0, before = true;
    for (const e of held.ends) {
      const d = segLength(e.at, spot);
      if (d > far) [far, before] = [d, e.before];
    }
    const over = far > MAX_LEG_M;
    if (over && (!held.over || Math.round(far / 1000) !== Math.round(held.far / 1000))) toast(tooFar(far, before), 60000);
    else if (!over && held.over) hideToast();
    Object.assign(held, { far, before, over });
    drawHeld();
  }
  const tooFar = (far, before) => `That's ${Math.round(far / 1000)} km from the point ${before ? "before" : "after"} it in a straight line, and legs go up to ${MAX_LEG_M / 1000} km, so routing stays quick. Bring it closer, or add points along the way.`;
  // ll: where it was let go, or null to put it back.
  function dropHeld(ll) {
    const was = held;
    if (!was || was.id) return;
    heldMarker?.getElement().classList.remove("wp-held");
    if (!ll || state.points !== was.points || samePoint(was.spot, was.points[was.j])) {
      if (was.over) hideToast();
      letGo(true);
      return render();
    }
    if (was.over) {
      letGo(true);
      const msg = tooFar(was.far, was.before);
      toast(msg, Math.min(9000, Math.max(4500, msg.length * 50)));
      return render();
    }
    // In the queue with the taps, so Undo can take it back meanwhile;
    // the dashed lines stay until the legs are in.
    const id = was.id = ++taps;
    waiting.push(id);
    queue = queue.then(async () => {
      if (dropped.has(id) || held !== was) return;
      const got = await movePoint(was, was.spot);
      if (dropped.has(id) || held !== was) return;
      letGo(!!got.refused);
      if (got.refused) {
        if (got.mixed) toast(mixedRefused(got.refused, got.detail), 8000);
        else refuse(got.refused, got.detail);
        return render();
      }
      commit(got.points, got.legs);
    }).finally(() => {
      waiting.splice(waiting.indexOf(id), 1);
      dropped.delete(id);
    }).catch((err) => {
      console.error(err);
      if (held === was) { letGo(true); render(); }
      toast("Couldn't move that point. Try again?");
    });
  }
  // The point has landed or gone back (back): the panel opens again if
  // holding it folded it (as the grip opens it, the map then keeps the route
  // clear), and going back, the map eases back to where it was (it was clear
  // there already, panel and all).
  function letGo(back = false) {
    const was = held;
    held = null;
    if (!was) return;
    const v = was.view;
    const moved = back && mine() && (Math.abs(map.getZoom() - v.zoom) > 0.01 || map.project(v.center).dist(map.project(map.getCenter())) > 1);
    if (moved) map.easeTo({ center: v.center, zoom: v.zoom, duration: 450 });
    if (was.unfold) setFolded(false, !moved);
  }
  // The route with the held points at spot: { points, legs }, or why not,
  // { refused, detail }. Where the point lands is decided as a tap's is:
  // onto a way the server can route on, if a routed leg (Pleasant,
  // Shortest) comes into it or it's a start that sits on a path; else
  // where it was let go. Then each of its legs is asked again, the way it
  // was routed, all at once (a Lap's copies, the same leg, once), and
  // starts and ends exactly on its points.
  async function movePoint({ moving, touched }, spot) {
    const { points, legs } = state;
    const free = startFree();
    const onWay = [...moving].some((i) => (i === 0 ? !free : !endFree(legs[i - 1])));
    // a point of its own (spot may be another point it landed on, and the
    // same point is a Lap's copy)
    let at = [spot[0], spot[1]];
    if (onWay) {
      try {
        at = await startAt(spot);
      } catch (err) {
        return { refused: err.reason, detail: { end: moving.has(0) ? "start" : "to", at: spot } };
      }
    } else if (moving.has(0)) {
      placedFree.add(at); // stays off the paths (as tapAt's Freehand start)
    }
    const asked = new Map(), built = new Map(), next = [...legs];
    const jobs = [...touched].map(async (k) => {
      const leg = legs[k];
      const from = moving.has(k) ? at : points[k], to = moving.has(k + 1) ? at : points[k + 1];
      if (samePoint(from, to)) return { refused: "same_point" }; // no leg to nowhere: put back, nothing said
      // after a Freehand leg (or from a point left off the paths) a routed leg starts with a straight join
      const join = moving.has(k) ? !onWay : leg.tap ? leg.tap.join : k === 0 ? free : endFree(legs[k - 1]);
      const tap = { from, to, join, reach: reachAt(to) };
      const settings = { routing: leg.routing, minimiseClimb: leg.minimiseClimb };
      const key = JSON.stringify([from, to, join, settings]);
      if (!asked.has(key)) asked.set(key, legFor(tap, settings));
      const got = await asked.get(key);
      if (got.refused) return leg.mixed ? { ...got, mixed: true } : got; // a mixed leg: say how to fix it
      // a Lap's copies keep sharing one line, so they stay copies
      if (!built.has(key)) built.set(key, [from, ...got.leg.points.slice(1, -1), to]);
      next[k] = { ...got.leg, points: built.get(key), tap: leg.tap ? got.leg.tap : null };
      return null;
    });
    const refused = (await Promise.all(jobs)).find(Boolean);
    if (refused) return refused;
    return { points: points.map((q, i) => (moving.has(i) ? at : q)), legs: next };
  }
  function drawHeld() {
    if (!mine()) return;
    ready.then(() => {
      map.getSource("p2p-drag").setData(!held ? EMPTY : {
        type: "FeatureCollection",
        features: held.ends.map((e) => ({
          type: "Feature", properties: { over: segLength(e.at, held.spot) > MAX_LEG_M },
          geometry: { type: "LineString", coordinates: e.before ? [e.at, held.spot] : [held.spot, e.at] },
        })),
      });
    });
  }

  // ----- the map menus -----
  // A long press on a leg (touch, as on a point; a right-click on laptops)
  // opens a small menu there (the user, 2026-11-26; UI.md "Map menu"): Add
  // a point here splits the leg in two on the spot, keeping its line and
  // routing (nothing is asked, the route doesn't change shape), and the
  // new point can be dragged at once; Select this leg makes it the
  // routing's scope (see "the routing"). Legs over the same street: the
  // most recent. A Lap's copies of the leg (the same leg) go too: a point
  // on every lap, every lap lit up. Tapping elsewhere (just closing it),
  // Esc, or any change closes it.
  const LEG_PRESS_PX = 16; // a press this near a leg's line is on it
  const ICON_ADD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>`;
  const ICON_LEG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/></svg>`;
  const ICON_REMOVE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg>`;
  let menu = null; // { markers, card }
  let tapClosedMenu = false; // the touch or click now on the map closed the menu: it isn't a tap on the map
  // The leg a press at p (px on the map) is on: { k, seg, t, at }, its
  // index, the segment of its line and how far along it (0-1), and the
  // spot; null if none is within LEG_PRESS_PX. Where legs overlap, the most
  // recent (within 2 px of the nearest).
  function legAt(p) {
    let best = null;
    state.legs.forEach((leg, k) => {
      const pts = leg.points, px = pts.map((q) => map.project(q));
      for (let i = 1; i < px.length; i++) {
        const a = px[i - 1], b = px[i], dx = b.x - a.x, dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
        const d = Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
        if (d > LEG_PRESS_PX) continue;
        if (best && !(d < best.d - 2 || (k > best.k && d <= best.d + 2) || (k === best.k && d < best.d))) continue;
        const [la, lb] = [pts[i - 1], pts[i]];
        best = { k, seg: i - 1, t, d, at: [la[0] + t * (lb[0] - la[0]), la[1] + t * (lb[1] - la[1])] };
      }
    });
    return best;
  }
  createLongPress(map, {
    test: (p) => mine() && !held && !waiting.length && state.legs.length > 0 && !!legAt(p),
    press: (p, mouse) => {
      const hit = legAt(p);
      if (!hit) return;
      openMenu(hit.at, "This leg", [
        { icon: ICON_ADD, label: "Add a point here", run: () => addPointAt(hit) },
        { icon: ICON_LEG, label: "Select this leg", run: () => selectLeg(hit.k) },
      ], { dot: true, mouse });
    },
  });
  // Holding a point and letting go without moving (a right-click on
  // laptops): its menu, Remove this point (the user, 2026-11-26).
  function openPointMenu(j, mouse) {
    if (!(j < state.points.length)) return;
    openMenu(state.points[j], "This point", [{ icon: ICON_REMOVE, label: "Remove this point", run: () => removePoint(j) }], { mouse });
  }
  // A menu at at ([lon, lat]) with items { icon, label, run }. dot: mark
  // the spot (a leg's; a point is its own mark). mouse: opened by a
  // right-click, so the keyboard can go on from its first item.
  function openMenu(at, name, items, { dot = false, mouse = false } = {}) {
    closeMenu();
    const card = document.createElement("div");
    card.className = "map-menu";
    card.setAttribute("role", "menu");
    card.setAttribute("aria-label", name);
    card.innerHTML = items.map((it, i) => `<button type="button" role="menuitem" data-i="${i}">${it.icon}${it.label}</button>`).join("");
    // its own touches and clicks aren't the map's
    for (const type of ["pointerdown", "mousedown", "touchstart", "click", "dblclick", "contextmenu"]) card.addEventListener(type, (e) => e.stopPropagation());
    card.addEventListener("click", (e) => {
      const b = e.target.closest("[data-i]");
      if (!b) return;
      closeMenu();
      items[Number(b.dataset.i)].run();
    });
    const markersNow = [];
    if (dot) {
      const el = document.createElement("div");
      el.className = "profile-dot";
      markersNow.push(new maplibregl.Marker({ element: el }).setLngLat(at).addTo(map));
    }
    const cardMarker = new maplibregl.Marker({ element: card }).setLngLat(at).addTo(map);
    markersNow.push(cardMarker);
    // above the spot, else below it, else the side with more room; always
    // inside the visible map (a small phone with the panel open has little)
    const r = opts.room(), p = map.project(at), w = card.offsetWidth, h = card.offsetHeight, GAP = 18;
    const fitsAbove = p.y - GAP - h >= r.top + 8, fitsBelow = p.y + GAP + h <= r.bottom - 8;
    const above = fitsAbove || (!fitsBelow && p.y - r.top >= r.bottom - p.y);
    const cy = Math.max(r.top + 8 + h / 2, Math.min(r.bottom - 8 - h / 2, above ? p.y - GAP - h / 2 : p.y + GAP + h / 2));
    const cx = Math.max(r.left + 8 + w / 2, Math.min(r.right - 8 - w / 2, p.x));
    cardMarker.setOffset([cx - p.x, cy - p.y]);
    menu = { markers: markersNow, card };
    if (mouse) card.querySelector("button").focus({ preventScroll: true });
  }
  function closeMenu() {
    if (!menu) return;
    for (const m of menu.markers) m.remove();
    menu = null;
  }
  // Any touch or click outside the menu closes it; on the map, that's all it does.
  document.addEventListener("pointerdown", (e) => {
    tapClosedMenu = !!menu && !menu.card.contains(e.target) && map.getCanvasContainer().contains(e.target);
    if (menu && !menu.card.contains(e.target)) closeMenu();
  }, true);
  addEventListener("keydown", (e) => { if (menu && e.key === "Escape") closeMenu(); });

  // Splits leg k (hit, from legAt) in two at the spot: the same line,
  // heights and uncertain stretches, cut there, and the same routing. Its
  // Lap copies split the same way, sharing the new point and lines, so
  // they stay copies. An Undo step, like any new point.
  function addPointAt({ k, seg, t, at }) {
    const leg = state.legs[k], pts = leg.points;
    const length = lineLength(pts), d0 = lineLength(pts.slice(0, seg + 1)) + t * segLength(pts[seg], pts[seg + 1]);
    if (d0 < 1 || length - d0 < 1) return; // on a point already
    const point = [at[0], at[1]];
    const first = { points: [...pts.slice(0, seg + 1), point], elevation: leg.elevation && sliceHeights(leg.elevation, length, 0, d0),
      country: (leg.country ?? []).filter(([s]) => s <= seg).map(([s, e]) => [s, Math.min(e, seg + 1)]) };
    const second = { points: [point, ...pts.slice(seg + 1)], elevation: leg.elevation && sliceHeights(leg.elevation, length, d0, length),
      country: cutSpans(leg.country, seg) };
    const points = [state.points[0]], legs = [];
    state.legs.forEach((l, i) => {
      if (l.points === pts) {
        // a re-route of a half goes as a tap's would: to the new point, and from it (joined to the paths if it's off them)
        // a joined leg's halves stay joined; where it's cut, whether that's off the paths isn't known, so it's taken as off them
        const cut = l.joined ? [{ freeEnd: true }, { startFree: true }] : [{}, {}];
        legs.push({ ...l, ...first, ...cut[0], tap: l.tap && { ...l.tap, to: point, reach: reachAt(point) } });
        legs.push({ ...l, ...second, ...cut[1], tap: l.tap && { ...l.tap, from: point, join: l.joined || l.routing === "freehand" } });
        points.push(point);
      } else {
        legs.push(l);
      }
      points.push(state.points[i + 1]);
    });
    commit(points, legs);
  }
  // Removes point j (with its Lap copies, and a loop's start with its
  // finish, as moving it would), and nothing is routed again (the user,
  // 2026-11-26: it's only removing an anchor; mixed Freehand and routed
  // legs would go wrong): the line stays as it was. A via's two legs join
  // into one, with their routing (Shortest if they differ); nothing is
  // selected (the user, 2026-11-26).
  // The finish, or an open route's start: just its leg goes. A loop's
  // start: the next point becomes the start, and the last and first legs
  // join into the new last leg, still closed. The only point: the route
  // is empty. An Undo step.
  function removePoint(j) {
    const n = state.points.length;
    if (n === 1) return commit([], []);
    const { moving } = movingWith(j, true);
    const closed = samePoint(state.points[n - 1], state.points[0]);
    const loopStart = closed && moving.has(0) && moving.has(n - 1);
    const pts = [...state.points], legs = [...state.legs];
    for (const i of [...moving].sort((a, b) => b - a)) {
      if (loopStart && (i === 0 || i === n - 1)) continue;
      if (i === 0) { // an open route's start: the next point is
        const gone = legs.shift();
        pts.shift();
        if (endFree(gone)) placedFree.add(pts[0]);
      } else if (i === pts.length - 1) { // the finish
        legs.pop();
        pts.pop();
      } else { // a via: its legs join
        const joinedLeg = joinLegs(legs[i - 1], legs[i], i === 1 ? startFree() : endFree(legs[i - 2]));
        legs.splice(i - 1, 2, joinedLeg);
        pts.splice(i, 1);
      }
    }
    if (loopStart) {
      const first = legs.shift(), last = legs.pop();
      pts.shift();
      pts.pop();
      const joinedLeg = joinLegs(last, first, legs.length ? endFree(legs.at(-1)) : endFree(first));
      legs.push(joinedLeg);
      pts.push(pts[0]); // closed: it ends at its new start
      if (endFree(first)) placedFree.add(pts[0]);
    }
    commit(pts, legs);
  }
  // Legs a and b as one leg, their lines, heights and uncertain stretches
  // end to end (a Lap's copies joined the same way share one line, so they
  // stay copies). startFree: whether a's first point is off the paths.
  const joins = new WeakMap(); // a.points → b.points → the joined line
  function joinLegs(a, b, startFree) {
    let line = joins.get(a.points)?.get(b.points);
    if (!line) {
      const la = lineLength(a.points), lb = lineLength(b.points), shift = a.points.length - 1;
      line = {
        points: [...a.points, ...b.points.slice(1)],
        elevation: a.elevation && b.elevation ? joinHeights(a.elevation, la, b.elevation, lb) : null,
        country: [...(a.country ?? []), ...(b.country ?? []).map(([s, e]) => [s + shift, e + shift])],
      };
      if (!joins.has(a.points)) joins.set(a.points, new WeakMap());
      joins.get(a.points).set(b.points, line);
    }
    const mixed = !!(a.mixed || b.mixed) || a.routing !== b.routing;
    const end = b.points.at(-1);
    return {
      ...line, joined: true, mixed,
      routing: mixed ? "shortest" : a.routing, // routed again, a mixed leg is Shortest (the user, 2026-11-26)
      minimiseClimb: mixed ? false : a.minimiseClimb,
      startFree, freeEnd: endFree(b),
      // a tap's way, to re-route it as Last leg; none on a Lap's copies
      tap: a.tap || b.tap ? { from: a.tap?.from ?? a.points[0], to: b.tap?.to ?? end, join: a.tap?.join ?? startFree, reach: b.tap?.reach ?? reachAt(end) } : null,
    };
  }
  // Heights ha over la metres, then hb over lb, evenly spaced over the two.
  function joinHeights(ha, la, hb, lb) {
    const length = la + lb, n = Math.max(2, Math.round(length / HEIGHT_STEP_M) + 1);
    const at = (hs, len, d) => {
      const f = (d / (len || 1)) * (hs.length - 1), i = Math.max(0, Math.min(Math.floor(f), hs.length - 2));
      return hs[i] + (f - i) * (hs[i + 1] - hs[i]);
    };
    return Array.from({ length: n }, (_, k) => {
      const d = (k / (n - 1)) * length;
      return d <= la ? at(ha, la, d) : at(hb, lb, d - la);
    });
  }
  // A mixed leg (Shortest) that couldn't be routed again, as a point was
  // moved: say why, and how to fix it (the user, 2026-11-26).
  function mixedRefused(reason, detail) {
    const why = NOT_REROUTED[reason]?.(detail) ?? "no answer from the server";
    return `Shortest can't route the joined leg: ${why}. Long-press it to select it and switch it to Freehand, or drag its points nearer paths.`;
  }
  // Selecting the last leg is Last leg (when a tap placed it); any other,
  // the selected leg.
  function selectLeg(k) {
    if (k === state.legs.length - 1 && canCompare()) return toScope("last");
    state.pick = k;
    toScope("leg", true);
  }

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
      // while a point is moved, without its legs: the runs between them
      if (held) return src.setData({ type: "FeatureCollection", features: heldRuns.flatMap((run) => routeFeatures(run, shownKey).features) });
      if (!pieces.length) return src.setData(EMPTY);
      // Last leg lights up the last leg, a selected leg itself and its Lap copies, the rest dimmed
      src.setData(routeFeatures(pieces, shownKey, state.scope === "last" ? state.legs.length - 1 : state.scope === "leg" ? new Set(copiesOf(state.pick)) : -1));
    });
  }
  // Smoothing and the lanes are set in screen pixels, so they're redone
  // when a zoom ends (lanes bunch up zoomed out and spread out zoomed in).
  map.on("zoomend", () => {
    if (mine() && (held ? heldRuns : pieces).length && half(map.getZoom()) !== shownKey) drawLine();
  });
  // Start (pink), vias (dark beads) and finish (chequered). Passing the
  // start again keeps it the start, and a closed route has no finish on
  // top of it. A tap near one lands on it (snap). Each can be dragged
  // (data-at: the point a drag moves; where points share a spot, the most
  // recent, as it's on top); while one is, it's at held.spot, and the
  // points moving with it have no markers of their own.
  function placeMarkers() {
    for (const m of markers) m.remove();
    markers = [];
    heldMarker = null;
    if (!mine()) return;
    const pts = state.points, n = pts.length;
    if (!n) return;
    const add = (ll, cls, label, j) => {
      const el = document.createElement("div");
      el.className = `wp ${cls} wp-drag`;
      el.dataset.at = j;
      el.setAttribute("role", "img");
      el.setAttribute("aria-label", label);
      const m = new maplibregl.Marker({ element: el }).setLngLat(ll).addTo(map);
      markers.push(m);
      if (held?.j === j) {
        heldMarker = m;
        if (!held.id) el.classList.add("wp-held");
      }
    };
    const moves = (i) => !!held?.moving.has(i);
    const at = (i) => (moves(i) ? held.spot : pts[i]);
    const closed = n > 1 && samePoint(pts[n - 1], pts[0]);
    // vias: one marker a spot, for its most recent point; none under the
    // start or the finish (after a lap, say), nor for points moving with the held one
    const vias = new Map();
    for (let i = 1; i < n - 1; i++) {
      if (moves(i) || samePoint(at(i), at(0)) || (!closed && samePoint(at(i), at(n - 1)))) continue;
      vias.set(`${pts[i][0].toFixed(6)},${pts[i][1].toFixed(6)}`, i);
    }
    for (const i of vias.values()) add(pts[i], "wp-via", `Via point ${i}`, i);
    if (held && held.j > 0 && held.j < n - 1 && !held.moving.has(0) && !held.moving.has(n - 1)) add(held.spot, "wp-via", `Via point ${held.j}`, held.j);
    if (n > 1 && !closed) add(at(n - 1), "wp-fin", "Finish", n - 1);
    add(at(0), "wp-start", "Start", 0); // last, so it's on top
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
  // keep: once opened, move the map so the panel covers none of the route
  // (not when the map is going back to a view that was clear already).
  function setFolded(on, keep = true) {
    grip.setAttribute("aria-expanded", !on);
    if (body.classList.contains("p2p-folded") === on) return;
    const moved = smooth([...document.querySelectorAll(".p2p-fold")], !on, () => { body.classList.toggle("p2p-folded", on); labelGrip(); });
    if (!on && keep) moved.then(keepInView, () => {}); // opened: it may cover the route now
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
  // Selected leg, the third (the user, 2026-11-26), comes only with a leg
  // selected from the leg menu, its own dot appearing: the same for that
  // leg (and its Lap copies), its points staying put. Its routing doesn't
  // go on to the next tap: going back to Next leg brings that one back.
  // A change of its routing is an Undo step, as under Last leg.
  const SCOPES = ["next", "last", "leg"]; // in the heading's order; maybe a whole-route one later (the user)
  let choiceGen = 0; // counts changes and Undos, so only the newest change is acted on
  const canCompare = () => !!state.legs.at(-1)?.tap;
  // The scopes on offer now, in the heading's order: Selected leg only
  // while a leg is selected.
  const scopes = () => SCOPES.filter((s) => s === "next" || (s === "last" && canCompare()) || (s === "leg" && state.pick != null));
  // A leg and a Lap's copies of it (the same leg, sharing one line), by index.
  const copiesOf = (k) => state.legs.flatMap((l, i) => (l.points === state.legs[k]?.points ? [i] : []));
  let nextChoice = null; // the next leg's routing and Minimise climb, kept while a leg is selected
  let pickLegs = new Map(); // the selected leg as routed each way so far, by routing, to go back to at once
  const routingKey = ({ routing, minimiseClimb, joined }) => (joined ? "joined" : routing === "freehand" ? routing : `${routing}|${minimiseClimb}`);
  function renderChoices() {
    for (const b of document.querySelectorAll("[data-routing]")) {
      const on = b.dataset.routing === state.routing;
      b.classList.toggle("active", on);
      b.setAttribute("aria-checked", on);
    }
    $("p2p-climb").setAttribute("aria-checked", state.minimiseClimb);
  }
  const SCOPE_NAMES = { next: "Next leg", last: "Last leg", leg: "Selected leg" };
  function renderScope() {
    if ((state.scope === "last" && !canCompare()) || (state.scope === "leg" && !(state.pick < state.legs.length))) resetScope();
    const on = scopes(), can = on.length > 1, s = state.scope, btn = $("p2p-scope");
    btn.disabled = !can;
    $("p2p-title").textContent = SCOPE_NAMES[s];
    $("p2p-scope-dots").querySelectorAll("i").forEach((d, i) => { d.hidden = i >= on.length; });
    $("p2p-scope-dots").style.setProperty("--at", Math.max(0, on.indexOf(s)));
    const what = !can ? "" : s !== "next" ? "Tap to go back to the next leg" : "Tap to compare routings for the last leg";
    btn.setAttribute("aria-label", `${SCOPE_NAMES[s]} routing${what ? `. ${what}` : ""}`);
    btn.title = what;
    $("p2p-routing").setAttribute("aria-label", `Routing for the ${SCOPE_NAMES[s].split(" ")[0].toLowerCase()} leg`);
  }
  $("p2p-scope").addEventListener("click", () => {
    const on = scopes();
    if (on.length < 2) return;
    toScope(on[(on.indexOf(state.scope) + 1) % on.length]);
  });
  // Changes the scope (picked: a leg has just been selected, state.pick).
  // Leaving Selected leg ends the selection and brings back the next leg's
  // routing.
  function toScope(s, picked = false) {
    closeMenu();
    choiceGen++; // a re-route on its way was for the scope before
    if (s === "leg") {
      if (state.scope !== "leg") nextChoice = { routing: state.routing, minimiseClimb: state.minimiseClimb };
      if (picked) { const leg = state.legs[state.pick]; pickLegs = new Map([[routingKey(leg), leg]]); }
    } else if (state.scope === "leg") {
      resetScope();
    }
    if (s !== "leg") state.pick = null;
    state.scope = s;
    if (s === "last") followLast();
    if (s === "leg") followPick();
    renderScope();
    drawLine();
  }
  // Back to Next leg, without drawing (the route is changing: a point
  // placed or moved, a Lap, Clear, Undo).
  function resetScope() {
    if (state.scope === "leg" && nextChoice) {
      Object.assign(state, nextChoice);
      renderChoices();
    }
    nextChoice = null;
    state.scope = "next";
    state.pick = null;
  }
  function choose(change) {
    Object.assign(state, change);
    renderChoices();
    if (state.scope === "next" || !state.routing) return; // the next leg's, nothing to re-route (or a joined leg's switch, before a routing's chosen)
    const gen = ++choiceGen, want = { routing: state.routing, minimiseClimb: state.minimiseClimb };
    const job = state.scope === "last" ? reroute.bind(null, state.legs.at(-1), want, gen) : rerouteLeg.bind(null, state.pick, want, gen);
    queue = queue.then(() => gen === choiceGen && job()).catch((err) => {
      console.error(err);
      toast(`Couldn't re-route ${state.scope === "last" ? "the last" : "that"} leg. Try again?`);
    });
  }
  // Freehand doesn't use Minimise climb, so switching it leaves a Freehand
  // leg be. A joined leg isn't routed end to end, whatever its parts were.
  const routedAs = (leg, { routing, minimiseClimb }) =>
    !leg.joined && leg.routing === routing && (routing === "freehand" || leg.minimiseClimb === minimiseClimb);
  // leg: the last leg when the change was made, the one on show. A tap
  // still on its way then places its own leg first, and that's left be.
  async function reroute(leg, want, gen) {
    if (state.legs.at(-1) !== leg || routedAs(leg, want)) return;
    const got = await legFor(leg.tap, want);
    if (gen !== choiceGen || state.legs.at(-1) !== leg) return; // changed again meanwhile, or Undo, or Clear
    if (got.refused) {
      if (state.scope === "last") followLast();
      return toast(notRerouted(got.refused, got.detail, want, "the last leg"), 4500);
    }
    // its new end, and the start too if it's the first leg (as in tapAt)
    const legs = [...state.legs.slice(0, -1), got.leg];
    const points = legs.length > 1 ? state.points.slice(0, -1) : [got.leg.points[0]];
    record(true); // an Undo step
    state.points = [...points, got.leg.points.at(-1)];
    state.legs = legs;
    render();
  }
  // The selected leg k (and its Lap copies) routed want's way between its
  // two points, which stay exactly where they are, so the legs either side
  // still meet it: from a point off the paths it starts with a straight
  // join; an end off the paths is refused (as for a tap). Ways seen before
  // come back at once. An Undo step (the user, 2026-11-26).
  async function rerouteLeg(k, want, gen) {
    const leg = state.legs[k];
    if (!leg || state.scope !== "leg" || routedAs(leg, want)) return;
    let next = pickLegs.get(routingKey(want));
    if (!next) {
      const from = state.points[k], to = state.points[k + 1];
      const join = k === 0 ? startFree() : endFree(state.legs[k - 1]);
      const got = await legFor({ from, to, join, reach: reachAt(to) }, want);
      if (gen !== choiceGen || state.legs[k] !== leg) return; // changed again meanwhile, or the route changed
      if (got.refused) {
        followPick();
        const fix = leg.mixed ? " Switch it to Freehand, or drag its points nearer paths." : "";
        return toast(notRerouted(got.refused, got.detail, want, "that leg") + fix, fix ? 8000 : 4500);
      }
      next = { ...got.leg, points: [from, ...got.leg.points.slice(1, -1), to] };
      pickLegs.set(routingKey(want), next);
    }
    const swap = new Map(copiesOf(k).map((i) => [state.legs[i], { ...next, tap: state.legs[i].tap ? next.tap : null }]));
    record(true);
    state.legs = state.legs.map((l) => swap.get(l) ?? l);
    render();
  }
  // A change of routing that couldn't re-route the last leg, or a selected
  // one, for the pink toast (the user, 2026-11-22: the warning line under
  // the chips grew the panel and moved them from under the finger).
  // same_point: as far as paths go, its point is where it sets off.
  const ROUTING_NAMES = { pleasant: "Pleasant", shortest: "Shortest", freehand: "Freehand" };
  const NOT_REROUTED = {
    no_path_near: ({ end }) => end === "from" ? "no path within 300 m of where it starts" : "its end is off the paths",
    no_nearer: () => "no path comes nearer its end",
    same_point: () => "no path comes nearer its end",
    no_route: () => "no way along paths between its ends",
    no_map: () => "no map data there",
  };
  function notRerouted(reason, detail, { routing, minimiseClimb }, which) {
    const why = NOT_REROUTED[reason];
    if (!why) return `No answer from the server, so ${which} stays as it was. Try again?`;
    return `${ROUTING_NAMES[routing]}${minimiseClimb ? " with Minimise climb" : ""} can't route ${which}: ${why(detail)}. It stays as it was.`;
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
  // The same for the selected leg (a joined one shows its routing, the
  // one it's routed again with).
  function followPick() {
    const leg = state.legs[state.pick];
    if (!leg) return;
    state.routing = leg.routing;
    if (leg.routing !== "freehand") state.minimiseClimb = leg.minimiseClimb;
    renderChoices();
  }
  // A joined leg's line isn't routed end to end, so its own chip, lit
  // already, routes it end to end too.
  const inScope = () => (state.scope === "last" ? state.legs.at(-1) : state.scope === "leg" ? state.legs[state.pick] : null);
  $("p2p-routing").addEventListener("click", (e) => {
    const b = e.target.closest("[data-routing]");
    if (!b || (b.dataset.routing === state.routing && !inScope()?.joined)) return;
    choose({ routing: b.dataset.routing });
  });
  $("p2p-climb").addEventListener("click", () => choose({ minimiseClimb: !state.minimiseClimb }));

  function render() {
    closeMenu();
    // the route changed under a point being moved (Undo, Clear, a re-route): it goes back
    if (held && (state.points !== held.points || state.legs !== held.legs)) {
      const was = held;
      letGo();
      if (was.over) hideToast();
      if (!was.id) drag.cancel();
    }
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
    $("p2p-redo").disabled = !redos.length;
    body.classList.toggle("p2p-can-redo", redos.length > 0);
    $("p2p-clear").hidden = !n;
    // Lap, while the route ends on a spot it came through before (so
    // still there after a lap), with how long the lap is, and after a Lap
    // how many times the route runs it, in the arrow
    const lap = lapAt(), lapLength = lap ? route.distance - lap.from : 0;
    $("p2p-lap").hidden = lapLength < LAP_MIN_M;
    if (lapLength >= LAP_MIN_M) {
      const count = state.lap?.count ?? 0;
      $("p2p-lap-km").textContent = `${km(lapLength)} km`;
      $("p2p-lap-count").textContent = count || "";
      $("p2p-lap-count").classList.toggle("two-digits", count > 9);
      $("p2p-lap").setAttribute("aria-label", `Lap, ${km(lapLength)} km${count ? `, ${count} laps so far` : ""}`);
    }
    syncHeart();
    scheduleSave(); // a hearted route's favourite follows it
    renderScope(); // Last leg only while a tap placed the last leg (before drawLine: it lights it up)
    placeMarkers();
    drawLine();
    drawHeld();
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

  // Focus (js/modes.js): the whole route framed, or just A before there's a
  // leg, clear of the panel, the top bar and Undo and Clear. Nothing before A.
  const canFocus = () => state.points.length > 0;
  function focus() {
    if (state.points.length) frameOnMap(map, route ? [...route.raw, ...state.points] : state.points, opts.padding());
  }

  // A tap that placed no point says why in the pink toast, like a change
  // of routing that couldn't re-route the last leg (the user, 2026-11-23:
  // every routing error in the toast). reason: as the leg service gives it.
  const REFUSED = {
    too_far: ({ far }) => `That point is ${far ? `${Math.round(far / 1000)} km` : "too far"} from the last one in a straight line, and legs go up to ${MAX_LEG_M / 1000} km, so routing stays quick. For a longer route, add points along the way.`,
    no_path_near: ({ end }) => end === "from"
      ? "No paths near the last point: it's more than 300 m from any path or street we can route on, so this leg can't follow one. Use Freehand until you're nearer one."
      : `${end === "start" ? "Can't start there" : "Can't route to that spot"}: there's no path or street we can route on right there. It may be private or closed, or a road with nowhere to walk, even where the map draws one. Tap on a path or street, or use Freehand.`,
    no_nearer: () => "No path goes nearer: the closest a path or street comes to that point is where the route already ends. Use Freehand to go off the paths, or tap further along one.",
    no_route: () => "No route found: the map knows no way along paths and streets between these points. Try a point nearby, or use Freehand.",
    no_map: () => "No map data here: routing covers the UK for now. Freehand works anywhere.",
    offline: () => "Couldn't route that leg: no answer from the server. Check your connection and try again, or use Freehand.",
  };
  // A tap that found nothing to route on says what the map draws there
  // (js/spot.js: a trunk road, a private road, water, with its name), if
  // it can. Long messages stay up longer, to be read.
  function refuse(reason, detail = {}) {
    if (reason === "same_point") return;
    const specific = reason === "no_path_near" && detail.end !== "from" && detail.at &&
      whyNotHere(map, detail.at, TAP_PX, detail.end === "start");
    const msg = specific || (REFUSED[reason] ?? REFUSED.offline)(detail);
    toast(msg, Math.min(9000, Math.max(4500, msg.length * 50)));
  }

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
  $("p2p-reverse").addEventListener("click", reverseRoute);
  $("p2p-redo").addEventListener("click", redo);
  $("p2p-lap").addEventListener("click", addLap);
  $("p2p-clear").addEventListener("click", clear);
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  // icons only, so laptops say what they are, and their keys, on hover
  $("p2p-undo").title = `Undo (${mac ? "⌘Z" : "Ctrl+Z"})`;
  $("p2p-redo").title = `Redo (${mac ? "⇧⌘Z" : "Ctrl+Y"})`;
  // ⌘Z / Ctrl+Z undoes; ⇧⌘Z / Ctrl+Shift+Z / Ctrl+Y redoes
  addEventListener("keydown", (e) => {
    if (!mine() || !(e.metaKey || e.ctrlKey) || e.altKey) return;
    const k = e.key.toLowerCase(), back = k === "z" && !e.shiftKey, again = (k === "z" && e.shiftKey) || (k === "y" && !e.shiftKey && !mac);
    if (!back && !again) return;
    if (document.querySelector("dialog[open]") || e.target.closest?.("input, textarea")) return;
    e.preventDefault();
    if (back) undo();
    else redo();
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
      share: { kind: "p2p", raw: route.raw, distance: route.distance, info: route.info, ...(route.elevation && { ...shrinkProfile(route.elevation, route.elevationStep), climb: route.climb }) }, // for Copy link, as favourites keep it
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
    drag.cancel();
    ready.then(() => {
      setSourceVisible(map, "route", true);
      map.getSource("p2p").setData(EMPTY);
      map.getSource("p2p-drag").setData(EMPTY);
    });
    for (const m of markers) m.remove();
    markers = [];
    markPoint(null);
    closeMenu();
  }

  renderChoices();
  render();

  return { enter, leave, canFocus, focus };
}
