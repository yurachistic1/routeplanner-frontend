// What the map draws at a spot, to say why a tap there can't be routed
// (A to B, 2026-11-21). Routing's own map leaves out the ways it won't
// route on, so it can't name them; the map's vector tiles (OpenMapTiles
// schema, js/mapstyle.js) still have them: what kind of road it is,
// whether it's marked private or closed to walkers, and its name and
// number. Read from the tiles already on screen, so nothing is fetched.
//
// The reasons follow routing's rules (the backend's walkfilter): no
// motorways or trunk roads, main roads without a pavement only to cross,
// nothing private or closed to walkers. The map's data can be a little
// older or newer than routing's, so a way it can't explain gets a general
// reason, with its name.

const SOURCE = "omt";
// transportation features that aren't for walking along at all
const NOT_WAYS = new Set(["rail", "transit", "aerialway", "ferry", "bus_guideway", "busway", "pier", "bridge", "raceway"]);
const MAIN_ROADS = new Set(["primary", "secondary", "tertiary"]);

// The distance in px from p to the segment a-b.
function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
}

// The properties of the line in a layer of the map's tiles nearest the
// screen point p, within px (and passing accept), or null.
function nearest(map, layer, p, px, accept = () => true) {
  // the box round p, in degrees, to pass over far segments cheaply
  const sw = map.unproject([p.x - px, p.y + px]), ne = map.unproject([p.x + px, p.y - px]);
  const out = (a, b) => (a[0] < sw.lng && b[0] < sw.lng) || (a[0] > ne.lng && b[0] > ne.lng) ||
    (a[1] < sw.lat && b[1] < sw.lat) || (a[1] > ne.lat && b[1] > ne.lat);
  let best = null, bestD = px;
  for (const f of map.querySourceFeatures(SOURCE, { sourceLayer: layer })) {
    if (!accept(f.properties)) continue;
    const g = f.geometry;
    const lines = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
    for (const line of lines) {
      for (let i = 1; i < line.length; i++) {
        if (out(line[i - 1], line[i])) continue;
        const d = segDist(p, map.project(line[i - 1]), map.project(line[i]));
        if (d < bestD) { bestD = d; best = f.properties; }
      }
    }
  }
  return best;
}

// The properties of the point in a layer of the map's tiles nearest the
// screen point p, within px, or null.
function nearestPoint(map, layer, p, px) {
  let best = null, bestD = px;
  for (const f of map.querySourceFeatures(SOURCE, { sourceLayer: layer })) {
    if (f.geometry.type !== "Point" || !f.properties.name) continue;
    const q = map.project(f.geometry.coordinates);
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < bestD) { bestD = d; best = f.properties; }
  }
  return best;
}

// Whether ll ([lon, lat]) is in water the map draws.
function inWater(map, [x, y]) {
  const inRing = (ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const inPolygon = (rings) => inRing(rings[0]) && !rings.slice(1).some(inRing);
  return map.querySourceFeatures(SOURCE, { sourceLayer: "water" }).some(({ geometry: g }) =>
    g.type === "Polygon" ? inPolygon(g.coordinates) : g.type === "MultiPolygon" && g.coordinates.some(inPolygon));
}

const NEARBY = "Tap a path or street nearby, or use Freehand.";

/**
 * whyNotHere(map, ll, px, start): what to say about a Pleasant or Shortest
 * tap at ll ([lon, lat]) that landed on nothing routing can use, as one
 * message for the toast: the road or path the map draws within px of it,
 * or the water it's in, and why. start: the tap was for a route's start.
 * Null when the map shows nothing there to explain.
 */
export function whyNotHere(map, ll, px, start) {
  const p = map.project(ll);
  const road = nearest(map, "transportation", p, px, (r) => !NOT_WAYS.has(r.class));
  if (!road) {
    if (!inWater(map, ll)) return null;
    // a river or canal by its line; a lake or the sea by its label's point
    const river = nearest(map, "waterway", p, px * 6, (w) => !!w.name)?.name ?? nearestPoint(map, "water_name", p, px * 12)?.name;
    const what = river ? (/^the /i.test(river) ? river.replace(/^The /, "the ") : `the ${river}`) : "water";
    return `That's ${what}. Pleasant and Shortest follow paths and streets, so a route can't ${start ? "start" : "go"} there. ${NEARBY}`;
  }

  // its name, from the names layer: the same kind of way, a little further
  // allowed, as names are drawn along the middle
  const label = nearest(map, "transportation_name", p, px * 1.5, (n) => n.class === road.class);
  const name = label?.name, ref = label?.ref;
  const cls = String(road.class).replace(/_construction$/, "");
  const noun = cls === "path" ? (road.subclass === "steps" ? "steps" : "path") : cls === "track" ? "track" : "road";
  // "Lewes Road (A22)", "the M25", "Kingsway"; an unnamed way goes by
  // what it is ("That path")
  const full = name && ref ? `${name} (${ref})` : name || (ref ? `the ${ref}` : null);
  const say = (why) => `${why[0].toUpperCase()}${why.slice(1)} ${NEARBY}`;
  const It = full ?? `That ${noun}`;

  if (road.class !== cls) return say(`${It} is still being built on the map, so routing leaves it out.`);
  if (cls === "motorway") return say(`${full ?? "That"} is a motorway, where walking isn't allowed.`);
  if (cls === "trunk") {
    return say(`${full ?? "That"} is a trunk road. Routing leaves trunk roads out, as most have nowhere safe to walk (a pavement mapped beside one is used).`);
  }
  if (road.access === "no") return say(`${It} is marked private on the map, so routing leaves it out.`);
  if (road.foot === "no") return say(`${It} is closed to people on foot on the map, so routing leaves it out.`);
  if (MAIN_ROADS.has(cls)) {
    return say(`${full ?? "That"} is a main road with no pavement on the map, so routes only cross it, never run along it.`);
  }
  return say(`Routing leaves ${full ?? `that ${noun}`} out: on the map it may be private, closed, or not joined up with other paths and streets.`);
}
