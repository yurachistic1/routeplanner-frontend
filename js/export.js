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

const PENDING = "runthe.pendingExport"; // the route, while away connecting Garmin
const $ = (id) => document.getElementById(id);
const km = (m) => (m / 1000).toFixed(1);
const COURSES_OFF = "Turn Courses on in Garmin Connect's settings for Runthe, or disconnect and connect again with Courses on.";

export function downloadGPX({ points, gpxName, fileName }) {
  const pts = points.map(([lat, lon]) => `<trkpt lat="${lat}" lon="${lon}"></trkpt>`).join("");
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
  let route = null; // { points: [[lat, lon]...], distance, kind, shape?, gpxName, fileName }
  let place = "";
  let status = { connected: false, canSendCourses: false };
  let sent = false;

  if (GARMIN_BASE) {
    for (const id of ["download", "art-download"]) {
      const b = $(id);
      if (b) b.textContent = "Export";
    }
  }

  const say = (text) => { msg.textContent = text; };
  const courseName = () => ["Runthe", place || (route.kind === "art" ? route.shape : ""), `${km(route.distance)} km`].filter(Boolean).join(" ");
  function routeLine() {
    const shape = route.shape ? route.shape[0].toUpperCase() + route.shape.slice(1) : "GPS art";
    const what = route.kind === "art" ? `${shape}, ${km(route.distance)} km` : `${km(route.distance)} km loop`;
    return place ? `${what} from ${place}` : what;
  }

  // Lays the dialog out for where things stand. The primary always goes to
  // what you can do now: Send when connected, otherwise Download GPX.
  function render() {
    const signedIn = account.signedIn();
    const ready = signedIn && status.connected && status.canSendCourses;
    $("export-route").textContent = routeLine();
    note.classList.toggle("on", sent);
    // Garmin's Courses API: courses sent this way sync to the watch.
    if (sent) note.textContent = "Sent to Garmin Connect. It goes to your watch at its next sync.";
    else if (!signedIn) note.textContent = "Sign in to send routes to your watch";
    else if (!status.connected) note.textContent = "Send routes to your watch";
    else if (!status.canSendCourses) note.textContent = "Courses are switched off for Runthe in Garmin Connect";
    else note.textContent = `Saves as a course called “${courseName()}”`;
    signIn.hidden = signedIn;
    connect.hidden = !signedIn || status.connected;
    send.hidden = !ready || sent;
    done.hidden = !sent;
    // Courses off: say how to fix it, as the account menu does.
    if (signedIn && status.connected && !status.canSendCourses && !sent) say(COURSES_OFF);
    else if (msg.textContent === COURSES_OFF) say(""); // a fresh check found them back on
    const gpxIsMain = !ready && !sent;
    gpx.classList.toggle("btn-primary", gpxIsMain);
    gpx.classList.toggle("btn-secondary", !gpxIsMain);
  }

  async function open(r) {
    if (!GARMIN_BASE) return downloadGPX(r);
    route = r;
    sent = false;
    say("");
    place = account.knownPlace(r.points[0]);
    status = garmin.lastStatus();
    render();
    if (!dialog.open) dialog.showModal();
    // Fill in what wasn't known yet: the place name and a fresh status.
    account.placeOf(r.points[0]).then((p) => { if (route === r && p && p !== place) { place = p; render(); } });
    if (account.signedIn()) {
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
      await garmin.sendCourse({ name: courseName(), distance: route.distance, points: route.points });
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
