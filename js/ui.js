// Small pieces of page UI shared by every mode.

export const $ = (id) => document.getElementById(id);

// A short message under the top bar (#toast), gone after ms; on touch
// screens it can be swiped away.
let toastTimer, toastSwipe;
export function toast(msg, ms = 3800) {
  const el = $("toast");
  if (!el) return console.log(msg);
  const hide = () => el.classList.remove("show");
  toastSwipe ??= swipeAway(el, {
    edge: "top",
    onStart: () => clearTimeout(toastTimer),
    onBack: () => { toastTimer = setTimeout(hide, 2000); },
    onGone: hide,
  });
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hide, ms);
}

// Takes the toast away now (a dragged point back under the leg limit).
export function hideToast() {
  clearTimeout(toastTimer);
  $("toast")?.classList.remove("show");
}

// Lets a message (the toast, the Undo bar) be swiped away on touch screens
// (the user, 2026-11-21): sideways, or towards the edge it sits at (edge:
// "top" or "bottom"). It follows the finger; past a third of its width, or
// flicked, it slides off and onGone() hides it, else it springs back
// (onBack). onStart: a finger has taken it (to hold its timer). A tap
// isn't a swipe, so buttons on it still work. Mice and pens are left out.
export function swipeAway(el, { edge, onStart, onBack, onGone }) {
  const SLOP = 8; // px before a touch counts as a swipe
  const calm = matchMedia("(prefers-reduced-motion: reduce)");
  let s = null; // the touch: where it started, and whether it's a swipe yet
  const offset = (e) => {
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    const out = edge === "top" ? Math.min(dy, 0) : Math.max(dy, 0); // only towards its edge
    return Math.abs(dx) >= Math.abs(out) ? [dx, 0] : [0, out];
  };
  const settle = (styles, then) => {
    el.style.transition = calm.matches ? "none" : "transform .18s ease-out, opacity .18s ease-out";
    Object.assign(el.style, styles);
    setTimeout(() => {
      then?.();
      el.style.transition = "none"; // back to its own look without animating
      el.style.transform = el.style.opacity = "";
      void el.offsetWidth;
      el.style.transition = "";
    }, calm.matches ? 0 : 190);
  };
  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch" || s) return;
    s = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, moving: false };
  });
  el.addEventListener("pointermove", (e) => {
    if (!s || e.pointerId !== s.id) return;
    const [dx, dy] = offset(e);
    if (!s.moving) {
      if (Math.hypot(dx, dy) < SLOP) return;
      s.moving = true;
      try { el.setPointerCapture(e.pointerId); } catch {} // the finger may have lifted already
      el.style.transition = "none";
      onStart?.();
    }
    const far = Math.abs(dx) / el.offsetWidth + Math.abs(dy) / el.offsetHeight / 2;
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    el.style.opacity = String(Math.max(0.2, 1 - far));
  });
  const end = (e) => {
    if (!s || e.pointerId !== s.id) return;
    const was = s, [dx, dy] = offset(e);
    s = null;
    if (!was.moving) return;
    const speed = Math.hypot(dx, dy) / Math.max(1, performance.now() - was.t);
    const away = Math.abs(dx) > el.offsetWidth / 3 || Math.abs(dy) > el.offsetHeight || (e.type === "pointerup" && speed > 0.6);
    if (!away) return settle({ transform: "", opacity: "" }, onBack);
    const to = dx ? `translateX(${Math.sign(dx) * (el.offsetWidth + 40)}px)` : `translateY(${Math.sign(dy) * (el.offsetHeight + 40)}px)`;
    settle({ transform: to, opacity: "0" }, onGone);
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
  return true;
}
