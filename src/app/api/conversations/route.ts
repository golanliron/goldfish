import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { withAuth } from '@/lib/api-auth';

// GET /api/conversations — returns conversations for the authenticated user's org
export const GET = withAuth(async (req, auth) => {
  const { searchParams } = new URL(req.url);
  const orgId = auth.orgId;
  const userId = auth.userId;
  const list = searchParams.get('list') === 'true';

  const supabase = createAdminClient();

  if (list) {
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
});
