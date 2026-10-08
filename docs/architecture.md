# Architecture

```
            ┌──────────── data/ ────────────┐        ┌──────────── engine/ (pure) ─────────────┐
 user ──▶ app/actions ──▶ app/sound.runSounding ──▶ fetch per source ──▶ StationFacts (sh) ─┐
   ▲        │                    │                                                       ├─▶ computeParts ─▶ fuseParts ─▶ Fused
   │        │                    └─▶ openfreemap+mvt ─▶ geometry.buildGeo ─▶ geoAt (q) ──┘        │
   │        │                                                                                     ├─▶ smoothChain (paths)
   │        │                                                                                     └─▶ field.fieldFuse ─▶ positional (GPS ±σ)
   │        ▼
   └── ui/console · ui/transect · map/draw  ◀── STATE.results[i].view
```

## Layers

| Folder | Role | Rules |
|---|---|---|
| `core/` | classes, priors, sources table, math, geometry, DOM helpers, shared types | no imports outside `core/` |
| `data/` | one module per external source; `http.ts` holds `jget`, the IndexedDB cache and a request pool | network only; no engine, no UI |
| `engine/` | geometry queries, per-source evidence, fusion, field map, smoothing, path following, narration | **pure**: no DOM, no network; testable in Node |
| `app/` | `STATE`, station layout and crossings, the sounding run, user actions | orchestrates data → engine → UI |
| `map/` | canvas map, drawing, pointer/touch interaction, lock | reads `STATE`, calls `app/actions` |
| `ui/` | console panels, transect, menus, dialogs | reads `STATE`; `render()` is the single redraw |
| `io/` | coordinate parsing, files, search, URL hash, history, export | |
| `main.ts` | boot, `window.underfoot` console handle | |

Cycles exist between `app`, `map`, `ui` and `io` (a click selects a station, which re-renders the console, which redraws the map). They're function-level only: no module reads another's binding while it's being evaluated. Keep it that way. Top-level code in those folders should only declare.

## The data shapes that matter

- **`StationFacts`** (`sh`): everything the data layer learned about a station that isn't geometry: NLCD class and fractions, terrain rosette, imagery metadata, gazetteer reply, which services are in range.
- **`GeoQuery`** (`q`): `geoAt(G, x, y)` — enclosing polygons, nearest feature per class, building distances, map density, and `crossing` at a crossing station.
- **`SourcePart`**: `{ ll, status, note, wmul?, exact? }` — a centred log-likelihood per class and the reasoning.
- **`Fused`**: probabilities, order, top class, confidence, τ, and a ledger row per source with its contribution in bits.

All defined in `src/core/types.ts`.

## State

`STATE` (`app/state.ts`) holds the mode, vertices, stations, results, selection, weights, N_eff, prior, GPS σ, smoothing, the field and the run id. Every async reply checks its `runId` against `STATE.runId` before writing, so a new sounding silently orphans the old one's replies. `MAP` (`map/map.ts`) holds the view, pointer state, drawing and lock.

## Builds

- `vite.config.ts` → `dist/`: the site, hashed assets, deployed by `.github/workflows/pages.yml`.
- `vite.single.config.ts` → `dist-single/underfoot.html`: everything inlined, runs from `file://`. CI uploads it as an artifact; tagged releases attach it.

## Console

`window.underfoot` exposes `STATE`, `MAP`, the engine (`fuseParts`, `computeParts`, `fieldFuse`, `positional`…), the parsers and the actions. The browser tests copy it onto `window` so `page.evaluate(() => STATE.results[0])` works.

## TypeScript migration

Typed: `core/*`, `engine/fuse.ts`, `engine/follow.ts`. All code is formatted with Prettier (`npm run format`; CI checks it). Next in order of payoff: `engine/evidence.ts` (gives `StationFacts` a real shape), `engine/geometry.ts`, `engine/field.ts`, `engine/smooth.ts`, then `data/*`. `grep -rl "@ts-nocheck" src | wc -l` is the progress meter.
