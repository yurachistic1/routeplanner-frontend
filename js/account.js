// Accounts and favourites: Firebase Auth (Google and email link) and Firestore.
//
// Route planning needs none of this, so the Firebase code only loads once
// someone opens sign-in, follows an email link, or has signed in here before.
//
// Page elements: #account, #account-dialog (the side menu) and its [data-view]
// sections, #fav, #undo, #undo-btn.
// Body class: signed-in.

import { encodeLine, decodeLine, lineId } from "./polyline.js";

const SDK = "https://www.gstatic.com/firebasejs/13.2.0";
// These identify the project and are safe to publish. firestore.rules is what
// protects the data.
const CONFIG = {
  apiKey: "AIzaSyC0leJbFb_OM7wZQ8wJT9xbtlTIFiR38gE",
  authDomain: "runthe-app.firebaseapp.com",
  projectId: "runthe-app",
  appId: "1:992600618756:web:c906428e1c3e84189c8251",
};
const UNDO_MS = 5000;
const RECENT_SIGN_IN_MS = 4 * 60 * 1000;
const HAS_ACCOUNT = "runthe.hasAccount";
const PENDING_EMAIL = "runthe.signInEmail";

const $ = (id) => document.getElementById(id);

// Favourites count as one group when their starts are close and their lengths
// are similar. Routes from one request are always within these limits, so they
// stay together without storing which request they came from.
const SAME_AREA_M = 500;
const SAME_LENGTH_M = 1000;

function metresApart([lonA, latA], [lonB, latB]) {
  const x = (lonA - lonB) * Math.cos((latA * Math.PI) / 180);
  return Math.hypot(x, latA - latB) * 111320;
}

// Takes routes newest first. Returns them area by area, most recently used area
// first, shortest group first within an area, each with a shared `group`.
function groupRoutes(routes) {
  const areas = [];
  for (const r of routes) {
    const area = areas.find((a) => metresApart(a[0].start, r.start) <= SAME_AREA_M);
    if (area) area.push(r);
    else areas.push([r]);
  }
  const out = [];
  for (const area of areas) {
    const [lon, lat] = area[0].start;
    const key = `${lat.toFixed(3)},${lon.toFixed(3)}`; // about 100m
    area.sort((a, b) => a.distance - b.distance);
    let members = [];
    const close = () => {
      const km = Math.round(members.reduce((sum, r) => sum + r.distance, 0) / members.length / 1000);
      const group = { key, label: `${km} km · ${members.length} route${members.length === 1 ? "" : "s"}` };
      for (const r of members) out.push({ ...r, group });
      members = [];
    };
    for (const r of area) {
      if (members.length && r.distance - members[0].distance > SAME_LENGTH_M) close();
      members.push(r);
    }
    close();
  }
  return out;
}

// Area names for group headings, from OpenStreetMap's public Nominatim service.
// Its policy (https://operations.osmfoundation.org/policies/nominatim/) allows
// light use triggered by a person, so: only look up when favourites are opened,
// one request at a time at most once a second, and keep every answer on the
// device. Start points are sent rounded to about 100m. Headings simply have no
// name if a lookup fails.
const NOMINATIM = "https://nominatim.openstreetmap.org/reverse";
const PLACES = "runthe.places";
const LOOKUP_GAP_MS = 1100;
let lookingUp = false;

function placeName(address = {}) {
  const quarter = /centre/i.test(address.quarter ?? "") ? null : address.quarter;
  return quarter ?? address.suburb ?? address.neighbourhood ?? address.hamlet
    ?? address.village ?? address.town ?? address.city ?? "";
}

async function lookUpPlace(key) {
  const [lat, lon] = key.split(",");
  const res = await fetch(`${NOMINATIM}?format=jsonv2&lat=${lat}&lon=${lon}&zoom=14&addressdetails=1&accept-language=en`);
  if (!res.ok) throw new Error(`Place lookup failed (${res.status})`);
  return placeName((await res.json()).address);
}

async function namePlaces(routes) {
  const known = JSON.parse(localStorage.getItem(PLACES) ?? "{}");
  const show = (key) => {
    for (const el of document.querySelectorAll(`.route-group[data-key="${key}"] .rg-place`)) el.textContent = known[key];
  };
  const keys = [...new Set(routes.map((r) => r.group.key))];
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

export function createAccount() {
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
    if (!dialog.open) dialog.showModal();
    load().catch(() => showError("Couldn't load sign-in. Check your connection."));
  }
  const showError = (msg) => { $("account-error").textContent = msg; };

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
      const { auth, store, db } = await load();
      const snap = await store.getDocs(store.collection(db, favouritesPath()));
      await Promise.all(snap.docs.map((d) => store.deleteDoc(d.ref)));
      await auth.deleteUser(user);
      dialog.close();
      toast("Your account and favourites have been deleted.");
    } catch (err) {
      showError(explain(err));
    } finally {
      button.disabled = false;
    }
  }

  // ----- favourites -----
  // A favourite keeps its route info (see renderInfo in app.js) as "info".
  // Firestore can't store lists of lists, so the [from, to] stretches are
  // stored flat: [from, to, from, to, ...]. Favourites saved before
  // 2026-11-08 have no info.
  const flat = (spans) => (spans ?? []).flat();
  function pairs(list) {
    const out = [];
    for (let i = 0; i + 1 < (list?.length ?? 0); i += 2) out.push([list[i], list[i + 1]]);
    return out;
  }
  const packInfo = (i) => ({
    noPavement: i.noPavement, countryPaths: i.countryPaths, back: !!i.back,
    noPavementSpans: flat(i.noPavementSpans), countryPathSpans: flat(i.countryPathSpans),
  });
  const unpackInfo = (s) => s && {
    noPavement: s.noPavement ?? 0, countryPaths: s.countryPaths ?? 0, back: !!s.back,
    noPavementSpans: pairs(s.noPavementSpans), countryPathSpans: pairs(s.countryPathSpans),
  };

  function idOf(r) {
    r.line ??= encodeLine(r.raw);
    r.id ??= lineId(r.line);
    return r.id;
  }

  // The heart under the map, and the hearts in the route list.
  function syncHeart() {
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
    return groupRoutes(newestFirst.map(([id, f]) => {
      const raw = decodeLine(f.line);
      return { id, line: f.line, distance: f.distance, raw, start: raw[0], info: unpackInfo(f.info) };
    }));
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
    const fav = { line: r.line, distance: r.distance, ...(r.info && { info: packInfo(r.info) }) };
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

  // A newer removal replaces this offer, so clearing out several isn't held up.
  function offerUndo(r, savedAt, write) {
    const wasLast = !saved.size;
    undoAction = async () => {
      await write.catch(() => {});
      await toggleFavourite(r, savedAt);
      if (wasLast) showFavourites(); // removing the last one left favourites
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

  async function showFavourites() {
    dialog.close();
    if (!saved.size) return toast("No favourites yet. Tap the heart on a route to save it.");
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
  $("show-favourites").addEventListener("click", showFavourites);
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
    routeShown(r) { route = r; syncHeart(); },
    toggleFavourite,
  };
}
