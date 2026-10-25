/**
 * The longer jobs: many points, an area, a spot's history. Each reports its
 * progress when the client asks for it (a progress token), and stops when
 * the client cancels or goes away: nothing more is asked of any service.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { MAX_TILES } from '../engine/area';
import { BATCH } from '../engine/batch';
import { soundPoints } from '../headless/batch';
import { areaPlan } from '../sounding/area';
import { areaAnswer, historyAnswer, pointsAnswer } from './answers';
import type { PointsSeen } from './answers';
import { attributionOf } from './envelope';
import { Call, Check, Class, Close, Detail, LIMITS, LatLon, READ, Sources, Wrap, deadline } from './schema';
import type { Answer, Deps } from './server';
import { readOutline } from './track';

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;
/** progress to the client, if it asked for it */
function progressTo(extra: Extra) {
  const token = extra._meta?.progressToken;
  return (progress: number, total: number, message: string) => {
    if (token === undefined || extra.signal.aborted) return;
    void extra
      .sendNotification({
        method: 'notifications/progress',
        params: { progressToken: token, progress, total, message },
      })
      .catch(() => {});
  };
}

export function registerJobs(server: McpServer, deps: Deps, answer: Answer) {
  server.registerTool(
    'underfoot_points',
    {
      title: 'What is on the ground at many points',
      description:
        `What is on the ground at up to ${BATCH.max} separate points, read as the web app's batch reads a file: nearby ` +
        'points in groups of up to 40 that share their requests, one group at a time. Returns a row per point in the ' +
        'order given (the call, its probability, the runner-up and the doubt), the count of each class, and the points ' +
        'most worth checking, least sure first, each with a link. Reports progress per group and stops when cancelled. ' +
        `500 points take about two minutes. The place name isn't asked; read a point with underfoot_point for that. ${LIMITS}`,
      inputSchema: {
        points: z
          .array(
            LatLon.extend({ name: z.string().max(200).optional().describe('a name or id to carry along') }),
          )
          .min(1)
          .max(BATCH.max),
        detail: Detail.optional().describe('"full" adds each row\'s source count and link'),
        deadline_ms: deadline(30000, 120000).describe(
          'each group answers with what has arrived by then; default 30000',
        ),
      },
      outputSchema: {
        summary: z.string(),
        count: z.number(),
        read: z.number(),
        calls: z.array(z.object({ class: Class, n: z.number() })),
        rows: z
          .array(
            z
              .looseObject({
                class: Class,
                p: z.number(),
                then: Class,
                p_then: z.number(),
                doubt: z.number(),
              })
              .nullable(),
          )
          .describe('one per point, in the order given; null where a point was not read'),
        worth_checking: z.array(Check.extend({ i: z.number(), p: z.number(), name: z.string().optional() })),
        sources: Sources.extend({
          timed_out: z
            .record(z.string(), z.number())
            .describe("points at which each source hadn't answered by its group's deadline"),
        }),
        weights: z.string(),
        ...Close,
      },
      annotations: { title: 'What is on the ground at many points', ...READ },
    },
    (args, extra) =>
      answer(async () => {
        const tell = progressTo(extra),
          seen: PointsSeen = { views: [], credit: new Set() };
        tell(0, 1, 'reading the first group');
        const pr = await soundPoints(
          {
            points: args.points,
            deadlineMs: args.deadline_ms ?? 30000,
            signal: extra.signal,
            group: (read, of) => tell(read, of, `${read} of ${of} groups read`),
          },
          async r => {
            const so = await deps.sound(r);
            for (const x of so.run.results) if (x?.view) seen.views.push(x.view);
            for (const c of attributionOf(so.run, false).split(' · ')) if (c) seen.credit.add(c);
            return so;
          },
        );
        return pointsAnswer(pr, args.points, seen, args.detail);
      }),
  );

  server.registerTool(
    'underfoot_area',
    {
      title: 'What covers an area',
      description:
        `What covers an outline, in acres and hectares per class: the outline is covered with 120 m tiles (up to ${MAX_TILES}, ` +
        'about 92 ha or 228 acres), each read as a 2 m field map with the same sources as a point, and the cells inside ' +
        'the outline summed. "classes" sums each cell\'s probabilities, so 30% grass is the expected grass area; ' +
        '"by_call" counts each cell for its most likely class. Also returns the tiles most worth checking, with links. ' +
        `Reports progress per tile and stops when cancelled. For a larger area, sample it with underfoot_points. ${LIMITS}`,
      inputSchema: {
        outline: z.array(LatLon).min(3).max(5000).optional().describe("the outline's vertices in order"),
        geojson: z
          .string()
          .max(20_000_000)
          .optional()
          .describe("or the outline as GeoJSON: a Polygon's outer ring, bare or in a Feature"),
        detail: Detail.optional().describe('"full" adds each tile\'s own answer'),
        deadline_ms: deadline(120000, 300000),
      },
      outputSchema: {
        ...Wrap,
        area_m2: z.number(),
        acres: z.number(),
        hectares: z.number(),
        classes: z.array(
          z.object({ class: Class, share: z.number(), acres: z.number(), hectares: z.number() }),
        ),
        by_call: z.array(z.object({ class: Class, share: z.number() })),
        tiles: z.number(),
        tiles_read: z.number(),
        coverage: z.number().describe('share of the outline read before the deadline'),
        checks: z.array(Check),
        tile_calls: z.array(z.object({ point: LatLon, call: Call.nullable() })).optional(),
      },
      annotations: { title: 'What covers an area', ...READ },
    },
    (args, extra) =>
      answer(async () => {
        const verts = args.outline ?? (args.geojson ? readOutline(args.geojson) : []),
          plan = areaPlan(verts);
        if (!plan) throw new Error('An outline needs at least three points: give outline, or geojson.');
        if (plan.centres.length > MAX_TILES)
          throw new Error(
            `That outline takes ${plan.centres.length} tiles of 120 m and the most is ${MAX_TILES} (about 92 ha). ` +
              'Read part of it, or sample it with underfoot_points.',
          );
        const tell = progressTo(extra);
        tell(0, plan.centres.length, 'reading the sources');
        const so = await deps.sound({
          mode: 'area',
          verts,
          deadlineMs: args.deadline_ms ?? 120000,
          signal: extra.signal,
          landed: (read, of) => tell(read, of, `${read} of ${of} tiles read`),
        });
        return areaAnswer(so, args.detail);
      }),
  );

  server.registerTool(
    'underfoot_history',
    {
      title: 'How a spot changed over the years',
      description:
        "How a spot changed over the years, read from Esri's archive of World Imagery since 2014: every distinct " +
        'capture at the point, each read by the imagery classifier and smoothed across the years, with the changes it ' +
        'flags ("Changed between Dec 2017 and Mar 2019: grass → bare ground"). Only the pictures are read, so it knows ' +
        '9 of the 12 classes. Reports progress per capture and stops when cancelled.',
      inputSchema: {
        point: LatLon,
        deadline_ms: deadline(90000, 240000),
      },
      outputSchema: {
        summary: z.string(),
        point: LatLon,
        captures: z.array(
          z.object({
            date: z.string(),
            provider: z.string().nullable(),
            resolution_m: z.number().nullable(),
            class: Class,
            p: z.number(),
          }),
        ),
        changes: z.array(
          z.object({
            between: z.array(z.string()),
            p: z.number(),
            was: z.array(Class),
            became: z.array(Class),
          }),
        ),
        tile_maps_asked: z.number(),
        link: z.string(),
        model: z.string(),
        ...Close,
      },
      annotations: { title: 'How a spot changed over the years', ...READ },
    },
    (args, extra) =>
      answer(async () => {
        const tell = progressTo(extra),
          stop = new AbortController(),
          quit = () => stop.abort();
        let of = 0,
          k = 0;
        extra.signal.addEventListener('abort', quit, { once: true });
        const timer = setTimeout(quit, args.deadline_ms ?? 90000);
        tell(0, 1, "walking back through the archive's releases");
        try {
          const got = await deps.history(args.point.lat, args.point.lon, {
            live: () => !stop.signal.aborted,
            found: (_, n) => tell(0, (of = n), `${n} captures found`),
            read: () => tell(++k, of, `${k} of ${of} captures read`),
          });
          if (!got)
            throw new Error(
              extra.signal.aborted
                ? 'cancelled'
                : "Esri's archive didn't answer before the deadline; try again with a longer deadline_ms.",
            );
          return historyAnswer(got, args.point, true);
        } finally {
          clearTimeout(timer);
          extra.signal.removeEventListener('abort', quit);
        }
      }),
  );
}
