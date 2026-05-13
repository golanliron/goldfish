import Anthropic from '@anthropic-ai/sdk';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildOrgContext } from '@/lib/ai/fishgold';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SCAN_KEYWORDS = ['קול קורא', 'קולות קוראים', 'הזדמנויות', 'מענק', 'מענקים', 'מימון', 'תמצא לי', 'יש משהו בשבילי', 'סרוק', 'חפש לי'];
const COMPANY_KEYWORDS = ['חברות', 'חברה', 'תורמים', 'תורם', 'עסקים', 'קרנות', 'CSR', 'שותפות', 'שותפויות', 'מי תורם', 'למי לפנות', 'פנייה', 'מייל לחברה', 'נסח מייל', 'כתוב מייל', 'תרומות', 'גיוס מעסקים'];

function normalizeApostrophes(text: string): string {
  return text
    .replace(/[\u05F3\u2018\u2019\u201A\u0060\u00B4]/g, "'")
    .replace(/[\u05F4\u201C\u201D\u201E]/g, '"');
}

export async function scanOpportunities(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string,
  profileData: Record<string, unknown> | null,
  orgName: string | null,
  userMessage?: string
): Promise<string> {
  if (!profileData || Object.keys(profileData).length < 3) {
    return '';
  }

  const forceRescan = userMessage ? SCAN_KEYWORDS.some(kw => userMessage.includes(kw)) : false;

  if (!forceRescan) {
    const { data: recentMatches } = await supabase
      .from('matches')
      .select('id')
      .eq('org_id', orgId)
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .limit(1);

    if (recentMatches && recentMatches.length > 0) {
      const { data: matches } = await supabase
        .from('matches')
        .select('score, reasoning, opportunity_id')
        .eq('org_id', orgId)
        .gte('score', 70)
        .order('score', { ascending: false })
        .limit(5);

      if (matches && matches.length > 0) {
        const oppIds = matches.map(m => m.opportunity_id);
        const { data: grants } = await supabase
          .from('opportunities')
          .select('id, title, deadline, funder, url, description, amount_max, contact_info')
          .in('id', oppIds);

        const grantsMap = new Map((grants || []).map(g => [g.id, g]));

        const lines = matches.map((m) => {
          const opp = grantsMap.get(m.opportunity_id);
          if (!opp) return null;
          return `- **${opp.title}** (ציון: ${Math.round(m.score / 10)}/10)${opp.deadline ? ` | דדליין: ${opp.deadline}` : ''}${opp.funder ? ` | ${opp.funder}` : ''}${opp.amount_max ? ` | עד ${(opp.amount_max / 1000).toFixed(0)}K ש"ח` : ''}${opp.url ? ` | לינק: ${opp.url}` : ''}${opp.contact_info ? ` | ${opp.contact_info}` : ''}\n  ${m.reasoning}${opp.description ? `\n  תיאור: ${opp.description.slice(0, 200)}` : ''}`;
        }).filter(Boolean);

        if (lines.length > 0) {
          return `\n\n===== הזדמנויות מתאימות =====\nמצאתי ${lines.length} קולות קוראים שמתאימים:\n${lines.join('\n')}`;
        }
      }
      return '';
    }
  }

  try {
    const today = new Date().toISOString().split('T')[0];
    const { data: opportunities, error: oppError } = await supabase
      .from('opportunities')
      .select('id, title, description, deadline, categories, target_populations, funder, url, contact_info')
      .eq('active', true)
      .or(`deadline.is.null,deadline.gte.${today}`)
      .order('deadline', { ascending: true, nullsFirst: false })
      .limit(60);

    if (oppError) {
      console.error('Opportunities query error:', oppError);
      return '';
    }
    if (!opportunities || opportunities.length === 0) {
      return '';
    }

    const focusAreas = (profileData.focus_areas as string[]) || [];
    const mission = (profileData.mission as string) || '';
    const orgText = [...focusAreas, mission].join(' ');

    const catKeywords: Record<string, string> = {
      education: 'חינוך|לימוד|נשירה|מלגות|הכשרה',
      welfare: 'רווחה|סיכון|ליווי|נוער|צעירים',
      community: 'קהילה|חברה|התנדבות',
      employment: 'תעסוקה|עבודה|הכוונה',
      health: 'בריאות|נפשי|רפואה',
    };

    const orgCats = Object.entries(catKeywords)
      .filter(([, pattern]) => new RegExp(pattern).test(orgText))
      .map(([cat]) => cat);

    const filtered = opportunities.filter((opp) => {
      if (!opp.categories?.length) return true;
      return opp.categories.some((c: string) => orgCats.includes(c));
    }).slice(0, 15);

    if (filtered.length === 0) return '';

    const { data: memories } = await supabase
      .from('org_memory')
      .select('key, value')
      .eq('org_id', orgId)
      .limit(30);
    const orgContext = buildOrgContext(profileData, orgName, memories || undefined);
    const oppList = filtered.map((o, i) =>
      `${i + 1}. "${o.title}" | קטגוריות: ${o.categories?.join(', ') || '-'} | אוכלוסיות: ${o.target_populations?.join(', ') || '-'} | דדליין: ${o.deadline || '-'} | גוף: ${o.funder || '-'}${o.description ? ` | תיאור: ${o.description.slice(0, 150)}` : ''}`
    ).join('\n');

    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      system: `אתה מומחה גיוס משאבים ישראלי. דרג כל קול קורא 1-10 לפי התאמה ספציפית לארגון.
קרא בעיון את נתוני הליבה של הארגון וודא שאתה מבין מה הם באמת עושים לפני שאתה נותן ציון.
קריטריונים: תחום פעילות (30%), אוכלוסיית יעד (30%), גיאוגרפיה (25%), גודל ארגון (15%).

כללים קריטיים:
- קרנות וגופים שפועלים מחוץ לישראל ולא מממנים פעילות בישראל = ציון 1-2 מקסימום.
- אם הקול קורא מיועד לאוכלוסייה אחרת לגמרי = ציון 1-3.
- "education" או "welfare" כקטגוריה רחבה לא מספיקה. חייב חפיפה ממשית בתחום הספציפי.
- קול קורא בתחום שונה מהותית (חקלאות, מים, סביבה, מדע, תשתיות, בנייה, ארכיטקטורה) = ציון 1-3.
- קול קורא למוסדות חינוך פיזיים (בנייה, שיפוץ, תכנון) כשהארגון מספק ליווי ושירותים = ציון 1-3.
- ציון 8+ רק כשיש התאמה ממשית בתחום + אוכלוסייה + גיאוגרפיה + סוג פעילות.
- שאל את עצמך: האם הארגון הזה באמת יכול להגיש ולנצח? אם לא — ציון נמוך.
החזר JSON בלבד: [{"index": 1, "score": 8, "reasoning": "נימוק קצר"}]
רק ציון 7 ומעלה. אם אין — מערך ריק [].`,
      messages: [{ role: 'user', content: `${orgContext}\n\nקולות קוראים:\n${oppList}` }],
      max_tokens: 1500,
    });

    const raw = res.content[0].type === 'text' ? res.content[0].text : '[]';
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, raw];
    let scored: { index: number; score: number; reasoning: string }[] = [];
    try {
      scored = JSON.parse(jsonMatch[1]!.trim());
    } catch {
      return '';
    }

    const goodMatches = scored.filter((s) => s.score >= 7);
    if (goodMatches.length === 0) return '';

    const lines: string[] = [];
    for (const item of goodMatches.slice(0, 5)) {
      const opp = filtered[item.index - 1];
      if (!opp) continue;

      lines.push(`- **${opp.title}** (ציון: ${item.score}/10)${opp.deadline ? ` | דדליין: ${opp.deadline}` : ''}${opp.funder ? ` | ${opp.funder}` : ''}${opp.url ? ` | לינק: ${opp.url}` : ''}${opp.contact_info ? ` | ${opp.contact_info}` : ''}\n  ${item.reasoning}${opp.description ? `\n  תיאור: ${opp.description.slice(0, 200)}` : ''}`);

      const { error: matchErr } = await supabase.from('matches').upsert(
        { org_id: orgId, opportunity_id: opp.id, score: item.score * 10, reasoning: item.reasoning, status: 'new' },
        { onConflict: 'org_id,opportunity_id', ignoreDuplicates: false }
      );
      if (matchErr) console.error('Match save error:', matchErr.message);
    }

    return `\n\n===== הזדמנויות מתאימות =====\nסרקתי ${filtered.length} קולות קוראים פתוחים. מצאתי ${lines.length} שמתאימים:\n${lines.join('\n')}`;
  } catch (e) {
    console.error('Scan error:', e);
    return '';
  }
}

async function findSpecificCompany(
  supabase: ReturnType<typeof createAdminClient>,
  userMessage: string
): Promise<string | null> {
  if (userMessage.length < 3) return null;

  const normalizedMessage = normalizeApostrophes(userMessage);

  const stopWords = new Set(['של', 'את', 'על', 'עם', 'אני', 'הוא', 'היא', 'יש', 'אין', 'מה', 'איך', 'למה', 'כמה', 'איפה', 'חברה', 'חברת', 'קרן', 'ארגון', 'עמותה', 'תורם', 'תורמים', 'מידע', 'פרטים', 'לגבי', 'בנוגע', 'תספר', 'ספר', 'מכיר', 'מכירה', 'יודע', 'תגיד', 'בבקשה', 'לי', 'אם', 'גם', 'כל', 'אז', 'רק', 'עוד', 'כן', 'לא', 'או', 'הם', 'זה', 'זאת', 'היה', 'אבל', 'כמו', 'בין', 'אחרי', 'לפני', 'כדי', 'שלי', 'שלך', 'שלו', 'שלה', 'שלנו', 'שלהם']);
  const msgWords = normalizedMessage.split(/\s+/).filter(w => w.length >= 2 && !stopWords.has(w));
  if (msgWords.length === 0) return null;

  const selectFields = 'name, company_type, description, interests, donation_amount, contact_name, contact_email, contact_phone, contact_role, website';
  const matches: { name: string; company_type: string; description: string | null; interests: string[] | null; donation_amount: number | null; contact_name: string | null; contact_email: string | null; contact_phone: string | null; contact_role: string | null; website: string | null }[] = [];

  async function searchName(phrase: string, limit = 5) {
    const { data } = await supabase
      .from('companies')
      .select(selectFields)
      .eq('active', true)
      .ilike('name', `%${phrase}%`)
      .limit(limit);
    if (data?.length) return data;
    const stripped = phrase.replace(/['\u05F3\u2018\u2019`\u00B4]/g, '');
    if (stripped !== phrase) {
      const { data: d2 } = await supabase
        .from('companies')
        .select(selectFields)
        .eq('active', true)
        .ilike('name', `%${stripped}%`)
        .limit(limit);
      if (d2?.length) return d2;
    }
    return null;
  }

  const allWords = normalizedMessage.split(/\s+/).filter(w => w.length >= 2);
  for (let len = Math.min(allWords.length, 4); len >= 2 && matches.length === 0; len--) {
    for (let i = 0; i <= allWords.length - len && matches.length === 0; i++) {
      const phrase = allWords.slice(i, i + len).join(' ');
      if (phrase.length < 4) continue;
      const found = await searchName(phrase);
      if (found) matches.push(...found);
    }
  }

  for (let i = 0; i < msgWords.length - 1 && matches.length === 0; i++) {
    const phrase = `${msgWords[i]} ${msgWords[i + 1]}`;
    const found = await searchName(phrase);
    if (found) matches.push(...found);
  }

  if (matches.length === 0) {
    for (const word of msgWords) {
      if (word.length < 2) continue;
      const found = await searchName(word, 8);
      if (found?.length) {
        matches.push(...found);
        if (found.length > 3 && msgWords.length > 1) {
          const otherWords = msgWords.filter(w => w !== word && w.length >= 2);
          for (const other of otherWords) {
            const normalOther = normalizeApostrophes(other);
            const strippedOther = normalOther.replace(/'/g, '');
            const narrowed = found.filter(c => {
              const normName = normalizeApostrophes(c.name);
              const normDesc = normalizeApostrophes(c.description || '');
              return normName.includes(normalOther) || normName.includes(strippedOther) ||
                normDesc.includes(normalOther) || normDesc.includes(strippedOther);
            });
            if (narrowed.length > 0) {
              matches.length = 0;
              matches.push(...narrowed);
              break;
            }
          }
        }
        break;
      }
    }
  }

  if (matches.length === 0) {
    for (const word of msgWords) {
      if (word.length < 3) continue;
      const stripped = word.replace(/['\u05F3\u2018\u2019`\u00B4]/g, '');
      const { data } = await supabase
        .from('companies')
        .select(selectFields)
        .eq('active', true)
        .or(`name.ilike.%${word}%,description.ilike.%${word}%${stripped !== word ? `,name.ilike.%${stripped}%,description.ilike.%${stripped}%` : ''}`)
        .limit(5);
      if (data?.length) {
        matches.push(...data);
        break;
      }
    }
  }

  if (matches.length === 0) return null;

  const seen = new Set<string>();
  const unique = matches.filter(c => {
    if (seen.has(c.name)) return false;
    seen.add(c.name);
    return true;
  });

  const lines = unique.slice(0, 5).map(c => {
    const parts = [`[חברה מהמאגר שלך] "${c.name}" | סוג: ${c.company_type}`];
    if (c.description) parts.push(`תיאור: ${c.description.slice(0, 300)}`);
    if (c.interests?.length) parts.push(`תחומי עניין: ${c.interests.join(', ')}`);
    if (c.donation_amount) parts.push(`תרומות: ${(c.donation_amount / 1000).toFixed(0)}K ש"ח`);
    if (c.contact_name) parts.push(`איש קשר: ${c.contact_name}${c.contact_role ? ` (${c.contact_role})` : ''}`);
    if (c.contact_email) parts.push(`מייל: ${c.contact_email}`);
    if (c.contact_phone) parts.push(`טלפון: ${c.contact_phone}`);
    if (c.website) parts.push(`אתר: ${c.website}`);
    return parts.join(' | ');
  });

  return `\n\n===== חברות שנמצאו בהודעה =====\n${lines.join('\n')}`;
}

export async function scanCompanies(
  supabase: ReturnType<typeof createAdminClient>,
  profileData: Record<string, unknown> | null,
  orgName: string | null,
  userMessage: string
): Promise<string> {
  const specificCompanyMatch = await findSpecificCompany(supabase, userMessage);
  if (specificCompanyMatch) return specificCompanyMatch;

  if (!COMPANY_KEYWORDS.some(kw => userMessage.includes(kw))) return '';

  try {
    const { data: companies, error } = await supabase
      .from('companies')
      .select('id, name, company_type, description, interests, donation_amount, csr_rank, contact_name, contact_email, contact_phone, contact_role, website')
      .eq('active', true)
      .limit(1100);

    if (error || !companies?.length) return '';

    if (profileData && Object.keys(profileData).length >= 3) {
      const focusAreas = (profileData.focus_areas as string[]) || [];
      const mission = (profileData.mission as string) || '';
      const regions = (profileData.regions as string[]) || [];
      const orgText = [...focusAreas, mission, ...regions].join(' ').toLowerCase();

      const candidates = companies.filter((c) => {
        if (!c.interests?.length && !c.description) return false;
        const companyText = [...(c.interests || []), c.description || ''].join(' ').toLowerCase();
        const orgWords = orgText.split(/\s+/).filter(w => w.length > 2);
        return orgWords.some(w => companyText.includes(w)) || c.csr_rank;
      });

      const sorted = candidates.sort((a, b) => {
        if (a.company_type === 'fund' && b.company_type !== 'fund') return -1;
        if (b.company_type === 'fund' && a.company_type !== 'fund') return 1;
        return (a.csr_rank || 999) - (b.csr_rank || 999);
      }).slice(0, 20);

      if (sorted.length === 0) {
        return `\n\n===== חברות וארגונים =====\nיש לי ${companies.length} חברות וארגונים במאגר, אבל לא מצאתי התאמות ברורות לפרופיל שלכם. תשאלו על סוג ספציפי (קרנות, עסקים, חברות ציבוריות) ואמצא.`;
      }

      const orgContext = buildOrgContext(profileData, orgName);
      const compList = sorted.map((c, i) =>
        `${i + 1}. "${c.name}" | סוג: ${c.company_type} | תחומי עניין: ${c.interests?.join(', ') || '-'} | תרומות: ${c.donation_amount ? `${(c.donation_amount / 1000).toFixed(0)}K` : 'לא ידוע'} | CSR: ${c.csr_rank || 'לא ידוע'}${c.description ? ` | תיאור: ${c.description.slice(0, 150)}` : ''}`
      ).join('\n');

      const res = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        system: `אתה מומחה גיוס משאבים ישראלי. דרג כל חברה 1-10 לפי התאמה לארגון.
קריטריונים: חפיפת תחומי עניין (35%), פעילות בישראל (25%), גודל תרומות (20%), דירוג CSR (20%).

כללים קריטיים:
- חברות/קרנות שפועלות רק מחוץ לישראל ולא תורמות לארגונים ישראליים = ציון 1-2.
- חפיפה כללית בקטגוריה (education, welfare) לא מספיקה. חייב חפיפה ספציפית.
- ציון 8+ רק כשיש התאמה ברורה בתחום + גיאוגרפיה + היסטוריית תרומות רלוונטית.
החזר JSON בלבד: [{"index": 1, "score": 8, "reasoning": "נימוק קצר", "approach_tip": "טיפ קצר איך לפנות"}]
רק ציון 5 ומעלה. אם אין — מערך ריק [].`,
        messages: [{ role: 'user', content: `${orgContext}\n\nחברות:\n${compList}` }],
        max_tokens: 2000,
      });

      const raw = res.content[0].type === 'text' ? res.content[0].text : '[]';
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, raw];
      let scored: { index: number; score: number; reasoning: string; approach_tip?: string }[] = [];
      try {
        scored = JSON.parse(jsonMatch[1]!.trim());
      } catch {
        return '';
      }

      const goodMatches = scored.filter((s) => s.score >= 5).slice(0, 8);
      if (goodMatches.length === 0) return '';

      const lines = goodMatches.map((item) => {
        const c = sorted[item.index - 1];
        if (!c) return null;
        return `- ${c.name} (${c.company_type === 'fund' ? 'קרן' : c.company_type === 'public' ? 'ציבורית' : c.company_type === 'private' ? 'פרטית' : 'עסק'}, ציון: ${item.score}/10)${c.donation_amount ? ` | תרומות: ${(c.donation_amount / 1000).toFixed(0)}K ש"ח` : ''}${c.contact_name ? ` | איש קשר: ${c.contact_name}` : ''}${c.contact_email ? ` | ${c.contact_email}` : ''}\n  ${item.reasoning}${item.approach_tip ? `\n  טיפ לפנייה: ${item.approach_tip}` : ''}`;
      }).filter(Boolean);

      return `\n\n===== חברות מתאימות =====\nמצאתי ${lines.length} חברות/קרנות שכדאי לפנות אליהן (מתוך ${companies.length} במאגר):\n${lines.join('\n')}`;
    }

    const typeCounts: Record<string, number> = {};
    for (const c of companies) {
      typeCounts[c.company_type] = (typeCounts[c.company_type] || 0) + 1;
    }
    const statsLine = Object.entries(typeCounts).map(([t, c]) => `${c} ${t === 'fund' ? 'קרנות' : t === 'public' ? 'ציבוריות' : t === 'private' ? 'פרטיות' : 'עסקים'}`).join(', ');

    return `\n\n===== מאגר חברות =====\nיש לי ${companies.length} חברות וארגונים: ${statsLine}. כולם עם פרטי קשר מלאים. תעלו מסמכים על הארגון ואתאים לכם את החברות הכי רלוונטיות.`;
  } catch (e) {
    console.error('Company scan error:', e);
    return '';
  }
}

export async function loadCompaniesIndex(
  supabase: ReturnType<typeof createAdminClient>
): Promise<string> {
  try {
    const { data: companies } = await supabase
      .from('companies')
      .select('name, company_type, description, interests, donation_amount, csr_rank')
      .eq('active', true)
      .order('name');

    if (!companies?.length) return '';

    const byType: Record<string, typeof companies> = {};
    for (const c of companies) {
      const t = c.company_type || 'other';
      if (!byType[t]) byType[t] = [];
      byType[t].push(c);
    }

    const typeLabels: Record<string, string> = {
      fund: 'קרנות',
      public: 'חברות ציבוריות',
      private: 'חברות פרטיות',
      business: 'עסקים',
    };

    const sections = Object.entries(byType).map(([type, comps]) => {
      const label = typeLabels[type] || type;
      const lines = comps.map(c => {
        const parts = [c.name];
        if (c.interests?.length) parts.push(`(${c.interests.slice(0, 3).join(', ')})`);
        if (c.donation_amount) parts.push(`${(c.donation_amount / 1000).toFixed(0)}K₪`);
        if (c.csr_rank) parts.push(`CSR#${c.csr_rank}`);
        return parts.join(' ');
      });
      return `## ${label} (${comps.length})\n${lines.join(' | ')}`;
    });

    let result = `\n\n===== מאגר חברות וארגונים — ${companies.length} במאגר =====\nאתה מכיר את כל החברות האלה. כשמשתמש שואל על חברה — חפש במאגר הזה קודם!\n${sections.join('\n\n')}`;
    if (result.length > 30000) {
      result = result.slice(0, 30000) + '\n[... עוד חברות]';
    }
    return result;
  } catch {
    return '';
  }
}

export async function loadGrantsIndex(): Promise<string> {
  try {
    const oppDb = createAdminClient();
    const today = new Date().toISOString().split('T')[0];

    const { data: grants } = await oppDb
      .from('opportunities')
      .select('id, title, funder, deadline, description, categories, target_populations, url, amount_max, type, eligibility, how_to_apply, contact_info, tags')
      .eq('active', true)
      .order('deadline', { ascending: true, nullsFirst: false });

    if (!grants?.length) return '';

    const open: typeof grants = [];
    const noDeadline: typeof grants = [];
    const closed: typeof grants = [];

    for (const g of grants) {
      if (!g.deadline) {
        noDeadline.push(g);
      } else if (g.deadline >= today) {
        open.push(g);
      } else {
        closed.push(g);
      }
    }

    const formatGrant = (g: typeof grants[0]) => {
      const parts = [`"${g.title}"`];
      if (g.funder) parts.push(`גוף: ${g.funder}`);
      if (g.deadline) parts.push(`דדליין: ${g.deadline}`);
      if (g.amount_max) parts.push(`עד ${(g.amount_max / 1000).toFixed(0)}K₪`);
      if (g.categories?.length) parts.push(`תחומים: ${g.categories.slice(0, 3).join(', ')}`);
      if (g.target_populations?.length) parts.push(`אוכלוסיות: ${g.target_populations.slice(0, 3).join(', ')}`);
      if (g.type) parts.push(`סוג: ${g.type}`);
      if (g.url) parts.push(`לינק: ${g.url}`);
      if (g.description) parts.push(`תיאור: ${g.description.slice(0, 200)}`);
      if (g.eligibility) parts.push(`תנאי סף: ${g.eligibility.slice(0, 150)}`);
      if (g.how_to_apply) parts.push(`הגשה: ${g.how_to_apply.slice(0, 100)}`);
      if (g.contact_info) parts.push(`קשר: ${g.contact_info.slice(0, 80)}`);
      return parts.join(' | ');
    };

    let result = `\n\n===== מאגר קולות קוראים — ${grants.length} במאגר =====`;
    result += `\nאתה מכיר את כל הקולות הקוראים האלה על בוריהם. כשמשתמש שואל על קול קורא — חפש במאגר הזה קודם!`;
    result += `\nסה"כ: ${open.length} פתוחים, ${noDeadline.length} ללא דדליין, ${closed.length} סגורים.`;

    if (open.length > 0) {
      result += `\n\n## פתוחים עכשיו (${open.length})`;
      result += `\n${open.map(formatGrant).join('\n')}`;
    }

    if (noDeadline.length > 0) {
      result += `\n\n## ללא דדליין — תמיד פתוחים (${noDeadline.length})`;
      result += `\n${noDeadline.map(formatGrant).join('\n')}`;
    }

    if (closed.length > 0) {
      result += `\n\n## סגורים (${closed.length}) — לדעת שקיימים, לעקוב אחרי סבבים עתידיים`;
      result += `\n${closed.map(g => {
        const parts = [`"${g.title}"`];
        if (g.funder) parts.push(g.funder);
        if (g.deadline) parts.push(`סגור ${g.deadline}`);
        if (g.categories?.length) parts.push(g.categories.slice(0, 2).join(', '));
        if (g.url) parts.push(g.url);
        return parts.join(' | ');
      }).join('\n')}`;
    }

    if (result.length > 25000) {
      result = result.slice(0, 25000) + '\n[... עוד קולות קוראים]';
    }

    return result;
  } catch (e) {
    console.error('Grants index load error:', e);
    return '';
  }
}

export async function loadFundersIndex(
  supabase: ReturnType<typeof createAdminClient>
): Promise<string> {
  try {
    const { data: grants } = await supabase
      .from('opportunities')
      .select('funder, categories, target_populations, amount_max, deadline, title, url')
      .eq('active', true)
      .not('funder', 'is', null);

    if (!grants?.length) return '';

    const today = new Date().toISOString().split('T')[0];

    const funderMap = new Map<string, {
      grantCount: number;
      categories: Set<string>;
      populations: Set<string>;
      minAmount: number | null;
      maxAmount: number | null;
      openGrants: number;
      sampleTitles: string[];
      urls: Set<string>;
    }>();

    for (const g of grants) {
      const name = g.funder?.trim();
      if (!name || name.length < 2 || name.includes('{')) continue;

      if (!funderMap.has(name)) {
        funderMap.set(name, {
          grantCount: 0, categories: new Set(), populations: new Set(),
          minAmount: null, maxAmount: null, openGrants: 0, sampleTitles: [], urls: new Set(),
        });
      }
      const f = funderMap.get(name)!;
      f.grantCount++;
      if (g.categories) for (const c of g.categories) f.categories.add(c);
      if (g.target_populations) for (const p of g.target_populations) f.populations.add(p);
      if (g.amount_max) {
        if (!f.minAmount || g.amount_max < f.minAmount) f.minAmount = g.amount_max;
        if (!f.maxAmount || g.amount_max > f.maxAmount) f.maxAmount = g.amount_max;
      }
      if (g.deadline && g.deadline >= today) f.openGrants++;
      if (f.sampleTitles.length < 3) f.sampleTitles.push(g.title);
      if (g.url) f.urls.add(g.url);
    }

    const { data: sources } = await supabase
      .from('grant_sources')
      .select('name, url, layer, fields, populations, notes')
      .eq('is_active', true);

    const funderLines = Array.from(funderMap.entries())
      .sort((a, b) => b[1].grantCount - a[1].grantCount)
      .map(([name, f]) => {
        const parts = [`${name} (${f.grantCount} קולות קוראים`];
        if (f.openGrants > 0) parts[0] += `, ${f.openGrants} פתוחים`;
        parts[0] += ')';
        if (f.categories.size) parts.push(`תחומים: ${Array.from(f.categories).slice(0, 4).join(', ')}`);
        if (f.populations.size) parts.push(`אוכלוסיות: ${Array.from(f.populations).slice(0, 4).join(', ')}`);
        if (f.maxAmount) parts.push(`עד ${(f.maxAmount / 1000).toFixed(0)}K₪`);
        if (f.sampleTitles.length) parts.push(`דוגמאות: ${f.sampleTitles.slice(0, 2).join('; ')}`);
        return parts.join(' | ');
      });

    let result = `\n\n===== מודיעין גופים מממנים — ${funderMap.size} גופים =====`;
    result += `\nאתה מכיר כל גוף מממן. כשמישהו שואל על קרן או גוף — תענה מהידע שלך.`;
    result += `\n${funderLines.join('\n')}`;

    if (sources?.length) {
      const byLayer: Record<string, string[]> = {};
      for (const s of sources) {
        const layer = s.layer || 'other';
        if (!byLayer[layer]) byLayer[layer] = [];
        byLayer[layer].push(s.url);
      }
      const layerLabels: Record<string, string> = {
        government: 'ממשלתי', private_il: 'קרנות ישראליות',
        international: 'בינלאומי', aggregator: 'אגרגטורים',
      };
      result += `\n\n## מקורות סריקה (${sources.length} אתרים)`;
      for (const [layer, urls] of Object.entries(byLayer)) {
        result += `\n${layerLabels[layer] || layer}: ${urls.join(' | ')}`;
      }
    }

    result += `\n\n## מודיעין עומק — גופים מרכזיים:`;
    result += `
משרד החינוך: מדדים כמותיים, שפה פורמלית, יעדים SMART, שיתוף רשויות מקומיות. דדליינים: אוגוסט-ספטמבר.
ביטוח לאומי: קרנות ייעודיות (מוגבלות, קשישים, ילדים). בירוקרטי, דורשים ניהול תקין + 46א. 50K-500K.
ג'וינט/JDC: חדשנות, שיתופי פעולה, evidence-based, מדידה + למידה. מעדיפים תוכניות חדשות.
מפעל הפיס: פריפריה, נגישות, קהילה, תרבות. 20K-300K. תהליך פשוט.
קרן עזריאלי: חינוך, מדע, מנהיגות, ספורט. 100K-1M. תחרותי, דורשים מצוינות.
שוסטרמן: חינוך יהודי, מנהיגות צעירה, ישראל-תפוצות. סגנון אמריקאי, ROI ברור.
קרן ויינברג: רווחה, בריאות, קהילה. דרך שותפים מקומיים. מעדיפים ארגונים מבוססים.
יד הנדיב (רוטשילד): חינוך, סביבה, אזרחות. סכומים גדולים, תהליך ארוך, מצוינות מחקרית.
קרן רשי: פריפריה, חינוך, תעסוקה. מועדפים: דרום ונגב. leverage ממשלתי.
ועדת העיזבונות: 100K-2M, רווחה + חינוך, תהליך ארוך, דורש מסמכים רבים.
קק"ל: סביבה, פריפריה, חינוך. שותפויות עם רשויות. impact מדיד.
הסוכנות היהודית: עלייה, קליטה, זהות יהודית. חיבור ישראל-תפוצות.`;

    if (result.length > 15000) {
      result = result.slice(0, 15000) + '\n[... עוד גופים מממנים]';
    }

    return result;
  } catch (e) {
    console.error('Funders index load error:', e);
    return '';
  }
}
