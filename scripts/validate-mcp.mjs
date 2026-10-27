/* The MCP server as an agent meets it: the built server over stdio, each of
 * its five tools asked once in Yosemite Valley, live. Prints each answer's
 * summary, its size, its time and the progress it reported, then cancels a
 * batch partway and counts what the server asked after the cancel.
 *
 *   npm run build:headless && npm run mcp
 *
 * The server keeps its answers in a fresh folder each run, so every request
 * is a real one; scripts/lib/count-fetch.mjs counts them. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../tests/e2e/harness.mjs';

const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'underfoot-mcp-'));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [
    '--import',
    pathToFileURL(path.join(ROOT, 'scripts/lib/count-fetch.mjs')).href,
    path.join(ROOT, 'dist-headless/underfoot-mcp.mjs'),
  ],
  env: { ...process.env, UNDERFOOT_CACHE: cache },
  stderr: 'pipe',
});
const asked = [];
let rest = '';
transport.stderr.on('data', d => {
  const lines = (rest + d).split('\n');
  rest = lines.pop();
  for (const l of lines) {
    const m = /^fetch (\d+) (.*)$/.exec(l);
    if (m) asked.push([+m[1], m[2]]);
    else if (l.trim()) console.error('  server: ' + l);
  }
});
const client = new Client({ name: 'underfoot-validate', version: '0' });
await client.connect(transport);
const { tools } = await client.listTools();
console.log(`${tools.length} tools: ${tools.map(t => t.name).join(', ')}\n`);

const LONG = { timeout: 600000, resetTimeoutOnProgress: true };
const at = (lat, lon) => ({ lat, lon });
/* 100 m either side of Cook's Meadow's centre: four tiles */
const meadow = at(37.745046, -119.589358),
  dLat = 100 / 111320,
  dLon = 100 / (111320 * Math.cos((meadow.lat * Math.PI) / 180));
const square = [
  at(meadow.lat - dLat, meadow.lon - dLon),
  at(meadow.lat - dLat, meadow.lon + dLon),
  at(meadow.lat + dLat, meadow.lon + dLon),
  at(meadow.lat + dLat, meadow.lon - dLon),
];
const csv = fs
  .readFileSync(path.join(ROOT, 'tests/fixtures/batch/five-hundred.csv'), 'utf8')
  .trim()
  .split('\n')
  .slice(1)
  .map(l => {
    const [name, lat, lon] = l.split(',');
    return { name, lat: +lat, lon: +lon };
  });
const DEMO = [
  at(37.74856, -119.58683),
  at(37.7462, -119.588),
  at(37.7445, -119.59),
  at(37.743, -119.5899),
  at(37.7414, -119.5892),
];
const asks = [
  ['underfoot_point', { point: at(37.74856, -119.58683), going: ['foot'] }],
  ['underfoot_path', { points: DEMO, going: ['foot'] }],
  ['underfoot_points', { points: csv.slice(0, 60) }],
  ['underfoot_area', { outline: square }],
  ['underfoot_history', { point: meadow }],
];
const rows = [];
for (const [name, args] of asks) {
  const t0 = Date.now(),
    n0 = asked.length,
    seen = [];
  const r = await client.callTool({ name, arguments: args }, CallToolResultSchema, {
    ...LONG,
    onprogress: p => seen.push(p.progress),
  });
  const text = r.content[0]?.text || '',
    s = r.structuredContent || {};
  rows.push({
    name,
    s: (Date.now() - t0) / 1000,
    requests: asked.length - n0,
    chars: text.length,
    progress: seen.length,
    complete: s.complete,
  });
  console.log(`${name}: ${r.isError ? 'ERROR ' + text : s.summary}`);
}
console.log('\n| Tool | Time | Requests | Size (chars, ≈ tokens) | Progress reports | Complete |');
console.log('|---|--:|--:|--:|--:|---|');
for (const r of rows)
  console.log(
    `| ${r.name} | ${r.s.toFixed(1)} s | ${r.requests} | ${r.chars} (≈ ${Math.round(r.chars / 4)}) | ${r.progress} | ${r.complete} |`,
  );

/* a batch cancelled once its second group is in, on points 300 m north of the file's (none of them asked yet) */
const stop = new AbortController(),
  north = csv.slice(0, 160).map(p => ({ lat: p.lat + 0.003, lon: p.lon }));
let cut = 0;
const job = client
  .callTool({ name: 'underfoot_points', arguments: { points: north } }, CallToolResultSchema, {
    ...LONG,
    signal: stop.signal,
    onprogress: p => {
      if (p.progress >= 2 && !cut) {
        cut = Date.now();
        stop.abort();
      }
    },
  })
  .catch(e => e);
await job;
await new Promise(z => setTimeout(z, 8000));
/* the next group's requests go out together the moment it begins, which can be just before the cancel arrives */
const after = asked.filter(([t]) => t > cut),
  late = after.filter(([t]) => t > cut + 100);
console.log(
  `\nCancelled after 2 of ${Math.ceil(north.length / 40)}+ groups: the server asked ${after.length - late.length} requests ` +
    `in the first 100 ms after the cancel was sent (a group begun as it travelled), and ${late.length} in the 8 s after that` +
    (late.length ? ':\n' + late.map(([t, u]) => `  +${t - cut} ms ${u}`).join('\n') : ''),
);
await client.close();
fs.rmSync(cache, { recursive: true, force: true });
