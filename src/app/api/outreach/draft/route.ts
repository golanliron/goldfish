import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { withAuth } from '@/lib/api-auth';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// POST /api/outreach/draft — AI writes outreach letter for a company
export const POST = withAuth(async (req, auth) => {
  const orgId = auth.orgId;
  const body = await req.json();
  const { company_id } = body;

  if (!company_id) return NextResponse.json({ error: 'חסר company_id' }, { status: 400 });

  const supabase = createAdminClient();

  // Load company + org profile in parallel
  const [companyRes, profileRes, memoryRes] = await Promise.all([
    supabase.from('companies').select('*').eq('id', company_id).single(),
    supabase.from('org_profiles').select('data').eq('org_id', orgId).single(),
    supabase.from('org_memory').select('key, value').eq('org_id', orgId).limit(30),
  ]);

  const company = companyRes.data;
  if (!company) return NextResponse.json({ error: 'חברה לא נמצאה' }, { status: 404 });

  const profileData = (profileRes.data as { data?: Record<string, unknown> } | null)?.data || {};
  const memory = (memoryRes.data || []) as { key: string; value: string }[];

  // Build org context
  const orgName = (profileData.name as string) || (profileData.org_name as string) || 'הארגון';
  const mission = (profileData.mission as string) || '';
  const populations = (profileData.populations as string[]) || [];
  const domains = (profileData.domains as string[]) || [];
  const regions = (profileData.regions as string[]) || [];

  const memoryText = memory
    .filter(f => ['mission', 'target_population', 'domain', 'region', 'impact', 'annual_budget', 'beneficiaries_count'].includes(f.key))
    .map(f => `${f.key}: ${f.value}`)
    .join('\n');

  // Build company context
  const companyName = company.name as string;
  const companyDesc = company.description as string || '';
  const companyInterests = (company.interests as string[] || []).join(', ');
  const donationAmount = company.donation_amount ? `${(company.donation_amount as number).toLocaleString()} ₪` : 'לא ידוע';
  const contactName = company.contact_name as string || '';
  const contactRole = company.contact_role as string || '';
  const approachNote = company.approach_note as string || '';
  const approachStrategy = company.approach_strategy as string || 'OPEN';

  const prompt = `אתה כותב מכתב פנייה מקצועי לחברה עסקית בשם "${companyName}" עבור הארגון "${orgName}".

נתוני הארגון:
שם: ${orgName}
מיסיון: ${mission}
אוכלוסיות: ${populations.join(', ')}
תחומי פעילות: ${domains.join(', ')}
אזורים: ${regions.join(', ')}
${memoryText ? `\nעובדות נוספות:\n${memoryText}` : ''}

נתוני החברה:
שם: ${companyName}
תיאור: ${companyDesc}
תחומי עניין CSR: ${companyInterests}
סך תרומות שנתיות: ${donationAmount}
${contactName ? `איש קשר: ${contactName}${contactRole ? ` — ${contactRole}` : ''}` : ''}
${approachNote ? `הערת גישה: ${approachNote}` : ''}
${approachStrategy === 'RFP_ONLY' ? 'הערה: החברה מקבלת בקשות רק דרך קול קורא. כתוב מכתב הבעת עניין.' : ''}

כתוב מכתב פנייה קצר (250 עד 350 מילים) שמסביר:
1. מי הארגון ומה הוא עושה (2 עד 3 משפטים עם נתונים קונקרטיים)
2. למה החברה ${companyName} מתאימה לשותפות (חיבור לתחומי העניין שלהם)
3. מה מבקשים — שיתוף פעולה, תרומה, או פגישה ראשונה
4. CTA — בקשת פגישה או שיחה

כתוב בעברית. טון מקצועי אבל אנושי. בלי סיסמאות ריקות. עם נתונים ספציפיים. בלי כוכביות או markdown. פסקאות בלבד.
התחל ישירות במכתב, ללא הקדמות.`;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 800,
    messages: [{ role: 'user', content: prompt }],
  });

  const letter = (response.content[0] as { type: string; text: string }).text || '';

  return NextResponse.json({
    letter,
    company_name: companyName,
    contact_name: contactName,
    contact_email: company.contact_email as string || '',
  });
});
