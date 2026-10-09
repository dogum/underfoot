"""Synthetic patches and their features, for the test that holds the browser's
imagery features (src/engine/imagery-model.ts) to this Python (features.py).

    python3 agreement.py     # writes ../tests/unit/fixtures/img-features.json

The patches (48 x 48 RGB, base64) are drawn here from a fixed seed, so no
imagery is committed: noise, a bright roof with a unit on it, stripes like a
field, a smooth gradient, and a dark one.
"""
import base64, json
import numpy as np
from features import features

rng = np.random.default_rng(20261008)


def noise(lo=0, hi=255):
    return rng.integers(lo, hi, (48, 48, 3)).astype(np.uint8)


def roof():
    a = noise(60, 140)
    a[10:38, 8:40] = [214, 210, 202]
    a[20:24, 18:22] = 70
    return a


def stripes():
    a = np.zeros((48, 48, 3), np.uint8)
    for x in range(48):
        a[:, x] = [90, 140, 60] if (x // 4) % 2 else [120, 110, 70]
    return (a + rng.integers(0, 12, a.shape)).astype(np.uint8)


def gradient():
    g = np.linspace(40, 220, 48)
    a = np.stack([np.tile(g, (48, 1)), np.tile(g[::-1], (48, 1)).T, np.full((48, 48), 120)], -1)
    return a.astype(np.uint8)


def dark():
    return noise(0, 40)


patches = {'noise': noise(), 'roof': roof(), 'stripes': stripes(), 'gradient': gradient(), 'dark': dark()}
out = [{'name': k, 'px': base64.b64encode(a.tobytes()).decode(), 'features': features(a)} for k, a in patches.items()]
json.dump(out, open('../tests/unit/fixtures/img-features.json', 'w'), separators=(',', ':'))
print('wrote', len(out), 'patches')
