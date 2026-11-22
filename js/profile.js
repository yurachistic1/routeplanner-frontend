// Elevation profile: a small chart of a route's heights, in route info.
// Built to be read, not to look clever: round-number gridlines labelled
// in metres, distance along the bottom, the start as the map shows it
// (pink), and the route's lime line over a faint fill. A flat route stays
// flat: the height axis always spans at least MIN_SPAN metres.
//
// The line is smoothed over SMOOTH of the route's length, a few pixels,
// so it shows hills rather than the data's small wiggles; the climb given
// is the backend's, from its own heights.
//
// Routes found together share one scale (sharedScale), so their charts
// compare at a glance: distance runs to the distance asked for, or the
// longest route if further, with a dashed line at the distance asked for
// (a short route's line stops before it, a long one's runs past); height
// runs from the lowest to the highest of them all. A favourite on its
// own gets a scale of its own.
//
// Dragging along it (or hovering, or the arrow keys) reads out the
// distance and height there, in the header, and calls onPoint with how
// far along the route that is (0 to 1), so the map can mark the spot;
// null when it stops.
//
// The heights come from the backend: route.elevation, evenly spaced
// route.elevationStep metres apart from the start round to the start, and
// route.climb, in metres (see the backend's ring/elevation.go). A to B
// works its climb out here (climbOf), from its legs' heights.
//
// A to B (2026-11-20) adds, all optional: route.closed === false for a
// route that doesn't end where it starts (no smoothing round the end),
// route.descent (metres, shown beside the climb), and route.marks,
// [{ m, kind: "via" | "finish" }]: the waypoints, metres from the start,
// drawn on the chart like on the map.

const MIN_SPAN = 10; // metres
const SMOOTH = 0.015; // of the route's length, at least SMOOTH_MIN metres
const SMOOTH_MIN = 100;
const HEIGHT_DEFAULT = 112; // the chart's height, px, if its CSS box doesn't say (it's shorter on short screens)
const MARKS = 5; // most gaps between distance marks
const CHAR = 8; // width of a 13px JetBrains Mono digit, roughly, px

// Round steps for gridlines (metres) and distance marks (km).
const Y_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
const X_STEPS = [0.5, 1, 2, 2.5, 5, 10, 20];

export const hasProfile = (r) => Array.isArray(r?.elevation) && r.elevation.length > 1 && r.elevationStep > 0;

// Climb and descent counted the way the backend counts a loop's (ring
// Smooth and Climb, chosen against the Environment Agency's LIDAR on
// 2026-11-18), for routes put together here, as A to B's are from its
// legs: heights every few metres averaged over SMOOTH_WINDOW_M, then only
// rises and falls of more than CLIMB_STEP_M count, as a watch's barometer
// is read.
export const SMOOTH_WINDOW_M = 20;
export const CLIMB_STEP_M = 2;

// A profile cut down to at most `most` steps for saving (favourites keep
// about 200 heights, as loops come; firestore.rules allows 400), each the
// average of the heights over its stretch, as the backend makes a loop's
// (addElevation). Returns { elevation, elevationStep }.
export const SAVED_HEIGHTS = 200;
export function shrinkProfile(elevation, step, most = SAVED_HEIGHTS) {
  const n = elevation.length - 1;
  if (n <= most) return { elevation, elevationStep: step };
  const half = n / most / 2, out = [];
  for (let i = 0; i <= most; i++) {
    const at = (i * n) / most;
    const lo = Math.max(Math.ceil(at - half), 0), hi = Math.min(Math.floor(at + half), n);
    let sum = 0;
    for (let k = lo; k <= hi; k++) sum += elevation[k];
    out.push(Math.round((sum / (hi - lo + 1)) * 10) / 10);
  }
  return { elevation: out, elevationStep: (step * n) / most };
}

// Heights taken every step metres, averaged over window metres; the
// average is over less near the ends (a route that isn't a loop).
export function smoothHeights(hs, step, window = SMOOTH_WINDOW_M) {
  const m = hs.length;
  let half = step > 0 ? Math.round(window / 2 / step) : 0;
  if (half === 0 || m < 3) return hs.slice();
  half = Math.min(half, Math.floor((m - 1) / 2));
  const sums = [0];
  for (const h of hs) sums.push(sums.at(-1) + h);
  return hs.map((_, i) => {
    const lo = Math.max(i - half, 0), hi = Math.min(i + half + 1, m);
    return (sums[hi] - sums[lo]) / (hi - lo);
  });
}

// The total rise and fall along heights, counting only rises and falls of
// more than step metres.
export function climbOf(hs, step = CLIMB_STEP_M) {
  let up = 0, down = 0;
  if (!hs.length) return { climb: 0, descent: 0 };
  // until the first rise or fall of more than step, which way it goes
  // isn't known; then ref is the height of the last turn, and ext the
  // highest (going up) or lowest (going down) since
  let dir = 0, high = hs[0], low = hs[0], ref = 0, ext = 0;
  for (const h of hs.slice(1)) {
    if (dir === 0) {
      high = Math.max(high, h);
      low = Math.min(low, h);
      if (h - low > step) [dir, ref, ext] = [1, low, h];
      else if (high - h > step) [dir, ref, ext] = [-1, high, h];
    } else if (dir === 1) {
      if (h > ext) ext = h;
      else if (ext - h > step) { up += ext - ref; [dir, ref, ext] = [-1, ext, h]; }
    } else if (h < ext) {
      ext = h;
    } else if (h - ext > step) {
      down += ref - ext;
      [dir, ref, ext] = [1, ext, h];
    }
  }
  // the stretch still under way, and the last bit back from its end
  const last = hs.at(-1);
  if (dir === 1) { up += ext - ref; down += ext - last; }
  if (dir === -1) { down += ref - ext; up += last - ext; }
  return { climb: up, descent: down };
}

// The heights as drawn: two passes of a moving average (so a triangle),
// wrapping round, as a loop ends where it starts; an open route's (A to B)
// average just stops at its ends. Kept on the route.
function drawn(r) {
  if (r._drawn) return r._drawn;
  const open = r.closed === false;
  const hs = r.elevation, n = open ? hs.length : hs.length - 1; // a loop's last is its first again
  const total = r.elevationStep * (hs.length - 1);
  const half = Math.round(Math.max(SMOOTH * total, SMOOTH_MIN) / 2 / r.elevationStep / 2);
  let cur = hs.slice(0, n);
  for (let pass = 0; pass < 2 && half > 0 && n > 2 * half; pass++) {
    const next = new Array(n);
    if (open) {
      for (let i = 0; i < n; i++) {
        let sum = 0, k = 0;
        for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++, k++) sum += cur[j];
        next[i] = sum / k;
      }
    } else {
      let sum = 0;
      for (let j = -half; j <= half; j++) sum += cur[(j + n) % n];
      for (let i = 0; i < n; i++) {
        next[i] = sum / (2 * half + 1);
        sum += cur[(i + half + 1) % n] - cur[(i - half + n) % n];
      }
    }
    cur = next;
  }
  r._drawn = open ? cur : [...cur, cur[0]];
  return r._drawn;
}

// The height at each of points ([lat, lon], the route's line from start to
// finish), read off route r's profile by how far round the line each is:
// for <ele> in GPX files and Garmin courses. Null if r has no heights.
export function heightsAt(r, points) {
  if (!hasProfile(r) || points.length < 2) return null;
  const along = [0];
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    const dy = (b[0] - a[0]) * 111320, dx = (b[1] - a[1]) * 111320 * Math.cos((a[0] * Math.PI) / 180);
    along.push(along[i - 1] + Math.hypot(dx, dy));
  }
  const total = along.at(-1) || 1;
  const hs = r.elevation, n = hs.length - 1;
  return along.map((d) => {
    const at = (d / total) * n, k = Math.min(Math.floor(at), n - 1);
    return Math.round((hs[k] + (at - k) * (hs[k + 1] - hs[k])) * 10) / 10;
  });
}

// The scale routes found together share: distances up to target (km) or
// the longest route, heights from the lowest to the highest.
export function sharedScale(routes, target) {
  const rs = routes.filter(hasProfile);
  if (!rs.length) return null;
  let lo = Infinity, hi = -Infinity, far = 0;
  for (const r of rs) {
    const hs = drawn(r);
    lo = Math.min(lo, ...hs);
    hi = Math.max(hi, ...hs);
    far = Math.max(far, r.elevationStep * (r.elevation.length - 1));
  }
  return { lo, hi, xMax: Math.max(far, (target ?? 0) * 1000), target: target ?? null };
}

// The scale for heights lo..hi: at most four gridlines, a round step.
function yScale(lo, hi) {
  if (hi - lo < MIN_SPAN) {
    const mid = (lo + hi) / 2;
    lo = mid - MIN_SPAN / 2;
    hi = mid + MIN_SPAN / 2;
  }
  for (const s of Y_STEPS) {
    const a = Math.floor(lo / s) * s, b = Math.ceil(hi / s) * s;
    if ((b - a) / s <= 3) return { min: a, max: b, step: s };
  }
  const s = Y_STEPS.at(-1);
  return { min: Math.floor(lo / s) * s, max: Math.ceil(hi / s) * s, step: s };
}

// "0", "0.5", "2.5", "10": no ".0" on whole kilometres
const kmLabel = (km) => String(Math.round(km * 10) / 10);

// The waypoints on the chart: a dashed line and a dot (dark with a white
// ring, like the via markers on the map) at each via, the finish as a
// white dot with a dark ring.
function marksSVG(marks, hs, step, X, Y, y0, y1) {
  if (!marks?.length) return "";
  const at = (m) => Y(hs[Math.max(0, Math.min(hs.length - 1, Math.round(m / step)))]).toFixed(1);
  return marks.map(({ m, kind }) => {
    const x = X(m).toFixed(1);
    return kind === "finish"
      ? `<circle class="pf-fin" cx="${x}" cy="${at(m)}" r="4.5"/>`
      : `<line class="pf-via" x1="${x}" x2="${x}" y1="${y0}" y2="${y1}"/><circle class="pf-vdot" cx="${x}" cy="${at(m)}" r="3.5"/>`;
  }).join("");
}

// Renders the profile of route r into el (a .profile block with a
// .profile-head and a .profile-chart), or hides it if r has no heights.
// scale is from sharedScale, or none for a scale of r's own.
export function renderProfile(el, r, { onPoint, scale } = {}) {
  if (!el) return;
  el.hidden = !hasProfile(r);
  if (el.hidden) {
    onPoint?.(null);
    return;
  }
  const head = el.querySelector(".profile-value");
  const chart = el.querySelector(".profile-chart");
  const hs = drawn(r);
  const total = r.elevationStep * (hs.length - 1); // metres
  const xMax = scale?.xMax ?? total;
  const target = scale?.target ?? null;
  const climbText = `<b>${Math.round(r.climb ?? 0)}</b> m climb` +
    (r.descent != null ? ` · <b>${Math.round(r.descent)}</b> m descent` : "");
  head.innerHTML = climbText;

  const lo = Math.min(...hs), hi = Math.max(...hs);
  const y = yScale(scale?.lo ?? lo, scale?.hi ?? hi);
  const width = Math.max(chart.clientWidth || el.clientWidth || 300, 200);
  const HEIGHT = chart.clientHeight || HEIGHT_DEFAULT;
  const ticks = [];
  for (let v = y.min; v <= y.max + 1e-9; v += y.step) ticks.push(v);
  const left = Math.max(...ticks.map((v) => String(v).length)) * CHAR + 8;
  const top = 10, bottom = 22, right = 6;
  const pw = width - left - right, ph = HEIGHT - top - bottom;
  const X = (m) => left + (m / xMax) * pw;
  const Y = (h) => top + (1 - (h - y.min) / (y.max - y.min)) * ph;

  // distance marks: as many as fit, about 56 px apart at least, landing
  // on the distance asked for if a round step can
  const km = xMax / 1000;
  const fits = (s) => km / s <= Math.max(2, Math.min(MARKS, Math.floor(pw / 56)));
  const whole = (s) => target && Math.abs(target / s - Math.round(target / s)) < 1e-6;
  const xs = X_STEPS.find((s) => fits(s) && whole(s)) ?? X_STEPS.find(fits) ?? X_STEPS.at(-1);
  const marks = [];
  for (let k = 0; k <= km + 1e-9; k += xs) marks.push(k);

  const pts = hs.map((h, i) => `${X(i * r.elevationStep).toFixed(1)},${Y(h).toFixed(1)}`);
  const line = `M${pts.join("L")}`;
  const area = `${line}L${X(total).toFixed(1)},${top + ph}L${X(0).toFixed(1)},${top + ph}Z`;

  const grid = ticks.map((v) => {
    const yy = Y(v).toFixed(1);
    return `<line class="pf-grid" x1="${left}" x2="${width - right}" y1="${yy}" y2="${yy}"/>` +
      `<text class="pf-y" x="${left - 8}" y="${yy}">${v}</text>`;
  }).join("");
  const xlabels = marks.map((k, i) => {
    const x = X(k * 1000);
    const last = i === marks.length - 1;
    const text = kmLabel(k) + (last ? " km" : "");
    // keep the last label inside the chart
    const anchor = last && x + (text.length * CHAR) / 2 > width ? "end" : "middle";
    return `<text class="pf-x" x="${(anchor === "end" ? width - 1 : x).toFixed(1)}" y="${HEIGHT - 5}" text-anchor="${anchor}">${text}</text>`;
  }).join("");

  chart.innerHTML = `
    <svg width="${width}" height="${HEIGHT}" viewBox="0 0 ${width} ${HEIGHT}" aria-hidden="true">
      <defs><linearGradient id="pf-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="var(--neon)" stop-opacity=".28"/>
        <stop offset="1" stop-color="var(--neon)" stop-opacity=".02"/>
      </linearGradient></defs>
      ${grid}
      <path class="pf-area" d="${area}"/>
      <path class="pf-line" d="${line}"/>
      <line class="pf-base" x1="${left}" x2="${width - right}" y1="${top + ph}" y2="${top + ph}"/>
      ${target ? `<line class="pf-target" x1="${X(target * 1000).toFixed(1)}" x2="${X(target * 1000).toFixed(1)}" y1="${top}" y2="${top + ph}"/>` : ""}
      ${xlabels}
      ${marksSVG(r.marks, hs, r.elevationStep, X, Y, top, top + ph)}
      <circle class="pf-start" cx="${X(0).toFixed(1)}" cy="${Y(hs[0]).toFixed(1)}" r="4.5"/>
      <g class="pf-cursor" visibility="hidden">
        <line class="pf-cursor-line" y1="${top}" y2="${top + ph}"/>
        <circle class="pf-cursor-dot" r="5"/>
      </g>
    </svg>`;

  // ----- reading it out -----
  const svg = chart.querySelector("svg");
  const cursor = svg.querySelector(".pf-cursor");
  const cline = svg.querySelector(".pf-cursor-line");
  const cdot = svg.querySelector(".pf-cursor-dot");
  let at = null; // index of the height shown
  const showAt = (i) => {
    at = Math.max(0, Math.min(hs.length - 1, i));
    const m = at * r.elevationStep;
    const x = X(m).toFixed(1);
    cline.setAttribute("x1", x);
    cline.setAttribute("x2", x);
    cdot.setAttribute("cx", x);
    cdot.setAttribute("cy", Y(hs[at]).toFixed(1));
    cursor.setAttribute("visibility", "visible");
    const text = `${(m / 1000).toFixed(1)} km · ${Math.round(hs[at])} m`;
    head.innerHTML = `<b>${(m / 1000).toFixed(1)}</b> km · <b>${Math.round(hs[at])}</b> m`;
    chart.setAttribute("aria-valuenow", Math.round(m));
    chart.setAttribute("aria-valuetext", text);
    onPoint?.(m / total);
  };
  const hide = () => {
    at = null;
    cursor.setAttribute("visibility", "hidden");
    head.innerHTML = climbText;
    chart.removeAttribute("aria-valuetext");
    onPoint?.(null);
  };
  const fromEvent = (e) => {
    const b = svg.getBoundingClientRect();
    const m = ((e.clientX - b.left - left) / pw) * xMax;
    return Math.round(m / r.elevationStep);
  };
  chart.onpointerdown = (e) => {
    try {
      chart.setPointerCapture(e.pointerId); // keep reading while the finger leaves the chart
    } catch {
      // no such pointer (an event made up by a script): read it anyway
    }
    showAt(fromEvent(e));
  };
  chart.onpointermove = (e) => {
    if (e.pointerType === "mouse" || chart.hasPointerCapture?.(e.pointerId)) showAt(fromEvent(e));
  };
  chart.onpointerup = (e) => {
    if (e.pointerType !== "mouse") hide();
  };
  chart.onpointercancel = hide;
  chart.onpointerleave = (e) => {
    if (e.pointerType === "mouse") hide();
  };
  chart.onblur = hide;
  chart.onkeydown = (e) => {
    const stepBy = Math.max(1, Math.round(hs.length / 50));
    if (e.key === "ArrowRight") showAt((at ?? -stepBy) + stepBy);
    else if (e.key === "ArrowLeft") showAt((at ?? hs.length - 1 + stepBy) - stepBy);
    else if (e.key === "Home") showAt(0);
    else if (e.key === "End") showAt(hs.length - 1);
    else if (e.key === "Escape" && at !== null) hide();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  chart.setAttribute("aria-valuemin", 0);
  chart.setAttribute("aria-valuemax", Math.round(total));
  chart.setAttribute("aria-label",
    `Elevation profile: ${Math.round(r.climb ?? 0)} m of climb${r.descent != null ? `, ${Math.round(r.descent)} m of descent` : ""}, between ${Math.round(lo)} and ${Math.round(hi)} m. Arrow keys read it out.`);
}
