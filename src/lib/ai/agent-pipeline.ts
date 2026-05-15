/**
 * Agent Pipeline — גשר בין סורקי Python לסוכן המחקר
 *
 * הסורקים ב-Python שומרים קולות קוראים גולמיים ל-scanner_calls (staging).
 * ה-pipeline הזה שולף אותם, מריץ את runResearchAgent על כל אחד,
 * ושומר את התוצאות המועשרות ל-grant_opportunities.
 *
 * פועל ב-2 מצבים:
 *   1. HTTP POST /api/process-grants (מהסורק / cron)
 *   2. import ישיר לטסטים / devtools
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { runResearchAgent, type RawCall, type EnrichedCall } from './research-agent';
import type { OrgDNA } from './org-dna';

// ── Config ─────────────────────────────────────────────────────────────────────

const THRESHOLD_FOR_RESEARCH = 40;   // ציון בסיסי מינימלי לטיפול הסוכן
const BATCH_SIZE             = 15;   // מקסימום קולות קוראים בריצה אחת
const INTER_ITEM_DELAY_MS    = 2500; // השהייה בין פריטים (rate limiting Gemini/Tavily)

// ── Config: batch processing ──────────────────────────────────────────────────
const EXISTING_BATCH_SIZE   = 20;   // כמה קולות קוראים קיימים לעבד בריצה אחת
const DEADLINE_CUTOFF_DAYS  = 3;    // קולות קוראים שהדדליין שלהם עבר לפני >3 ימים → כבה

// ── Helper: sleep ──────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── Helpers ────────────────────────────────────────────────────────────────────

function emptyDNA(): OrgDNA {
  return { populations: [], domains: [], subDomains: [], interventionTypes: [], geography: [], ageGroups: [], orgType: 'small', themes: [], excludePopulations: [], excludeDomains: [] };
}

// ── resolveOrgDNAForPipeline ───────────────────────────────────────────────────
// מנסה לקרוא DNA ארגוני מה-DB; fallback ל-resolveOrgDNA מהמודול

async function resolveOrgDNAForPipeline(orgId: string) {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from('org_memory')
      .select('key, value')
      .eq('org_id', orgId)
      .in('key', ['populations', 'domains', 'geography', 'intervention_types', 'themes', 'org_type']);

    if (!data?.length) return emptyDNA();

    const mem: Record<string, string> = {};
    for (const row of data) mem[row.key] = row.value;

    return {
      populations:       mem.populations        ? JSON.parse(mem.populations)        : [],
      domains:           mem.domains             ? JSON.parse(mem.domains)             : [],
      subDomains:        [],
      interventionTypes: mem.intervention_types  ? JSON.parse(mem.intervention_types)  : [],
      geography:         mem.geography           ? JSON.parse(mem.geography)           : [],
      ageGroups:         [],
      orgType:           (mem.org_type as 'small' | 'medium' | 'large') || 'small',
      themes:            mem.themes              ? JSON.parse(mem.themes)              : [],
      excludePopulations: [],
      excludeDomains:    [],
    };
  } catch (e) {
    console.warn('[agent-pipeline] Could not load org DNA from DB, using fallback:', e);
    return emptyDNA();
  }
}

// ── Main: processStagingCalls ──────────────────────────────────────────────────

export interface PipelineResult {
  processed: number;
  high:      number;
  medium:    number;
  low:       number;
  skipped:   number;
  errors:    number;
}

export async function processStagingCalls(orgId: string): Promise<PipelineResult> {
  const result: PipelineResult = { processed: 0, high: 0, medium: 0, low: 0, skipped: 0, errors: 0 };

  if (!orgId) {
    throw new Error('[agent-pipeline] orgId is required — no fallback allowed');
  }

  const admin = createAdminClient();

  // ── 1. שלוף קולות קוראים חדשים מ-staging ──
  const { data: rawCalls, error: fetchErr } = await admin
    .from('scanner_calls')
    .select('*')
    .eq('processed', false)
    .gte('match_score', THRESHOLD_FOR_RESEARCH)
    .order('match_score', { ascending: false })
    .limit(BATCH_SIZE);

  if (fetchErr) {
    console.error('[agent-pipeline] Failed to fetch staging calls:', fetchErr.message);
    return result;
  }

  if (!rawCalls?.length) {
    console.log('[agent-pipeline] No unprocessed calls above threshold — done.');
    return result;
  }

  console.log(`[agent-pipeline] Processing ${rawCalls.length} calls for org ${orgId}...`);

  // ── 2. טען DNA ארגוני פעם אחת ──
  const orgDNA = await resolveOrgDNAForPipeline(orgId);

  // ── 3. עבד כל קול קורא ──
  for (const raw of rawCalls) {
    const callForAgent: RawCall = {
      id:           raw.id,
      title:        raw.title        || '',
      source:       raw.source       || '',
      url:          raw.url          || '',
      category:     raw.category     || 'other',
      region:       raw.region       || 'israel',
      description:  raw.description  || '',
      deadline:     raw.deadline,
      grant_amount: raw.grant_amount,
      tags:         raw.tags         || [],
      match_score:  raw.match_score  || 0,
    };

    console.log(`\n  Researching: "${callForAgent.title.slice(0, 60)}" [score=${callForAgent.match_score}]`);

    let enriched: EnrichedCall;
    try {
      enriched = await runResearchAgent(callForAgent, orgDNA, orgId);
      result.processed++;
      result[enriched.agent_verdict === 'skip' ? 'skipped' : enriched.agent_verdict]++;
      console.log(`  -> deep_score=${enriched.deep_score} | verdict=${enriched.agent_verdict} | iter=${enriched.iterations_used}`);
    } catch (e) {
      console.error(`  -> ERROR: ${e}`);
      result.errors++;
      // סמן כ-processed גם במקרה שגיאה — כדי שלא נחזור אליו שוב
      await admin.from('scanner_calls').update({ processed: true }).eq('id', raw.id);
      await sleep(INTER_ITEM_DELAY_MS);
      continue;
    }

    // ── 4. שמור ל-opportunities אם לא skip ──
    // הטבלה הקיימת היא `opportunities` (לא grant_opportunities)
    // upsert לפי url — אם קיים, מעדכן רק שדות הסוכן
    if (enriched.agent_verdict !== 'skip') {
      // בדוק אם ה-opportunity כבר קיים לפי url
      const { data: existing } = await admin
        .from('opportunities')
        .select('id')
        .eq('url', enriched.url)
        .maybeSingle();

      if (existing?.id) {
        // עדכן רק שדות הסוכן — אל תדרוס נתוני מקור
        const { error: updateErr } = await admin
          .from('opportunities')
          .update({
            deep_score:     enriched.deep_score,
            funder_profile: enriched.funder_profile ?? null,
            research_notes: enriched.research_notes,
            agent_verdict:  enriched.agent_verdict,
            agent_ran_at:   new Date().toISOString(),
          })
          .eq('id', existing.id);

        if (updateErr) console.warn(`  -> Update warning: ${updateErr.message}`);
      } else {
        // הוסף רשומה חדשה
        const { error: insertErr } = await admin
          .from('opportunities')
          .insert({
            title:          enriched.title,
            source:         enriched.source,
            url:            enriched.url,
            categories:     enriched.category ? [enriched.category] : [],
            regions:        enriched.region   ? [enriched.region]   : [],
            description:    enriched.description,
            deadline:       enriched.deadline ? new Date(enriched.deadline).toISOString().slice(0,10) : null,
            tags:           enriched.tags     ?? [],
            active:         true,
            deep_score:     enriched.deep_score,
            funder_profile: enriched.funder_profile ?? null,
            research_notes: enriched.research_notes,
            agent_verdict:  enriched.agent_verdict,
            agent_ran_at:   new Date().toISOString(),
            scraped_at:     raw.scraped_at || new Date().toISOString(),
          });

        if (insertErr) console.warn(`  -> Insert warning: ${insertErr.message}`);
      }

    }

    // ── 5. סמן כ-processed ב-staging ──
    await admin
      .from('scanner_calls')
      .update({ processed: true })
      .eq('id', raw.id);

    await sleep(INTER_ITEM_DELAY_MS);
  }

  console.log('\n[agent-pipeline] Done:', result);
  return result;
}

// ── processExistingCalls — ניקוי אורוות ───────────────────────────────────────
// עוברת על קולות קוראים קיימים ב-opportunities שטרם עובדו על-ידי הסוכן:
// 1. כיבוי קולות קוראים שהדדליין שלהם עבר
// 2. הרצת Research Agent להעשרה (ציון עמוק + לינק ישיר + זוויות יצירתיות)
//
// הפעלה: POST /api/process-grants עם body { "mode": "existing", "org_id": "..." }

export async function processExistingCalls(orgId: string): Promise<PipelineResult> {
  const result: PipelineResult = { processed: 0, high: 0, medium: 0, low: 0, skipped: 0, errors: 0 };

  if (!orgId) {
    throw new Error('[agent-pipeline] orgId is required — no fallback allowed');
  }

  const admin = createAdminClient();
  const now = new Date();

  // ── שלב א: כיבוי קולות קוראים שפג תוקפם ──────────────────────────────────
  const cutoffDate = new Date(now);
  cutoffDate.setDate(cutoffDate.getDate() - DEADLINE_CUTOFF_DAYS);

  const { data: expired, error: expiredErr } = await admin
    .from('opportunities')
    .update({ active: false })
    .lt('deadline', cutoffDate.toISOString().slice(0, 10))
    .eq('active', true)
    .select('id, title');

  if (expiredErr) {
    console.warn('[agent-pipeline] Error deactivating expired calls:', expiredErr.message);
  } else if (expired?.length) {
    console.log(`[agent-pipeline] Deactivated ${expired.length} expired opportunities`);
  }

  // ── שלב ב: בחר קולות קוראים שטרם קיבלו ציון עמוק ──────────────────────────
  // עדיפות: ציון match_score גבוה, active=true, agent_ran_at IS NULL
  const { data: existing, error: fetchErr } = await admin
    .from('opportunities')
    .select('id, title, source, url, categories, regions, description, deadline, tags, active')
    .eq('active', true)
    .is('agent_ran_at', null)        // טרם עובדו ע"י הסוכן
    .not('url', 'is', null)
    .order('scraped_at', { ascending: false })
    .limit(EXISTING_BATCH_SIZE);

  if (fetchErr) {
    console.error('[agent-pipeline] Failed to fetch existing calls:', fetchErr.message);
    return result;
  }

  if (!existing?.length) {
    console.log('[agent-pipeline] No unprocessed existing opportunities found.');
    return result;
  }

  console.log(`[agent-pipeline] Processing ${existing.length} existing opportunities for org ${orgId}...`);

  const orgDNA = await resolveOrgDNAForPipeline(orgId);

  for (const row of existing) {
    // בנה RawCall מהרשומה הקיימת
    const rawCall: import('./research-agent').RawCall = {
      id:          row.id,
      title:       row.title        || '',
      source:      row.source       || '',
      url:         row.url          || '',
      category:    (row.categories as string[])?.[0] || 'other',
      region:      (row.regions    as string[])?.[0] || 'israel',
      description: row.description  || '',
      deadline:    row.deadline,
      tags:        (row.tags as string[]) || [],
      match_score: 50, // ציון בסיסי גנרי לקולות קוראים קיימים
    };

    console.log(`\n  [existing] Researching: "${rawCall.title.slice(0, 60)}"`);

    let enriched: import('./research-agent').EnrichedCall;
    try {
      enriched = await runResearchAgent(rawCall, orgDNA, orgId);
      result.processed++;
      result[enriched.agent_verdict === 'skip' ? 'skipped' : enriched.agent_verdict]++;
      console.log(`  -> deep_score=${enriched.deep_score} | verdict=${enriched.agent_verdict}`);
    } catch (e) {
      console.error(`  -> ERROR: ${e}`);
      result.errors++;
      // סמן agent_ran_at כדי לא לחזור לאותה רשומה
      await admin.from('opportunities').update({ agent_ran_at: new Date().toISOString() }).eq('id', row.id);
      await sleep(INTER_ITEM_DELAY_MS);
      continue;
    }

    // עדכן רק שדות הסוכן + URL אם תוקן
    await admin
      .from('opportunities')
      .update({
        url:            enriched.url,           // ← URL מתוקן אם verify_and_fix_link שינה
        deep_score:     enriched.deep_score,
        funder_profile: enriched.funder_profile ?? null,
        research_notes: enriched.research_notes,
        agent_verdict:  enriched.agent_verdict,
        agent_ran_at:   new Date().toISOString(),
        // כבה אם הסוכן קבע skip
        active:         enriched.agent_verdict !== 'skip',
      })
      .eq('id', row.id);

    await sleep(INTER_ITEM_DELAY_MS);
  }

  console.log('\n[agent-pipeline] Existing calls done:', result);
  return result;
}
