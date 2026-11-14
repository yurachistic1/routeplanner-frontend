# Buttons and controls

The app's button system, **Tonal**, chosen on 2026-11-14 from three options (mockups: `designs/buttons.html`, git-ignored; the reasons are in `ROADMAP.md` §11). Everything you can tap has a fill. Lime is the main step. Selected things go lime with a tick. There are no outlines and no arrows in buttons. All styles are in `css/styles.css`; colours are tokens in its `:root`.

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
| Primary | `.btn.btn-primary` | 52px lime pill, dark 16px semibold text, soft lime glow | Generate · Find · Export GPX (routes and GPS art; Send to Garmin may take this later) · Use it · Continue with Google · Finish signing in |
| Secondary | `.btn.btn-secondary` | 48px pill, `--ltone` fill, `--lime-ink` text | Back · All routes · New run · New search · Email me a sign-in link · Undo · Clear · Sign out · Keep my account |
| Tertiary | `.btn.btn-tertiary`, `.drawer-link` | Lime words, no fill (faint lime when pressed) | Undo in the message bar · Privacy · Delete account |
| Danger | `.btn.btn-danger` | Red `#ff6a5f` pill, dark text | Delete my account |
| Icon button | `.icon-btn` (+ `.close-btn`, `.nav-btn`, `.step`) | 48px circle (`.close-btn` 44px), `--tone` fill, white icon; `.nav-btn` is a 52px pill | − and + · previous and next · close (drawer, dialogs, route list) |
| Toggle | `.icon-btn.fav`, `.ri-heart` | Off: neutral fill, outline heart. On: `#3d1a2b` fill, pink filled heart | Favourite on the panel and on every route card, favourites included: tapping a filled heart removes the route (its card fades and shrinks away, the rest slide up, the list doesn't scroll), with Undo |
| Map button | `.locate-btn`, `.account-btn` | 46px circle, `--float` fill, drop shadow (account 38px, in the top bar) | Satellite (on: `--ltone` with a lime icon) · My location (busy: icon pulses) · Account (signed in: `--ltone`, lime) |
| Choice chips | `.chip` | 40px pill, `--tone` fill. Selected: lime with a tick | Distance presets 5K, 10K, 15K, Half, 30K |
| Choice cards | `.route-item`, `.art-option`, `.art-shape`, `.icon-tile` | `--card` fill, radius 18. Selected: 2px lime edge, olive fill, tick badge | Route cards · Short / Medium / Long · the chosen shape · icons in the picker. Icons and Draw are `--tone` tiles that open a picker |
| Disclosure | `.info-tab` | 30px pill on the panel's top edge, `--float` fill. Open: `--ltone`, lime text | Route info (amber dot: warnings) |
| Field | `.drawer input`, `.sheet-head input`, `.readout input` | `--card` fill, radius 16, 2px lime edge when focused | Email · icon search · the distance |
| Busy | `.go` + `body.loading` | Stays lime; a spinner and "Scanning…" / "Searching…" | Generate, Find |

## Every control

| Control | Where | Role |
|---|---|---|
| Account `#account` | top bar | Map button |
| Map credits `.credits-btn` | under the top bar | Small icon (OSM attribution; open on load, closes after 5s) |
| Satellite `#satellite`, My location `#locate` | over the map, left | Map buttons |
| Back `#back` | loop planning, when there are routes | Secondary: "Back" on phones, "Back to routes" and the Esc key on laptops |
| Back `#art-back` | GPS art, after New search | Secondary, the same as loop's: "Back" beside Find on phones, "Back to results" and Esc above it on laptops |
| Shorter / Longer `#dec`, `#inc` | loop planning | Icon buttons |
| Distance `#distance` | loop planning | Field: at most two digits before the point and one after ("21.1"), trimmed as typed |
| Presets `.chip` | loop planning | Choice chips |
| Generate `#generate` | loop planning | Primary |
| Route info `#info-tab` | routes | Disclosure |
| Previous / Next `#prev`, `#next` | routes | Icon buttons (chevrons) |
| Export GPX `#download`, `#art-download` | routes, GPS art found | Primary |
| Favourite `#fav`, `#art-fav` | routes, GPS art found | Toggle |
| All routes `#list-toggle` (phones), New run `#edit`, New search `#art-new` | routes, GPS art found | Secondary |
| Close `#list-close` | route list (phones) | Icon button |
| Route card `.route-item`, heart `.ri-heart` | route list, favourites | Choice card, toggle |
| Icons / Draw `.art-tool`, chosen shape `.art-shape.active` | GPS art | Tiles; chosen is a selected card. Names wrap to two lines, never cut |
| Find `#art-find` | GPS art | Primary |
| Short / Medium / Long `.art-option` | GPS art found | Choice cards |
| Modes `#modebar` | bottom shelf | Tabs |
| Close `#account-close`, `.sheet-close` | drawer, dialogs | Icon buttons |
| Continue with Google, Finish signing in | drawer | Primary |
| Email me a sign-in link, Sign out, Keep my account | drawer | Secondary |
| Delete my account `#delete-confirm` | drawer | Danger |
| Privacy, Delete account `.drawer-link` | drawer | Tertiary |
| Icon tile `.icon-tile` | icon picker | Choice card |
| Undo, Clear / Use it | draw dialog | Secondary / Primary |
| Undo `#undo-btn` | message bar | Tertiary |

## Before (2026-11-14)

What friends found: grey text at 4.1:1, grey button edges at 1.2:1 (they looked switched off), labels 10–13px in spaced-out capitals, flat buttons with patchy pressed, focus and disabled looks, main actions split between lime fill and lime outline, three different close buttons, a bin in favourites, and arrows in Generate, Find, Back, Export GPX and ◀ ▶.
