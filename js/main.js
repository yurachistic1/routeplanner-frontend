// Puts the page together: the map and its shared controls, the modes and
// the shelf that switches them, and accounts.

import { createAccount } from "./account.js";
import { createLoopMode } from "./loop.js";
import { createMap, addCredits, addLocate, addSatellite } from "./map.js";
import { buildStyle, ATTRIBUTION } from "./mapstyle.js";
import { registerMode, createModeBar, setMode, currentMode } from "./modes.js";

// "Dusk": a lighter dark map, so roads and parks are easy to read. Paths are
// dashed, and turn sand-coloured close up so they stand out under the route
// (chosen 2026-11-11).
const style = buildStyle({
  land: "#151a22", park: "#173b2f", wood: "#153529", water: "#10304f", building: "#1c222c",
  motorway: "#4a5878", major: "#3b4761", minor: "#283040", service: "#222937", path: "#2e4743", pathNear: "#d9b77a", rail: "#2c3342",
  label: "#8a96aa", labelHalo: "#151a22", roadLabel: "#c9d2df", waterLabel: "#5d86b0", parkLabel: "#5c947f",
  cityLabel: "#e3e8f0", townLabel: "#b4bfcf",
}, { labels: "normal", pathDash: [2, 1.5] });

// Route: lime line on a soft lime-tinted band. Both are solid at normal
// zooms, so overlapping bits can't stack into bright blobs.
const W = (lo, hi) => ["interpolate", ["linear"], ["zoom"], 11, lo, 16, hi];
const layout = { "line-cap": "round", "line-join": "round" };
// Zoomed right in, the line turns see-through and the glow goes, so the
// path or street underneath shows (2026-11-11). Opacity by zoom:
const FADE = ["interpolate", ["linear"], ["zoom"], 15, 1, 16.3, 0.35];
const GLOW = ["interpolate", ["linear"], ["zoom"], 15, 1, 16, 0];

const desktop = matchMedia("(min-width: 900px)");

// On phones, Regent's Park sits in the gap between the header and the controls.
const PHONE_VIEW = { center: [-0.15469, 51.52846], zoom: 13.4 };
// The installed app shows its icon on a splash screen while opening. This view
// puts the park exactly over the route in the icon, so one turns into the other.
// Measured on a Pixel 9a; the splash icon is a fixed size in CSS pixels.
const ICON_VIEW = { center: [-0.15454, 51.52975], zoom: 12.41 };
const installed = matchMedia("(display-mode: standalone)").matches;
const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ----- the map, shared by every mode -----
const { map, ready } = createMap({
  style,
  ...(desktop.matches ? {} : { view: PHONE_VIEW, openFrom: installed && !calm ? ICON_VIEW : null }),
});
const credits = addCredits(ATTRIBUTION);
addLocate(map);
addSatellite(map, ready, credits, ATTRIBUTION);

// ----- loop mode -----
const account = createAccount({ openFavourites: () => setMode("favourites") });
const app = createLoopMode(map, ready, {
  animate: true,
  // Closed from the top bar's back arrow, by signing out or by removing the
  // last one: the shelf goes back to Loop.
  onExitFavourites: () => { if (currentMode() === "favourites") setMode("loop"); },
  onShow: (_, route) => account.routeShown(route),
  onRouteAction: (route) => account.toggleFavourite(route),
  formatIndex: (i) => String(i + 1).padStart(2, "0"),
  padding: () => {
    const top = document.querySelector(".hud-top").getBoundingClientRect();
    const deck = document.querySelector(".deck").getBoundingClientRect();
    if (desktop.matches) return { top: 60, bottom: 60, left: deck.right + 40, right: 380 };
    return { top: top.bottom + 30, left: 30, right: 30, bottom: innerHeight - deck.top + 30 };
  },
  // Uncertain (countryside) paths, which route info warns about, are dashed (see
  // shapeRoute in loop.js).
  // The route draws under the map's labels, so street names stay readable.
  addRouteLayers(map) {
    const part = (p) => ["==", ["get", "part"], p];
    const below = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
    const add = (layer) => map.addLayer(layer, below);
    add({ id: "route-halo", type: "line", source: "route", layout, filter: part("all"),
      paint: { "line-color": "#4f6328", "line-width": W(6, 13), "line-blur": W(1.5, 4), "line-opacity": GLOW } });
    add({ id: "route", type: "line", source: "route", layout, filter: part("plain"),
      paint: { "line-color": "#c8ff2e", "line-width": W(2.2, 4.5), "line-opacity": FADE } });
    // Dark under the dashes, so the gaps read as gaps rather than glow.
    add({ id: "route-country-gaps", type: "line", source: "route", layout, filter: part("country"),
      paint: { "line-color": "#151a22", "line-width": W(2.2, 4.5), "line-opacity": GLOW } });
    add({ id: "route-country", type: "line", source: "route", filter: part("country"),
      layout: { "line-cap": "butt", "line-join": "round" },
      paint: { "line-color": "#c8ff2e", "line-width": W(2.2, 4.5), "line-dasharray": [2.6, 1.8], "line-opacity": FADE } });
  },
});

account.attach(app);
registerMode("loop", app);

// ----- favourites mode -----
// Saved routes of every kind, so a mode of its own, the heart in the middle
// of the shelf, shown only when signed in. For now it borrows loop mode's
// route viewer; when A to B or GPS art arrive, that viewer should become
// shared, with favourites as its own module.
registerMode("favourites", {
  canEnter: () => account.hasFavourites(),
  enter: () => account.showFavourites(),
  leave: () => app.exitFavourites(),
});

// ----- the shelf of modes along the bottom -----
// Point to point, edit and GPS art are placeholders for now (see modes.js).
// The favourites heart sits in the middle.
createModeBar("loop");

document.getElementById("list-close").addEventListener("click", () => document.body.classList.remove("list-open"));
