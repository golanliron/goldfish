import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

// GET /api/conversations?org_id=xxx&user_id=xxx
// Returns the most recent conversation so Goldfish "remembers" the user
// GET /api/conversations?org_id=xxx&user_id=xxx&list=true
// Returns all conversations for the history drawer
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get('org_id');
  const userId = searchParams.get('user_id');
  const list = searchParams.get('list') === 'true';

  if (!orgId || !userId) {
    return Response.json({ error: 'Missing org_id or user_id' }, { status: 400 });
  }

  const supabase = createAdminClient();

  if (list) {
    // Return all conversations for history drawer
    const { data: convs } = await supabase
      .from('conversations')
      .select('id, title, updated_at, messages')
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(50);

    return Response.json({
      conversations: (convs || []).map(c => ({
        id: c.id,
        title: c.title || 'שיחה',
        updated_at: c.updated_at,
        preview: Array.isArray(c.messages) && c.messages.length > 0
          ? String((c.messages as { role: string; content: string }[]).find(m => m.role === 'user')?.content || '').slice(0, 80)
          : '',
        message_count: Array.isArray(c.messages) ? c.messages.length : 0,
      })),
    });
  }

  // Get the most recent conversation for this org+user
  const { data: conv } = await supabase
    .from('conversations')
    .select('id, title, messages, updated_at')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .single();

  if (!conv) {
    return Response.json({ conversation: null });
  }

  return Response.json({
    conversation: {
      id: conv.id,
      title: conv.title,
      messages: conv.messages,
      updated_at: conv.updated_at,
    },
  });
}
