import Anthropic from '@anthropic-ai/sdk';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildContext } from '@/lib/ai/fishgold';
import type { FetchedUrl } from './url-fetcher';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export function chunkText(text: string, maxChars: number = 2000): string[] {
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

export async function learnFromUrls(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string,
  fetched: FetchedUrl[]
) {
  if (fetched.length === 0) return;

  for (const { url, content } of fetched) {
    if (content.startsWith('[')) continue;
    if (content.length < 100) continue;

    try {
      const res = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        system: `אתה מנתח תוכן מאתרי אינטרנט של ארגונים ועמותות.
חלץ מהטקסט הבא כמה שיותר מידע מובנה על הארגון.
החזר JSON תקין בלבד עם השדות הרלוונטיים:
- name: שם הארגון
- registration_number: מספר עמותה (אם יש)
- mission: מטרת הארגון (משפט-שניים)
- focus_areas: מערך תחומי פעילות
- regions: מערך אזורי פעילות
- beneficiaries_count: מספר מוטבים (אם מצוין)
- annual_budget: תקציב שנתי (אם מצוין)
- employees_count: מספר עובדים (אם מצוין)
- active_projects: מערך של {name, description}
- key_achievements: מערך הישגים
- content_type: "org_website" | "call_for_proposals" | "article" | "other"
- summary: סיכום קצר של מה שנמצא בלינק

אם זה לא אתר של ארגון (למשל קול קורא או כתבה), עדיין מלא content_type ו-summary.
החזר רק JSON תקין, בלי טקסט נוסף.`,
        messages: [{ role: 'user', content: content.slice(0, 6000) }],
        max_tokens: 1000,
      });

      const raw = res.content[0].type === 'text' ? res.content[0].text : '{}';
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, raw];
      const extracted = JSON.parse(jsonMatch[1]!.trim()) as Record<string, unknown>;

      const { data: existingDoc } = await supabase
        .from('documents')
        .select('id')
        .eq('org_id', orgId)
        .eq('storage_path', url)
        .single();
      if (existingDoc) continue;

      const { data: doc } = await supabase
        .from('documents')
        .insert({
          org_id: orgId,
          filename: `url_${new URL(url).hostname}`,
          file_type: 'url',
          storage_path: url,
          category: extracted.content_type === 'org_website' ? 'identity' : 'other',
          parsed_text: content.slice(0, 50000),
          metadata: { url, ...extracted },
          status: 'ready',
        })
        .select('id')
        .single();

      if (doc) {
        const chunks = chunkText(content);
        for (const chunk of chunks) {
          await supabase.from('document_chunks').insert({
            document_id: doc.id,
            org_id: orgId,
            content: chunk,
            metadata: { url, source: 'url_scan', content_type: extracted.content_type },
          });
        }
      }

      if (extracted.content_type === 'org_website') {
        const { data: existing } = await supabase
          .from('org_profiles')
          .select('data')
          .eq('org_id', orgId)
          .single();

        const current = (existing?.data as Record<string, unknown>) || {};
        const merged = { ...current };

        for (const key of [
          'name', 'registration_number', 'mission', 'focus_areas', 'regions',
          'beneficiaries_count', 'annual_budget', 'employees_count', 'key_achievements',
        ]) {
          if (extracted[key] && !merged[key]) {
            merged[key] = extracted[key];
          }
        }

        if (Array.isArray(extracted.active_projects)) {
          const existingProjects = (merged.active_projects as unknown[]) || [];
          merged.active_projects = [...existingProjects, ...(extracted.active_projects as unknown[])];
        }

        await supabase.from('org_profiles').upsert(
          { org_id: orgId, data: merged, last_updated: new Date().toISOString() },
          { onConflict: 'org_id' }
        );
      }
    } catch (err) {
      console.error('learnFromUrls error for', url, ':', err instanceof Error ? err.message : err);
    }
  }
}

export async function loadAllChunks(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string,
  message: string,
  activeTab?: string
): Promise<{ knowledge: string; rag: string; docSummary: string }> {
  const isOrgTab = activeTab === 'org';
  try {
    const { data: allDocs } = await supabase
      .from('documents')
      .select('id, filename, category, file_type, parsed_text, created_at, metadata')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false });

    let docSummary = '';
    if (allDocs?.length) {
      const docLines = allDocs.map(d => {
        const meta = (d.metadata || {}) as Record<string, unknown>;
        const summary = (meta.summary as string) || '';
        const insights = (meta.insights as string) || '';
        const missingInfo = Array.isArray(meta.missing_info) ? (meta.missing_info as string[]).join(', ') : '';
        const aiContext = [summary, insights, missingInfo ? `חסר: ${missingInfo}` : ''].filter(Boolean).join('\n');
        const preview = aiContext || (d.parsed_text ? d.parsed_text.slice(0, 400) : '');
        return `[${d.category || 'other'}] ${d.filename} (id: ${d.id})${preview ? `:\n${preview}` : ''}`;
      });
      docSummary = `\n\n===== כל המסמכים שקראת (${allDocs.length} מסמכים) =====
כשמישהו מבקש מסמך — תן לינק הורדה בפורמט: [שם הקובץ](/api/documents/ID/download)
דוגמה: [דוח כספי 2025.pdf](/api/documents/abc-123/download)
\n${docLines.join('\n\n')}`;

      if (docSummary.length > 60000) {
        docSummary = docSummary.slice(0, 60000) + '\n[... עוד מסמכים]';
      }

      const now = new Date();
      const alertLines: string[] = [];

      allDocs.forEach(d => {
        const meta = (d.metadata || {}) as Record<string, unknown>;
        const validUntil = meta.valid_until as string | undefined;
        if (validUntil) {
          const expDate = new Date(validUntil);
          const daysLeft = Math.floor((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          const docType = (meta.doc_type as string) || d.filename;
          if (daysLeft < 0) {
            alertLines.push(`🔴 פג תוקף: ${docType} (פג ב-${validUntil})`);
          } else if (daysLeft < 90) {
            alertLines.push(`🟡 עומד לפוג: ${docType} (בעוד ${daysLeft} ימים, ${validUntil})`);
          }
        }
      });

      const REQUIRED_DOCS = [
        { pattern: /ניהול תקין/i, label: 'אישור ניהול תקין' },
        { pattern: /סעיף 46|saif.?46/i, label: 'אישור סעיף 46' },
        { pattern: /ניכוי מס/i, label: 'אישור ניכוי מס' },
        { pattern: /רישום עמותה|תעודת רישום/i, label: 'תעודת רישום עמותה' },
        { pattern: /דוח כספי|כספי.*מבוקר/i, label: 'דוח כספי מבוקר' },
        { pattern: /תקציב.*מאושר|מאושר.*תקציב/i, label: 'תקציב מאושר' },
        { pattern: /מילולי|דוח פעילות/i, label: 'דוח מילולי / דוח פעילות' },
        { pattern: /ניהול ספרים/i, label: 'אישור ניהול ספרים' },
      ];

      const docTexts = allDocs.map(d => {
        const meta = (d.metadata || {}) as Record<string, unknown>;
        return `${d.filename} ${(meta.doc_type as string) || ''} ${(meta.summary as string) || ''}`;
      });

      REQUIRED_DOCS.forEach(req => {
        const found = docTexts.some(t => req.pattern.test(t));
        if (!found) {
          alertLines.push(`⚪ חסר: ${req.label}`);
        }
      });

      if (alertLines.length > 0) {
        docSummary += `\n\n===== התראות מסמכים =====
${alertLines.join('\n')}

**חובה:** כשהמשתמש שואל על הגשות, מסמכים, או מוכנות — ציין את ההתראות הללו.
אם יש מסמכים שפג תוקפם או עומדים לפוג — הזהר את המשתמש באופן יזום.
אם חסרים מסמכים בסיסיים — ציין אילו חסרים ומדוע הם נדרשים.`;
      }
    }

    const { data: kbChunks } = await supabase
      .from('document_chunks')
      .select('content, metadata')
      .eq('org_id', orgId)
      .eq('metadata->>source', 'knowledge_base')
      .order('created_at');

    let knowledge = '';
    if (kbChunks?.length) {
      const parts = kbChunks.map(
        (c) => `### ${(c.metadata as Record<string, string>)?.title || 'מידע'}\n${c.content}`
      );
      knowledge = '\n\n===== בסיס ידע ארגוני =====\n' + parts.join('\n\n');
    }

    let rag = '';

    const docIdMatch = message.match(/\[document_ids:\s*([^\]]+)\]/);
    if (docIdMatch) {
      const docIds = docIdMatch[1].split(',').map(id => id.trim()).filter(Boolean);
      if (docIds.length > 0) {
        const { data: docChunks } = await supabase
          .from('document_chunks')
          .select('content, metadata')
          .eq('org_id', orgId)
          .in('document_id', docIds)
          .limit(30);

        if (docChunks?.length) {
          rag = buildContext(docChunks);
        }
      }
    }

    const STOP_WORDS = new Set(['של', 'את', 'על', 'עם', 'אני', 'הוא', 'היא', 'זה', 'מה', 'איך', 'אם', 'כי', 'לא', 'כן', 'גם', 'אבל', 'או', 'יש', 'אין', 'רוצה', 'צריך', 'יכול', 'בבקשה', 'תודה', 'שלום']);
    const cleanMessage = message.replace(/\[document_ids:[^\]]+\]/g, '');
    const keywords = cleanMessage
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
      .slice(0, 8)
      .join(' & ');

    if (keywords) {
      const { data: chunks } = await supabase
        .from('document_chunks')
        .select('content, metadata')
        .eq('org_id', orgId)
        .neq('metadata->>source', 'knowledge_base')
        .textSearch('content', keywords, { type: 'plain' })
        .limit(12);

      if (chunks?.length) {
        rag = rag ? rag + '\n\n' + buildContext(chunks) : buildContext(chunks);
      }
    }

    if (!rag) {
      const { data: recent } = await supabase
        .from('document_chunks')
        .select('content, metadata')
        .eq('org_id', orgId)
        .neq('metadata->>source', 'knowledge_base')
        .order('created_at', { ascending: false })
        .limit(15);

      if (recent?.length) {
        rag = buildContext(recent);
      }
    }

    const chunkLimit = isOrgTab ? 80 : 50;
    const { data: allChunks } = await supabase
      .from('document_chunks')
      .select('content, metadata')
      .eq('org_id', orgId)
      .neq('metadata->>source', 'knowledge_base')
      .order('created_at', { ascending: false })
      .limit(chunkLimit);
    if (allChunks?.length) {
      const allContext = buildContext(allChunks);
      rag = rag
        ? rag + '\n\n===== כל המסמכים של הארגון =====\n' + allContext
        : '\n\n===== כל המסמכים של הארגון =====\n' + allContext;
    }

    return { knowledge, rag, docSummary };
  } catch {
    return { knowledge: '', rag: '', docSummary: '' };
  }
}
