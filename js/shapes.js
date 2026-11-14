// Ways of making your own shape for GPS art: finding an icon by name, and
// drawing one. Both end in the same thing, the strokes the server takes
// (see ArtRequest in the backend): lines of [x, y] points, y down.
//
// The icons are a hand-picked set: mostly Lucide's, reworked for drawing
// on streets (corners sharpened, specks dropped), plus a few of our own.
// They are stored already as strokes in assets/icons.json, built by
// ops/build-icons.py (licence in assets/icons-LICENSE.txt). The file is
// fetched the first time the picker opens.

import { $, toast } from "./ui.js";

const far = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Fewer points along a line, none moved more than tol from it
// (Douglas-Peucker).
export function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const todo = [[0, pts.length - 1]];
  while (todo.length) {
    const [a, b] = todo.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const len = Math.hypot(bx - ax, by - ay);
    let worst = -1, at = -1;
    for (let i = a + 1; i < b; i++) {
      const d = len === 0 ? far(pts[i], pts[a])
        : Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len;
      if (d > worst) { worst = d; at = i; }
    }
    if (worst > tol) { keep[at] = true; todo.push([a, at], [at, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const closeButtons = (dialog) => {
  for (const b of dialog.querySelectorAll("[data-close]")) b.addEventListener("click", () => dialog.close());
  // a tap on the dimmed page behind closes it too
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
};

// ----- finding an icon -----
/** createIconPicker(onPick) returns open(). onPick(name, strokes) gets the icon chosen. */
export function createIconPicker(onPick) {
  const dialog = $("icon-dialog"), input = $("icon-search"), grid = $("icon-grid"), note = $("icon-count");
  let icons = null; // [[name, words, strokes], ...]
  closeButtons(dialog);

  // Every icon, or with something typed the ones whose name or words match.
  function matches(q) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return icons;
    const found = [];
    for (const icon of icons) {
      const [name, tags] = icon;
      if (!words.every((w) => name.includes(w) || tags.includes(w))) continue;
      const w = words[0];
      const rank = name === w ? 0 : name.startsWith(w) ? 1 : name.includes(w) ? 2 : 3;
      found.push([rank, name.length, icon]);
    }
    return found.sort((a, b) => a[0] - b[0] || a[1] - b[1] || (a[2][0] < b[2][0] ? -1 : 1)).map((f) => f[2]);
  }
  function show() {
    const found = matches(input.value);
    grid.innerHTML = found.map(([name, , strokes]) =>
      `<button class="icon-tile" data-icon="${name}" aria-label="${name}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${
          strokes.map((s) => `<polyline points="${s.map((p) => p.join(",")).join(" ")}"/>`).join("")}</svg>
        <span>${name.replaceAll("-", " ")}</span>
      </button>`).join("");
    grid.scrollTop = 0;
    note.textContent = found.length ? "" : "Nothing by that name. Try another word, or draw it yourself.";
  }
  input.addEventListener("input", show);
  grid.addEventListener("click", (e) => {
    const b = e.target.closest("[data-icon]");
    if (!b) return;
    const icon = icons.find((i) => i[0] === b.dataset.icon);
    dialog.close();
    onPick(icon[0].replaceAll("-", " "), icon[2]);
  });

  return async function open() {
    if (!icons) {
      try {
        icons = await (await fetch("./assets/icons.json")).json();
      } catch {
        return toast("Couldn't load the shapes. Check your connection and try again.");
      }
    }
    input.value = "";
    show();
    dialog.showModal();
    // showModal focuses the search box by itself. On touch screens that
    // brings up the keyboard over the icons, so let people browse first.
    if (matchMedia("(hover: hover)").matches) input.focus();
    else input.blur();
  };
}

// ----- drawing one -----
// A square pad drawn on with a finger or mouse. Each stroke is tidied when
// the finger lifts: shakes smoothed out, a stroke that nearly comes back to
// its start closed, and an end that nearly touches another stroke moved
// onto it, so the shape's pieces join the way they were meant to.
const PAD = 300;       // the pad's own units, whatever its size on screen
const CLOSE = 0.07 * PAD; // how near its start a stroke's end closes it
const JOIN = 0.045 * PAD; // how near another stroke an end joins it

/** createDrawPad(onPick) returns open(). onPick(strokes) gets the drawing. */
export function createDrawPad(onPick) {
  const dialog = $("draw-dialog"), pad = $("draw-pad");
  let strokes = [];
  let line = null;
  closeButtons(dialog);

  const point = (e) => {
    const box = pad.getBoundingClientRect();
    const clamp = (v) => Math.max(0, Math.min(PAD, v));
    return [clamp(((e.clientX - box.left) / box.width) * PAD), clamp(((e.clientY - box.top) / box.height) * PAD)];
  };
  const draw = () => {
    pad.innerHTML = [...strokes, ...(line ? [line] : [])]
      .map((s) => `<polyline points="${s.map((p) => p.map((v) => v.toFixed(1)).join(",")).join(" ")}"/>`).join("");
  };
  // the nearest point on any finished stroke
  function nearest(p) {
    let best = null, bestD = JOIN;
    for (const s of strokes) {
      for (let i = 0; i + 1 < s.length; i++) {
        const [ax, ay] = s[i], [bx, by] = s[i + 1];
        const l2 = (bx - ax) ** 2 + (by - ay) ** 2;
        const t = l2 ? Math.max(0, Math.min(1, ((p[0] - ax) * (bx - ax) + (p[1] - ay) * (by - ay)) / l2)) : 0;
        const q = [ax + (bx - ax) * t, ay + (by - ay) * t];
        if (far(p, q) < bestD) { bestD = far(p, q); best = q; }
      }
    }
    return best;
  }
  function tidy(raw) {
    // smooth: each point becomes the average of itself and two each side
    let s = raw.map((_, i) => {
      if (i === 0 || i === raw.length - 1) return raw[i];
      const near = raw.slice(Math.max(0, i - 2), i + 3);
      return [near.reduce((t, p) => t + p[0], 0) / near.length, near.reduce((t, p) => t + p[1], 0) / near.length];
    });
    s = simplify(s, 0.008 * PAD);
    let length = 0;
    for (let i = 1; i < s.length; i++) length += far(s[i - 1], s[i]);
    if (length < 0.05 * PAD) return null; // a dab, not a line
    if (length > 3 * CLOSE && far(s[0], s.at(-1)) < CLOSE) {
      s[s.length - 1] = s[0];
    } else {
      for (const end of [0, s.length - 1]) s[end] = nearest(s[end]) ?? s[end];
    }
    return s;
  }

  pad.addEventListener("pointerdown", (e) => {
    pad.setPointerCapture(e.pointerId);
    line = [point(e)];
    e.preventDefault();
  });
  pad.addEventListener("pointermove", (e) => {
    if (!line) return;
    const p = point(e);
    if (far(p, line.at(-1)) > 1.5) { line.push(p); draw(); }
  });
  const lift = () => {
    if (!line) return;
    const s = tidy(line);
    line = null;
    if (s) strokes.push(s);
    draw();
  };
  pad.addEventListener("pointerup", lift);
  pad.addEventListener("pointercancel", lift);

  $("draw-undo").addEventListener("click", () => { strokes.pop(); draw(); });
  $("draw-clear").addEventListener("click", () => { strokes = []; draw(); });
  $("draw-use").addEventListener("click", () => {
    if (!strokes.length) return toast("Draw a shape first");
    dialog.close();
    onPick(strokes.map((s) => s.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10])));
  });

  return function open() {
    draw();
    dialog.showModal();
  };
}
