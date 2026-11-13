// GPS art mode: pick a shape and get routes that draw it on the streets,
// found within 15 km of the middle of the map. Nothing is placed on the
// map first: where a route starts isn't known until it's found. Found
// routes show their start with the same pink dot as loops (the user,
// 2026-11-13). The server answers with up to three,
// shortest first: a longer route is usually a better drawing.
//
// A shape is an icon found by name or the user's own drawing
// (js/shapes.js). The request is the
// shape's strokes plus the map's centre and the radius; see ArtRequest in
// the backend's art.go.
//
// Like every mode it keeps to its own map source and layers ("art"), and
// remembers where it was when you come back from the shelf.

import { API_BASE } from "./api.js";
import { smoothLine, metresPerPixel } from "./loop.js";
import { createIconPicker, createDrawPad } from "./shapes.js";
import { $, toast } from "./ui.js";

const EMPTY = { type: "FeatureCollection", features: [] };
const body = document.body;
const NAMES = ["Short", "Medium", "Long"];
const km = (m) => (m / 1000).toFixed(1);
const half = (z) => Math.round(z * 2) / 2;
const boundsOf = (pts) => pts.reduce((b, p) => b.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0]));

// A shape's strokes as a small drawing.
function thumbnail(shape) {
  const pts = shape.strokes.flat();
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  const w = Math.max(...xs) - x0, h = Math.max(...ys) - y0;
  const pad = Math.max(w, h) * 0.08;
  const lines = shape.strokes.map((s) => `<polyline points="${s.map((p) => p.join(",")).join(" ")}"/>`).join("");
  return `<svg viewBox="${x0 - pad} ${y0 - pad} ${w + 2 * pad} ${h + 2 * pad}" fill="none" stroke="currentColor"
    stroke-width="${Math.max(w, h) / 22}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${lines}</svg>`;
}

/**
 * createArtMode(map, mapReady, opts) wires up the GPS art panel (.art in the
 * deck) and returns { enter, leave } for js/modes.js.
 *   padding(): room to leave round a route when fitting it on screen
 *   addArtLayers(map): adds the layers that draw source "art", the route
 *   favourites: { toggle(route), has(route), onChange(fn) } from accounts,
 *     where route is { raw: [[lon, lat], ...], distance }
 */
export function createArtMode(map, mapReady, opts) {
  const RADIUS_KM = 15;
  const state = { shape: null, routes: [], index: 0 };
  let start = null; // the pink dot where the route on screen starts

  const ready = mapReady.then(() => {
    map.addSource("art", { type: "geojson", data: EMPTY });
    opts.addArtLayers(map);
  });

  // ----- shapes -----
  // The row holds the two ways of choosing a shape (find an icon, draw
  // one) and then the shape chosen.
  const TOOLS = `<button class="art-shape art-tool" data-tool="search">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg><span>Icons</span></button>
    <button class="art-shape art-tool" data-tool="draw">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19.3 8.7a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16v4z"/><path d="m13.5 6.5 4 4"/></svg><span>Draw</span></button>`;
  function renderShapes() {
    const s = state.shape;
    $("art-shapes").innerHTML = TOOLS + (s
      ? `<div class="art-shape active" aria-label="${s.name}">${thumbnail(s.shape)}<span>${s.name}</span></div>` : "");
  }
  // icon: whether it's one of the app's icons, which the server caches
  // results for (it doesn't for drawings)
  function setShape(name, strokes, icon = false) {
    state.shape = { name, shape: { strokes }, icon };
    renderShapes();
  }
  const openIcons = createIconPicker((name, strokes) => setShape(name, strokes, true));
  const openDraw = createDrawPad((strokes) => setShape("My shape", strokes));
  $("art-shapes").addEventListener("click", (e) => {
    const tool = e.target.closest("[data-tool]");
    if (tool) (tool.dataset.tool === "search" ? openIcons : openDraw)();
  });
  renderShapes();

  // ----- search -----
  async function find() {
    if (!state.shape) return toast("Pick an icon or draw a shape first");
    const centre = map.getCenter();
    body.classList.add("loading");
    $("art-find").setAttribute("disabled", "");
    try {
      let res;
      try {
        res = await fetch(`${API_BASE}/art`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lat: centre.lat, lon: centre.lng, radius_km: RADIUS_KM, shape: state.shape.shape,
            icon: state.shape.icon ? state.shape.name : undefined,
          }),
        });
      } catch {
        return toast("Can't reach the server. Check your connection and try again.");
      }
      if (res.status === 422) return toast("No map data here yet. Only the UK for now.");
      if (!res.ok) return toast(`Something went wrong (${res.status}). Try again?`);
      const { routes } = await res.json();
      if (!routes.length) return toast("Couldn't draw that here. Move the map and try somewhere else.");
      // raw is the path as [lon, lat], which the map and favourites use
      for (const r of routes) r.raw = r.path.map(([lat, lon]) => [lon, lat]);
      state.routes = routes;
      body.classList.add("art-results");
      $("art-options").innerHTML = routes.map((r, i) =>
        `<button class="art-option" data-option="${i}">
          <span class="tag">${NAMES[i + NAMES.length - routes.length] ?? ""}</span>
          <span class="mono art-km">${km(r.distance)}<small> km</small></span>
          <span class="art-fit${r.good ? " good" : ""}">${r.good ? "Close fit" : "Rough fit"}</span>
        </button>`).join("");
      // open on the longest: it is usually the best drawing
      show(routes.length - 1);
    } finally {
      body.classList.remove("loading");
      $("art-find").removeAttribute("disabled");
    }
  }
  $("art-find").addEventListener("click", find);

  // ----- results -----
  // The route on screen, and its start: the same pink dot as a loop's, but
  // fixed in place. The line is smoothed and drawn in just like a loop's
  // (js/loop.js): smoothing fixed in screen pixels, cached per half zoom
  // level, never coarser than at the zoom that fits the whole route, and
  // redone when a zoom gesture ends.
  const viewing = () => body.classList.contains("art-results");
  const current = () => (viewing() ? state.routes[state.index] : null);
  const camera = (r) => map.cameraForBounds(boundsOf(r.raw), { padding: opts.padding(), maxZoom: 16 });
  function lineAt(r, key) {
    r.fitKey ??= half(camera(r)?.zoom ?? 13);
    key = Math.max(key, r.fitKey);
    r.cache ??= new Map();
    if (!r.cache.has(key)) r.cache.set(key, smoothLine(r.raw, metresPerPixel(key, r.raw[0][1])));
    return r.cache.get(key);
  }
  const setLine = (coords) => map.getSource("art").setData(coords
    ? { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } } : EMPTY);

  let anim = 0, drawing = false, shownKey = null;
  function stopDrawing() {
    cancelAnimationFrame(anim);
    drawing = false;
  }
  // Draws the route in from its start, with the smoothing for the zoom the
  // camera is heading to. Same timing as loop.js's drawProgressively.
  function drawIn(r, key) {
    stopDrawing();
    const coords = lineAt(r, key);
    const t0 = performance.now(), dur = 1400;
    drawing = true;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      setLine(coords.slice(0, Math.max(2, Math.ceil(e * coords.length))));
      if (k < 1) { anim = requestAnimationFrame(step); return; }
      drawing = false;
      shownKey = half(map.getZoom());
      setLine(lineAt(r, shownKey));
    };
    anim = requestAnimationFrame(step);
  }
  map.on("zoomend", () => {
    const r = current(), key = half(map.getZoom());
    if (body.dataset.mode !== "art" || !r || drawing || key === shownKey) return;
    shownKey = key;
    setLine(lineAt(r, key));
  });

  // Puts the route on screen at once (coming back to the mode), or clears it.
  async function draw() {
    await ready;
    stopDrawing();
    const r = current();
    shownKey = r ? half(map.getZoom()) : null;
    setLine(r ? lineAt(r, shownKey) : null);
    placeStart(r);
    syncHeart();
  }
  function placeStart(r) {
    if (r) {
      if (!start) {
        const el = document.createElement("div");
        el.className = "start-marker art-start";
        start = new maplibregl.Marker({ element: el });
      }
      start.setLngLat(r.raw[0]).addTo(map);
    } else {
      start?.remove();
    }
  }
  function syncHeart() {
    const r = state.routes[state.index];
    const on = viewing() && !!r && opts.favourites.has(r);
    $("art-fav").classList.toggle("on", on);
    $("art-fav").setAttribute("aria-pressed", on);
  }
  opts.favourites.onChange(syncHeart);
  $("art-fav").addEventListener("click", () => {
    const r = state.routes[state.index];
    if (r) opts.favourites.toggle(r);
  });
  async function show(i) {
    state.index = i;
    for (const b of document.querySelectorAll(".art-option")) b.classList.toggle("active", +b.dataset.option === i);
    await ready;
    const r = state.routes[i];
    const target = camera(r);
    placeStart(r);
    syncHeart();
    drawIn(r, target ? half(target.zoom) : half(map.getZoom()));
    if (target) map.easeTo({ ...target, duration: 700 });
  }
  $("art-options").addEventListener("click", (e) => {
    const b = e.target.closest("[data-option]");
    if (b) show(+b.dataset.option);
  });
  $("art-new").addEventListener("click", () => {
    body.classList.remove("art-results");
    draw();
  });
  $("art-download").addEventListener("click", () => {
    const r = state.routes[state.index];
    if (!r) return;
    const pts = r.path.map(([lat, lon]) => `<trkpt lat="${lat}" lon="${lon}"></trkpt>`).join("");
    const name = `${state.shape?.name ?? "art"} ${km(r.distance)} km`;
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="runthe"><trk><name>${name}</name><trkseg>${pts}</trkseg></trk></gpx>`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([gpx], { type: "application/gpx+xml" }));
    a.download = `${name.replaceAll(" ", "-")}.gpx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  // ----- switching modes -----
  // The loop mode's route and start stay as they are but out of sight:
  // its layers are hidden here and its marker and panels by CSS
  // ([data-mode="art"]).
  const others = (visible) => ready.then(() => {
    for (const l of map.getStyle().layers) {
      if (l.source === "route") map.setLayoutProperty(l.id, "visibility", visible ? "visible" : "none");
    }
  });
  function enter() {
    others(false);
    draw();
  }
  function leave() {
    others(true);
    stopDrawing();
    start?.remove();
    ready.then(() => map.getSource("art").setData(EMPTY));
  }

  return { enter, leave };
}
