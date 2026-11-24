// Accounts and favourites: Firebase Auth (Google and email link) and Firestore.
//
// Route planning needs none of this, so the Firebase code only loads once
// someone opens sign-in, follows an email link, or has signed in here before.
//
// Page elements: #account, #account-dialog (the side menu) and its [data-view]
// sections, #fav, #undo, #undo-btn. Favourites are a mode on the shelf
// (see main.js), shown only when signed in; openFavourites switches to it.
// Body class: signed-in. The Garmin Connect card in the menu is garmin.js.

import { encodeLine, decodeLine, lineId } from "./polyline.js";
import { endsMeet } from "./geometry.js";
import { createGarmin } from "./garmin.js";
import { swipeAway } from "./ui.js";
import { SDK, CONFIG } from "./firebase.js";
import { listShares, deleteAllShares } from "./share.js";
const UNDO_MS = 5000;
const RECENT_SIGN_IN_MS = 4 * 60 * 1000;
const HAS_ACCOUNT = "runthe.hasAccount";
const PENDING_EMAIL = "runthe.signInEmail";

const $ = (id) => document.getElementById(id);

// Favourites are listed newest first, one row each. They used to be grouped
// by area and length, but a new save pulled its whole area, older routes
// too, up to the top, so the order seemed to change every day (the user,
// 2026-11-16).

// Area names for the favourite rows, from OpenStreetMap's public Nominatim service.
// Its policy (https://operations.osmfoundation.org/policies/nominatim/) allows
// light use triggered by a person, so: only look up when favourites are opened,
// one request at a time at most once a second, and keep every answer on the
// device. Start points are sent rounded to about 100m. Headings simply have no
// name if a lookup fails.
// Looked up at street level (zoom 16), then named by the district that
// address is in. District level (zoom 14) snapped to the nearest district
// instead: Hyde Park Corner came back as East Marylebone (2026-11-13). The
// cache key changed then, so names from the old lookup are dropped.
const NOMINATIM = "https://nominatim.openstreetmap.org/reverse";
const PLACES = "runthe.places.v2";
try { localStorage.removeItem("runthe.places"); } catch {} // blocked storage: nothing to tidy
const LOOKUP_GAP_MS = 1100;
let lookingUp = false;

function placeName(address = {}) {
  const quarter = /centre/i.test(address.quarter ?? "") ? null : address.quarter;
  return quarter ?? address.suburb ?? address.neighbourhood ?? address.hamlet
    ?? address.village ?? address.town ?? address.city ?? "";
}

async function lookUpPlace(key) {
  const [lat, lon] = key.split(",");
  const res = await fetch(`${NOMINATIM}?format=jsonv2&lat=${lat}&lon=${lon}&zoom=16&addressdetails=1&accept-language=en`);
  if (!res.ok) throw new Error(`Place lookup failed (${res.status})`);
  return placeName((await res.json()).address);
}

// A route's place key: its start rounded to about 100m.
const placeKey = ([lon, lat]) => `${lat.toFixed(3)},${lon.toFixed(3)}`;

async function namePlaces(routes) {
  const known = JSON.parse(localStorage.getItem(PLACES) ?? "{}");
  const show = (key) => {
    for (const el of document.querySelectorAll(`.ri-place[data-key="${key}"]`)) el.textContent = el.title = known[key];
  };
  const keys = [...new Set(routes.map((r) => r.place))];
  keys.filter((k) => known[k]).forEach(show);

  const missing = keys.filter((k) => !known[k]);
  if (lookingUp || !missing.length) return;
  lookingUp = true;
  try {
    for (const key of missing) {
      const name = await lookUpPlace(key);
      if (name) {
        known[key] = name;
        localStorage.setItem(PLACES, JSON.stringify(known));
        show(key);
      }
      await new Promise((r) => setTimeout(r, LOOKUP_GAP_MS));
    }
  } catch (err) {
    console.warn(err); // try again next time favourites are opened
  } finally {
    lookingUp = false;
  }
}

// A single place name for a point ([lat, lon]), for the Export dialog: the
// cached one at once, or "" (knownPlace), or looked up (placeOf, "" if that
// fails). Same rules as the favourites' names: one lookup a person asked
// for, rounded to about 100m, kept on the device.
function knownPlace([lat, lon]) {
  try {
    return JSON.parse(localStorage.getItem(PLACES) ?? "{}")[placeKey([lon, lat])] ?? "";
  } catch {
    return "";
  }
}
async function placeOf(point) {
  const cached = knownPlace(point);
  if (cached) return cached;
  const key = placeKey([point[1], point[0]]);
  try {
    const name = await lookUpPlace(key);
    if (name) {
      const known = JSON.parse(localStorage.getItem(PLACES) ?? "{}");
      known[key] = name;
      localStorage.setItem(PLACES, JSON.stringify(known));
    }
    return name;
  } catch (err) {
    console.warn(err);
    return "";
  }
}

// ----- routes as they're kept -----
// A favourite keeps its route info (see renderInfo in loop.js) as "info".
// Firestore can't store lists of lists, so the [from, to] stretches are
// stored flat: [from, to, from, to, ...]. Favourites saved before
// 2026-11-08 have no info. Ones saved on 8-9 Nov also hold noPavement,
// noPavementSpans and back, which are ignored now that the app doesn't
// warn about roads without a sidewalk or out and backs. Shared links
// (js/share.js) keep a route the same way.
const flat = (spans) => (spans ?? []).flat();
function pairs(list) {
  const out = [];
  for (let i = 0; i + 1 < (list?.length ?? 0); i += 2) out.push([list[i], list[i + 1]]);
  return out;
}
// The climb and height profile (js/profile.js), kept since 2026-11-18;
// favourites saved before, and GPS art, have none.
const heightsOf = (r) => Array.isArray(r.elevation) && r.elevation.length > 1 && r.elevationStep > 0
  ? { climb: Math.max(0, Math.round(r.climb ?? 0)), elevation: [...r.elevation], elevationStep: r.elevationStep }
  : {};
const packInfo = (i) => ({ countryPaths: i.countryPaths, countryPathSpans: flat(i.countryPathSpans) });
const unpackInfo = (s) => s && { countryPaths: s.countryPaths ?? 0, countryPathSpans: pairs(s.countryPathSpans) };

// What a favourite holds of route r (firestore.rules says what it may).
const favouriteData = (r) => ({
  line: r.line, distance: r.distance, ...(r.info && { info: packInfo(r.info) }), ...(r.shape && { shape: r.shape.slice(0, 60) }),
  ...(r.kind && { kind: r.kind }), ...heightsOf(r),
});

// Route r ({ raw: [[lon, lat], ...], distance, ... }) as it's kept, for a
// shared link.
export const storedRoute = (r) => favouriteData({ ...r, line: r.line ?? encodeLine(r.raw) });

// A kept route (a favourite, or a shared link's) as the route viewer shows it.
export function viewerRoute(f, id = lineId(f.line)) {
  const raw = decodeLine(f.line), heights = heightsOf(f);
  // The mode that made it (loop, art or p2p), saved since 2026-11-21;
  // before, only GPS art said so (its shape), and the rest stay unknown.
  const kind = f.kind ?? (f.shape ? "art" : undefined);
  // The chart wraps round only where the route ends at its start, and
  // never for A to B (as in its own mode); one that ends elsewhere shows
  // its finish there, as the map does.
  const open = !endsMeet(raw);
  const chartEnd = heights.elevation ? heights.elevationStep * (heights.elevation.length - 1) : f.distance;
  return {
    id, line: f.line, distance: f.distance, raw, start: raw[0], place: placeKey(raw[0]), info: unpackInfo(f.info),
    ...(kind && { kind }), ...(f.shape && { shape: f.shape }), ...heights,
    ...((open || kind === "p2p") && { closed: false }),
    ...(open && { marks: [{ m: chartEnd, kind: "finish" }] }),
  };
}

// Remembers an area name the app was told (a shared link's), so it isn't
// looked up again. point: [lat, lon].
function rememberPlace([lat, lon], name) {
  try {
    const known = JSON.parse(localStorage.getItem(PLACES) ?? "{}");
    known[placeKey([lon, lat])] ??= name;
    localStorage.setItem(PLACES, JSON.stringify(known));
  } catch {} // blocked storage: it's looked up when shown
}

export function createAccount({ openFavourites = () => {} } = {}) {
  const dialog = $("account-dialog");
  const heart = $("fav");
  const saved = new Map(); // favourite id -> { line, distance, info?, savedAt }
  let app = null;
  let fb = null;
  let user = null;
  let route = null; // the route on screen
  let afterSignIn = null; // what to do once signed in, e.g. save a route
  const undoBar = $("undo");
  let undoAction = null;
  let undoTimer;

  const toast = (msg) => app?.toast(msg);
  const garmin = createGarmin({ idToken: () => user.getIdToken() });
  const favouritesPath = () => `users/${user.uid}/favourites`;

  function load() {
    fb ??= (async () => {
      const [{ initializeApp }, auth, store] = await Promise.all([
        import(`${SDK}/firebase-app.js`),
        import(`${SDK}/firebase-auth.js`),
        import(`${SDK}/firebase-firestore-lite.js`),
      ]);
      const firebase = initializeApp(CONFIG);
      const a = auth.getAuth(firebase);
      auth.onAuthStateChanged(a, onUser);
      return { auth, store, a, db: store.getFirestore(firebase) };
    })().catch((err) => {
      fb = null; // let the next tap try again
      throw err;
    });
    return fb;
  }

  // ----- signed-in state -----
  async function onUser(next) {
    user = next;
    saved.clear();
    document.body.classList.toggle("signed-in", !!user);
    if (user) localStorage.setItem(HAS_ACCOUNT, "1");
    else localStorage.removeItem(HAS_ACCOUNT);
    $("account-email").textContent = user?.email ?? "";
    if (user && dialog.open) setView("account");
    // Back from Garmin's page: open the menu to show how connecting went.
    garmin.userChanged(!!user).then((back) => { if (back && user) open("account"); });
    if (!user) {
      hideUndo();
      app?.exitFavourites(); // don't leave saved routes on screen
      localStorage.removeItem(PLACES);
      return syncHeart();
    }

    try {
      await loadFavourites();
    } catch (err) {
      console.error(err);
      toast("Couldn't load your favourites.");
    }
    syncHeart();
    const next_ = afterSignIn;
    afterSignIn = null;
    if (next_) {
      dialog.close();
      next_();
    }
  }

  async function loadFavourites() {
    const { store, db } = await load();
    const snap = await store.getDocs(store.collection(db, favouritesPath()));
    saved.clear();
    for (const d of snap.docs) saved.set(d.id, d.data());
  }

  // ----- dialog -----
  function setView(view) {
    dialog.dataset.view = view;
    $("account-error").textContent = "";
  }
  function open(view) {
    setView(view);
    if (view === "account") {
      garmin.opened();
      countLinks();
    }
    if (!dialog.open) dialog.showModal();
    load().catch(() => showError("Couldn't load sign-in. Check your connection."));
  }
  const showError = (msg) => { $("account-error").textContent = msg; };

  // The Shared links row's count (js/links.js is the page), asked each time
  // the menu opens, as links may have been made or deleted elsewhere.
  async function countLinks() {
    const badge = $("links-count");
    if (!user || !badge) return;
    try {
      const n = (await listShares(await user.getIdToken())).length;
      badge.textContent = n;
      badge.setAttribute("aria-label", n === 1 ? "1 link" : `${n} links`);
      badge.hidden = n === 0;
    } catch (err) {
      console.warn(err); // the row works without its count
    }
  }

  function explain(err) {
    console.error(err);
    switch (err.code) {
      case "auth/popup-closed-by-user":
      case "auth/cancelled-popup-request":
        return "";
      case "auth/popup-blocked":
        return "Your browser blocked the Google window. Allow pop-ups and try again.";
      case "auth/invalid-email":
        return "That email address doesn't look right.";
      case "auth/quota-exceeded":
        return "Email sign-in has hit its daily limit. Use Google, or try again tomorrow.";
      case "auth/invalid-action-code":
      case "auth/expired-action-code":
        return "That sign-in link has expired or was already used. Ask for a new one.";
      default:
        return "Something went wrong. Please try again.";
    }
  }

  async function signInGoogle() {
    try {
      const { auth, a } = await load();
      await auth.signInWithPopup(a, new auth.GoogleAuthProvider());
    } catch (err) {
      showError(explain(err));
    }
  }

  async function sendLink(email) {
    try {
      const { auth, a } = await load();
      const url = location.origin + location.pathname;
      await auth.sendSignInLinkToEmail(a, email, { url, handleCodeInApp: true });
      localStorage.setItem(PENDING_EMAIL, email);
      $("sent-email").textContent = email;
      setView("sent");
    } catch (err) {
      showError(explain(err));
    }
  }

  async function finishLink(email) {
    try {
      const { auth, a } = await load();
      await auth.signInWithEmailLink(a, email, location.href);
      localStorage.removeItem(PENDING_EMAIL);
      history.replaceState(null, "", location.pathname);
      dialog.close();
    } catch (err) {
      if (!dialog.open) open("signin");
      showError(explain(err));
    }
  }

  // Google allows deleting only soon after signing in, so check first: that way
  // nothing is removed if the account can't be deleted.
  async function confirmIdentity() {
    const { auth } = await load();
    const signedInAgo = Date.now() - Date.parse(user.metadata.lastSignInTime);
    if (signedInAgo < RECENT_SIGN_IN_MS) return true;
    if (user.providerData.some((p) => p.providerId === "google.com")) {
      await auth.reauthenticateWithPopup(user, new auth.GoogleAuthProvider());
      return true;
    }
    showError("For your security, sign out and back in, then delete your account.");
    return false;
  }

  async function deleteAccount() {
    const button = $("delete-confirm");
    button.disabled = true;
    try {
      if (!(await confirmIdentity())) return;
      try {
        await garmin.beforeDelete();
      } catch (err) {
        console.error(err);
        return showError("Couldn't disconnect Garmin, so nothing was deleted. Try again.");
      }
      try {
        await deleteAllShares(await user.getIdToken());
      } catch (err) {
        console.error(err);
        return showError("Couldn't delete your shared links, so nothing was deleted. Try again.");
      }
      const { auth, store, db } = await load();
      const snap = await store.getDocs(store.collection(db, favouritesPath()));
      await Promise.all(snap.docs.map((d) => store.deleteDoc(d.ref)));
      await auth.deleteUser(user);
      dialog.close();
      toast("Your account, favourites and shared links have been deleted.");
    } catch (err) {
      showError(explain(err));
    } finally {
      button.disabled = false;
    }
  }

  // ----- favourites -----
  // Called whenever the favourites change, for hearts drawn elsewhere (GPS
  // art's).
  const watchers = [];

  function idOf(r) {
    r.line ??= encodeLine(r.raw);
    r.id ??= lineId(r.line);
    return r.id;
  }

  // The heart under the map, and the hearts in the route list.
  function syncHeart() {
    for (const tell of watchers) tell();
    const on = !!route && saved.has(idOf(route));
    heart.classList.toggle("on", on);
    heart.setAttribute("aria-pressed", on);
    for (const b of document.querySelectorAll(".ri-heart")) {
      const liked = saved.size > 0 && saved.has(idOf(app.state.routes[+b.dataset.i]));
      b.classList.toggle("on", liked);
      b.setAttribute("aria-pressed", liked);
    }
  }

  function favouriteRoutes() {
    const newestFirst = [...saved.entries()].sort(([, a], [, b]) => (b.savedAt?.seconds ?? 0) - (a.savedAt?.seconds ?? 0));
    return newestFirst.map(([id, f]) => viewerRoute(f, id));
  }

  // Keeps the favourites list right after a change, staying on the route on
  // screen if it's still there.
  function refreshFavourites() {
    if (!app.state.favourites) return;
    if (!saved.size) return app.exitFavourites();
    const routes = favouriteRoutes();
    const i = route ? routes.findIndex((r) => r.id === idOf(route)) : -1;
    app.updateRoutes(routes, Math.max(i, 0), i < 0);
    namePlaces(routes);
  }

  // savedAt is only given when undoing, to put a route back where it was.
  async function toggleFavourite(r, savedAt) {
    if (!user) {
      afterSignIn = () => { if (!saved.has(idOf(r))) toggleFavourite(r); };
      return open("signin");
    }
    const id = idOf(r);
    const before = saved.get(id);
    const change = (entry) => {
      if (entry) saved.set(id, entry);
      else saved.delete(id);
      syncHeart();
      refreshFavourites();
    };
    const fav = favouriteData(r);
    const wasInFavourites = app.state.favourites;
    change(before ? null : { ...fav, savedAt: savedAt ?? { seconds: Date.now() / 1000 } });
    const write = (async () => {
      const { store, db } = await load();
      const ref = store.doc(db, favouritesPath(), id);
      if (before) return store.deleteDoc(ref);
      const time = savedAt ? store.Timestamp.fromMillis(savedAt.seconds * 1000) : store.serverTimestamp();
      return store.setDoc(ref, { ...fav, savedAt: time });
    })();
    if (before && wasInFavourites) offerUndo(r, before.savedAt, write);
    try {
      await write;
    } catch (err) {
      console.error(err);
      hideUndo();
      change(before);
      toast("Couldn't update your favourites. Try again?");
    }
  }

  const OPTIONAL = ["info", "shape", "kind", "climb", "elevation", "elevationStep"];

  // An A to B favourite follows its route as it changes (js/p2p.js): the
  // same favourite (r.id) overwritten, keeping when it was first saved, so
  // its place and number in the list stay. Only while it's still saved:
  // one removed meanwhile isn't brought back.
  async function updateFavourite(r) {
    const id = r.id, before = saved.get(id);
    if (!user || !before) return;
    r.line = encodeLine(r.raw); // the route's line now
    const fav = favouriteData(r);
    saved.set(id, { ...fav, savedAt: before.savedAt });
    syncHeart();
    refreshFavourites();
    try {
      const { store, db } = await load();
      // savedAt is left as it is; fields the route no longer has go
      const gone = Object.fromEntries(OPTIONAL.filter((k) => !(k in fav)).map((k) => [k, store.deleteField()]));
      await store.updateDoc(store.doc(db, favouritesPath(), id), { ...fav, ...gone });
    } catch (err) {
      console.error(err);
      toast("Couldn't save the changes to your favourite. They'll go with the next one.");
    }
  }

  // A newer removal replaces this offer, so clearing out several isn't held up.
  function offerUndo(r, savedAt, write) {
    const wasLast = !saved.size;
    undoAction = async () => {
      await write.catch(() => {});
      await toggleFavourite(r, savedAt);
      if (wasLast) openFavourites(); // removing the last one left favourites
    };
    undoBar.classList.remove("show");
    void undoBar.offsetWidth; // restart the animation, so a new offer is noticeable
    undoBar.classList.add("show");
    clearTimeout(undoTimer);
    undoTimer = setTimeout(hideUndo, UNDO_MS);
  }

  function hideUndo() {
    clearTimeout(undoTimer);
    undoAction = null;
    undoBar.classList.remove("show");
  }
  // Swiped away (touch screens), the removal stands, as when it times out.
  swipeAway(undoBar, {
    edge: "bottom",
    onStart: () => clearTimeout(undoTimer),
    onBack: () => { undoTimer = setTimeout(hideUndo, 2500); },
    onGone: hideUndo,
  });

  // Whether there's anything to show, saying so if not.
  function hasFavourites() {
    if (!saved.size) toast("No favourites yet. Tap the heart on a route to save it.");
    return saved.size > 0;
  }
  async function showFavourites() {
    dialog.close();
    if (!saved.size) return;
    const routes = favouriteRoutes();
    await app.showRoutes(routes, { favourites: true, start: routes[0].start });
    namePlaces(routes);
  }

  // ----- wiring -----
  $("account").addEventListener("click", () => open(user ? "account" : "signin"));
  $("account-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { afterSignIn = null; });
  // The panel fills the dialog, so a click on the dialog itself is the backdrop.
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
  heart.addEventListener("click", () => { if (route) toggleFavourite(route); });
  $("google-signin").addEventListener("click", signInGoogle);
  $("email-form").addEventListener("submit", (e) => {
    e.preventDefault();
    sendLink($("email").value.trim());
  });
  $("confirm-form").addEventListener("submit", (e) => {
    e.preventDefault();
    finishLink($("confirm-email").value.trim());
  });
  $("delete-account").addEventListener("click", () => setView("delete"));
  $("delete-cancel").addEventListener("click", () => setView("account"));
  $("delete-confirm").addEventListener("click", deleteAccount);
  $("undo-btn").addEventListener("click", () => {
    const undo = undoAction;
    hideUndo();
    undo?.();
  });
  $("sign-out").addEventListener("click", async () => {
    const { auth, a } = await load();
    await auth.signOut(a);
    dialog.close();
  });

  // Back from an email link, or someone who has signed in here before.
  async function start() {
    const fromEmail = new URLSearchParams(location.search).get("mode") === "signIn";
    if (!fromEmail && !localStorage.getItem(HAS_ACCOUNT)) return;
    try {
      const { auth, a } = await load();
      if (!fromEmail || !auth.isSignInWithEmailLink(a, location.href)) return;
      const email = localStorage.getItem(PENDING_EMAIL);
      if (email) return finishLink(email);
      open("confirm"); // opened on a different device or browser
    } catch (err) {
      console.error(err);
    }
  }

  return {
    attach(a) { app = a; start(); },
    garmin,
    signedIn: () => !!user,
    // For calls that need to know who's signed in: null when no one is.
    uid: () => user?.uid ?? null,
    idToken: () => (user ? user.getIdToken() : Promise.resolve(null)),
    // how routes are kept, for shared links (js/share.js)
    storedRoute,
    viewerRoute,
    rememberPlace,
    // Opens sign-in, then runs then() once signed in (Google; an email link
    // leaves the page, so it's lost).
    signIn(then) {
      afterSignIn = then;
      open("signin");
    },
    knownPlace,
    placeOf,
    routeShown(r) { route = r; syncHeart(); },
    toggleFavourite,
    updateFavourite,
    // For other modes' hearts: r is { raw: [[lon, lat], ...], distance }.
    isFavourite: (r) => saved.has(idOf(r)),
    onFavouritesChange(tell) { watchers.push(tell); },
    hasFavourites,
    showFavourites,
  };
}
