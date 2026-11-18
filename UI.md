# Buttons and controls

The app's design system for everything you tap, read or type into: **Tonal**, chosen on 2026-11-14 from three options (mockups: `designs/buttons.html`, git-ignored; the reasons are in `ROADMAP.md` §11). Everything you can tap has a fill. Lime is the main step. Selected things go lime (no ticks: they cost space and the lime edge or fill already shows it, 2026-11-15). There are no outlines and no arrows in buttons. All styles are in `css/styles.css`; colours are tokens in its `:root`.

**This file is the rulebook for every addition to the UI** (the user, 2026-11-14: surfaces must stay readable, usable and consistent, and reuse the existing designs in a way that makes sense). Read it before adding or changing any control, panel or text. Keep it up to date: a new kind of control is written up here as part of the same change.

## Principles

1. **Readable.** Text meets the contrast and size rules below on the surface it actually sits on (panel, card, map). Nothing to read sits straight on the map without a panel behind it.
2. **Usable.** Targets of 44px or more, every state visible (pressed, focus, disabled, busy, selected), and it works by touch, mouse and keyboard. Phones come first; check laptops too.
3. **Consistent.** The same job looks and behaves the same everywhere. A new control is built from the existing roles and tokens, not given its own colours, shapes or type.
4. **Reuse what makes sense.** Pick the existing role whose meaning fits (a choice of a few is chips, an action is a button, on/off is a toggle). If nothing fits, extend the system with a new pattern written up here, made of the same tokens, rather than a one-off. When it's unclear which pattern fits, ask the user before building.

## Adding something new: checklist

- Which role or pattern is it? Use its class (`.btn-*`, `.icon-btn`, `.chip`, card) rather than new CSS. A pattern from "Not built yet" below gets built as written there.
- Colours only from the `:root` tokens; no new hex values in components. Lime is for the main step and for selected or on; pink only for favourites and the logo's dot; amber only for warnings; red only for danger.
- Sentence case, no arrows, one primary per panel.
- Text: 15px for body and notes, 13px the smallest anything readable gets, `--dim` for secondary text, never the old `#6c7889`.
- States: rest, pressed, focus-visible, disabled, and selected or busy where they apply; hover only inside `@media (hover: hover)`.
- Layout: fits a 360px-wide phone without cutting text (wrap to two lines rather than cut), and leaves no odd gaps on laptops.
- Check it in Chrome at phone size (`designs/phone.html`) and laptop size before calling it done, and add it to "Every control" below.

## Not built yet: how they should look

Specs for controls the app will likely need, so they arrive already consistent. Build them as written; change this section first if something has to differ.

- **Slider** (built 2026-11-16 as `.slider` in `.slider-field`, first used in GPS art's Custom sheet) (a range, e.g. hilliness, distance tolerance): a 6px track in `--tone`, the part up to the thumb lime; a 28px white thumb (`--text`) with a soft shadow, inside a 44px-tall touch area. The current value sits as text above the right end, 15px semibold, in `--text` (units in `--dim`). Label above the left end in `--dim`, 14px semibold, sentence case. Pressed: the thumb grows to 32px. Focus: the 3px lime outline round the thumb. Disabled: track `#1a2029`, thumb `#566070`. Arrow keys step it. If there are only a few fixed values, use chips instead.
- **Switch** (on/off for a setting): a 52×32 pill in `--tone` with a 24px white knob; on, the pill turns lime and the knob dark (`#0b1004`) slides right. The label sits to its left in `--text`, with any explanation below in `--dim`. The whole row is the target. For an action that toggles (favourite, satellite), keep using the toggle icon buttons instead.
- **Segmented control** (2–4 views of one thing, e.g. Map / Satellite / Hills): a `--card` pill holding equal segments; the chosen one is a lime pill with dark text (no tick needed, the shape shows it). More than 4, or choices that aren't views: chips.
- **Checkbox and radio** (in forms): 24px, `--tone` fill; checked is lime with the dark tick (`--tick`), or a dark dot for radio. The label is the target too.
- **Field with label, hint and error**: label above in `--dim` 14px semibold, the field as in Roles, hint below in `--dim` 14px; an error replaces the hint in `#ffd3e4` with a 2px `#ff6a5f` edge on the field. Say what's wrong and how to fix it.
- **Progress** (a long job with steps): a 6px `--tone` track filling lime, with a sentence in `--dim` saying what's happening. A short wait inside a button uses the button's spinner instead.
- **Grip** (built 2026-11-16, `.deck-grip`, GPS art on phones): a 40×5 pill in `--dim-2` on the panel's top edge, inside a full-width 44px-tall target. Tap or drag down folds the panel to its first row and its main button (Generate stays). Every fold, and the Where row appearing, animates its height (280 ms, the panel's top edge glides; none with reduced motion); tap again or drag up opens it. Pressed: the pill turns `--text`. Focus: the lime outline round the pill. `aria-expanded` says which.
- **Panels, sheets and dialogs**: `--panel` fill, radius 24–26px, close is the cross icon button top right, at most one primary at the bottom. Headings 18–22px bold in `--text`.
- **Connection card** (built 2026-11-17 as `.conn`, used for Garmin Connect in the account menu and the export dialog): a linked service under a small section label (`.drawer-label`, 14px semibold `--dim`, e.g. "Watch"). A `--card` block, radius 18, 14px padding: the service's official tile at 32px (unaltered, from the service's own brand assets), its name in full in 16px semibold `--text` (never shortened: Garmin's API brand guidelines), and a 14px status line in `--dim` beside it. The action sits underneath at full width so every state keeps the same shape: not connected is a secondary button ("Connect"; busy keeps the secondary look with the spinner, "Opening Garmin…"); connected turns the status line `--lime-ink` with an 8px lime dot ("Connected") and the action becomes tertiary words ("Disconnect", instant, no confirm). A problem shows below the card in `#ffd3e4`, 15px.
- **Elevation profile** (built 2026-11-18 as `.profile`, `js/profile.js`, in route info): to be read, not to look clever. A header line: "Elevation" in `--dim` 14px semibold on the left, the climb on the right ("**48** m climb": the number 15px semibold mono in `--text`, words in `--dim`). Under it a 112px chart (84px on screens under 720px tall) the drawer's width: the route's line in `--neon`, 2px, over a fill fading from neon at 28% to nothing; at most four round-number gridlines (1, 2, 5, 10, 20, 25, 50… m) labelled in 13px mono `--dim`, units left to the header; km along the bottom in the same type, about 56px apart at least and six marks at most, "km" on the last; the start as a pink dot, as the start marker on the map. The height axis spans at least 10 m, so a flat route looks flat. The line is smoothed over 1.5% of the route (at least 100 m), so it shows hills, not wiggles; the climb in the header is the backend's. Routes found together share one scale, so their charts compare (2026-11-18, the user): distance runs to the distance asked for (or the longest route, if further), marked with a dashed `--dim-2` line, so a short route's line stops before it and a long one's runs past; the marks land on the distance asked for where a round step allows (0, 2.5, 5, 7.5, 10); height runs from the lowest to the highest of them all, so a hilly route squashes the flat ones, honestly. Favourites, from anywhere, each get their own scale and no dashed line. Reading it: drag (touch), hover (mouse) or the arrow keys (it's a focusable slider; Home, End, Esc) show a dashed line and a lime dot on the chart, the header becomes "**3.7** km · **19** m", and a lime dot with a dark ring sits on the route on the map. Focus: the lime outline round the chart. Routes without heights (favourites saved before heights) don't show it.
- **Sort toggle** (built 2026-11-18 as `.sort-btn`, `#list-sort`, sorting the route list by climb): a 44px icon button (`--tone`, white icon) right after the list's title, on the left, so it's well away from the close button on phones; laptops the same. Its icon is a hill with three bars beside it (bars, not arrows): equal when in the usual order, short to long for lowest first, long to short for highest first. Taps cycle usual order → lowest first → highest first → usual order. Sorted, it's on like the Satellite toggle (`--ltone`, `--lime-ink` icon) and a note beside it says which order, 14px `--dim` ("Lowest climb first"); its name says the same and what the next tap does. Sorting scrolls the list to the top and leaves the route on screen; previous and next follow the list's order, and each route keeps its number. A new search starts in the usual order; coming back from favourites keeps the order you left. Not in favourites (newest first).
- **Messages**: a problem is the pink toast; something undoable is the `#undo` bar with a tertiary action. Badges or counts: `--ltone` with `--lime-ink` text, at least 12px.

## Rules

- **One primary per panel.** If two buttons both feel primary, one of them is secondary.
- **Sentence case** everywhere ("Export GPX", "New run"). No spaced-out capitals on controls.
- **No arrows** in buttons. Previous and next use chevrons. Icons that mean something (heart, close, search, pencil) are fine, alone or next to words.
- **Text contrast:** main text `--text` (15.8:1 on the panel), secondary text `--dim` `#aeb8c6` (9.2:1) for notes, labels and hints, small print `--dim-2` (6.1:1). Nothing people need to read is under 13px; notes are 15px.
- **Every control has** a pressed look (shrinks to 96% and darkens), a keyboard focus look (3px lime outline, 3px out), and a disabled look (`#1a2029` fill, `#566070` text). Hover (laptops only) lightens the fill. Disabled is the only thing that looks faded.
- **Targets** are at least 44px; most are 48–52px.
- **Laptops:** the heart sits at the end of the Export row (‹ Export GPX › ♥, or Export GPX ♥ in GPS art), with New run / New search on a row below; favourites have just the one row. Phones keep the heart beside All routes and New run.
- **Mode shelf:** every mode looks the same (grey icon, white on a lime pill with a lime label when current). No per-mode colours.

## Roles

| Role | Class | Look | Used for |
|---|---|---|---|
| Primary | `.btn.btn-primary` | 52px lime pill, dark 16px semibold text, soft lime glow | Generate (loops and GPS art, 2026-11-16: GPS art's was Find) · Export GPX / Export (routes and GPS art) · Send to Garmin Connect and Done (export dialog) · Use it · Continue with Google · Finish signing in |
| Secondary | `.btn.btn-secondary` | 48px pill, `--ltone` fill, `--lime-ink` text | Back · All routes · New run · New search · Email me a sign-in link · Undo · Clear · Sign out · Keep my account · Connect (Garmin Connect) |
| Tertiary | `.btn.btn-tertiary`, `.drawer-link` | Lime words, no fill (faint lime when pressed) | Undo in the message bar · Privacy · Delete account · Disconnect (Garmin Connect) |
| Danger | `.btn.btn-danger` | Red `#ff6a5f` pill, dark text | Delete my account |
| Icon button | `.icon-btn` (+ `.close-btn`, `.nav-btn`, `.step`) | 48px circle (`.close-btn` 44px), `--tone` fill, white icon; `.nav-btn` is a 52px pill | − and + · previous and next · close (drawer, dialogs, route list) |
| Toggle | `.icon-btn.fav`, `.ri-heart` | Off: neutral fill, outline heart. On: `#3d1a2b` fill, pink filled heart | Favourite on the panel and on every route card, favourites included: tapping a filled heart removes the route (its card fades and shrinks away, the rest slide up, the list doesn't scroll), with Undo |
| Map button | `.locate-btn`, `.account-btn` | 46px circle, `--float` fill, drop shadow (account 38px, in the top bar) | Satellite (on: `--ltone` with a lime icon) · My location (busy: icon pulses) · Account (signed in: `--ltone`, lime) |
| Choice chips | `.chip` | 40px pill, `--tone` fill. Selected: solid lime, dark text | Distance presets 5K, 10K, 15K, Half, 30K |
| Choice cards | `.route-item`, `.art-option`, `.art-shape`, `.icon-tile` | `--card` fill, radius 18. Selected: 2px lime edge, olive fill | Route rows (full width, 74px tall: 48px shape, 22px distance over 15px number and area, the climb with a hill icon (15px mono `--dim`, "117 m"; it was ± km until 2026-11-18), 44px heart; 2026-11-16). GPS art favourites keep their shape's name for Garmin courses but don't show it: the thumbnail shows the shape. The second line never wraps, so rows stay even: only the area name shortens with "…", its full name as a tooltip (2026-11-17, an exception to wrap-not-cut) · Short / Medium / Long · the chosen shape · icons in the picker. Icons and Draw are `--tone` tiles that open a picker |
| Disclosure | `.info-tab` | 30px pill on the panel's top edge, `--float` fill. Open: `--ltone`, lime text | Route info, on every route, favourites included (amber dot: warnings) |
| Field | `.drawer input`, `.sheet-head input`, `.readout input` | `--card` fill, radius 16, 2px lime edge when focused | Email · icon search · the distance |
| Busy | `.go` + `body.loading` | Stays lime; a spinner and "Scanning…" / "Searching…" | Generate (both modes) |

## Every control

| Control | Where | Role |
|---|---|---|
| Account `#account` | top bar | Map button |
| Map credits `.credits-btn` | under the top bar on phones; top right above Satellite on laptops, text sliding out to the left | Small icon (OSM attribution; open on load, closes after 5s) |
| Satellite `#satellite`, My location `#locate` | over the map: above the panel on phones; on laptops together with the ⓘ at the top right of the map, moving aside for the route list (2026-11-16: a tall panel pushed them over the top bar). On phones they fade out when a tall panel leaves them no room under the top bar and the ⓘ (8px clear; a short phone with route info open and warnings, 2026-11-18): Satellite first, My location only if it doesn't fit either; they come back as the panel shrinks | Map buttons |
| Back `#back` | loop planning, when there are routes | Secondary: "Back" on phones, "Back to routes" and the Esc key on laptops |
| Back `#art-back` | GPS art, after New search | Secondary, the same as loop's: "Back" beside Generate on phones, "Back to results" and Esc above it on laptops |
| Shorter / Longer `#dec`, `#inc` | loop planning | Icon buttons |
| Distance `#distance` | loop planning | Field: at most two digits before the point and one after ("21.1"), trimmed as typed |
| Presets `.chip` | loop planning | Choice chips |
| Generate `#generate` | loop planning | Primary |
| Route info `#info-tab` | routes | Disclosure |
| Elevation profile `#profile` | route info, routes with heights | Elevation profile |
| Previous / Next `#prev`, `#next` | routes | Icon buttons (chevrons) |
| Export GPX `#download`, `#art-download` | routes, GPS art found | Primary. Says "Export" and opens the export dialog where there's a Garmin service (staging, local); otherwise downloads the GPX at once |
| Export dialog `#export-dialog` | from Export | Sheet: the route line (distance, kind, place), the Garmin Connect connection card, then the buttons. The primary goes to what can be done now: Send to Garmin Connect when connected with Courses allowed (busy "Sending…", then the card's line turns lime "Sent to Garmin Connect. It goes to your watch at its next sync." and the primary becomes Done), otherwise Download GPX; Connect or Sign in sit inside the card. A failed send shows the pink note and keeps Send |
| Favourite `#fav`, `#art-fav` | routes, GPS art found | Toggle |
| All routes `#list-toggle` (phones), New run `#edit`, New search `#art-new` | routes, GPS art found | Secondary |
| Close `#list-close` | route list (phones) | Icon button |
| Sort by climb `#list-sort` | route list heading, results only | Sort toggle |
| Route row `.route-item`, heart `.ri-heart` | route list, favourites (newest first, no grouping) | Choice card, toggle |
| Icons / Draw `.art-tool`, chosen shape `.art-shape.active` | GPS art | Tiles; chosen is a selected card. Names wrap to two lines, never cut |
| Generate `#art-find` | GPS art | Primary |
| Short / Medium / Long `.art-option` | GPS art found | Choice cards. A Custom search shows Best / 2nd / 3rd (best fit first, at different places, opening on Best), or one Nearest card marked "Outside settings" in amber with a message saying how it misses. Free placement shows one card, "Your shape", "Exact" |
| Where: Default / Custom / Free placement `.art-mode` | GPS art, once a shape is chosen | Choice cards, all three identical (icon and one-line label); Custom opens a sheet and its values show in the note below, as a 16px semibold line in `--text` |
| Route distance, Start within `.slider` | GPS art's Custom sheet | Sliders; Use these is the primary |
| Selection box `.place` | GPS art free placement, on the map | Like a picture in a slide deck: the shape in lime inside a dashed white frame; drag the box to move, a white square on any corner to resize (ratio kept), the lime round handle on a stem above to turn (settles on 0/90/180/270), pinch to resize on touch screens. Corners and handle have 44px targets. Keyboard: arrows move, + and − resize, [ and ] turn |
| Grip `#art-grip` | GPS art panel, phones | Grip |
| Modes `#modebar` | bottom shelf | Tabs |
| Close `#account-close`, `.sheet-close` | drawer, dialogs | Icon buttons |
| Continue with Google, Finish signing in | drawer | Primary |
| Email me a sign-in link, Sign out, Keep my account | drawer | Secondary |
| Garmin Connect card `#garmin`: Connect `#garmin-connect`, Disconnect `#garmin-disconnect` | drawer, signed in (staging and local only until Garmin's notice period ends, 2026-12-17) | Connection card: Secondary / Tertiary |
| Delete my account `#delete-confirm` | drawer | Danger |
| Privacy, Delete account `.drawer-link` | drawer | Tertiary |
| Icon tile `.icon-tile` | icon picker | Choice card |
| Undo, Clear / Use it | draw dialog | Secondary / Primary |
| Undo `#undo-btn` | message bar | Tertiary |

## Before (2026-11-14)

What friends found: grey text at 4.1:1, grey button edges at 1.2:1 (they looked switched off), labels 10–13px in spaced-out capitals, flat buttons with patchy pressed, focus and disabled looks, main actions split between lime fill and lime outline, three different close buttons, a bin in favourites, and arrows in Generate, Find, Back, Export GPX and ◀ ▶.
