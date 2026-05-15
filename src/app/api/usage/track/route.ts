import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

// Multi-tenant usage tracking
// Logs API calls, token consumption, and feature usage per org_id
// Used for future pricing packages and quota enforcement

export interface UsageEvent {
  org_id: string;
  event_type:
    | 'chat_message'
    | 'initial_scan'
    | 'document_upload'
    | 'smart_reader'
    | 'draft_generated'
    | 'match_score'
    | 'rag_search';
  tokens_used?: number;
  model?: string;
  details?: Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as UsageEvent;
    const { org_id, event_type, tokens_used, model, details } = body;

    if (!org_id || !event_type) {
      return NextResponse.json({ error: 'Missing org_id or event_type' }, { status: 400 });
    }

    // Tenant isolation: caller must match org_id header if provided
    const xOrgId = req.headers.get('x-org-id');
    if (xOrgId && xOrgId !== org_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const supabase = createAdminClient();

    await supabase.from('usage_logs').insert({
      org_id,
      event_type,
      tokens_used: tokens_used ?? null,
      model: model ?? null,
      details: details ?? null,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[usage/track] error:', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// GET — return usage summary for an org (for admin/billing)
export async function GET(req: NextRequest) {
  try {
    const org_id = req.nextUrl.searchParams.get('org_id');
    const days = parseInt(req.nextUrl.searchParams.get('days') || '30', 10);

    if (!org_id) return NextResponse.json({ error: 'Missing org_id' }, { status: 400 });

    const supabase = createAdminClient();
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data } = await supabase
      .from('usage_logs')
      .select('event_type, tokens_used, created_at')
      .eq('org_id', org_id)
      .gte('created_at', since)
      .order('created_at', { ascending: false });

    const logs = data || [];

    // Aggregate by event type
    const byType: Record<string, { count: number; tokens: number }> = {};
    let totalTokens = 0;
    for (const log of logs) {
      const key = log.event_type as string;
      if (!byType[key]) byType[key] = { count: 0, tokens: 0 };
      byType[key].count++;
      const t = (log.tokens_used as number) || 0;
      byType[key].tokens += t;
      totalTokens += t;
    }

    return NextResponse.json({
      org_id,
      period_days: days,
      total_events: logs.length,
      total_tokens: totalTokens,
      by_type: byType,
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
