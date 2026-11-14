// Modes: the ways of planning a run, switched from the shelf along the
// bottom of the screen (#modebar), like the tab bars in Strava or Garmin
// Connect. Only Loop works so far; the rest say they're coming.
//
// Favourites, the heart in the middle, is a mode too: it will hold saved
// routes of every kind (loops, A to B, GPS art), so it isn't part of any one
// mode. A mode marked signedIn only shows while signed in (body.signed-in).
//
// Each mode lives in its own module (Loop is js/loop.js) and is plugged in
// by js/main.js with registerMode(id, { canEnter, enter, leave, reselect }).
// Switching asks the new mode's canEnter() (it can refuse, e.g. no
// favourites yet), then calls the old mode's leave() and the new one's
// enter(), and sets <body data-mode>,
// so CSS can show each mode's own panel. A mode should keep to its own map
// sources and layers, and clear them in leave(); the shared map, credits,
// location and satellite controls live in js/map.js.
//
// Modes remember where they were: leaving one keeps its state (routes,
// start, which route, planning or viewing), so coming back from the shelf
// finds it exactly as it was. There are no back buttons; the shelf is the
// way between modes (the user, 2026-11-11).

import { $, toast } from "./ui.js";

// One look for every mode, current and future (the user, 2026-11-13): each
// icon is drawn in currentColor only, so all are grey on the shelf and white
// when current, on the same lime pill with a lime label (css/styles.css,
// .modebar). No mode gets its own colours. Icons are 24px line drawings;
// Loop is the app's mark, inlined so it can take currentColor too. Its dot
// stays pink, the one exception, because it's the logo (the user).
const icon = (paths) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const MODES = [
  { id: "loop", label: "Loop", icon: `<svg viewBox="0 0 512 512" width="26" height="26" aria-hidden="true"><defs><mask id="mode-loop-mask"><rect width="512" height="512" fill="#fff"/><circle cx="252" cy="406.8" r="81.8" fill="#000"/></mask></defs><path d="M135.8 292.9Q108.9 258.1 103.4 234.8Q97.9 211.5 119 173.9Q140 136.3 181.3 121.1L284.1 83.3Q325.4 68.2 349.8 84.8Q374.2 101.5 385.9 143.9L400.1 195.8Q411.7 238.2 412.5 282.2L413.3 321.2Q414.1 365.2 371.5 376.1L294.6 395.9Q252 406.8 228.4 394.4Q204.8 382 177.9 347.2Z" fill="none" stroke="currentColor" stroke-width="50" stroke-linejoin="round" mask="url(#mode-loop-mask)"/><circle class="logo-dot" cx="252" cy="406.8" r="62"/></svg>` },
  { id: "p2p", label: "A to B", icon: icon(
    '<circle cx="5.5" cy="18.5" r="2.5"/><path d="M8 17.3c3.2-1.4 2.8-5.6 6.4-7" stroke-dasharray="2 2.6"/>' +
    '<path d="M18 3a3.5 3.5 0 0 1 3.5 3.5c0 2.6-3.5 6.3-3.5 6.3s-3.5-3.7-3.5-6.3A3.5 3.5 0 0 1 18 3z"/><circle cx="18" cy="6.5" r="1" fill="currentColor" stroke="none"/>') },
  { id: "favourites", label: "Favourites", signedIn: true, icon: icon(
    '<path d="M12 20.5S3 15 3 8.8A4.8 4.8 0 0 1 12 6.5a4.8 4.8 0 0 1 9 2.3C21 15 12 20.5 12 20.5z" fill="currentColor"/>') },
  { id: "edit", label: "Edit", icon: icon(
    '<path d="M4 20h4L19.3 8.7a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16v4z"/><path d="m13.5 6.5 4 4"/>') },
  // The roadmap's GPS art (Phase 7). Never "Strava art": see ROADMAP.md.
  { id: "art", label: "GPS art", icon: icon(
    '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.9-.8 1.9-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z"/>' +
    '<circle cx="7.5" cy="11.5" r="1.1" fill="currentColor"/><circle cx="10" cy="7.3" r="1.1" fill="currentColor"/><circle cx="15" cy="7.5" r="1.1" fill="currentColor"/>') },
];

const handlers = new Map(); // id -> { canEnter, enter, leave, reselect }
let current = null;

// Plug in a working mode. Modes without one show "coming soon". reselect()
// runs when the current mode's button is tapped again.
export function registerMode(id, { canEnter = () => true, enter = () => {}, leave = () => {}, reselect = () => {} } = {}) {
  handlers.set(id, { canEnter, enter, leave, reselect });
}

export const currentMode = () => current;

export function setMode(id) {
  if (id === current) return handlers.get(id).reselect();
  const mode = MODES.find((m) => m.id === id);
  if (!mode) return;
  if (!handlers.has(id)) return toast(`${mode.label} is coming soon`);
  if (!handlers.get(id).canEnter()) return;
  if (current) handlers.get(current).leave();
  current = id;
  document.body.dataset.mode = id;
  for (const b of document.querySelectorAll("#modebar [data-mode]")) {
    const on = b.dataset.mode === id;
    b.classList.toggle("active", on);
    b.setAttribute("aria-current", on ? "page" : "false");
  }
  handlers.get(id).enter();
}

// Draw the shelf's buttons into #modebar and open the first mode.
export function createModeBar(first = "loop") {
  const bar = $("modebar");
  if (!bar) return;
  bar.innerHTML = MODES.map((m) => {
    const cls = [m.signedIn && "signed-in-only", !handlers.has(m.id) && "soon"].filter(Boolean).join(" ");
    return `<button data-mode="${m.id}"${cls ? ` class="${cls}"` : ""}>
      <span class="mode-icon">${m.icon}</span><span class="mode-label">${m.label}</span>
    </button>`;
  }).join("");
  bar.addEventListener("click", (e) => {
    const b = e.target.closest("[data-mode]");
    if (b) setMode(b.dataset.mode);
  });
  setMode(first);
}
