# How Underfoot decides

Every point or line you probe is a *sounding*. A coordinate has no ground truth to look up, so Underfoot treats it as inference: start from base rates, let ten weak and only partly independent sources move the log-odds, and report the posterior with the ledger attached.

## The twelve classes

`building · paved · path · rail · forest · scrub · grass · crop · water · wetland · bare · snow`

Four are *objects* (building, paved, path, rail): narrow, sharp-edged, often smaller than a raster pixel. The rest are *cover*. The distinction matters for the sub-pixel floor and for smoothing.

## Priors

| Prior | Meaning |
|---|---|
| `probed` (default) | P(class \| a coordinate someone handed this tool). People probe roads, trails and buildings far more than random hectares. |
| `land` | P(class \| a random point on Earth's land). Footpaths are ~0.4% of it, so a probe on a mapped trail still reads "forest". |

## The sources

**OSM polygons and lines** come from [OpenFreeMap](https://openfreemap.org) vector tiles, decoded in the page. Polygons that enclose the point vote by type, damped when nested, and scaled near their edges by a 3 m edge-error model. Lines vote through a normal CDF over ±1.8 m of centreline error against the surface's modelled half-width: 99% on a street centreline, 67% on a footpath centreline, because a 1.6 m tread and ±1.8 m of geometry leave that much room. A mixture term (`MAPPED_SHARE`) admits that some real roads and paths aren't mapped. A river's half-width is a guess (8 m for any river), so inside a mapped water polygon, where the banks are known, the centreline doesn't count against water. The map's silence counts too, scaled by how densely the neighbourhood is mapped.

Earlier versions used the Overpass API. Its main instance answers `Origin: null` (a page opened from disk) with HTTP 406, and the others return 504 much of the day.

**Building footprints** are FEMA USA Structures: every US structure over ~450 sq ft with occupancy and height, fetched in fixed 0.004° cells so nearby soundings reuse them.

**Imagery pixels** are read off Esri World Imagery tiles: a 24 px core and a 48 px context ring at zoom 18, twenty colour and texture statistics, scored by a multinomial logistic regression fitted to 1,038 patches labelled from OSM polygons across 24 US regions plus 42 hand-checked sites (`calib/`). On regions it never saw it reaches 49% balanced accuracy over nine classes and a log-loss of 1.54 (v2's hand-set signatures scored 2.90, worse than a blind guess at 2.48). Path and rail abstain: a canopied trail is pixel-identical to its canopy. Bright white reads as snow only above 1,800 m or beyond 62° latitude; elsewhere it reads as bare. Esri's "no imagery here" placeholder tile is detected and skipped.

**NLCD** land cover, tree canopy %, impervious % and the impervious *descriptor* (which names road versus roof) arrive in one WMS request. A 30 m pixel is a mixture and is read as one (`NLCD_MIX`).

**Terrain** is a USGS 3DEP rosette (10 m radius) in the US, one batched request for every station. 3DEP serves 1 m lidar where it has been flown and a 3 m or 10 m DEM otherwise (the Mist Trail, Four Mile Trail and Angels Landing are on the 10 m DEM), and the ledger names the cell size. Outside the US it is a ~90 m DEM from Open-Meteo, where an all-zero rosette means open sea. Scored with a Student-t kernel so one odd reading can't veto a class; the water term is asymmetric (flat helps, steep only mildly hurts, a channel helps).

**Nominatim** gives the nearest named feature, for the station in focus only (one request a second). It votes only when its polygon actually contains the point.

**Today** is the weather at the point from Open-Meteo's forecast model (`data/today.ts`, `engine/today.ts`): the current snow depth, the water in the top centimetre of soil, the rain over the last three days and the snowfall over the last week. These are model values on a grid a few kilometres wide, so stations in the same ~1 km square share one request, cached for an hour.

- **Fresh snow lies on top.** Snow at least 3 cm deep, with at least 1 cm fallen in the last week, doesn't vote against the map. It becomes a term on top of the answer: the ground is under snow with probability 0.55 + 0.35 (1 − e^(−depth / 15 cm)), which is 61% at 3 cm, 74% at 10 cm and 85% at 30 cm. The rest goes to whatever the other sources say is underneath. A lawn under fresh snow reads snow, with grass as runner-up.
- **Old snow only leans.** Snow the model holds with none fallen in a week counts as a light vote for snow. Weather models can keep a glacier under permanent snow: at Konkordia in October the model held 43 cm while the satellite saw bare rock.
- **Wet soil** (over 30% water) leans to wetland and away from bare ground.
- **Rain** is shown in the readout and doesn't vote.
- **Quiet.** With no snow and ordinary soil the source is *quiet* and stays out of the fusion entirely, so on most days it changes nothing.

**The newest pass** is the Sentinel-2 scene classification (SCL, 20 m) at the station's pixel (`data/sentinel.ts`, `data/cog.ts`, `engine/sentinel.ts`). Earth Search, a STAC API, lists the scenes over the stations from the last 60 days, newest first. Each scene's classification is a cloud-optimised GeoTIFF, read in the browser with two range requests, one for the file's header and one for the 512 × 512 tile the station falls in, and decompressed by the browser. Stations in one tile share it. About a second for a point in my runs.

- **Clear classes lean their way.** Vegetation leans to forest, grass, scrub, crop and wetland. Not vegetated leans to bare ground and built surfaces. Water and snow lean to water and snow.
- **No clear view, no vote.** Cloud, cloud shadow, thin cirrus, dark pixels, saturated and unclassified pixels say nothing about the ground. The station then tries the next older pass, up to four passes; one pass seen in two overlapping tiles counts once. With no clear view on any of them, the source is quiet.
- **Dated.** Full weight (0.8) for a pass up to 10 days old, fading to nothing at 60, so an old pass can't overrule today's map. It's an area source: a 20 m pixel can't refute a mapped road, path or building.
- **The satellite outweighs the model.** After a clear pass under ten days old that saw no snow, Today's snow counts only if some has fallen since that pass. At Konkordia on 8 October the model held 43 cm, the 5 October pass saw bare rock, and none had fallen since, so the model's snow didn't count.

Marks made under fresh snow are left out of a refit, like crossings: the snow decided them, not the weights. So are stations' doubt scores: under fresh snow only a close call is a reason to look.

**World cover** is Impact Observatory's 10 m land cover (with Microsoft and Esri), made from Sentinel-2, one map a year (`data/worldcover.ts`, `engine/worldcover.ts`). It answers wherever NLCD has no class: outside the lower 48, and inside the lower-48 box where NLCD comes back empty (southern Canada, northern Mexico) or fails. Where NLCD has a class it stands aside, so no answer in the US changes and land cover isn't counted twice. One request samples every station on a line (`getSamples` on a multipoint), cached for 30 days.

- **A mixture, like NLCD.** Trees stand for forest (78%) with some scrub and grass; rangeland for grass, scrub and bare ground (46%, 30%, 14%); built area for roofs and roads alike (34% each) with some grass; crops for crop (74%) and grass; flooded vegetation for wetland (62%); bare ground, snow / ice and water for themselves. Each share has a floor of 1.2%, as for NLCD, so nothing is ruled out.
- **Clouds abstain.** A pixel the yearly map marks as cloud says nothing.
- **Weight 0.6**, against NLCD's 0.75: the pixels are finer, the classes broader. It's an area source, so a 10 m pixel can't refute a mapped road, path or building.

## Fusion

1. Each source's log-likelihood is **mean-centred**, so it can only argue relatively, and clamped to ±8 nats.
2. **Sub-pixel floor.** Area-scale sources may support a narrow class but not refute it. Their negative evidence for path, rail, paved, building or water is floored below their own favourite, but only when something has seen that class within a few metres (or the map is too sparse for absence to mean anything, at 40% strength), and never when the source's own verdict physically can't host a tread (water, ice).
3. **Correlation discount.** The sum is divided by τ = Σ(active weights) / N_eff. N_eff (default 3.5, slider in the ledger) is how many genuinely independent voices the overlapping sources amount to. When sources drop out, τ falls on its own.
4. **Crossings.** At a station where the line crosses a mapped road, path, rail line or stream, that class's probability is set to its existence probability, max(0.93, Φ((w − d)/σ)), outside the discount; the other classes share the remainder by the evidence. A river crossed on a mapped bridge is crossed on the deck: the crossing takes the bridge's class (path, road or rail) and its ledger line says so. A ford stays water.
5. **Softmax, then a 2% uniform mixture** for irreducible error. Nothing reads 100%.

Confidence is 1 − H/H_max: how far the evidence moved the answer from knowing nothing.

## Doubt

Confidence says how far the evidence moved. Doubt says whether the answer is worth checking on the ground. `engine/doubt.ts` scores each station from 0 to 1 on two counts:

- **Close.** The call leads the runner-up by little: 1 − (p₁ − p₂) / 0.5, so a lead of 50 points or more isn't close at all.
- **Spread.** The sources disagree on which way the answer goes. Each source with a clear favourite (one class ahead of its others by 0.25 nats) counts, by its weight, as agreeing or dissenting; spread is the dissenting share. It counts direction, not strength. Seasonal snow over mapped bare rock reads bare at 95%, and the photo leans snow the whole time. That lean is the warning.

The score is 1 − (1 − close)(1 − spread): either one is a reason to look, both together more so. A station at 0.5 or more is worth a look. It gets an amber halo on the map, the transect gets a doubt band under the call strip, and the answer panel says why in plain words: *grass 49% or forest 48% · the map says grass, land cover says forest*.

**Check list.** The spots worth walking to along a line: the most doubtful stations, one per stretch (a station within 40 m of a more doubtful pick is left out), five at most, numbered in walking order. They carry their numbers on the map, the doubt band and the route card. The list exports as GPX 1.1 waypoints: the name is the number and the call, the note is the reason, and the link reopens the line with that station selected (`at=`, metres along the line).

Two cases don't count as disagreement. At a crossing, or on a path the line follows, geometry sets the call, so only a close call is a reason to look there. And an area source that can't resolve a 2 m tread doesn't dissent from a path, rail line, road or building: the sub-pixel floor above already says that's resolution, not evidence.

## Marks

A mark says what was really at a station: right, wrong (and what's really there), or not sure, and how you know (standing there, a photo, the imagery, local knowledge). It keeps each source's centred log-likelihoods at that moment, to four places, with the source's status, weight multiplier and any exact term, plus the prior, the call and its probability, and a link that reopens the station. That's what a refit needs to learn weights later, whatever the sources say by then. Marks live in an IndexedDB database of their own (`underfoot-marks`), apart from the network cache, and leave the device only when you export them.

## Refit

With ten or more marks to learn from, Underfoot can fit its source weights and N_eff to them (`engine/refit.ts`):

- **What it maximises.** The probability of each mark's true class under the app's own fusion, the same τ, clamp and ε mixture. A test checks the fit's probabilities equal `fuseParts`' to 12 places.
- **The pull.** An L2 penalty of 2 nats per squared change in log-weight pulls everything toward the defaults, so a handful of marks nudges: five marks move no weight by more than 10%.
- **The bounds.** The fit stays inside the ledger sliders' range: weights 0.05–2, N_eff 1–8.
- **How it fits.** Adam on the log-weights and log N_eff for 250 steps, with analytic gradients, in the browser.
- **What it learns from.** Not-sure marks don't count. Neither do marks where geometry made the call (a crossing, a followed path), since they say nothing about the weights.
- **Before and after.** Both are scored on marks each fit never saw: one at a time up to 40 marks, five ways beyond that.

You choose: *Use my weights* keeps the fit on this device and applies it at every visit, and the ledger says *Weights: yours · N marks*. *Reset* puts the default weights and N_eff back exactly, and the answers with them.

## Community weights

M3 fits one set of weights to everyone's shared marks (`engine/community.ts`), with the local refit's fit and three guards, so that no one person and no one round can move the weights far:

- **One person, one share.** Each browser shares under a random id, and its marks count as at most 10 marks between them, however many it sends.
- **Small steps, each one backed.** No weight, and not N_eff, moves more than 15% in a round. A weight moves only if more people's held-out marks do better with that move than worse, a vote of one per person.
- **A gate.** A fifth of the shared marks, chosen by id, are never trained on. A round needs marks from at least 5 people. It's published only if it does better on those held-out marks and calls no fewer of the engine's 18 fixtures right (`model/benchmark.json`, kept equal to the fixtures by a unit test).

The app runs on the newest published weights it can get (`app/weights.ts`): your own refit if you chose one, the community's otherwise, and the defaults, which are version 0, until the first community round. How the store, the refit and the switch-on work: [community.md](community.md).

## Field map and GPS uncertainty

Once a station's data is local, the engine is a function of position, so it's evaluated on a 2 m grid across 120 m (imagery on a 4 m lattice, filled in progressively). Every cell fuses the same sources as the station, today's snow on top included; the map, footprints and imagery vary cell by cell, and the rest hold their station values. Choosing ±σ m replaces the point answer with the field averaged under a Gaussian of that σ. Around a house, ±3 m still says building (97%); ±10 m spreads to 44% building with the yard and the street picking up the rest.

## Paths

Stations are spaced along the line (auto, or every 5–100 m, or vertices only), up to 48, plus a crossing station wherever the line crosses a mapped line feature or building edge. Forward–backward smoothing over a 35 m patch length lets neighbouring stations inform each other, for cover classes only. Objects and crossings are never smoothed, so a one-station grass flicker inside a forest run drops from 51% to 1% while a road crossing holds at 93%.

## Route surface report

`engine/report.ts` summarises a line for the card above the transect and the GeoJSON export (`route_report`):

- **Share of length per call.** Each station's call covers its own stretch of the line. Between two ordinary stations the boundary is the midpoint. A crossing covers what it crosses at its mapped width, so an 8 m street counts 8 m rather than the gap to its neighbouring stations, and the neighbours take the rest (a crossing with less room than that stops at the midpoints). The call strip on the transect draws the same stretches, so the two always agree and the lengths add up to the line.
- **Longest stretch** of each call, unbroken.
- **Crossings** by what they cross, with the names the map gives them.
- **Climb and descent** from the elevation profile, counted only once the line has risen or fallen a metre from its last turning point, so DEM noise isn't climbing. **Steepest grade** is the steepest held over at least 20 m.
- **Worth a look**: the stations whose [doubt](#doubt) is 0.5 or more, and the check list drawn from them.

## Following a path or road

A point 1 m from a mapped trail in a forest reads as forest, and that's a fair reading: the map puts the tread within its error, and every source that sees area says trees. A line that runs along that trail for 300 m, turning where it turns, is stronger evidence. Underfoot treats it the way it treats a crossing.

`engine/follow.ts` samples the line every 5 m and runs a three-state hidden Markov model along it: off any mapped line, on a path, or on a road. Roads are in the model so that a line down a street isn't matched to the sidewalk mapped beside it.

- **Distance.** The evidence for "on" at a sample is the distance to the nearest path or road past its modelled half-width, under a Student-t (ν = 4). The scale is 7 m for a recorded line (GPS fixes, a surveyed trail, a vertex every few metres) and 3 m for a hand-drawn chord, which was placed to within a few metres: 8 m beside a path is a choice, not noise. Chords between 20 and 60 m long get a scale in between.
- **Direction.** The line's own heading over ±10 m against the mapped line's, as an axial von Mises (κ = 2): running parallel argues for "on", crossing at right angles against.
- **Correlation.** Samples a few metres apart aren't independent fixes, so each counts at half weight, and the samples on a chord longer than 15 m share that chord's evidence. A 200 m hand-drawn chord is two clicks, not forty observations.
- **Persistence.** Changing state, including starting or ending on a mapped line, costs the same as a change every 250 m on average. Viterbi finds the likeliest sequence; stretches shorter than 40 m don't count.

On a followed stretch:

1. Each station moves onto the path or road it follows, so the imagery, land cover and terrain are read at the tread.
2. Its probability for that class is set to the existence probability, 93% for a path, outside the discount, as at a crossing. Area sources abstain on that class.
3. The line's weaving across the path it follows doesn't make crossing stations. A crossing of anything else is kept only where the followed path crosses it too (a footbridge over a creek), not where the line wandered over a river running beside the trail.

What it did is shown, not just applied. On the map, the followed stretch of the path turns solid in its class colour (the map's own lines are dashed) and a faint tie runs from each station back to where the line put it. Above the transect, a band marks each followed stretch and names the longest; the transect header says what the line follows and for how far; a followed station's panel says what it follows and how far it moved onto it.

The **follow** switch on the transect turns matching off, for a transect that runs beside a trail rather than along it. It's kept in the link (`f=0`) and in recent soundings.

## Here

Here follows the phone's fixes (the browser's `watchPosition`, high accuracy). `engine/live.ts` holds the rules:

- A fix is read when it has moved farther than its own reported accuracy from the last one read, and at least 3 m. Standing still doesn't flicker or re-request. A fix worse than ±50 m isn't read at all, and the status says so.
- The probe's spread is the fix's reported accuracy, in place of the ±3/5/10 m steps.
- The newest fix is read together with the last 200 m of usable fixes. The matcher runs over them as a live track. A live track's end is "now", not where a walk stopped, so it costs nothing to end on a trail (`openEnd`). If the newest fix lands on a followed stretch, it moves onto the path and reads as a followed station does, and the GPS disc isn't averaged over, because the match has resolved it.
- While Here is on, map taps peek instead of moving the probe, the gazetteer is asked at most once a minute, and recent soundings keep only the last reading.
- **Rec** keeps fixes that moved at least 3 m, or half their accuracy. Stop reads the recording as a line.

