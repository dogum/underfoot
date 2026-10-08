// @ts-nocheck — ported from the v3 single file; remove this line when the module is typed.
/**
 * Export: GeoJSON with full posteriors and evidence, CSV, copy link, report a wrong call.
 */
import { STATE } from '../app/state';
import { K, NAME, SOURCES, VERSION } from '../core/classes';
import { $, el, toast } from '../core/dom';
import { hashFor, writeHash } from './hash';
import { SITE_URL, wrongCallUrl } from '../core/project';
import { routeReport } from '../engine/report';
import { shareNow } from '../ui/share';
import { exportCheckGpx } from '../ui/checklist';
import { closeMenus, keepOnScreen } from '../ui/menus';

/* ---- export -------------------------------------------------------------- */
export function download(name, text, type) {
  const a = el('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}
export function stationRows() {
  return STATE.results
    .map((r, i) => {
      if (!r || !r.view) return null;
      const f = r.view,
        raw = r.fused;
      return {
        station: i + 1,
        lat: +r.station.lat.toFixed(7),
        lon: +r.station.lon.toFixed(7),
        distance_m: +r.station.d.toFixed(1),
        call: f.top,
        p_call: +f.topP.toFixed(4),
        runner_up: K[f.order[1]],
        p_runner_up: +f.p[f.order[1]].toFixed(4),
        confidence: +f.conf.toFixed(3),
        doubt: r.doubt ? +r.doubt.score.toFixed(3) : null,
        entropy_bits: +f.bits.toFixed(3),
        view: r.mode,
        probs: Object.fromEntries(K.map((k, c) => [k, +f.p[c].toFixed(4)])),
        raw_probs: Object.fromEntries(K.map((k, c) => [k, +raw.p[c].toFixed(4)])),
        evidence_bits: Object.fromEntries(
          raw.ledger.map(l => [l.id, l.status === 'ok' ? +l.bits.toFixed(3) : null]),
        ),
        nlcd: r.sh.nlcd ? r.sh.nlcd.name : null,
        canopy_pct: r.sh.nlcd ? r.sh.nlcd.canopy : null,
        impervious_pct: r.sh.nlcd ? r.sh.nlcd.imperv : null,
        elevation_m: r.sh.terr ? +r.sh.terr.z.toFixed(2) : null,
        slope_deg: r.sh.terr ? +r.sh.terr.slope.toFixed(2) : null,
        photo_date: r.sh.imeta ? r.sh.imeta.date : null,
        place: (r.sh.nom && r.sh.nom.display_name) || null,
      };
    })
    .filter(Boolean);
}
/* the route surface report for the line on screen (engine/report), or null for a point */
export function currentReport() {
  if (STATE.mode !== 'path' || STATE.stations.length < 2) return null;
  const R = STATE.results;
  return routeReport(
    STATE.stations,
    R.map(
      r => r && r.view && { top: r.view.top, topP: r.view.topP, conf: r.view.conf, doubt: r.doubt?.score },
    ),
    STATE.profile,
    STATE.stations.map((s, i) =>
      s.x && R[i] && R[i].q && R[i].q.best[s.x.cls] ? R[i].q.best[s.x.cls].name : null,
    ),
  );
}
const r1 = v => Math.round(v * 10) / 10;
export function reportJSON(rep) {
  if (!rep) return undefined;
  return {
    length_m: r1(rep.length),
    classes: rep.classes.map(c => ({
      call: c.cls,
      length_m: r1(c.m),
      share: +c.share.toFixed(4),
      longest_m: r1(c.longest.m),
      longest_from_m: r1(c.longest.d0),
    })),
    pending_m: r1(rep.pending),
    crossings: rep.crossings.map(c => ({ crosses: c.cls, count: c.n, names: c.names })),
    climb_m: rep.climb == null ? null : r1(rep.climb),
    descent_m: rep.descent == null ? null : r1(rep.descent),
    steepest_grade: rep.steepest ? +rep.steepest.grade.toFixed(4) : null,
    steepest_from_m: rep.steepest ? r1(rep.steepest.d0) : null,
    doubtful_stations: rep.doubtful.map(x => x.i + 1),
    check_list: rep.checks.map(x => x.i + 1),
  };
}
export function exportGeoJSON() {
  const rows = stationRows(),
    fc = {
      type: 'FeatureCollection',
      properties: {
        generator: 'Underfoot v' + VERSION,
        created: new Date().toISOString(),
        prior: STATE.priorName,
        n_eff: STATE.neff,
        gps_sigma_m: STATE.gps,
        smoothing: STATE.mode === 'path' && STATE.smooth ? 'forward-backward' : 'none',
        route_report: reportJSON(currentReport()),
      },
      features: [],
    };
  if (STATE.verts.length > 1)
    fc.features.push({
      type: 'Feature',
      properties: { kind: 'path' },
      geometry: { type: 'LineString', coordinates: STATE.verts.map(p => [p.lon, p.lat]) },
    });
  for (const r of rows) {
    const { lat, lon, ...props } = r;
    fc.features.push({
      type: 'Feature',
      properties: { kind: 'station', ...props },
      geometry: { type: 'Point', coordinates: [lon, lat] },
    });
  }
  download(
    `underfoot-${new Date().toISOString().slice(0, 10)}.geojson`,
    JSON.stringify(fc, null, 1),
    'application/geo+json',
  );
}
export function exportCSV() {
  const rows = stationRows();
  if (!rows.length) return;
  const cols = [
    'station',
    'lat',
    'lon',
    'distance_m',
    'call',
    'p_call',
    'runner_up',
    'p_runner_up',
    'confidence',
    'doubt',
    'entropy_bits',
    'view',
    ...K.map(k => 'p_' + k),
    ...SOURCES.map(s => 'bits_' + s.id),
    'nlcd',
    'canopy_pct',
    'impervious_pct',
    'elevation_m',
    'slope_deg',
    'photo_date',
    'place',
  ];
  const q = v =>
    v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  const lines = [cols.join(',')].concat(
    rows.map(r =>
      cols
        .map(c =>
          c.startsWith('p_') && c !== 'p_call' && c !== 'p_runner_up'
            ? q(r.probs[c.slice(2)])
            : c.startsWith('bits_')
              ? q(r.evidence_bits[c.slice(5)])
              : q(r[c]),
        )
        .join(','),
    ),
  );
  download(`underfoot-${new Date().toISOString().slice(0, 10)}.csv`, lines.join('\n'), 'text/csv');
}
export function showExport() {
  const m = $('#exportMenu');
  m.textContent = '';
  const item = (t, s, fn) => {
    const b = el('button');
    b.append(el('b', null, t), el('small', null, s));
    b.onclick = () => {
      closeMenus();
      fn();
    };
    m.append(b);
  };
  if (!STATE.results.some(r => r && r.view)) {
    m.innerHTML = '<div class="empty">Nothing sounded yet.</div>';
  } else {
    item('Share card', 'a picture of the call with the link that reopens it', () => shareNow());
    item('GeoJSON', 'stations with full posteriors, evidence in bits, and the path line', exportGeoJSON);
    item('CSV', 'one row per station — opens in Excel', exportCSV);
    if (currentReport()?.checks.length)
      item(
        'Check list (GPX)',
        'the spots most worth a look, as waypoints for a phone or GPS',
        exportCheckGpx,
      );
    item('Copy link', 'this probe or line as a URL you can bookmark', () => {
      writeHash();
      const u = location.protocol === 'file:' ? SITE_URL + location.hash : location.href;
      navigator.clipboard &&
        navigator.clipboard.writeText(u).then(
          () => toast('Link copied'),
          () => toast(u),
        );
    });
    item(
      'Report a wrong call',
      'opens a GitHub issue with this sounding linked: say what is really there',
      () => {
        const r = STATE.results[STATE.sel];
        /* an issue link has to stay under GitHub's URL limit: a coarser line is plenty */
        open(wrongCallUrl(hashFor(400), r && r.view ? NAME[r.view.top] : undefined), '_blank', 'noopener');
      },
    );
  }
  m.classList.toggle('on');
  keepOnScreen(m);
}
