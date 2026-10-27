/**
 * What the data layer needs from its host that a browser and Node do
 * differently. In a browser nothing is set and the browser's own way is used
 * (canvas to decode pictures, IndexedDB to keep answers); the headless reader
 * (src/headless/node.ts) fills these in before it reads anything.
 */
export interface Pixels {
  /** RGBA, row by row */
  data: Uint8ClampedArray;
  width: number;
  height: number;
}
export interface Platform {
  /** decode a JPEG or PNG to RGBA, exactly as a browser's canvas does (no colour management) */
  decode?: (bytes: ArrayBuffer, type: 'image/jpeg' | 'image/png') => Promise<Pixels>;
  /** a key–value store with a time-to-live, in place of IndexedDB */
  store?: { get(k: string, ttl?: number): Promise<unknown>; put(k: string, v: unknown): void };
  /** at most this many answers kept in memory, oldest dropped first; unset keeps all (a page's lifetime is short) */
  keep?: number;
}
export const PLATFORM: Platform = {};
