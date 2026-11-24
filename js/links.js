// The Shared links page (links/, a settings page: UI.md): the links the
// signed-in person has shared (js/share.js), newest first, each with its
// preview, Open, Copy link and Delete. Delete takes the row away with an
// Undo bar, as removing a favourite does, and deletes the link when the bar
// goes; the link then says the route was taken down.

import { SDK, CONFIG } from "./firebase.js";
import { SHARE_BASE } from "./api.js";
import { listShares, deleteShare } from "./share.js";

const UNDO_MS = 5000;
const $ = (id) => document.getElementById(id);
const list = $("links");
let user = null;
let token = null; // kept fresh, so a deletion can go the moment the page closes
let pending = null; // { item, li, at, timer }: deleted, while Undo is offered

// Firebase hands back the same token until it's near its hour, so asking
// every 20 minutes keeps one that works.
async function refreshToken() {
  try {
    token = await user.getIdToken();
  } catch (err) {
    console.warn(err);
  }
}

async function signedInUser() {
  const [{ initializeApp }, auth] = await Promise.all([import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`)]);
  const a = auth.getAuth(initializeApp(CONFIG));
  return new Promise((resolve) => {
    const stop = auth.onAuthStateChanged(a, (u) => { stop(); resolve(u); });
  });
}

// "today", "yesterday", "19 Nov", "14 Oct 2025"
function when(iso) {
  const d = new Date(iso), now = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(now) - day(d)) / 864e5);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  const opts = { day: "numeric", month: "short", ...(d.getFullYear() !== now.getFullYear() && { year: "numeric" }) };
  return new Intl.DateTimeFormat("en-GB", opts).format(d);
}

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

function row(item) {
  const li = el("li", "share");
  const img = el("img", "thumb");
  Object.assign(img, { src: item.image, alt: "", loading: "lazy", width: 116, height: 104 });
  const text = el("div", "share-text");
  text.append(
    el("span", "share-title", item.title),
    el("span", "share-meta", `Shared ${when(item.created)}`),
    el("span", "share-url mono", item.url.replace(/^https?:\/\//, "")),
  );
  const actions = el("div", "share-actions");
  const open = el("a", "btn btn-secondary btn-small", "Open");
  open.href = `../#s=${item.id}`;
  open.setAttribute("aria-label", `Open ${item.title}`);
  const copy = el("button", "btn btn-secondary btn-small", "Copy link");
  copy.setAttribute("aria-label", `Copy the link to ${item.title}`);
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(item.url);
      copy.textContent = "Copied";
      setTimeout(() => { copy.textContent = "Copy link"; }, 1600);
    } catch {
      say(`Couldn't copy it. The link is ${item.url}`);
    }
  });
  const del = el("button", "btn btn-tertiary", "Delete");
  del.setAttribute("aria-label", `Delete the link to ${item.title}`);
  del.addEventListener("click", () => remove(item, li));
  actions.append(open, copy, del);
  li.append(img, text, actions);
  return li;
}

const say = (text) => { $("msg").textContent = text; };

function showEmpty() {
  const none = !list.children.length;
  $("empty").hidden = !none;
  $("lede").hidden = none;
}

// Takes the row away and offers Undo; the link is deleted when the offer
// goes (a newer deletion ends the one before at once, so clearing out
// several isn't held up).
function remove(item, li) {
  if (pending) commit();
  say("");
  const at = [...list.children].indexOf(li);
  li.classList.add("going");
  const fade = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 200;
  pending = { item, li, at, timer: setTimeout(commit, UNDO_MS), fading: setTimeout(() => { li.remove(); showEmpty(); }, fade) };
  const bar = $("undo");
  bar.hidden = true;
  void bar.offsetWidth; // restart its entrance, so a new offer is noticed
  bar.hidden = false;
}

async function commit({ leaving = false } = {}) {
  const p = pending;
  if (!p) return;
  pending = null;
  clearTimeout(p.timer);
  $("undo").hidden = true;
  if (leaving) {
    // The page is going (or hidden): sent now, with nothing to wait for
    // first, and the request carries on without the page.
    fetch(`${SHARE_BASE}/shares/${p.item.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` }, keepalive: true });
    return;
  }
  try {
    await deleteShare(await user.getIdToken(), p.item.id);
  } catch (err) {
    console.error(err);
    if (err.status === 404) return; // already gone
    putBack(p);
    say("Couldn't delete that link. Check your connection and try again.");
  }
}

function putBack({ li, at }) {
  li.classList.remove("going");
  list.insertBefore(li, list.children[at] ?? null);
  showEmpty();
}

$("undo-btn").addEventListener("click", () => {
  const p = pending;
  if (!p) return;
  pending = null;
  clearTimeout(p.timer);
  clearTimeout(p.fading);
  $("undo").hidden = true;
  putBack(p);
});
// Leaving the page, or switching away from it, ends the Undo offer: the
// deletion stands, as when a swiped-away Undo bar goes in the app.
addEventListener("pagehide", () => commit({ leaving: true }));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") commit({ leaving: true });
});

async function load() {
  say("");
  $("retry").hidden = true;
  $("lede").hidden = false;
  $("lede").textContent = "Loading your links…";
  try {
    user ??= await signedInUser();
    if (!user) {
      $("lede").innerHTML = 'Sign in on <a href="../">Runthe</a> to see the links you\'ve shared.';
      $("foot").hidden = false;
      return;
    }
    await refreshToken();
    setInterval(refreshToken, 20 * 60 * 1000);
    const items = await listShares(token);
    list.replaceChildren(...items.map(row));
    $("lede").textContent = "Anyone with one of these links can open its route. Deleting a link stops it working straight away.";
    $("foot").hidden = false;
    showEmpty();
  } catch (err) {
    console.error(err);
    $("lede").hidden = true;
    say("Couldn't load your links. Check your connection and try again.");
    $("retry").hidden = false;
  }
}
$("retry").addEventListener("click", load);
load();
