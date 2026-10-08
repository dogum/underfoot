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

## M1 · Go public

**Goal:** a live site you can send to someone, and that's useful on a phone in the field.

### Publish
Public repo, Pages deploy, first tagged release with `underfoot.html` attached, social preview, topics, issue templates live.
**Done when** the site loads at `dogum.github.io/underfoot`, CI and Pages are green, and the release page offers the offline file.

### Live GPS mode
A **Here** button. `navigator.geolocation.watchPosition` drives the probe; the GPS accuracy disc is set from the fix's own reported accuracy (rounded to the ±3/5/10 m steps, or continuous). The sounding re-runs when the fix moves farther than its accuracy, not on every jitter. A small track of recent fixes shows on the map. Optional "record" turns the fixes into a path.
**Done when** walking with a phone shows the call updating under you within a few seconds of moving, without flicker while standing still; denial of location permission is handled with a clear message; tested with emulated geolocation in the browser suite.

### Follow the trail
Along ten National Park Service trails, Underfoot calls path at only 8% of stations: it names the forest, scrub or wetland the trail runs through, with path usually second ([Real trails](validation.md#real-trails-scriptsvalidate-trailsmjs)). The fix is to treat a line that follows a mapped path the way a crossing is treated. Where a stretch of the line runs within GPS error of one mapped path and roughly parallel to it, being on that path is known by construction, with only its existence in doubt; stations on the stretch snap to the tread; and the line stops collecting crossing stations where it weaves across the path it follows. The readout says which path it matched and over what length, and matching can be switched off for a transect that only runs beside a trail.
**Done when** `scripts/validate-trails.mjs` reports path at 90% or more of stations on the official lines and 75% or more on the hiker tracks, while the demo line, the engine fixtures and the 25 live spots don't change.

### Share card
One tap renders a card: map crop with the probe or line, the call and its probability, the top three bars, coordinates, date. Phones get the Web Share API; desktops download a PNG.
**Done when** the card renders identically on desktop and phone, is under 400 KB, and includes the link that reopens the sounding.

### Route surface report
For a path: share of length per class, crossings by type (roads, trails, streams, rail), steepest grade and total climb from the elevation profile, longest continuous stretch per class, and the stations under 40% confidence. Shown as a card above the transect, exportable as an image and included in the GeoJSON export.
**Done when** the numbers on the demo line reconcile with the transect (lengths sum to the line length; crossing counts match the × stations), with a unit test on the summariser.

---

## M2 · Learning loop

**Goal:** Underfoot gets better for *your* area as you use it.

### Doubt map
Per station: disagreement among sources (weighted spread of each source's favourite class) and closeness (margin between the top two). Shown as a band on the transect and a tint on the map.
**Done when** the Seine-quay and Aletsch-type cases from `docs/validation.md` light up as doubtful while clear cases (reservoir, rooftop) stay quiet.

### Walk check list
The N most doubtful stations along a line, numbered, with what the sources disagree about in plain words. Exports as GPX waypoints for a phone or GPS unit.
**Done when** the list exports valid GPX that opens in common hiking apps, and each item links back to its station.

### Right / wrong marks
On any station: ✓ / ✗, and "what's really here" (the twelve classes), plus how you know (standing there, photo, imagery, local knowledge). Stored in IndexedDB with the eight per-source readings at that moment.
**Done when** marks survive reloads, can be listed, edited and exported, and never leave the device unless shared (M3).

### Local refit
Fit source weights and N_eff to your own marks: multinomial log-likelihood with L2 pull toward the defaults, so a handful of marks nudges rather than lurches. Shows accuracy on your marks before and after, held-out by leave-one-out. One tap to revert.
**Done when** refitting on a synthetic set with a known bias recovers it, the defaults are restored exactly on revert, and the UI shows the before/after numbers.

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
