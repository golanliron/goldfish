import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

// DELETE /api/documents/[id] — delete a document and its chunks
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { org_id } = await request.json();

    if (!org_id || !id) {
      return NextResponse.json({ error: 'Missing org_id or document id' }, { status: 400 });
    }

    const supabase = createAdminClient();

    // Get the document first (to delete from storage too)
    const { data: doc } = await supabase
      .from('documents')
      .select('storage_path')
      .eq('id', id)
      .eq('org_id', org_id)
      .single();

    if (!doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // Delete chunks first (foreign key)
    await supabase
      .from('document_chunks')
      .delete()
      .eq('document_id', id);

    // Delete the document record
    await supabase
      .from('documents')
      .delete()
      .eq('id', id)
      .eq('org_id', org_id);

    // Try to delete from storage (non-critical)
    if (doc.storage_path && !doc.storage_path.startsWith('http')) {
      try {
        await supabase.storage.from('documents').remove([doc.storage_path]);
      } catch {
        // Storage delete is best-effort
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete document error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH /api/documents/[id] — update category
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { org_id, category } = await request.json();
    if (!org_id || !id || !category) {
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
  } catch (error) {
    console.error('Update document error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// GET /api/documents/[id]/download — download document content
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createAdminClient();

    const { data: doc } = await supabase
      .from('documents')
      .select('filename, parsed_text, storage_path, file_type')
      .eq('id', id)
      .single();

    if (!doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // Try storage first
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

    // Fallback: return parsed text
    if (doc.parsed_text) {
      return new NextResponse(doc.parsed_text, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(doc.filename || 'document.txt')}"`,
        },
      });
    }

    return NextResponse.json({ error: 'No content available' }, { status: 404 });
  } catch (error) {
    console.error('Download document error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
