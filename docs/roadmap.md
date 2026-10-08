# Roadmap

Underfoot answers one question well today: *what is on the ground here?* The roadmap widens that in five directions, delivered as six milestones. Each milestone ends with something you can open and use, and each item ships as its own pull request.

![Five tracks: Learn, Pocket, Now, Read the ground, History and scale](assets/roadmap-tracks.png)

| Track | What it adds |
|---|---|
| **Learn** | The app shows where it's unsure, people mark calls right or wrong, and the weights improve from those marks |
| **Pocket** | A public site that works on a phone in the field: live GPS, route reports, share cards |
| **Now** | Answers that know today's date: snow on the ground, recent rain, the newest satellite pass |
| **Read the ground** | Better coverage outside the US, trafficability for foot and vehicles, whole areas instead of points |
| **History + scale** | How a spot changed over the years, and hundreds of points at once |

---

## M0 · Foundation ✅

The single-file app became this repository: Vite + TypeScript modules, unit and browser tests, CI, GitHub Pages, and an offline single-file build. Behaviour is identical to the last single-file version.

---

## M1 · Go public ✅

A live site you can send to someone, useful on a phone in the field. Released as 1.1.0.

- **Publish.** The site at [dogum.github.io/underfoot](https://dogum.github.io/underfoot/), CI on every push, Pages from `main`, 1.0.0 with `underfoot.html` attached. Long lines keep their shape in links ([#18](https://github.com/dogum/underfoot/pull/18)).
- **Follow the trail** ([#12](https://github.com/dogum/underfoot/pull/12)). A line that runs along a mapped path or road is matched to it. Path along ten Park Service trails went from 8% to 99.8% of stations (the target was 90%); along three hikers' GPS tracks, from 2–7% to 87–94% (target 75%). The demo line is unchanged. Rivers crossed on a bridge are crossed on the deck ([#15](https://github.com/dogum/underfoot/pull/15)).
- **Here** ([#19](https://github.com/dogum/underfoot/pull/19)). Live GPS: the newest fix is read with the last 200 m of fixes behind it, so on a trail it names the trail. It re-reads when the fix moves farther than its accuracy. Rec keeps the walk; location turned off gets a plain message. Tested with emulated geolocation.
- **Route surface report** ([#20](https://github.com/dogum/underfoot/pull/20)). A card above the transect and `route_report` in the GeoJSON. Lengths add up to the line and crossings match the transect, both checked in the browser suite. Crossings count their mapped width.
- **Share card** ([#21](https://github.com/dogum/underfoot/pull/21)). A 1200 × 630 JPEG of about 150 KB (the target was under 400 KB), with the link that reopens the sounding. The share sheet on a phone; download and copy the link on a desktop.

---

## M2 · Learning loop ✅

Underfoot shows where it's unsure, takes your right and wrong marks, and fits its weights to them. Released as 1.2.0.

- **Doubt map** ([#24](https://github.com/dogum/underfoot/pull/24)). Each station scores how close its call is and how many of the sources with an opinion lean another way. Stations at 0.5 or more get a halo on the map, a mark on the transect's doubt band, and the reason in words. The quay and snow-on-rock fixtures light up (0.57 and 0.50) while the reservoir and rooftop stay at 0.00. The real Aletsch spot lights at exactly 0.50. Lines that follow three trails have none of 156 stations lit.
- **Walk check list** ([#25](https://github.com/dogum/underfoot/pull/25)). The five most doubtful spots, 40 m or more apart, in walking order, opened from the route card. Each one links back to its station, in the app and in the GPX waypoints it exports (`at=`). The GPX keeps GPX 1.1's schema order and reads back into Underfoot; it hasn't yet been tried in Gaia, OsmAnd or on a Garmin.
- **Right / wrong marks** ([#26](https://github.com/dogum/underfoot/pull/26)). Right, wrong (what's really there) or not sure, and how you know, kept in IndexedDB with all eight sources' readings. Marks survive reloads, and the Marks menu lists, edits, deletes and exports them. The browser suite checks that no request carries one.
- **Local refit** ([#27](https://github.com/dogum/underfoot/pull/27)). Weights and N_eff fitted to your marks, pulled toward the defaults and kept inside the sliders' range. In a synthetic world where the photo is right 90% of the time and land cover 50%, the fit recovers it: photo 1.00 → 1.78, land cover 0.75 → 0.53. The dialog shows before and after on held-out marks, and Reset restores the defaults exactly (max |Δp| = 0 in the browser).

---

## M3 · Community weights

**Goal:** everyone's walks improve the model, without anyone sharing where they walk.

- **What's shared:** the eight per-source readings, the true class, how the contributor knows, and a coarse region (country or 1° cell). Not the coordinate, unless the contributor explicitly opts in to contributing a public ground-truth point.
- **Where it lands:** an insert-only store (decision pending: GitHub issues, an anonymous-insert database table, or both).
- **Nightly refit:** a GitHub Action pulls new marks, drops outliers, caps each contributor's influence, refits, and publishes `model/weights.json` only if the new weights beat the current ones on a fixed benchmark (the validation set plus held-out community marks).
- **Transparency:** every update adds a changelog line (what moved, by how much, on how many marks). The app shows which weights version it's using.
- **Fallback:** the app loads the latest weights on start and uses the bundled copy offline.

**Done when** a contribution round-trips end to end (mark → store → nightly refit → new weights → app), a poisoned batch from one contributor can't move any weight past its cap, and the privacy statement in the README matches what's stored, field for field.

---

## M4 · Now

**Goal:** answers that know what day it is.

### Today layer
Open-Meteo at the point: current snow depth, soil moisture, precipitation over the last three days. Enters as evidence: snow depth > ~3 cm lifts snow over whatever is underneath; saturated soil lifts wetland and lowers bare. Shown as chips in the readout with the observation time.
**Done when** a lawn under fresh snow is called snow with the map's grass as runner-up, and the chips show source and time.

### Newest satellite pass
Element84 Earth Search (STAC) finds the most recent low-cloud Sentinel-2 L2A scene; the app reads the scene-classification band (SCL) at the point with HTTP range requests on the cloud-optimised GeoTIFF. SCL's snow, water, vegetation and bare classes enter as a light-weight source dated to the pass.
**Done when** the imagery panel shows the pass date and SCL class, reads take under two seconds on a normal connection, and a cloudy pixel abstains rather than voting.

---

## M5 · Read the ground

**Goal:** better outside the US, and answers about moving across the ground, not only what covers it.

### Global 10 m land cover
Esri / Impact Observatory Sentinel-2 land cover (yearly, 2017–2024) via its ImageServer `identify`. A new area-scale source outside CONUS, read as a mixture like NLCD.
**Done when** the abroad validation spots improve on the current 3 of 6 without any US spot regressing, and the source is credited on the map.

### Go / slow / no-go
Presets for foot, ATV and truck. Inputs: class probabilities, slope and roughness (3DEP), canopy density (NLCD canopy), wetness (today layer), soil drainage class and hydrologic group (USDA Soil Data Access), and water crossings. Output: a speed factor per station, a colour band on the transect, and speed made good along the line.
**Done when** the model is documented in `docs/mobility.md` with its assumptions, each preset gives sensible results on the demo line, and every factor in a station's rating is visible in the UI.

### Area mode
Draw a polygon. Field maps tile across it; the result is acres per class, a mosaic on the map, and an export (GeoJSON of class cells, CSV summary).
**Done when** the class areas sum to the polygon's area within 1%, and a 5-acre lot finishes in under a minute on a normal connection.

---

## M6 · History + scale

### Time machine
Esri World Imagery Wayback publishes 197 dated releases (2014 to now). For a point, the imagery classifier runs on each distinct release; the result is class probability over time with the change year flagged.
**Done when** a known cleared-then-built site shows the change in the right year, and the chart only uses releases whose imagery actually differs.

### Batch points
A CSV of independent points (survey sites, sensor locations, geocaches). Each gets a call and confidence; low-confidence rows sort to the top; results export as CSV and GeoJSON. Requests are paced to respect each service.
**Done when** 500 points complete without errors or rate-limit failures, and resuming after a closed tab picks up where it left off.

---

## Data sources for the roadmap

Each was checked on 2026-10-07: free, no key, and readable from a browser page.

| Source | Milestone | Notes |
|---|---|---|
| Open-Meteo forecast API | M4 | `current=snow_depth,soil_moisture_0_to_1cm,precipitation&past_days=3` |
| Element84 Earth Search STAC + `sentinel-cogs` on AWS | M4 | range requests allowed |
| Esri / Impact Observatory 10 m land cover ImageServer | M5 | `identify` answers pages opened from disk |
| USDA Soil Data Access | M5 | `POST /Tabular/post.rest` with SQL |
| Esri World Imagery Wayback | M6 | 197 releases, Feb 2014 → Sep 2026 |

ESA WorldCover was considered for M5; its storage doesn't send the headers a browser needs, so the Esri / Impact Observatory product takes its place.
