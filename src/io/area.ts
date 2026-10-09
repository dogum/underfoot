/**
 * Area mode's exports (app/area): a CSV of acres per class, and GeoJSON of
 * the outline and the cells' calls, merged along each row so a 5-acre lot
 * isn't 5,000 squares.
 */
import { STATE } from '../app/state';
import { K, NAME } from '../core/classes';
import { projector } from '../core/geo';
import { ACRE, inRing } from '../engine/area';
import { FIELD_CELL, FIELD_HALF, FIELD_N } from '../engine/field';
import { download } from './export';

const stamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');
const r7 = (v: number) => Math.round(v * 1e7) / 1e7;

export function areaCSV(): string | null {
  const A = STATE.area,
    s = A?.sum;
  if (!A || !s) return null;
  const rows = K.map((k, c) => ({ k, m2: s.byClass[c], mos: s.mosaic[c] }))
    .filter(r => r.m2 > 0.5 || r.mos > 0.5)
    .sort((a, b) => b.m2 - a.m2);
  return [
    'class,name,acres,hectares,m2,share,acres_by_call',
    ...rows.map(r =>
      [
        r.k,
        `"${NAME[r.k]}"`,
        (r.m2 / ACRE).toFixed(3),
        (r.m2 / 1e4).toFixed(4),
        r.m2.toFixed(1),
        (r.m2 / s.m2).toFixed(4),
        (r.mos / ACRE).toFixed(3),
      ].join(','),
    ),
  ].join('\n');
}

export function areaGeoJSON(): object | null {
  const A = STATE.area,
    v = STATE.verts,
    s = A?.sum;
  if (!A || !s || v.length < 3) return null;
  const P = projector(v[0].lat, v[0].lon),
    ll = (x: number, y: number) => {
      const [lat, lon] = P.inv(x, y);
      return [r7(lon), r7(lat)];
    };
  /* each class's cells, merged along each row of each tile into rectangles */
  const rects: Record<string, number[][][][]> = {};
  A.tiles.forEach((F, t) => {
    if (!F) return;
    const [cx, cy] = A.centres[t];
    for (let j = 0; j < FIELD_N; j++) {
      const y1 = cy + FIELD_HALF - j * FIELD_CELL,
        y0 = y1 - FIELD_CELL;
      let run: { k: string; i0: number } | null = null;
      const close = (i1: number) => {
        if (!run) return;
        const x0 = cx - FIELD_HALF + run.i0 * FIELD_CELL,
          x1 = cx - FIELD_HALF + i1 * FIELD_CELL;
        (rects[run.k] ||= []).push([[ll(x0, y0), ll(x1, y0), ll(x1, y1), ll(x0, y1), ll(x0, y0)]]);
        run = null;
      };
      for (let i = 0; i < FIELD_N; i++) {
        const x = cx - FIELD_HALF + (i + 0.5) * FIELD_CELL,
          inside = inRing(x, y1 - FIELD_CELL / 2, A.ring);
        let k: string | null = null;
        if (inside) {
          const o = (j * FIELD_N + i) * K.length;
          let best = 0;
          for (let c = 1; c < K.length; c++) if (F.probs[o + c] > F.probs[o + best]) best = c;
          k = K[best];
        }
        if (run && run.k !== k) close(i);
        if (k && !run) run = { k, i0: i };
      }
      close(FIELD_N);
    }
  });
  const outline = [...v, v[0]].map(p => [r7(p.lon), r7(p.lat)]);
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { kind: 'outline', acres: +(s.m2 / ACRE).toFixed(3), m2: Math.round(s.m2) },
        geometry: { type: 'Polygon', coordinates: [outline] },
      },
      ...Object.entries(rects).map(([k, polys]) => ({
        type: 'Feature',
        properties: {
          kind: 'cells',
          class: k,
          name: NAME[k as keyof typeof NAME],
          acres_by_call: +(s.mosaic[K.indexOf(k as never)] / ACRE).toFixed(3),
          cell_m: FIELD_CELL,
        },
        geometry: { type: 'MultiPolygon', coordinates: polys },
      })),
    ],
  };
}

export function exportAreaCSV() {
  const t = areaCSV();
  if (t) download(`underfoot-area-${stamp()}.csv`, t, 'text/csv');
}
export function exportAreaGeoJSON() {
  const g = areaGeoJSON();
  if (g) download(`underfoot-area-${stamp()}.geojson`, JSON.stringify(g), 'application/geo+json');
}
