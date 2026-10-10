/**
 * Pacing for Open-Meteo. Its free tier allows 600 calls a minute, 5,000 an
 * hour and 10,000 a day, and a request for many places counts each place: a
 * batch's first run met 121 refusals (HTTP 429) at about 200 requests a
 * minute. So every forecast and elevation request waits here until its
 * places fit under a margin below those limits, counted in this tab.
 */
const LIMITS: [number, number][] = [
  [60e3, 500],
  [3600e3, 4500],
];
const log: [number, number][] = [];
let queue: Promise<unknown> = Promise.resolve();

/** how long a request for `n` places must wait at `now`, ms (pure, given the log) */
export function waitFor(n: number, now: number, entries: [number, number][] = log): number {
  let wait = 0;
  for (const [span, max] of LIMITS) {
    let u = entries.reduce((s, [t, k]) => (now - t < span ? s + k : s), 0);
    if (u + n <= max) continue;
    /* the earliest time enough of the window's calls have aged out */
    for (const [t, k] of [...entries].sort((a, b) => a[0] - b[0])) {
      if (now - t >= span) continue;
      u -= k;
      if (u + n <= max) {
        wait = Math.max(wait, t + span - now + 50);
        break;
      }
    }
  }
  return wait;
}

/** a request to Open-Meteo for `n` places, paced; a refusal (429) waits half a minute and asks once more */
export async function openMeteoGet<T>(n: number, get: () => Promise<T>): Promise<T> {
  await paceOpenMeteo(n);
  try {
    return await get();
  } catch (e) {
    if (!/429/.test(String((e as Error).message))) throw e;
    await new Promise(z => setTimeout(z, 30e3));
    await paceOpenMeteo(n);
    return get();
  }
}

/** wait until `n` more places fit under Open-Meteo's limits, then count them */
export function paceOpenMeteo(n: number): Promise<void> {
  const turn = queue.then(async () => {
    for (;;) {
      const now = Date.now(),
        w = waitFor(n, now);
      if (!w) break;
      await new Promise(z => setTimeout(z, w));
    }
    const now = Date.now();
    log.push([now, n]);
    while (log.length && now - log[0][0] > 3600e3) log.shift();
  });
  queue = turn.catch(() => {});
  return turn;
}
