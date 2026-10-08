# Changelog

## Unreleased

**Follow the trail.** A line that runs along a mapped path or road is now matched to it, and its stations are known to be on it, the way a crossing is known.

- `engine/follow.ts` samples the line every 5 m and runs a three-state hidden Markov model (off, on a path, on a road) with a heavy-tailed distance term and a heading term. Hand-drawn chords are read as precise and as one observation each; GPS-like lines as noisy and dense.
- On a followed stretch, stations move onto the tread, the path's probability is set to its existence probability (93%) outside the discount, and area sources abstain on it.
- The line's weave across the path it follows no longer makes crossing stations. A crossing of anything else is kept only where the path itself crosses it.
- Path along ten National Park Service trails: 8% → 99.8% of stations. Along three hikers' GPS tracks of the Mist Trail: 2–7% → 87–94%. The demo line is unchanged. Controls for lines drawn beside the trails and by hand are in `docs/validation.md`.
- On the map, the followed stretch turns solid in the path colour, with a faint tie from each station back to where the line put it. Above the transect, a band marks each followed stretch; the header says what the line follows and for how far; a followed station gets two chips, *Following* and *Moved*.
- A **follow** switch on the transect turns matching off, for a transect that runs beside a trail. It's kept in the link (`f=0`) and in recent soundings.
- The transect's hover readout floats over the chart instead of holding 150 px of the header, and the header's controls wrap as one group when space runs out.
- The evidence ledger moves to its own typed module (`ui/ledger.ts`), taking `ui/console.ts` from 472 to 355 lines.

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
