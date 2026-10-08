/* Names the untyped modules use but never declare or import.
 *
 *   node scripts/check-names.mjs
 *
 * Files still marked // @ts-nocheck get no type checking at all, so a call to
 * a function that was never imported passes tsc and only fails in a browser.
 * (The browser tests can't see it either: they copy the console handle onto
 * window, which turns every export into a global.) This copies src/, strips
 * the pragmas, and fails on "cannot find name" errors only; everything else
 * those files would report is left for when they're typed. */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/* inside node_modules, so the copy resolves the project's own packages and types */
const TMP = path.join(ROOT, 'node_modules/.cache/check-names');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
fs.cpSync(path.join(ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
fs.cpSync(path.join(ROOT, 'model'), path.join(TMP, 'model'), { recursive: true });
let stripped = 0;
for (const f of fs.readdirSync(path.join(TMP, 'src'), { recursive: true })) {
  const p = path.join(TMP, 'src', String(f));
  if (!p.endsWith('.ts')) continue;
  const s = fs.readFileSync(p, 'utf8');
  if (s.startsWith('// @ts-nocheck')) {
    fs.writeFileSync(p, s.replace(/^\/\/ @ts-nocheck.*\n/, ''));
    stripped++;
  }
}
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'tsconfig.json'), 'utf8'));
cfg.include = ['src'];
fs.writeFileSync(path.join(TMP, 'tsconfig.json'), JSON.stringify(cfg));
let out = '';
try {
  execFileSync(path.join(ROOT, 'node_modules/.bin/tsc'), ['--noEmit', '-p', TMP], { encoding: 'utf8' });
} catch (e) {
  out = String(e.stdout || '');
}
fs.rmSync(TMP, { recursive: true, force: true });
/* if tsc couldn't check at all (a config or resolution error), say so rather than pass */
const broken = out.split('\n').filter(l => /error TS(5\d{3}|6\d{3}|2688|2307):/.test(l));
if (broken.length) {
  console.error('The names check could not run:\n' + broken.join('\n'));
  process.exit(1);
}
/* TS2304 cannot find name, TS2552 cannot find name (did you mean…) */
const bad = out.split('\n').filter(l => /error TS(2304|2552):/.test(l));
if (bad.length) {
  console.error(`Undeclared names in src/ (${stripped} untyped files checked):\n` + bad.join('\n'));
  process.exit(1);
}
console.log(`No undeclared names (${stripped} untyped files checked).`);
