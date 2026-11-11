// The map and the controls on it that every mode shares: the credits (ⓘ),
// centring on your location and satellite view. Modes draw on the map with
// their own sources and layers; see js/modes.js.

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
    // tell apart and much lighter, so panning stays smooth.
    pixelRatio: Math.min(devicePixelRatio, 2),
  });
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
        map.flyTo({ center: ll, zoom: Math.max(map.getZoom(), 14.5) });
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
  // Over the imagery go the base map's labels and paths and every layer the
  // modes add; the rest of the drawn base map is hidden.
  const hideOnSatellite = (l) => l.source === "omt" && l.type !== "symbol" && l.id !== "path";
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
