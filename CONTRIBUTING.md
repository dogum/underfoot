# Contributing to Underfoot

Thanks for wanting to help. The most useful contributions right now:

1. **Report a wrong call.** Use the *Wrong call* issue template: paste the link (the URL carries the point or line) and say what's really there. These become the ground truth the model is tested and refit against.
2. **Suggest a data source** that's free, keyless and readable from a browser (see the checklist below).
3. **Code**: pick an issue labelled `good first issue`, or type one of the `// @ts-nocheck` modules.

## Setup

```bash
npm install
npm run dev        # http://localhost:5173
npm run check      # format check, typecheck, unit tests, both builds: run before every PR
npm run format     # Prettier
npm run e2e        # browser tests against dist-single/underfoot.html
npm run trails     # walk ten national-park trails and score the calls (docs/validation.md)
npm run spots      # sound 36 labelled places abroad and score the calls
```

The images in the README come from `npm run build && npm run assets` (needs ffmpeg), so they always show the current app.

Browser tests need a Chromium that Playwright can drive (`npx playwright install chromium`, or set `CHROMIUM_PATH`). They cache every network response in `tests/e2e/.netcache`, so only the first run touches the public APIs.

## Ground rules

- **Free, keyless, browser-readable data only.** No API keys, no accounts, no proxy server. The offline `underfoot.html` has to keep working from disk (`Origin: null`).
- **Be a good guest.** Cache responses (IndexedDB is already wired up), batch requests, keep Nominatim to one request a second, and credit every source on the map.
- **The engine stays pure.** `src/engine/` takes facts and geometry and returns numbers. No DOM, no network. That's what lets the unit tests run in Node in a second.
- **Every behaviour change comes with a test**: a fixture in `tests/unit/engine.test.ts` for engine changes, a check in `tests/e2e/` for interaction changes. Engine changes also report `npm run trails` and `npm run spots` before and after.
- **PRs that change what you see include a screenshot** (desktop and phone width if layout is touched).
- **TypeScript as you go.** When you substantially edit a `// @ts-nocheck` file, type it and drop the line. Shared shapes live in `src/core/types.ts`.

## Adding a data source — checklist

- [ ] Free and keyless, with terms that allow this use. Note any non-commercial restriction in the README.
- [ ] Answers `Origin: null` with `Access-Control-Allow-Origin` (test: `curl -sI -H 'Origin: null' <url>`).
- [ ] A fetcher in `src/data/<source>.ts` using `cachedFetch` with a sensible TTL.
- [ ] An evidence function returning a centred log-likelihood (`ll`), a status and a human-readable `note`, plus an entry in `SOURCES` with a default weight and scale (`area` or `tread`). New sources get a typed module of their own (`src/engine/today.ts` is the newest), wired into `computeParts` in `src/engine/fuse.ts`.
- [ ] Its default weight in `model/weights.json` (version 0 is the defaults), and the benchmark refreshed: `UPDATE_BENCHMARK=1 npx vitest run tests/unit/engine.test.ts`.
- [ ] Fixtures showing it helps where it should and stays quiet where it shouldn't.
- [ ] Attribution on the map and in the README.

## Commit style

Short imperative subject (`Add Sentinel-2 date to the imagery panel`), a body that says why. Reference issues with `#123`.
