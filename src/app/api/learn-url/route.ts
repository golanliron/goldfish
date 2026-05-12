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

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        console.error(`Drive API ${res.status}: ${errBody.slice(0, 500)}`);
      }

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

          // Classify with Gemini if we have text
          let fileCategory = 'other';
          if (status === 'ready' && parsedText.length > 50) {
            try {
              fileCategory = await geminiClassify(parsedText.slice(0, 5000));
            } catch { /* keep 'other' */ }
          }

          await supabase.from('documents').insert({
            org_id: orgId,
            filename: file.name,
            file_type: file.mimeType?.includes('pdf') ? 'pdf' :
                       file.mimeType?.includes('document') ? 'docx' :
                       file.mimeType?.includes('spreadsheet') ? 'xlsx' :
                       file.mimeType?.includes('presentation') ? 'pptx' : 'other',
            storage_path: `drive://${file.id}`,
            category: fileCategory,
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
  } else {
    console.error('GOOGLE_API_KEY not set — cannot read Drive folders');
  }

  const text = filesFound > 0
    ? `תיקיית Google Drive מחוברת.\nFolder ID: ${folderId}\nקבצים שנמצאו (${filesFound}):\n${fileNames.join('\n')}`
    : `קישור Google Drive נשמר: ${url}\nFolder ID: ${folderId}\nלא הצלחתי לגשת לקבצים. ודאו שהתיקייה משותפת (Anyone with the link).`;

  return { text, title: `Google Drive (${filesFound} קבצים)`, filesFound };
}

// ===== Facebook Graph API Handler =====

async function fetchFacebookPageInfo(url: string): Promise<{ text: string; title: string } | null> {
  const token = process.env.FACEBOOK_ACCESS_TOKEN;
  if (!token) return null;

  // Extract page name/id from URL
  const pageMatch = url.match(/facebook\.com\/([^/?#]+)/i);
  if (!pageMatch) return null;
  const pageId = pageMatch[1];

  try {
    const fields = 'name,about,description,category,fan_count,location,website,emails,founded';
    const apiUrl = `https://graph.facebook.com/v18.0/${pageId}?fields=${fields}&access_token=${token}`;
    const res = await fetch(apiUrl);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.error) return null;

    const parts: string[] = [];
    if (data.name) parts.push(`שם: ${data.name}`);
    if (data.about) parts.push(`אודות: ${data.about}`);
    if (data.description) parts.push(`תיאור: ${data.description}`);
    if (data.category) parts.push(`קטגוריה: ${data.category}`);
    if (data.fan_count) parts.push(`עוקבים: ${data.fan_count}`);
    if (data.website) parts.push(`אתר: ${data.website}`);
    if (data.emails?.length) parts.push(`מייל: ${data.emails.join(', ')}`);
    if (data.founded) parts.push(`נוסד: ${data.founded}`);
    if (data.location) {
      const loc = data.location;
      const locStr = [loc.city, loc.country].filter(Boolean).join(', ');
      if (locStr) parts.push(`מיקום: ${locStr}`);
    }

    return { text: parts.join('\n'), title: data.name || pageId };
  } catch {
    return null;
  }
}

// ===== Social Page Handler (Facebook/Instagram/LinkedIn) =====

async function handleSocialPage(
  url: string,
  urlType: UrlType
): Promise<{ text: string; title: string; blocked: boolean }> {
  // Try Facebook Graph API first (most reliable for Facebook)
  if (urlType === 'facebook') {
    const graphResult = await fetchFacebookPageInfo(url);
    if (graphResult && graphResult.text.length > 30) {
      return { ...graphResult, blocked: false };
    }
  }

  // Try regular fetch — works for LinkedIn, sometimes for others
  const { html, ok } = await smartFetch(url);

  if (ok && html.length > 100) {
    // Extract meta tags — social pages put the good info in OG tags
    const meta = extractMetaTags(html);
    const ogTitle = meta['og:title'] || '';
    const ogDesc = meta['og:description'] || meta['description'] || '';
    const ogType = meta['og:type'] || '';
    const bodyText = stripHtml(html);

    const parts: string[] = [];
    if (ogTitle) parts.push(`שם: ${ogTitle}`);
    if (ogDesc) parts.push(`תיאור: ${ogDesc}`);
    if (ogType) parts.push(`סוג: ${ogType}`);
    parts.push(`\nתוכן העמוד:\n${bodyText}`);

    return { text: parts.join('\n'), title: ogTitle || url, blocked: false };
  }

  // Blocked — return empty text so caller can handle gracefully
  return { text: '', title: url, blocked: true };
}

// ===== Route Config =====

export const maxDuration = 60;

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
      // Delegate to the dedicated Drive connect API which downloads and parses each file
      const origin = request.nextUrl.origin;
      const driveRes = await fetch(`${origin}/api/drive/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id, drive_url: url }),
      });
      const driveData = await driveRes.json();
      return NextResponse.json({
        title: `Google Drive (${driveData.files_found || 0} קבצים)`,
        category: 'other',
        summary: driveData.message || 'Drive חובר',
        ...driveData,
      });
    } else if (urlType === 'facebook' || urlType === 'instagram' || urlType === 'linkedin') {
      const result = await handleSocialPage(url, urlType);
      text = result.text;
      title = result.title;

      // If blocked — save URL reference and return clear message (no fabrication)
      if (result.blocked || text.length < 30) {
        const platformName = urlType === 'facebook' ? 'פייסבוק' :
                             urlType === 'instagram' ? 'אינסטגרם' : 'לינקדאין';

        // Save just the URL so Goldfish knows it exists
        await supabase.from('documents').insert({
          org_id,
          filename: `עמוד ${platformName}`,
          file_type: 'url',
          storage_path: url,
          category: 'identity',
          parsed_text: `קישור ${platformName}: ${url}`,
          metadata: { source_url: url, url_type: urlType, blocked: true },
          status: 'ready',
        });

        // Save URL in org profile
        const { data: existingProfile } = await supabase.from('org_profiles').select('data').eq('org_id', org_id).single();
        const profileData = (existingProfile?.data as Record<string, unknown>) || {};
        if (urlType === 'facebook') profileData.facebook_url = url;
        if (urlType === 'instagram') profileData.instagram_url = url;
        if (urlType === 'linkedin') profileData.linkedin_url = url;
        await supabase.from('org_profiles').upsert({ org_id, data: profileData, last_updated: new Date().toISOString() }, { onConflict: 'org_id' });

        return NextResponse.json({
          title: `עמוד ${platformName}`,
          category: 'identity',
          summary: `הקישור נשמר. ${platformName} חוסמת קריאה אוטומטית — כדי שאוכל לקרוא את תוכן הדף, העתיקי את תיאור הארגון מהעמוד והדביקי אותו ישירות בצ'אט, או העלי PDF עם תיאור הארגון.`,
          url_saved: true,
          blocked: true,
        });
      }
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

    // Minimum content check (for regular websites)
    if (text.length < 30) {
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
      return NextResponse.json({
        title: title || url,
        category: 'identity',
        summary: `לא הצלחתי לקרוא את תוכן האתר. הקישור נשמר כהפניה.`,
        url_saved: true,
      });
    }

    // Truncate
    text = text.slice(0, 50000);

    // Get org name to check content ownership
    const { data: orgData } = await supabase.from('organizations').select('name').eq('id', org_id).single();
    const orgName = orgData?.name || '';

    // Classify, extract, and summarize in parallel using Gemini
    const [finalCategory, metadata, summary] = await Promise.all([
      geminiClassify(text),
      geminiExtract(text, undefined, orgName),
      geminiSummarize(text),
    ]);

    // ===== Content ownership check =====
    // If this URL is about a different organization (funder/partner), save as 'grant'
    // and don't pollute the org profile with their data
    const isOwnContent = urlType === 'facebook' || urlType === 'instagram' || urlType === 'linkedin' ||
      (orgName && text.toLowerCase().includes(orgName.toLowerCase())) ||
      (metadata.name && typeof metadata.name === 'string' && orgName &&
        metadata.name.toLowerCase().includes(orgName.toLowerCase().split(' ')[0]));

    const effectiveCategory = isOwnContent ? finalCategory : 'grant';

    // Save as document
    const { data: doc } = await supabase
      .from('documents')
      .insert({
        org_id,
        filename: title || new URL(url).hostname,
        file_type: 'url',
        storage_path: url,
        category: effectiveCategory,
        parsed_text: text.slice(0, 50000),
        metadata: { ...metadata, summary, source_url: url, url_type: urlType, is_own_content: isOwnContent },
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
          metadata: { category: effectiveCategory, source_url: url },
        });
      }
    }

    // Update org profile ONLY if this is the org's own content
    if (isOwnContent && Object.keys(metadata).length > 0) {
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
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Learn URL error:', msg, error);
    return NextResponse.json({ error: `שגיאה בקריאת הקישור: ${msg.slice(0, 200)}` }, { status: 500 });
  }
}
