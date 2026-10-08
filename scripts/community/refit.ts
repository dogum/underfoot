/// <reference types="node" />
/**
 * The community refit (docs/community.md): read the shared marks, run one
 * round (engine/community), and if it passes its gate, write the next
 * model/weights.json and a docs/weights-changelog.md entry.
 *
 *   npm run community -- --from supabase            the store (SUPABASE_URL, SUPABASE_SECRET_KEY)
 *   npm run community -- --from a.json b.json       batches saved from the app's Share
 *   options: --dry (write nothing), --summary out.md, --date YYYY-MM-DD
 *
 * The scheduled workflow (.github/workflows/community-refit.yml) runs it and
 * opens a pull request when the weights change.
 */
import fs from 'node:fs';
import path from 'node:path';
import { addEntry, refitJob, type WeightsFile } from './lib';
import type { SharedRow } from '../../src/core/types';

const ROOT = process.cwd();
const args = process.argv.slice(2),
  opt = (k: string) => {
    const i = args.indexOf(k);
    return i < 0 ? null : args[i + 1];
  },
  from: string[] = [];
/* the sources: everything after --from up to the next option */
if (args.includes('--from'))
  for (const a of args.slice(args.indexOf('--from') + 1)) {
    if (a.startsWith('--')) break;
    from.push(a);
  }

/** every row in the store, oldest first, a page at a time, with the service role's key */
async function storeRows(): Promise<SharedRow[]> {
  const url = process.env.SUPABASE_URL,
    key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are needed to read the store');
  const out: SharedRow[] = [];
  for (let off = 0; ; off += 1000) {
    const res = await fetch(
      `${url.replace(/\/$/, '')}/rest/v1/marks?select=*&order=received.asc&limit=1000&offset=${off}`,
      {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      },
    );
    if (!res.ok) throw new Error(`the store answered ${res.status}`);
    const page = (await res.json()) as SharedRow[];
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

async function main() {
  if (!from.length) {
    console.error(
      'usage: npm run community -- --from supabase | <rows.json ...> [--dry] [--summary out.md] [--date YYYY-MM-DD]',
    );
    process.exit(2);
  }
  const rows =
    from[0] === 'supabase'
      ? await storeRows()
      : from.flatMap(f => JSON.parse(fs.readFileSync(path.resolve(ROOT, f), 'utf8')) as SharedRow[]);
  const weightsPath = path.join(ROOT, 'model/weights.json'),
    logPath = path.join(ROOT, 'docs/weights-changelog.md'),
    current = JSON.parse(fs.readFileSync(weightsPath, 'utf8')) as WeightsFile,
    bench = JSON.parse(fs.readFileSync(path.join(ROOT, 'model/benchmark.json'), 'utf8')),
    job = refitJob(rows, current, bench, opt('--date') || new Date().toISOString().slice(0, 10));
  console.log(job.summary);
  if (opt('--summary')) fs.writeFileSync(path.resolve(ROOT, opt('--summary')!), job.summary + '\n');
  if (job.next && !args.includes('--dry')) {
    fs.writeFileSync(weightsPath, JSON.stringify(job.next, null, 2) + '\n');
    fs.writeFileSync(logPath, addEntry(fs.readFileSync(logPath, 'utf8'), job.entry));
    console.log(`\nWrote model/weights.json (v${job.next.version}) and a changelog entry.`);
  }
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
