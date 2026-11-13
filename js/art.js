// GPS art mode: pick a shape, tap the map where to look, and get routes
// that draw the shape on the streets. The server answers with up to three,
// shortest first: a longer route is usually a better drawing.
//
// A shape is an icon found by name or the user's own drawing
// (js/shapes.js). The request is the
// shape's strokes plus the place and how far to look; see ArtRequest in
// the backend's art.go.
//
// Like every mode it keeps to its own map source and layers ("art"), and
// remembers where it was when you come back from the shelf.

import { API_BASE } from "./api.js";
import { createIconPicker, createDrawPad } from "./shapes.js";
import { $, toast } from "./ui.js";

const EMPTY = { type: "FeatureCollection", features: [] };
const body = document.body;
const NAMES = ["Short", "Medium", "Long"];
const km = (m) => (m / 1000).toFixed(1);

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
  const state = { shape: null, radius: 15, centre: null, routes: [], index: 0 };
  let marker = null;
  let active = false;

  const ready = mapReady.then(() => {
    map.addSource("art", { type: "geojson", data: EMPTY });
    opts.addArtLayers(map);
  });

  // ----- shapes -----
  // The row holds the two ways of choosing a shape (find an icon, draw
  // one) and then the shape chosen.
  const TOOLS = `<button class="art-shape art-tool" data-tool="search">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg><span>Search</span></button>
    <button class="art-shape art-tool" data-tool="draw">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19.3 8.7a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16v4z"/><path d="m13.5 6.5 4 4"/></svg><span>Draw</span></button>`;
  function renderShapes() {
    const s = state.shape;
    $("art-shapes").innerHTML = TOOLS + (s
      ? `<div class="art-shape active" aria-label="${s.name}">${thumbnail(s.shape)}<span>${s.name}</span></div>` : "");
  }
  function setShape(name, strokes) {
    state.shape = { name, shape: { strokes } };
    renderShapes();
  }
  const openIcons = createIconPicker(setShape);
  const openDraw = createDrawPad((strokes) => setShape("My shape", strokes));
  $("art-shapes").addEventListener("click", (e) => {
    const tool = e.target.closest("[data-tool]");
    if (tool) (tool.dataset.tool === "search" ? openIcons : openDraw)();
  });
  renderShapes();

  // ----- how far to look -----
  for (const c of document.querySelectorAll(".chip[data-radius]")) {
    c.addEventListener("click", () => {
      state.radius = +c.dataset.radius;
      for (const o of document.querySelectorAll(".chip[data-radius]")) o.classList.toggle("active", o === c);
    });
  }

  // ----- where to look -----
  function setCentre(lngLat) {
    state.centre = maplibregl.LngLat.convert(lngLat);
    if (!marker) {
      const el = document.createElement("div");
      el.className = "start-marker art-marker";
      marker = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(state.centre).addTo(map);
      marker.on("dragend", () => { state.centre = marker.getLngLat(); });
    } else {
      marker.setLngLat(state.centre);
    }
    body.classList.add("art-has-centre");
  }
  map.on("click", (e) => {
    if (!active || body.classList.contains("art-results")) return;
    setCentre(e.lngLat);
  });

  // ----- search -----
  async function find() {
    if (!state.shape) return toast("Search for a shape or draw one first");
    const centre = state.centre ?? map.getCenter();
    if (!state.centre) setCentre(centre);
    body.classList.add("loading");
    $("art-find").setAttribute("disabled", "");
    try {
      let res;
      try {
        res = await fetch(`${API_BASE}/art`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat: centre.lat, lon: centre.lng, radius_km: state.radius, shape: state.shape.shape }),
        });
      } catch {
        return toast("Can't reach the server. Check your connection and try again.");
      }
      if (res.status === 422) return toast("No map data here yet. Only the UK for now.");
      if (!res.ok) return toast(`Something went wrong (${res.status}). Try again?`);
      const { routes } = await res.json();
      if (!routes.length) return toast("Couldn't draw that here. Try another place or a bigger area.");
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
  // While routes show, the pink marker sits where the one on screen
  // starts: its point nearest the place searched from. It goes back to
  // that place, and can be dragged again, for a new search.
  const viewing = () => body.classList.contains("art-results");
  async function draw() {
    await ready;
    const r = viewing() ? state.routes[state.index] : null;
    map.getSource("art").setData(r ? { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: r.raw } } : EMPTY);
    if (marker) {
      marker.setLngLat(r ? r.raw[0] : state.centre);
      marker.setDraggable(!r);
    }
    syncHeart();
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
  function show(i) {
    state.index = i;
    for (const b of document.querySelectorAll(".art-option")) b.classList.toggle("active", +b.dataset.option === i);
    draw();
    const bounds = new maplibregl.LngLatBounds();
    for (const p of state.routes[i].raw) bounds.extend(p);
    map.fitBounds(bounds, { padding: opts.padding(), duration: 700 });
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
    active = true;
    others(false);
    marker?.addTo(map);
    draw();
  }
  function leave() {
    active = false;
    others(true);
    marker?.remove();
    ready.then(() => map.getSource("art").setData(EMPTY));
  }

  return { enter, leave };
}
