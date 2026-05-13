import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { withAuth } from '@/lib/api-auth';

export const GET = withAuth(async (req, auth) => {
  const query = req.nextUrl.searchParams.get('q') || '';
  const category = req.nextUrl.searchParams.get('category') || '';
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit')) || 20, 50);

  const supabase = createAdminClient();

  // Load sector knowledge base (always)
  const { data: knowledge } = await supabase
    .from('sector_knowledge')
    .select('topic, content, last_updated')
    .order('last_updated', { ascending: false });

  // Load recent intelligence
  let intelligenceQuery = supabase
    .from('sector_intelligence')
    .select('id, source, source_url, title, summary, category, entities, tags, relevance_score, scan_date')
    .order('relevance_score', { ascending: false })
    .limit(limit);

  if (category) {
    intelligenceQuery = intelligenceQuery.eq('category', category);
  }

  if (query) {
    intelligenceQuery = intelligenceQuery.textSearch('fts', query, { type: 'plain' });
  }

  const { data: intelligence } = await intelligenceQuery;

  // Load today's digest if available
  const today = new Date().toISOString().split('T')[0];
  const { data: digest } = await supabase
    .from('sector_knowledge')
    .select('content')
    .eq('topic', `daily_digest_${today}`)
    .single();

  return NextResponse.json({
    knowledge: knowledge || [],
    intelligence: intelligence || [],
    daily_digest: digest?.content || null,
    stats: {
      knowledge_topics: knowledge?.length || 0,
      intelligence_items: intelligence?.length || 0,
    },
  });
});
