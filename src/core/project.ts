/** Where the project lives. Used for links out of the app. */
export const REPO_URL = 'https://github.com/dogum/underfoot';
export const SITE_URL = 'https://dogum.github.io/underfoot/';

/* the demo: Yosemite Valley, from the Ansel Adams Gallery in the village across
   Village and Northside drives, through Cook's Meadow, over the Merced River
   and Southside Drive into the woods to the Valley Loop Trail. A building,
   roads, trails, meadow, river and forest in under a kilometre. */
export const DEMO = [
  { lat: 37.74856, lon: -119.58683 },
  { lat: 37.7462, lon: -119.588 },
  { lat: 37.7445, lon: -119.59 },
  { lat: 37.743, lon: -119.5899 },
  { lat: 37.7414, lon: -119.5892 },
];

/**
 * The community store (M3): a Supabase table that takes anonymous inserts and
 * nothing else; its key can't read, change or delete a row. Empty until it's
 * switched on (docs/community.md). While it's empty, nothing is sent: Share
 * saves the batch as a file instead.
 */
export const STORE = { url: '', key: '', table: 'marks' };

/** A prefilled "Wrong call" issue for the sounding on screen (GitHub issue forms read field ids from the query). */
export function wrongCallUrl(hash: string, call?: string): string {
  const q = new URLSearchParams({
    template: 'wrong-call.yml',
    title: `Wrong call: ${call || '?'} → `,
    link: SITE_URL + hash,
  });
  return `${REPO_URL}/issues/new?${q}`;
}
