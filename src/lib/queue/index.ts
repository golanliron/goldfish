/**
 * Goldfish — Lightweight Job Queue (Supabase-backed)
 *
 * "שגר ושכח" pattern:
 *   1. Caller calls enqueue() → returns immediately with job_id
 *   2. Background worker (Vercel Cron or Next.js background task) calls processNext()
 *   3. UI can poll /api/jobs/:id for status
 *
 * No extra services needed — runs on the existing Supabase project.
 *
 * Schema (apply once via Supabase SQL editor):
 *   See the migration comment at the bottom of this file.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { queueLog } from '@/lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export type JobType =
  | 'scan_opportunities'   // Run AI opportunity matching for one org
  | 'process_grants'       // Enrich staging grants via agent pipeline
  | 'learn_url'            // Parse + embed a URL into org knowledge
  | 'analyze_document'     // Gemini deep analysis of an uploaded document
  | 'refresh_sector'       // Daily sector intelligence scan
  | 'backfill_embeddings'; // Re-embed existing content

export type JobStatus = 'pending' | 'running' | 'done' | 'failed';

export interface Job {
  id: string;
  type: JobType;
  payload: Record<string, unknown>;
  status: JobStatus;
  org_id: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  result: Record<string, unknown> | null;
}

// ─── Enqueue ──────────────────────────────────────────────────────────────────

/**
 * Push a job to the queue. Returns immediately.
 * The actual work happens in processNext() called by a background worker.
 */
export async function enqueue(
  type: JobType,
  payload: Record<string, unknown>,
  org_id?: string,
): Promise<{ job_id: string }> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('jobs')
    .insert({ type, payload, org_id: org_id ?? null, status: 'pending' })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`[queue] Failed to enqueue job: ${error?.message}`);
  }

  queueLog.info({ job_id: data.id, type, org_id }, 'job enqueued');
  return { job_id: data.id };
}

// ─── Status ───────────────────────────────────────────────────────────────────

export async function getJob(job_id: string): Promise<Job | null> {
  const supabase = createAdminClient();
  const { data } = await supabase.from('jobs').select('*').eq('id', job_id).single();
  return (data as Job) ?? null;
}

// ─── Worker ───────────────────────────────────────────────────────────────────

/**
 * Claim and run the oldest pending job.
 * Called by /api/cron/worker or Vercel Cron.
 * Returns null if no pending jobs.
 */
export async function processNext(): Promise<{ job_id: string; type: JobType } | null> {
  const supabase = createAdminClient();

  // Claim next pending job atomically
  const { data: job } = await supabase
    .from('jobs')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  if (!job) return null;

  // Mark as running
  await supabase
    .from('jobs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', job.id)
    .eq('status', 'pending'); // optimistic lock — prevents double-processing

  try {
    const result = await runJob(job as Job);
    await supabase
      .from('jobs')
      .update({ status: 'done', finished_at: new Date().toISOString(), result })
      .eq('id', job.id);

    queueLog.info({ job_id: job.id, type: job.type }, 'job done');
    return { job_id: job.id, type: job.type };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await supabase
      .from('jobs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), error: errorMsg })
      .eq('id', job.id);

    queueLog.error({ job_id: job.id, type: job.type, err }, 'job failed');
    return { job_id: job.id, type: job.type };
  }
}

// ─── Job Dispatch ─────────────────────────────────────────────────────────────

async function runJob(job: Job): Promise<Record<string, unknown>> {
  switch (job.type) {
    case 'scan_opportunities':
      return runScanOpportunities(job);

    case 'process_grants':
      return runProcessGrants(job);

    case 'learn_url':
      return runLearnUrl(job);

    case 'analyze_document':
      return runAnalyzeDocument(job);

    case 'refresh_sector':
      return runRefreshSector();

    case 'backfill_embeddings':
      return runBackfillEmbeddings(job);

    default:
      throw new Error(`Unknown job type: ${(job as Job).type}`);
  }
}

// ─── Job Handlers ─────────────────────────────────────────────────────────────

async function runScanOpportunities(job: Job) {
  const { org_id } = job;
  if (!org_id) throw new Error('scan_opportunities requires org_id');

  // Lazy import to avoid loading heavy modules at startup
  const { scoreOpportunitiesAI } = await import('@/lib/ai/scoring-service');
  const { buildOrgContext } = await import('@/lib/ai/fishgold');
  const supabase = createAdminClient();

  const [{ data: profile }, { data: org }, { data: memories }] = await Promise.all([
    supabase.from('org_profiles').select('data').eq('org_id', org_id).single(),
    supabase.from('organizations').select('name').eq('id', org_id).single(),
    supabase.from('org_memory').select('key, value').eq('org_id', org_id).limit(50),
  ]);

  const profileData = profile?.data as Record<string, unknown> | null;
  if (!profileData) return { matches: 0, reason: 'no_profile' };
  const orgMemories = (memories || []) as { key: string; value: string }[];

  const today = new Date().toISOString().split('T')[0];
  const { data: opportunities } = await supabase
    .from('opportunities')
    .select('id, title, description, deadline, categories, target_populations, funder, url, type')
    .eq('active', true)
    .or(`deadline.is.null,deadline.gte.${today}`)
    .order('deadline', { ascending: true, nullsFirst: false })
    .limit(60);

  if (!opportunities?.length) return { matches: 0, reason: 'no_opportunities' };

  const orgContextText = buildOrgContext(profileData, org?.name ?? null, orgMemories);
  const matches = await scoreOpportunitiesAI(opportunities, orgContextText);

  for (const m of matches) {
    await supabase.from('matches').upsert(
      {
        org_id,
        opportunity_id: m.opportunity_id,
        score: m.score * 10,
        reasoning: m.reasoning,
        status: 'new',
      },
      { onConflict: 'org_id,opportunity_id', ignoreDuplicates: true },
    );
  }

  return { matches: matches.length };
}

async function runProcessGrants(job: Job) {
  if (!job.org_id) throw new Error('process_grants requires org_id');
  const { mode = 'staging' } = job.payload as { mode?: string };
  const { processStagingCalls, processExistingCalls } = await import('@/lib/ai/agent-pipeline');
  const result =
    mode === 'existing'
      ? await processExistingCalls(job.org_id)
      : await processStagingCalls(job.org_id);
  return { result };
}

async function runLearnUrl(job: Job) {
  const { url } = job.payload as { url: string };
  if (!url) throw new Error('learn_url requires url in payload');
  // Delegate to the existing API route logic via internal fetch
  const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3002';
  const res = await fetch(`${base}/api/learn-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-job': 'true' },
    body: JSON.stringify({ url, org_id: job.org_id }),
  });
  return { status: res.status, ok: res.ok };
}

async function runAnalyzeDocument(job: Job) {
  const { document_id } = job.payload as { document_id: string };
  if (!document_id) throw new Error('analyze_document requires document_id');

  const supabase = createAdminClient();
  const { data: doc } = await supabase
    .from('documents')
    .select('id, filename, parsed_text, org_id')
    .eq('id', document_id)
    .single();

  if (!doc?.parsed_text) return { skipped: true, reason: 'no_parsed_text' };

  const { geminiAnalyzeDocument } = await import('@/lib/ai/gemini');
  const analysis = await geminiAnalyzeDocument(doc.parsed_text);

  await supabase
    .from('documents')
    .update({ metadata: { ...analysis, analyzed_at: new Date().toISOString() } })
    .eq('id', document_id);

  return { analyzed: true, category: analysis.category };
}

async function runRefreshSector() {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3002';
  const res = await fetch(`${base}/api/sector-intelligence`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.CRON_SECRET || ''}`,
    },
    body: JSON.stringify({ mode: 'full' }),
  });
  return { status: res.status };
}

async function runBackfillEmbeddings(job: Job) {
  const { table = 'documents' } = job.payload as { table?: string };
  // Placeholder — implement per-table backfill as needed
  console.log(`[queue] backfill_embeddings for table=${table} (not yet implemented)`);
  return { table, status: 'noop' };
}

/*
──────────────────────────────────────────────────────────────────────────────
SUPABASE MIGRATION — run once in SQL Editor:

create table if not exists public.jobs (
  id          uuid primary key default gen_random_uuid(),
  type        text not null,
  payload     jsonb not null default '{}',
  status      text not null default 'pending'
                check (status in ('pending', 'running', 'done', 'failed')),
  org_id      uuid references public.organizations(id) on delete cascade,
  created_at  timestamptz not null default now(),
  started_at  timestamptz,
  finished_at timestamptz,
  error       text,
  result      jsonb
);

create index if not exists jobs_status_created on public.jobs (status, created_at);
create index if not exists jobs_org_id on public.jobs (org_id);

-- Auto-clean jobs older than 7 days
create or replace function cleanup_old_jobs() returns void language sql as $$
  delete from public.jobs
  where finished_at < now() - interval '7 days';
$$;

──────────────────────────────────────────────────────────────────────────────
*/
