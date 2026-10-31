import { createApp } from "./app.js";
import { buildStyle } from "./mapstyle.js";

// "Dusk": a lighter dark map, so roads and parks are easy to read.
const style = buildStyle({
  land: "#151a22", park: "#173b2f", wood: "#153529", water: "#10304f", building: "#1c222c",
  motorway: "#4a5878", major: "#3b4761", minor: "#283040", service: "#222937", path: "#2e4743", rail: "#2c3342",
  label: "#8a96aa", labelHalo: "#151a22", waterLabel: "#5d86b0", parkLabel: "#5c947f",
}, { labels: "normal" });

// Route: lime line on a soft lime-tinted band. Both are solid, not
// see-through, so overlapping bits can't stack into bright blobs.
const W = (lo, hi) => ["interpolate", ["linear"], ["zoom"], 11, lo, 16, hi];
const layout = { "line-cap": "round", "line-join": "round" };

const desktop = matchMedia("(min-width: 900px)");
createApp({
  style,
  animate: true,
  formatIndex: (i) => String(i + 1).padStart(2, "0"),
  padding: () => {
    const top = document.querySelector(".hud-top").getBoundingClientRect();
    const deck = document.querySelector(".deck").getBoundingClientRect();
    if (desktop.matches) return { top: 60, bottom: 60, left: deck.right + 40, right: 380 };
    return { top: top.bottom + 30, left: 30, right: 30, bottom: innerHeight - deck.top + 30 };
  },
  addRouteLayers(map) {
    map.addLayer({ id: "route-halo", type: "line", source: "route", layout,
      paint: { "line-color": "#4f6328", "line-width": W(6, 13), "line-blur": W(1.5, 4) } });
    map.addLayer({ id: "route", type: "line", source: "route", layout,
      paint: { "line-color": "#c8ff2e", "line-width": W(2.2, 4.5) } });
  },
});

document.getElementById("list-close").addEventListener("click", () => document.body.classList.remove("list-open"));
