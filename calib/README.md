# Imagery classifier calibration

How `model/img_model.json` was fitted. Python 3 with numpy and scikit-learn.

1. `sites.py`, `sample2.py`: pick sample points across 24 US regions and 42 hand-checked sites.
2. `patches2.py`, `patches3.py`: read a 24 px core + 48 px context patch of Esri World Imagery at z18 for each point and compute the 20 features (`Xr.npy`); labels come from enclosing OSM polygons (`autolabel.py`, `labels2.json`, `y.npy`); `grp.json` holds each patch's region for held-out validation.
3. `fit.py`, `fit2.py`, `fit3.py`: compare models with leave-one-region-out cross-validation. Multinomial logistic regression (C = 0.03, balanced classes) won: balanced accuracy 0.490, log-loss 1.541 (the v2 hand-set signatures: 0.336, 2.900).
4. `export.py`: fit on everything and write `img_model.json`.

The raw image patches (`px48.npz`) and mosaics aren't in the repo: they're Esri imagery, which isn't ours to redistribute. `patches3.py` regenerates them.

The browser computes the same 20 features in `src/engine/imagery-model.ts` (`imgStats`, `imgFeatures`); the JS and Python versions were checked to agree to 6.5e-7.
