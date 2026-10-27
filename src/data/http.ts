import { $ } from '../core/dom';
import { PLATFORM } from './platform';

/* ==========================================================================
 * NETWORK — every endpoint is free, keyless and CORS-open.
 * Nothing waits on anything else; each source lands when it lands.
 * ========================================================================*/
export const NET = {
  inflight: 0,
  bump(d: number) {
    this.inflight += d;
    /* no page (the unit tests), no label to update */
    const s = typeof document === 'undefined' ? null : $('#netState');
    if (!s) return;
    s.textContent = this.inflight > 0 ? `◍ ${this.inflight} request${this.inflight > 1 ? 's' : ''}` : 'idle';
    s.style.color = this.inflight > 0 ? 'var(--accent)' : 'var(--ink-3)';
  },
};

export interface GetOptions {
  /** ms */
  timeout?: number;
  method?: string;
  body?: BodyInit | null;
  headers?: HeadersInit;
  /** the reply as JSON (the default), raw bytes or text */
  as?: 'json' | 'buf' | 'text';
}
export function jget(url: string, opt: GetOptions & { as: 'buf' }): Promise<ArrayBuffer>;
export function jget(url: string, opt: GetOptions & { as: 'text' }): Promise<string>;
export function jget(url: string, opt?: GetOptions): Promise<any>;
export async function jget(url: string, opt: GetOptions = {}): Promise<unknown> {
  NET.bump(1);
  const ctl = new AbortController(),
    to = setTimeout(() => ctl.abort(), opt.timeout || 20000);
  try {
    const r = await fetch(url, {
      signal: ctl.signal,
      method: opt.method || 'GET',
      body: opt.body,
      headers: opt.headers,
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return opt.as === 'buf' ? await r.arrayBuffer() : opt.as === 'text' ? await r.text() : await r.json();
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('timed out');
    throw e;
  } finally {
    clearTimeout(to);
    NET.bump(-1);
  }
}

/* ---- persistent cache (IndexedDB). A per-viewer convenience only: every
   read and write is wrapped, and the app is fully correct without it. ---- */
export const IDB = {
  db: null as IDBDatabase | null,
  ok: true,
  open(): Promise<IDBDatabase | null> {
    if (this.db || !this.ok) return Promise.resolve(this.db);
    return new Promise(res => {
      try {
        const rq = indexedDB.open('underfoot', 1);
        rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
        rq.onsuccess = () => {
          this.db = rq.result;
          res(this.db);
        };
        rq.onerror = () => {
          this.ok = false;
          res(null);
        };
      } catch (e) {
        this.ok = false;
        res(null);
      }
    });
  },
  async get(k: string, ttl?: number): Promise<any> {
    if (PLATFORM.store) return PLATFORM.store.get(k, ttl);
    try {
      const db = await this.open();
      if (!db) return null;
      return await new Promise(res => {
        const q = db.transaction('kv').objectStore('kv').get(k);
        q.onsuccess = () => {
          const v = q.result;
          res(v && (!ttl || Date.now() - v.t < ttl) ? v.v : null);
        };
        q.onerror = () => res(null);
      });
    } catch (e) {
      return null;
    }
  },
  async put(k: string, v: unknown) {
    if (PLATFORM.store) return PLATFORM.store.put(k, v);
    try {
      const db = await this.open();
      if (!db) return;
      db.transaction('kv', 'readwrite').objectStore('kv').put({ t: Date.now(), v }, k);
    } catch (e) {}
  },
};
export const DAY = 864e5;
/** this page's answers and answers in flight, so one request serves every caller */
export const MEM = new Map<string, Promise<any>>();
/** keep an answer, or an answer in flight, in memory; a failure isn't kept */
export function remember<T>(key: string, p: Promise<T>): Promise<T> {
  MEM.set(key, p);
  p.catch(() => MEM.delete(key));
  if (PLATFORM.keep && MEM.size > PLATFORM.keep) MEM.delete(MEM.keys().next().value!);
  return p;
}
/** an answer from memory, then from IndexedDB within ttl ms, then from fn(); a failure isn't kept */
export async function cachedFetch<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> {
  if (MEM.has(key)) return MEM.get(key);
  const p = (async () => {
    const hit = await IDB.get(key, ttl);
    if (hit != null) return hit;
    const v = await fn();
    if (v != null) IDB.put(key, v);
    return v;
  })();
  return remember(key, p);
}

/** fn over every item, n at a time, in order; an item whose fn throws gives null, and none is begun once `live` turns false */
export async function pool<T, R>(
  items: T[],
  n: number,
  fn: (item: T, k: number) => Promise<R>,
  live: () => boolean = () => true,
): Promise<(R | null)[]> {
  const out = new Array<R | null>(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length && live()) {
        const k = i++;
        try {
          out[k] = await fn(items[k], k);
        } catch (e) {
          out[k] = null;
        }
      }
    }),
  );
  return out;
}
