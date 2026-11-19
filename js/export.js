// Exporting a route: a GPX file, or (where there's a Garmin service) the
// Export dialog with Send to Garmin Connect. Design: ROADMAP Phase 6 G3,
// mockups in designs/garmin-export.html.
//
// Without a Garmin service (live, until Garmin's notice period ends on
// 2026-12-17) the panel's button keeps saying Export GPX and downloads at
// once, as before.
//
// Page elements: #download, #art-download (the panels' buttons),
// #export-dialog and its #export-* parts.

import { GARMIN_BASE } from "./garmin.js";
import { shapeLabel } from "./loop.js";
import { encodeLine, lineId } from "./polyline.js";

const PENDING = "runthe.pendingExport"; // the route, while away connecting Garmin
const $ = (id) => document.getElementById(id);
const km = (m) => (m / 1000).toFixed(1);
const COURSES_OFF = "Turn Courses on in Garmin Connect's settings for Runthe, or disconnect and connect again with Courses on.";

// heights: one per point, in metres (see heightsAt in profile.js), or none.
export function downloadGPX({ points, heights, gpxName, fileName }) {
  const ele = (i) => (heights ? `<ele>${heights[i]}</ele>` : "");
  const pts = points.map(([lat, lon], i) => `<trkpt lat="${lat}" lon="${lon}">${ele(i)}</trkpt>`).join("");
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="runthe"><trk><name>${gpxName}</name><trkseg>${pts}</trkseg></trk></gpx>`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([gpx], { type: "application/gpx+xml" }));
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// account: from createAccount, for sign-in, the Garmin connection and place
// names.
export function createExport({ account }) {
  const dialog = $("export-dialog");
  const note = $("export-note");
  const msg = $("export-msg");
  const send = $("export-send");
  const done = $("export-done");
  const gpx = $("export-gpx");
  const connect = $("export-connect");
  const signIn = $("export-signin");
  const garmin = account.garmin;
  let route = null; // { points: [[lat, lon]...], heights?, climb?, distance, kind, shape?, gpxName, fileName }
  let place = "";
  let status = { connected: false, canSendCourses: false };
  let sent = false;
  // Sent before: the course's name in Garmin Connect now (they may have
  // renamed it there), so Send gives way to a note instead of making a
  // second course. Garmin can't take a course off a watch, nor update one
  // there (an update arrives as a second course: tested 2026-11-19), so
  // not sending twice is the only way to avoid duplicates.
  let already = null;
  let line = ""; // the route's line id, the same one favourites use
  let lookup = null; // the check for an earlier send, while it runs
  const sentHere = new Map(); // line id → course name, known this visit

  if (GARMIN_BASE) {
    for (const id of ["download", "art-download"]) {
      const b = $(id);
      if (b) b.textContent = "Export";
    }
  }

  const say = (text) => { msg.textContent = text; };
  // "Runthe Paddington 10.2 km"; GPS art adds its shape: "Runthe Heart, Paddington 29.0 km".
  function courseName() {
    const shape = route.kind === "art" && route.shape ? shapeLabel(route.shape) : "";
    const where = shape && place ? `${shape}, ${place}` : shape || place;
    return ["Runthe", where, `${km(route.distance)} km`].filter(Boolean).join(" ");
  }
  function routeLine() {
    const shape = route.shape ? shapeLabel(route.shape) : "GPS art";
    const what = route.kind === "art" ? `${shape}, ${km(route.distance)} km` : `${km(route.distance)} km loop`;
    return place ? `${what} from ${place}` : what;
  }

  // Lays the dialog out for where things stand. The primary always goes to
  // what you can do now: Send when connected, otherwise Download GPX.
  function render() {
    const signedIn = account.signedIn();
    const ready = signedIn && status.connected && status.canSendCourses;
    $("export-route").textContent = routeLine();
    note.classList.toggle("on", sent || !!already);
    // Garmin's Courses API: courses sent this way sync to the watch.
    if (sent) note.textContent = "Sent to Garmin Connect. It goes to your watch at its next sync.";
    else if (already) note.textContent = `Already in Garmin Connect as “${already}”`;
    else if (!signedIn) note.textContent = "Sign in to send routes to your watch";
    else if (!status.connected) note.textContent = "Send routes to your watch";
    else if (!status.canSendCourses) note.textContent = "Courses are switched off for Runthe in Garmin Connect";
    else note.textContent = `Saves as a course called “${courseName()}”`;
    signIn.hidden = signedIn;
    connect.hidden = !signedIn || status.connected;
    send.hidden = !ready || sent || !!already;
    done.hidden = !sent && !already;
    // Courses off: say how to fix it, as the account menu does.
    if (signedIn && status.connected && !status.canSendCourses && !sent && !already) say(COURSES_OFF);
    else if (msg.textContent === COURSES_OFF) say(""); // a fresh check found them back on
    const gpxIsMain = !ready && !sent && !already;
    gpx.classList.toggle("btn-primary", gpxIsMain);
    gpx.classList.toggle("btn-secondary", !gpxIsMain);
  }

  async function open(r) {
    if (!GARMIN_BASE) return downloadGPX(r);
    route = r;
    sent = false;
    line = lineId(encodeLine(r.points.map(([lat, lon]) => [lon, lat])));
    already = sentHere.get(line) ?? null;
    lookup = null;
    say("");
    place = account.knownPlace(r.points[0]);
    status = garmin.lastStatus();
    render();
    if (!dialog.open) dialog.showModal();
    // Fill in what wasn't known yet: the place name and a fresh status.
    account.placeOf(r.points[0]).then((p) => { if (route === r && p && p !== place) { place = p; render(); } });
    if (account.signedIn()) {
      // Sent from another visit or device? Asked alongside the status.
      if (!already) {
        const l = line;
        lookup = garmin.sentCourse(l).then((s) => (s.sent ? s.name : null)).catch(() => null);
        lookup.then((name) => {
          if (!name) return;
          sentHere.set(l, name);
          if (route === r) { already = name; render(); }
        });
      }
      status = await garmin.check();
      if (route === r) render();
    }
  }

  async function sendCourse() {
    if (send.getAttribute("aria-busy") === "true") return;
    say("");
    send.setAttribute("aria-busy", "true");
    send.innerHTML = `<span class="spin" aria-hidden="true"></span>Sending…`;
    try {
      // Tapped before the check for an earlier send came back: wait for it.
      if (lookup && await lookup) return;
      const name = courseName();
      await garmin.sendCourse({
        name, distance: route.distance, points: route.points, line,
        ...(route.heights && { heights: route.heights, climb: route.climb ?? 0 }),
      });
      sentHere.set(line, name);
      sent = true;
    } catch (err) {
      console.error(err);
      if (err.reason === "not_connected") {
        status = { connected: false, canSendCourses: false };
        say("Garmin isn't connected any more. Connect again to send this route.");
      } else if (err.reason === "courses_off") {
        status = { connected: true, canSendCourses: false };
      } else if (err.reason === "rate_limited") {
        say("Garmin's limit for today is reached. Try again tomorrow, or download the GPX.");
      } else {
        say("Garmin didn't take the route. Check your connection and try again.");
      }
    } finally {
      send.removeAttribute("aria-busy");
      send.textContent = "Send to Garmin Connect";
      render();
    }
  }

  // Connecting leaves for Garmin's page, which would lose the routes on
  // screen, so the route waits on the device and the dialog reopens on return.
  async function connectGarmin() {
    if (connect.getAttribute("aria-busy") === "true") return;
    say("");
    connect.setAttribute("aria-busy", "true");
    connect.innerHTML = `<span class="spin" aria-hidden="true"></span>Opening Garmin…`;
    try {
      sessionStorage.setItem(PENDING, JSON.stringify(route));
    } catch {} // blocked storage: they'll come back to the account menu instead
    try {
      await garmin.beginConnect();
    } catch (err) {
      console.error(err);
      try { sessionStorage.removeItem(PENDING); } catch {}
      connect.removeAttribute("aria-busy");
      connect.textContent = "Connect";
      say("Couldn't start connecting. Check your connection and try again.");
    }
  }

  // Back from Garmin's page with a route waiting: reopen the dialog with it.
  garmin.onReturn((result, message) => {
    let saved = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(PENDING) ?? "null");
      sessionStorage.removeItem(PENDING);
    } catch {}
    if (!saved?.points?.length) return false;
    open(saved).then(() => { if (message) say(message); });
    return true;
  });

  send.addEventListener("click", sendCourse);
  done.addEventListener("click", () => dialog.close());
  gpx.addEventListener("click", () => downloadGPX(route));
  connect.addEventListener("click", connectGarmin);
  signIn.addEventListener("click", () => {
    const r = route;
    dialog.close();
    account.signIn(() => open(r));
  });
  $("export-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
  addEventListener("pageshow", (e) => {
    if (!e.persisted) return;
    connect.removeAttribute("aria-busy");
    connect.textContent = "Connect";
  });

  return { open };
}
