/**
 * The MCP server: Underfoot's answers as tools an agent can call. Read-only,
 * keyless, run on the user's own machine; every answer comes in the envelope
 * (mcp/envelope) with its doubt, its sources, a link and the credit.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import METHOD from '../../docs/method.md?raw';
import { CLASSES, SOURCES, VERSION } from '../core/classes';
import { useNode } from '../headless/node';
import { sound } from '../headless/sound';
import type { SoundRequest, Sounding } from '../headless/sound';
import { pathAnswer, pointAnswer } from './envelope';
import { readTrack } from './track';

export const INSTRUCTIONS =
  'Underfoot says what is physically on the ground at a point or along a route (building, paved, path, rail, ' +
  'forest, scrub, grass, crop, water, wetland, bare ground, snow) as probabilities fused from free open data. ' +
  'When you pass an answer on: give its probability, not only the class; when doubt.worth_checking is true, say so and why; ' +
  'hand back the link so a person can check it on the map; keep the attribution. The answers are calibrated opinion, not a survey.';

const LatLon = z.object({
  lat: z.number().min(-90).max(90).describe('latitude, WGS84 degrees'),
  lon: z.number().min(-180).max(180).describe('longitude, WGS84 degrees'),
});
const Preset = z.enum(['foot', 'atv', 'truck']);
const Detail = z
  .enum(['brief', 'full'])
  .describe('"brief" (the default) or "full": every source\'s reading as well');
const Class = z.string().describe('one of the 12 classes; see underfoot://classes');
const Call = z.looseObject({
  class: Class,
  p: z.number(),
  runners_up: z.array(z.object({ class: Class, p: z.number() })),
  confidence: z.number(),
  doubt: z.object({ score: z.number(), worth_checking: z.boolean(), why: z.string() }),
});
const Wrap = {
  summary: z.string().describe('one or two sentences an agent can quote'),
  sources: z.object({
    used: z.array(z.string()),
    missing: z.array(z.object({ id: z.string(), why: z.string() })),
  }),
  link: z.string().describe('reopens this sounding in the web app'),
  weights: z.string(),
  version: z.string(),
  as_of: z.string(),
  complete: z.boolean().describe('false if the deadline came before every source answered'),
  attribution: z.string(),
  caveat: z.string(),
};
const READ = { readOnlyHint: true, openWorldHint: true, destructiveHint: false };
const LIMITS =
  'It cannot know access rights or ownership, imagery can be years old, and accuracy is lower outside the contiguous US.';

export interface Deps {
  sound: (req: SoundRequest) => Promise<Sounding>;
  ready: () => Promise<void>;
}

export function createServer(deps: Deps = { sound, ready: () => useNode() }) {
  const server = new McpServer({ name: 'underfoot', version: VERSION }, { instructions: INSTRUCTIONS });
  const answer = async (make: () => Promise<Record<string, unknown>>) => {
    try {
      await deps.ready();
      const out = await make();
      return { content: [{ type: 'text' as const, text: JSON.stringify(out) }], structuredContent: out };
    } catch (e) {
      return { isError: true, content: [{ type: 'text' as const, text: String((e as Error).message || e) }] };
    }
  };

  server.registerTool(
    'underfoot_point',
    {
      title: 'What is on the ground at a point',
      description:
        'What is physically on the ground at one coordinate, as a probability for each of 12 classes, fused from ten ' +
        "open data sources (OpenStreetMap, US building footprints, aerial imagery, land cover, terrain, today's " +
        'weather, the newest satellite pass and others). Returns the call with its runners-up and how much it is worth ' +
        `checking, the place's name, which sources answered, and a link that reopens it in the web app. ${LIMITS}`,
      inputSchema: {
        point: LatLon,
        gps_accuracy_m: z
          .union([z.literal(0), z.literal(3), z.literal(5), z.literal(10)])
          .optional()
          .describe(
            "the fix's spread, m: the answer becomes the 2 m field map averaged under that disc; 0 (default) takes the coordinate as exact. Adds requests.",
          ),
        going: z.array(Preset).optional().describe('also rate getting across on foot, by ATV or by truck'),
        place_name: z
          .boolean()
          .optional()
          .describe(
            "ask OpenStreetMap's gazetteer for the place's name (one request a second); default true",
          ),
        detail: Detail.optional(),
        deadline_ms: z
          .number()
          .int()
          .min(1000)
          .max(120000)
          .optional()
          .describe('answer with what has arrived by then; default 30000'),
      },
      outputSchema: {
        ...Wrap,
        point: LatLon,
        call: Call,
        place: z.string().nullable(),
        overhead: z.string().nullable(),
        gps_accuracy_m: z.number(),
        going: z
          .record(z.string(), z.looseObject({ km_h: z.number(), band: z.string(), why: z.string() }))
          .optional(),
        ledger: z.array(z.looseObject({})).optional(),
        facts: z.looseObject({}).optional(),
      },
      annotations: { title: 'What is on the ground at a point', ...READ },
    },
    args =>
      answer(async () => {
        const so = await deps.sound({
          mode: 'point',
          verts: [args.point],
          gps: args.gps_accuracy_m ?? 0,
          gaz: args.place_name ?? true,
          deadlineMs: args.deadline_ms ?? 30000,
        });
        return pointAnswer(so, { detail: args.detail, going: args.going });
      }),
  );

  server.registerTool(
    'underfoot_path',
    {
      title: 'What a route runs over',
      description:
        'What a route runs over: a line, or a GPX or GeoJSON track, read at up to 48 stations plus one at each road, ' +
        'path, rail line or stream it crosses, with the stretches that follow a mapped trail or road. Returns the share ' +
        'of each class by length, the line as runs of one class ("forest from 0 to 410 m, then path to 900 m"), what ' +
        `it crosses, the climb, the spots most worth checking in person, and a link. Optionally rates getting across. ${LIMITS}`,
      inputSchema: {
        points: z.array(LatLon).min(2).max(20000).optional().describe("the line's vertices in order"),
        track: z.string().max(20_000_000).optional().describe('or the line as GPX or GeoJSON text'),
        spacing_m: z
          .union([z.number().min(1).max(10000), z.literal('auto')])
          .optional()
          .describe('station spacing; "auto" (default) gives up to 48 stations'),
        follow: z
          .boolean()
          .optional()
          .describe('match stretches that follow a mapped trail or road; default true'),
        going: z
          .array(Preset)
          .optional()
          .describe('also rate getting across the line on foot, by ATV or by truck'),
        detail: Detail.optional().describe('"full" adds every station\'s answer'),
        deadline_ms: z
          .number()
          .int()
          .min(1000)
          .max(240000)
          .optional()
          .describe('answer with what has arrived by then; default 60000'),
      },
      outputSchema: {
        ...Wrap,
        length_m: z.number(),
        climb_m: z.number().nullable(),
        descent_m: z.number().nullable(),
        steepest: z.object({ grade: z.number(), from_m: z.number(), to_m: z.number() }).nullable(),
        shares: z.array(z.object({ class: Class, m: z.number(), share: z.number() })),
        runs: z.array(
          z.object({ class: Class, from_m: z.number(), to_m: z.number(), p_mean: z.number().nullable() }),
        ),
        follows: z.array(
          z.object({ from_m: z.number(), to_m: z.number(), what: z.string(), name: z.string().nullable() }),
        ),
        crossings: z.array(z.object({ class: Class, count: z.number(), names: z.array(z.string()) })),
        checks: z.array(z.object({ at_m: z.number(), point: LatLon, class: Class, doubt: z.number() })),
        going: z.record(z.string(), z.looseObject({})).optional(),
        stations: z.array(z.looseObject({})).optional(),
      },
      annotations: { title: 'What a route runs over', ...READ },
    },
    args =>
      answer(async () => {
        const verts = args.points ?? (args.track ? readTrack(args.track) : []);
        if (verts.length < 2)
          throw new Error('A route needs at least two points: give points, or a track as GPX or GeoJSON.');
        const so = await deps.sound({
          mode: 'path',
          verts,
          spacing: args.spacing_m == null ? 'auto' : String(args.spacing_m),
          follow: args.follow ?? true,
          deadlineMs: args.deadline_ms ?? 60000,
        });
        return pathAnswer(so, { detail: args.detail, going: args.going });
      }),
  );

  const json = (name: string, uri: string, description: string, data: unknown) =>
    server.registerResource(name, uri, { description, mimeType: 'application/json' }, async u => ({
      contents: [{ uri: u.href, mimeType: 'application/json', text: JSON.stringify(data, null, 1) }],
    }));
  json(
    'classes',
    'underfoot://classes',
    'The 12 classes an answer can be, and what each covers',
    CLASSES.map(c => ({ class: c.k, name: c.n, covers: c.d })),
  );
  json(
    'sources',
    'underfoot://sources',
    'The open data sources fused into each answer, and their default weights',
    SOURCES.map(s => ({ id: s.id, name: s.n, what: s.d, weight: s.w })),
  );
  server.registerResource(
    'method',
    'underfoot://method',
    { description: 'How Underfoot works: the sources, the fusion and its limits', mimeType: 'text/markdown' },
    async u => ({ contents: [{ uri: u.href, mimeType: 'text/markdown', text: METHOD }] }),
  );
  return server;
}
