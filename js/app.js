// The app: map, start marker, requesting routes, smoothing, the route
// list, prev/next and GPX download.
//
// The page supplies the map style and route layers (js/main.js), and
// these element ids (all optional except #map):
//   #distance (number input), .chip[data-km], #dec, #inc, #generate, #locate,
//   #route-list, #list-toggle, #prev, #next, #download, #edit, #back,
//   #route-title, #route-distance, #route-count, #toast
// and these body classes, which the CSS reacts to:
//   has-start, loading, has-results, show-results, list-open

// Served from this machine or another device on the home network (e.g. a
// phone opening http://192.168.x.x:5173): use the backend on the same host.
const host = location.hostname;
const isLocal = ["localhost", "127.0.0.1"].includes(host)
  || /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) // private network IPs
  || host.endsWith(".local");
const API_BASE = isLocal
  ? `http://${host}:8080`
  : "https://routes-1068090158958.europe-west2.run.app";
const API_URL = `${API_BASE}/routes`;

// Wake the server while the user chooses their route. If this fails, the
// route request will show the error.
fetch(`${API_BASE}/warm`).catch(() => {});

const REGENTS_PARK = [-0.157, 51.5313]; // [lon, lat]
const EMPTY = { type: "FeatureCollection", features: [] };
const $ = (id) => document.getElementById(id);
const body = document.body;

class UserError extends Error {}

// ---------- geometry ----------

// Metres per degree near London, good enough for simplifying.
const M_LAT = 111320;
const mLon = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);

// Douglas-Peucker on [lon, lat] points with a tolerance in metres.
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const kx = mLon(pts[0][1]);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
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
  return pts.filter((_, i) => keep[i]);
}

// Rounds each corner with an arc of (at most) radius metres, Strava style:
// the line stays on the roads and only the sharp corners are softened.
// A corner's arc can't use more than half of either neighbouring segment,
// so short wiggles get small arcs instead of being swallowed.
export function roundCorners(pts, radius) {
  if (pts.length < 3 || radius <= 0) return pts;
  const kx = mLon(pts[0][1]);
  const P = pts.map(([lon, lat]) => [lon * kx, lat * M_LAT]);
  const out = [pts[0]];
  for (let i = 1; i < P.length - 1; i++) {
    const [ax, ay] = P[i - 1], [bx, by] = P[i], [cx, cy] = P[i + 1];
    const ux = ax - bx, uy = ay - by, vx = cx - bx, vy = cy - by;
    const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
    if (lu < 1e-6 || lv < 1e-6) continue;
    // Angle between the two segments at this corner: π means straight on.
    const cos = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (lu * lv)));
    const angle = Math.acos(cos);
    if (angle > Math.PI * 0.97) { out.push(pts[i]); continue; } // nearly straight
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
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

const metresPerPixel = (zoom, lat) => (40075016.7 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);


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

// ---------- app ----------

/**
 * opts:
 *   style: MapLibre style object
 *   addRouteLayers(map): add layers on the "route" source
 *   markerHTML: inner HTML for the start marker
 *   padding(): {top, bottom, left, right} to keep routes clear of the UI
 *   animate: draw the route progressively
 *   formatIndex(i): label for list numbers
 */
export function createApp(opts) {
  const o = { padding: () => 60, formatIndex: (i) => String(i + 1), ...opts };

  const map = new maplibregl.Map({
    container: "map",
    style: o.style,
    center: REGENTS_PARK,
    zoom: 13.4,
    dragRotate: false,
    pitchWithRotate: false,
    attributionControl: false, // replaced by our own ⓘ control below
    // Phone screens are often 3x density; drawing the map at 2x is hard to
    // tell apart and much lighter, so panning stays smooth.
    pixelRatio: Math.min(devicePixelRatio, 2),
  });
  map.touchZoomRotate.disableRotation();

  // ----- map credits (ⓘ) -----
  // Our own control rather than MapLibre's, which collapses the moment you
  // drag the map and can't animate. OpenStreetMap's attribution guidelines
  // want the credits visible without interaction; collapsing after 5 seconds
  // is allowed. Tapping the ⓘ opens and closes them again.
  if (o.credits) {
    const box = document.createElement("div");
    box.className = "credits open";
    box.innerHTML = `<div class="credits-text">${o.credits}</div>
      <button class="credits-btn" aria-label="Map credits" aria-expanded="true">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <circle cx="12" cy="12" r="11" fill="currentColor"/>
          <circle cx="12" cy="7" r="1.6" class="credits-i"/>
          <rect x="10.7" y="10" width="2.6" height="8.5" rx="1.3" class="credits-i"/>
        </svg>
      </button>`;
    document.body.append(box);
    const btn = box.querySelector(".credits-btn");
    const setOpen = (on) => { box.classList.toggle("open", on); btn.setAttribute("aria-expanded", on); };
    const auto = setTimeout(() => setOpen(false), 5000);
    btn.addEventListener("click", () => { clearTimeout(auto); setOpen(!box.classList.contains("open")); });
  }

  const state = { start: null, routes: [], index: 0, target: 0 };
  let marker = null;
  let anim = 0;

  const ready = new Promise((resolve) => map.on("load", resolve)).then(() => {
    map.addSource("route", { type: "geojson", data: EMPTY, lineMetrics: true });
    o.addRouteLayers?.(map);
  });

  // ----- messages -----
  let toastTimer;
  function toast(msg, ms = 3800) {
    const el = $("toast");
    if (!el) return console.log(msg);
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), ms);
  }

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
  // While routes are on screen the start stays put, so it always matches
  // them; "New run" frees it again.
  const viewingRoutes = () => body.classList.contains("show-results");
  map.on("click", (e) => { if (!viewingRoutes()) setStart(e.lngLat); });

  $("locate")?.addEventListener("click", () => {
    if (!navigator.geolocation) return toast("Location isn't available in this browser");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const ll = [pos.coords.longitude, pos.coords.latitude];
        setStart(ll);
        map.flyTo({ center: ll, zoom: 14.5 });
      },
      () => toast("Couldn't get your location — tap the map instead"),
      { enableHighAccuracy: true, timeout: 8000 },
    );
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
      res = await fetch(`${API_URL}?lat=${lat}&lon=${lon}&distance=${km}`);
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
      state.target = km;
      state.routeStart = state.start;
      state.index = 0;
      state.routes = routes.map((r, i) => {
        const raw = r.path.map(([lat, lon]) => [lon, lat]);
        return { i, distance: r.distance, raw };
      });
      renderList();
      body.classList.add("has-results", "show-results");
      marker?.setDraggable(false);
      await ready;
      show(0);
    } catch (err) {
      toast(err instanceof UserError ? err.message : "Couldn't get routes. Check your connection.");
      console.error(err);
    } finally {
      body.classList.remove("loading");
      $("generate")?.removeAttribute("disabled");
    }
  }
  $("generate")?.addEventListener("click", generate);
  // ----- modes: planning a new run vs viewing routes -----
  // New run: clear the route and list, leaving just the map and the start pin.
  function newRun() {
    cancelAnimationFrame(anim);
    drawing = false;
    shownKey = null;
    setLine("route", null);
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
  $("edit")?.addEventListener("click", newRun);
  $("back")?.addEventListener("click", backToRoutes);

  // ----- list -----
  const km = (m) => (m / 1000).toFixed(2);
  function renderList() {
    const ul = $("route-list");
    if (!ul) return;
    ul.innerHTML = state.routes.map((r) => {
      const delta = r.distance / 1000 - state.target;
      const sign = delta >= 0 ? "+" : "−";
      return `<li><button class="route-item" data-i="${r.i}">
        ${thumbnail(r.raw)}
        <span class="ri-num">${o.formatIndex(r.i)}</span>
        <span class="ri-dist">${km(r.distance)}<small> km</small></span>
        <span class="ri-delta">${sign}${Math.abs(delta).toFixed(2)}</span>
      </button></li>`;
    }).join("");
    for (const b of ul.querySelectorAll(".route-item")) {
      b.addEventListener("click", () => {
        show(+b.dataset.i);
        if (matchMedia("(max-width: 899px)").matches) body.classList.remove("list-open");
      });
    }
    if ($("route-count")) $("route-count").textContent = state.routes.length;
  }

  $("list-toggle")?.addEventListener("click", () => body.classList.toggle("list-open"));

  // ----- showing a route -----
  function setLine(id, coords) {
    map.getSource(id)?.setData(coords
      ? { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } }
      : EMPTY);
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
  const CORNER_PX = 6;
  function coordsAt(r, key) {
    key = Math.max(key, fitKey(r));
    r.cache ??= new Map();
    if (!r.cache.has(key)) {
      const mpp = metresPerPixel(key, r.raw[0][1]);
      r.cache.set(key, roundCorners(simplify(r.raw, mpp), CORNER_PX * mpp));
    }
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
    setLine("route", coordsAt(r, key));
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

    const target = map.cameraForBounds(bounds(r.raw), { padding: o.padding(), maxZoom: 16 });
    const key = target ? Math.round(target.zoom * 2) / 2 : zoomKey();

    cancelAnimationFrame(anim);
    if (o.animate) drawProgressively(r, key);
    else { setLine("route", coordsAt(r, key)); shownKey = key; }

    if (target) map.easeTo({ ...target, duration: 700 });

    if ($("route-title")) $("route-title").textContent = o.formatIndex(state.index);
    if ($("route-distance")) $("route-distance").textContent = km(r.distance);
    for (const b of document.querySelectorAll(".route-item")) {
      const on = +b.dataset.i === state.index;
      b.classList.toggle("selected", on);
      b.setAttribute("aria-current", on);
      if (on) scrollListTo(b);
    }
    o.onShow?.(state.index, r);
  }

  // Draws the route in from the start, using the smoothing for the zoom
  // the camera is heading to.
  function drawProgressively(r, key) {
    const coords = coordsAt(r, key);
    const t0 = performance.now(), dur = 1400;
    drawing = true;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      setLine("route", coords.slice(0, Math.max(2, Math.ceil(e * coords.length))));
      if (k < 1) { anim = requestAnimationFrame(step); return; }
      drawing = false;
      shownKey = zoomKey();
      setLine("route", coordsAt(r, shownKey));
    };
    anim = requestAnimationFrame(step);
  }

  $("prev")?.addEventListener("click", () => show(state.index - 1));
  $("next")?.addEventListener("click", () => show(state.index + 1));
  addEventListener("keydown", (e) => {
    if (!state.routes.length) return;
    if (e.key === "Escape") {
      if (body.classList.contains("list-open")) body.classList.remove("list-open");
      else if (!viewingRoutes()) backToRoutes();
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

  return { map, state, show, toast, setStart };
}
