# Changelog

## Unreleased

**M2 · Learning loop.**

**Walk check list.** The spots on a line most worth checking on the ground: the most doubtful stations, one per 40 m, five at most, numbered in walking order.

- The numbers sit beside their stations on the map, on the transect's doubt band, and in the route card's *Worth a look* column, whose *Check list* button opens the list. Each spot gives its call and why it's worth a look; tap one to go to that station.
- **Export GPX** (in the list, or Export ▸ Check list) saves the spots as GPX 1.1 waypoints for a phone or a GPS unit: the number and call as the name, the reason as the note, and a link that reopens the line with that station selected. Links take a new `at=` (metres along the line) for that.
- The GeoJSON's `route_report` gains `check_list`.

**Doubt map.** Each station gets a doubt score from 0 to 1: how close the call is, and how many of the sources with an opinion lean another way. At 0.5 or more a station is worth a look.

- On the map, an amber halo around each station worth a look, brighter the more doubtful.
- On the transect, a doubt band under the call strip.
- Under the answer, *Worth a look* and the reason in plain words: *grass 49% or forest 48% · the map says grass, land cover says forest*, or *the map says bare ground, the photo says snow*.
- Exports carry it: `doubt` in the CSV and in each GeoJSON station.
- The route card's *Unsure* column, which listed stations under 40% confidence, becomes *Worth a look*, and the GeoJSON's `route_report.doubtful_stations` follows it.
- The demo line has 15 of 60 stations worth a look. Lines that follow the Mist Trail, Valley Loop and Bright Angel have none. Seasonal snow over mapped rock at the Aletsch glacier, the one confident miss in `docs/validation.md`, still reads bare 95%, and is now marked worth a look. The cases are in `docs/validation.md`; the method is in `docs/method.md`.

## 1.1.1 — 2026-10-08

- **Clicks on the map did nothing in 1.1.0.** Pressing the map threw `liveOn is not defined`: Here's check that holds map edits was missing its import. Clicking, dragging the probe and drawing lines work again.
- The browser tests missed it because they copy the console handle onto `window`, which turns every export into a global. The interaction suite now starts with the page exactly as shipped, and `npm run check` (and CI) runs a new `npm run names`, which finds names the untyped modules use without declaring or importing them.
- Here's status pill no longer shows as an empty outline when Here is off.

## 1.1.0 — 2026-10-08

**M1 · Go public.** Underfoot in your pocket: it follows the trail you're on, reads the ground under you as you walk, sums up a line, and makes a picture of the answer to share.

**Share card.** Export ▸ Share card, or the button under the answer on a phone, makes one picture of the call with the link that reopens it: 1200 × 630, a JPEG of about 150 KB. The map is drawn fresh for the card (satellite, no buttons or hints, credits kept). A point shows the call, its top three, the place, the coordinates, the date and the sources heard from; a line shows its share of length per call, its crossings and climb, and what it follows. A phone hands it to the share sheet; a desktop downloads it and copies the link.

**Route surface report.** A card above the transect sums up a line: share of length per call, what it crosses (with names), climb and descent, the steepest grade, the longest unbroken stretch of each call, and the stations under 40% confidence, each a tap away. It's one line and a bar until opened (open by default on screens 1000 px or taller), and the choice is remembered. Every GeoJSON export carries it as `route_report`.

- A crossing now covers what it crosses at its mapped width, in the report and on the transect's call strip alike, so an 8 m street counts 8 m rather than the gap to its neighbouring stations. On the demo line, path drops from 121 m to 64 m. Paved stays near 90 m: three road crossings make 27 m of it, and the rest is ordinary stations near the roads and a car park that the engine itself calls paved.

**Here.** A button under the zoom buttons follows your phone and reads the ground under you as you walk.

- The newest fix is read together with the last 200 m of fixes behind it, using the trail matcher with an open end (a live track's end is "now"). On the Mist Trail, a fix 16 m off in the trees reads *path 91%, on Mist Trail* instead of bare ground 74%.
- A fix is re-read only when it moves farther than its own accuracy, and one worse than ±50 m isn't read. The probe's spread is the fix's own accuracy.
- On the map: the recent fixes, the fix's accuracy disc, a tie to where it was read, and the walker. A status pill gives the accuracy and the fix's age; the station panel gets a *Fix* chip.
- **Rec** records the walk; **Stop** reads it as a line. Location turned off gets a plain message; the rest of the app carries on.
- While Here is on, map taps peek instead of moving the probe, the gazetteer is asked at most once a minute, and recent soundings keep only the last reading.
- `app/sound.ts` loses its terrain helpers (now `engine/terrain.ts`, typed) and its field-map scheduler (now `app/field.ts`, typed), going from 482 to 376 lines.

**Follow the trail.** A line that runs along a mapped path or road is now matched to it, and its stations are known to be on it, the way a crossing is known.

- `engine/follow.ts` samples the line every 5 m and runs a three-state hidden Markov model (off, on a path, on a road) with a heavy-tailed distance term and a heading term. Hand-drawn chords are read as precise and as one observation each; GPS-like lines as noisy and dense.
- On a followed stretch, stations move onto the tread, the path's probability is set to its existence probability (93%) outside the discount, and area sources abstain on it.
- The line's weave across the path it follows no longer makes crossing stations. A crossing of anything else is kept only where the path itself crosses it.
- Path along ten National Park Service trails: 8% → 99.8% of stations. Along three hikers' GPS tracks of the Mist Trail: 2–7% → 87–94%. The demo line is unchanged. Controls for lines drawn beside the trails and by hand are in `docs/validation.md`.
- On the map, the followed stretch turns solid in the path colour, with a faint tie from each station back to where the line put it. Above the transect, a band marks each followed stretch; the header says what the line follows and for how far; a followed station gets two chips, *Following* and *Moved*.
- A **follow** switch on the transect turns matching off, for a transect that runs beside a trail. It's kept in the link (`f=0`) and in recent soundings.
- The transect's hover readout floats over the chart instead of holding 150 px of the header, and the header's controls wrap as one group when space runs out.
- **Bridges.** A river crossed on a mapped bridge is crossed on the deck: the crossing station takes the bridge's class (path, road or rail) instead of water, and a ford stays water. Lines drawn along the 13 mapped bridges around the demo line had a water station on 10 of them (91–98%); they now read the bridge.
- The evidence ledger moves to its own typed module (`ui/ledger.ts`), taking `ui/console.ts` from 472 to 355 lines.
- **Long lines in links.** A link used to keep 80 points of a line, so a 12.7 km trail came back with 160 m chords. A line of more than 12 points now goes in the link simplified to 1 m and encoded (`p=`, URL-safe, about four characters a point): the Bright Angel Trail's 2,286 points make a 3.1 KB link. Short lines keep readable coordinates (`v=`), and old links still open. Recent soundings keep long lines the same way. The *Report a wrong call* link uses a coarser line to stay under GitHub's URL limit.
- **3DEP cell sizes.** 3DEP reports the 10 m DEM's cell size in degrees, and it was read as metres: the ledger printed "USGS 3DEP 0.0000926 m" and the transect said "3DEP 1 m" everywhere. Cell sizes are now metres, the transect gives the range along a line, and the fine terrain kernel covers cells up to 15 m.
- **Rivers wider than their guess.** Inside a mapped river polygon, a waterway centreline's guessed half-width (8 m for any river; the Merced is 33 m bank to bank) no longer counts against water.

## 1.0.0 — 2026-10-07

**Underfoot.** The first public release. SOUNDING, the single-file app this grew from, is renamed Underfoot and becomes an open-source project. A probe is still called a sounding.

**M0 · Foundation.** The single-file app becomes a project.

- Vite + TypeScript, 42 ES modules in `src/` (core, data, engine, app, map, ui, io) instead of nine script blocks sharing globals.
- Two builds from one source: the site (`dist/`, GitHub Pages) and the offline `underfoot.html` (`dist-single/`), 143 KB instead of 181 KB.
- Typed: `core/*`, `engine/fuse.ts` and the shared contracts in `core/types.ts`. The rest carries `// @ts-nocheck` until it's typed.
- Tests: 42 unit tests (engine fixtures, smoothing, field map, GPS, coordinate parsing) in Vitest; 50 browser checks (soundings, mouse, touch, lock) in Playwright. Prettier formatting enforced in CI.
- CI on every push, deploy to Pages on `main`, `underfoot.html` attached to each tagged release, weekly canary against the live APIs.
- `window.underfoot` exposes state, engine (evidence, fusion, field map, narration) and parsers in the browser console.
- Export → **Report a wrong call** opens a prefilled GitHub issue for the sounding on screen.
- Recent soundings and the lock carry over from SOUNDING-era browser storage.
- A link to another sounding opened in a tab that's already showing Underfoot now loads it (it used to be ignored until a reload).

**National parks.** The demo line now crosses Yosemite Valley: from the Ansel Adams Gallery over Village and Northside Drives, through Cook's Meadow, across the Merced River and Southside Drive to the Valley Loop Trail. Six classes and thirteen crossings in 900 m. The README examples and the test scenes moved with it.

**Real-trail validation.** Ten National Park Service trails ship as GPX fixtures in `tests/fixtures/trails/` (`npm run trails:fetch` refreshes them), and `npm run trails` walks the app along each one and along three hikers' public GPS tracks of the Mist Trail. Path comes out at 8% of stations, in the top two at 91%: the engine names the land a trail runs through. The results are in `docs/validation.md`; the fix is *Follow the trail* in M1.

## Before the public release: SOUNDING

SOUNDING was a single HTML file. Its versions are kept here for the record.

### 3.1 — 2026-10-07

- **Lock**: a padlock (and `K`) freezes the probe or line. Dragging pans, clicks pick stations, touch taps peek at the field.
- Station and vertex hit-testing picks the nearest within reach rather than the first.

### 3.0 — 2026-10-07

- OpenStreetMap data from OpenFreeMap vector tiles with an in-page MVT decoder. The Overpass API refused pages opened from disk (HTTP 406), so v2 often ran without OSM at all.
- Imagery classifier refitted on 1,038 labelled patches: log-loss 2.90 → 1.54, balanced accuracy 34% → 49% (region-held-out).
- New sources: FEMA USA Structures, NLCD canopy / impervious / descriptor, USGS 3DEP 1 m terrain.
- Crossing stations wherever a path crosses a mapped road, trail, rail line or stream.
- Field map (2 m grid, 120 m square) and GPS uncertainty (±3/5/10 m).
- Forward–backward smoothing along paths, cover classes only.
- Edge-aware containment, heavy-tailed terrain scoring, ±8 nat cap per source.
- Phone layout: two-row toolbar, Undo/Done while drawing, long-press to delete a vertex.
- Search, recent soundings, URL links, GeoJSON/CSV export, table view.

### 2.0 — 2026-09

- Faster acquisition, fixed the probe moving while panning, added 3DEP, canopy and building data.

### 1.0 — 2026-09

- First version: point and path probing, Bayesian fusion of OSM, imagery and land cover, transect ribbon.
