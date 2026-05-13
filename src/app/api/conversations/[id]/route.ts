import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { withAuth } from '@/lib/api-auth';

// GET /api/conversations/[id] — returns a specific conversation
export const GET = withAuth(async (req, auth, params) => {
  const id = params?.id;
  if (!id) return Response.json({ error: 'Missing id' }, { status: 400 });

  const supabase = createAdminClient();

  const { data: conv, error } = await supabase
    .from('conversations')
    .select('id, title, messages, updated_at')
    .eq('id', id)
    .eq('org_id', auth.orgId)
    .single();

  if (error || !conv) {
    return Response.json({ error: 'Conversation not found' }, { status: 404 });
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
