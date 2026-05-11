import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(req: NextRequest) {
  // Temporary debug: /api/org?debug=models
  if (req.nextUrl.searchParams.get('debug') === 'models') {
    const key = process.env.GEMINI_API_KEY || '';
    if (!key) return NextResponse.json({ error: 'no GEMINI_API_KEY env var' });
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
    const data = await res.json();
    if (!res.ok) return NextResponse.json({ error: data });
    const models = (data.models || [])
      .filter((m: { supportedGenerationMethods?: string[] }) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m: { name: string }) => m.name);
    return NextResponse.json({ models, keyPrefix: key.slice(0, 8) });
  }

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
