/**
 * Community weights in the app (docs/community.md): the copy of
 * model/weights.json bundled into the build, replaced by a newer one from the
 * site when there is one. The offline underfoot.html fetches it too, so a copy
 * on disk picks up newer weights whenever it's online, and keeps its own
 * otherwise. Version 0 is the defaults.
 */
import BUNDLED from '../../model/weights.json';
import { SITE_URL } from '../core/project';
import { DAY, cachedFetch, jget } from '../data/http';
import { defaultFit, type Fit, type Weights } from '../engine/refit';
import type { WeightsFile } from '../core/types';

let community = BUNDLED as WeightsFile;

/** the community weights in use: their version, marks and people */
export const communityFile = (): WeightsFile => community;
/** the weights a sounding starts from unless you chose your own: the community's */
export const baseline = (): Fit => ({
  /* weights published before a source existed have none for it: it keeps its default */
  weights: { ...defaultFit().weights, ...community.weights } as Weights,
  neff: community.neff,
});

const valid = (f: unknown): f is WeightsFile =>
  !!f &&
  typeof (f as WeightsFile).version === 'number' &&
  (f as WeightsFile).neff > 0 &&
  Object.values((f as WeightsFile).weights || {}).every(v => typeof v === 'number' && v > 0);

/** fetch the site's weights.json (cached for a day); true if it's newer than what's in use */
export async function loadCommunity(): Promise<boolean> {
  try {
    const f = await cachedFetch('weights', DAY, () => jget(SITE_URL + 'weights.json', { timeout: 8000 }));
    if (!valid(f) || f.version <= community.version) return false;
    community = f;
    return true;
  } catch {
    return false;
  }
}
