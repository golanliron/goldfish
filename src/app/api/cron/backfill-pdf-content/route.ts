/**
 * GET /api/cron/backfill-pdf-content?batch=10
 *
 * For every active opportunity whose `url` points directly to a PDF
 * and whose `full_content` is empty:
 *  1. Download the PDF from the external URL
 *  2. Extract text via pdf-parse (text layer) → geminiOcrPdf (scanned fallback)
 *  3. Save extracted text to opportunities.full_content
 *
 * This allows Goldfish to read eligibility conditions, thresholds, and deadlines
 * from the actual grant document — not just its landing page.
 */

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { geminiOcrPdf } from '@/lib/ai/gemini';

export const maxDuration = 300;

const MAX_PDF_BYTES = 15_000_000; // 15 MB — skip huge files
const MIN_TEXT_LENGTH = 100;       // skip near-empty extractions
const CONTENT_CAP = 12_000;        // chars stored in full_content

/** Download a URL and return its bytes, or null on failure */
async function fetchBytes(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Goldfish-Bot/1.0)' },
      signal: AbortSignal.timeout(20_000),
      redirect: 'follow',
    });
    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') || '';
    const contentLength = parseInt(res.headers.get('content-length') || '0', 10);

    // Reject if server says it's not a PDF (and it's not ambiguous)
    if (contentType && !contentType.includes('pdf') && !contentType.includes('octet-stream')) {
      return null;
    }
    if (contentLength > MAX_PDF_BYTES) return null;

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_PDF_BYTES) return null;
    return buf;
  } catch {
    return null;
  }
}

/** Extract text from PDF buffer: pdf-parse first, Gemini OCR as fallback */
async function extractPdfText(buffer: Buffer): Promise<string> {
  // Primary: text layer (fast, no API cost)
  try {
    const pdfParse = (await import('pdf-parse')).default;
    const result = await pdfParse(buffer);
    if (result.text && result.text.trim().length >= MIN_TEXT_LENGTH) {
      return result.text.trim();
    }
  } catch { /* fall through */ }

  // Fallback: Gemini multimodal OCR (handles scanned / image-only PDFs)
  try {
    const text = await geminiOcrPdf(buffer);
    if (text && text.trim().length >= MIN_TEXT_LENGTH) return text.trim();
  } catch { /* give up */ }

  return '';
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const batchSize = Math.min(20, parseInt(url.searchParams.get('batch') || '10', 10));
  const supabase = createAdminClient();

  // Find active opportunities with a direct PDF URL but no full_content yet
  const { data: opps, error } = await supabase
    .from('opportunities')
    .select('id, title, funder, url')
    .eq('active', true)
    .ilike('url', '%.pdf%')
    .or('full_content.is.null,full_content.eq.')
    .not('url', 'is', null)
    .order('scraped_at', { ascending: false })
    .limit(batchSize);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  if (!opps || opps.length === 0) {
    return NextResponse.json({ ok: true, message: 'No PDF opportunities to backfill', processed: 0 });
  }

  let extracted = 0;
  let skipped = 0;
  const results: { title: string; chars: number | null; status: string }[] = [];

  for (const opp of opps) {
    const pdfUrl = opp.url as string;
    try {
      const buffer = await fetchBytes(pdfUrl);
      if (!buffer) {
        skipped++;
        results.push({ title: opp.title, chars: null, status: 'fetch_failed' });
        continue;
      }

      const text = await extractPdfText(buffer);
      if (!text) {
        skipped++;
        results.push({ title: opp.title, chars: null, status: 'no_text' });
        continue;
      }

      const content = text.slice(0, CONTENT_CAP);
      await supabase
        .from('opportunities')
        .update({ full_content: content, last_seen_at: new Date().toISOString() })
        .eq('id', opp.id);

      extracted++;
      results.push({ title: opp.title, chars: content.length, status: 'ok' });

      // Brief pause — be polite to external servers
      await new Promise(r => setTimeout(r, 500));
    } catch {
      skipped++;
      results.push({ title: opp.title, chars: null, status: 'error' });
    }
  }

  return NextResponse.json({
    ok: true,
    processed: opps.length,
    extracted,
    skipped,
    results,
  });
}
