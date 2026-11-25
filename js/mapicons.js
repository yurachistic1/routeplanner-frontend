// The map's icons, drawn in the browser as the map asks for them (chosen
// with the user, 2026-11-25; UI.md "The map"). Nothing is fetched.
//
// Each is one bold white shape on a coloured disc (stations: a square), on a
// 24 by 24 grid, so it reads at a glance. The style (js/mapstyle.js) asks for
// "cafe@28", a cafe 28 px across, and it's drawn in exactly the pixels that
// takes on this map: MapLibre shrinks pictures roughly, with no smoothing in
// between, so one picture made to fit several sizes looks low-res. A size is
// chosen by zoom steps in the style, never by icon-size.

// f: filled shapes, s: lines (w wide), x: cut out of the filled shapes, f2:
// filled on top of those, gap: lines cut out (gw wide), sq: on a square,
// big: scale, as: the same shape as another.
const SHAPES = {
  // food
  cafe: { k: "food", f: ["M4 7h12v7a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"], s: ["M16 9.2h1.4a2.9 2.9 0 0 1 0 5.8H16"], w: 2.2 },
  bakery: { k: "food", f: ["M1.4 16.8C2.2 8.8 6.4 4 12 4s9.8 4.8 10.6 12.8c.2 1.7-1.5 2.7-2.9 1.8l-3.5-2.4c-1.3-.9-2.7-1.4-4.2-1.4s-2.9.5-4.2 1.4l-3.5 2.4c-1.4.9-3.1-.1-2.9-1.8z"], gap: "M9.3 3l.5 12.5M14.7 3l-.5 12.5M4.7 7.2l2.7 10M19.3 7.2l-2.7 10", gw: 1.35 },
  ice_cream: { k: "food", f: ["M6.6 11.5h10.8L12 22.5z", "M12 2.2a5.2 5.2 0 1 1 0 10.4 5.2 5.2 0 0 1 0-10.4z"], gap: "M5 11.6h14" },
  grocery: { k: "food", s: ["M1.8 4.2h3l2.6 10.4h10.4l2.6-7.4H5.8"], w: 2.4, f: ["M8.6 17a2 2 0 1 1 0 4 2 2 0 0 1 0-4z", "M16.6 17a2 2 0 1 1 0 4 2 2 0 0 1 0-4z"] },
  convenience: { k: "food", as: "grocery" },
  alcohol_shop: { k: "food", as: "grocery" },
  // shops (the bike is GPS art's, assets/icons.json)
  bicycle: { k: "shop", s: ["M9.5 13.83L9.41 14.66L9.13 15.46L8.68 16.17L8.09 16.76L7.38 17.21L6.58 17.49L5.75 17.58L4.92 17.49L4.12 17.21L3.41 16.76L2.82 16.17L2.37 15.46L2.09 14.66L2 13.83L2.09 13L2.37 12.2L2.82 11.49L3.41 10.9L4.12 10.45L4.92 10.17L5.75 10.08L6.58 10.17L7.38 10.45L8.09 10.9L8.68 11.49L9.13 12.2L9.41 13L9.5 13.83M22 13.83L21.91 14.66L21.63 15.46L21.18 16.17L20.59 16.76L19.88 17.21L19.09 17.49L18.25 17.58L17.41 17.49L16.62 17.21L15.91 16.76L15.32 16.17L14.87 15.46L14.59 14.66L14.5 13.83L14.59 13L14.87 12.2L15.32 11.49L15.91 10.9L16.62 10.45L17.41 10.17L18.25 10.08L19.09 10.17L19.88 10.45L20.59 10.9L21.18 11.49L21.63 12.2L21.91 13L22 13.83M5.75 13.83L8.57 7.98M8.57 7.98L8.88 6.97L7.61 6.82L6.45 6.97L5.87 7.96L7.19 8.77L8.57 7.98M8.57 7.98L14.86 8.8L18.25 13.83M15.14 7.69L14.86 8.8L12.86 14.75M15.14 7.69L16.59 6.46L15.2 6.42L13.71 6.49L14.49 7.2L15.14 7.69M7.83 10.71L12.86 14.75M18.25 13.83L12.86 14.75"], w: 1.7, big: 1.12 },
  sports: { k: "shop", f: ["M2 14.6V7.2c1.3 1 2.8 1.2 4.2.6 1-.5 1.7-1.3 2.1-2.6l2-.6 5.8 5.7c.9.9 2 1.3 3.3 1.5 1.9.3 2.8 1.3 2.8 2.8z", "M2 16.7h20.2v.5a2.9 2.9 0 0 1-2.9 2.9H4.3A2.3 2.3 0 0 1 2 17.8z"], gap: "M9.6 9.3l2.7-1.9M12.1 11.7l2.7-1.9", gw: 1.35 },
  outdoor: { k: "shop", as: "sports" },
  florist: { k: "shop", f: ["M6.4 2.6l2.9 2.5L12 1.6l2.7 3.5 2.9-2.5v6.6a5.6 5.6 0 0 1-11.2 0z", "M11.5 22.6C6.3 22.6 3 19.2 3 13.6c5 0 8.5 3.3 8.5 9z", "M12.5 22.6c5.2 0 8.5-3.4 8.5-9-5 0-8.5 3.3-8.5 9z"], s: ["M12 14v8"], w: 1.8 },
  chemist: { k: "health", f: ["M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"] },
  pharmacy: { k: "health", f: ["M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"] },
  hospital: { k: "hospital", s: ["M7 4.5v15M17 4.5v15M7 12h10"], w: 3.8 },
  // handy
  toilets: { k: "handy", f: ["M6.6 1.6a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z", "M4.6 7.6h4a2.2 2.2 0 0 1 2.2 2.2v5.4H9.4v7.2H3.8v-7.2H2.4V9.8a2.2 2.2 0 0 1 2.2-2.2z", "M17.4 1.6a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z", "M16 7.6h2.8l3.4 9.2h-2.6v5.6h-4.4v-5.6h-2.6z"] },
  drinking_water: { k: "water", f: ["M12 1.8c4.6 5.9 7 9.4 7 13.2a7 7 0 0 1-14 0c0-3.8 2.4-7.3 7-13.2z"] },
  atm: { k: "handy", f: ["M2.4 4.4h19.2a1.5 1.5 0 0 1 1.5 1.5v12.2a1.5 1.5 0 0 1-1.5 1.5H2.4a1.5 1.5 0 0 1-1.5-1.5V5.9a1.5 1.5 0 0 1 1.5-1.5z"], gap: "M15.2 9.3C14.7 8 13.5 7.5 12 7.5c-1.9 0-3.2.8-3.2 2.2 0 3.2 6.5 1.5 6.5 4.7 0 1.4-1.4 2.2-3.3 2.2-1.7 0-2.9-.6-3.4-1.9M12 5.7v12.6", gw: 1.8 },
  // outdoors
  garden: { k: "green", f: ["M4.5 20.5C2.8 10 9 3.5 20.5 3.5c1 11-5 17.3-13.6 15.6z"] },
  picnic_site: { k: "green", s: ["M3.5 6.5h17M1.8 13h20.4M8.6 6.5L5.2 20M15.4 6.5L18.8 20"], w: 2.5 },
  campsite: { k: "green", f: ["M12 3.2L22.5 20.5h-21z"], x: ["M12 11.5l4.2 9H7.8z"] },
  swimming: { k: "water", f: ["M18.6 6.4a2.7 2.7 0 1 1 0 5.4 2.7 2.7 0 0 1 0-5.4z", "M2.4 13.2l7.2-6.4 5.8 6.2-2 1.9-3.5-1.8-3.6 1.9z"], s: ["M15.6 3.2L9.9 5.6l4.4 5.5", "M2 19.4c2-2.4 3.4-2.4 5 0s3.3 2.4 5 0 3.3-2.4 5 0 3.3 2.4 5 0"], w: 2.5 },
  stile: { k: "plain", s: ["M7 3.5v17M17 3.5v17M7 7.5h10", "M2.5 14.5h19"], w: 2.8 },
  // sights (attraction: the tiles' class, of which only viewpoints are shown)
  attraction: { k: "sight", f: ["M3.2 6.2h4.2l1.7-2.8h5.8l1.7 2.8h4.2a2 2 0 0 1 2 2v9.8a2 2 0 0 1-2 2H3.2a2 2 0 0 1-2-2V8.2a2 2 0 0 1 2-2z"], x: ["M12 8.1a4.7 4.7 0 1 1 0 9.4 4.7 4.7 0 0 1 0-9.4z", "M4.7 8.2a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4z"], f2: ["M12 10.3a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z"] },
  zoo: { k: "sight", f: ["M12 11.5c3.4 0 6.2 3.2 6.2 6.2 0 2-1.5 3.3-3.3 3.3-1.1 0-1.9-.5-2.9-.5s-1.8.5-2.9.5c-1.8 0-3.3-1.3-3.3-3.3 0-3 2.8-6.2 6.2-6.2z", "M8.6 3a2.2 2.8 0 1 1 0 5.6A2.2 2.8 0 0 1 8.6 3z", "M15.4 3a2.2 2.8 0 1 1 0 5.6 2.2 2.8 0 0 1 0-5.6z", "M4.2 8.5a2 2.5 0 1 1 0 5 2 2.5 0 0 1 0-5z", "M19.8 8.5a2 2.5 0 1 1 0 5 2 2.5 0 0 1 0-5z"] },
  track: { k: "track", s: ["M8 6.5h8a5.5 5.5 0 0 1 0 11H8a5.5 5.5 0 0 1 0-11z"], w: 3.8 },
  // transport: on a square
  rail: { k: "transport", sq: 1, f: ["M7 2.5h10a3 3 0 0 1 3 3V14a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V5.5a3 3 0 0 1 3-3z"], s: ["M8 18.5L6 22M16 18.5L18 22"], w: 2.2, x: ["M7 6h10v5H7z", "M8.3 13.2a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6z", "M15.7 13.2a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6z"] },
  subway: { k: "tube", sq: 1, s: ["M2.8 21.5V12a9.2 9.2 0 0 1 18.4 0v9.5"], w: 2.4, f: ["M9 7.5h6a2 2 0 0 1 2 2V15a3 3 0 0 1-3 3h-4a3 3 0 0 1-3-3V9.5a2 2 0 0 1 2-2z"], x: ["M9 10h6v3H9z"] },
  tram: { k: "tram", sq: 1, s: ["M8.2 1.6h7.6M12 1.6v3", "M8.6 18.6L6.6 22.4M15.4 18.6L17.4 22.4"], w: 2.1, f: ["M8 4.6h8a2.6 2.6 0 0 1 2.6 2.6V15a3.2 3.2 0 0 1-3.2 3.2H8.6A3.2 3.2 0 0 1 5.4 15V7.2A2.6 2.6 0 0 1 8 4.6z"], x: ["M7.7 7.4h8.6v4.4H7.7z", "M8.9 13.6a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4z", "M15.1 13.6a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4z"] },
};

// Disc colours. Not the interface's tokens (UI.md): these are the map's own.
const DISC = {
  food: "#b4652c", shop: "#6a62c4", health: "#2f8a5b", hospital: "#c23f46", handy: "#52637f", water: "#2a86cc",
  green: "#3d8050", plain: "#5a6270", sight: "#8f5aa8", track: "#c75f38", transport: "#2f6ccf", tube: "#1f4f9e", tram: "#2a8a8a",
};
const EDGE = "#0d1117", WHITE = "#ffffff", PALE = "#c4cbd6", PANEL = "#212630", STONE = "#cdbf9f";

// A w by h px picture at ratio device pixels to each, drawn by paint(g) in
// px, as map.addImage wants it.
function picture(w, h, ratio, paint) {
  const cv = document.createElement("canvas");
  cv.width = Math.round(w * ratio);
  cv.height = Math.round(h * ratio);
  const g = cv.getContext("2d");
  g.scale(cv.width / w, cv.height / h);
  g.lineCap = g.lineJoin = "round";
  paint(g);
  return g.getImageData(0, 0, cv.width, cv.height);
}
function box(g, x, y, w, h, r) { // a rounded rectangle (roundRect is too new for some phones)
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function icon(name, size, ratio) {
  let d = SHAPES[name];
  if (!d) return null;
  if (d.as) d = { ...SHAPES[d.as], k: d.k };
  const { k, f = [], f2 = [], s = [], x = [], w = 2.2, sq, gap, gw = 1.5, big = 1 } = d;
  return picture(size, size, ratio, (g) => {
    g.scale(size / 26, size / 26); // laid out on 26
    const ground = (r, colour) => {
      if (sq) box(g, 13 - r, 13 - r, 2 * r, 2 * r, r * 0.42);
      else { g.beginPath(); g.arc(13, 13, r, 0, 7); }
      g.fillStyle = colour;
      g.fill();
    };
    ground(12.8, EDGE); // a dark edge, to stand off the map
    ground(11.9, DISC[k]);
    const z = ((sq ? 17.5 : 16.2) / 24) * big;
    g.translate(13, 13);
    g.scale(z, z);
    g.translate(-12, -12);
    const fill = (paths, colour) => { g.fillStyle = colour; for (const p of paths) g.fill(new Path2D(p)); };
    const stroke = (paths, colour, width) => { g.strokeStyle = colour; g.lineWidth = width; for (const p of paths) g.stroke(new Path2D(p)); };
    fill(f, WHITE);
    stroke(s, WHITE, Math.max(w, 1.7 / ((size / 26) * z))); // at least 1.7 px on screen, however small
    fill(x, DISC[k]);
    fill(f2, WHITE);
    if (gap) stroke([gap], DISC[k], gw);
  });
}

// What isn't on a disc.
const SHIELD = [0, 14, 20, 26, 31, 36, 40]; // px wide, by characters
const OTHERS = {
  // a hilltop
  peak: (size, ratio) => picture(size, size, ratio, (g) => {
    g.scale(size / 20, size / 20);
    g.beginPath(); g.moveTo(10, 3.5); g.lineTo(17.5, 16.5); g.lineTo(2.5, 16.5); g.closePath();
    g.lineWidth = 2.6; g.strokeStyle = EDGE; g.stroke();
    g.fillStyle = STONE; g.fill();
  }),
  // the box round a road number, by how many characters it has
  shield: (chars, ratio) => picture(SHIELD[chars], 14, ratio, (g) => {
    box(g, 0.4, 0.4, SHIELD[chars] - 0.8, 13.2, 1.7);
    g.fillStyle = PANEL; g.fill();
    g.lineWidth = 0.8; g.strokeStyle = PALE; g.stroke();
  }),
  // one-way roads: an arrow, pointing up
  oneway: (size, ratio) => picture(size, size, ratio, (g) => {
    g.scale(size / 21, size / 21);
    g.fillStyle = PALE;
    g.fill(new Path2D("M10.5.3l4.7 5.3H5.8zM9.6 5h1.8v15.7H9.6z"));
  }),
  // an airport
  plane: (size, ratio) => picture(size, size, ratio, (g) => {
    g.scale(size / 24, size / 24);
    const p = new Path2D("M12 2c1 0 1.6 1 1.6 2.4v5l7.9 4.6v2l-7.9-2.4v4.6l2.2 1.7v1.6L12 20.4l-3.8 1.1v-1.6l2.2-1.7v-4.6L2.5 16v-2l7.9-4.6v-5C10.4 3 11 2 12 2z");
    g.lineWidth = 3; g.strokeStyle = EDGE; g.stroke(p);
    g.fillStyle = PALE; g.fill(p);
  }),
  // the dot by a town's or city's name, zoomed right out: size is its width
  dot: (size, ratio) => picture(size + 2, size + 2, ratio, (g) => {
    g.beginPath(); g.arc(size / 2 + 1, size / 2 + 1, size / 2, 0, 7);
    g.fillStyle = PALE; g.fill();
  }),
};

// Draws each icon the first time the map asks for it.
export function addIcons(map) {
  map.on("styleimagemissing", ({ id }) => {
    const [name, size] = id.split("@"), ratio = map.getPixelRatio();
    const drawn = OTHERS[name] ? OTHERS[name](Number(size), ratio) : icon(name, Number(size), ratio);
    if (drawn && !map.hasImage(id)) map.addImage(id, drawn, { pixelRatio: ratio });
  });
}
