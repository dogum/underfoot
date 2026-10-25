/**
 * Node as the host for a headless sounding (data/platform). Pictures are
 * decoded with mozjpeg compiled to WebAssembly, which gives Esri's tiles bit
 * for bit what Chrome's canvas and Python's PIL give, and terrain PNGs with
 * fast-png. Answers are kept in memory, and on disk if asked. Every request
 * names Underfoot, as Nominatim's usage policy asks of every caller.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { deserialize, serialize } from 'node:v8';
import { VERSION } from '../core/classes';
import { SITE_URL } from '../core/project';
import { PLATFORM } from '../data/platform';
import type { Pixels } from '../data/platform';

export interface NodeOptions {
  /** keep answers on disk here between runs; none by default */
  cacheDir?: string | null;
  /** how Underfoot names itself to the services it asks */
  userAgent?: string;
  /** answers kept in memory, most recent first */
  keep?: number;
}

let ready: Promise<void> | null = null;

/** set Node up as the host; safe to call more than once */
export function useNode(opt: NodeOptions = {}): Promise<void> {
  return (ready ??= setUp(opt));
}

async function setUp(opt: NodeOptions) {
  const req = createRequire(import.meta.url);
  const jpeg = await import('@jsquash/jpeg/decode.js');
  await jpeg.init(
    await WebAssembly.compile(readFileSync(req.resolve('@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm'))),
  );
  const { decode: png } = await import('fast-png');
  PLATFORM.decode = async (bytes, type) => {
    if (type === 'image/png') return rgba(png(new Uint8Array(bytes)));
    const im = await jpeg.default(bytes);
    const d = im.data;
    return {
      data: new Uint8ClampedArray(d.buffer, d.byteOffset, d.byteLength),
      width: im.width,
      height: im.height,
    };
  };
  PLATFORM.store = opt.cacheDir ? onDisk(opt.cacheDir) : inMemory(opt.keep ?? 2000);
  PLATFORM.keep = opt.keep ?? 2000;
  setUpFetch(opt.userAgent ?? `underfoot/${VERSION} (+${SITE_URL})`);
}

/** name Underfoot on every request this process makes, unless the caller named itself */
export function setUpFetch(ua: string) {
  const f = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const h = new Headers(init?.headers);
    if (!h.has('user-agent')) h.set('user-agent', ua);
    return f(input, { ...init, headers: h });
  };
}

/** a decoded PNG of any layout as RGBA: grey, grey and alpha, RGB, RGBA, or a palette */
function rgba(p: {
  width: number;
  height: number;
  data: ArrayLike<number>;
  channels: number;
  depth: number;
  palette?: number[][];
}): Pixels {
  const n = p.width * p.height,
    out = new Uint8ClampedArray(n * 4),
    d = p.data,
    c = p.channels,
    k = p.depth === 16 ? 1 / 257 : 1;
  for (let i = 0; i < n; i++) {
    if (p.palette) {
      const e = p.palette[d[i]] || [0, 0, 0, 255];
      out.set([e[0], e[1], e[2], e[3] ?? 255], i * 4);
    } else if (c >= 3) {
      out[i * 4] = d[i * c] * k;
      out[i * 4 + 1] = d[i * c + 1] * k;
      out[i * 4 + 2] = d[i * c + 2] * k;
      out[i * 4 + 3] = c === 4 ? d[i * c + 3] * k : 255;
    } else {
      out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = d[i * c] * k;
      out[i * 4 + 3] = c === 2 ? d[i * c + 1] * k : 255;
    }
  }
  return { data: out, width: p.width, height: p.height };
}

interface Kept {
  t: number;
  v: unknown;
}
/** answers in memory, the oldest dropped past `max` */
function inMemory(max: number) {
  const m = new Map<string, Kept>();
  return {
    async get(k: string, ttl?: number) {
      const e = m.get(k);
      return e && (!ttl || Date.now() - e.t < ttl) ? e.v : null;
    },
    put(k: string, v: unknown) {
      m.delete(k);
      m.set(k, { t: Date.now(), v });
      if (m.size > max) m.delete(m.keys().next().value!);
    },
  };
}
/** answers on disk, one file per key, written with Node's structured serialiser (ArrayBuffers included) */
function onDisk(dir: string) {
  mkdirSync(dir, { recursive: true });
  const file = (k: string) => join(dir, createHash('sha1').update(k).digest('hex'));
  return {
    async get(k: string, ttl?: number) {
      try {
        const e = deserialize(readFileSync(file(k))) as Kept;
        return !ttl || Date.now() - e.t < ttl ? e.v : null;
      } catch {
        return null;
      }
    },
    put(k: string, v: unknown) {
      try {
        writeFileSync(file(k), serialize({ t: Date.now(), v }));
      } catch {}
    },
  };
}
