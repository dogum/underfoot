# Community weights

Underfoot's source weights can learn from everyone's right and wrong marks, without anyone sharing where they walk. This page covers how a shared mark travels, what the store accepts, and how to switch the whole thing on. **It isn't switched on yet.** Everything is built and tested except a live store, which waits until there are people to fill it.

## How a mark travels

1. **Marks ▸ Share** in the app shows every field that will leave the browser, then sends a batch of right and wrong marks (`io/contribute.ts`). The fields are listed in the README under *Your marks and privacy*. While the store is off, Share saves the batch as a file instead.
2. **The store** is one Supabase table, `marks`, that anyone can add rows to and nobody but the refit job can read (`supabase/migrations/`).
3. **The refit** reads the marks, fits new weights with the guards in `engine/community.ts`, and publishes them only if they do better on marks they never trained on and no worse on the engine's fixtures (`model/benchmark.json`). A published round writes `model/weights.json` and an entry in the [weights changelog](weights-changelog.md).
4. **The app** starts with the copy of `model/weights.json` built into it, then fetches the site's `weights.json` (cached for a day) and uses it if it's a newer version (`app/weights.ts`). The offline `underfoot.html` does the same whenever it's online. Your own refit, if you chose one, comes first; *Reset* returns to the community's weights exactly. The ledger's first line says which are in use: *community v3 · 1,240 marks* with a link to what moved, *yours*, *adjusted* after a slider moves, or *defaults*, which are version 0.

## The refit

`npm run community` runs one round (`scripts/community/refit.ts`):

```bash
npm run community -- --from supabase              # the store, with SUPABASE_URL and SUPABASE_SECRET_KEY set
npm run community -- --from a.json b.json --dry   # batches saved from the app's Share, writing nothing
```

It reads every shared mark, leaves out rows made under the *land* prior or malformed, and starts from the current `model/weights.json`. If the round passes its gate it rewrites that file and adds a changelog entry; either way it prints a summary of what it saw, what it would move and why. Each round starts from the last published weights, so the weights move a step at a time over several rounds.

## The store

`supabase/migrations/20261008120000_community_marks.sql` creates the table and its rules:

- **Columns** are exactly what a shared mark carries, plus the time it arrived. `tests/unit/store.test.ts` keeps the columns and the allowed values (the twelve classes, the priors, the ways of knowing) equal to the app's.
- **Checks** refuse anything malformed: an id of 6–64 characters, a month like `2026-10`, a cell like `N37W120`, a probability between 0 and 1, readings under 8 KB, a point only with both its coordinates, and a *right* mark's truth equal to its call.
- **Row-level security** gives the public (`anon`) one thing: insert. It can't read, change or delete a row, its own included. The refit job reads with the service role.
- **A daily limit** of 500 marks per browser keeps the table's size in check. It doesn't protect the fit; the fit caps each person's influence itself.

## Switching it on

When the project has enough walkers to make it worthwhile:

1. Create a Supabase project (the free tier is enough) and run the migration: `supabase db push`, or paste the file into the SQL editor.
2. Put the project's URL and its **publishable** key in `STORE` in `src/core/project.ts`. That key can only insert rows into `marks`; it's meant to be public. This is the app's first key, so add a line saying so to the "keyless" rule in `CONTRIBUTING.md`.
3. Add two repository secrets for the refit job: `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (the service role key, which never goes in the app).
4. Release. Share now reads *Share N marks* instead of *Save N as a file*.

## How often the weights change

`.github/workflows/community-refit.yml` runs the refit on the first of each month, and on demand. Once marks grow, its schedule moves to weekly (the workflow says how). While the store's secrets aren't set it does nothing. When a round passes its gate, it opens a pull request with the new `model/weights.json` and changelog entry, so every change to the weights is reviewed and merged by hand. A round that doesn't pass publishes nothing and says why in the run's summary.
