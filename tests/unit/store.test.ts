/// <reference types="node" />
/* The community store's table (supabase/migrations) against the app: its
 * columns are exactly what a shared mark carries, and its checks allow
 * exactly the app's classes, priors and answers. There's no database here, so
 * this is what keeps the two from drifting apart. */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { K, PRIORS } from '../../src/core/classes';
import { cellOf, toRow } from '../../src/io/contribute';
import { HOW, keepParts } from '../../src/io/marks';

const dir = new URL('../../supabase/migrations/', import.meta.url);
const sql = readdirSync(dir)
  .filter(f => f.endsWith('.sql'))
  .map(f => readFileSync(new URL(f, dir), 'utf8'))
  .join('\n');
const table = sql.slice(
  sql.indexOf('create table public.marks ('),
  sql.indexOf(');', sql.indexOf('create table public.marks (')),
);
const columns = table
  .split('\n')
  .slice(1)
  .map(l => l.trim().split(/\s+/)[0])
  .filter(w => w && w !== 'check');
const allowed = (col: string) => {
  const m = table.match(new RegExp(`\\n\\s*${col}\\s.*check \\(${col} in \\(([^)]*)\\)\\)`));
  return m
    ? m[1]
        .split(',')
        .map(s => s.trim().replace(/'/g, ''))
        .sort()
    : null;
};
const row = toRow(
  {
    id: 'mark-0001',
    t: Date.UTC(2026, 9, 8),
    lat: 37.745,
    lon: -119.589,
    verdict: 'wrong',
    call: 'grass',
    p: 0.58,
    truth: 'wetland',
    how: 'here',
    parts: keepParts({}),
    prior: 'probed',
    place: null,
    link: '#',
    station: 1,
    d: null,
    v: '1.2.1',
  },
  'browser-0001',
);

describe('the store table', () => {
  it('has a column for each field a shared mark carries, and the time it arrived', () => {
    expect(columns.sort()).toEqual([...Object.keys(row), 'received'].sort());
  });
  it('allows exactly the twelve classes, for the call and the truth', () => {
    expect(allowed('call')).toEqual([...K].sort());
    expect(allowed('truth')).toEqual([...K].sort());
  });
  it('allows exactly the priors, the ways of knowing and right or wrong', () => {
    expect(allowed('prior')).toEqual(Object.keys(PRIORS).sort());
    expect(allowed('how')).toEqual(Object.keys(HOW).sort());
    expect(allowed('verdict')).toEqual(['right', 'wrong']);
  });
  it("its patterns accept the app's cells and months", () => {
    const pattern = (col: string) => new RegExp(table.match(new RegExp(`${col} ~ '([^']+)'`))![1]);
    for (const [lat, lon] of [
      [37.7, -119.6],
      [-33.9, 151.2],
      [0.5, -0.5],
      [64.1, -21.9],
    ])
      expect(cellOf(lat, lon)).toMatch(pattern('cell'));
    expect(row.month).toMatch(pattern('month'));
  });
  it('lets the public insert and nothing else', () => {
    expect(sql).toMatch(/enable row level security/);
    expect(sql).toMatch(/revoke all on public\.marks from anon, authenticated;/);
    expect(sql).toMatch(/grant insert on public\.marks to anon;/);
    expect(sql.match(/create policy [^;]*;/g)).toEqual([
      'create policy "anyone can add a mark" on public.marks for insert to anon with check (true);',
    ]);
  });
});
