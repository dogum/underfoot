# Validation

## Engine fixtures (`tests/unit/engine.test.ts`)

Eighteen synthetic scenes built from map features in local metres, with the raster, terrain and pixel evidence each source would see: a reservoir, a river centreline, a trail through woods, woods 13 m off that trail, a street, a motorway, inside a footprint, a suburban house under canopy, a park lawn, farmland, a beach, a marsh, a rail line, a tertiary road, a glacier abroad, open sea with and without a coastline polygon, forest abroad.

**17 of 18 called exactly, 18 of 18 in the top two**, no call above 98%. A scene with no evidence at all gives a low-confidence answer (forest 23%, confidence 10%).

## Live spots

25 places labelled by eye from zoom-19 imagery *before* running the engine (`|` marks acceptable alternates).

| Result | Count |
|---|---|
| Correct | **22 / 25** |
| Strict (first label) | 19 / 25 |
| Truth in the top two | 23 / 25 |
| United States (all 8 sources) | 19 / 19 |
| Abroad (4–5 sources) | 3 / 6 |

By stated confidence: ≥70% → 9 of 10 right; 40–70% → 8 of 8; under 40% → 5 of 7.

### The misses

| # | Place | Truth | Call | Why |
|---|---|---|---|---|
| 20 | Seine quay, Paris | paved | water 39% | OSM's river polygon covers the quay; the photo shows stone. Low confidence. |
| 24 | Aletsch glacier edge | snow | bare 97% | OSM maps bare rock; the photo had seasonal snow. The one confident miss. A recent-pass layer (Sentinel-2) would catch it. |
| 22 | Sahara | bare | grass 23% | Bare 16% close behind, confidence 15%: it knew it didn't know. |

## Real trails (`scripts/validate-trails.mjs`)

Ten trails in eight national parks, from the National Park Service's own trail lines ([fixtures](../tests/fixtures/trails/), public domain), each run through the app as a path. The truth at every station is the same: you're on the trail. Crossing stations are left out of the scores, since they say "path" by construction.

| Trail | Park | Length | Stations | Path | Top two | Path or tread named | OSM trail within 5 m | Called instead |
| --- | --- | --: | --: | --: | --: | --: | --: | --- |
| Mist Trail | Yosemite | 1.0 km | 44 | 7% | 100% | 50% | 86% | forest 33, grass 7, bare 1 |
| Valley Loop Trail | Yosemite | 1.9 km | 48 | 10% | 100% | 33% | 94% | forest 42, paved 1 |
| Four Mile Trail | Yosemite | 7.6 km | 45 | 2% | 100% | 64% | 100% | forest 44 |
| Angels Landing Trail | Zion | 0.8 km | 46 | 0% | 100% | 9% | 83% | scrub 46 |
| Bright Angel Trail | Grand Canyon | 12.7 km | 47 | 19% | 70% | 40% | 100% | grass 21, forest 12, scrub 3, bare 2 |
| Skyline Trail | Mount Rainier | 0.6 km | 44 | 27% | 100% | 91% | 100% | forest 23, grass 9 |
| Midway Geyser Basin boardwalk | Yellowstone | 0.4 km | 47 | 9% | 100% | 51% | 100% | bare 43 |
| Anhinga Trail boardwalk | Everglades | 0.4 km | 43 | 0% | 91% | 42% | 100% | wetland 26, water 16, forest 1 |
| Alum Cave Trail | Great Smoky Mountains | 7.8 km | 48 | 0% | 100% | 100% | 100% | forest 48 |
| Hidden Lake Trail | Glacier | 3.6 km | 48 | 4% | 52% | 54% | 96% | bare 23, grass 14, scrub 5, forest 4 |
| **All ten** | | **37 km** | **460** | **8%** | **91%** | **53%** | | |

*Path or tread named* counts stations where the call is path, or where the readout says the mapped trail is probably the tread under whatever it called ("The mapped Mist Trail runs 0.8 m away — likely its tread, under the forest").

![Transects along the ten trails: mostly forest, scrub, bare ground or wetland, with path as the thin second layer](assets/trails-transects.jpg)

**This is the weakest result in this document.** On a trail, Underfoot names the land the trail runs through: forest on Alum Cave and Four Mile, scrub on the Angels Landing fin, bare sinter around Grand Prismatic, wetland and open water under the Anhinga boardwalk. Path is in the top two at 91% of stations.

The cause is in the line source. The engine models a footpath as 1.6 m wide and an OpenStreetMap centreline as good to about ±1.8 m, so even a station sitting on the mapped line gets P(on) of 67% at most, and 55% at 0.6 m off it. The area sources (land cover, canopy, imagery, polygons) all agree on the land around the trail, and they win. For a single point dropped near a trail, that's a fair reading. A line that follows a mapped trail for a kilometre is strong evidence of being on it, and the engine doesn't use that evidence yet.

The OSM and NPS lines agree closely: 83–100% of stations are within 5 m of a mapped OSM trail, so the data is there.

### Hikers' GPS tracks

Three public OpenStreetMap GPS traces cover the Mist Trail ([1](https://www.openstreetmap.org/user/okainov/traces/11350011), [2](https://www.openstreetmap.org/user/Alexandr%20Nikitin/traces/3864771), [3](https://www.openstreetmap.org/user/nono303/traces/2902426); © OpenStreetMap contributors). The script fetches them at run time (they're cached locally, not committed) and keeps one pass from the footbridge to Vernal Fall.

| Track | Fixes | Recorded length | Off the park's line (median / 90th pct) | OSM trail within 5 m | Path | Path or tread named |
| --- | --: | --: | --: | --: | --: | --: |
| 1 | 197 | 1.4 km | 7.9 m / 20.8 m | 16% | 7% | 7% |
| 2 | 150 | 1.9 km | 9.0 m / 17.5 m | 26% | 0% | 2% |
| 3 | 182 | 1.1 km | 3.9 m / 17.4 m | 41% | 2% | 7% |

![The Mist Trail: the park's line follows the mapped trail; a hiker's GPS track wanders up to 20 m off it and into the river](assets/trails-mist-gps.jpg)

Under the walls of the gorge, phone fixes sit 4–9 m off the trail at the median and 17–21 m at the 90th percentile, and the wander adds 10–94% to the recorded length of a 1.0 km trail. Stations land in the forest beside the trail and, on every track, in the Merced River.

### What changes

[Follow the trail](roadmap.md#follow-the-trail) is now an M1 item. When most of a line runs along one mapped path, being on it becomes known by construction (as at a crossing), stations snap to the tread within GPS error, and the line stops collecting crossing stations where it weaves across the trail it follows. These ten trails and three tracks are its benchmark.

Rerun with `npm run build && npm run trails` (add `-- --shots` to redraw the figures).

## Interaction (`tests/e2e/`)

50 browser checks: a point and the demo line with every source live; mouse and keyboard (panning never moves the probe, drawing, undo, vertex drag and delete, wheel zoom, coordinate formats, file formats, links, export); touch at phone size (all controls on screen, menus inside it, Undo/Done, long-press delete, touch pan); and the lock.
