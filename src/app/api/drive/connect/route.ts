import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { geminiClassify, geminiExtract, geminiSummarize, geminiOcrPdf, geminiParseXlsx } from '@/lib/ai/gemini';
import { embedBatch } from '@/lib/ai/rag';
import { chunkText } from '@/lib/utils/text';

export const maxDuration = 60;

// ===== Token Management =====

async function getValidAccessToken(orgId: string): Promise<string | null> {
  const supabase = createAdminClient();
  const { data: conn } = await supabase
    .from('google_connections')
    .select('access_token, refresh_token, token_expiry')
    .eq('org_id', orgId)
    .single();

  if (!conn) return null;

  // Token still valid (with 2-min buffer)
  if (conn.token_expiry && new Date(conn.token_expiry) > new Date(Date.now() + 120_000)) {
    return conn.access_token;
  }

  // Refresh if we have a refresh_token
  if (!conn.refresh_token) return null;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: conn.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!res.ok) {
      console.error('Token refresh failed:', await res.text().catch(() => ''));
      return null;
    }

    const data = await res.json();
    const newExpiry = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000).toISOString()
      : null;

    // Save new access_token
    await supabase.from('google_connections').update({
      access_token: data.access_token,
      token_expiry: newExpiry,
      updated_at: new Date().toISOString(),
    }).eq('org_id', orgId);

    return data.access_token;
  } catch (e) {
    console.error('Token refresh error:', e);
    return null;
  }
}

// ===== Drive Helpers =====

function extractFolderId(url: string): string | null {
  const folderMatch = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) return folderMatch[1];
  const idMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idMatch) return idMatch[1];
  return null;
}

async function downloadAndParseDriveFile(
  fileId: string,
  fileName: string,
  mimeType: string,
  accessToken: string
): Promise<string> {
  const authHeader = { Authorization: `Bearer ${accessToken}` };

  // Google Workspace files — export as text
  if (mimeType === 'application/vnd.google-apps.document') {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`, { headers: authHeader });
    if (res.ok) return await res.text();
  }
  if (mimeType === 'application/vnd.google-apps.spreadsheet') {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/csv`, { headers: authHeader });
    if (res.ok) return await res.text();
  }
  if (mimeType === 'application/vnd.google-apps.presentation') {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`, { headers: authHeader });
    if (res.ok) return await res.text();
  }

  // Binary files — download and parse
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers: authHeader });
  if (!res.ok) return '';

  const buffer = Buffer.from(await res.arrayBuffer());

  if (mimeType === 'application/pdf' || fileName.endsWith('.pdf')) {
    try {
      const pdfParse = (await import('pdf-parse')).default;
      const result = await pdfParse(buffer);
      if (result.text?.trim().length > 20) return result.text;
    } catch { /* fallback to OCR */ }
    return await geminiOcrPdf(buffer);
  }

  if (mimeType?.includes('wordprocessingml') || fileName.endsWith('.docx')) {
    const mammoth = await import('mammoth');
    const extract = mammoth.default?.extractRawText || mammoth.extractRawText;
    const result = await extract({ buffer });
    return result.value || '';
  }

  if (mimeType?.includes('spreadsheetml') || fileName.endsWith('.xlsx')) {
    return await geminiParseXlsx(buffer);
  }

  // Try as plain text
  const text = buffer.toString('utf-8');
  if (text.length > 50 && !text.includes('\u0000')) return text;

  return '';
}

// ===== Main Handler =====

export async function POST(request: NextRequest) {
  try {
    const { org_id, drive_url } = await request.json();

    if (!org_id || !drive_url) {
      return Response.json({ error: 'Missing org_id or drive_url' }, { status: 400 });
    }

    const folderId = extractFolderId(drive_url);
    if (!folderId) {
      return Response.json({ error: 'לא הצלחתי לזהות תיקיית Drive. ודאו שהקישור תקין.' }, { status: 400 });
    }

    const supabase = createAdminClient();

    // Save Drive link in org_profiles
    const { data: existingProfile } = await supabase.from('org_profiles').select('data').eq('org_id', org_id).single();
    const profileData = (existingProfile?.data as Record<string, unknown>) || {};
    profileData.drive_folder_id = folderId;
    profileData.drive_url = drive_url;
    profileData.drive_connected_at = new Date().toISOString();
    await supabase.from('org_profiles').upsert({ org_id, data: profileData, last_updated: new Date().toISOString() }, { onConflict: 'org_id' });

    // Get valid OAuth access token
    const accessToken = await getValidAccessToken(org_id);

    if (!accessToken) {
      // No OAuth connection — check if API key fallback available for public folders
      const apiKey = process.env.GOOGLE_API_KEY;
      if (!apiKey) {
        return Response.json({
          connected: false,
          needs_auth: true,
          folder_id: folderId,
          message: 'נדרש חיבור Google Drive. לחץ על "חבר Google Drive" כדי לאשר גישה.',
        });
      }

      // Try API key (works only for public folders)
      return await connectWithApiKey(org_id, folderId, drive_url, apiKey, supabase);
    }

    // OAuth path — full access
    return await connectWithOAuth(org_id, folderId, drive_url, accessToken, supabase);

  } catch (error) {
    console.error('Drive connect error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ===== Recursive folder listing =====

type DriveFile = { id: string; name: string; mimeType: string };

async function listAllFiles(
  folderId: string,
  accessToken: string,
  depth: number = 0
): Promise<DriveFile[]> {
  // Max depth 3 to avoid runaway recursion on deeply nested drives
  if (depth > 3) return [];

  const authHeader = { Authorization: `Bearer ${accessToken}` };
  const url = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed=false&fields=files(id,name,mimeType)&pageSize=100`;
  const res = await fetch(url, { headers: authHeader });
  if (!res.ok) return [];

  const data = await res.json();
  const items: DriveFile[] = data.files || [];

  const files: DriveFile[] = [];
  const subFolderPromises: Promise<DriveFile[]>[] = [];

  for (const item of items) {
    if (item.mimeType === 'application/vnd.google-apps.folder') {
      // Recurse into subfolder
      subFolderPromises.push(listAllFiles(item.id, accessToken, depth + 1));
    } else {
      files.push(item);
    }
  }

  const subResults = await Promise.all(subFolderPromises);
  return [...files, ...subResults.flat()];
}

// ===== OAuth Connection (private + public folders) =====

async function connectWithOAuth(
  orgId: string,
  folderId: string,
  driveUrl: string,
  accessToken: string,
  supabase: ReturnType<typeof createAdminClient>
) {
  const allFiles = await listAllFiles(folderId, accessToken);

  if (allFiles.length === 0) {
    // Check if the folder itself is accessible
    const testRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed=false&pageSize=1`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!testRes.ok) {
      return Response.json({
        connected: false,
        needs_auth: true,
        folder_id: folderId,
        message: 'לא הצלחתי לגשת לתיקייה. ייתכן שתוקף ההרשאה פג — נסו לחבר מחדש.',
      });
    }
    return Response.json({ connected: true, folder_id: folderId, files_found: 0, message: 'התיקייה ריקה.' });
  }

  return await processFiles(orgId, folderId, allFiles, accessToken, supabase);
}

// ===== API Key Fallback (public folders only) =====

async function connectWithApiKey(
  orgId: string,
  folderId: string,
  driveUrl: string,
  apiKey: string,
  supabase: ReturnType<typeof createAdminClient>
) {
  const listUrl = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed=false&key=${apiKey}&fields=files(id,name,mimeType,size)&pageSize=30`;
  const listRes = await fetch(listUrl);

  if (!listRes.ok) {
    return Response.json({
      connected: false,
      needs_auth: true,
      folder_id: folderId,
      message: 'התיקייה פרטית. חברו Google Drive כדי שגולדפיש יוכל לגשת לקבצים.',
    });
  }

  const listData = await listRes.json();
  const files = listData.files || [];

  if (files.length === 0) {
    return Response.json({
      connected: true,
      folder_id: folderId,
      files_found: 0,
      message: 'התיקייה ריקה או לא משותפת לכולם.',
    });
  }

  // For API key, download using key param
  return await processFilesWithApiKey(orgId, folderId, files, apiKey, supabase);
}

// ===== File Processing (OAuth) =====

async function processFiles(
  orgId: string,
  folderId: string,
  files: { id: string; name: string; mimeType: string }[],
  accessToken: string,
  supabase: ReturnType<typeof createAdminClient>
) {
  const supportedFiles = files.filter(f =>
    !f.mimeType.includes('folder') && !f.mimeType.includes('image') && !f.mimeType.includes('video')
  );

  if (supportedFiles.length === 0) {
    return Response.json({ connected: true, folder_id: folderId, files_found: 0, message: 'לא נמצאו קבצים נתמכים.' });
  }

  let successCount = 0;
  const failedNames: string[] = [];

  const processFile = async (file: { id: string; name: string; mimeType: string }) => {
    // Skip if already imported
    const { data: existing } = await supabase.from('documents').select('id').eq('org_id', orgId).eq('storage_path', `drive://${file.id}`).limit(1);
    if (existing?.length) { successCount++; return; }

    try {
      const text = await downloadAndParseDriveFile(file.id, file.name, file.mimeType, accessToken);
      if (text.length < 20) { failedNames.push(file.name); return; }

      const [category, metadata, summary] = await Promise.all([
        geminiClassify(text),
        geminiExtract(text),
        geminiSummarize(text),
      ]);

      const fileType = file.mimeType?.includes('pdf') ? 'pdf'
        : file.mimeType?.includes('document') || file.mimeType?.includes('wordprocessing') ? 'docx'
        : file.mimeType?.includes('spreadsheet') ? 'xlsx' : 'other';

      const { data: doc } = await supabase.from('documents').insert({
        org_id: orgId,
        filename: file.name,
        file_type: fileType,
        storage_path: `drive://${file.id}`,
        category,
        parsed_text: text.slice(0, 50000),
        metadata: { ...metadata, summary, drive_file_id: file.id, mime_type: file.mimeType },
        status: 'ready',
      }).select('id').single();

      if (doc) {
        const chunks = chunkText(text);
        let embeddings: number[][] = [];
        try { embeddings = await embedBatch(chunks); } catch { /* save without vectors */ }
        for (let i = 0; i < chunks.length; i++) {
          await supabase.from('document_chunks').insert({
            document_id: doc.id,
            org_id: orgId,
            content: chunks[i],
            embedding: embeddings[i] ?? null,
            metadata: { category, filename: file.name, source: 'drive_oauth' },
          });
        }
      }

      successCount++;
    } catch (e) {
      console.error(`Drive file error [${file.name}]:`, e);
      failedNames.push(file.name);
    }
  };

  // Process in batches of 5 to stay within 60s timeout
  for (let i = 0; i < supportedFiles.length; i += 5) {
    await Promise.all(supportedFiles.slice(i, i + 5).map(processFile));
  }

  const message = failedNames.length === 0
    ? `נקראו ${successCount} קבצים מ-Drive בהצלחה`
    : `${successCount} נקראו. נכשלו: ${failedNames.join(', ')}`;

  return Response.json({ connected: true, folder_id: folderId, files_found: successCount, failed: failedNames, message });
}

// ===== File Processing (API Key — public folders) =====

async function processFilesWithApiKey(
  orgId: string,
  folderId: string,
  files: { id: string; name: string; mimeType: string }[],
  apiKey: string,
  supabase: ReturnType<typeof createAdminClient>
) {
  // Reuse same logic but with API key header substitution
  // Wrap accessToken-based download to use key param instead
  const downloadWithKey = async (fileId: string, fileName: string, mimeType: string): Promise<string> => {
    if (mimeType === 'application/vnd.google-apps.document') {
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain&key=${apiKey}`);
      if (res.ok) return await res.text();
    }
    if (mimeType === 'application/vnd.google-apps.spreadsheet') {
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/csv&key=${apiKey}`);
      if (res.ok) return await res.text();
    }
    if (mimeType === 'application/vnd.google-apps.presentation') {
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain&key=${apiKey}`);
      if (res.ok) return await res.text();
    }
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${apiKey}`);
    if (!res.ok) return '';
    const buffer = Buffer.from(await res.arrayBuffer());
    if (mimeType === 'application/pdf' || fileName.endsWith('.pdf')) {
      try { const p = (await import('pdf-parse')).default; const r = await p(buffer); if (r.text?.trim().length > 20) return r.text; } catch { /* */ }
      return await geminiOcrPdf(buffer);
    }
    const text = buffer.toString('utf-8');
    return text.includes('\u0000') ? '' : text.slice(0, 50000);
  };

  const supportedFiles = files.filter(f => !f.mimeType.includes('folder') && !f.mimeType.includes('image'));
  let successCount = 0;
  const failedNames: string[] = [];

  for (let i = 0; i < supportedFiles.length; i += 5) {
    await Promise.all(supportedFiles.slice(i, i + 5).map(async (file) => {
      const { data: existing } = await supabase.from('documents').select('id').eq('org_id', orgId).eq('storage_path', `drive://${file.id}`).limit(1);
      if (existing?.length) { successCount++; return; }
      try {
        const text = await downloadWithKey(file.id, file.name, file.mimeType);
        if (text.length < 20) { failedNames.push(file.name); return; }
        const [category, metadata, summary] = await Promise.all([geminiClassify(text), geminiExtract(text), geminiSummarize(text)]);
        const { data: doc } = await supabase.from('documents').insert({
          org_id: orgId, filename: file.name, file_type: 'other',
          storage_path: `drive://${file.id}`, category,
          parsed_text: text.slice(0, 50000),
          metadata: { ...metadata, summary, drive_file_id: file.id },
          status: 'ready',
        }).select('id').single();
        if (doc) {
          const chunks = chunkText(text);
          let embeddings: number[][] = [];
          try { embeddings = await embedBatch(chunks); } catch { /* */ }
          for (let j = 0; j < chunks.length; j++) {
            await supabase.from('document_chunks').insert({ document_id: doc.id, org_id: orgId, content: chunks[j], embedding: embeddings[j] ?? null, metadata: { category, filename: file.name, source: 'drive_apikey' } });
          }
        }
        successCount++;
      } catch (e) { console.error(`Drive apikey file error [${file.name}]:`, e); failedNames.push(file.name); }
    }));
  }

  const message = failedNames.length === 0 ? `נקראו ${successCount} קבצים` : `${successCount} נקראו. נכשלו: ${failedNames.join(', ')}`;
  return Response.json({ connected: true, folder_id: folderId, files_found: successCount, failed: failedNames, message });
}
