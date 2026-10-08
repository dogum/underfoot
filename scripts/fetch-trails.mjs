/* Download the trail fixtures used by scripts/validate-trails.mjs.
 *
 *   npm run trails:fetch
 *
 * Each trail is one feature of the National Park Service's Public Trails
 * dataset, written out as GPX in tests/fixtures/trails/. NPS data is a work of
 * the U.S. federal government and in the public domain. The files are
 * committed, so this only needs rerunning to add a trail or refresh one. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests/fixtures/trails');
const SERVICE =
  'https://mapservices.nps.gov/arcgis/rest/services/NationalDatasets/NPS_Public_Trails/FeatureServer/0';

/** slug, NPS OBJECTID, and a short note on what the trail is like underfoot */
const TRAILS = [
  ['yose-mist-trail', 19515, 'granite steps beside the Merced River, up to Vernal Fall'],
  ['yose-valley-loop', 15609, 'valley floor, pine forest and meadow edges; mapped with GNSS to 1–5 m'],
  ['yose-four-mile', 15283, 'switchbacks up the south wall of Yosemite Valley to Glacier Point'],
  ['zion-angels-landing', 4152, 'sandstone fin with chains, 450 m above the canyon floor'],
  ['grca-bright-angel', 1323, 'rim to river: limestone switchbacks, desert scrub, Havasupai Gardens'],
  ['mora-skyline', 15017, 'subalpine meadow above Paradise, snow into July'],
  ['yell-midway-geyser-basin', 5634, 'boardwalk past Grand Prismatic Spring'],
  ['ever-anhinga', 25482, 'boardwalk over sawgrass marsh and open water'],
  ['grsm-alum-cave', 22826, 'hardwood and rhododendron forest; mapped with differential GPS'],
  ['glac-hidden-lake', 5811, 'alpine boardwalk and trail from Logan Pass'],
];

const xml = s =>
  String(s ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
const known = v => (v && !/^unknown$/i.test(v) ? v : 'unknown');

async function feature(id) {
  const q = new URLSearchParams({
    where: `OBJECTID=${id}`,
    outFields: 'OBJECTID,UNITCODE,UNITNAME,TRLNAME,TRLSURFACE,TRLCLASS,MAPMETHOD,XYACCURACY',
    outSR: '4326',
    f: 'json',
  });
  const r = await fetch(`${SERVICE}/query?${q}`);
  if (!r.ok) throw new Error(`NPS ${id}: HTTP ${r.status}`);
  const j = await r.json();
  if (!j.features?.length) throw new Error(`NPS ${id}: not found`);
  return j.features[0];
}

fs.mkdirSync(OUT, { recursive: true });
for (const [slug, id, note] of TRAILS) {
  const f = await feature(id);
  const a = f.attributes;
  // multi-part features (a loop, a spur) keep their longest part, so the GPX is one continuous line
  const part = f.geometry.paths.reduce((best, p) => (p.length > best.length ? p : best));
  const pts = part.map(([lon, lat]) => `      <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"/>`);
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Underfoot scripts/fetch-trails.mjs" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${xml(a.TRLNAME)} · ${xml(a.UNITNAME)}</name>
    <desc>${xml(note)}. NPS Public Trails OBJECTID ${a.OBJECTID}. Surface: ${xml(known(a.TRLSURFACE))}. Class: ${xml(known(a.TRLCLASS))}. Mapping method: ${xml(known(a.MAPMETHOD))}. Horizontal accuracy: ${xml(known(a.XYACCURACY))}. Public domain, U.S. National Park Service.</desc>
    <link href="${SERVICE}"><text>NPS Public Trails</text></link>
  </metadata>
  <trk>
    <name>${xml(a.TRLNAME)}</name>
    <src>National Park Service</src>
    <type>${xml(known(a.TRLSURFACE))}</type>
    <trkseg>
${pts.join('\n')}
    </trkseg>
  </trk>
</gpx>
`;
  fs.writeFileSync(path.join(OUT, slug + '.gpx'), gpx);
  console.log(`${slug.padEnd(26)} ${a.UNITCODE}  ${String(part.length).padStart(5)} points  ${a.TRLSURFACE}`);
}
