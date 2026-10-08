/**
 * GPX out: waypoints for a phone or a GPS unit, as GPX 1.1. Pure: a string
 * from plain data, so it's tested in Node. Elements follow the schema's order
 * (metadata before waypoints; name, cmt, desc, link inside each), which strict
 * readers enforce.
 */
export interface Waypoint {
  lat: number;
  lon: number;
  name: string;
  /** the short note a GPS unit shows (GPX cmt) */
  cmt?: string;
  /** the longer note an app shows (GPX desc) */
  desc?: string;
  link?: string;
  linkText?: string;
}
export interface GpxMeta {
  name: string;
  link?: string;
  linkText?: string;
  time?: Date;
}

const ENT: Record<string, string> = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' };
const esc = (s: string) => s.replace(/[<>&"']/g, c => ENT[c]);
const link = (href: string, text: string | undefined, pad: string) =>
  `${pad}<link href="${esc(href)}">${text ? `<text>${esc(text)}</text>` : ''}</link>`;

export function waypointsGpx(meta: GpxMeta, wpts: Waypoint[], creator = 'Underfoot'): string {
  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<gpx version="1.1" creator="${esc(creator)}" xmlns="http://www.topografix.com/GPX/1/1" ` +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
      'xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">',
    '  <metadata>',
    `    <name>${esc(meta.name)}</name>`,
  ];
  if (meta.link) out.push(link(meta.link, meta.linkText, '    '));
  /* whole seconds: some readers reject fractional ones */
  out.push(
    `    <time>${(meta.time || new Date()).toISOString().replace(/\.\d+Z$/, 'Z')}</time>`,
    '  </metadata>',
  );
  for (const w of wpts) {
    out.push(
      `  <wpt lat="${w.lat.toFixed(7)}" lon="${w.lon.toFixed(7)}">`,
      `    <name>${esc(w.name)}</name>`,
    );
    if (w.cmt) out.push(`    <cmt>${esc(w.cmt)}</cmt>`);
    if (w.desc) out.push(`    <desc>${esc(w.desc)}</desc>`);
    if (w.link) out.push(link(w.link, w.linkText, '    '));
    out.push('  </wpt>');
  }
  out.push('</gpx>', '');
  return out.join('\n');
}
