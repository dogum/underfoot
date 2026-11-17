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
  : ['soundings', 'interact', 'mobile', 'lock', 'live', 'marks', 'years', 'batch'];
const run = s =>
  spawnSync(process.execPath, [path.join(HERE, s + '.mjs')], { stdio: 'inherit', env: process.env })
    .status === 0;
let failed = SUITES.filter(s => !run(s));
/* E2E_AGAIN=1 (the weekly canary, against the live services): a suite that failed is run once more.
   What answered the first time comes from the cache, so only what failed is asked again: a slow
   hour at one service passes the second time, a moved endpoint or a dropped CORS header doesn't.
   Both tries are reported. */
let again = [];
if (failed.length && process.env.E2E_AGAIN === '1') {
  console.log(`\n↻ once more: ${failed.join(', ')}`);
  again = failed.filter(run);
  failed = failed.filter(s => !again.includes(s));
}
const lines = [
  ...(again.length ? [`↻ failed, then passed on a second try: ${again.join(', ')}`] : []),
  failed.length ? `✗ failed: ${failed.join(', ')}` : `✓ e2e: ${SUITES.join(', ')} all passed`,
];
console.log('\n' + lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY)
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n\n') + '\n');
process.exit(failed.length ? 1 : 0);
