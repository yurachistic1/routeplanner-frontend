// Runthe's map: OpenFreeMap's free vector tiles (OpenMapTiles schema, no API
// key), drawn as OpenFreeMap's Bright style draws them, in the app's own
// blue-black, with its own icons (js/mapicons.js) and only the places the
// user picked (2026-11-25; UI.md "The map"). The style is all here: nothing
// but tiles and fonts is fetched, so a change of theirs can't change ours.
//
// Derived from OSM Bright: code © 2024 MapTiler.com & OpenMapTiles
// contributors, © 2014 Mapbox, BSD 3-Clause (assets/osm-bright-LICENSE.txt);
// design CC BY 4.0, credited on the privacy page. The map must show a
// credit for OpenMapTiles (ATTRIBUTION).

const TILES = "https://tiles.openfreemap.org/planet";
const FONTS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";
// Athletics tracks, one point each, made from the OpenStreetMap extract (the
// backend's devtools/tracks), as the tiles have some only as outlines and
// some several times over. Bump v when the file changes.
const TRACKS = new URL("../assets/tracks.json?v=1", import.meta.url).href;

// Credits for the map data, shown by the ⓘ control (see addCredits in map.js).
export const ATTRIBUTION = '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

// The first of the labels: modes draw their routes under it, so labels and
// icons stay readable, and over the arrows of one-way roads, which would
// look like the route's own.
export const FIRST_LABEL = "waterway_line_label";

// Whether a layer of this style stays over satellite pictures: the labels,
// icons and paths do; the rest of what's drawn would hide them.
export const staysOnSatellite = (l) => (l.type === "symbol" ? !l.id.startsWith("road_oneway") : l.id.endsWith("-path"));

// ----- colours -----
const C = {
  land: "#151a22", urban: "#171d27", commercial: "#1a202b", industrial: "#1b2029", school: "#1d2432", hospital: "#2a212c", cemetery: "#1a322d",
  park: "#1b4034", wood: "#15332a", grass: "#1a352b", sand: "#2b2a24", ice: "#28323f",
  water: "#123452", river: "#17456b", ferry: "#2d5f8a", pier: "#1c2430",
  building: "#1d242f", buildingNear: "#212a37", buildingEdge: "#2d3748",
  motorway: "#6d7690", trunk: "#626c88", primary: "#5a647f", secondary: "#4c566f", tertiary: "#424c62", minor: "#333d4e", square: "#2b3341",
  edge: "#0d1117", footbridge: "#2b3340", path: "#a2947b", rail: "#566072", transit: "#3b4658", border: "#4a5468",
  text: "#e3e8f0", textDim: "#9aa6b8", suburb: "#8a96aa", street: "#b9c3d1", waterText: "#6f9cc9", parkText: "#6aa58d", hillText: "#b9ab8f", trackText: "#e0a58a", stationText: "#9cc4ff", halo: "#12161d",
};
// a, t of the way to b
const mix = (a, b, t) => "#" + [1, 3, 5].map((i) => {
  const x = parseInt(a.slice(i, i + 2), 16), y = parseInt(b.slice(i, i + 2), 16);
  return Math.round(x + (y - x) * t).toString(16).padStart(2, "0");
}).join("");

// ----- expressions -----
const get = (k) => ["get", k];
const is = (k, ...v) => (v.length === 1 ? ["==", get(k), v[0]] : ["match", get(k), v, true, false]);
const isnt = (k, ...v) => (v.length === 1 ? ["!=", get(k), v[0]] : ["match", get(k), v, false, true]);
const all = (...f) => ["all", ...f];
const lines = ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false];
const areas = ["match", ["geometry-type"], ["MultiPolygon", "Polygon"], true, false];
const points = ["match", ["geometry-type"], ["MultiPoint", "Point"], true, false];
const zoom = (...stops) => ["interpolate", ["linear"], ["zoom"], ...stops];
const grow = (base, ...stops) => ["interpolate", ["exponential", base], ["zoom"], ...stops];
// A name; abroad, also in its own letters, after sep.
const name = (sep = "\n") => ["case", ["has", "name:nonlatin"], ["concat", get("name:latin"), sep, get("name:nonlatin")], ["coalesce", get("name_en"), get("name")]];
// An icon by zoom: icon("cafe", 24, 16, 28) is cafe@24, and cafe@28 from 16.
const icon = (what, size, ...steps) => {
  const at = (px) => (Array.isArray(what) ? ["concat", what, `@${px}`] : `${what}@${px}`);
  return steps.length ? ["step", ["zoom"], at(size), ...steps.map((v, i) => (i % 2 ? at(v) : v))] : at(size);
};

// ----- layers -----
const base = (id, type, from, o) => {
  const l = { id, type, source: "omt", "source-layer": from };
  for (const k of ["minzoom", "maxzoom", "filter"]) if (o[k] !== undefined) l[k] = o[k];
  return l;
};
// o: minzoom, maxzoom, filter, and opacity, outline, smooth
const fill = (id, from, color, o = {}) => {
  const paint = { "fill-color": color };
  if (o.opacity !== undefined) paint["fill-opacity"] = o.opacity;
  if (o.outline) paint["fill-outline-color"] = o.outline;
  if (o.smooth !== undefined) paint["fill-antialias"] = o.smooth;
  return { ...base(id, "fill", from, o), paint };
};
// o: minzoom, maxzoom, filter, and dash, opacity, cap, join
const line = (id, from, color, width, o = {}) => {
  const layout = {}, paint = { "line-color": color, "line-width": width };
  if (o.cap) layout["line-cap"] = o.cap;
  if (o.join) layout["line-join"] = o.join;
  if (o.dash) paint["line-dasharray"] = o.dash;
  if (o.opacity !== undefined) paint["line-opacity"] = o.opacity;
  return { ...base(id, "line", from, o), layout, paint };
};
// o: minzoom, maxzoom, filter, source, and any layout property
const label = (id, from, color, size, o = {}) => {
  const { minzoom, maxzoom, filter, source, halo = 1.5, blur = 0.4, ...layout } = o;
  const l = base(id, "symbol", from, { minzoom, maxzoom, filter });
  if (source) { l.source = source; delete l["source-layer"]; }
  return {
    ...l,
    layout: { "text-field": name(), "text-font": ["Noto Sans Regular"], "text-size": size, ...layout },
    paint: { "text-color": color, "text-halo-color": C.halo, "text-halo-width": halo, ...(blur ? { "text-halo-blur": blur } : {}) },
  };
};
const ROUND = { cap: "round", join: "round" };
const BOLD = { "text-font": ["Noto Sans Bold"] };
const ITALIC = { "text-font": ["Noto Sans Italic"] };

// ----- land and water -----
// The tiles' park layer is every kind of protected place, not city parks,
// which are grass. Nature reserves are drawn as parks; national parks,
// National Landscapes (AONBs) and the like, which cover whole counties, get a
// faint tint. Nothing else is drawn, as the rest is mostly built-up
// conservation areas and world heritage sites (Edinburgh's New Town, Bath),
// old forts and battlefields, and sea.
const RESERVES = ["nature_reserve", "public_park", "Nature Reserve", "Local Nature Reserve", "National Nature Reserve", "Country Park"];
const COUNTRYSIDE = ["conservation", "national_park", "protected_area", "wildlife_refuge", "Regional Park", "regional_park", "area_of_outstanding_natural_beauty", "aonb", "national_nature_reserve", "landscape_protection_area"]; // most of the UK's are "conservation"
const STREAMS = [grow(1.3, 13, 0.5, 20, 6), grow(1.3, 13, 0.5, 20, 2), grow(1.2, 10, 0.8, 20, 6)]; // streams and canals, ditches, rivers
const inTunnel = is("brunnel", "tunnel"), noTunnel = isnt("brunnel", "tunnel");
const dry = is("intermittent", 1), wet = is("intermittent", 0); // flowing only at times, or always
const ground = () => [
  { id: "background", type: "background", paint: { "background-color": C.land } },
  fill("landcover-glacier", "landcover", C.ice, { filter: is("subclass", "glacier"), opacity: 1 }),
  fill("landuse-residential", "landuse", C.urban, { filter: is("class", "neighbourhood", "residential"), opacity: 1 }),
  fill("landuse-suburb", "landuse", C.urban, { maxzoom: 10, filter: is("class", "suburb"), opacity: 1 }),
  fill("landuse-commercial", "landuse", C.commercial, { filter: all(areas, is("class", "commercial")), opacity: 1 }),
  fill("landuse-industrial", "landuse", C.industrial, { filter: all(areas, is("class", "dam", "garages", "industrial")), opacity: 1 }),
  fill("landuse-cemetery", "landuse", C.cemetery, { filter: is("class", "cemetery"), opacity: 1 }),
  fill("landuse-hospital", "landuse", C.hospital, { filter: is("class", "hospital"), opacity: 1 }),
  fill("landuse-school", "landuse", C.school, { filter: is("class", "school"), opacity: 1 }),
  fill("landuse-railway", "landuse", C.industrial, { filter: is("class", "railway"), opacity: 1 }),
  fill("park", "park", C.park, { filter: all(areas, is("class", ...RESERVES, ...COUNTRYSIDE)), opacity: ["match", get("class"), RESERVES, 0.95, 0.16] }),
  fill("landcover-wood", "landcover", C.wood, { filter: is("class", "wood"), opacity: 0.9, outline: C.wood, smooth: ["step", ["zoom"], false, 9, true] }),
  fill("landcover-grass", "landcover", C.grass, { filter: is("class", "grass"), opacity: 0.6 }),
  fill("landcover-grass-park", "park", C.park, { filter: is("class", "public_park"), opacity: 1 }),

  line("waterway_tunnel", "waterway", C.river, STREAMS[0], { minzoom: 14, filter: all(is("class", "canal", "river", "stream"), inTunnel), cap: "round", dash: [2, 4] }),
  line("waterway-other", "waterway", C.river, STREAMS[1], { filter: all(isnt("class", "canal", "river", "stream"), wet), cap: "round" }),
  line("waterway-other-intermittent", "waterway", C.river, STREAMS[1], { filter: all(isnt("class", "canal", "river", "stream"), dry), cap: "round", dash: [4, 3] }),
  line("waterway-stream-canal", "waterway", C.river, STREAMS[0], { filter: all(is("class", "canal", "stream"), noTunnel, wet), cap: "round" }),
  line("waterway-stream-canal-intermittent", "waterway", C.river, STREAMS[0], { filter: all(is("class", "canal", "stream"), noTunnel, dry), cap: "round", dash: [4, 3] }),
  line("waterway-river", "waterway", C.river, STREAMS[2], { filter: all(is("class", "river"), noTunnel, isnt("intermittent", 1)), cap: "round" }),
  line("waterway-river-intermittent", "waterway", C.river, STREAMS[2], { filter: all(is("class", "river"), noTunnel, dry), cap: "round", dash: [3, 2.5] }),
  fill("water", "water", C.water, { filter: all(isnt("intermittent", 1), noTunnel) }),
  fill("water-intermittent", "water", C.water, { filter: dry, opacity: 0.7 }),
  fill("landcover-ice-shelf", "landcover", C.ice, { filter: is("subclass", "ice_shelf"), opacity: 1 }),
  fill("landcover-sand", "landcover", C.sand, { filter: is("class", "sand"), opacity: 1 }),
  // Buildings come in slowly from 14, dark, and brighten a little close up:
  // all at once, as at 13 in Bright, they changed the whole map's look.
  fill("building", "building", zoom(15.5, C.building, 18, C.buildingNear), { minzoom: 14, opacity: zoom(14, 0, 16, 1), outline: zoom(15.5, C.building, 17.5, C.buildingEdge) }),
];

// ----- roads and paths -----
const T = "transportation";
const MINOR = ["minor", "service", "track"], BIG = ["primary", "secondary", "tertiary", "trunk"];
const ramp = is("ramp", 1), noRamp = isnt("ramp", 1);
// the colour of roads of these classes
const ofClass = (classes, f) => {
  const c = classes.map((k) => f(C[k]));
  return classes.length === 1 ? c[0] : ["match", get("class"), ...classes.slice(0, -1).flatMap((k, i) => [k, c[i]]), c.at(-1)];
};
// Main roads come up out of the land's colour as you zoom in, so the map
// isn't all main roads from afar; in tunnels they stay fainter.
const main = (...classes) => {
  const at = (t) => ofClass(classes, (c) => mix(c, C.land, t));
  return zoom(9.5, at(0.72), 12, at(0.5), 14.5, at(0));
};
const mainTunnel = (...classes) => {
  const at = (t) => ofClass(classes, (c) => mix(c, C.land, t));
  return zoom(9.5, at(0.85), 12, at(0.75), 14.5, at(0.25));
};
const plain = (...classes) => ofClass(classes, (c) => c);
const plainTunnel = (...classes) => ofClass(classes, (c) => mix(c, C.land, 0.45));
const bigEdge = zoom(11, mix(C.edge, C.land, 0.7), 14, C.edge);
// a minor road's edge shows before the road itself does: until then, in the road's colour
const minorEdge = zoom(13.6, mix(C.minor, C.land, 0.35), 14.2, C.edge);
// Paths are drawn from 14 (before that the tiles have only some of them),
// faint at first, as they're bunched together there, and clearer close up.
const PATH = { minzoom: 14, dash: [1.5, 0.75], opacity: zoom(14, 0.3, 16.5, 1) };
const W = {
  minor: grow(1.2, 13.5, 0, 14, 2.5, 20, 11.5), minorEdge: grow(1.2, 12, 0.5, 13, 1, 14, 4, 20, 15),
  link: grow(1.2, 12.5, 0, 13, 1.5, 14, 2.5, 20, 11.5), linkEdge: grow(1.2, 12, 1, 13, 3, 14, 4, 20, 15), linkBridge: grow(1.2, 12, 1, 13, 3, 14, 4, 20, 19),
  secondary: grow(1.2, 6.5, 0, 8, 0.5, 20, 13), secondaryEdge: grow(1.2, 8, 1.5, 20, 17),
  main: grow(1.2, 6.5, 0, 7, 0.5, 20, 18), mainTunnelEdge: grow(1.2, 5, 0.4, 6, 0.6, 7, 1.5, 20, 22), mainBridge: grow(1.2, 5, 0.4, 6, 0.6, 7, 1.5, 20, 26),
  path: grow(1.2, 15, 1.2, 20, 4),
  rail: grow(1.4, 14, 0.4, 15, 0.75, 20, 2), siding: grow(1.4, 14, 0.4, 20, 1), sleepers: grow(1.4, 14.5, 0, 15, 3, 20, 8), thinSleepers: grow(1.4, 14.5, 0, 15, 2, 20, 6),
};
const ways = () => {
  const open = isnt("brunnel", "bridge", "tunnel"), bridge = is("brunnel", "bridge");
  const J = { join: "round" }, dash = [0.5, 0.25];
  const motorway = is("class", "motorway"), link = is("class", ...BIG);
  return [
    // in tunnels
    line("tunnel-service-track-casing", T, minorEdge, grow(1.2, 15, 1, 16, 4, 20, 11), { filter: all(inTunnel, is("class", "service", "track")), dash, ...J }),
    line("tunnel-motorway-link-casing", T, bigEdge, W.linkEdge, { filter: all(inTunnel, motorway, ramp), dash, ...J }),
    line("tunnel-minor-casing", T, minorEdge, W.minorEdge, { filter: all(inTunnel, is("class", "minor")), dash, opacity: zoom(12, 0, 12.5, 1), ...J }),
    line("tunnel-link-casing", T, bigEdge, W.linkEdge, { filter: all(inTunnel, link, ramp), dash, ...J }),
    line("tunnel-secondary-tertiary-casing", T, bigEdge, W.secondaryEdge, { filter: all(inTunnel, is("class", "secondary", "tertiary"), noRamp), dash, ...J }),
    line("tunnel-trunk-primary-casing", T, bigEdge, W.mainTunnelEdge, { filter: all(inTunnel, is("class", "primary", "trunk"), noRamp), ...J }),
    line("tunnel-motorway-casing", T, bigEdge, W.mainTunnelEdge, { filter: all(inTunnel, motorway, noRamp), dash, ...J }),
    line("tunnel-path", T, mix(C.path, C.land, 0.4), W.path, { ...PATH, filter: all(lines, inTunnel, is("class", "path")) }),
    line("tunnel-motorway-link", T, mainTunnel("motorway"), W.link, { filter: all(inTunnel, motorway, ramp), ...J }),
    line("tunnel-service-track", T, plainTunnel("minor"), grow(1.2, 15.5, 0, 16, 2, 20, 7.5), { filter: all(inTunnel, is("class", "service", "track")), ...J }),
    line("tunnel-link", T, plainTunnel(...BIG), W.link, { filter: all(inTunnel, link, ramp), ...J }),
    line("tunnel-minor", T, plainTunnel("minor"), W.minor, { filter: all(inTunnel, is("class", "minor")), ...J }),
    line("tunnel-secondary-tertiary", T, mainTunnel("secondary", "tertiary"), grow(1.2, 6.5, 0, 7, 0.5, 20, 10), { filter: all(inTunnel, is("class", "secondary", "tertiary"), noRamp), ...J }),
    line("tunnel-trunk-primary", T, mainTunnel("primary", "trunk"), W.main, { filter: all(inTunnel, is("class", "primary", "trunk"), noRamp), ...J }),
    line("tunnel-motorway", T, mainTunnel("motorway"), W.main, { filter: all(inTunnel, motorway, noRamp), ...J }),
    line("tunnel-railway", T, C.rail, W.rail, { filter: all(inTunnel, is("class", "rail")), dash: [2, 2] }),

    // ferries, airfields, piers and squares
    line("ferry", T, C.ferry, 1.1, { filter: is("class", "ferry"), dash: [2, 2], ...J }),
    line("aeroway-taxiway-casing", "aeroway", C.edge, grow(1.5, 11, 2, 17, 12), { minzoom: 12, filter: is("class", "taxiway"), ...ROUND }),
    line("aeroway-runway-casing", "aeroway", C.edge, grow(1.5, 11, 5, 17, 55), { minzoom: 12, filter: is("class", "runway"), ...ROUND }),
    fill("aeroway-area", "aeroway", C.commercial, { minzoom: 4, filter: all(areas, is("class", "runway", "taxiway")), opacity: zoom(13, 0, 14, 1) }),
    line("aeroway-taxiway", "aeroway", C.minor, grow(1.5, 11, 1, 17, 10), { minzoom: 4, filter: all(is("class", "taxiway"), lines), opacity: zoom(11, 0, 12, 1), ...ROUND }),
    line("aeroway-runway", "aeroway", C.minor, grow(1.5, 11, 4, 17, 50), { minzoom: 4, filter: all(is("class", "runway"), lines), opacity: zoom(11, 0, 12, 1), ...ROUND }),
    fill("road_area_pier", T, C.pier, { filter: all(areas, is("class", "pier")), smooth: true }),
    line("road_pier", T, C.pier, grow(1.2, 15, 1, 17, 4), { filter: all(lines, is("class", "pier")), ...ROUND }),
    fill("highway-area", T, C.square, { filter: all(areas, isnt("class", "pier")), opacity: 0.9, outline: C.square, smooth: false }),

    // on the ground (minor roads' bridges are under these and again below)
    line("highway-motorway-link-casing", T, bigEdge, W.linkEdge, { filter: all(open, motorway, ramp), ...ROUND }),
    line("highway-link-casing", T, bigEdge, W.linkEdge, { minzoom: 13, filter: all(open, link, ramp), ...ROUND }),
    line("highway-minor-casing", T, minorEdge, W.minorEdge, { filter: all(lines, noTunnel, is("class", ...MINOR)), opacity: zoom(12, 0, 12.5, 1), ...ROUND }),
    line("highway-secondary-tertiary-casing", T, bigEdge, W.secondaryEdge, { filter: all(open, is("class", "secondary", "tertiary"), noRamp), cap: "butt", ...J }),
    line("highway-primary-casing", T, bigEdge, grow(1.2, 7, 0, 8, 0.6, 9, 1.5, 20, 22), { minzoom: 5, filter: all(open, is("class", "primary"), noRamp), opacity: zoom(7, 0, 8, 1), cap: "butt", ...J }),
    line("highway-trunk-casing", T, bigEdge, grow(1.2, 5, 0, 6, 0.6, 7, 1.5, 20, 22), { minzoom: 5, filter: all(open, is("class", "trunk"), noRamp), opacity: zoom(5, 0, 6, 1), cap: "butt", ...J }),
    line("highway-motorway-casing", T, bigEdge, grow(1.2, 4, 0, 5, 0.4, 6, 0.6, 7, 1.5, 20, 22), { minzoom: 4, filter: all(open, motorway, noRamp), opacity: zoom(4, 0, 5, 1), cap: "butt", ...J }),
    line("highway-path", T, C.path, W.path, { ...PATH, filter: all(lines, open, is("class", "path")) }),
    line("highway-motorway-link", T, main("motorway"), W.link, { minzoom: 12, filter: all(open, motorway, ramp), ...ROUND }),
    line("highway-link", T, plain(...BIG), W.link, { minzoom: 13, filter: all(open, link, ramp), ...ROUND }),
    line("highway-minor", T, C.minor, W.minor, { filter: all(lines, noTunnel, is("class", ...MINOR)), ...ROUND }),
    line("highway-secondary-tertiary", T, main("secondary", "tertiary"), W.secondary, { filter: all(open, is("class", "secondary", "tertiary"), noRamp), ...ROUND }),
    line("highway-primary", T, main("primary"), grow(1.2, 8.5, 0, 9, 0.5, 20, 18), { filter: all(lines, open, is("class", "primary"), noRamp), ...ROUND }),
    line("highway-trunk", T, main("trunk"), W.main, { filter: all(lines, open, is("class", "trunk"), noRamp), ...ROUND }),
    line("highway-motorway", T, main("motorway"), W.main, { minzoom: 5, filter: all(lines, open, motorway, noRamp), ...ROUND }),
    line("railway-transit", T, C.transit, W.siding, { filter: all(lines, is("class", "transit"), noTunnel) }),
    line("railway-transit-hatching", T, C.transit, W.thinSleepers, { filter: all(lines, is("class", "transit"), noTunnel), dash: [0.2, 8] }),
    line("railway-service", T, C.rail, W.siding, { filter: all(lines, is("class", "rail"), ["has", "service"]) }),
    line("railway-service-hatching", T, C.rail, W.thinSleepers, { filter: all(lines, is("class", "rail"), ["has", "service"]), dash: [0.2, 8] }),
    line("railway", T, C.rail, W.rail, { filter: all(lines, ["!", ["has", "service"]], open, is("class", "rail")) }),
    line("railway-hatching", T, C.rail, W.sleepers, { filter: all(lines, ["!", ["has", "service"]], open, is("class", "rail")), dash: [0.2, 8] }),

    // on bridges
    line("bridge-motorway-link-casing", T, bigEdge, W.linkBridge, { filter: all(bridge, motorway, ramp), ...J }),
    line("bridge-link-casing", T, bigEdge, W.linkBridge, { filter: all(bridge, link, ramp), ...J }),
    line("bridge-secondary-tertiary-casing", T, bigEdge, grow(1.2, 5, 0.4, 7, 0.6, 8, 1.5, 20, 21), { filter: all(bridge, is("class", "secondary", "tertiary"), noRamp), ...J }),
    line("bridge-trunk-primary-casing", T, bigEdge, W.mainBridge, { filter: all(bridge, is("class", "primary", "trunk"), noRamp), ...J }),
    line("bridge-motorway-casing", T, bigEdge, W.mainBridge, { filter: all(bridge, motorway, noRamp), ...J }),
    line("bridge-minor-casing", T, minorEdge, grow(1.2, 12, 0.5, 13, 1, 14, 6, 20, 24), { filter: all(lines, bridge, is("class", ...MINOR)), opacity: zoom(12, 0, 12.5, 1), cap: "butt", ...J }),
    line("bridge-path-casing", T, C.footbridge, grow(1.2, 15, 1.2, 20, 18), { minzoom: 14, opacity: PATH.opacity, filter: all(lines, bridge, is("class", "path")) }),
    line("bridge-path", T, C.path, W.path, { ...PATH, filter: all(lines, bridge, is("class", "path")) }),
    line("bridge-motorway-link", T, main("motorway"), W.link, { filter: all(bridge, motorway, ramp), ...J }),
    line("bridge-link", T, plain(...BIG), W.link, { filter: all(bridge, link, ramp), ...J }),
    line("bridge-minor", T, C.minor, W.minor, { filter: all(lines, bridge, is("class", ...MINOR)), ...ROUND }),
    line("bridge-secondary-tertiary", T, main("secondary", "tertiary"), W.secondary, { filter: all(bridge, is("class", "secondary", "tertiary"), noRamp), ...J }),
    line("bridge-trunk-primary", T, main("primary", "trunk"), W.main, { filter: all(bridge, is("class", "primary", "trunk"), noRamp), ...J }),
    line("bridge-motorway", T, main("motorway"), W.main, { filter: all(bridge, motorway, noRamp), ...J }),
    line("bridge-railway", T, C.rail, W.rail, { filter: all(bridge, is("class", "rail")) }),
    line("bridge-railway-hatching", T, C.rail, W.sleepers, { filter: all(bridge, is("class", "rail")), dash: [0.2, 8] }),
    line("cablecar", T, C.rail, zoom(11, 1, 19, 2.5), { minzoom: 13, filter: is("subclass", "cable_car"), cap: "round" }),
    line("cablecar-dash", T, C.rail, zoom(11, 3, 19, 5.5), { minzoom: 13, filter: is("subclass", "cable_car"), cap: "round", dash: [2, 3] }),

    // borders
    line("boundary_3", "boundary", C.border, zoom(7, 1, 11, 2), { minzoom: 5, dash: [1, 1],
      filter: all(["==", ["typeof", get("admin_level")], "number"], [">=", get("admin_level"), 3], ["<=", get("admin_level"), 6], isnt("maritime", 1), isnt("disputed", 1), ["!", ["has", "claimed_by"]]) }),
    line("boundary_2", "boundary", C.border, zoom(3, 1, 5, 1.2, 12, 3), { opacity: zoom(0, 0.4, 4, 1), ...ROUND,
      filter: all(is("admin_level", 2), isnt("maritime", 1), isnt("disputed", 1), ["!", ["has", "claimed_by"]]) }),
    line("boundary_disputed", "boundary", C.border, zoom(3, 1, 5, 1.2, 12, 3), { filter: all(isnt("maritime", 1), is("disputed", 1)), dash: [1, 2] }),

    ...[["road_oneway", 1, 90], ["road_oneway_opposite", -1, -90]].map(([id, way, turn]) => ({
      ...base(id, "symbol", T, { minzoom: 15, filter: all(is("oneway", way), is("class", "minor", "motorway", "primary", "secondary", "service", "tertiary", "trunk")) }),
      layout: { "icon-image": "oneway@21", "icon-padding": 2, "icon-rotate": turn, "icon-rotation-alignment": "map", "icon-size": zoom(15, 0.5, 19, 1), "symbol-placement": "line", "symbol-spacing": 75 },
      paint: { "icon-opacity": 0.5 },
    })),
  ];
};

// ----- labels and icons -----
// The places shown, the user's choice (2026-11-25): these and no others.
// Gardens only if they have a name (the rest are mostly people's own);
// hospitals but not clinics; viewpoints but not the rest of the tiles'
// attractions, which are zoo animals, graves and the like. The tiles hold
// points from zoom 14 and rank them (1 the most prominent), so each shows
// from the zoom its rank earns; food from 16, whatever its rank.
const FOOD = ["cafe", "bakery", "grocery"];
const PLACES = ["any",
  is("class", "ice_cream", "alcohol_shop", "pharmacy", "bicycle", "picnic_site", "campsite", "swimming", "zoo"),
  all(is("class", "shop"), is("subclass", "convenience", "florist", "sports", "chemist", "outdoor")),
  all(is("class", "garden"), ["has", "name"]),
  all(is("class", "hospital"), is("subclass", "hospital")),
  all(is("class", "attraction"), is("subclass", "viewpoint"))];
const KIND = ["case", is("class", "shop"), get("subclass"), get("class")]; // an icon's name
const place = (id, minzoom, filter, pic, extra = {}) => label(id, "poi", C.textDim, 12.5, {
  minzoom, filter, "icon-image": pic, "text-anchor": "top", "text-max-width": 9, "text-offset": [0, 1.35], ...extra,
});
// points that are only an icon
const point = (id, cls, minzoom, pic, overlap) => ({
  ...base(id, "symbol", "poi", { minzoom, filter: is("class", cls) }),
  layout: { "icon-image": pic, "icon-allow-overlap": overlap },
});
const rank = (from, to) => [[">=", get("rank"), from], ...(to ? [["<", get("rank"), to]] : [])];
const names = () => {
  const along = { "symbol-placement": "line", "text-field": name(" "), "text-rotation-alignment": "map" };
  const water = { ...ITALIC, "text-letter-spacing": 0.2, "text-max-width": 5 };
  const town = { "icon-allow-overlap": true, "icon-optional": false, "text-anchor": "bottom", "text-max-width": 8 };
  // the dot by a name, zoomed out: px wide, until zoom
  const dot = (px, until) => ["step", ["zoom"], `dot@${px}`, until, ""];
  return [
    label(FIRST_LABEL, "waterway", C.waterText, 14, { minzoom: 10, filter: lines, ...water, "symbol-placement": "line", "symbol-spacing": 350, "text-field": name(" ") }),
    label("water_name_point_label", "water_name", C.waterText, zoom(0, 10, 8, 14), { filter: points, ...water }),
    label("water_name_line_label", "water_name", C.waterText, 14, { filter: lines, ...water, "symbol-placement": "line", "symbol-spacing": 350, "text-field": name(" ") }),
    label("park-name", "park", C.parkText, 11, { minzoom: 13, "text-field": ["coalesce", get("name:en"), get("name")], "text-max-width": 8, halo: 1.4, blur: 0 }),
    // hilltops, with their heights: the highest from 11, all from 13.5
    label("hilltops", "mountain_peak", C.hillText, 11.5, { minzoom: 11, blur: 0,
      filter: all(is("class", "peak", "hill", "volcano"), ["has", "name"], ["step", ["zoom"], ["<=", get("rank"), 1], 12, ["<=", get("rank"), 3], 13.5, true]),
      "icon-image": icon("peak", 20, 14, 24), "text-optional": true, "text-anchor": "left", "text-offset": [0.85, 0], "text-max-width": 9,
      "text-field": ["format", ["coalesce", get("name:en"), get("name")], {}, ["case", ["has", "ele"], ["concat", "  ", ["to-string", get("ele")], " m"], ""], { "font-scale": 0.88 }] }),
    // Later layers' labels are placed first, so what matters more comes later.
    place("poi_r20", 17, all(points, ...rank(20), PLACES), icon(KIND, 24, 16, 28, 17, 32)),
    place("poi_r7", 16, all(points, ...rank(7, 20), PLACES), icon(KIND, 24, 16, 28, 17, 32)),
    place("food", 16, is("class", ...FOOD), icon(KIND, 28, 17, 32), { "symbol-sort-key": get("rank") }),
    place("poi_r1", 15, all(points, ...rank(1, 7), PLACES), icon(KIND, 24, 16, 28, 17, 32)),
    label("highway-name-path", "transportation_name", C.path, zoom(13, 12, 14, 13), { minzoom: 15.5, filter: is("class", "path"), ...along }),
    label("highway-name-minor", "transportation_name", C.street, zoom(13, 12, 14, 13), { minzoom: 15, filter: all(lines, is("class", ...MINOR)), ...along }),
    label("highway-name-major", "transportation_name", C.street, zoom(13, 12, 14, 13), { minzoom: 12.2, filter: is("class", ...BIG), ...along }),
    // road numbers, in a box as wide as they need
    label("highway-shield", "transportation_name", C.text, 10, { minzoom: 8, halo: 0, blur: 0,
      filter: all(["<=", get("ref_length"), 6], lines, isnt("network", "us-highway", "us-interstate", "us-state")),
      "icon-image": ["concat", "shield@", get("ref_length")], "icon-rotation-alignment": "viewport", "symbol-placement": ["step", ["zoom"], "point", 11, "line"], "symbol-spacing": 200,
      "text-field": ["to-string", get("ref")], "text-rotation-alignment": "viewport" }),
    label("airport", "aerodrome_label", C.textDim, 12, { minzoom: 10, filter: ["has", "iata"], "icon-image": icon("plane", 17),
      "text-anchor": "top", "text-max-width": 9, "text-offset": [0, 0.6], "text-optional": true, "text-padding": 2 }),
    label("label_other", "place", C.suburb, zoom(11, 10, 15, 12), { minzoom: 8, filter: isnt("class", "city", "continent", "country", "state", "town", "village"), ...BOLD, "text-letter-spacing": 0.18, "text-max-width": 9, "text-transform": "uppercase" }),
    label("label_village", "place", C.textDim, grow(1.2, 7, 10, 11, 12), { minzoom: 9, filter: is("class", "village"), ...town, "icon-image": dot(1.8, 10) }),
    label("label_town", "place", C.text, grow(1.2, 7, 12, 11, 14), { minzoom: 6, filter: is("class", "town"), ...town, ...BOLD, "icon-image": dot(1.8, 10) }),
    label("label_state", "place", C.textDim, zoom(5, 10, 8, 14), { minzoom: 5, maxzoom: 8, filter: is("class", "state"), "text-letter-spacing": 0.2, "text-max-width": 9, "text-transform": "uppercase" }),
    label("label_city", "place", C.text, grow(1.2, 4, 11, 7, 13, 11, 18), { minzoom: 3, filter: all(is("class", "city"), isnt("capital", 2)), ...town, ...BOLD, "icon-image": dot(3.6, 9), "text-offset": [0, -0.1] }),
    label("label_city_capital", "place", C.text, grow(1.2, 4, 12, 7, 14, 11, 20), { minzoom: 3, filter: all(is("class", "city"), is("capital", 2)), ...town, ...BOLD, "icon-image": dot(4.5, 9), "text-offset": [0, -0.2] }),
    label("label_country_3", "place", C.text, zoom(3, 9, 7, 17), { minzoom: 2, maxzoom: 9, filter: all(is("class", "country"), [">=", get("rank"), 3]), "text-max-width": 6.25 }),
    label("label_country_2", "place", C.text, zoom(2, 9, 5, 17), { maxzoom: 9, filter: all(is("class", "country"), is("rank", 2)), "text-max-width": 6.25 }),
    label("label_country_1", "place", C.text, zoom(1, 9, 4, 17), { maxzoom: 9, filter: all(is("class", "country"), is("rank", 1)), "text-max-width": 6.25 }),
    // Always shown once zoomed in, over anything else: what a runner looks for.
    point("stiles", "stile", 17, icon("stile", 24, 18, 28), false),
    point("atms", "atm", 17, icon("atm", 28, 18, 32), false),
    point("water-points", "drinking_water", 15, icon("drinking_water", 24, 16, 28, 17, 32), true),
    point("toilets", "toilets", 15, icon("toilets", 24, 16, 28, 17, 32), true),
    label("tracks", null, C.trackText, 11.5, { source: "tracks", minzoom: 14, blur: 0,
      "icon-image": icon("track", 24, 15, 28, 16.5, 32), "icon-allow-overlap": true, "text-field": ["coalesce", get("name"), ""],
      "text-max-width": 9, "text-anchor": "top", "text-offset": [0, 1.35], "text-optional": true }),
    // trains from 13, the Underground, trams and light rail from 14, each with its icon
    label("stations", "poi", C.stationText, zoom(13, 11.5, 16, 13.5), { minzoom: 13,
      filter: all(is("class", "railway"), ["step", ["zoom"], is("subclass", "station", "halt"), 14, is("subclass", "station", "halt", "subway", "tram_stop", "light_rail")]),
      "icon-image": icon(["match", get("subclass"), "subway", "subway", ["tram_stop", "light_rail"], "tram", "rail"], 20, 14, 24, 15.5, 28, 17, 32),
      "icon-allow-overlap": true, "text-optional": true, "text-anchor": "left", "text-max-width": 9, "text-offset": [1.35, 0] }),
  ];
};

export function buildStyle() {
  return {
    version: 8,
    glyphs: FONTS,
    sources: {
      omt: { type: "vector", url: TILES, attribution: ATTRIBUTION },
      tracks: { type: "geojson", data: TRACKS },
    },
    layers: [...ground(), ...ways(), ...names()],
  };
}
