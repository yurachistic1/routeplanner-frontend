// The bottom panel's moving parts, shared by the modes that use them (GPS
// art and A to B; moved out of art.js on 2026-11-20).
//
// createSmoother(): parts of the panel that appear or fold away grow and
// shrink in place (height, the grid gap beside them, and fading), so the
// panel's top edge glides and the main button stays put at the bottom.
//
// attachGrip(): the grip on the panel's top edge (phones, UI.md "Grip")
// folds the panel and opens it again: tap it, or drag it down or up.

const EASE = "cubic-bezier(.2, .8, .2, 1)", DUR = 280;
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// Returns smooth(els, show, apply). show: apply() makes els visible first,
// then they grow; hide: they shrink, then apply() hides them. gap is the
// grid gap (px) each one takes with it. Nothing moves with reduced motion.
// smooth() returns a promise that settles when the panel has stopped
// moving (rejected if another smooth() cut it short).
export function createSmoother(gap = 10) {
  let folding = []; // animations still running
  return function smooth(els, show, apply) {
    for (const a of folding) a.cancel();
    folding = [];
    if (calm()) return Promise.resolve(apply());
    if (show) apply();
    const anims = els.filter((el) => el.offsetHeight > 0).map((el) => {
      const side = el.previousElementSibling ? "marginTop" : "marginBottom";
      // padding and borders close too, or they'd be left to jump at the end
      const cs = getComputedStyle(el);
      const open = {
        height: `${el.offsetHeight}px`, [side]: "0px", opacity: 1,
        paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, borderTopWidth: cs.borderTopWidth, borderBottomWidth: cs.borderBottomWidth,
      };
      const shut = {
        height: "0px", [side]: `-${gap}px`, opacity: 0,
        paddingTop: "0px", paddingBottom: "0px", borderTopWidth: "0px", borderBottomWidth: "0px",
      };
      el.style.overflow = "hidden";
      const a = el.animate(show ? [shut, open] : [open, shut], { duration: DUR, easing: EASE, fill: "forwards" });
      a.finished.then(() => { el.style.overflow = ""; }, () => { el.style.overflow = ""; });
      return a;
    });
    folding = anims;
    const done = Promise.all(anims.map((a) => a.finished)).then(() => {
      if (!show) apply();
      anims.forEach((a) => a.cancel());
    });
    done.catch(() => {}); // cut short: nobody needs telling
    return done;
  };
}

// grip: the .deck-grip button. isFolded() says whether the panel is folded
// now; setFolded(on) folds or opens it (and keeps the grip's aria-expanded
// and label right).
export function attachGrip(grip, { isFolded, setFolded }) {
  let dragY = null, dragged = false;
  grip.addEventListener("pointerdown", (e) => { dragY = e.clientY; dragged = false; grip.setPointerCapture(e.pointerId); });
  grip.addEventListener("pointermove", (e) => {
    if (dragY === null) return;
    const dy = e.clientY - dragY;
    if (Math.abs(dy) < 24) return;
    dragged = true;
    setFolded(dy > 0);
    dragY = null;
  });
  grip.addEventListener("pointerup", () => { dragY = null; });
  grip.addEventListener("pointercancel", () => { dragY = null; });
  grip.addEventListener("click", () => {
    if (dragged) { dragged = false; return; }
    setFolded(!isFolded());
  });
}
