# Imagery classifier calibration

How `model/img_model.json` was fitted. Python 3 with numpy, scikit-learn, Pillow and shapely.

## v4 (M6): flat roofs, construction ground, abroad, older captures

v3 read a factory's white roof as bare ground, which matters for the time machine: a cleared-then-built site has to read as built. v4 adds data where v3 was weakest and three shape features.

1. `sample4.py` writes `labels4.json`: 120 large footprints from FEMA USA Structures in 12 US metros v3 never saw, 80 construction sites and quarries from OpenStreetMap, and 505 land-cover points in 18 regions abroad sampled from OpenFreeMap tiles (`osmtiles.py` holds the tile helpers from `sample2.py`). None is within 3 km of the 36 places abroad that score the app.
2. `dig_checked.json`: each construction point looked at by eye; the 30 that are bare ground in today's picture are kept.
3. `patches4.py` reads every point's patch from today's Esri World Imagery and from three older Wayback releases (2014, 2017, 2019). An older picture is kept only where it still matches today's (normalised cross-correlation ≥ 0.6 within an 8 px shift) and isn't identical to it, so today's label still applies. It writes the 23 features (`X4.npy`), labels (`y4.npy`), regions (`grp4.json`) and where each row came from (`meta4.json`). All 1,038 v3 points re-read with unchanged features.
4. `features.py` computes the features: v3's 20 plus *rect* (edge energy along the two strongest perpendicular directions), *flat* (share of the core near its median brightness) and *sparse* (share of edge energy in the strongest 10% of pixels: a roof's seams and units against soil's even texture).
5. `fit4.py` holds out one region at a time and compares v4 with v3. `fit4.py --export` writes `img_model.json` and the class medians the engine tests use (`tests/unit/fixtures/class_median_feats.json`). `img_model_v3.json` is v3 as shipped, for the comparison.

Held out by region (balanced accuracy / log-loss; v3 is scored as shipped where it never saw the region, and by its own held-out refit on its 24 regions):

| held out | v3 | v4 |
|---|---|---|
| v3's regions, today | 0.490 / 1.54 | 0.535 / 1.41 |
| 18 regions abroad, today | 0.228 / 1.74 | 0.306 / 1.72 |
| older captures, all regions | 0.290 / 1.58 | 0.417 / 1.27 |
| flat roofs read building (120) | 21% | 57% |
| construction read bare (30) | 50% | 53% |
| buildings abroad read building (144) | 30% | 44% |
| crops abroad read crop (64) | 25% | 23% |

Roofs over 60,000 sq ft are the hard part: a 48 px patch inside one is mostly smooth roof. v4 reads 34 of 72 as building (v3: 11) and 27 as bare; of the 48 smaller roofs it reads 34 (v3: 14). Larger models (an MLP, gradient-boosted trees) didn't beat the logistic regression on held-out log-loss. Boosted trees read 77% of roofs right but were confidently wrong elsewhere (log-loss 1.77 against 1.61, on the 20 features). About one label in seven abroad is wrong (OSM grass that is a park with trees, for instance), which caps what the abroad scores can show.

The browser computes the same 23 features in `src/engine/imagery-model.ts`. `agreement.py` draws five synthetic patches and writes their features to `tests/unit/fixtures/img-features.json`, and `tests/unit/imagery.test.ts` holds the browser to them. On all 2,553 real patches the two agree to 3e-6 (the shape features to 1e-14).

## v3

1. `sites.py`, `sample2.py`: pick sample points across 24 US regions and 42 hand-checked sites.
2. `patches2.py`, `patches3.py`: read a 24 px core + 48 px context patch of Esri World Imagery at z18 for each point and compute the 20 features (`Xr.npy`); labels come from enclosing OSM polygons (`autolabel.py`, `labels2.json`, `y.npy`); `grp.json` holds each patch's region for held-out validation.
3. `fit.py`, `fit2.py`, `fit3.py`: compare models with leave-one-region-out cross-validation. Multinomial logistic regression (C = 0.03, balanced classes) won: balanced accuracy 0.490, log-loss 1.541 (the v2 hand-set signatures: 0.336, 2.900).
4. `export.py`: fit on everything and write `img_model.json`.

## Imagery

The image patches (`px48.npz`, `px4.npz`) and mosaics aren't in the repo: they're Esri imagery, which isn't ours to redistribute. `patches3.py` and `patches4.py` regenerate them.
