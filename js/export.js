// Exporting a route: the Export dialog, with Download GPX, Copy link (a
// short link to share, js/share.js) and, where there's a Garmin service,
// Send to Garmin Connect. Design: ROADMAP Phase 6 G3 (mockups in
// designs/garmin-export.html) and §6 question 14 (designs/share-mockups).
//
// Without a Garmin service (live, until Garmin's notice period ends on
// 2026-12-17) the dialog has no Garmin card. Until Copy link came
// (2026-11-23) the panels' button downloaded the GPX at once there.
//
// Page elements: #download, #art-download, #p2p-export (the panels' buttons),
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
// names. share: from createShare, for links.
export function createExport({ account, share }) {
  const dialog = $("export-dialog");
  const note = $("export-note");
  const msg = $("export-msg");
  const send = $("export-send");
  const done = $("export-done");
  const gpx = $("export-gpx");
  const connect = $("export-connect");
  const signIn = $("export-signin");
  const linkBtn = $("export-link");
  const linkBox = $("export-link-box");
  const garmin = account.garmin;
  // { points: [[lat, lon]...], heights?, climb?, distance, kind? (loop, art, p2p; none on older
  // favourites), shape?, gpxName, fileName, share (the route as favourites keep it) }
  let route = null;
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
  const sentHere = new Map(); // line id → course name, shown until the check on opening answers
  let link = null; // { id, url } once the route on show has one
  let copied = false; // and whether it's on the clipboard
  let making = false;

  $("export-garmin").hidden = !GARMIN_BASE;

  const say = (text) => { msg.textContent = text; };
  // "Runthe Paddington 10.2 km"; GPS art adds its shape: "Runthe Heart, Paddington 29.0 km".
  function courseName() {
    const shape = route.kind === "art" && route.shape ? shapeLabel(route.shape) : "";
    const where = shape && place ? `${shape}, ${place}` : shape || place;
    return ["Runthe", where, `${km(route.distance)} km`].filter(Boolean).join(" ");
  }
  function routeLine() {
    const shape = route.shape ? shapeLabel(route.shape) : "GPS art";
    const what = route.kind === "art" ? `${shape}, ${km(route.distance)} km`
      : `${km(route.distance)} km ${route.kind === "loop" ? "loop" : "route"}`; // A to B, or not known
    return place ? `${what} from ${place}` : what;
  }

  // Lays the dialog out for where things stand. The primary always goes to
  // what you can do now: Send when connected, otherwise Download GPX.
  function render() {
    const signedIn = account.signedIn();
    const ready = !!GARMIN_BASE && signedIn && status.connected && status.canSendCourses;
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
    // Download GPX and Copy link side by side when both are secondary
    $("export-pair").classList.toggle("two", !gpxIsMain);
    renderLink();
  }

  // Copy link: busy while the link's made, then "Link copied" and a box
  // with the link and what it means (UI.md, Link box).
  function renderLink() {
    linkBtn.hidden = !route?.share;
    linkBtn.setAttribute("aria-busy", making);
    linkBtn.innerHTML = making ? `<span class="spin" aria-hidden="true"></span>Making link…`
      : copied ? "Link copied" : "Copy link";
    linkBox.hidden = !link;
    if (!link) return;
    $("export-link-url").textContent = link.url.replace(/^https?:\/\//, "");
    $("export-link-note").innerHTML = !copied ? "Copy the link above to share it."
      : account.signedIn() ? `Anyone with the link can open this route. You'll find it in <a href="./links/">Shared links</a>, in the account menu.`
      : "Anyone with the link can open this route. It lasts a year after it was last opened. Sign in before sharing to keep links for good.";
  }

  async function copyLink() {
    if (making || !route?.share) return;
    const r = route;
    say("");
    making = true;
    renderLink();
    const job = share.make(r.share, place);
    // Safari lets a page copy only while the tap is fresh, so the copy
    // starts now, with the link to come (a ClipboardItem can wait for it).
    let early = Promise.resolve(false);
    if (window.ClipboardItem && navigator.clipboard?.write) {
      try {
        early = navigator.clipboard.write([new ClipboardItem({
          "text/plain": job.then(({ url }) => new Blob([url], { type: "text/plain" })),
        })]).then(() => true, () => false);
      } catch {} // this browser's ClipboardItem won't wait: copied below instead
    }
    try {
      const made = await job;
      let ok = await early;
      if (!ok) ok = await (navigator.clipboard?.writeText(made.url).then(() => true, () => false) ?? false);
      if (route === r) {
        link = made;
        copied = ok;
      }
    } catch (err) {
      console.error(err);
      if (route === r) say(err.status === 429 ? "That's a lot of links for now. Try again later."
        : "Couldn't make a link. Check your connection and try again.");
    } finally {
      making = false;
      if (route === r) renderLink();
    }
  }

  async function open(r) {
    route = r;
    sent = false;
    link = null;
    copied = false;
    making = false; // a link still being made is for the route before
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
    if (GARMIN_BASE && account.signedIn()) {
      // Sent before, from here or elsewhere, and still in Garmin Connect?
      // Asked on every opening, alongside the status, so a course deleted
      // or renamed in Garmin Connect meanwhile shows. A failed check
      // (undefined) leaves things as they were.
      const l = line;
      lookup = garmin.sentCourse(l).then((s) => (s.sent ? s.name : null)).catch(() => undefined);
      lookup.then((name) => {
        if (name === undefined) return;
        if (name) sentHere.set(l, name);
        else sentHere.delete(l);
        if (route === r && !sent) { already = name; render(); }
      });
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
  linkBtn.addEventListener("click", copyLink);
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
