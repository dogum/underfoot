// @ts-nocheck — ported from the v3 single file; remove this line when the module is typed.

/* The "How Underfoot works" dialog (the ? button). Keep it in step with docs/method.md. */
export const ABOUT = `
<h2 class="dh">How Underfoot works</h2>
<p class="help">Every point or line you probe is a <i>sounding</i>, after the sailor's way of probing what lies below. A coordinate has no ground truth to look up, so Underfoot treats it as inference: start from base rates, let
eight weak and only partly independent sources move the log-odds, and report the posterior with the ledger attached.
Nothing waits on anything else — imagery and land cover usually land in under a second — and the verdict is marked
provisional until every source is in.</p>
<h3 class="dh">The sources</h3>
<p class="help"><b>OSM polygons and lines</b> come from <a href="https://openfreemap.org" style="color:var(--cool)">OpenFreeMap</a> vector
tiles — OpenStreetMap data on a CDN, versioned and cached forever. Earlier versions queried the Overpass API, but the public
instances spend much of the day returning 504s, and the main one now refuses pages opened from disk outright (it answers
<code>Origin: null</code> with a 406). Polygons that enclose the point vote by type, damped when nested; lines vote through a
normal CDF over ±1.8 m of centreline error against the surface's half-width — 99% on a street centreline, 67% on a footpath
centreline, because a 1.6 m tread and ±1.8 m of geometry genuinely leave that much room. The map's silence counts too, scaled
by how densely the neighbourhood is mapped.</p>
<p class="help"><b>Building footprints</b> are FEMA's USA Structures — every US structure over ~450 sq ft, with occupancy and
height — fetched in fixed 0.004° cells so nearby soundings reuse them.</p>
<p class="help"><b>Imagery pixels</b> are read straight off Esri's CORS-open tiles: a 24 px core and a 48 px context ring at
zoom 18, twenty colour and texture statistics, scored by a logistic model fitted to 1,038 patches labelled automatically
from OSM polygons across 24 US regions plus 42 hand-checked sites. Scored on regions it never saw, it reaches 49% balanced
accuracy over nine classes — and, more importantly, a log-loss of 1.54 where the v2 hand-tuned signatures scored 2.90,
worse than guessing. The photo's date, source resolution and stated accuracy are shown; coarse source imagery is
down-weighted. Path and rail abstain: a canopied trail is pixel-identical to its canopy.</p>
<p class="help"><b>NLCD</b> land cover, tree canopy %, impervious % and the impervious <i>descriptor</i> (which names road versus
roof) arrive in one request. A 30 m pixel is a mixture, read as one. <b>Terrain</b> is a USGS 3DEP rosette in the US,
read from 1 m lidar where it has been flown and a 3 m or 10 m DEM elsewhere (one batched request for every station);
outside the US it comes from Open-Meteo, where an all-zero rosette means open sea.
<b>Nominatim</b> gives the nearest named feature, for the station in focus only (its policy is one request a second).</p>
<h3 class="dh">The fusion</h3>
<p class="help">Each source is mean-centred, so it can only argue relatively. Area-scale sources may support a narrow class
but not refute it — a 30 m pixel cannot see a trail — unless their own verdict physically cannot host one (water, ice).
The summed evidence is divided by τ = active weight ÷ N_eff, the number of genuinely independent voices the overlapping
sources amount to (default 3.5); when half the sources drop out abroad, τ falls on its own. The result is mixed with 2%
uniform mass for irreducible error, which is why nothing reads 100%. The prior defaults to <i>probed</i> — what people
actually point at — with the land-surface prior one tap away.</p>
<h3 class="dh">Field map, GPS and paths</h3>
<p class="help"><b>Field map</b> — once a station's data is local the engine is just a function of position, so it is evaluated
on a 2 m grid across 120 m: the engine's own picture of the neighbourhood. <b>GPS accuracy</b> — pick ±3, 5 or 10 m and the
answer becomes the field averaged under that error disc, which is what a phone fix actually tells you. <b>Paths</b> are
lines now, with stations spaced along them, draggable vertices, an elevation profile, and forward–backward smoothing so a
one-station flicker inside a forest run is recognised as noise while a real road crossing survives.</p>
<h3 class="dh">Keys</h3>
<p class="help"><kbd>P</kbd> point · <kbd>L</kbd> line · <kbd>Enter</kbd> finish line · <kbd>⌫</kbd> remove last vertex ·
<kbd>[</kbd> <kbd>]</kbd> step stations · <kbd>F</kbd> field · <kbd>V</kbd> vectors · <kbd>G</kbd> cycle GPS accuracy ·
<kbd>+</kbd>/<kbd>−</kbd> zoom · <kbd>K</kbd> lock / unlock · <kbd>/</kbd> search · <kbd>?</kbd> this.</p>
<p class="help"><b>Lock</b> (the padlock under the map layers) freezes the probe or line: dragging pans, a click picks a station, and on touch a tap peeks at the
field under your finger. Search, pasted coordinates, files and Recent still load new soundings while locked.</p>
<p class="help">On a phone or tablet: tap to place, drag a ◆ to reshape, long-press a ◆ to delete it, Undo / Done while drawing, pinch to zoom.</p>
<p class="help">Underfoot is open source: <a href="https://github.com/dogum/underfoot" style="color:var(--cool)">github.com/dogum/underfoot</a>.
Spot a wrong call? Export → <b>Report a wrong call</b> opens an issue with the sounding linked; every report becomes a test case.</p>
<p class="help" style="color:var(--ink-4)">Caveats: OSM completeness varies by region; NLCD, footprints and 3DEP are US-only; photos
can be years old and leaf-off; the classifier was trained on US imagery. Read the percentages as calibrated opinion, not
measurement — every source and weight is on screen so you can disagree with one.</p>`;
