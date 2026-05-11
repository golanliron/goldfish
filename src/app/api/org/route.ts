import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get('org_id');
  if (!orgId) return NextResponse.json({ error: 'missing org_id' }, { status: 400 });

  const supabase = createAdminClient();

  const [profileRes, docsRes] = await Promise.all([
    supabase.from('org_profiles').select('data').eq('org_id', orgId).single(),
    supabase.from('documents').select('*').eq('org_id', orgId).order('uploaded_at', { ascending: false }),
  ]);

  return NextResponse.json({
    profile: profileRes.data?.data || null,
    documents: docsRes.data || [],
  });
}

export async function POST(req: NextRequest) {
  const { org_id, data } = await req.json();
  if (!org_id) return NextResponse.json({ error: 'missing org_id' }, { status: 400 });

  const supabase = createAdminClient();
  await supabase.from('org_profiles').upsert({
    org_id,
    data,
    last_updated: new Date().toISOString(),
  }, { onConflict: 'org_id' });

  return NextResponse.json({ ok: true });
}
