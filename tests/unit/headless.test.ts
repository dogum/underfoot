/* The headless reader: the shared sounding loads in Node without a page, a run
 * starts from the app's weights, and Node decodes pictures exactly as the
 * browser's canvas and Python's PIL do (the classifier was fitted on PIL's). */
import { afterAll, describe, expect, it } from 'vitest';
import FIX from './fixtures/decode.json';
import { PLATFORM } from '../../src/data/platform';
import { useNode } from '../../src/headless/node';
import { baseline, newRun } from '../../src/headless/sound';
import { stationsFor } from '../../src/sounding/stations';
import { SOURCES } from '../../src/core/classes';
import fs from 'node:fs';
import path from 'node:path';

const bytes = (b64: string) => {
  const b = Buffer.from(b64, 'base64');
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const fetch0 = globalThis.fetch;
afterAll(() => {
  globalThis.fetch = fetch0;
});

describe('the shared sounding', () => {
  it("imports nothing from the page's folders, so it runs without a browser", () => {
    const off: string[] = [];
    for (const dir of ['sounding', 'headless']) {
      const d = path.resolve(__dirname, '../../src', dir);
      for (const f of fs.readdirSync(d))
        for (const m of fs.readFileSync(path.join(d, f), 'utf8').matchAll(/from '\.\.\/(app|ui|map|io)\//g))
          off.push(`${dir}/${f} → ${m[1]}/`);
    }
    expect(off).toEqual([]);
  });
});

describe('a headless run', () => {
  it("starts from the app's weights, version 0 being the defaults", () => {
    const b = baseline();
    expect(b.label).toBe('defaults v0');
    for (const s of SOURCES) expect(b.weights[s.id]).toBe(s.w);
    const run = newRun({
      mode: 'path',
      verts: [
        { lat: 37.75, lon: -119.59 },
        { lat: 37.74, lon: -119.59 },
      ],
    });
    expect(run.follow && run.smooth).toBe(true);
    expect(run.spacing).toBe('auto');
  });
  it('lays out stations as the app does: one for a point, up to 48 along a line', () => {
    const p = { lat: 37.75, lon: -119.59 };
    expect(stationsFor({ mode: 'point', verts: [p], spacing: 'auto' })).toHaveLength(1);
    const line = stationsFor({ mode: 'path', verts: [p, { lat: 37.73, lon: -119.59 }], spacing: 'auto' });
    expect(line).toHaveLength(48);
    expect(line[47].d).toBeCloseTo(2224, -1);
  });
});

describe("Node's decoders", () => {
  it("decode a JPEG to exactly PIL's pixels", async () => {
    await useNode();
    const px = await PLATFORM.decode!(bytes(FIX.jpeg), 'image/jpeg');
    expect([px.width, px.height]).toEqual([32, 32]);
    expect(Buffer.from(px.data).equals(Buffer.from(FIX.jpegRgba, 'base64'))).toBe(true);
  });
  it('decode an RGB PNG to its exact numbers, opaque', async () => {
    await useNode();
    const px = await PLATFORM.decode!(bytes(FIX.png), 'image/png');
    expect(Buffer.from(px.data).equals(Buffer.from(FIX.pngRgba, 'base64'))).toBe(true);
  });
  it('name Underfoot on every request', async () => {
    let ua = '';
    globalThis.fetch = async (_: RequestInfo | URL, init?: RequestInit) => {
      ua = new Headers(init?.headers).get('user-agent') || '';
      return new Response('{}');
    };
    const { setUpFetch } = await import('../../src/headless/node');
    setUpFetch('underfoot/test');
    await fetch('https://example.org/');
    expect(ua).toBe('underfoot/test');
  });
});
