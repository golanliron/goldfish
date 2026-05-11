import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { geminiClassify, geminiExtract, geminiSummarize } from '@/lib/ai/gemini';

// ===== URL Type Detection =====

type UrlType = 'drive_folder' | 'drive_file' | 'facebook' | 'instagram' | 'linkedin' | 'website';

function detectUrlType(url: string): UrlType {
  const u = url.toLowerCase();
  if (u.includes('drive.google.com') || u.includes('docs.google.com')) {
    return u.includes('/folders/') ? 'drive_folder' : 'drive_file';
  }
  if (u.includes('facebook.com') || u.includes('fb.com') || u.includes('fb.me')) return 'facebook';
  if (u.includes('instagram.com') || u.includes('instagr.am')) return 'instagram';
  if (u.includes('linkedin.com')) return 'linkedin';
  return 'website';
}

// ===== HTML Stripping =====

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ===== Extract OG/Meta tags for social pages =====

function extractMetaTags(html: string): Record<string, string> {
  const tags: Record<string, string> = {};
  const ogRegex = /<meta\s+(?:property|name)=["'](og:|twitter:|description|title)([^"']*)["']\s+content=["']([^"']*)["']/gi;
  let match;
  while ((match = ogRegex.exec(html)) !== null) {
    tags[(match[1] + match[2]).toLowerCase()] = match[3];
  }
  // Also try reversed attribute order
  const revRegex = /<meta\s+content=["']([^"']*)["']\s+(?:property|name)=["'](og:|twitter:|description|title)([^"']*)["']/gi;
  while ((match = revRegex.exec(html)) !== null) {
    tags[(match[2] + match[3]).toLowerCase()] = match[1];
  }
  return tags;
}

// ===== Smart fetch with browser-like UA =====

async function smartFetch(url: string): Promise<{ html: string; ok: boolean; status: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'he,en;q=0.9',
      },
      redirect: 'follow',
    });
    clearTimeout(timeout);
    const html = await res.text();
    return { html, ok: res.ok, status: res.status };
  } catch {
    clearTimeout(timeout);
    return { html: '', ok: false, status: 0 };
  }
}

// ===== Chunking =====

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

// ===== Google Drive Folder Handler =====

function extractFolderId(url: string): string | null {
  const folderMatch = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) return folderMatch[1];
  const idMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idMatch) return idMatch[1];
  return null;
}

async function handleDriveFolder(
  url: string,
  orgId: string,
  supabase: ReturnType<typeof createAdminClient>
): Promise<{ text: string; title: string; filesFound: number }> {
  const folderId = extractFolderId(url);
  if (!folderId) {
    return { text: '', title: 'Google Drive', filesFound: 0 };
  }

  // Save Drive connection in org_profiles
  const { data: existing } = await supabase
    .from('org_profiles')
    .select('data')
    .eq('org_id', orgId)
    .single();

  const current = (existing?.data as Record<string, unknown>) || {};
  current.drive_folder_id = folderId;
  current.drive_url = url;
  current.drive_connected_at = new Date().toISOString();

  await supabase.from('org_profiles').upsert({
    org_id: orgId,
    data: current,
    last_updated: new Date().toISOString(),
  }, { onConflict: 'org_id' });

  // Try to list files via Google API
  const apiKey = process.env.GOOGLE_API_KEY;
  let filesFound = 0;
  let fileNames: string[] = [];

  if (apiKey) {
    try {
      const listUrl = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed=false&key=${apiKey}&fields=files(id,name,mimeType,size)&pageSize=50`;
      const res = await fetch(listUrl);

      if (res.ok) {
        const data = await res.json();
        const files = data.files || [];

        for (const file of files) {
          fileNames.push(`${file.name} (${file.mimeType})`);

          // Try to download and parse each file
          let parsedText = `[קובץ מ-Drive: ${file.name}]`;
          let status: 'ready' | 'processing' = 'processing';

          // For Google Docs/Sheets, export as text
          if (file.mimeType === 'application/vnd.google-apps.document') {
            try {
              const exportUrl = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain&key=${apiKey}`;
              const docRes = await fetch(exportUrl);
              if (docRes.ok) {
                parsedText = await docRes.text();
                status = 'ready';
              }
            } catch { /* keep processing status */ }
          } else if (file.mimeType === 'application/vnd.google-apps.spreadsheet') {
            try {
              const exportUrl = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/csv&key=${apiKey}`;
              const sheetRes = await fetch(exportUrl);
              if (sheetRes.ok) {
                parsedText = await sheetRes.text();
                status = 'ready';
              }
            } catch { /* keep processing status */ }
          } else if (file.mimeType === 'application/vnd.google-apps.presentation') {
            try {
              const exportUrl = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain&key=${apiKey}`;
              const pptRes = await fetch(exportUrl);
              if (pptRes.ok) {
                parsedText = await pptRes.text();
                status = 'ready';
              }
            } catch { /* keep processing status */ }
          }

          await supabase.from('documents').insert({
            org_id: orgId,
            filename: file.name,
            file_type: file.mimeType?.includes('pdf') ? 'pdf' :
                       file.mimeType?.includes('document') ? 'docx' :
                       file.mimeType?.includes('spreadsheet') ? 'xlsx' :
                       file.mimeType?.includes('presentation') ? 'pptx' : 'other',
            storage_path: `drive://${file.id}`,
            category: 'other',
            parsed_text: parsedText.slice(0, 50000),
            metadata: { drive_file_id: file.id, drive_url: url, mime_type: file.mimeType },
            status,
          });

          // If we got text, also create chunks for RAG
          if (status === 'ready' && parsedText.length > 50) {
            const tempDoc = await supabase
              .from('documents')
              .select('id')
              .eq('org_id', orgId)
              .eq('storage_path', `drive://${file.id}`)
              .single();

            if (tempDoc.data) {
              const chunks = chunkText(parsedText);
              for (const chunk of chunks) {
                await supabase.from('document_chunks').insert({
                  document_id: tempDoc.data.id,
                  org_id: orgId,
                  content: chunk,
                  metadata: { source: 'drive', filename: file.name },
                });
              }
            }
          }

          filesFound++;
        }
      }
    } catch (e) {
      console.error('Drive API error:', e);
    }
  }

  const text = filesFound > 0
    ? `תיקיית Google Drive מחוברת.\nFolder ID: ${folderId}\nקבצים שנמצאו (${filesFound}):\n${fileNames.join('\n')}`
    : `קישור Google Drive נשמר: ${url}\nFolder ID: ${folderId}\nלא הצלחתי לגשת לקבצים. ודאו שהתיקייה משותפת (Anyone with the link).`;

  return { text, title: `Google Drive (${filesFound} קבצים)`, filesFound };
}

// ===== Social Page Handler (Facebook/Instagram/LinkedIn) =====

async function handleSocialPage(
  url: string,
  urlType: UrlType
): Promise<{ text: string; title: string }> {
  const { html, ok } = await smartFetch(url);

  if (!ok || html.length < 100) {
    // Social pages often block server fetches — use the URL itself as context
    const platformName = urlType === 'facebook' ? 'פייסבוק' :
                         urlType === 'instagram' ? 'אינסטגרם' : 'לינקדאין';
    return {
      text: `עמוד ${platformName} של הארגון: ${url}\nהפלטפורמה חוסמת קריאה אוטומטית. Goldfish ישתמש בקישור הזה כהפניה.`,
      title: `עמוד ${platformName}`,
    };
  }

  // Extract meta tags — social pages put the good info in OG tags
  const meta = extractMetaTags(html);
  const ogTitle = meta['og:title'] || '';
  const ogDesc = meta['og:description'] || meta['description'] || '';
  const ogType = meta['og:type'] || '';

  // Also strip HTML for body text
  const bodyText = stripHtml(html);

  // Combine OG info with body text for the richest context
  const parts: string[] = [];
  if (ogTitle) parts.push(`שם: ${ogTitle}`);
  if (ogDesc) parts.push(`תיאור: ${ogDesc}`);
  if (ogType) parts.push(`סוג: ${ogType}`);
  parts.push(`\nתוכן העמוד:\n${bodyText}`);

  const text = parts.join('\n');
  const title = ogTitle || url;

  return { text, title };
}

// ===== Main Handler =====

export async function POST(request: NextRequest) {
  try {
    const { org_id, url } = await request.json();

    if (!org_id || !url) {
      return NextResponse.json({ error: 'Missing org_id or url' }, { status: 400 });
    }

    const urlType = detectUrlType(url);
    const supabase = createAdminClient();

    let text = '';
    let title = url;
    let driveFilesFound = 0;

    // ===== Route by URL type =====
    if (urlType === 'drive_folder' || urlType === 'drive_file') {
      const result = await handleDriveFolder(url, org_id, supabase);
      text = result.text;
      title = result.title;
      driveFilesFound = result.filesFound;

      // For Drive, we already saved docs above — just save the main reference
      if (driveFilesFound > 0) {
        await supabase.from('documents').insert({
          org_id,
          filename: title,
          file_type: 'link',
          storage_path: url,
          category: 'other',
          parsed_text: text.slice(0, 50000),
          metadata: { source_url: url, type: 'drive_folder', files_found: driveFilesFound },
          status: 'ready',
        });

        return NextResponse.json({
          title,
          category: 'other',
          summary: `תיקיית Drive מחוברת. ${driveFilesFound} קבצים נמצאו ונקראו.`,
          files_found: driveFilesFound,
        });
      }
      // If no files found via API, fall through to save what we have
    } else if (urlType === 'facebook' || urlType === 'instagram' || urlType === 'linkedin') {
      const result = await handleSocialPage(url, urlType);
      text = result.text;
      title = result.title;
    } else {
      // Regular website
      const { html, ok, status } = await smartFetch(url);

      if (!ok) {
        return NextResponse.json({ error: `לא הצלחתי לגשת לכתובת (${status}). בדקו שהקישור תקין.` }, { status: 400 });
      }

      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleMatch) title = titleMatch[1].trim();

      // Extract meta tags too
      const meta = extractMetaTags(html);
      const ogDesc = meta['og:description'] || meta['description'] || '';

      const bodyText = stripHtml(html);

      // Combine for richer context
      const parts: string[] = [];
      if (ogDesc && !bodyText.includes(ogDesc)) parts.push(`תיאור: ${ogDesc}`);
      parts.push(bodyText);
      text = parts.join('\n\n');
    }

    // Minimum content check
    if (text.length < 30) {
      // Even if we couldn't fetch content, save the URL reference
      await supabase.from('documents').insert({
        org_id,
        filename: title || new URL(url).hostname,
        file_type: 'url',
        storage_path: url,
        category: 'identity',
        parsed_text: `קישור: ${url}`,
        metadata: { source_url: url, url_type: urlType, note: 'לא הצלחנו לקרוא תוכן' },
        status: 'ready',
      });

      const platformNames: Record<UrlType, string> = {
        facebook: 'פייסבוק',
        instagram: 'אינסטגרם',
        linkedin: 'לינקדאין',
        drive_folder: 'Google Drive',
        drive_file: 'Google Drive',
        website: 'האתר',
      };

      return NextResponse.json({
        title: platformNames[urlType],
        category: 'identity',
        summary: `הקישור נשמר. ${platformNames[urlType]} חוסם קריאה אוטומטית — Goldfish ישתמש בו כהפניה.`,
        url_saved: true,
      });
    }

    // Truncate
    text = text.slice(0, 50000);

    // Classify, extract, and summarize in parallel using Gemini
    const [finalCategory, metadata, summary] = await Promise.all([
      geminiClassify(text),
      geminiExtract(text),
      geminiSummarize(text),
    ]);

    // Save as document
    const { data: doc } = await supabase
      .from('documents')
      .insert({
        org_id,
        filename: title || new URL(url).hostname,
        file_type: 'url',
        storage_path: url,
        category: finalCategory,
        parsed_text: text.slice(0, 50000),
        metadata: { ...metadata, summary, source_url: url, url_type: urlType },
        status: 'ready',
      })
      .select('id')
      .single();

    if (doc) {
      const chunks = chunkText(text);
      for (const chunk of chunks) {
        await supabase.from('document_chunks').insert({
          document_id: doc.id,
          org_id,
          content: chunk,
          metadata: { category: finalCategory, source_url: url },
        });
      }
    }

    // Update org profile with extracted data
    if (Object.keys(metadata).length > 0) {
      const { data: existing } = await supabase
        .from('org_profiles')
        .select('data')
        .eq('org_id', org_id)
        .single();

      const current = (existing?.data as Record<string, unknown>) || {};
      const merged = { ...current };

      for (const key of ['name', 'registration_number', 'founded_year', 'mission', 'focus_areas', 'target_populations', 'regions', 'beneficiaries_count', 'employees_count', 'annual_budget', 'website', 'contact_email', 'contact_phone', 'linkedin_url', 'key_people', 'partners']) {
        if (metadata[key] && !merged[key]) merged[key] = metadata[key];
      }

      // Social URLs — always update
      if (urlType === 'facebook') merged.facebook_url = url;
      if (urlType === 'instagram') merged.instagram_url = url;
      if (urlType === 'linkedin') merged.linkedin_url = url;
      if (urlType === 'website' && !merged.website) merged.website = url;

      await supabase.from('org_profiles').upsert({
        org_id,
        data: merged,
        last_updated: new Date().toISOString(),
      }, { onConflict: 'org_id' });
    }

    return NextResponse.json({
      document_id: doc?.id,
      title,
      category: finalCategory,
      summary,
      extracted_fields: metadata,
    });
  } catch (error) {
    console.error('Learn URL error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
