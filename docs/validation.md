# Validation

## Engine fixtures (`tests/unit/engine.test.ts`)

Eighteen synthetic scenes built from map features in local metres, with the raster, terrain and pixel evidence each source would see: a reservoir, a river centreline, a trail through woods, woods 13 m off that trail, a street, a motorway, inside a footprint, a suburban house under canopy, a park lawn, farmland, a beach, a marsh, a rail line, a tertiary road, a glacier abroad, open sea with and without a coastline polygon, forest abroad.

**17 of 18 called exactly, 18 of 18 in the top two**, no call above 98%. A scene with no evidence at all gives a low-confidence answer (forest 23%, confidence 10%).

Today's weather has its own three: a park lawn under 12 cm of fresh snow is called snow with grass as runner-up; the same lawn on a dry day is unchanged to twelve places; and 43 cm of snow the model holds with none fallen in a week (Konkordia's reading) only leans, so the lawn stays grass. In the browser, Cook's Meadow under a stood-in 12 cm of fresh snow reads snow 73%, grass second.

The newest pass, read in the browser on 8 October 2026: the gallery's 20 m pixel is vegetation on 7 October (mostly the trees around it), which the sub-pixel floor keeps from refuting the mapped building (97% → 95%); Konkordia is not vegetated on 5 October, which overrules the weather model's 43 cm of snow; the Merced River is dark on every pass back to 27 September, so the pass says nothing there.

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

A line that runs along a mapped path is matched to it, and its stations are known to be on it ([how](method.md#following-a-path-or-road)). Before that, in 1.0.0, Underfoot called path at 8% of these stations. It named the forest, scrub or wetland each trail runs through, with path usually second.

| Trail | Park | Length | Stations | Followed | Path | Path in 1.0.0 |
| --- | --- | --: | --: | --: | --: | --: |
| Mist Trail | Yosemite | 1.0 km | 48 | 100% | 100% | 7% |
| Valley Loop Trail | Yosemite | 1.9 km | 48 | 100% | 100% | 10% |
| Four Mile Trail | Yosemite | 7.6 km | 48 | 100% | 100% | 2% |
| Angels Landing Trail | Zion | 0.8 km | 48 | 100% | 100% | 0% |
| Bright Angel Trail | Grand Canyon | 12.7 km | 48 | 100% | 100% | 19% |
| Skyline Trail | Mount Rainier | 0.6 km | 48 | 100% | 100% | 27% |
| Midway Geyser Basin boardwalk | Yellowstone | 0.4 km | 48 | 100% | 100% | 9% |
| Anhinga Trail boardwalk | Everglades | 0.4 km | 48 | 100% | 100% | 0% |
| Alum Cave Trail | Great Smoky Mountains | 7.8 km | 48 | 100% | 100% | 0% |
| Hidden Lake Trail | Glacier | 3.6 km | 48 | 98% | 98% | 4% |
| **All ten** | | **37 km** | **480** | | **99.8%** | **8%** |

*Followed* is the share of the line's length matched to a mapped path. The one miss is on Hidden Lake, where the Park Service's line and OpenStreetMap's trail run 24 m apart for about 75 m: the matcher lets go there, and that station reads forest (46%).

![Transects along the ten trails: path along the whole of each](assets/trails-transects.jpg)

### Hikers' GPS tracks

Three public OpenStreetMap GPS traces cover the Mist Trail ([1](https://www.openstreetmap.org/user/okainov/traces/11350011), [2](https://www.openstreetmap.org/user/Alexandr%20Nikitin/traces/3864771), [3](https://www.openstreetmap.org/user/nono303/traces/2902426); © OpenStreetMap contributors). The script fetches them at run time (they're cached locally, not committed) and keeps one pass from the footbridge to Vernal Fall.

| Track | Fixes | Recorded length | Off the park's line (median / 90th pct) | Followed | Path | Path in 1.0.0 |
| --- | --: | --: | --: | --: | --: | --: |
| 1 | 197 | 1.4 km | 7.9 m / 20.8 m | 90% | 94% | 7% |
| 2 | 153 | 2.0 km | 8.4 m / 17.4 m | 87% | 87% | 2% |
| 3 | 182 | 1.1 km | 3.9 m / 17.4 m | 89% | 90% | 2% |

![The Mist Trail: the park's line and a hiker's GPS track, both reading path except where the track strays near the bridge](assets/trails-mist-gps.jpg)

Under the walls of the gorge, phone fixes sit 4–8 m off the trail at the median and 17–21 m at the 90th percentile, and the wander adds 10–94% to the recorded length of a 1.0 km trail. Every miss is in one stretch per track where the fixes run 19–39 m from the mapped trail for 100–260 m. There the matcher lets go, and those stations read as the forest or the river they landed in (on track 1, one is water at 92%).

### Controls

Following has to fire along trails and stay quiet beside them.

| Control | Lines | Followed |
| --- | --: | --: |
| Each trail drawn by hand: cut to the bends a person would click (12–329 vertices), within 4 m of the trail | 10 | 100% |
| Each trail moved 25 m to one side, a transect beside it | 10 | 13% |
| The demo line, which crosses trails and roads and follows none | 1 | 0% |

The 25 m shift is the hard case. On five trails it follows 0–3%. Where it does follow, a mapped path is 6–13 m from the shifted line (median per stretch), so it is following something real: on Four Mile (54%) and Bright Angel (36%) a switchback brings the next leg of the trail within reach, on Skyline (23%), the Mist Trail and Hidden Lake (7–8%) a bend does the same, and at the Bright Angel trailhead the shifted line runs along the Rim Trail.

With the newest Sentinel-2 pass in the fusion (M4), the ten Park Service lines are unchanged. Along the hikers' tracks path holds at 94%, 87% and 90%; on the second track "path in the top two" drops from 100% to 96%. The controls drawn 25 m beside each trail read path at 13% of stations instead of 12%.

### Limits

- A recorded line 10–15 m beside a trail is matched to it. A GPS track can't tell "on the trail with a poor fix" from "walking beside it". Switch **follow** off on the transect (it's kept in the link as `f=0`) for a transect that runs beside a trail on purpose.
- A point dropped mid-span on a footbridge can still read the water under it: a 1.6 m tread mapped to ±1.8 m can't outvote a river. A line along the bridge reads the bridge, by following it or, with following off, at the crossing on the deck. (The water stations on the hiker tracks are something else: fixes that wandered over the river where the matcher let go.)

Rerun with `npm run build && npm run trails` (add `-- --shots` to redraw the figures).

## Doubt (`tests/unit/doubt.test.ts`)

A station is worth a look at a doubt score of 0.5 or more ([how](method.md#doubt)). The roadmap's test: the Seine-quay and Aletsch-type misses should light up, and clear calls should stay quiet.

| Case | Call | Doubt | Lit |
| --- | --- | --: | :-: |
| Reservoir (fixture) | water 98% | 0.00 | no |
| Rooftop (fixture) | building 98% | 0.00 | no |
| Trail the line follows, under forest (fixture) | path 91% | 0.00 | no |
| Quay 3 m inside a mapped river (fixture) | water 55% | 0.57 | yes |
| Snow over mapped bare rock (fixture) | bare 95% | 0.50 | yes |
| Aletsch, Konkordia (live) | bare 95% | 0.50 | yes |
| Seine, Port de la Tournelle (live) | forest 37% | 1.00 | yes |
| Seine, quai Branly (live) | water 97% | 0.00 | no |

Snow on rock lights exactly at the threshold, in the fixture and at Konkordia: of the two sources with an opinion there, the map says bare and the photo says snow, so half the weight dissents. The quay says *the map says water, the photo says paved surface*. The quai Branly point reads water with nothing against it, so if it's on stone, doubt misses it the same way the call does.

Along lines: the demo line has 15 of 60 stations worth a look, and its check list is stations 12, 24, 30, 37 and 50 (172, 343, 458, 572 and 725 m along) (paved close calls by the bridge, a forest edge, Cook's Meadow where the map says grass and land cover says forest). The Mist Trail, Valley Loop and Bright Angel lines, which follow their trails, have 0 of 156.

## Refit (`tests/unit/refit.test.ts`)

Synthetic marks from a world where the photo points at the truth 90% of the time, the map 70% and land cover 50%:

- Fitted to 300 marks, the photo's weight goes from 1.00 to 1.78 and land cover's from 0.75 to 0.53. On 200 marks it never saw, it calls 182 right against the defaults' 171.
- Held out five ways on 100 marks: 91 right against 89.
- Five marks move no weight by more than 10%.
- However hard 400 marks pull, every weight stays inside the sliders' range.

In the browser, Reset puts the posterior back bit for bit.

## Community weights (`tests/unit/community.test.ts`)

Synthetic marks again: 30 people, 10 marks each, from the world where the photo is right 90% of the time, the map 70% and land cover 50%. Rounds start from the defaults; each published round becomes the next one's start.

| Who shares | Photo, round by round | Land cover | Map | Published |
| --- | --- | --: | --: | --- |
| 30 honest people | 1.00 → 1.15 → 1.32 → 1.52 | 0.75 → 0.70 | 1.00 | 3 rounds, then no further gain |
| + one person with 1,000 marks saying land cover is always right | 1.00 → 1.15 → 1.32 → 1.52 | 0.75 | 0.88 | 3 rounds |
| that person alone | 1.00 | 0.75 | 1.00 | none: marks from 1 person, a round needs 5 |
| + the same marks shared as 5 people, 200 each | 1.00 → 1.15 → 1.32 | 0.75 → 0.86 → 0.99 | 0.73 | 2 rounds |

Every round calls 17 of the 18 benchmark fixtures right, as the defaults do. One person's 1,000 marks can't move land cover, the weight they pushed. They do take the map's weight down 12%, within one round's step. The last row is the limit: the id is per browser, so one person who clears their storage between shares counts as several. The step limit and the gate held five such fakes to two rounds, and every published round goes in the weights changelog for anyone to see.

## Interaction (`tests/e2e/`)

114 browser checks: a point (every source answers, today's weather shown with its source and time, fresh snow called snow at the point and as a ±5 m fix, the newest Sentinel-2 pass with its date and class in a chip, the imagery panel and the ledger), the demo line, the Mist Trail and a footbridge with every source live (the route card reconciles with the transect, road crossings count their mapped width, and the share card is a 1200 × 630 JPEG under 400 KB for a point and a line) (a clear point says nothing is worth a look; the demo line has some stations worth a look and says why, and a check list of five spots 40 m or more apart that opens from the route card, takes you to a station, exports GPX 1.1 that reads back into Underfoot, and whose waypoint links reopen the line at their spot; a followed trail has nothing worth a look) (the demo line follows nothing; the Mist Trail line follows the Mist Trail, shows what it follows, and the follow switch turns it off and on); mouse and keyboard (panning never moves the probe, drawing, undo, vertex drag and delete, wheel zoom, the MAP basemap from a keyless source, coordinate formats, file formats, links, export); touch at phone size (all controls on screen, search on the first row and the seven tools labelled across the second, the transect folded to one row that Chart opens, follow switch and all, the answer with 244 px of room at 390 × 844 and 134 px at 375 × 667 with a line drawn, the share button, the route card folded to one line, menus inside the screen, Undo/Done, long-press delete, touch pan); the lock; and Here, with emulated geolocation (reading a fix, standing still, walking, a fix too rough to read, a walk up the Mist Trail that names the trail, recording, a link ending it, location turned off); and marks (a wrong mark asks what's really there and keeps every source's reading, the map shows it, the check list marks a spot, marks survive a reload, the Marks menu lists and edits them in place, they export as GeoJSON and CSV, delete takes two taps, no request ever carries a mark, sharing with the store off saves the batch as a file with exactly the README's fields, sharing with a stand-in store posts those rows with points only when ticked and tags them shared, offline the app runs on the weights built into it, the site build publishes them as `weights.json`, a newer `weights.json` on the site is used, named in the ledger and returned to exactly by Reset, and on a phone the menu stays on screen) and refit (too few marks says what it needs; on fourteen it shows before and after and moves land cover's weight the way the marks point; *Use my weights* survives a reload; Reset restores the defaults and the posterior exactly).
