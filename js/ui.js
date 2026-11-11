// Small pieces of page UI shared by every mode.

export const $ = (id) => document.getElementById(id);

// A short message under the top bar (#toast), gone after ms.
let toastTimer;
export function toast(msg, ms = 3800) {
  const el = $("toast");
  if (!el) return console.log(msg);
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}
