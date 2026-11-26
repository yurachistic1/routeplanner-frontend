// Moving a point on the map by hand (built 2026-11-26 for A to B's points;
// the Edit mode will move points the same way). UI.md "Moving a
// point". Touch screens: press and hold the point (it grows, the phone
// buzzes), then drag; let go without moving instead and its menu opens
// (2026-11-26: removing a point). Before the hold takes, the touch is the
// map's, so a swipe that starts on the point still pans. Mouse: drag it
// straight away; a click is still a click; a right-click opens its menu.
// While a point is dragged the map stays put, except near the edge of the
// part of it you can see, where it moves along so you can drag further.
// On touch screens the point sits above the finger, so it can be seen.

const HOLD_MS = 400; // a touch held this long without moving takes the point
const SLOP_PX = 8; // a touch that moves further than this first is panning the map; once held, it drags
const MOUSE_SLOP_PX = 3; // a mouse moved this far with its button down drags (less is a click)
const LIFT_PX = 44; // on touch screens the point sits this far above the finger
const LIFT_MS = 120; // and rises there over this long
// Nearer the edge of the room than this, the map moves along; at most a
// fifth of the room's height or width, so a short room (a small phone with
// A to B's panel open leaves ~135 px) keeps a still middle.
const EDGE_PX = 48;
const PAN_PX_S = 900; // this fast at the edge (and past it)
const ARM_PX = 16; // only once the finger or mouse has moved this far: a point held near an edge doesn't set the map moving
const INSET_PX = 12; // the point stays this far inside the room
const TOUCH_HANDLERS = ["dragPan", "touchZoomRotate", "touchPitch"]; // the map's own touch gestures, off while a point is held

/**
 * createPointDrag(map, { pick, room, grab, start, move, end, menu }) lets
 * one point at a time be moved. Returns { cancel() }: puts a drag in
 * progress back.
 *   pick(node): the element of the point that can be dragged from node
 *     (where a touch or press began; a marker's element), or null
 *   room(): { left, top, right, bottom }, px in the map's container: the
 *     part of the map not under the top bar, the panel or the buttons
 *   grab(el, on): a touch's hold has taken the point (on), or let it go
 *     without dragging (off)
 *   start(el): the point is being dragged (el: as pick gave it)
 *   move(lngLat, point): it's over lngLat ([lon, lat]), at point ({x, y},
 *     px in the map's container), lifted and kept inside the room
 *   end(lngLat): let go there; end(null): put back (cancelled, Esc)
 *   menu(el, mouse): held and let go without moving (touch), or
 *     right-clicked (mouse: true)
 */
export function createPointDrag(map, { pick, room, grab, start, move, end, menu }) {
  let g = null; // the gesture: pointer, where it started and is now, held (touch), and once dragging, the rest
  let heldAt = -1e9; // when a touch last took a point (the browser's own long-press menu comes after)
  const container = map.getCanvasContainer();
  const mine = (e) => g && (g.touch ? e.pointerId === g.id : e.pointerType !== "touch");
  const begin = (e, touch) => ({ id: e.pointerId, touch, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, on: false, lift: 0, armed: false, off: [] });

  // Touch: a hold. A second finger meanwhile is a pinch, not a hold.
  container.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch") return;
    if (g) return g.on ? undefined : abandon();
    const el = pick(e.target);
    if (!el) return;
    g = begin(e, true);
    g.el = el;
    g.timer = setTimeout(hold, HOLD_MS);
  });
  // Mouse (and pen): no panning the map from the point (MapLibre's own
  // way to stop it: preventDefault on its mousedown).
  map.on("mousedown", (e) => {
    const ev = e.originalEvent;
    if (g || ev.button !== 0) return;
    const el = pick(ev.target);
    if (!el) return;
    e.preventDefault();
    g = begin(ev, false);
    g.el = el;
  });
  addEventListener("pointermove", (e) => {
    if (!mine(e)) return;
    g.x = e.clientX;
    g.y = e.clientY;
    if (g.on) return; // the frame loop does the rest
    if (!g.touch) {
      if (Math.hypot(g.x - g.x0, g.y - g.y0) >= MOUSE_SLOP_PX) take();
    } else if (g.held) {
      if (Math.hypot(g.x - g.hx, g.y - g.hy) > SLOP_PX) take(); // held, now moving: dragging
    } else if (Math.hypot(g.x - g.x0, g.y - g.y0) > SLOP_PX) {
      abandon(); // moved before the hold took: the map's
    }
  });
  addEventListener("pointerup", (e) => {
    if (!mine(e)) return;
    if (g.on) finish(true);
    else if (g.held) letGo(true);
    else abandon();
  });
  addEventListener("pointercancel", (e) => {
    if (!mine(e)) return;
    if (g.on) finish(false);
    else if (g.held) letGo(false);
    else abandon();
  });
  addEventListener("keydown", (e) => { if (g?.on && e.key === "Escape") finish(false); });
  addEventListener("blur", () => { if (g?.on) finish(false); else if (g?.held) letGo(false); });
  // A right-click opens the point's menu; a long hold may ask for the
  // browser's menu, which it doesn't get.
  container.addEventListener("contextmenu", (e) => {
    if (g || performance.now() - heldAt < 1500) return e.preventDefault();
    if (e.pointerType === "touch") return;
    const el = pick(e.target);
    if (!el) return;
    e.preventDefault();
    menu(el, true);
  });

  const restore = (was) => { for (const k of was.off) map[k].enable(); };
  function abandon() {
    clearTimeout(g.timer);
    restore(g);
    g = null;
  }
  // The hold has taken the point: it's the finger's now, not the map's.
  function hold() {
    g.held = true;
    g.hx = g.x;
    g.hy = g.y;
    heldAt = performance.now();
    for (const k of TOUCH_HANDLERS) {
      if (map[k]?.isEnabled()) { map[k].disable(); g.off.push(k); }
    }
    navigator.vibrate?.(12);
    grab(g.el, true);
  }
  // Held, then let go without moving (lifted: not cancelled): its menu.
  function letGo(lifted) {
    const was = g;
    g = null;
    restore(was);
    grab(was.el, false);
    swallowClick(container);
    if (lifted) menu(was.el, false);
  }
  function take() {
    clearTimeout(g.timer);
    g.on = true;
    document.body.classList.add("point-dragging");
    start(g.el);
    g.t = performance.now();
    step(0);
    g.frame = requestAnimationFrame(frame);
  }
  function frame(t) {
    if (!g?.on) return;
    const dt = Math.min(50, t - g.t);
    g.t = t;
    step(dt);
    g.frame = requestAnimationFrame(frame);
  }
  // Where the point is now: under the mouse, or lifted above the finger;
  // near the room's edge the map moves along (faster the nearer, and
  // past it), and the point stays inside.
  function step(dt) {
    if (g.touch) g.lift = Math.min(LIFT_PX, g.lift + (LIFT_PX * dt) / LIFT_MS);
    if (!g.armed) g.armed = Math.hypot(g.x - g.x0, g.y - g.y0) > ARM_PX;
    const box = container.getBoundingClientRect(), r = room();
    const x = g.x - box.left, y = g.y - box.top - g.lift;
    let panned = false;
    if (g.armed && dt) {
      const ex = Math.min(EDGE_PX, (r.right - r.left) / 5), ey = Math.min(EDGE_PX, (r.bottom - r.top) / 5);
      const push = (d, e) => Math.max(0, Math.min(1, (e - d) / e));
      const s = (PAN_PX_S * dt) / 1000;
      const dx = (push(r.right - x, ex) - push(x - r.left, ex)) * s, dy = (push(r.bottom - y, ey) - push(y - r.top, ey)) * s;
      if (dx || dy) {
        map.panBy([dx, dy], { animate: false });
        panned = true;
      }
    }
    const px = Math.max(r.left + INSET_PX, Math.min(r.right - INSET_PX, x));
    const py = Math.max(r.top + INSET_PX, Math.min(r.bottom - INSET_PX, y));
    if (!panned && g.px === px && g.py === py) return; // nothing new
    g.px = px;
    g.py = py;
    const ll = map.unproject([px, py]);
    g.at = [ll.lng, ll.lat];
    move(g.at, { x: px, y: py });
  }
  function finish(ok) {
    if (ok) step(0); // where it was let go
    const was = g;
    g = null;
    cancelAnimationFrame(was.frame);
    restore(was);
    document.body.classList.remove("point-dragging");
    swallowClick(container);
    end(ok ? was.at : null);
  }
  return {
    cancel: () => {
      if (g?.on) finish(false);
      else if (g?.held) letGo(false);
      else if (g) abandon();
    },
  };
}

// The click a drag or a long press may end with isn't a tap on the map.
// Only on the map (container): a quick tap on a button, or on the menu the
// press opened, is a tap.
function swallowClick(container) {
  const stop = (e) => {
    if (!container.contains(e.target) || e.target.closest?.(".map-menu")) return;
    e.stopPropagation();
    e.preventDefault();
    removeEventListener("click", stop, { capture: true });
  };
  addEventListener("click", stop, { capture: true });
  setTimeout(() => removeEventListener("click", stop, { capture: true }), 400);
}

/**
 * createLongPress(map, { test, press }): a press and hold somewhere on the
 * map (touch: HOLD_MS without moving, the phone buzzing where it can), or
 * a right-click (mouse), where test allows it (2026-11-26: A to B's menu on
 * a leg). Not on a point (createPointDrag holds those). Before the hold
 * takes, the touch is the map's, as with points; after, the finger lifting
 * isn't a tap.
 *   test(point): whether a press at point ({x, y}, px in the map's
 *     container) means anything
 *   press(point, mouse): it does, there (mouse: a right-click)
 */
export function createLongPress(map, { test, press }) {
  let g = null; // the touch: pointer, where it started and is now, whether the hold took
  let tookAt = -1e9; // when one last took (the browser's own long-press menu comes after)
  const container = map.getCanvasContainer();
  const at = (x, y) => { const box = container.getBoundingClientRect(); return { x: x - box.left, y: y - box.top }; };
  container.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch") return;
    if (g) return cancel(); // a second finger
    if (e.target.closest?.(".wp-drag, .map-menu") || !test(at(e.clientX, e.clientY))) return;
    g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, timer: setTimeout(take, HOLD_MS) };
  });
  addEventListener("pointermove", (e) => {
    if (!g || e.pointerId !== g.id || g.took) return;
    g.x = e.clientX;
    g.y = e.clientY;
    if (Math.hypot(g.x - g.x0, g.y - g.y0) > SLOP_PX) cancel();
  });
  const up = (e) => {
    if (!g || e.pointerId !== g.id) return;
    if (g.took) swallowClick(container);
    cancel();
  };
  addEventListener("pointerup", up);
  addEventListener("pointercancel", up);
  function cancel() {
    clearTimeout(g?.timer);
    g = null;
  }
  function take() {
    const p = at(g.x, g.y);
    g.took = true;
    tookAt = performance.now();
    if (!test(p)) return;
    navigator.vibrate?.(12);
    press(p, false);
  }
  // Mouse: a right-click, instead of the browser's menu. A touch's long
  // press can bring the browser's menu too: not after a hold took.
  container.addEventListener("contextmenu", (e) => { if (g || performance.now() - tookAt < 1500) e.preventDefault(); });
  map.on("contextmenu", (e) => {
    const ev = e.originalEvent;
    if (ev.pointerType === "touch" || g || performance.now() - tookAt < 1500 || ev.target.closest?.(".wp-drag, .map-menu")) return;
    if (!test(e.point)) return;
    ev.preventDefault();
    press({ x: e.point.x, y: e.point.y }, true);
  });
}
