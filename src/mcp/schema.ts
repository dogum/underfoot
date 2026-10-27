/**
 * The pieces every tool's input and output schemas share (mcp/server,
 * mcp/jobs), and what an agent is told about the limits.
 */
import { z } from 'zod';

export const LatLon = z.object({
  lat: z.number().min(-90).max(90).describe('latitude, WGS84 degrees'),
  lon: z.number().min(-180).max(180).describe('longitude, WGS84 degrees'),
});
export const Preset = z.enum(['foot', 'atv', 'truck']);
export const Detail = z
  .enum(['brief', 'full'])
  .describe('"brief" (the default) or "full": every source\'s reading as well');
export const Class = z.string().describe('one of the 12 classes; see underfoot://classes');
export const Call = z.looseObject({
  class: Class,
  p: z.number(),
  runners_up: z.array(z.object({ class: Class, p: z.number() })),
  confidence: z.number(),
  doubt: z.object({ score: z.number(), worth_checking: z.boolean(), why: z.string() }),
});
export const Sources = z.object({
  used: z.array(z.string()),
  missing: z.array(z.object({ id: z.string(), why: z.string() })),
});
/** what closes every answer */
export const Close = {
  version: z.string(),
  as_of: z.string(),
  complete: z.boolean().describe('false if the deadline came before every source answered'),
  attribution: z.string(),
  caveat: z.string(),
};
/** the envelope of a sounding's answer: a point, a line or an area */
export const Wrap = {
  summary: z.string().describe('one or two sentences an agent can quote'),
  sources: Sources,
  link: z.string().describe('reopens this sounding in the web app'),
  weights: z.string(),
  ...Close,
};
/** a spot worth checking in person, with the link that opens it */
export const Check = z.object({
  point: LatLon,
  class: Class,
  doubt: z.number(),
  link: z.string(),
});
export const deadline = (def: number, max: number) =>
  z
    .number()
    .int()
    .min(1000)
    .max(max)
    .optional()
    .describe(`answer with what has arrived by then; default ${def}`);

export const READ = { readOnlyHint: true, openWorldHint: true, destructiveHint: false };
export const LIMITS =
  'It cannot know access rights or ownership, imagery can be years old, and accuracy is lower outside the contiguous US.';
