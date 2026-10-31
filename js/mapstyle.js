// Builds a MapLibre style from a small colour palette, using OpenFreeMap's
// free vector tiles (OpenMapTiles schema, no API key).
//
// Every design calls buildStyle with its own palette, so the same map data
// can look like a cream sketch or a dark neon city.

const SOURCE = "https://tiles.openfreemap.org/planet";
const GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

// Width that grows with zoom: [[zoom, px], ...]
const grow = (stops) => ["interpolate", ["exponential", 1.5], ["zoom"], ...stops.flat()];

const isClass = (classes) => ["match", ["get", "class"], classes, true, false];
const notTunnel = ["!=", ["get", "brunnel"], "tunnel"];

/**
 * p (palette):
 *   land, water, park, wood, building, casing (optional),
 *   motorway, major, minor, service, path, rail (optional),
 *   label, labelHalo, waterLabel, parkLabel
 * o (options):
 *   buildings: bool, casing: bool, pathDash: [a, b] | null,
 *   labels: "few" | "normal", placeUpper: bool
 */
export function buildStyle(p, o = {}) {
  const opt = { buildings: true, casing: false, pathDash: null, labels: "few", placeUpper: true, ...o };
  const layers = [];

  layers.push({ id: "land", type: "background", paint: { "background-color": p.land } });

  // Green spaces: parks, grass, woods, pitches, cemeteries.
  layers.push({
    id: "landuse-green", type: "fill", source: "omt", "source-layer": "landuse",
    filter: isClass(["cemetery", "pitch", "playground", "garden", "grass", "recreation_ground"]),
    paint: { "fill-color": p.park, "fill-opacity": 0.7 },
  });
  layers.push({
    id: "landcover-grass", type: "fill", source: "omt", "source-layer": "landcover",
    filter: isClass(["grass", "farmland", "wetland"]),
    paint: { "fill-color": p.park, "fill-opacity": 0.85 },
  });
  layers.push({
    id: "landcover-wood", type: "fill", source: "omt", "source-layer": "landcover",
    filter: isClass(["wood"]),
    paint: { "fill-color": p.wood ?? p.park },
  });
  layers.push({
    id: "park", type: "fill", source: "omt", "source-layer": "park",
    paint: { "fill-color": p.park },
  });

  layers.push({
    id: "water", type: "fill", source: "omt", "source-layer": "water",
    filter: notTunnel,
    paint: { "fill-color": p.water },
  });
  layers.push({
    id: "waterway", type: "line", source: "omt", "source-layer": "waterway",
    filter: notTunnel,
    paint: { "line-color": p.water, "line-width": grow([[12, 0.5], [16, 3]]) },
  });

  if (opt.buildings) {
    layers.push({
      id: "building", type: "fill", source: "omt", "source-layer": "building", minzoom: 14,
      paint: {
        "fill-color": p.building,
        "fill-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0, 15.5, 1],
      },
    });
  }

  // Roads, drawn from small to big so big roads sit on top.
  const road = (id, classes, color, widths, extra = {}) => ({
    id, type: "line", source: "omt", "source-layer": "transportation",
    filter: ["all", isClass(classes), notTunnel],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": color, "line-width": grow(widths), ...extra },
  });

  const roadDefs = [
    ["path", ["path", "track"], p.path, [[14, 0.4], [18, 2]],
      opt.pathDash ? { "line-dasharray": opt.pathDash } : {}],
    ["service", ["service"], p.service, [[13, 0.3], [18, 4]]],
    ["minor", ["minor"], p.minor, [[12, 0.4], [18, 9]]],
    ["secondary", ["secondary", "tertiary"], p.major, [[10, 0.6], [18, 14]]],
    ["primary", ["primary", "trunk"], p.major, [[8, 0.8], [18, 18]]],
    ["motorway", ["motorway"], p.motorway ?? p.major, [[6, 0.8], [18, 20]]],
  ];

  if (opt.casing && p.casing) {
    for (const [id, classes, , widths] of roadDefs.slice(2)) {
      const wider = widths.map(([z, w]) => [z, w + Math.max(1, w * 0.25)]);
      layers.push(road(`${id}-casing`, classes, p.casing, wider));
    }
  }
  for (const [id, classes, color, widths, extra] of roadDefs) {
    layers.push(road(id, classes, color, widths, extra));
  }

  if (p.rail) {
    layers.push({
      id: "rail", type: "line", source: "omt", "source-layer": "transportation",
      filter: ["all", isClass(["rail", "transit"]), notTunnel],
      paint: { "line-color": p.rail, "line-width": grow([[12, 0.4], [18, 1.5]]) },
    });
  }

  // Labels: kept sparse on purpose.
  const textBase = { "text-font": ["Noto Sans Regular"], "text-max-width": 8 };
  const halo = { "text-halo-color": p.labelHalo, "text-halo-width": 1.4, "text-halo-blur": 0.5 };

  layers.push({
    id: "water-name", type: "symbol", source: "omt", "source-layer": "water_name",
    layout: { ...textBase, "text-font": ["Noto Sans Italic"], "text-field": ["get", "name:en"], "text-size": 11 },
    paint: { "text-color": p.waterLabel ?? p.label, ...halo },
  });

  layers.push({
    id: "park-name", type: "symbol", source: "omt", "source-layer": "park", minzoom: 13,
    layout: { ...textBase, "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]], "text-size": 11 },
    paint: { "text-color": p.parkLabel ?? p.label, ...halo },
  });

  if (opt.labels === "normal") {
    layers.push({
      id: "road-name", type: "symbol", source: "omt", "source-layer": "transportation_name", minzoom: 14,
      filter: isClass(["primary", "secondary", "tertiary", "trunk"]),
      layout: { ...textBase, "symbol-placement": "line", "text-field": ["get", "name"], "text-size": 10.5 },
      paint: { "text-color": p.label, ...halo },
    });
  }

  layers.push({
    id: "place", type: "symbol", source: "omt", "source-layer": "place",
    filter: isClass(["suburb", "quarter", "neighbourhood"]),
    layout: {
      ...textBase,
      "text-font": ["Noto Sans Bold"],
      "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
      "text-size": ["interpolate", ["linear"], ["zoom"], 11, 10, 15, 12],
      "text-transform": opt.placeUpper ? "uppercase" : "none",
      "text-letter-spacing": opt.placeUpper ? 0.18 : 0,
    },
    paint: { "text-color": p.label, ...halo },
  });

  return {
    version: 8,
    glyphs: GLYPHS,
    sources: { omt: { type: "vector", url: SOURCE, attribution: '<a href="https://openfreemap.org">OpenFreeMap</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' } },
    layers,
  };
}
