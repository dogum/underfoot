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
| `data/` | one module per external source; `http.ts` holds `jget`, the IndexedDB cache and a request pool; `platform.ts` is what a host provides that a browser and Node do differently (decoding pictures, the cache) | network only; no engine, no UI |
| `engine/` | geometry queries, per-source evidence, fusion, field map, smoothing, path following, doubt and the check list, route report, narration, the time machine's smoothing across captures, batch grouping | **pure**: no DOM, no network; testable in Node |
| `sounding/` | a sounding without a page: the run's shape, station layout and crossings, laying a line on the map, the readers for every source, terrain, fusing a run, getting across, an area's tiles, a spot's history | no DOM; takes the run as an argument (the app passes `STATE`); a test keeps it free of `app/`, `ui/`, `map/` and `io/` |
| `headless/` | Node as the host (decoders, cache, User-Agent), a sounding (a point, a line, an area or a group of points) to a deadline, and many points in groups (`headless/batch`): the base for the MCP server and the command line | built on its own into `dist-headless/`; a signal ends any of them early |
| `mcp/` | the MCP server: `underfoot_point` and `underfoot_path` (`mcp/server`), the longer jobs `underfoot_points`, `underfoot_area` and `underfoot_history` with progress and cancelling (`mcp/jobs`), the envelope every answer comes in (`mcp/envelope`, `mcp/answers`), reading a track or an outline from text, and three resources | read-only tools; nothing on stdout but the protocol |
| `app/` | `STATE`, the page's part of a sounding (the link, Here, an area, Recent, redrawing), the field map, the time machine's strip (`app/years`), batch points (`app/batch`), user actions | orchestrates sounding → UI |
| `map/` | canvas map, drawing, pointer/touch interaction, lock | reads `STATE`, calls `app/actions` |
| `ui/` | console panels, transect, menus, dialogs; on a phone, the sheet they sit in (`ui/sheet`, `ui/sheetdrag`) and full-screen dialogs (`ui/dialogs`) | reads `STATE`; `render()` is the single redraw |
| `io/` | coordinate parsing, files, search, URL hash, history, export, GPX out, marks | `io/marks` keeps marks in an IndexedDB database of their own |
| `main.ts` | boot, `window.underfoot` console handle | |

Cycles exist between `app`, `map`, `ui` and `io` (a click selects a station, which re-renders the console, which redraws the map). They're function-level only: no module reads another's binding while it's being evaluated. Keep it that way. Top-level code in those folders should only declare.

## The data shapes that matter

- **`StationFacts`** (`sh`): everything the data layer learned about a station that isn't geometry: NLCD class and fractions, terrain rosette, imagery metadata, gazetteer reply, today's weather, the newest pass, World cover, the soil, which services are in range. Each fact is `undefined` while it's being read and `null` when its service failed or doesn't cover the station.
- **`GeoIndex`** (`G`): `buildGeo` — every polygon, line, building and footprint near a station, projected once into its tangent plane in metres.
- **`GeoQuery`** (`q`): `geoAt(G, x, y)` — enclosing polygons, nearest feature per class, building distances, map density, and `crossing` at a crossing station.
- **`SourcePart`**: `{ ll, status, note, wmul?, exact? }` — a centred log-likelihood per class and the reasoning.
- **`Fused`**: probabilities, order, top class, confidence, τ, and a ledger row per source with its contribution in bits.

All defined in `src/core/types.ts`.

## State

`STATE` (`app/state.ts`) holds the mode, vertices, stations, results, selection, weights, N_eff, prior, GPS σ, smoothing, the field, the time machine's captures, a batch and the run id. A batch runs each group of points through the same sounding, so `STATE.stations` is the group being read. Every async reply checks its `runId` against `STATE.runId` before writing, so a new sounding silently orphans the old one's replies. `MAP` (`map/map.ts`) holds the view, pointer state, drawing and lock. Marks aren't in `STATE`: `io/marks.ts` holds them, loads them at boot and saves each change to IndexedDB.

## Builds

- `vite.config.ts` → `dist/`: the site, hashed assets, deployed by `.github/workflows/pages.yml`.
- `vite.single.config.ts` → `dist-single/underfoot.html`: everything inlined, runs from `file://`. CI uploads it as an artifact; tagged releases attach it.
- `vite.headless.config.ts` → `dist-headless/`: `underfoot.mjs`, the headless reader for Node, and `underfoot-mcp.mjs`, the MCP server over stdio, sharing one chunk (`shared-<hash>.mjs`); their dependencies (`@jsquash/jpeg`, `fast-png`, the MCP SDK, `zod`) are left outside. `npm run spots`, `trails`, `years` and `batch` take `--headless` to read with it, `npm run parity` holds it to the page, and `npm run mcp` asks the built server each of its tools over stdio.

## Console

`window.underfoot` exposes `STATE`, `MAP`, the engine (`fuseParts`, `computeParts`, `fieldFuse`, `positional`…), the parsers and the actions. The browser tests copy it onto `window` so `page.evaluate(() => STATE.results[0])` works.

## TypeScript

Everything in `src/` is strict TypeScript, with no `@ts-nocheck` left; the last files were typed after 1.7.0. Shared shapes live in `src/core/types.ts`. All code is formatted with Prettier (`npm run format`; CI checks it).
