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
// Where to look (2026-11-16, frontend only so far): once a shape is
// chosen, Default (15 km round the middle of the map), Custom (a route
// distance, 5-25 km, and how near the middle of the map it starts, 1-15
// km, set in a sheet) or Free placement (the shape put on the map by hand,
// moved and resized with two handles). The choice goes to the server as
// "where", which it ignores until the backend learns them.
//
// Like every mode it keeps to its own map source and layers ("art"), and
// remembers where it was when you come back from the shelf.

import { API_BASE } from "./api.js";
import { smoothLine, metresPerPixel } from "./geometry.js";
import { setSourceVisible } from "./map.js";
import { goBack } from "./modes.js";
import { createSmoother, attachGrip } from "./panel.js";
import { createIconPicker, createDrawPad, isTextIcon } from "./shapes.js";
import { $, toast } from "./ui.js";

const EMPTY = { type: "FeatureCollection", features: [] };
const body = document.body;
const NAMES = ["Short", "Medium", "Long"];
const km = (m) => (m / 1000).toFixed(1);
const half = (z) => Math.round(z * 2) / 2;
const boundsOf = (pts) => pts.reduce((b, p) => b.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0]));

// A shape's strokes as a small drawing.
// The chosen shape on its tile: as wide as the shape (up to the tile's
// limit), with lines a steady width in screen pixels, thinner for text
// icons (outlines of letters).
function thumbnail(shape, text = false) {
  const pts = shape.strokes.flat();
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  const w = Math.max(...xs) - x0, h = Math.max(...ys) - y0;
  const pad = Math.max(w, h) * 0.08;
  const width = Math.min(116, Math.max(44, Math.round(44 * (w + 2 * pad) / (h + 2 * pad))));
  const lines = shape.strokes.map((s) => `<polyline points="${s.map((p) => p.join(",")).join(" ")}"/>`).join("");
  return {
    svg: `<svg class="px" viewBox="${x0 - pad} ${y0 - pad} ${w + 2 * pad} ${h + 2 * pad}" style="width:${width}px" fill="none" stroke="currentColor"
      stroke-width="${text ? 1.5 : 2}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${lines}</svg>`,
    wide: width > 60,
  };
}

/**
 * createArtMode(map, mapReady, opts) wires up the GPS art panel (.art in the
 * deck) and returns { enter, leave, canGoBack, goBack } for js/modes.js.
 *   padding(): room to leave round a route when fitting it on screen
 *   addArtLayers(map): adds the layers that draw source "art", the route
 *   favourites: { toggle(route), has(route), onChange(fn) } from accounts,
 *     where route is { raw: [[lon, lat], ...], distance }
 */
export function createArtMode(map, mapReady, opts) {
  const RADIUS_KM = 15;
  const state = { shape: null, routes: [], index: 0, where: "default", custom: { km: 12, radius: 3 }, place: null };
  let start = null; // the pink dot where the route on screen starts
  // Parts of the panel that appear or fold away grow and shrink in place
  // (js/panel.js), so Generate stays put at the bottom.
  const smooth = createSmoother();

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
    const pic = s && thumbnail(s.shape, s.icon && isTextIcon(s.name));
    $("art-shapes").innerHTML = TOOLS + (s
      ? `<div class="art-shape active${pic.wide ? " wide" : ""}" aria-label="${s.name}">${pic.svg}<span>${s.name}</span></div>` : "");
  }
  // icon: whether it's one of the app's icons, which the server caches
  // results for (it doesn't for drawings)
  function setShape(name, strokes, icon = false) {
    state.shape = { name, shape: { strokes }, icon };
    renderShapes();
    // the Where row appears with the first shape, growing into place
    if (!body.classList.contains("art-has-shape")) smooth([$("art-more")], true, () => body.classList.add("art-has-shape"));
    if (state.where === "free") drawPlace();
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
    // where the map was, for New search to go back to
    const from = { center: centre, zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
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
            where: whereRequest(),
          }),
        });
      } catch {
        return toast("Can't reach the server. Check your connection and try again.");
      }
      if (res.status === 422) return toast("No map data here yet. Only the UK for now.");
      if (!res.ok) return toast(`Something went wrong (${res.status}). Try again?`);
      const { routes } = await res.json();
      const custom = state.where === "custom";
      if (!routes.length) {
        return toast(custom ? "Couldn't draw that here. Try starting further away, or move the map."
          : "Couldn't draw that here. Move the map and try somewhere else.");
      }
      // raw is the path as [lon, lat], which the map and favourites use
      for (const r of routes) r.raw = r.path.map(([lat, lon]) => [lon, lat]);
      state.routes = routes;
      state.from = from;
      body.classList.remove("art-can-back", "art-folded");
      grip.setAttribute("aria-expanded", true);
      hidePlace();
      body.classList.add("art-results");
      // Default: Short, Medium, Long, opening on the longest, usually the
      // best drawing. Custom: the best fits at different places, best
      // first, or the nearest miss alone, saying how it misses. Custom's
      // distances are rounded down, so they all show as the km asked for.
      // Free placement: the one route, the shape exactly where it was put.
      const free = state.where === "free";
      const miss = custom && routes[0].miss;
      const tags = free ? ["Your shape"] : !custom ? NAMES.slice(NAMES.length - routes.length) : miss ? ["Nearest"] : ["Best", "2nd", "3rd"];
      const kmOf = (m) => (custom ? (Math.floor(m / 100) / 10).toFixed(1) : km(m));
      $("art-options").innerHTML = routes.map((r, i) =>
        `<button class="art-option" data-option="${i}">
          <span class="tag">${tags[i] ?? ""}</span>
          <span class="mono art-km">${kmOf(r.distance)}<small> km</small></span>
          <span class="art-fit${r.good && !miss ? " good" : ""}">${free ? "Exact" : miss ? "Outside settings" : r.good ? "Close fit" : "Rough fit"}</span>
        </button>`).join("");
      show(custom || free ? 0 : routes.length - 1);
      if (miss) {
        const r = routes[0], c = state.custom;
        toast(`Nothing fitted ${c.km} km starting within ${c.radius} km. This is the nearest: ${kmOf(r.distance)} km, starting ${(r.start_m / 1000).toFixed(1)} km away.`);
      }
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
    if (!r) return;
    r.shape ??= state.shape?.name; // saved with the favourite, so it's known later
    opts.favourites.toggle(r);
  });
  // Whether the map has been moved by hand (or to your location) since a
  // route was framed on it. Only in this mode, and not by the framing.
  let moved = false;
  map.on("movestart", (e) => {
    if (body.dataset.mode === "art" && viewing() && (e.originalEvent || e.byUser)) moved = true;
  });
  async function show(i) {
    state.index = i;
    moved = false;
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
  // New search goes back to where the map was for the last search (the
  // map moves to fit a found route), unless you've moved the map since the
  // route was framed: then you're looking where you want to search next,
  // and it stays (the user, 2026-11-16). Back (or Esc, or the phone's back
  // button, through js/modes.js) returns to the routes found, as they
  // were, framed again.
  $("art-new").addEventListener("click", () => {
    body.classList.remove("art-results");
    body.classList.add("art-can-back");
    draw();
    if (state.from && !moved) map.easeTo({ ...state.from, duration: 700 });
    if (state.where === "free") drawPlace();
  });
  const canGoBack = () => body.classList.contains("art-can-back") && state.routes.length > 0;
  function backToResults() {
    if (!state.routes.length) return;
    body.classList.remove("art-can-back");
    body.classList.add("art-results");
    hidePlace();
    show(state.index);
  }
  $("art-back").addEventListener("click", goBack);
  addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || body.dataset.mode !== "art" || !canGoBack()) return;
    if (document.querySelector("dialog[open]") || body.classList.contains("loading")) return;
    goBack();
  });
  $("art-download").addEventListener("click", () => {
    const r = state.routes[state.index];
    if (!r) return;
    const name = `${state.shape?.name ?? "art"} ${km(r.distance)} km`;
    opts.exportRoute?.({
      kind: "art",
      shape: state.shape?.name,
      distance: r.distance,
      points: r.path,
      gpxName: name,
      fileName: `${name.replaceAll(" ", "-")}.gpx`,
    });
  });

  // ----- where to look -----
  const NOTES = {
    default: "Looks for your shape within 15 km of the middle of the map. Move the map to look somewhere else.",
    custom: () => `<span class="art-sum">${state.custom.km} km route, starting within ${state.custom.radius} km</span>Only the start has to be that close to the middle of the map. Tap Custom to change it.`,
    free: "Drag the box to move your shape, a corner to resize it and the handle on top to turn it. On a phone, pinch it to resize. The route is your shape exactly there, as one line, for running in a field or park.",
  };
  function renderWhere() {
    for (const b of document.querySelectorAll("[data-where]")) {
      const on = b.dataset.where === state.where;
      b.classList.toggle("active", on);
      b.setAttribute("aria-checked", on);
    }
    // the note's new text eases to its new height rather than jumping
    const el = $("art-where-note"), note = NOTES[state.where], h0 = el.offsetHeight;
    el.innerHTML = typeof note === "function" ? note() : note;
    const h1 = el.offsetHeight;
    if (h0 && h1 && h0 !== h1 && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.animate([{ height: `${h0}px`, overflow: "hidden" }, { height: `${h1}px`, overflow: "hidden" }], { duration: 280, easing: "cubic-bezier(.2, .8, .2, 1)" });
    }
  }
  function setWhere(where) {
    state.where = where;
    renderWhere();
    if (where === "free") {
      drawPlace();
      // on phones, fold the panel so the shape on the map can be reached
      if (phone()) setFolded(true);
    } else {
      hidePlace();
    }
  }
  $("art-where").addEventListener("click", (e) => {
    const b = e.target.closest("[data-where]");
    if (!b) return;
    if (b.dataset.where === "custom") return openCustom();
    setWhere(b.dataset.where);
  });
  function whereRequest() {
    if (state.where === "custom") return { mode: "custom", distance_km: state.custom.km, start_within_km: state.custom.radius };
    if (state.where === "free" && state.place) {
      return { mode: "free", lat: state.place.center.lat, lon: state.place.center.lng, size_m: Math.round(state.place.size), angle_deg: Math.round(state.place.angle) };
    }
    return { mode: "default" };
  }

  // The Custom sheet: two sliders, applied with Use these. Closing it any
  // other way changes nothing.
  const sheet = $("custom-dialog"), kmIn = $("custom-km"), radiusIn = $("custom-radius");
  for (const b of sheet.querySelectorAll("[data-close]")) b.addEventListener("click", () => sheet.close());
  sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.close(); });
  function syncSlider(input, out) {
    const k = (input.value - input.min) / (input.max - input.min);
    input.style.setProperty("--p", `${k * 100}%`);
    $(out).innerHTML = `${input.value} <span>km</span>`;
  }
  kmIn.addEventListener("input", () => syncSlider(kmIn, "custom-km-out"));
  radiusIn.addEventListener("input", () => syncSlider(radiusIn, "custom-radius-out"));
  function openCustom() {
    kmIn.value = state.custom.km;
    radiusIn.value = state.custom.radius;
    syncSlider(kmIn, "custom-km-out");
    syncSlider(radiusIn, "custom-radius-out");
    sheet.showModal();
  }
  $("custom-use").addEventListener("click", () => {
    state.custom = { km: +kmIn.value, radius: +radiusIn.value };
    sheet.close();
    setWhere("custom");
  });

  // ----- free placement -----
  // The shape on the map in a selection box, like a picture in a slide
  // deck (the user, 2026-11-16): drag the box to move it, a corner to
  // resize it (never stretched: width and height keep their ratio), the
  // round handle above it to turn it, and on touch screens pinch it with
  // two fingers to resize. place is { center (LngLat), size (metres across
  // the shape's longer side), angle (degrees, clockwise from north up) },
  // so it stays on the same streets as the map moves; the box is an
  // element over the map, redrawn whenever the map moves.
  const M_LAT = 111320;
  const mLon = (lat) => M_LAT * Math.cos((lat * Math.PI) / 180);
  const MIN_M = 200, MAX_M = 15000;
  const pxPerM = () => 1 / metresPerPixel(map.getZoom(), state.place.center.lat);
  const clampSize = (m) => Math.max(MIN_M, Math.min(MAX_M, m));
  // The shape's strokes with their longer side 1 and their middle at 0, 0.
  function unitShape() {
    const pts = state.shape.shape.strokes.flat();
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0, h = Math.max(...ys) - y0;
    const k = 1 / Math.max(w, h);
    return { w: w * k, h: h * k,
      strokes: state.shape.shape.strokes.map((s) => s.map(([x, y]) => [(x - x0 - w / 2) * k, (y - y0 - h / 2) * k])) };
  }

  const box = document.createElement("div");
  box.className = "place";
  box.tabIndex = 0;
  box.setAttribute("role", "group");
  box.setAttribute("aria-label", "Your shape on the map. Arrow keys move it, + and − resize it, [ and ] turn it.");
  box.innerHTML = `<svg class="place-shape" aria-hidden="true"></svg><div class="place-frame" aria-hidden="true"></div>
    ${["nw", "ne", "se", "sw"].map((c) => `<span class="place-corner" data-corner="${c}" aria-hidden="true"></span>`).join("")}
    <span class="place-stem" aria-hidden="true"></span><span class="place-turn" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/></svg></span>`;
  box.hidden = true;
  map.getContainer().append(box);
  let unit = null; // unitShape() for the shape in the box

  // Puts the box where place is on screen, at its size and angle.
  function layoutPlace() {
    if (box.hidden || !state.place) return;
    const p = map.project(state.place.center), s = state.place.size * pxPerM();
    box.style.width = `${unit.w * s}px`;
    box.style.height = `${unit.h * s}px`;
    box.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) rotate(${state.place.angle}deg)`;
  }
  map.on("move", layoutPlace);
  function drawShapeInBox() {
    unit = unitShape();
    const svg = box.querySelector(".place-shape");
    svg.setAttribute("viewBox", `${-unit.w / 2} ${-unit.h / 2} ${unit.w} ${unit.h}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.innerHTML = unit.strokes.map((st) => `<polyline points="${st.map((q) => q.join(",")).join(" ")}"/>`).join("");
  }
  async function drawPlace() {
    if (!state.shape || body.dataset.mode !== "art" || viewing()) return;
    await ready;
    if (!state.place) {
      // First time: in the middle of the map you can see (clear of the top
      // bar and the panel), about half as big as that space, upright.
      if (phone()) setFolded(true);
      const pad = opts.padding(), el = map.getContainer();
      const w = el.clientWidth - pad.left - pad.right, h = el.clientHeight - pad.top - pad.bottom;
      const mid = map.unproject([pad.left + w / 2, pad.top + h / 2]);
      const mpp = metresPerPixel(map.getZoom(), mid.lat);
      state.place = { center: mid, size: clampSize(0.5 * Math.min(w, h) * mpp), angle: 0 };
    }
    drawShapeInBox();
    box.hidden = false;
    layoutPlace();
  }
  function hidePlace() { box.hidden = true; }

  // ----- moving, resizing and turning it -----
  // One gesture at a time, from where it started: "move" (the box), "size"
  // (a corner), "turn" (the handle on top) or "pinch" (two fingers on it).
  const pointers = new Map(); // pointerId -> [x, y] on the map
  let gesture = null;
  const local = (e) => { const r = map.getContainer().getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const centrePx = () => { const p = map.project(state.place.center); return [p.x, p.y]; };
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  function startGesture() {
    const pts = [...pointers.values()];
    const base = { center: state.place.center, size: state.place.size, angle: state.place.angle, c: centrePx() };
    if (pts.length >= 2) return { kind: "pinch", ...base, d0: dist(pts[0], pts[1]) || 1, mid0: [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2] };
    return { ...base, p0: pts[0] };
  }
  box.addEventListener("pointerdown", (e) => {
    if (e.button > 0) return;
    e.preventDefault();
    e.stopPropagation();
    try { box.setPointerCapture(e.pointerId); } catch {} // keeps the gesture if the finger leaves the box
    pointers.set(e.pointerId, local(e));
    gesture = startGesture();
    if (gesture.kind !== "pinch") {
      const t = e.target.closest("[data-corner], .place-turn");
      gesture.kind = !t ? "move" : t.matches(".place-turn") ? "turn" : "size";
    }
    box.classList.add("busy");
  });
  box.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, local(e));
    const pts = [...pointers.values()], g = gesture, d = unit;
    if (g.kind === "pinch" && pts.length >= 2) {
      // resize by how far apart the fingers are, and follow their middle
      const mid = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
      state.place.size = clampSize(g.size * (dist(pts[0], pts[1]) / g.d0));
      state.place.center = map.unproject([g.c[0] + mid[0] - g.mid0[0], g.c[1] + mid[1] - g.mid0[1]]);
    } else if (g.kind === "move") {
      const p = pts[0];
      state.place.center = map.unproject([g.c[0] + p[0] - g.p0[0], g.c[1] + p[1] - g.p0[1]]);
    } else if (g.kind === "size") {
      // grows and shrinks round its middle, so the corner stays under the
      // finger along its diagonal (at any angle) and the shape keeps its ratio
      const half = dist(pts[0], g.c);
      state.place.size = clampSize((2 * half) / Math.hypot(d.w, d.h) / pxPerM());
    } else if (g.kind === "turn") {
      const p = pts[0];
      let a = (Math.atan2(p[1] - g.c[1], p[0] - g.c[0]) * 180) / Math.PI + 90;
      a = ((a % 360) + 360) % 360;
      // settle on upright, sideways and upside down when close
      for (const r of [0, 90, 180, 270, 360]) if (Math.abs(a - r) < 5) a = r % 360;
      state.place.angle = a;
    }
    layoutPlace();
  });
  function endPointer(e) {
    if (!pointers.delete(e.pointerId)) return;
    // lifting one finger of a pinch carries on as a move with the other
    gesture = pointers.size ? { ...startGesture(), kind: "move" } : null;
    if (!pointers.size) box.classList.remove("busy");
  }
  box.addEventListener("pointerup", endPointer);
  box.addEventListener("pointercancel", endPointer);
  // a wheel over the shape zooms the map as anywhere else
  box.addEventListener("wheel", (e) => {
    e.preventDefault();
    map.getCanvas().dispatchEvent(new WheelEvent("wheel", e));
  }, { passive: false });
  // keyboard: arrows move it, + and − resize, [ and ] turn
  box.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 40 : 10, c = centrePx();
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) state.place.center = map.unproject([c[0] + moves[e.key][0], c[1] + moves[e.key][1]]);
    else if (e.key === "+" || e.key === "=") state.place.size = clampSize(state.place.size * 1.1);
    else if (e.key === "-" || e.key === "−") state.place.size = clampSize(state.place.size / 1.1);
    else if (e.key === "]") state.place.angle = (state.place.angle + 15) % 360;
    else if (e.key === "[") state.place.angle = (state.place.angle + 345) % 360;
    else return;
    e.preventDefault();
    e.stopPropagation();
    layoutPlace();
  });

  // ----- folding the panel (phones) -----
  // The grip on the panel's top edge folds it down to the shape row, and
  // opens it again: tap it, or drag it down or up.
  const phone = () => matchMedia("(max-width: 899px)").matches;
  const grip = $("art-grip");
  function setFolded(on) {
    grip.setAttribute("aria-expanded", !on);
    grip.setAttribute("aria-label", on ? "Show search settings" : "Hide search settings");
    if (body.classList.contains("art-folded") === on) return;
    smooth([...document.querySelectorAll(".art-fold")], !on, () => body.classList.toggle("art-folded", on));
  }
  attachGrip(grip, { isFolded: () => body.classList.contains("art-folded"), setFolded });
  renderWhere();

  // ----- switching modes -----
  // The loop mode's route and start stay as they are but out of sight:
  // its layers are hidden here and its marker and panels by CSS
  // ([data-mode="art"]).
  const others = (visible) => ready.then(() => setSourceVisible(map, "route", visible));
  function enter() {
    others(false);
    draw();
    if (state.where === "free" && !viewing()) drawPlace();
  }
  function leave() {
    others(true);
    stopDrawing();
    start?.remove();
    hidePlace();
    ready.then(() => map.getSource("art").setData(EMPTY));
  }

  return { enter, leave, canGoBack, goBack: backToResults };
}
