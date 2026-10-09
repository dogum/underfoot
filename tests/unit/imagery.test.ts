/// <reference types="node" />
/* The browser's imagery features against calib/features.py, on synthetic
 * patches drawn by calib/agreement.py: the model was fitted on the Python
 * numbers, so the browser has to compute the same ones. */
import { describe, it, expect } from 'vitest';
import PATCHES from './fixtures/img-features.json';
import { IMG_MODEL, imgFeatures, imgLogLik } from '../../src/engine/imagery-model';

/** a 48 x 48 RGB patch as the RGBA raster the app reads */
const rgba = (b64: string) => {
  const rgb = Buffer.from(b64, 'base64'),
    out = new Uint8ClampedArray(48 * 48 * 4);
  for (let i = 0; i < 48 * 48; i++) {
    out[i * 4] = rgb[i * 3];
    out[i * 4 + 1] = rgb[i * 3 + 1];
    out[i * 4 + 2] = rgb[i * 3 + 2];
    out[i * 4 + 3] = 255;
  }
  return out;
};

describe('imagery features', () => {
  it('the model reads as many features as the browser computes', () => {
    const v = imgFeatures(rgba(PATCHES[0].px), 48, 24, 24).v;
    expect(v).toHaveLength(IMG_MODEL.mu.length);
    expect(IMG_MODEL.W[0]).toHaveLength(v.length);
    expect(IMG_MODEL.features).toHaveLength(v.length);
  });
  for (const p of PATCHES)
    it(`match calib/features.py on the ${p.name} patch`, () => {
      const v = imgFeatures(rgba(p.px), 48, 24, 24).v;
      v.forEach((x, i) => expect(Math.abs(x - p.features[i])).toBeLessThan(1e-5));
    });
  it('a bright roof with a unit on it is square-edged and its edges are concentrated', () => {
    const f = (n: string) => imgFeatures(rgba(PATCHES.find(p => p.name === n)!.px), 48, 24, 24).v;
    expect(f('roof')[20]).toBeGreaterThan(f('noise')[20]);
    expect(f('roof')[22]).toBeGreaterThan(f('noise')[22]);
  });
  it('every class gets a log-likelihood between the floor (-6) and 0', () => {
    for (const p of PATCHES) {
      const lp = imgLogLik(imgFeatures(rgba(p.px), 48, 24, 24).v);
      for (const c of IMG_MODEL.classes) {
        expect(lp[c]).toBeGreaterThanOrEqual(-6);
        expect(lp[c]).toBeLessThanOrEqual(0);
      }
    }
  });
});
