/**
 * Goldfish — API Validation Layer
 *
 * Zod schemas for all API payloads.
 * Import the schema you need and call .parse() or .safeParse() at the top of your route.
 *
 * Usage:
 *   const body = ChatRequestSchema.parse(await req.json());
 *   // throws ZodError on bad input → caught by the route error handler
 *
 * Or safe parse:
 *   const result = ChatRequestSchema.safeParse(data);
 *   if (!result.success) return validationError(result.error);
 */

import { z } from 'zod';

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Returns a 400 Response with Zod error details */
export function validationError(error: z.ZodError): Response {
  return Response.json(
    {
      error: 'ולידציה נכשלה',
      details: error.issues.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      })),
    },
    { status: 400 },
  );
}

/** Wraps req.json() + parse into one call. Throws on invalid body. */
export async function parseBody<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  const raw = await req.json().catch(() => {
    throw new Error('גוף הבקשה אינו JSON תקין');
  });
  return schema.parse(raw) as T;
}

// ─── Shared primitives ────────────────────────────────────────────────────────

const OrgId = z.string().uuid('org_id חייב להיות UUID תקין');
const NonEmptyString = z.string().min(1, 'שדה לא יכול להיות ריק');

// ─── Chat ─────────────────────────────────────────────────────────────────────

export const ChatRequestSchema = z.object({
  message: z.string().min(1).max(10_000, 'הודעה ארוכה מדי'),
  conversation_id: z.string().uuid().optional(),
  active_tab: z
    .enum(['chat', 'org', 'opportunities', 'business', 'foundations'])
    .default('chat'),
  context: z.record(z.string(), z.unknown()).optional(),
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;

// ─── Scan (opportunity matching) ──────────────────────────────────────────────

export const ScanRequestSchema = z.object({
  org_id: OrgId.optional(), // injected from auth; optional here for cron use
  force: z.boolean().default(false),
});

export type ScanRequest = z.infer<typeof ScanRequestSchema>;

// ─── Documents upload ─────────────────────────────────────────────────────────

export const UploadRequestSchema = z.object({
  org_id: OrgId.optional(),
  category: z
    .enum(['identity', 'budget', 'project', 'impact', 'submission', 'other'])
    .default('other'),
  filename: NonEmptyString.max(255),
  content_type: z.string().optional(),
});

export type UploadRequest = z.infer<typeof UploadRequestSchema>;

// ─── Learn URL ────────────────────────────────────────────────────────────────

export const LearnUrlRequestSchema = z.object({
  url: z.string().url('כתובת URL לא תקינה'),
  org_id: OrgId.optional(),
  force: z.boolean().default(false),
});

export type LearnUrlRequest = z.infer<typeof LearnUrlRequestSchema>;

// ─── Opportunities ────────────────────────────────────────────────────────────

export const OpportunityQuerySchema = z.object({
  org_id: OrgId.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  active_only: z.coerce.boolean().default(true),
  categories: z.array(z.string()).optional(),
});

export type OpportunityQuery = z.infer<typeof OpportunityQuerySchema>;

// ─── Process Grants (cron / manual) ──────────────────────────────────────────

export const ProcessGrantsRequestSchema = z.object({
  org_id: OrgId.optional(),
  mode: z.enum(['staging', 'existing']).default('staging'),
});

export type ProcessGrantsRequest = z.infer<typeof ProcessGrantsRequestSchema>;

// ─── Submissions ──────────────────────────────────────────────────────────────

export const SubmissionCreateSchema = z.object({
  org_id: OrgId,
  opportunity_id: z.string().uuid('opportunity_id חייב להיות UUID'),
  content: z.string().min(10, 'תוכן ההגשה קצר מדי').max(100_000),
  version: z.string().default('v1'),
  notes: z.string().max(2_000).optional(),
});

export type SubmissionCreate = z.infer<typeof SubmissionCreateSchema>;

export const SubmissionOutcomeSchema = z.object({
  outcome: z.enum(['approved', 'rejected', 'pending', 'withdrawn']),
  approved_amount: z.number().positive().optional(),
  funder_feedback: z.string().max(5_000).optional(),
  lessons_learned: z.string().max(5_000).optional(),
});

export type SubmissionOutcome = z.infer<typeof SubmissionOutcomeSchema>;

// ─── Org profile ──────────────────────────────────────────────────────────────

export const OrgProfileUpdateSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  description: z.string().max(5_000).optional(),
  website: z.string().url().optional().or(z.literal('')),
  registration_number: z.string().max(20).optional(),
  annual_budget: z.number().nonnegative().optional(),
  employee_count: z.number().int().nonnegative().optional(),
  founding_year: z.number().int().min(1900).max(2030).optional(),
  regions: z.array(z.string()).optional(),
  categories: z.array(z.string()).optional(),
  target_populations: z.array(z.string()).optional(),
});

export type OrgProfileUpdate = z.infer<typeof OrgProfileUpdateSchema>;
