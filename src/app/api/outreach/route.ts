import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { withAuth } from '@/lib/api-auth';

// GET /api/outreach?company_id=xxx  — list outreach for org (optionally filtered by company)
export const GET = withAuth(async (req, auth) => {
  const orgId = auth.orgId;
  const companyId = req.nextUrl.searchParams.get('company_id');
  const supabase = createAdminClient();

  let query = supabase
    .from('company_outreach')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });

  if (companyId) {
    query = query.eq('company_id', companyId);
  }

  const { data, error } = await query.limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ outreach: data || [] });
});

// POST /api/outreach — create new outreach record
export const POST = withAuth(async (req, auth) => {
  const orgId = auth.orgId;
  const body = await req.json();
  const { company_id, company_name, letter_text, contact_name, contact_email, notes, amount_requested } = body;

  if (!company_id || !company_name) {
    return NextResponse.json({ error: 'חסרים שדות חובה' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('company_outreach')
    .insert({
      org_id: orgId,
      company_id,
      company_name,
      letter_text: letter_text || null,
      contact_name: contact_name || null,
      contact_email: contact_email || null,
      notes: notes || null,
      amount_requested: amount_requested || null,
      status: 'draft',
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ outreach: data });
});

// PATCH /api/outreach — update status/notes
export const PATCH = withAuth(async (req, auth) => {
  const orgId = auth.orgId;
  const body = await req.json();
  const { id, status, notes, sent_at, reply_at, amount_approved } = body;

  if (!id) return NextResponse.json({ error: 'חסר id' }, { status: 400 });

  const supabase = createAdminClient();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (status) updates.status = status;
  if (notes !== undefined) updates.notes = notes;
  if (sent_at) updates.sent_at = sent_at;
  if (reply_at) updates.reply_at = reply_at;
  if (amount_approved !== undefined) updates.amount_approved = amount_approved;

  const { data, error } = await supabase
    .from('company_outreach')
    .update(updates)
    .eq('id', id)
    .eq('org_id', orgId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ outreach: data });
});
