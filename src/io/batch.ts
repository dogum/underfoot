/**
 * A batch's exports (app/batch): CSV and GeoJSON, one row or feature per
 * point in the file's own order, with its name and columns carried through
 * and the call, its runner-up, the sources that answered and the doubt score.
 * Points not read yet are left in with empty answers.
 */
import type { BatchRow } from '../engine/batch';
import type { FilePoint } from './points';

const r7 = (v: number) => Math.round(v * 1e7) / 1e7;
/** a CSV field, quoted when it holds a separator, quote or line break */
export const csvField = (v: string | number | null | undefined) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function batchCSV(pts: FilePoint[], rows: (BatchRow | null)[], cols: string[]): string {
  const named = pts.some(p => p.name != null),
    head = [
      ...(named ? ['name'] : []),
      ...cols,
      'lat',
      'lon',
      'call',
      'p',
      'then',
      'p_then',
      'sources',
      'doubt',
    ];
  const lines = pts.map((p, i) => {
    const r = rows[i];
    return [
      ...(named ? [p.name ?? ''] : []),
      ...cols.map(c => p.props[c] ?? ''),
      r7(p.lat),
      r7(p.lon),
      r?.call ?? '',
      r ? r.p.toFixed(3) : '',
      r?.then ?? '',
      r ? r.pThen.toFixed(3) : '',
      r?.src ?? '',
      r ? r.doubt.toFixed(2) : '',
    ]
      .map(csvField)
      .join(',');
  });
  return [head.map(csvField).join(','), ...lines].join('\n') + '\n';
}

export function batchGeoJSON(pts: FilePoint[], rows: (BatchRow | null)[]) {
  return {
    type: 'FeatureCollection',
    features: pts.map((p, i) => {
      const r = rows[i];
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [r7(p.lon), r7(p.lat)] },
        properties: {
          ...(p.name != null ? { name: p.name } : {}),
          ...p.props,
          call: r?.call ?? null,
          p: r ? +r.p.toFixed(3) : null,
          then: r?.then ?? null,
          p_then: r ? +r.pThen.toFixed(3) : null,
          sources: r?.src ?? null,
          doubt: r ? +r.doubt.toFixed(2) : null,
        },
      };
    }),
  };
}
