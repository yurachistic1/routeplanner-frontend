// Sharing a route by link (ROADMAP §6, question 14; the backend's share.go).
// Copy link in the Export dialog (js/export.js) keeps the route on the
// server and gets back a short link, https://r.runthe.uk/<id>, which chat
// apps show with a picture of the route. Opening it comes back to the app
// as /#s=<id>, and openShared puts the route in loop mode's route viewer.
// Signed in, the links are listed on the Shared links page (links/,
// js/links.js) to delete; signed out, a link lasts a year after it was
// last opened.

import { SHARE_BASE } from "./api.js";

const auth = (token) => (token ? { Authorization: `Bearer ${token}` } : {});

// An error with the server's answer, or none if it couldn't be reached.
async function failure(res) {
  const err = new Error(res ? `Share request failed (${res.status})` : "Couldn't reach the server");
  err.status = res?.status ?? 0;
  return err;
}

async function call(method, path, { token = null, body } = {}) {
  let res;
  try {
    res = await fetch(`${SHARE_BASE}${path}`, {
      method,
      headers: { ...auth(token), ...(body && { "Content-Type": "application/json" }) },
      ...(body && { body: JSON.stringify(body) }),
    });
  } catch {
    throw await failure(null);
  }
  if (!res.ok) throw await failure(res);
  return res.status === 204 ? null : res.json();
}

// The signed-in person's links, newest first: [{ id, url, image, title,
// kind, distance, created }].
export async function listShares(token) {
  return (await call("GET", "/shares", { token })).shares;
}
export const deleteShare = (token, id) => call("DELETE", `/shares/${id}`, { token });
// All of them, when they delete their account.
export const deleteAllShares = (token) => call("DELETE", "/shares", { token });

// A shared route, as it was kept (storedRoute in js/account.js, plus place).
export const fetchShared = (id) => call("GET", `/share/${id}`);

// account: from createAccount, for who's signed in and how routes are kept.
export function createShare({ account }) {
  // who + line → the request under way, so a double tap asks once. Made
  // links aren't remembered after that: one may be deleted meanwhile (on
  // the Shared links page in another tab), and asking again is cheap, as
  // the server gives the same person the same link for the same route.
  const making = new Map();

  // Keeps route ({ raw, distance, kind?, shape?, info?, climb?, elevation?,
  // elevationStep? }, as favourites have them) and returns its link.
  // place: the start's area name, for the preview.
  async function make(route, place = "") {
    const data = account.storedRoute(route);
    const key = `${account.uid() ?? ""} ${data.line}`;
    if (!making.has(key)) {
      const job = account.idToken().then((token) => call("POST", "/share", { token, body: { ...data, ...(place && { place }) } }));
      making.set(key, job);
      const done = () => making.delete(key);
      job.then(done, done);
    }
    return making.get(key);
  }

  // The link in the address (#s=<id>), if any, taken out of it.
  function linkInAddress() {
    const m = location.hash.match(/^#s=([0-9A-Za-z]{8,12})$/);
    if (m) history.replaceState(history.state, "", location.pathname + location.search);
    return m?.[1] ?? null;
  }

  // Opens a shared route in loop mode's route viewer (app: createLoopMode's).
  async function openShared(id, app) {
    try {
      const kept = await fetchShared(id);
      const route = account.viewerRoute(kept);
      if (kept.place) account.rememberPlace([route.start[1], route.start[0]], kept.place);
      await app.showRoutes([route], { start: route.start });
    } catch (err) {
      console.error(err);
      app.toast(err.status === 410 ? "The person who shared this route has deleted its link."
        : err.status === 404 ? "This link has expired, so its route can't be shown."
        : "Couldn't open the shared route. Check your connection and try again.");
    }
  }

  return { make, linkInAddress, openShared };
}
