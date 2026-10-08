/* npm run community: bundles scripts/community/refit.ts with the app's own
 * engine (src/engine, TypeScript) for Node, then runs it with the same
 * arguments. See scripts/community/refit.ts for what it does. */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'rolldown';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(ROOT, 'node_modules/.cache/community/refit.mjs');
await build({
  input: path.join(ROOT, 'scripts/community/refit.ts'),
  platform: 'node',
  logLevel: 'warn',
  output: { file: out, format: 'esm' },
});
await import(pathToFileURL(out).href);
