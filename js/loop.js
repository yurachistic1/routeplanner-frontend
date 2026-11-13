// Loop mode: round runs of a chosen distance from a start point. The start
// marker, requesting routes, smoothing, the route list, prev/next, route
// info and GPX download. The map and its shared controls come from
// js/map.js, and js/modes.js switches modes.
//
// The page supplies the route layers (js/main.js), and these element ids
// (all optional):
//   #distance (number input), .chip[data-km], #dec, #inc, #generate,
//   #route-list, #list-toggle, #prev, #next, #download, #edit, #back,
//   #route-title, #route-distance, #route-count, #list-title, #back-label,
//   #info-tab, #info-list, #info-legend
// The route layers draw from the "route" source, whose lines have a "part"
// property: "all" (the whole route), "plain" and "country".
// And these body classes, which the CSS reacts to:
//   has-start, loading, has-results, show-results, list-open, in-favourites,
//   has-info (the route has info to show), has-warnings, info-open

import { API_BASE } from "./api.js";
import { $, toast } from "./ui.js";

const API_URL = `${API_BASE}/routes`;
const EMPTY = { type: "FeatureCollection", features: [] };
const body = document.body;

class UserError extends Error {}

// ---------- geometry ----------

// Metres per degree near London, good enough for simplifying.
const M_LAT = 111320;
const mLon = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);

// Douglas-Peucker on [lon, lat] points with a tolerance in metres.
function simplify(pts, tol) {
  return keptIndices(pts, tol).map((i) => pts[i]);
}

// The indices of the points simplify keeps. It always keeps the ends and
// any fixed points, such as where a marked stretch starts or ends.
function keptIndices(pts, tol, fixed = []) {
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

const metresPerPixel = (zoom, lat) => (40075016.7 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
// Corner radius on the map, in screen pixels.
const CORNER_PX = 6;

// ---------- marked stretches ----------

// Route info warns about uncertain paths (the backend's countryside paths:
// untagged surface, outside towns and parks) from COUNTRY_WARN_M metres in
// all: even 100 m of path can be through brambles (the user, 2026-11-08).
// The map marks the same stretches, dashed. Roads without a sidewalk were
// warned about and marked in red too, until the user found the sidewalk data
// too patchy to trust (2026-11-09).
const COUNTRY_WARN_M = 100;
const MARK_NAMES = { country: "Uncertain path" };

// [kind, [[from, to], ...]] for each kind to mark. from and to index the
// route's points.
function marks(info) {
  const out = [];
  if (info?.countryPaths >= COUNTRY_WARN_M && info.countryPathSpans?.length) out.push(["country", info.countryPathSpans]);
  return out;
}

// The route smoothed for the map (mpp metres per pixel), as one line plus the
// parts to draw: "plain" and "country". Where a stretch starts or
// ends is kept through simplifying, so the parts follow the line exactly and
// meet end to end.
function shapeRoute(r, mpp) {
  const raw = r.raw;
  const kind = new Array(Math.max(raw.length - 1, 0)).fill("plain"); // per raw segment
  for (const [k, spans] of marks(r.info)) {
    for (const [a, b] of spans) {
      for (let i = Math.max(0, a); i < Math.min(b, kind.length); i++) if (kind[i] === "plain") kind[i] = k;
    }
  }
  const fixed = [];
  for (let i = 1; i < kind.length; i++) if (kind[i] !== kind[i - 1]) fixed.push(i);
  const kept = keptIndices(raw, mpp, fixed);
  const seg = [];
  const coords = roundCorners(kept.map((i) => raw[i]), CORNER_PX * mpp, seg);
  // Simplified segment j runs from raw point kept[j] to kept[j + 1], all of one kind.
  const parts = [];
  for (let q = 0; q < coords.length - 1; q++) {
    const k = kind[kept[seg[q]]] ?? "plain";
    const last = parts[parts.length - 1];
    if (last?.kind === k) last.to = q + 1;
    else parts.push({ kind: k, from: q, to: q + 1 });
  }
  return { coords, parts };
}


function bounds(pts) {
  const b = new maplibregl.LngLatBounds(pts[0], pts[0]);
  for (const p of pts) b.extend(p);
  return b;
}

// A small SVG of the route's shape, for the list.
export function thumbnail(pts, size = 44) {
  const k0 = mLon(pts[0][1]);
  const lons = pts.map((p) => p[0]), lats = pts.map((p) => p[1]);
  const extent = Math.max((Math.max(...lons) - Math.min(...lons)) * k0, (Math.max(...lats) - Math.min(...lats)) * M_LAT);
  // Same idea as the map line: keep the real shape, drop only detail too
  // small to see at thumbnail size, and soften the corners a little.
  const s = roundCorners(simplify(pts, extent / 120), extent / 40);
  const kx = mLon(s[0][1]);
  const xs = s.map((p) => p[0] * kx), ys = s.map((p) => -p[1] * M_LAT);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = (size - 8) / Math.max(maxX - minX, maxY - minY, 1);
  const ox = (size - (maxX - minX) * scale) / 2, oy = (size - (maxY - minY) * scale) / 2;
  const P = s.map((_, i) => [ox + (xs[i] - minX) * scale, oy + (ys[i] - minY) * scale]);
  const d = P.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");
  return `<svg class="thumb" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
    <path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${P[0][0].toFixed(1)}" cy="${P[0][1].toFixed(1)}" r="2.6" class="thumb-start"/>
  </svg>`;
}

// ---------- loop mode ----------

/**
 * createLoopMode(map, ready, opts), with map and ready from createMap.
 * opts:
 *   addRouteLayers(map): add layers on the "route" source
 *   markerHTML: inner HTML for the start marker
 *   padding(): {top, bottom, left, right} to keep routes clear of the UI
 *   animate: draw the route progressively
 *   formatIndex(i): label for list numbers
 *   onExitFavourites(): favourites have closed
 * Returns the mode's controls, used by accounts (js/account.js) too, plus
 * enter() and leave() for js/modes.js.
 */
export function createLoopMode(map, mapReady, opts) {
  const o = { padding: () => 60, formatIndex: (i) => String(i + 1), ...opts };

  const state = { start: null, routes: [], index: 0, target: 0 };
  let marker = null;
  let anim = 0;

  const ready = mapReady.then(() => {
    map.addSource("route", { type: "geojson", data: EMPTY });
    o.addRouteLayers?.(map);
  });

  // ----- start point -----
  function setStart(lngLat) {
    state.start = maplibregl.LngLat.convert(lngLat);
    if (!marker) {
      const el = document.createElement("div");
      el.className = "start-marker";
      el.innerHTML = o.markerHTML ?? "";
      marker = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(state.start).addTo(map);
      marker.on("dragend", () => { state.start = marker.getLngLat(); });
    } else {
      marker.setLngLat(state.start);
    }
    body.classList.add("has-start");
  }
  // The start stays put while routes are on screen, so it always matches
  // them. Clicking the map leaves them to plan a new run from there; Back
  // returns to them and their start. Favourites ignore it, so a stray tap
  // while looking at a saved route doesn't drop you out.
  const viewingRoutes = () => body.classList.contains("show-results");
  // Other planning modes (GPS art) take the map's taps and keys themselves.
  const mine = () => ["loop", "favourites"].includes(body.dataset.mode);
  map.on("click", (e) => {
    if (!mine()) return;
    if (state.favourites && viewingRoutes()) return;
    if (viewingRoutes()) newRun();
    setStart(e.lngLat);
  });

  // ----- distance -----
  const input = $("distance");
  function setDistance(km) {
    if (!input) return;
    input.value = Math.max(1, Math.min(35, Math.round(km * 10) / 10));
    syncChips();
  }
  function syncChips() {
    for (const c of document.querySelectorAll(".chip[data-km]")) {
      c.classList.toggle("active", parseFloat(c.dataset.km) === parseFloat(input.value));
    }
  }
  input?.addEventListener("input", syncChips);
  for (const c of document.querySelectorAll(".chip[data-km]")) {
    c.addEventListener("click", () => setDistance(parseFloat(c.dataset.km)));
  }
  $("dec")?.addEventListener("click", () => setDistance((parseFloat(input.value) || 2) - 1));
  $("inc")?.addEventListener("click", () => setDistance((parseFloat(input.value) || 0) + 1));
  syncChips();

  // ----- requesting -----
  async function fetchRoutes(lat, lon, km) {
    let res;
    try {
      // In the body, not the URL: URLs end up in server logs, and a start point
      // can be someone's home. A form body also avoids a CORS preflight.
      res = await fetch(API_URL, { method: "POST", body: new URLSearchParams({ lat, lon, distance: km }) });
    } catch {
      return null; // backend unreachable
    }
    if (res.status === 422) throw new UserError("No map data here yet. Only the UK for now.");
    if (!res.ok) throw new UserError(`Something went wrong (${res.status}). Try again?`);
    return res.json();
  }

  async function generate() {
    const km = parseFloat(input?.value);
    if (!(km >= 1 && km <= 35)) return toast("Pick a distance between 1 and 35 km");
    if (!state.start) return toast("Tap the map to choose where you start");

    body.classList.add("loading");
    $("generate")?.setAttribute("disabled", "");
    try {
      const routes = await fetchRoutes(state.start.lat, state.start.lng, km);
      if (routes === null) throw new UserError("Can't reach the server. Check your connection and try again.");
      if (!routes.length) throw new UserError("No routes found from here. Try another start point.");
      await showRoutes(
        routes.map((r) => ({
          distance: r.distance, raw: r.path.map(([lat, lon]) => [lon, lat]),
          info: { countryPaths: r.countryPaths || 0, countryPathSpans: r.countryPathSpans ?? [] },
        })),
        { target: km, start: state.start },
      );
    } catch (err) {
      toast(err instanceof UserError ? err.message : "Couldn't get routes. Check your connection.");
      console.error(err);
    } finally {
      body.classList.remove("loading");
      $("generate")?.removeAttribute("disabled");
    }
  }
  $("generate")?.addEventListener("click", generate);

  // Puts a set of routes on screen: fresh results, or saved favourites, which
  // have no target distance. Opening favourites remembers exactly where loop
  // mode was (its routes, which one, and whether you were looking at them or
  // planning a new run), so exitFavourites can put it all back.
  async function showRoutes(routes, { target = null, start, index = 0, favourites = false }) {
    if (favourites && !state.favourites) {
      state.before = {
        routes: state.routes, index: state.index, target: state.target, routeStart: state.routeStart,
        start: state.start, camera: { center: map.getCenter(), zoom: map.getZoom() },
        viewing: viewingRoutes(), listOpen: body.classList.contains("list-open"),
      };
    }
    if (!favourites) state.before = null;
    state.favourites = favourites;
    body.classList.toggle("in-favourites", favourites);
    cancelAnimationFrame(anim);
    setStart(start);
    state.target = target;
    state.routeStart = state.start;
    state.routes = routes.map((r, i) => ({ ...r, i }));
    state.index = index;
    renderList();
    body.classList.add("has-results", "show-results");
    if (favourites && matchMedia("(max-width: 899px)").matches) body.classList.add("list-open");
    marker?.setDraggable(false);
    await ready;
    show(index);
  }

  // Back to loop mode as it was: the routes you were looking at, or the new
  // run you were planning (with its start, even if routes from before are
  // still there to go Back to). Tells the page (opts.onExitFavourites), so
  // the shelf leaves the Favourites mode however they were closed.
  async function exitFavourites() {
    if (!state.favourites) return;
    const b = state.before;
    body.classList.remove("list-open");
    if (b.routes.length) {
      const shown = showRoutes(b.routes, { target: b.target, start: b.routeStart, index: b.index });
      o.onExitFavourites?.();
      if (b.viewing) {
        if (b.listOpen) body.classList.add("list-open");
        return shown;
      }
      await shown;
      newRun();
      if (b.start) setStart(b.start);
      map.easeTo({ ...b.camera, duration: 700 });
      return;
    }
    state.before = null;
    state.favourites = false;
    body.classList.remove("in-favourites");
    newRun();
    state.routes = [];
    state.routeStart = null;
    state.index = 0;
    renderList();
    body.classList.remove("has-results");
    if (b.start) {
      setStart(b.start);
    } else {
      marker?.remove();
      marker = null;
      state.start = null;
      body.classList.remove("has-start");
    }
    map.easeTo({ ...b.camera, duration: 700 });
    o.onExitFavourites?.();
  }

  // Swaps the list without redrawing the route, unless the one on screen went.
  function updateRoutes(routes, index, redraw) {
    state.routes = routes.map((r, i) => ({ ...r, i }));
    state.index = index;
    renderList();
    if (redraw) show(index);
    else markCurrent();
  }

  // ----- views: planning a new run vs viewing routes -----
  // New run: clear the route and list, leaving just the map and the start pin.
  function newRun() {
    cancelAnimationFrame(anim);
    drawing = false;
    shownKey = null;
    drawRoute(null);
    body.classList.remove("show-results", "list-open");
    marker?.setDraggable(true);
  }
  // Back: return to the routes from before, as they were.
  function backToRoutes() {
    if (!state.routes.length) return;
    const first = state.routes[0].raw[0];
    setStart(state.routeStart ?? first);
    body.classList.add("show-results");
    marker?.setDraggable(false);
    show(state.index);
  }
  // New run from favourites (desktop shows the button there) leaves them
  // first, so the shelf goes back to Loop.
  $("edit")?.addEventListener("click", async () => {
    if (state.favourites) await exitFavourites();
    newRun();
  });
  $("back")?.addEventListener("click", backToRoutes);

  // ----- list -----
  const icon = (path) => `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
  const HEART = (i) => `<button class="ri-action ri-heart" data-i="${i}" aria-label="Favourite this route" aria-pressed="false">${icon("M12 20.5S3 15 3 8.8A4.8 4.8 0 0 1 12 6.5a4.8 4.8 0 0 1 9 2.3C21 15 12 20.5 12 20.5z")}</button>`;
  const BIN = (i) => `<button class="ri-action ri-bin" data-i="${i}" aria-label="Remove from favourites">${icon("M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5")}</button>`;
  const km = (m) => (m / 1000).toFixed(2);
  function renderList() {
    const ul = $("route-list");
    if (!ul) return;
    let group = null;
    ul.innerHTML = state.routes.map((r) => {
      const heading = r.group && r.group !== group ? `<li class="route-group" data-key="${r.group.key}"><span class="rg-place"></span><span class="rg-label">${r.group.label}</span></li>` : "";
      group = r.group;
      const delta = state.target === null ? null : r.distance / 1000 - state.target;
      const sign = delta >= 0 ? "+" : "−";
      return `${heading}<li class="route-cell"><button class="route-item" data-i="${r.i}">
        ${thumbnail(r.raw)}
        <span class="ri-num">${o.formatIndex(r.i)}${r.info && warnings(r.info).length ? `<i class="ri-dot" role="img" aria-label="has warnings"></i>` : ""}</span>
        <span class="ri-dist">${km(r.distance)}<small> km</small></span>
        ${delta === null ? "" : `<span class="ri-delta">${sign}${Math.abs(delta).toFixed(2)}</span>`}
      </button>${o.onRouteAction ? (state.favourites ? BIN(r.i) : HEART(r.i)) : ""}</li>`;
    }).join("");
    for (const b of ul.querySelectorAll(".ri-action")) {
      b.addEventListener("click", () => o.onRouteAction(state.routes[+b.dataset.i]));
    }
    for (const b of ul.querySelectorAll(".route-item")) {
      b.addEventListener("click", () => {
        show(+b.dataset.i);
        if (matchMedia("(max-width: 899px)").matches) body.classList.remove("list-open");
      });
    }
    if ($("route-count")) $("route-count").textContent = state.routes.length;
    const name = state.favourites ? "favourites" : "routes";
    if ($("list-title")) $("list-title").textContent = state.favourites ? `${state.routes.length} saved` : "Routes";
    if ($("list-toggle")) $("list-toggle").textContent = `All ${name}`;
    // Phones drop "Back to" (.back-long), to fit beside Generate.
    if ($("back-label")) $("back-label").innerHTML = `← <span class="back-long">Back to </span>${name}`;
  }

  $("list-toggle")?.addEventListener("click", () => body.classList.toggle("list-open"));

  // ----- route info -----
  // A drawer above the route controls, opened from the tab on the panel's
  // top edge: what to know about the route before running it. Warnings are
  // honest about what the map data can't promise. Favourites keep it too,
  // except ones saved before 2026-11-08, which show no tab.
  const kmText = (m) => `${(m / 1000).toFixed(1)} km`;
  function warnings(info) {
    const out = [];
    if (info.countryPaths >= COUNTRY_WARN_M) {
      out.push({ title: `${kmText(info.countryPaths)} on uncertain paths`, text: "We don't know their surface or whether they're looked after, so they may not be good for running in all conditions." });
    }
    return out;
  }
  // A note under "Nothing to flag", true to the small amount under the
  // warning threshold; none when there are no uncertain paths at all.
  function nothingToFlag(info) {
    return info.countryPaths > 0 ? "<span>Under 0.1 km on uncertain paths.</span>" : "";
  }
  function renderInfo(r) {
    const list = $("info-list");
    body.classList.toggle("has-info", !!r.info);
    if (!r.info || !list) return;
    const w = warnings(r.info);
    body.classList.toggle("has-warnings", w.length > 0);
    list.innerHTML = w.length
      ? w.map((x) => `<li class="warn"><span class="info-mark" aria-hidden="true">!</span><div><b>${x.title}</b><span>${x.text}</span></div></li>`).join("")
      : `<li class="ok"><span class="info-mark" aria-hidden="true">✓</span><div><b>Nothing to flag</b>${nothingToFlag(r.info)}</div></li>`;
    // A key to how the map marks them.
    const legend = $("info-legend");
    if (legend) {
      legend.innerHTML = marks(r.info)
        .map(([kind]) => `<span class="key key-${kind}"><i aria-hidden="true"></i>${MARK_NAMES[kind]}</span>`).join("");
    }
  }
  // Opening it makes the panel taller, so frame the route again above it.
  function refit() {
    const r = state.routes[state.index];
    const target = r && map.cameraForBounds(bounds(r.raw), { padding: o.padding(), maxZoom: 16 });
    if (target) map.easeTo({ ...target, duration: 400 });
  }
  $("info-tab")?.addEventListener("click", () => {
    const open = body.classList.toggle("info-open");
    $("info-tab").setAttribute("aria-expanded", open);
    refit();
  });

  // ----- showing a route -----
  // The route source holds the whole line, part "all" (for the halo), and
  // its parts (see shapeRoute), cut to the first n points while the route
  // draws itself in.
  function drawRoute(shape, n = Infinity) {
    const src = map.getSource("route");
    if (!src) return;
    if (!shape) return src.setData(EMPTY);
    const end = Math.min(n, shape.coords.length) - 1; // last point drawn
    const line = (part, coordinates) => ({ type: "Feature", properties: { part }, geometry: { type: "LineString", coordinates } });
    const features = [line("all", shape.coords.slice(0, end + 1))];
    for (const p of shape.parts) {
      if (p.from >= end) break;
      features.push(line(p.kind, shape.coords.slice(p.from, Math.min(p.to, end) + 1)));
    }
    src.setData({ type: "FeatureCollection", features });
  }

  // Smoothing is fixed in screen pixels, so it looks the same at every zoom:
  // drop detail smaller than ~1px, then round corners with a ~6px radius.
  // On the ground that's a few metres up close (exact roads) and more when
  // zoomed out, but it never cuts across blocks. Past the zoom that fits the
  // whole route it stops growing. Cached per route for each half zoom level.
  const half = (z) => Math.round(z * 2) / 2;
  const zoomKey = () => half(map.getZoom());
  function fitKey(r) {
    r.fitKey ??= half(map.cameraForBounds(bounds(r.raw), { padding: o.padding(), maxZoom: 16 })?.zoom ?? 13);
    return r.fitKey;
  }
  function shapeAt(r, key) {
    key = Math.max(key, fitKey(r));
    r.cache ??= new Map();
    if (!r.cache.has(key)) r.cache.set(key, shapeRoute(r, metresPerPixel(key, r.raw[0][1])));
    return r.cache.get(key);
  }

  let drawing = false;
  let shownKey = null;
  // Re-smooth once the zoom gesture ends, not during it: swapping the line
  // mid-pinch makes the map re-process it and stutter under your fingers.
  map.on("zoomend", () => {
    const r = state.routes[state.index];
    const key = zoomKey();
    // Only while routes are on screen: after "New run" the map is blank.
    if (!r || drawing || !viewingRoutes() || key === shownKey) return;
    shownKey = key;
    drawRoute(shapeAt(r, key));
  });

  // Scroll only the list itself so the selected route is visible.
  // (scrollIntoView would also scroll the page while the list slides in.)
  function scrollListTo(item) {
    const list = $("route-list");
    if (!list) return;
    const l = list.getBoundingClientRect(), r = item.getBoundingClientRect();
    if (r.top < l.top) list.scrollBy({ top: r.top - l.top - 8, behavior: "smooth" });
    else if (r.bottom > l.bottom) list.scrollBy({ top: r.bottom - l.bottom + 8, behavior: "smooth" });
  }

  function show(i) {
    if (!state.routes.length) return;
    state.index = (i + state.routes.length) % state.routes.length;
    const r = state.routes[state.index];
    if (r.start) setStart(r.start); // saved routes each have their own start
    renderInfo(r); // first: it changes the panel's height, which framing allows for

    const target = map.cameraForBounds(bounds(r.raw), { padding: o.padding(), maxZoom: 16 });
    const key = target ? Math.round(target.zoom * 2) / 2 : zoomKey();

    cancelAnimationFrame(anim);
    if (o.animate) drawProgressively(r, key);
    else { drawRoute(shapeAt(r, key)); shownKey = key; }

    if (target) map.easeTo({ ...target, duration: 700 });

    markCurrent();
    o.onShow?.(state.index, r);
  }

  function markCurrent() {
    const r = state.routes[state.index];
    if ($("route-title")) $("route-title").textContent = o.formatIndex(state.index);
    if ($("route-distance")) $("route-distance").textContent = km(r.distance);
    renderInfo(r);
    for (const b of document.querySelectorAll(".route-item")) {
      const on = +b.dataset.i === state.index;
      b.classList.toggle("selected", on);
      b.setAttribute("aria-current", on);
      if (on) scrollListTo(b);
    }
  }

  // Draws the route in from the start, using the smoothing for the zoom
  // the camera is heading to.
  function drawProgressively(r, key) {
    const shape = shapeAt(r, key);
    const t0 = performance.now(), dur = 1400;
    drawing = true;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      drawRoute(shape, Math.max(2, Math.ceil(e * shape.coords.length)));
      if (k < 1) { anim = requestAnimationFrame(step); return; }
      drawing = false;
      shownKey = zoomKey();
      drawRoute(shapeAt(r, shownKey));
    };
    anim = requestAnimationFrame(step);
  }

  $("prev")?.addEventListener("click", () => show(state.index - 1));
  $("next")?.addEventListener("click", () => show(state.index + 1));
  addEventListener("keydown", (e) => {
    if (!mine() || !state.routes.length || document.querySelector("dialog[open]")) return;
    if (e.key === "Escape") {
      if (body.classList.contains("list-open")) body.classList.remove("list-open");
      else if (!viewingRoutes()) backToRoutes();
      else exitFavourites();
      return;
    }
    if (!viewingRoutes() || e.target.tagName === "INPUT") return;
    if (e.key === "ArrowLeft") show(state.index - 1);
    if (e.key === "ArrowRight") show(state.index + 1);
  });

  // ----- GPX -----
  $("download")?.addEventListener("click", () => {
    const r = state.routes[state.index];
    if (!r) return;
    const pts = r.raw.map(([lon, lat]) => `<trkpt lat="${lat}" lon="${lon}"></trkpt>`).join("");
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="routeplanner"><trk><name>${km(r.distance)} km loop</name><trkseg>${pts}</trkseg></trk></gpx>`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([gpx], { type: "application/gpx+xml" }));
    a.download = `${km(r.distance)}km.gpx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  // Switching modes. Loop is the only planning mode so far, so there's
  // nothing to hide yet; when others arrive, leave() should clear the route
  // and start marker from the map and enter() put them back. Favourites
  // borrow this mode's route viewer for now (see main.js).
  const enter = () => {};
  const leave = () => {};

  return { map, state, show, showRoutes, updateRoutes, exitFavourites, toast, setStart, enter, leave };
}
