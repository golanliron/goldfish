import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { geminiClassify, geminiExtract, geminiSummarize } from '@/lib/ai/gemini';

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
    .replace(/\s+/g, ' ')
    .trim();
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

export async function POST(request: NextRequest) {
  try {
    const { org_id, url } = await request.json();

    if (!org_id || !url) {
      return NextResponse.json({ error: 'Missing org_id or url' }, { status: 400 });
    }

    // Fetch URL content
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let text = '';
    let title = url;

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Goldfish/1.0)' },
      });
      clearTimeout(timeout);

      if (!res.ok) {
        return NextResponse.json({ error: `Failed to fetch URL: ${res.status}` }, { status: 400 });
      }

      const html = await res.text();
      // Extract title
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleMatch) title = titleMatch[1].trim();

      text = stripHtml(html);
    } catch {
      clearTimeout(timeout);
      return NextResponse.json({ error: 'Failed to fetch URL. Check the link and try again.' }, { status: 400 });
    }

    if (text.length < 50) {
      return NextResponse.json({ error: 'Could not extract meaningful content from this URL.' }, { status: 400 });
    }

    // Truncate to reasonable size
    text = text.slice(0, 50000);

    const supabase = createAdminClient();

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
        metadata: { ...metadata, summary, source_url: url },
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

      for (const key of ['name', 'registration_number', 'founded_year', 'mission', 'focus_areas', 'regions', 'beneficiaries_count', 'employees_count', 'annual_budget']) {
        if (metadata[key]) merged[key] = metadata[key];
      }

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
