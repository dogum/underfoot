/* npm run e2e — build-independent: tests whatever dist-single/underfoot.html (or UNDERFOOT_URL) holds. */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
if (!process.env.UNDERFOOT_URL && !fs.existsSync(path.join(HERE, '../../dist-single/underfoot.html'))) {
  console.error('No build found. Run `npm run build` first (or set UNDERFOOT_URL).');
  process.exit(1);
}
const SUITES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['soundings', 'interact', 'mobile', 'lock', 'live', 'marks', 'years'];
let failed = [];
for (const s of SUITES) {
  const r = spawnSync(process.execPath, [path.join(HERE, s + '.mjs')], {
    stdio: 'inherit',
    env: process.env,
  });
  if (r.status !== 0) failed.push(s);
}
console.log(failed.length ? `\n✗ failed: ${failed.join(', ')}` : `\n✓ e2e: ${SUITES.join(', ')} all passed`);
process.exit(failed.length ? 1 : 0);
