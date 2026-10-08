# How Underfoot decides

Every point or line you probe is a *sounding*. A coordinate has no ground truth to look up, so Underfoot treats it as inference: start from base rates, let eight weak and only partly independent sources move the log-odds, and report the posterior with the ledger attached.

## The twelve classes

`building · paved · path · rail · forest · scrub · grass · crop · water · wetland · bare · snow`

Four are *objects* (building, paved, path, rail): narrow, sharp-edged, often smaller than a raster pixel. The rest are *cover*. The distinction matters for the sub-pixel floor and for smoothing.

## Priors

| Prior | Meaning |
|---|---|
| `probed` (default) | P(class \| a coordinate someone handed this tool). People probe roads, trails and buildings far more than random hectares. |
| `land` | P(class \| a random point on Earth's land). Footpaths are ~0.4% of it, so a probe on a mapped trail still reads "forest". |

## The sources

**OSM polygons and lines** come from [OpenFreeMap](https://openfreemap.org) vector tiles, decoded in the page. Polygons that enclose the point vote by type, damped when nested, and scaled near their edges by a 3 m edge-error model. Lines vote through a normal CDF over ±1.8 m of centreline error against the surface's modelled half-width: 99% on a street centreline, 67% on a footpath centreline, because a 1.6 m tread and ±1.8 m of geometry leave that much room. A mixture term (`MAPPED_SHARE`) admits that some real roads and paths aren't mapped. The map's silence counts too, scaled by how densely the neighbourhood is mapped.

Earlier versions used the Overpass API. Its main instance answers `Origin: null` (a page opened from disk) with HTTP 406, and the others return 504 much of the day.

**Building footprints** are FEMA USA Structures: every US structure over ~450 sq ft with occupancy and height, fetched in fixed 0.004° cells so nearby soundings reuse them.

**Imagery pixels** are read off Esri World Imagery tiles: a 24 px core and a 48 px context ring at zoom 18, twenty colour and texture statistics, scored by a multinomial logistic regression fitted to 1,038 patches labelled from OSM polygons across 24 US regions plus 42 hand-checked sites (`calib/`). On regions it never saw it reaches 49% balanced accuracy over nine classes and a log-loss of 1.54 (v2's hand-set signatures scored 2.90, worse than a blind guess at 2.48). Path and rail abstain: a canopied trail is pixel-identical to its canopy. Bright white reads as snow only above 1,800 m or beyond 62° latitude; elsewhere it reads as bare. Esri's "no imagery here" placeholder tile is detected and skipped.

**NLCD** land cover, tree canopy %, impervious % and the impervious *descriptor* (which names road versus roof) arrive in one WMS request. A 30 m pixel is a mixture and is read as one (`NLCD_MIX`).

**Terrain** is a USGS 3DEP rosette (10 m radius) in the US, one batched request for every station. 3DEP serves 1 m lidar where it has been flown and a 3 m or 10 m DEM otherwise (the Mist Trail, Four Mile Trail and Angels Landing are on the 10 m DEM), and the ledger names the cell size. Outside the US it is a ~90 m DEM from Open-Meteo, where an all-zero rosette means open sea. Scored with a Student-t kernel so one odd reading can't veto a class; the water term is asymmetric (flat helps, steep only mildly hurts, a channel helps).

**Nominatim** gives the nearest named feature, for the station in focus only (one request a second). It votes only when its polygon actually contains the point.

## Fusion

1. Each source's log-likelihood is **mean-centred**, so it can only argue relatively, and clamped to ±8 nats.
2. **Sub-pixel floor.** Area-scale sources may support a narrow class but not refute it. Their negative evidence for path, rail, paved, building or water is floored below their own favourite, but only when something has seen that class within a few metres (or the map is too sparse for absence to mean anything, at 40% strength), and never when the source's own verdict physically can't host a tread (water, ice).
3. **Correlation discount.** The sum is divided by τ = Σ(active weights) / N_eff. N_eff (default 3.5, slider in the ledger) is how many genuinely independent voices the overlapping sources amount to. When sources drop out, τ falls on its own.
4. **Crossings.** At a station where the line crosses a mapped road, path, rail line or stream, that class's probability is set to its existence probability, max(0.93, Φ((w − d)/σ)), outside the discount; the other classes share the remainder by the evidence.
5. **Softmax, then a 2% uniform mixture** for irreducible error. Nothing reads 100%.

Confidence is 1 − H/H_max: how far the evidence moved the answer from knowing nothing.

## Field map and GPS uncertainty

Once a station's data is local, the engine is a function of position, so it's evaluated on a 2 m grid across 120 m (imagery on a 4 m lattice, filled in progressively). Choosing ±σ m replaces the point answer with the field averaged under a Gaussian of that σ. Around a house, ±3 m still says building (97%); ±10 m spreads to 44% building with the yard and the street picking up the rest.

## Paths

Stations are spaced along the line (auto, or every 5–100 m, or vertices only), up to 48, plus a crossing station wherever the line crosses a mapped line feature or building edge. Forward–backward smoothing over a 35 m patch length lets neighbouring stations inform each other, for cover classes only. Objects and crossings are never smoothed, so a one-station grass flicker inside a forest run drops from 51% to 1% while a road crossing holds at 93%.
