import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get('org_id');
  if (!orgId) return Response.json({ connected: false }, { status: 400 });

  const supabase = createAdminClient();
  const { data } = await supabase
    .from('google_connections')
    .select('google_email, connected_at, token_expiry, refresh_token')
    .eq('org_id', orgId)
    .single();

  if (!data?.google_email) return Response.json({ connected: false });

  return Response.json({
    connected: true,
    email: data.google_email,
    connected_at: data.connected_at,
    has_refresh_token: !!data.refresh_token,
    token_valid: data.token_expiry ? new Date(data.token_expiry) > new Date() : false,
  });
}
