import { withAuth } from '@/lib/api-auth';
import { createAdminClient } from '@/lib/supabase/admin';

export const maxDuration = 10;

const ALLOWED_TYPES = new Set(['pdf', 'doc', 'docx', 'txt', 'csv', 'xlsx', 'xls', 'pptx', 'ppt', 'html', 'htm']);
const MAX_BYTES = 50 * 1024 * 1024; // 50MB

export const POST = withAuth(async (request, auth) => {
  const { filename, fileSize } = await request.json();
  const orgId = auth.orgId;

  if (!filename || typeof fileSize !== 'number') {
    return Response.json({ error: 'Missing filename or fileSize' }, { status: 400 });
  }

  // Validate file size
  if (fileSize > MAX_BYTES) {
    return Response.json({ error: `הקובץ גדול מ-50MB — לא נתמך` }, { status: 400 });
  }

  // Validate file type
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (!ALLOWED_TYPES.has(ext)) {
    return Response.json({ error: `סוג קובץ לא נתמך: .${ext}` }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Check duplicate
  const { data: existing } = await supabase
    .from('documents')
    .select('id')
    .eq('org_id', orgId)
    .eq('filename', filename)
    .limit(1);

  if (existing && existing.length > 0) {
    return Response.json({
      document_id: existing[0].id,
      already_exists: true,
      summary: `"${filename}" כבר קיים במערכת`,
      category: 'existing',
    });
  }

  // Build storage path — orgId comes from server session only
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `${orgId}/${Date.now()}_${safeName}`;

  // Create document record with status=processing BEFORE signed URL
  const { data: doc, error: docError } = await supabase
    .from('documents')
    .insert({
      org_id: orgId,
      filename,
      file_type: ext,
      storage_path: storagePath,
      category: 'other',
      parsed_text: null,
      metadata: {},
      status: 'processing',
    })
    .select('id')
    .single();

  if (docError || !doc) {
    return Response.json({ error: `Failed to create document record: ${docError?.message || 'unknown'}` }, { status: 500 });
  }

  // Generate signed upload URL (valid 5 minutes)
  const { data: signedData, error: signedError } = await supabase.storage
    .from('documents')
    .createSignedUploadUrl(storagePath);

  if (signedError || !signedData) {
    // Clean up the doc record we just created
    await supabase.from('documents').delete().eq('id', doc.id);
    return Response.json({ error: `Failed to create signed URL: ${signedError?.message || 'unknown'}` }, { status: 500 });
  }

  return Response.json({
    document_id: doc.id,
    storage_path: storagePath,
    signed_url: signedData.signedUrl,
    token: signedData.token,
  });
});
