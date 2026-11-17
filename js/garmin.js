// Garmin Connect, in the account menu: connect, see the status, disconnect.
// The Garmin service (routeplanner-backend cmd/garmin) does the OAuth work
// and keeps the tokens; this only talks to it with the Firebase sign-in
// token. Design: ROADMAP Phase 6, mockups in designs/garmin-connect.html.
//
// Page elements: #garmin (the Watch section, hidden where there's no
// service), #garmin-note, #garmin-connect, #garmin-disconnect, #garmin-msg,
// #signin-text.

// Only staging has a Garmin service so far (live waits for Garmin's notice
// period, until 2026-12-17). The local frontend uses staging's: it's allowed
// back to http://localhost:5173 only, so not from other devices.
const SERVICES = {
  "https://staging.runthe.uk": "https://garmin-staging-1068090158958.europe-west2.run.app",
  "http://localhost:5173": "https://garmin-staging-1068090158958.europe-west2.run.app",
};
export const GARMIN_BASE = SERVICES[location.origin] ?? null;

const NOTE = "Send routes to your watch";
// What ?garmin= means when the service sends people back.
const RESULTS = {
  declined: "Garmin wasn't connected. Try again, and allow access on Garmin's page.",
  expired: "That took too long. Try connecting again.",
  error: "Couldn't connect Garmin. Try again.",
};

const $ = (id) => document.getElementById(id);

// idToken: () => Promise<string>, the signed-in user's Firebase ID token.
export function createGarmin({ idToken }) {
  const section = $("garmin");
  const note = $("garmin-note");
  const connectBtn = $("garmin-connect");
  const disconnectBtn = $("garmin-disconnect");
  const msg = $("garmin-msg");
  let connected = false;
  let checked = false; // the status has been fetched for this user

  // Coming back from Garmin: read and remove ?garmin= at once, so a reload
  // doesn't repeat it.
  const params = new URLSearchParams(location.search);
  let returned = params.get("garmin");
  if (returned) {
    params.delete("garmin");
    const q = params.toString();
    history.replaceState(null, "", location.pathname + (q ? `?${q}` : "") + location.hash);
  }

  if (GARMIN_BASE) {
    section.hidden = false;
    $("signin-text").textContent = "Save the routes you love and send them to your Garmin watch. Planning routes never needs an account.";
  }

  async function call(method, path, body) {
    const res = await fetch(GARMIN_BASE + path, {
      method,
      headers: {
        Authorization: `Bearer ${await idToken()}`,
        ...(body && { "Content-Type": "application/json" }),
      },
      body: body && JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Garmin service: ${res.status}`);
    return res.json();
  }

  function show({ connected: on, canSendCourses = true }) {
    connected = on;
    checked = true;
    note.textContent = on ? "Connected" : NOTE;
    note.classList.toggle("on", on);
    connectBtn.hidden = on;
    disconnectBtn.hidden = !on;
    if (on && !canSendCourses) {
      say("Course uploads weren't allowed. Disconnect, connect again and allow them on Garmin's page.");
    }
  }
  const say = (text) => { msg.textContent = text; };

  function setBusy(button, busy, label) {
    button.setAttribute("aria-busy", busy);
    button.innerHTML = busy ? `<span class="spin" aria-hidden="true"></span>${label}` : label;
  }

  async function refresh() {
    if (!GARMIN_BASE) return;
    try {
      show(await call("GET", "/status"));
    } catch (err) {
      console.error(err);
      checked = false;
      say("Couldn't check Garmin. Check your connection.");
    }
  }

  async function connect() {
    if (connectBtn.getAttribute("aria-busy") === "true") return;
    say("");
    setBusy(connectBtn, true, "Opening Garmin…");
    try {
      const { url } = await call("POST", "/connect", { returnTo: location.origin + location.pathname });
      location.assign(url);
    } catch (err) {
      console.error(err);
      setBusy(connectBtn, false, "Connect");
      say("Couldn't start connecting. Check your connection and try again.");
    }
  }

  async function disconnect() {
    if (disconnectBtn.getAttribute("aria-busy") === "true") return;
    say("");
    setBusy(disconnectBtn, true, "Disconnecting…");
    try {
      show(await call("POST", "/disconnect"));
    } catch (err) {
      console.error(err);
      say("Couldn't disconnect Garmin. Try again.");
    } finally {
      setBusy(disconnectBtn, false, "Disconnect");
    }
  }

  connectBtn.addEventListener("click", connect);
  disconnectBtn.addEventListener("click", disconnect);
  // Back from Garmin's page with the browser's back button: the page may be
  // restored as it was left, mid-"Opening Garmin…".
  addEventListener("pageshow", (e) => {
    if (e.persisted) setBusy(connectBtn, false, "Connect");
  });

  return {
    enabled: !!GARMIN_BASE,

    // Called when someone signs in or out. Returns true if they've just come
    // back from Garmin, so the account menu should open to show how it went.
    async userChanged(signedIn) {
      checked = false;
      connected = false;
      say("");
      if (!signedIn || !GARMIN_BASE) return false;
      await refresh();
      if (!returned) return false;
      if (RESULTS[returned]) say(RESULTS[returned]);
      returned = null;
      return true;
    },

    // When the account menu opens, check again if the last check failed,
    // unless there's a message showing (e.g. how connecting went).
    opened() {
      if (GARMIN_BASE && !checked && !msg.textContent) refresh();
    },

    // Before deleting the account: Garmin requires telling them, as with
    // Disconnect. Throws if that can't be done, so nothing is deleted.
    async beforeDelete() {
      if (!GARMIN_BASE) return;
      const { connected: still } = await call("POST", "/disconnect");
      if (still) throw new Error("Garmin still connected");
      connected = false;
    },

    get connected() { return connected; },
  };
}
