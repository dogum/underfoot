/* The community refit job (scripts/community/lib): rows as the store keeps
 * them in; the next weights file, a changelog entry and a summary out. */
import { describe, it, expect } from 'vitest';
import { K, SOURCES } from '../../src/core/classes';
import { markFromRow } from '../../src/engine/community';
import { addEntry, refitJob, type WeightsFile } from '../../scripts/community/lib';
import BENCH from '../../model/benchmark.json';
import V0 from '../../model/weights.json';
import { marks } from './synthetic';
import type { ClassKey, SharedRow } from '../../src/core/types';

/* synthetic marks as rows from the store */
const rows = (n: number, each: number, seed: number, world?: Parameters<typeof marks>[2]): SharedRow[] =>
  Array.from({ length: n }, (_, p) =>
    marks(each, seed + p, world).map((m, k) => ({
      id: `m${seed}-${p}-${k}`,
      who: `browser-${seed}-${p}`,
      version: '1.3.0',
      month: '2026-10',
      cell: 'N37W120',
      verdict: 'wrong' as const,
      call: 'grass' as ClassKey,
      p_call: 0.5,
      truth: m.truth,
      how: 'here' as const,
      prior: 'probed',
      readings: Object.fromEntries(
        Object.entries(m.parts).map(([id, p]) => [
          id,
          {
            ll: Object.fromEntries(K.map((k, c) => [k, p!.ll[c]])) as Record<ClassKey, number>,
            status: p!.status,
          },
        ]),
      ),
      lat: null,
      lon: null,
    })),
  ).flat();
const v0 = V0 as WeightsFile;

describe('reading rows', () => {
  const r = rows(1, 1, 1)[0];
  it('a row becomes the mark it was, readings by class and all', () => {
    const m = markFromRow(r)!;
    expect(m.who).toBe(r.who);
    expect(Array.from(m.parts.image!.ll)).toEqual(K.map(k => r.readings.image!.ll[k]));
  });
  it('a mark made under another prior, or a malformed one, is left out', () => {
    expect(markFromRow({ ...r, prior: 'land' })).toBeNull();
    expect(markFromRow({ ...r, truth: 'lava' as ClassKey })).toBeNull();
    expect(markFromRow({ ...r, readings: { radar: r.readings.image } } as unknown as SharedRow)).toBeNull();
    expect(
      markFromRow({
        ...r,
        readings: { image: { ...r.readings.image!, ll: { grass: NaN } } },
      } as unknown as SharedRow),
    ).toBeNull();
  });
});

describe('a round', () => {
  const job = refitJob(rows(30, 10, 100), v0, BENCH, '2026-11-01');
  it('publishes v1 from thirty people, the photo up by a round’s step', () => {
    expect(job.next!.version).toBe(1);
    expect(job.next!.weights.image).toBe(1.15);
    expect(job.next!.people).toBe(30);
    expect(job.used).toBe(300);
  });
  it('writes what moved into the changelog, newest first', () => {
    expect(job.entry).toMatch(/^## v1 · 2026-11-01\n\n300 marks from 30 people\./);
    expect(job.entry).toMatch(/\| Imagery pixels \| 1\.00 \| 1\.15 \|/);
    const log = addEntry('# Weights changelog\n\nIntro.\n\n## v0 · 2026-10-08\n\nThe defaults.\n', job.entry);
    expect(log.indexOf('## v1')).toBeLessThan(log.indexOf('## v0'));
    expect(log.startsWith('# Weights changelog\n\nIntro.\n\n## v1')).toBe(true);
  });
  it('one person alone gets nothing published, and the summary says why', () => {
    const lone = refitJob(rows(1, 300, 7), v0, BENCH, '2026-11-01');
    expect(lone.next).toBeNull();
    expect(lone.entry).toBe('');
    expect(lone.summary).toMatch(/^\*\*Nothing published\.\*\* marks from 1 person; a round needs 5\./);
  });
  it('the weights file has every source, rounded to four places', () => {
    expect(Object.keys(job.next!.weights).sort()).toEqual(SOURCES.map(s => s.id).sort());
    for (const v of Object.values(job.next!.weights)) expect(Math.round(v * 1e4) / 1e4).toBe(v);
  });
});

describe('v0', () => {
  it('model/weights.json starts as the defaults', () => {
    expect(v0.version).toBe(0);
    for (const s of SOURCES) expect(v0.weights[s.id]).toBe(s.w);
    expect(v0.neff).toBe(3.5);
  });
});
