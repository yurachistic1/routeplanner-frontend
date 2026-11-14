// The backend, shared by every mode that asks it for routes.

// Served from this machine or another device on the home network (e.g. a
// phone opening http://192.168.x.x:5173): use the backend on the same host.
const host = location.hostname;
const isLocal = ["localhost", "127.0.0.1"].includes(host)
  || /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) // private network IPs
  || host.endsWith(".local");

export const API_BASE = isLocal
  ? `http://${host}:8080`
  : host === "staging.runthe.uk"
    ? "https://routes-staging-1068090158958.europe-west2.run.app"
    : "https://routes-1068090158958.europe-west2.run.app";

// Wake the server while the user chooses their route. If this fails, the
// route request will show the error.
fetch(`${API_BASE}/warm`).catch(() => {});
