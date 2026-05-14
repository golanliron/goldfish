import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { geminiOcrPdf } from '@/lib/ai/gemini';

export const maxDuration = 300;

// Keywords that indicate a PDF is a grant document (not nav/footer/logo)
const GRANT_PDF_KEYWORDS = /מכרז|קול.קורא|הנחי|תנאי|נוהל|הזמנה|בקשה|טופס|מסמך|נספח|עזרה|הוראות|פרטים|תקנון|כללים|requirements|guidelines|application|terms|call.for|grant/i;

async function fetchGrantPageContent(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const html = await res.text();
  const pageText = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Find PDF links in the HTML
  const pdfLinks: string[] = [];
  const linkPattern = /href=["']([^"']*\.pdf[^"']*)/gi;
  for (const match of html.matchAll(linkPattern)) {
    let pdfUrl = match[1];
    if (!pdfUrl.startsWith('http')) {
      const base = new URL(url);
      pdfUrl = pdfUrl.startsWith('/') ? `${base.origin}${pdfUrl}` : `${base.origin}/${pdfUrl}`;
    }
    if (GRANT_PDF_KEYWORDS.test(pdfUrl) && !pdfLinks.includes(pdfUrl)) {
      pdfLinks.push(pdfUrl);
    }
  }

  // Try to read first relevant PDF (up to 1)
  let pdfContent = '';
  for (const pdfUrl of pdfLinks.slice(0, 1)) {
    try {
      const pdfRes = await fetch(pdfUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(15000),
      });
      if (!pdfRes.ok) continue;
      const buffer = Buffer.from(await pdfRes.arrayBuffer());
      if (buffer.length < 500 || buffer.length > 10_000_000) continue; // skip empty or huge
      const extracted = await geminiOcrPdf(buffer);
      if (extracted && extracted.length > 100) {
        pdfContent = `\n\n--- מסמך PDF מצורף ---\n${extracted.slice(0, 4000)}`;
      }
    } catch { /* PDF read failed, skip */ }
  }

  const combined = (pageText.slice(0, 8000) + pdfContent).slice(0, 8000);
  return combined;
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (auth !== 'Bearer goldfish-seed-2026') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Get all active opportunities with URL but no full_content
  const { data: opps, error } = await supabase
    .from('opportunities')
    .select('id, url')
    .eq('active', true)
    .not('url', 'is', null)
    .is('full_content', null)
    .limit(200);

  if (error || !opps) {
    return Response.json({ error: String(error) }, { status: 500 });
  }

  let updated = 0;
  let failed = 0;

  for (const opp of opps) {
    if (!opp.url) continue;
    try {
      const content = await fetchGrantPageContent(opp.url);
      if (content.length < 200) { failed++; continue; }

      const { error: updateErr } = await supabase
        .from('opportunities')
        .update({ full_content: content })
        .eq('id', opp.id);

      if (!updateErr) updated++;
      else failed++;
    } catch {
      failed++;
    }
  }

  return Response.json({ total: opps.length, updated, failed });
}
