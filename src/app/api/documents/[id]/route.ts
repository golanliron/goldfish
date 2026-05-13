import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { withAuth } from '@/lib/api-auth';

// DELETE /api/documents/[id] — delete a document and its chunks
export const DELETE = withAuth(async (req, auth, params) => {
  try {
    const id = params?.id;
    const org_id = auth.orgId;

    if (!id) {
      return NextResponse.json({ error: 'Missing document id' }, { status: 400 });
    }

    const supabase = createAdminClient();

    const { data: doc } = await supabase
      .from('documents')
      .select('storage_path')
      .eq('id', id)
      .eq('org_id', org_id)
      .single();

    if (!doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    await supabase
      .from('document_chunks')
      .delete()
      .eq('document_id', id);

    await supabase
      .from('documents')
      .delete()
      .eq('id', id)
      .eq('org_id', org_id);

    if (doc.storage_path && !doc.storage_path.startsWith('http')) {
      try {
        await supabase.storage.from('documents').remove([doc.storage_path]);
      } catch {
        // Storage delete is best-effort
      }
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});

// PATCH /api/documents/[id] — update category
export const PATCH = withAuth(async (req, auth, params) => {
  try {
    const id = params?.id;
    const org_id = auth.orgId;
    const { category } = await req.json();

    if (!id || !category) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    const supabase = createAdminClient();
    const { error } = await supabase
      .from('documents')
      .update({ category })
      .eq('id', id)
      .eq('org_id', org_id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});

// GET /api/documents/[id] — download document content
export const GET = withAuth(async (req, auth, params) => {
  try {
    const id = params?.id;
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const supabase = createAdminClient();

    const { data: doc } = await supabase
      .from('documents')
      .select('filename, parsed_text, storage_path, file_type')
      .eq('id', id)
      .eq('org_id', auth.orgId)
      .single();

    if (!doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    if (doc.storage_path && !doc.storage_path.startsWith('http') && !doc.storage_path.startsWith('local/')) {
      try {
        const { data } = await supabase.storage.from('documents').download(doc.storage_path);
        if (data) {
          const buffer = await data.arrayBuffer();
          return new NextResponse(buffer, {
            headers: {
              'Content-Type': 'application/octet-stream',
              'Content-Disposition': `attachment; filename="${encodeURIComponent(doc.filename)}"`,
            },
          });
        }
      } catch {
        // Fall through to parsed text
      }
    }

    if (doc.parsed_text) {
      return new NextResponse(doc.parsed_text, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(doc.filename || 'document.txt')}"`,
        },
      });
    }

    return NextResponse.json({ error: 'No content available' }, { status: 404 });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});
