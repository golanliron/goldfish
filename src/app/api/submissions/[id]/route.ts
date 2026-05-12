import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

// GET /api/submissions/[id] — get submission by id or share_token
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const orgId = req.nextUrl.searchParams.get('org_id');
  const supabase = createAdminClient();

  // Try by share_token first (public access), then by id+org_id
  let query = supabase.from('submissions').select('*');
  if (id.length === 16 && !orgId) {
    query = query.eq('share_token', id);
  } else {
    query = query.eq('id', id);
    if (orgId) query = query.eq('org_id', orgId);
  }

  const { data: sub } = await query.single();
  if (!sub) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Load comments + rfp data in parallel
  const [commentsRes, rfpRes] = await Promise.all([
    supabase
      .from('submission_comments')
      .select('id, author_name, content, created_at')
      .eq('submission_id', sub.id)
      .order('created_at', { ascending: true }),
    sub.rfp_id
      ? supabase.from('rfp_parsed').select('rfp_title, funder_name, deadline, required_documents, rfp_url').eq('id', sub.rfp_id).single()
      : Promise.resolve({ data: null }),
  ]);

  return NextResponse.json({ submission: sub, comments: commentsRes.data || [], rfp: rfpRes.data || null });
}

// PATCH /api/submissions/[id] — update content or acquire/release lock
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { content, status, editor_name, action, outcome, approved_amount, funder_feedback, lessons_learned } = body;
  const supabase = createAdminClient();

  // Find by id or share_token
  const isToken = id.length === 16;
  const { data: sub } = await (isToken
    ? supabase.from('submissions').select('id, locked_by, locked_until').eq('share_token', id).single()
    : supabase.from('submissions').select('id, locked_by, locked_until').eq('id', id).single());

  if (!sub) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const now = new Date();

  // Lock management
  if (action === 'lock') {
    // Check if currently locked by someone else
    if (sub.locked_by && sub.locked_by !== editor_name && sub.locked_until && new Date(sub.locked_until) > now) {
      return NextResponse.json({
        error: 'locked',
        locked_by: sub.locked_by,
        locked_until: sub.locked_until,
      }, { status: 409 });
    }
    const lockUntil = new Date(now.getTime() + 60000); // 60 second lock
    await supabase.from('submissions').update({ locked_by: editor_name, locked_until: lockUntil.toISOString() }).eq('id', sub.id);
    return NextResponse.json({ ok: true, locked_until: lockUntil.toISOString() });
  }

  if (action === 'unlock') {
    await supabase.from('submissions').update({ locked_by: null, locked_until: null }).eq('id', sub.id);
    return NextResponse.json({ ok: true });
  }

  // Save content + outcome fields
  const updates: Record<string, unknown> = { version: body.version ? body.version + 1 : undefined };
  if (content !== undefined) updates.content = content;
  if (status !== undefined) updates.status = status;
  if (outcome !== undefined) updates.outcome = outcome;
  if (approved_amount !== undefined) updates.approved_amount = approved_amount;
  if (funder_feedback !== undefined) updates.funder_feedback = funder_feedback;
  if (lessons_learned !== undefined) updates.lessons_learned = lessons_learned;
  if (editor_name) { updates.locked_by = null; updates.locked_until = null; } // Release lock on save

  await supabase.from('submissions').update(updates).eq('id', sub.id);
  return NextResponse.json({ ok: true });
}

// POST /api/submissions/[id]/comment — add a comment (handled inline)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { author_name, content } = await req.json();
  if (!author_name || !content) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });

  const supabase = createAdminClient();

  // Find submission by id or share_token
  const isToken = id.length === 16;
  const { data: sub } = await (isToken
    ? supabase.from('submissions').select('id').eq('share_token', id).single()
    : supabase.from('submissions').select('id').eq('id', id).single());

  if (!sub) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: comment } = await supabase
    .from('submission_comments')
    .insert({ submission_id: sub.id, author_name, content })
    .select('id, author_name, content, created_at')
    .single();

  return NextResponse.json({ comment });
}
