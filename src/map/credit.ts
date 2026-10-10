/**
 * The map's credits: the basemap's, OpenStreetMap's, and each data source's
 * while it's in the answer. The field legend sits above them however many
 * lines they take.
 */
import { STATE } from '../app/state';
import { $ } from '../core/dom';

let shown = '';

export function showCredit(base: string) {
  const used = (id: string) =>
    STATE.results.some(r => r?.parts?.[id as keyof NonNullable<typeof r.parts>]?.status === 'ok');
  const credit =
    base +
    ' · OSM data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors via <a href="https://openfreemap.org">OpenFreeMap</a>' +
    (used('pass') ? ' · contains modified Copernicus Sentinel data' : '') +
    (used('world') ? ' · land cover: Impact Observatory, Microsoft, Esri' : '') +
    (STATE.results.some(r => /^Terrain Tiles/.test(String(r?.sh?.terr?.src || '')))
      ? ' · elevation: <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md">Terrain Tiles</a> (Mapzen on AWS; SRTM courtesy of the USGS, and others)'
      : '');
  if (credit === shown) return;
  shown = credit;
  const a = $('#attrib');
  a.innerHTML = credit;
  $('#fieldLegend').style.bottom = `${a.offsetTop ? a.offsetHeight + 14 : 44}px`;
}
