import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { geminiClassify, geminiExtract, geminiSummarize, geminiOcrPdf, geminiParseXlsx } from '@/lib/ai/gemini';
import { embedBatch } from '@/lib/ai/rag';
import { chunkText } from '@/lib/utils/text';

export const maxDuration = 60;

// ===== Types =====

export type ScanStatus =
  | 'pending'
  | 'scanning_drive'
  | 'identifying_files'
  | 'building_profile'
  | 'done'
  | 'error';

export interface ScanProgress {
  status: ScanStatus;
  message: string;
  files_found: number;
  files_processed: number;
  profile_completeness: number; // 0-100
  error?: string;
}

// ===== Token management (shared with drive/connect) =====

async function getValidAccessToken(orgId: string): Promise<string | null> {
  const supabase = createAdminClient();
  const { data: conn } = await supabase
    .from('google_connections')
    .select('access_token, refresh_token, token_expiry')
    .eq('org_id', orgId)
    .single();

  if (!conn) return null;

  if (conn.token_expiry && new Date(conn.token_expiry) > new Date(Date.now() + 120_000)) {
    return conn.access_token;
  }

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
    if (!res.ok) return null;
    const data = await res.json();
    const newExpiry = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000).toISOString()
      : null;
    await supabase.from('google_connections').update({
      access_token: data.access_token,
      token_expiry: newExpiry,
      updated_at: new Date().toISOString(),
    }).eq('org_id', orgId);
    return data.access_token;
  } catch {
    return null;
  }
}

// ===== Drive helpers =====

type DriveFile = { id: string; name: string; mimeType: string };

async function listAllFiles(folderId: string, accessToken: string, depth = 0): Promise<DriveFile[]> {
  if (depth > 3) return [];
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed=false&fields=files(id,name,mimeType)&pageSize=100`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) return [];
  const data = await res.json();
  const items: DriveFile[] = data.files || [];
  const files: DriveFile[] = [];
  const subPromises: Promise<DriveFile[]>[] = [];
  for (const item of items) {
    if (item.mimeType === 'application/vnd.google-apps.folder') {
      subPromises.push(listAllFiles(item.id, accessToken, depth + 1));
    } else {
      files.push(item);
    }
  }
  const subs = await Promise.all(subPromises);
  return [...files, ...subs.flat()];
}

async function downloadFile(fileId: string, fileName: string, mimeType: string, accessToken: string): Promise<string> {
  const auth = { Authorization: `Bearer ${accessToken}` };

  if (mimeType === 'application/vnd.google-apps.document') {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`, { headers: auth });
    if (r.ok) return r.text();
  }
  if (mimeType === 'application/vnd.google-apps.spreadsheet') {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/csv`, { headers: auth });
    if (r.ok) return r.text();
  }
  if (mimeType === 'application/vnd.google-apps.presentation') {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`, { headers: auth });
    if (r.ok) return r.text();
  }

  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers: auth });
  if (!r.ok) return '';
  const buffer = Buffer.from(await r.arrayBuffer());

  if (mimeType === 'application/pdf' || fileName.endsWith('.pdf')) {
    try {
      const pdfParse = (await import('pdf-parse')).default;
      const result = await pdfParse(buffer);
      if (result.text?.trim().length > 20) return result.text;
    } catch { /* fallback */ }
    return geminiOcrPdf(buffer);
  }
  if (mimeType?.includes('wordprocessingml') || fileName.endsWith('.docx')) {
    const mammoth = await import('mammoth');
    const extract = mammoth.default?.extractRawText || mammoth.extractRawText;
    const result = await extract({ buffer });
    return result.value || '';
  }
  if (mimeType?.includes('spreadsheetml') || fileName.endsWith('.xlsx')) {
    return geminiParseXlsx(buffer);
  }
  const text = buffer.toString('utf-8');
  return text.includes('\u0000') ? '' : text.slice(0, 50000);
}

// ===== Profile completeness score =====

function calcProfileCompleteness(profile: Record<string, unknown>): number {
  const fields = [
    'name', 'registration_number', 'mission', 'focus_areas',
    'target_populations', 'regions', 'annual_budget',
    'beneficiaries_count', 'key_achievements', 'contact_email',
  ];
  let filled = 0;
  for (const f of fields) {
    const v = profile[f];
    if (v && (typeof v !== 'string' || v.length > 2) && (!Array.isArray(v) || v.length > 0)) {
      filled++;
    }
  }
  return Math.round((filled / fields.length) * 100);
}

// ===== Save status to DB so frontend can poll =====

async function setScanStatus(orgId: string, progress: ScanProgress) {
  const supabase = createAdminClient();
  await supabase.from('org_profiles').upsert({
    org_id: orgId,
    scan_progress: progress,
    last_updated: new Date().toISOString(),
  }, { onConflict: 'org_id' });
}

// ===== Main: runInitialOrganizationScan =====

async function runInitialOrganizationScan(orgId: string): Promise<ScanProgress> {
  const supabase = createAdminClient();

  // Mark scan started
  await setScanStatus(orgId, { status: 'scanning_drive', message: 'סורק Google Drive...', files_found: 0, files_processed: 0, profile_completeness: 0 });

  // Fetch org profile
  const { data: profileRow } = await supabase.from('org_profiles').select('data').eq('org_id', orgId).single();
  const profile = (profileRow?.data as Record<string, unknown>) || {};

  // Get Drive folder ID
  const folderId = profile.drive_folder_id as string | undefined;
  if (!folderId) {
    const result: ScanProgress = { status: 'done', message: 'אין תיקיית Drive מחוברת', files_found: 0, files_processed: 0, profile_completeness: calcProfileCompleteness(profile) };
    await setScanStatus(orgId, result);
    return result;
  }

  // Get OAuth token
  const accessToken = await getValidAccessToken(orgId);
  if (!accessToken) {
    const result: ScanProgress = { status: 'error', message: 'לא ניתן לגשת ל-Drive — חברו מחדש', files_found: 0, files_processed: 0, profile_completeness: 0, error: 'no_token' };
    await setScanStatus(orgId, result);
    return result;
  }

  // List all files
  const allFiles = await listAllFiles(folderId, accessToken);
  const supported = allFiles.filter(f =>
    !f.mimeType.includes('folder') &&
    !f.mimeType.includes('image') &&
    !f.mimeType.includes('video') &&
    !f.mimeType.includes('audio')
  );

  await setScanStatus(orgId, { status: 'identifying_files', message: `זיהוי ${supported.length} קבצים...`, files_found: supported.length, files_processed: 0, profile_completeness: 0 });

  // Skip files already in DB
  const { data: existingDocs } = await supabase
    .from('documents')
    .select('storage_path')
    .eq('org_id', orgId);
  const existingPaths = new Set((existingDocs || []).map((d: { storage_path: string }) => d.storage_path));

  const newFiles = supported.filter(f => !existingPaths.has(`drive://${f.id}`));

  let processed = 0;
  const orgName = profile.name as string | undefined;

  // Process files in batches of 3 (conservative for 60s timeout)
  const BATCH = 3;
  for (let i = 0; i < newFiles.length; i += BATCH) {
    const batch = newFiles.slice(i, i + BATCH);
    await Promise.all(batch.map(async (file) => {
      try {
        const text = await downloadFile(file.id, file.name, file.mimeType, accessToken);
        if (text.length < 30) return;

        const [category, metadata, summary] = await Promise.all([
          geminiClassify(text),
          geminiExtract(text, orgName),
          geminiSummarize(text),
        ]);

        const fileType = file.mimeType?.includes('pdf') ? 'pdf'
          : file.mimeType?.includes('wordprocessing') || file.mimeType?.includes('document') ? 'docx'
          : file.mimeType?.includes('spreadsheet') ? 'xlsx' : 'other';

        const { data: doc } = await supabase.from('documents').insert({
          org_id: orgId,
          filename: file.name,
          file_type: fileType,
          storage_path: `drive://${file.id}`,
          category,
          parsed_text: text.slice(0, 50000),
          metadata: { ...metadata, summary, drive_file_id: file.id, source: 'initial_scan' },
          status: 'ready',
        }).select('id').single();

        if (doc) {
          const chunks = chunkText(text);
          let embeddings: number[][] = [];
          try { embeddings = await embedBatch(chunks); } catch { /* no vectors */ }
          for (let j = 0; j < chunks.length; j++) {
            await supabase.from('document_chunks').insert({
              document_id: doc.id,
              org_id: orgId,
              content: chunks[j],
              embedding: embeddings[j] ?? null,
              metadata: { category, filename: file.name, source: 'initial_scan' },
            });
          }

          // Merge metadata into org profile (non-destructive)
          if (Object.keys(metadata).length > 0) {
            const { data: currentProfile } = await supabase.from('org_profiles').select('data').eq('org_id', orgId).single();
            const current = (currentProfile?.data as Record<string, unknown>) || {};
            const merged = { ...current };
            const enrichFields = ['name', 'registration_number', 'mission', 'focus_areas', 'target_populations', 'regions', 'beneficiaries_count', 'employees_count', 'annual_budget', 'key_achievements', 'contact_email', 'contact_phone', 'website', 'theory_of_change'];
            for (const key of enrichFields) {
              if ((metadata as Record<string, unknown>)[key] && !merged[key]) {
                merged[key] = (metadata as Record<string, unknown>)[key];
              }
            }
            await supabase.from('org_profiles').upsert({ org_id: orgId, data: merged, last_updated: new Date().toISOString() }, { onConflict: 'org_id' });
          }
        }
      } catch (e) {
        console.error(`[onboarding-scan] file error [${file.name}]:`, e);
      }

      processed++;
    }));

    // Update progress after each batch
    const { data: updatedProfile } = await supabase.from('org_profiles').select('data').eq('org_id', orgId).single();
    const currentCompleteness = calcProfileCompleteness((updatedProfile?.data as Record<string, unknown>) || {});
    await setScanStatus(orgId, {
      status: 'building_profile',
      message: `מעבד ${Math.min(i + BATCH, newFiles.length)} מתוך ${newFiles.length} קבצים...`,
      files_found: supported.length,
      files_processed: processed,
      profile_completeness: currentCompleteness,
    });
  }

  // Final state
  const { data: finalProfile } = await supabase.from('org_profiles').select('data').eq('org_id', orgId).single();
  const finalCompleteness = calcProfileCompleteness((finalProfile?.data as Record<string, unknown>) || {});

  const result: ScanProgress = {
    status: 'done',
    message: newFiles.length > 0
      ? `סרקתי ${newFiles.length} קבצים ובניתי פרופיל ארגוני`
      : 'הקבצים כבר סרוקים',
    files_found: supported.length,
    files_processed: processed,
    profile_completeness: finalCompleteness,
  };

  await setScanStatus(orgId, result);

  // Track API usage
  try {
    await supabase.from('usage_logs').insert({
      org_id: orgId,
      event_type: 'initial_scan',
      details: { files_processed: processed, profile_completeness: finalCompleteness },
    });
  } catch { /* table may not exist yet */ }

  return result;
}

// ===== Route handlers =====

export async function POST(req: NextRequest) {
  try {
    const { org_id } = await req.json();
    if (!org_id) return NextResponse.json({ error: 'Missing org_id' }, { status: 400 });

    // Tenant isolation: only allow the org itself or admin
    const xOrgId = req.headers.get('x-org-id');
    if (xOrgId && xOrgId !== org_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const progress = await runInitialOrganizationScan(org_id);
    return NextResponse.json(progress);
  } catch (e) {
    console.error('[onboarding-scan] error:', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// GET — poll current scan status
export async function GET(req: NextRequest) {
  try {
    const org_id = req.nextUrl.searchParams.get('org_id');
    if (!org_id) return NextResponse.json({ error: 'Missing org_id' }, { status: 400 });

    const supabase = createAdminClient();
    const { data } = await supabase
      .from('org_profiles')
      .select('scan_progress, data')
      .eq('org_id', org_id)
      .single();

    const progress = data?.scan_progress as ScanProgress | null;
    const completeness = data?.data ? calcProfileCompleteness(data.data as Record<string, unknown>) : 0;

    return NextResponse.json({
      progress: progress || { status: 'pending', message: 'ממתין לסריקה', files_found: 0, files_processed: 0, profile_completeness: completeness },
      profile_completeness: completeness,
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
