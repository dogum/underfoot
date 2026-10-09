# Go / slow / no-go

Underfoot says what's on the ground. Go / slow / no-go asks a second question: how fast could you cross it? For every station it rates three presets (on foot, an ATV, a truck) and sums a line. This page gives every number the model uses, where it came from, and what it doesn't know.

It's a model with stated assumptions, not a route planner. It knows nothing about access (closures, private land, wilderness rules), gates, fences, the vehicle's clearance or the walker's load. Read a rating as "what the ground allows", and check the rest yourself.

## What it reads

| Input | From | Where |
|---|---|---|
| What the ground probably is | the answer itself: the probability of each of the twelve classes | everywhere |
| Grade along the line | the elevation of the stations either side (USGS 3DEP 1–10 m in the US, a ~90 m DEM elsewhere), in the direction the line was drawn | lines |
| The ground's own slope and roughness | the terrain rosette at the station (`engine/terrain`) | everywhere |
| Tree canopy overhead | NLCD tree canopy (`engine/overhead`) | lower 48 |
| Soil drainage | USDA Soil Data Access: the drainage class and hydrologic soil group of the main soil under the station (`data/soils`) | US |
| Soil water today | Open-Meteo, the top centimetre (`data/today`) | everywhere |
| What the line crosses | the mapped stream, ditch, river or road at a crossing station | lines |
| The mapped path's type | OpenStreetMap's highway tag, via OpenFreeMap: track, path, footway, cycleway, bridleway, steps | everywhere |

## The presets

Each preset has a speed on good, level ground and a factor for each class: the share of that speed the ground allows. A factor of 0 stops it.

| Ground | On foot | ATV | Truck |
|---|--:|--:|--:|
| Speed on good ground | 3.75 km/h (5 moving) | 30 km/h | 50 km/h |
| Paved surface | 1 | 1 | 1 |
| Path / trail | 1 | 0.4 | no-go |
| Grass | 0.85 | 0.6 | 0.4 |
| Bare ground | 0.8 | 0.6 | 0.4 |
| Railway | 0.8 | no-go | no-go |
| Cropland | 0.7 | 0.4 | 0.25 |
| Forest | 0.6 | 0.2 | no-go |
| Scrub | 0.5 | 0.3 | 0.1 |
| Snow / ice | 0.5 | 0.3 | 0.15 |
| Wetland | 0.35 | 0.1 | no-go |
| Building | 0.3 | no-go | no-go |
| Water | no-go | no-go | no-go |

On foot, 5 km/h is Tobler's moving speed on level ground, and forest at 0.6 is his factor for walking off a path. Walking times also take a **pace** of 0.75, the share of moving speed kept over a walk once stops are counted, because that's how parks post their times: with it, four of five Park Service checks below fall inside their posted range, against one without. Vehicles keep their full speed: there are no posted times to check them against. The other factors are first estimates, set to order the classes sensibly: they're meant to be argued with, and the refit can't move them yet.

**On a mapped path, its type decides** for the path class, because OpenStreetMap keeps them apart and a truck fits a track but not a footway:

| Mapped as | On foot | ATV | Truck |
|---|--:|--:|--:|
| track | 1 | 0.6 | 0.4 |
| path, bridleway, cycleway | 1 | 0.4 | no-go |
| footway, pedestrian, platform | 1 | no-go | no-go |
| steps | 0.6 | no-go | no-go |

## What scales a factor, or stops it

- **Grade.** On foot, Tobler's hiking function: speed relative to level ground is e^(−3.5 |g + 0.05|) / e^(−0.175), fastest on a slight descent (1.19× at −5%), 0.70× up a 10% grade, 0.50× up 20%. Vehicles slow linearly with slope, to nothing at 1.25× their limit.
- **Steepness.** Ground steeper than 40° stops a walker off a path, 25° an ATV, 20° a truck. On built ground (a road, path or railway, or anywhere on a mapped path) only the tread's own grade counts: the path was built, and the cliff beside it doesn't matter. These limits are judgements, chosen to be conservative.
- **Roughness.** Off built ground, ground rougher than ±0.5 m (ATV) or ±0.4 m (truck) halves the speed.
- **Wet soil.** Soil over 30% water in the top centimetre today, on ground that drains poorly (a poorly drained class, or hydrologic group C or D), or anywhere outside the US where there's no survey to say otherwise: ×0.85 on foot, ×0.5 for an ATV, ×0.4 for a truck, off built ground.
- **Trees.** Off built ground, canopy of 60% or more halves an ATV's speed, and 40% or more stops a truck: the trees are too close together.
- **Crossings.** A stream, ditch or drain the line crosses is forded: ×0.4 on foot, ×0.3 ATV, ×0.2 truck. A river with no bridge on the line stops all three. A bridge reads as its deck.

## A station, and a line

A station's speed is averaged over its class probabilities **by time**, not by speed: half road and half marsh is 2.6 km/h on foot, not 3.4, because crossing the marsh half takes most of the time. The probability that the ground stops you is kept apart:

- **no-go** when it's 50% or more;
- **slow** when it's 20–50%, or when the speed is under half the preset's speed on good ground;
- **go** otherwise.

Along a line, each station covers its own stretch (from midway to its neighbours, or a crossing's mapped width). Time is the sum of each usable stretch over its speed; **speed made good** is the usable length over that time. Stretches rated no-go are listed as blocked, with the first reason.

## Checked against

**The demo line** (Yosemite Valley, 896 m). On foot, 2.6 km/h, blocked at 654 m where the line wades the Merced with no bridge. An ATV is also blocked at the start, inside the Ansel Adams Gallery, and is slow on most of the line (footpaths and grass). A truck is stopped at 39 of 60 stations: forest, footpaths and the river.

**The ten Park Service trails** (`npm run trails` reports each trail's time on foot, as drawn and reversed):

The Park Service posts times for only some of the benchmark lines' exact segments ([nps.gov](https://www.nps.gov) only; ranges, stops included). Where it does:

| Line | Posted | Underfoot, Tobler alone | Underfoot, with the pace |
|---|---|--:|--:|
| Four Mile Trail, valley to Glacier Point, 7.6 km, +975 m | 3–4 h one way ([Yosemite](https://www.nps.gov/yose/planyourvisit/fourmiletrail.htm)) | 2 h 33 | **3 h 24** |
| Angels Landing, Scout Lookout to the summit and back, 0.8 km each way | 1–2 h, likely round trip ([Zion](https://www.nps.gov/thingstodo/hike-angels-landing.htm)) | 53 min | **1 h 11** |
| Mist Trail, Vernal Fall footbridge to the top and back, +185 m | 1.5–2 h, by subtracting two posted round trips ([Yosemite](https://www.nps.gov/yose/planyourvisit/vernalnevadatrail.htm)) | 1 h 11 | **1 h 34** |
| Valley Loop Trail, level | 2.6–4.7 km/h, from the full and half loops' posted times | 4.7 km/h | **3.5 km/h** |
| Bright Angel, rim to the River Resthouse and back, 12.7 km each way, −1,320 m | 12+ h round trip ([Grand Canyon](https://www.nps.gov/grca/planyourvisit/upload/intro-bc-hike.pdf)) | 6 h 38 | **8 h 50** ✗ |

Four of five fall inside the posted range. Bright Angel is short by three hours or more. The Park Service says to allow at least twice as long to climb out as to go down; Tobler's function makes the climb 1.4 times the descent (5 h 10 against 3 h 40). The Mist Trail line runs 0.97 km where the Park Service's segment is 0.4–0.5 mi, though the climb matches, so that check is rough. The other five lines have no posted time for their segment: the Anhinga and Midway Geyser Basin boardwalks and the Skyline line are pieces of longer loops, and no time is posted for Hidden Lake or Alum Cave.

**Recorded tracks.** On the hikers' GPS tracks of the Mist Trail, stations where the fixes wandered off the trail are rated as the ground under the fix: over the river (blocked, no bridge) or on the cliff beside it (too steep). That's right for the track as recorded, and a reminder that a phone's track isn't the trail.

## What it doesn't know

- **Access.** Closures, private land, wilderness rules, gates and fences.
- **The vehicle and the walker.** Clearance, four-wheel drive, a load, fitness, a group's pace, rests.
- **The weather beyond the soil.** Today's snow decides whether the ground is snow; its depth doesn't slow a vehicle further. Rain falling now, ice and darkness aren't read.
- **Small cliffs and drops.** The ~90 m DEM abroad smooths steep ground away, and even 1 m lidar can miss a ledge between stations.
- **A path's width and state.** A mapped "path" can be a two-metre gravel way or a scramble; its OpenStreetMap type is the only hint.
