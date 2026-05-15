/**
 * GET /api/opportunities/doc-gap?org_id=X&opportunity_id=Y
 *
 * Gap analysis מסמכים לקול קורא ספציפי:
 * 1. שולף את ה-research_notes של ההזדמנות (שם הסוכן שמר דרישות)
 * 2. שולף מסמכי הארגון
 * 3. מחזיר: מה יש, מה חסר, מה פג תוקף, לינקים לנספחים מהאתר
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { withAuth } from '@/lib/api-auth';
import { REQUIRED_VAULT_DOCS } from '../../../documents/vault/route';

// חילוץ דרישות מסמכים מ-research_notes של הסוכן
function extractDocRequirements(researchNotes: string | null): string[] {
  if (!researchNotes) return [];
  const required: string[] = [];

  // חיפוש תבניות ספציפיות שהסוכן כותב
  const patterns = [
    /מסמכים נדרשים[:\s]+([^\n]+)/gi,
    /נספח[:\s]+([^\n]+)/gi,
    /\[מסמך\]\s*([^\n]+)/gi,
    /נדרש[:\s]+([^\n]+)/gi,
    /required.*?:\s*([^\n]+)/gi,
  ];

  for (const pat of patterns) {
    let m;
    while ((m = pat.exec(researchNotes)) !== null) {
      required.push(m[1].trim());
    }
  }

  return [...new Set(required)];
}

// חיפוש לינקים לנספחים ריקים בתוך research_notes
function extractFormLinks(researchNotes: string | null): { label: string; url: string }[] {
  if (!researchNotes) return [];
  const links: { label: string; url: string }[] = [];
  const linkPattern = /\[נספח[:\s]([^\]]+)\]\(([^)]+)\)/g;
  const urlPattern = /https?:\/\/[^\s"'<>]+\.(pdf|docx|doc|xls|xlsx)/gi;

  let m;
  while ((m = linkPattern.exec(researchNotes)) !== null) {
    links.push({ label: m[1].trim(), url: m[2].trim() });
  }

  // fallback — URLs ישירות
  while ((m = urlPattern.exec(researchNotes)) !== null) {
    const url = m[0];
    if (!links.some(l => l.url === url)) {
      links.push({ label: url.split('/').pop() || url, url });
    }
  }

  return links;
}

function detectDocType(filename: string): string | null {
  for (const req of REQUIRED_VAULT_DOCS) {
    if (req.pattern.test(filename)) return req.key;
  }
  return null;
}

export const GET = withAuth(async (req: NextRequest, auth) => {
  const { searchParams } = new URL(req.url);
  const opportunityId = searchParams.get('opportunity_id');

  if (!opportunityId) {
    return NextResponse.json({ error: 'Missing opportunity_id' }, { status: 400 });
  }

  const supabase = createAdminClient();

  // שלוף הזדמנות + מסמכי ארגון במקביל
  const [oppRes, docsRes] = await Promise.all([
    supabase
      .from('opportunities')
      .select('title, research_notes, funder_profile')
      .eq('id', opportunityId)
      .single(),
    supabase
      .from('documents')
      .select('id, filename, category, uploaded_at, metadata')
      .eq('org_id', auth.orgId),
  ]);

  const opp = oppRes.data;
  const docs = docsRes.data || [];

  // Map existing docs to vault keys
  const existingMap = new Map<string, { id: string; filename: string; uploaded_at: string; expiry_date: string | null }>();
  for (const doc of docs) {
    const key = detectDocType(doc.filename);
    if (key) {
      const expiry = (doc.metadata as Record<string, string>)?.expiry_date || null;
      existingMap.set(key, {
        id: doc.id,
        filename: doc.filename,
        uploaded_at: doc.uploaded_at,
        expiry_date: expiry,
      });
    }
  }

  // Build checklist against standard required docs
  const checklist = REQUIRED_VAULT_DOCS.map(req => {
    const existing = existingMap.get(req.key);
    const isExpired = existing?.expiry_date
      ? new Date(existing.expiry_date) < new Date()
      : false;
    const expiresSoon = existing?.expiry_date
      ? (new Date(existing.expiry_date).getTime() - Date.now()) / 86400000 < 30
      : false;

    return {
      key: req.key,
      label: req.label,
      hint: req.hint,
      category: req.category,
      status: !existing
        ? 'missing'
        : isExpired
        ? 'expired'
        : expiresSoon
        ? 'expiring'
        : 'ok',
      doc_id: existing?.id || null,
      doc_filename: existing?.filename || null,
      expiry_date: existing?.expiry_date || null,
    };
  });

  // Dynamic requirements from research_notes
  const agentRequirements = extractDocRequirements(opp?.research_notes || null);

  // Form links found by agent
  const formLinks = extractFormLinks(opp?.research_notes || null);

  const okCount = checklist.filter(c => c.status === 'ok').length;
  const missingCount = checklist.filter(c => c.status === 'missing').length;
  const expiredCount = checklist.filter(c => c.status === 'expired').length;

  return NextResponse.json({
    opportunity_title: opp?.title || '',
    checklist,
    agent_requirements: agentRequirements,
    form_links: formLinks,
    summary: {
      ok: okCount,
      missing: missingCount,
      expired: expiredCount,
      total: checklist.length,
    },
  });
});
