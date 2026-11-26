// Puts the page together: the map and its shared controls, the modes and
// the shelf that switches them, and accounts.

import { createAccount } from "./account.js";
import { createArtMode } from "./art.js";
import { createExport } from "./export.js";
import { createLoopMode } from "./loop.js";
import { createMap, addCredits, addLocate, addSatellite, placeMapTools } from "./map.js";
import { ATTRIBUTION, buildStyle, FIRST_LABEL } from "./mapstyle.js";
import { registerMode, createModeBar, setMode, currentMode, focusMode } from "./modes.js";
import { createP2PMode } from "./p2p.js";
import { createShare } from "./share.js";

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
  style: buildStyle(),
  ...(desktop.matches ? {} : { view: PHONE_VIEW, openFrom: installed && !calm ? ICON_VIEW : null }),
});


// The map's credits, and the heights' (their full statements are on the
// privacy page).
const CREDITS = `${ATTRIBUTION} · Heights: <a href="./privacy/#data" target="_blank" rel="noopener">Copernicus, Environment Agency</a>`;
const credits = addCredits(CREDITS);
addLocate(map);
addSatellite(map, ready, credits, CREDITS);
placeMapTools();

// Room to leave round a route on screen, for every mode: clear of the top
// bar and the panel (on laptops, beside it), and of the route list on the
// right where list is set, while it's out (offsetWidth ignores its slide-in;
// out of sight, as when Focus centres a start, it leaves no gap). over: more
// things floating above the panel on phones, such as A to B's Undo and
// Clear, that the route should stay clear of too.
function routePadding({ list = false, over = null } = {}) {
  return () => {
    const top = document.querySelector(".hud-top").getBoundingClientRect();
    const deck = document.querySelector(".deck").getBoundingClientRect();
    if (desktop.matches) {
      const out = list && document.body.classList.contains("show-results");
      return { top: 60, bottom: 60, left: deck.right + 40, right: out ? document.querySelector(".list").offsetWidth + 40 : 60 };
    }
    const floor = floorOf(deck, over);
    // Clear of the round buttons standing above the panel on the left
    // (Satellite, My location, Focus), so a start there isn't hidden under
    // them (2026-11-26, the user); 16px leaves room for the start's dot.
    // Ones hidden for want of room on a short screen (js/map.js
    // placeMapTools) don't count. Ones hidden under the open route list
    // do: picking a route frames it before the list closes and they return.
    const NO_ROOM = { satellite: "no-sat-btn", locate: "no-locate-btn", focus: "no-focus-btn" };
    let left = 30;
    for (const b of document.querySelectorAll(".deck .locate-btn")) {
      if (!document.body.classList.contains(NO_ROOM[b.id])) left = Math.max(left, b.getBoundingClientRect().right + 16);
    }
    return { top: top.bottom + 30, left, right: 30, bottom: innerHeight - floor + 30 };
  };
}

// On phones, the top of the panel, or of whatever floats above it (over).
function floorOf(deck, over) {
  let floor = deck.top;
  for (const el of over ? document.querySelectorAll(over) : []) {
    const r = el.getBoundingClientRect();
    if (r.height) floor = Math.min(floor, r.top);
  }
  return floor;
}

// The part of the map that can be seen, in its own px: not under the top
// bar or the panel (on laptops, beside it), nor on phones under over, the
// things floating above the panel. A point being dragged stays in it, and
// the map moves along near its edges (js/pointdrag.js).
function mapRoom({ over = null } = {}) {
  return () => {
    const box = map.getContainer().getBoundingClientRect();
    const deck = document.querySelector(".deck").getBoundingClientRect();
    if (desktop.matches) return { left: deck.right - box.left, top: 0, right: box.width, bottom: box.height };
    const top = document.querySelector(".hud-top").getBoundingClientRect();
    return { left: 0, top: top.bottom - box.top, right: box.width, bottom: floorOf(deck, over) - box.top };
  };
}

// ----- loop mode -----
const account = createAccount({ openFavourites: () => setMode("favourites") });
const share = createShare({ account });
const exporter = createExport({ account, share });
const app = createLoopMode(map, ready, {
  animate: true,
  // Closed from the top bar's back arrow, by signing out or by removing the
  // last one: the shelf goes back to Loop.
  onExitFavourites: () => { if (currentMode() === "favourites") setMode("loop"); },
  onShow: (_, route) => account.routeShown(route),
  onRouteAction: (route) => account.toggleFavourite(route),
  // The hearts in the route list start filled for saved routes (in favourites, all).
  isFavourite: (route) => account.isFavourite(route),
  formatIndex: (i) => String(i + 1).padStart(2, "0"),
  exportRoute: (r) => exporter.open(r),
  padding: routePadding({ list: true }),
  // Uncertain (countryside) paths, which route info warns about, are dashed (see
  // shapeRoute in loop.js).
  // The route draws under the map's labels and icons, so they stay readable.
  addRouteLayers(map) {
    const part = (p) => ["==", ["get", "part"], p];
    const add = (layer) => map.addLayer(layer, FIRST_LABEL);
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
  // Tapping the heart again while in favourites opens or closes their list.
  reselect: () => app.toggleList(),
  canFocus: () => app.canFocus(),
  focus: () => app.focus(),
  keepsView: false,
  restores: "loop",
});

// Hearts in the other modes save to the same favourites.
const favourites = {
  toggle: (r) => account.toggleFavourite(r), has: (r) => account.isFavourite(r), onChange: (f) => account.onFavouritesChange(f),
  update: (r) => account.updateFavourite(r), // A to B's, which follow their route
};

// ----- GPS art mode -----
// The route in lime like a loop. Its heart saves to the same favourites.
registerMode("art", createArtMode(map, ready, {
  favourites,
  exportRoute: (r) => exporter.open(r),
  padding: routePadding(),
  addArtLayers(map) {
    const add = (layer) => map.addLayer(layer, FIRST_LABEL);
    add({ id: "art-halo", type: "line", source: "art", layout,
      paint: { "line-color": "#4f6328", "line-width": W(6, 13), "line-blur": W(1.5, 4), "line-opacity": GLOW } });
    add({ id: "art-route", type: "line", source: "art", layout,
      paint: { "line-color": "#c8ff2e", "line-width": W(2.2, 4.5), "line-opacity": FADE } });
  },
}));

// ----- A to B mode -----
// The route drawn like a loop's, from js/lanes.js: one line, moved sideways
// where a stretch is run more than once, so each pass is its own thinner
// line (zoomed in) or the passes bunch into one thick line (zoomed out).
// Features with more than one pass ("multi") carry their widths (w, and h
// for the halo) for the zoom they were drawn at; uncertain paths are
// dashed, as in loops.
registerMode("p2p", createP2PMode(map, ready, {
  favourites,
  exportRoute: (r) => exporter.open(r),
  padding: routePadding({ over: ".p2p-history" }),
  room: mapRoom({ over: ".p2p-history" }),
  addP2PLayers(map) {
    const add = (layer) => map.addLayer(layer, FIRST_LABEL);
    // multi: the feature's own width at every zoom (it's redrawn when a zoom ends)
    const width = (k, lo, hi) => ["interpolate", ["linear"], ["zoom"],
      11, ["case", ["get", "multi"], ["get", k], lo], 16, ["case", ["get", "multi"], ["get", k], hi]];
    const kind = (k) => ["==", ["get", "kind"], k];
    // Zoomed right in, counted-out lanes stay nearly solid: they're thin, so
    // the street shows between them, and faded they'd be hard to count.
    // dim: the legs that aren't the last one, while Last leg lights it up
    // (2026-11-22), at about a third of their usual strength.
    const dimmed = (on, off) => ["case", ["get", "dim"], off, on];
    const fade = ["interpolate", ["linear"], ["zoom"], 15, dimmed(1, 0.35),
      16.3, ["case", ["get", "lanes"], dimmed(0.85, 0.3), dimmed(0.35, 0.15)]];
    const glow = ["interpolate", ["linear"], ["zoom"], 15, dimmed(1, 0.25), 16, 0];
    add({ id: "p2p-halo", type: "line", source: "p2p", layout,
      paint: { "line-color": "#4f6328", "line-width": width("h", 6, 13), "line-blur": W(1.5, 4), "line-opacity": glow } });
    add({ id: "p2p-route", type: "line", source: "p2p", layout, filter: kind("plain"),
      paint: { "line-color": "#c8ff2e", "line-width": width("w", 2.2, 4.5), "line-opacity": fade } });
    add({ id: "p2p-country-gaps", type: "line", source: "p2p", layout, filter: kind("country"),
      paint: { "line-color": "#151a22", "line-width": width("w", 2.2, 4.5), "line-opacity": glow } });
    add({ id: "p2p-country", type: "line", source: "p2p", filter: kind("country"),
      layout: { "line-cap": "butt", "line-join": "round" },
      paint: { "line-color": "#c8ff2e", "line-width": width("w", 2.2, 4.5), "line-dasharray": [2.6, 1.8], "line-opacity": fade } });
    // While the last point is dragged, a faint dashed straight line from the
    // point before stands in for its leg; amber past the 20 km a leg can be
    // (2026-11-26, the user).
    add({ id: "p2p-drag", type: "line", source: "p2p-drag", layout: { "line-cap": "butt" },
      paint: { "line-color": ["case", ["get", "over"], "#ffb547", "#c8ff2e"], "line-width": 2.5,
        "line-dasharray": [2, 2], "line-opacity": ["case", ["get", "over"], 0.95, 0.6] } });
  },
}));

// ----- the shelf of modes along the bottom -----
// Edit is a placeholder for now (see modes.js).
// The favourites heart sits in the middle.
createModeBar("loop", map);
// Focus, over the map: frames the current mode's route (js/modes.js)
document.getElementById("focus").addEventListener("click", focusMode);

// A shared link (https://r.rnthe.com/<id>) comes here as #s=<id>: its route
// opens in loop mode's route viewer (js/share.js).
const sharedId = share.linkInAddress();
if (sharedId) share.openShared(sharedId, app);

document.getElementById("list-close").addEventListener("click", () => document.body.classList.remove("list-open"));
