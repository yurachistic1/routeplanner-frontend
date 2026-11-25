// The map and the controls on it that every mode shares: the credits (ⓘ),
// centring on your location, satellite view and Focus's move (frameOnMap). Modes draw on the map with
// their own sources and layers; see js/modes.js.

import { addIcons } from "./mapicons.js";
import { staysOnSatellite } from "./mapstyle.js";
import { $, toast } from "./ui.js";

const REGENTS_PARK = [-0.157, 51.5313]; // [lon, lat]

/**
 * createMap(opts) returns { map, ready }, where ready resolves once the style
 * has loaded and layers can be added.
 *   style: MapLibre style object
 *   view: { center, zoom } to show
 *   openFrom: a view to hold for a moment first, then glide to view
 */
export function createMap({ style, view = { center: REGENTS_PARK, zoom: 13.4 }, openFrom = null }) {
  const map = new maplibregl.Map({
    container: "map",
    style,
    ...(openFrom ?? view),
    dragRotate: false,
    pitchWithRotate: false,
    attributionControl: false, // replaced by our own ⓘ control (addCredits)
    // Phone screens are often 3x density; drawing the map at 2x is hard to
    // tell apart and much lighter, so panning stays smooth. Laptops and
    // desktops draw at 2x too, whatever their screen: scaled down by the
    // browser, lines, text and icons are smoother (the user, 2026-11-25).
    pixelRatio: matchMedia("(pointer: fine)").matches ? 2 : Math.min(devicePixelRatio, 2),
  });
  addIcons(map);
  map.touchZoomRotate.disableRotation();

  // Hold the opening view for a moment, then glide to the normal one, unless
  // the user has already started moving the map.
  if (openFrom) {
    map.once("load", () => setTimeout(() => {
      if (!map.isMoving()) map.easeTo({ ...view, duration: 1200 });
    }, 350));
  }

  const ready = new Promise((resolve) => map.once("load", resolve));
  return { map, ready };
}

// ----- map credits (ⓘ) -----
// Our own control rather than MapLibre's, which collapses the moment you
// drag the map and can't animate. OpenStreetMap's attribution guidelines
// want the credits visible without interaction; collapsing after 5 seconds
// is allowed. Tapping the ⓘ opens and closes them again. Sits under the top
// bar. Returns { set(html) } to change the credits, e.g. for satellite view.
export function addCredits(html) {
  const box = document.createElement("div");
  box.className = "credits open";
  box.innerHTML = `<div class="credits-text"></div>
    <button class="credits-btn" aria-label="Map credits" aria-expanded="true">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <circle cx="12" cy="12" r="11" fill="currentColor"/>
        <circle cx="12" cy="7" r="1.6" class="credits-i"/>
        <rect x="10.7" y="10" width="2.6" height="8.5" rx="1.3" class="credits-i"/>
      </svg>
    </button>`;
  (document.querySelector(".hud-top") ?? document.body).append(box);
  const text = box.querySelector(".credits-text");
  const btn = box.querySelector(".credits-btn");
  const setOpen = (on) => { box.classList.toggle("open", on); btn.setAttribute("aria-expanded", on); };
  const auto = setTimeout(() => setOpen(false), 5000);
  btn.addEventListener("click", () => { clearTimeout(auto); setOpen(!box.classList.contains("open")); });
  const set = (h) => { text.innerHTML = h; };
  set(html);
  return { set };
}

// Shows or hides every layer that draws from source: a mode hides another
// mode's route while it's on screen, and shows it again when it leaves.
// The finish of a route that ends away from its start (favourites, GPS
// art): A to B's chequered disc (UI.md "Waypoints"), taking no taps. cls
// says whose it is, for the CSS that hides it outside its mode.
export function finishMarker(cls) {
  const el = document.createElement("div");
  el.className = `wp wp-fin ${cls}`;
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", "Finish");
  return new maplibregl.Marker({ element: el });
}

export function setSourceVisible(map, source, visible) {
  for (const l of map.getStyle().layers) {
    if (l.source === source) map.setLayoutProperty(l.id, "visibility", visible ? "visible" : "none");
  }
}

// ----- where the map's own buttons sit -----
// Phones: the credits (ⓘ) under the top bar, and Satellite, My location
// and Focus just above the bottom panel, moving with it. Laptops: all four
// together at the top right of the map (2026-11-16): the panel can be tall
// there (GPS art with everything open), which pushed the buttons up over the
// top bar. They move between the two when the window is resized.
export function placeMapTools() {
  const deck = document.querySelector(".deck"), hud = document.querySelector(".hud-top");
  const credits = document.querySelector(".credits"), sat = $("satellite"), locate = $("locate"), focus = $("focus");
  if (!deck || !credits || !sat || !locate || !focus) return;
  const tools = document.createElement("div");
  tools.className = "map-tools";
  deck.parentElement.append(tools);
  const wide = matchMedia("(min-width: 900px)");
  const place = () => {
    if (wide.matches) tools.append(credits, sat, locate, focus);
    else { hud.append(credits); deck.prepend(sat, locate, focus); }
    fit();
  };
  // On phones the three buttons stand above the panel, so a tall panel on
  // a short screen (route info open with warnings) pushes them up into the
  // top bar. Then there's hardly any map to use them on anyway, so they
  // hide (2026-11-18, the user): Satellite first, then My location, Focus
  // only if even it doesn't fit. They come back as the panel shrinks.
  const GAP = 8; // px clear of the top bar and the credits
  const fit = () => {
    let noSat = false, noLocate = false, noFocus = false;
    if (!wide.matches) {
      // hidden, they keep their place (visibility), so where they'd be is
      // where they are
      const btn = credits.querySelector(".credits-btn") ?? credits;
      const ceiling = Math.max(hud.getBoundingClientRect().bottom, btn.getBoundingClientRect().bottom) + GAP;
      noSat = sat.getBoundingClientRect().top < ceiling;
      noLocate = locate.getBoundingClientRect().top < ceiling;
      noFocus = focus.getBoundingClientRect().top < ceiling;
    }
    document.body.classList.toggle("no-sat-btn", noSat);
    document.body.classList.toggle("no-locate-btn", noLocate);
    document.body.classList.toggle("no-focus-btn", noFocus);
  };
  place();
  wide.addEventListener("change", place);
  addEventListener("resize", fit);
  if ("ResizeObserver" in window) new ResizeObserver(fit).observe(deck);
}

// ----- Focus -----
// The #focus button frames what the current mode has on the map (each
// mode's focus(), js/modes.js), with this: pts ([lon, lat]) framed clear
// of the panel and the bars (padding, as for showing a route) and no
// closer than maxZoom, as a route is when it's shown. A lone point (a
// start before there's a route) is centred in that room instead, at this
// zoom or 15 if further out.
export function frameOnMap(map, pts, padding, maxZoom = 16) {
  if (!pts.length) return;
  const b = pts.reduce((b, p) => b.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0]));
  const lone = b.getWest() === b.getEast() && b.getSouth() === b.getNorth();
  const camera = map.cameraForBounds(b, { padding, maxZoom: lone ? Math.max(map.getZoom(), 15) : maxZoom });
  if (camera) map.easeTo({ ...camera, duration: 700 });
}

// ----- my location -----
// The #locate button centres the map on where you are and shows a dot
// there; it doesn't move any start point. The browser asks for permission on
// the first tap. If it's been refused, the button hides, as tapping it could
// only fail.
export function addLocate(map) {
  const btn = $("locate");
  if (!btn) return;
  let dot = null;
  if (!navigator.geolocation) btn.hidden = true;
  navigator.permissions?.query({ name: "geolocation" }).then((p) => {
    const sync = () => { btn.hidden = p.state === "denied"; };
    sync();
    p.addEventListener("change", sync);
  }).catch(() => {});
  btn.addEventListener("click", () => {
    btn.classList.add("busy");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        btn.classList.remove("busy");
        const ll = [pos.coords.longitude, pos.coords.latitude];
        if (!dot) {
          const el = document.createElement("div");
          el.className = "me-dot";
          dot = new maplibregl.Marker({ element: el }).setLngLat(ll).addTo(map);
        } else {
          dot.setLngLat(ll);
        }
        // byUser: a move asked for, like dragging (GPS art's New search notes it)
        map.flyTo({ center: ll, zoom: Math.max(map.getZoom(), 14.5) }, { byUser: true });
      },
      (err) => {
        btn.classList.remove("busy");
        if (err.code === err.PERMISSION_DENIED) btn.hidden = true;
        toast(err.code === err.PERMISSION_DENIED ? "Location is turned off for Runthe" : "Couldn't find your location. Try again?");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  });
}

// ----- satellite view -----
// Esri World Imagery under the labels, paths and every mode's own layers,
// switched by the #satellite button. The key is public by nature (it ships
// in the page); in the ArcGIS dashboard it only works from runthe.uk,
// staging and localhost:5173, and it expires (made 2026-11-11, so by about
// 2027-11-11). Esri's terms want their credit on screen while it shows.
const ESRI_KEY = "AAPTaUsZsc9Rz6JuZ5lfD9SBB3w..XnS2M7_HVTC9AoY77ZDjpSA2ZSGJrS2Vhguuqaw5dwGlB3Tw-SL_EZL_m1ltwhk-siZOIaZ29_baFJ8lITHKe_jdOYwv4YksVevN4YTil4AJU_bWFAIhZZ2hwbf2j2HCRTcmGHfykTqEmlMAw2oV-OpNSCova238msDTXe4Do5pND-FyY-SLHuyhyqjDeI9q06HKjLVhr1Is4U3Y2boffAyOA_zDQ__63yMTjzTrOSNVt6EvIKkEAT1_OlxJLUD8";
const ESRI_CREDIT = 'Powered by <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a> · Esri, Maxar, Earthstar Geographics';
const SAT_KEY = "runthe.satellite";

// map, ready: from createMap. credits: from addCredits, with its plain html.
export function addSatellite(map, ready, credits, creditsHTML) {
  const btn = $("satellite");
  if (!btn) return;
  const saved = () => { try { return localStorage.getItem(SAT_KEY) === "1"; } catch { return false; } };
  // Over the imagery go the base map's labels, icons and paths and every
  // layer the modes add; the rest of the drawn base map is hidden.
  const hideOnSatellite = (l) => l.source === "omt" && !staysOnSatellite(l);
  function set(on) {
    for (const l of map.getStyle().layers) {
      if (hideOnSatellite(l)) map.setLayoutProperty(l.id, "visibility", on ? "none" : "visible");
    }
    map.setLayoutProperty("satellite", "visibility", on ? "visible" : "none");
    btn.setAttribute("aria-pressed", on);
    credits.set(on ? `${ESRI_CREDIT} · ${creditsHTML}` : creditsHTML);
    try { localStorage.setItem(SAT_KEY, on ? "1" : "0"); } catch {}
  }
  ready.then(() => {
    const first = map.getStyle().layers.find((l) => l.type !== "background")?.id;
    map.addSource("satellite", {
      type: "raster", tileSize: 256, maxzoom: 19,
      tiles: [`https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=${ESRI_KEY}`],
    });
    map.addLayer({ id: "satellite", type: "raster", source: "satellite", layout: { visibility: "none" } }, first);
    if (saved()) set(true);
  });
  btn.addEventListener("click", () => set(btn.getAttribute("aria-pressed") !== "true"));
}
