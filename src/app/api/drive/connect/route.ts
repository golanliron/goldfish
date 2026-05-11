import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { geminiClassify, geminiExtract, geminiSummarize, geminiOcrPdf, geminiParseXlsx } from '@/lib/ai/gemini';

export const maxDuration = 60;

function extractFolderId(url: string): string | null {
  const folderMatch = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) return folderMatch[1];
  const idMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idMatch) return idMatch[1];
  return null;
}

function chunkText(text: string, maxChars: number = 2000): string[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = '';
  for (const para of paragraphs) {
    if ((current + para).length > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = para;
    } else {
      current += (current ? '\n\n' : '') + para;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [text.slice(0, maxChars)];
}

async function downloadAndParseDriveFile(
  fileId: string,
  fileName: string,
  mimeType: string,
  apiKey: string
): Promise<string> {
  // Google Docs/Sheets/Slides → export as text
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

  // Binary files (PDF, DOCX, XLSX) → download and parse
  const downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${apiKey}`;
  const res = await fetch(downloadUrl);
  if (!res.ok) return '';

  const buffer = Buffer.from(await res.arrayBuffer());

  if (mimeType === 'application/pdf' || fileName.endsWith('.pdf')) {
    // Try pdf-parse first, fallback to Gemini OCR
    try {
      const pdfParse = (await import('pdf-parse')).default;
      const result = await pdfParse(buffer);
      if (result.text && result.text.trim().length > 20) return result.text;
    } catch { /* fallback */ }
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

export async function POST(request: NextRequest) {
  try {
    const { org_id, drive_url } = await request.json();

    if (!org_id || !drive_url) {
      return Response.json({ error: 'Missing org_id or drive_url' }, { status: 400 });
    }

    const folderId = extractFolderId(drive_url);
    if (!folderId) {
      return Response.json({
        error: 'לא הצלחתי לזהות תיקיית Drive. ודאו שהקישור תקין.',
      }, { status: 400 });
    }

    const supabase = createAdminClient();

    // Save Drive link in org_profiles
    const { data: existing } = await supabase
      .from('org_profiles')
      .select('data')
      .eq('org_id', org_id)
      .single();

    const current = (existing?.data as Record<string, unknown>) || {};
    current.drive_folder_id = folderId;
    current.drive_url = drive_url;
    current.drive_connected_at = new Date().toISOString();

    await supabase.from('org_profiles').upsert({
      org_id,
      data: current,
      last_updated: new Date().toISOString(),
    }, { onConflict: 'org_id' });

    // Try to list and read files
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return Response.json({
        connected: true,
        folder_id: folderId,
        files_found: 0,
        message: 'קישור Drive נשמר, אך חסר GOOGLE_API_KEY לקריאת הקבצים.',
      });
    }

    const listUrl = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed=false&key=${apiKey}&fields=files(id,name,mimeType,size)&pageSize=30`;
    const listRes = await fetch(listUrl);

    if (!listRes.ok) {
      const err = await listRes.text().catch(() => '');
      console.error('Drive list error:', err);
      return Response.json({
        connected: true,
        folder_id: folderId,
        files_found: 0,
        message: 'קישור Drive נשמר. ודאו שהתיקייה משותפת (Anyone with the link).',
      });
    }

    const listData = await listRes.json();
    const files = listData.files || [];

    if (files.length === 0) {
      return Response.json({
        connected: true,
        folder_id: folderId,
        files_found: 0,
        message: 'התיקייה ריקה או לא משותפת. ודאו שהיא פתוחה (Anyone with the link).',
      });
    }

    // Skip folders and unsupported types
    const supportedFiles = files.filter((f: { mimeType: string }) =>
      !f.mimeType.includes('folder') && !f.mimeType.includes('image') && !f.mimeType.includes('video')
    );

    // Process files in parallel (max 5 at a time to stay within timeout)
    let successCount = 0;
    const failedNames: string[] = [];

    const processFile = async (file: { id: string; name: string; mimeType: string }) => {
      // Skip if already exists
      const { data: existing } = await supabase
        .from('documents')
        .select('id')
        .eq('org_id', org_id)
        .eq('filename', file.name)
        .limit(1);

      if (existing && existing.length > 0) {
        successCount++; // Count as success (already imported)
        return;
      }

      try {
        const text = await downloadAndParseDriveFile(file.id, file.name, file.mimeType, apiKey);

        if (text.length < 20) {
          failedNames.push(file.name);
          return;
        }

        // Classify + extract + summarize
        const [category, metadata, summary] = await Promise.all([
          geminiClassify(text),
          geminiExtract(text),
          geminiSummarize(text),
        ]);

        const { data: doc } = await supabase
          .from('documents')
          .insert({
            org_id,
            filename: file.name,
            file_type: file.mimeType?.includes('pdf') ? 'pdf' :
                       file.mimeType?.includes('document') || file.mimeType?.includes('wordprocessing') ? 'docx' :
                       file.mimeType?.includes('spreadsheet') ? 'xlsx' : 'other',
            storage_path: `drive://${file.id}`,
            category,
            parsed_text: text.slice(0, 50000),
            metadata: { ...metadata, summary, drive_file_id: file.id, mime_type: file.mimeType },
            status: 'ready',
          })
          .select('id')
          .single();

        // Save chunks for RAG
        if (doc) {
          const chunks = chunkText(text);
          for (const chunk of chunks) {
            await supabase.from('document_chunks').insert({
              document_id: doc.id,
              org_id,
              content: chunk,
              metadata: { category, filename: file.name },
            });
          }
        }

        successCount++;
      } catch (e) {
        console.error(`Drive file error [${file.name}]:`, e);
        failedNames.push(file.name);
      }
    };

    // Process in batches of 5
    for (let i = 0; i < supportedFiles.length; i += 5) {
      await Promise.all(supportedFiles.slice(i, i + 5).map(processFile));
    }

    const message = failedNames.length === 0
      ? `נקראו ${successCount} קבצים מ-Drive בהצלחה`
      : `${successCount} נקראו. נכשלו: ${failedNames.join(', ')}`;

    return Response.json({
      connected: true,
      folder_id: folderId,
      files_found: successCount,
      failed: failedNames,
      message,
    });
  } catch (error) {
    console.error('Drive connect error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
