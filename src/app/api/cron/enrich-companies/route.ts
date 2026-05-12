import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createAdminClient } from '@/lib/supabase/admin';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Runs daily — picks companies missing data, fetches their website, extracts CSR/contact info with AI
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results = await enrichCompanies();
  return Response.json(results);
}

// ============================================================
// CONTACT EXTRACTION — phones & emails from page text
// ============================================================
const PHONE_RE = /(?:טלפון|טל|phone|tel)[\s:]*([0-9\-\s()]{7,15})|(?<!\d)(0[2-9]\d?[-\s]?\d{3}[-\s]?\d{4})(?!\d)|(?<!\d)(\+972[\-\s]?\d[\-\s]?\d{3}[\-\s]?\d{4})(?!\d)/g;
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const URL_RE = /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b[-a-zA-Z0-9()@:%_+.~#?&/=]*/g;

function extractPhones(text: string): string[] {
  const phones: string[] = [];
  for (const m of text.matchAll(PHONE_RE)) {
    const phone = (m[1] || m[2] || m[3] || '').trim().replace(/[\s()]/g, '');
    if (phone && phone.length >= 7 && !phones.includes(phone)) phones.push(phone);
  }
  return phones.slice(0, 3);
}

function extractEmails(text: string): string[] {
  const skip = new Set(['example@example.com', 'info@info.com', 'test@test.com', 'email@example.com']);
  const emails: string[] = [];
  for (const m of text.matchAll(EMAIL_RE)) {
    const email = m[0].toLowerCase();
    if (!skip.has(email) && !emails.includes(email)) emails.push(email);
  }
  return emails.slice(0, 3);
}

// ============================================================
// DOMAIN GUESSING — try to find a company's website
// ============================================================
const DOMAIN_SUFFIXES = ['.co.il', '.com', '.org.il', '.org', '.net'];

function guessDomainsFromName(name: string): string[] {
  // Try to build likely domain from Hebrew company name
  // First, check if name contains English words
  const englishWords = name.match(/[a-zA-Z]+/g);
  if (englishWords && englishWords.length > 0) {
    const slug = englishWords.join('').toLowerCase();
    return DOMAIN_SUFFIXES.map(s => `https://www.${slug}${s}`);
  }

  // For Hebrew-only names, we can't reliably guess domain
  return [];
}

async function findWebsite(name: string): Promise<string | null> {
  const guesses = guessDomainsFromName(name);
  for (const url of guesses) {
    try {
      const res = await fetch(url, {
        method: 'HEAD',
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(5000),
        redirect: 'follow',
      });
      if (res.ok || res.status === 301 || res.status === 302) {
        return res.url || url;
      }
    } catch { /* domain doesn't exist */ }
  }
  return null;
}

// ============================================================
// AI ENRICHMENT — extract CSR info from website HTML
// ============================================================
interface EnrichmentResult {
  description?: string;
  website?: string;
  contact_email?: string;
  contact_phone?: string;
  contact_name?: string;
  contact_role?: string;
  interests?: string[];
  csr_rank?: number;
}

async function enrichFromWebsite(html: string, companyName: string): Promise<EnrichmentResult> {
  // First try regex extraction for contact info
  const text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 15000);

  const phones = extractPhones(text);
  const emails = extractEmails(text);

  // Then use AI for description and CSR assessment
  try {
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      system: `אתה מנתח אתרי חברות ומחלץ מידע על אחריות חברתית (CSR) ותרומות.
החזר JSON בלבד:
{
  "description": "תיאור קצר של החברה ופעילות ה-CSR שלה (עד 200 תווים, עברית)",
  "interests": ["תחומי עניין חברתיים: education, youth, welfare, health, environment, culture, technology, community, employment, sport"],
  "csr_rank": 1-10,
  "contact_name": "שם איש קשר CSR אם מופיע",
  "contact_role": "תפקיד"
}

csr_rank:
- 1-3: אין מידע על CSR / רק שיווקי
- 4-6: יש פעילות CSR בסיסית (תרומות, מתנדבות)
- 7-10: CSR משמעותי, תוכניות מובנות, שותפויות עם עמותות

אם אין מידע מספיק — החזר description קצר ו-csr_rank: 1.`,
      messages: [{
        role: 'user',
        content: `חברה: ${companyName}\n\nתוכן האתר:\n${text.slice(0, 8000)}`,
      }],
      max_tokens: 500,
    });

    const aiText = res.content[0].type === 'text' ? res.content[0].text : '{}';
    const jsonMatch = aiText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        description: parsed.description || undefined,
        interests: parsed.interests || undefined,
        csr_rank: parsed.csr_rank || undefined,
        contact_name: parsed.contact_name || undefined,
        contact_role: parsed.contact_role || undefined,
        contact_email: emails[0] || undefined,
        contact_phone: phones[0] || undefined,
      };
    }
  } catch { /* AI extraction failed */ }

  // Fallback: just return extracted contact info
  return {
    contact_email: emails[0] || undefined,
    contact_phone: phones[0] || undefined,
  };
}

// ============================================================
// MAIN ENRICHMENT LOGIC
// ============================================================
async function enrichCompanies() {
  const supabase = createAdminClient();
  let enriched = 0;
  let websitesFound = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Step 1: Get companies that need enrichment
  // Priority: companies with website but no description, then companies without website
  const { data: withWebsite } = await supabase
    .from('companies')
    .select('id, name, website, description, contact_email, contact_phone, interests, csr_rank')
    .eq('company_type', 'business')
    .eq('active', true)
    .not('website', 'is', null)
    .or('description.is.null,contact_email.is.null')
    .limit(15);

  const { data: withoutWebsite } = await supabase
    .from('companies')
    .select('id, name, website, description, contact_email, contact_phone, interests, csr_rank')
    .eq('company_type', 'business')
    .eq('active', true)
    .is('website', null)
    .limit(10);

  const companies = [...(withWebsite || []), ...(withoutWebsite || [])];

  for (const company of companies) {
    try {
      let website = company.website;

      // Step 2: If no website, try to find one
      if (!website) {
        website = await findWebsite(company.name);
        if (website) {
          websitesFound++;
        } else {
          skipped++;
          continue;
        }
      }

      // Step 3: Fetch the website
      const res = await fetch(website, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept-Language': 'he-IL,he;q=0.9,en;q=0.8',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        skipped++;
        continue;
      }

      const html = await res.text();

      // Step 4: Extract info with AI + regex
      const result = await enrichFromWebsite(html, company.name);

      // Step 5: Build update — only fill in missing fields
      const update: Record<string, unknown> = {};
      if (!company.website && website) update.website = website;
      if (!company.description && result.description) update.description = result.description;
      if (!company.contact_email && result.contact_email) update.contact_email = result.contact_email;
      if (!company.contact_phone && result.contact_phone) update.contact_phone = result.contact_phone;
      if (result.contact_name) update.contact_name = result.contact_name;
      if (result.contact_role) update.contact_role = result.contact_role;
      if (result.interests && result.interests.length > 0 && (!company.interests || company.interests.length === 0)) {
        update.interests = result.interests;
      }
      if (result.csr_rank && (!company.csr_rank || company.csr_rank === 0)) {
        update.csr_rank = result.csr_rank;
      }

      if (Object.keys(update).length > 0) {
        update.updated_at = new Date().toISOString();
        const { error } = await supabase
          .from('companies')
          .update(update)
          .eq('id', company.id);

        if (!error) {
          enriched++;
        } else {
          errors.push(`${company.name}: ${error.message}`);
        }
      } else {
        skipped++;
      }
    } catch (e) {
      errors.push(`${company.name}: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  }

  // Log
  try {
    await supabase.from('scan_logs').insert({
      new_items: enriched,
      skipped,
      errors: errors.length > 0 ? errors : null,
      sources_scanned: companies.length,
    });
  } catch { /* table might not exist */ }

  return {
    processed: companies.length,
    enriched,
    websites_found: websitesFound,
    skipped,
    errors,
    timestamp: new Date().toISOString(),
  };
}
