import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { withAuth } from '@/lib/api-auth';

// GET /api/submissions/check?opportunity_id=xxx
// Returns existing draft share_url if one exists for this org + opportunity
export const GET = withAuth(async (req, auth) => {
  const { searchParams } = new URL(req.url);
  const opportunity_id = searchParams.get('opportunity_id');

  if (!opportunity_id) {
    return NextResponse.json({ share_url: null });
  }

  const supabase = createAdminClient();

  const { data } = await supabase
    .from('submissions')
    .select('id, share_token, status')
    .eq('org_id', auth.orgId)
    .eq('opportunity_id', opportunity_id)
    .in('status', ['draft', 'submitted'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!data?.share_token) {
    return NextResponse.json({ share_url: null });
  }

  return NextResponse.json({
    share_url: `${process.env.NEXT_PUBLIC_APP_URL || ''}/s/${data.share_token}`,
    submission_id: data.id,
    status: data.status,
  });
});
