// @ts-nocheck — ported from the v3 single file; remove this line when the module is typed.
import { $ } from '../core/dom';

/* ==========================================================================
 * NETWORK — every endpoint is free, keyless and CORS-open.
 * Nothing waits on anything else; each source lands when it lands.
 * ========================================================================*/
export const NET = {
  inflight: 0,
  bump(d) {
    this.inflight += d;
    const s = $('#netState');
    if (!s) return;
    s.textContent = this.inflight > 0 ? `◍ ${this.inflight} request${this.inflight > 1 ? 's' : ''}` : 'idle';
    s.style.color = this.inflight > 0 ? 'var(--accent)' : 'var(--ink-3)';
  },
};

export async function jget(url, opt = {}) {
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
    if (e.name === 'AbortError') throw new Error('timed out');
    throw e;
  } finally {
    clearTimeout(to);
    NET.bump(-1);
  }
}

/* ---- persistent cache (IndexedDB). A per-viewer convenience only: every
   read and write is wrapped, and the app is fully correct without it. ---- */
export const IDB = {
  db: null,
  ok: true,
  open() {
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
  async get(k, ttl) {
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
  async put(k, v) {
    try {
      const db = await this.open();
      if (!db) return;
      db.transaction('kv', 'readwrite').objectStore('kv').put({ t: Date.now(), v }, k);
    } catch (e) {}
  },
};
export const DAY = 864e5;
export const MEM = new Map();
export async function cachedFetch(key, ttl, fn) {
  if (MEM.has(key)) return MEM.get(key);
  const p = (async () => {
    const hit = await IDB.get(key, ttl);
    if (hit != null) return hit;
    const v = await fn();
    if (v != null) IDB.put(key, v);
    return v;
  })();
  MEM.set(key, p);
  p.catch(() => MEM.delete(key));
  return p;
}

export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
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
