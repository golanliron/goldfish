# Goldfish — SaaS גיוס משאבים חכם

## סקילים בתיקיית הפרויקט
- `.claude/commands/english-grants.md` — סוכן כתיבת מענקים באנגלית: קורא RFPs, כותב proposals/LOIs/emails, מותאם ל-4 סוגי קרנות

## מידע טכני
- **ריפו:** golanliron/goldfish (main branch) — הועבר מ-golanliron/amuta-os
- **מקומי:** C:\Users\golan\OneDrive\Desktop\amuta-os
- **Supabase:** touqczopfjxcpmbxzdjr (fishgold-grants)
- **Vercel:** goldfish.co.il (דומיין ראשי) + amuta-os.vercel.app (fallback)
- **דומיין:** goldfish.co.il — DNS דרך MeNAME, A record → 216.198.79.1
- **DEV_ORG_ID:** d5f860e8-4958-408c-a00f-679a93f1d470 (הופה)
- **Stack:** Next.js 16, TypeScript, Tailwind, Supabase, Claude API
- **Model scoring:** claude-haiku-4-5-20251001, chat: claude-sonnet-4-6
- **Port dev:** 3002

## CRITICAL
- sb_secret_ לא עובד עם supabase-js! רק anon JWT
- createAdminClient() uses NEXT_PUBLIC_SUPABASE_ANON_KEY (not service role)
- TypeScript strict — חובה לבדוק types לפני push
- DocumentCategory type ב-types/index.ts — לעדכן אם מוסיפים קטגוריות
- Vercel auto-deploy מ-main — כל push = deploy
- React gotcha: `{0 && <element>}` renders "0" — always use `!!value && ...`

## ארכיטקטורת המוצר — 5 לשוניות (עודכן 2026-05-05)

### 1. צ'אט (ChatPanel.tsx)
- Goldfish = הדג הזהב, המומחה לגיוס משאבים (שם מותג: Goldfish, קוד פנימי עדיין fishgold)
- Streaming SSE responses, tab-aware context
- `TAB_QUICK_ACTIONS` — כפתורי פעולה מהירה לפי לשונית פעילה
- `active_tab` נשלח לשרת — system prompt משתנה בהתאם
- Events: `fishgold:send` (שליחת הודעה), `fishgold:loadConversation` (טעינת שיחה), `fishgold:closeSidebar` (סגירת סיידבר במובייל), `fishgold:activeTab` (החלפת לשונית)

### 2. העמותה (OrgTab.tsx)
- כרטיס ארגון: שם, ע.ר., מטרה, מחזור, מוטבים, עובדים
- **שדות קשר:** contact_name, contact_email, contact_phone, website — חדש!
- מד ידע 18-נקודות: 6 קטגוריות מסמכים (wt 2 כל אחת) + 8 שדות פרופיל (wt 1-2) + 4 בדיקות עומק (wt 2)
- "מצוין" = 90%+. מתחת — מראה "חסר לי:" עם עד 4 פריטים חסרים
- מסמכים רשמיים מומלצים: סעיף 46, ניהול תקין, ניכוי מס, תעודת רישום, דוח מבוקר, פרוטוקול
- 6 קטגוריות מסמכים: identity, programs, budget, project_budget, impact, submission
- קלט טקסט חופשי + קישור לאתר + Google Drive
- **התראות מסמכים (חדש 2026-05-06):** → [fishgold_document_alerts.md](fishgold_document_alerts.md)
  - בדיקת 8 מסמכי חובה (ניהול תקין, סעיף 46, ניכוי מס, רישום, דוח כספי, תקציב, דוח מילולי, ניהול ספרים)
  - בדיקת תפוגה מ-metadata.valid_until — פג (אדום), עומד לפוג <90 ימים (כתום), חסר (אפור)
  - קופסת התראות UI אדומה מוצגת אוטומטית

### 3. קולות קוראים (OpportunitiesTab.tsx)
- 428 קולות קוראים, סינון לפי active+deadline
- **DNA-based matching** (חדש!) — `org-dna.ts` מסווג ארגון ומתאים מול הזדמנויות
- פילטר אחוזי התאמה: 60%/70%/80%/90%
- Negative matching: שלילה מיידית אם קול קורא מיועד לאוכלוסייה שהארגון לא עובד איתה
- לוח זמנים (Calendar) — toggle בתוך הלשונית
- **לינקים (עודכן 2026-05-06):** 428/428 = 100% עם URL!
  - 23 לינקים ישירים (shatil + סורק יומי)
  - 43 חיפוש ממוקד gov.il (קולות קוראים ממשלתיים)
  - 313 חיפוש Google (קרנות בינלאומיות)
  - 43+5+1 חיפוש Google/GuideStar (חברות+קרנות ישראליות+הקדשות)
  - UI: fallback נוסף בצד לקוח — אם רשומה חדשה נכנסת בלי URL, מוצג "חפש הגשה"
  - סורק יומי (daily_grants_scan.py) שומר URL לכל רשומה חדשה

### 4. חברות וקרנות (BusinessTab.tsx) — עודכן 2026-05-06
- **1,014 חברות וארגונים** (862 חברות + 152 קרנות ופדרציות)
- מצב "מותאמים לארגון" vs "כל החברות"
- פילטר רלוונטיות: גבוהה (70+) / בינונית (40-69) / נמוכה (20-39) — מכסה 100% של ה"מותאמים"
- **לשונית קרנות ופדרציות (חדש!):** סינון לפי סוג (קרנות/פדרציות/הכל) + סינון התאמה
- כפתורי פעולה: "שאל את Goldfish" + "נסח מייל" + "סרוק קרן" (לקרנות)
- כרטיס מורחב: פרטי קשר, תחומי עניין, וואטסאפ ישיר
- זיהוי פדרציות: regex על שם (פדרציה/federation/UJA/UJC/united jewish)

## מנוע DNA ארגוני — `src/lib/ai/org-dna.ts` (עודכן 2026-05-06)

### extractOrgDNA(profile, docTexts?)
מחלץ DNA מפרופיל ארגון + מסמכים:
- **16 אוכלוסיות:** נוער בסיכון, צעירים, ילדים, מוגבלות, קשישים, עולים, ערבים, חרדים, נשים, חיילים, חסרי בית, התמכרויות, להט"ב, פליטים, אסירים, כללי
- **20 תחומים:** חינוך, מניעת נשירה, רווחה, תעסוקה, בריאות, בריאות הנפש, תרבות, סביבה, טכנולוגיה, חקלאות, דו-קיום, דיור, ספורט, **קהילה וחברה** (כולל "חברתי/חברתית"), **חדשנות חברתית** (impact, social tech, מוביליות), משפטי, מדע (מחמיר — לא תופס "מחקר בוגרים"), דת, תשתיות
- **8 אזורים:** נגב, גליל, פריפריה, מרכז, ירושלים, חיפה, ארצי, בינלאומי
- **6 קבוצות גיל:** 0-6, 6-12, 12-18, 18-26, 26-65, 65+
- **גודל ארגון:** small/medium/large (לפי תקציב + עובדים)
- **14 נושאי ליבה:** dropout_prevention, scholarships, early_detection, mentoring, tech_enabled, residential, arts_therapy, sports, entrepreneurship, language, family, **social_mobility**, **rights_advocacy**, **care_leavers**
- **רשימות שלילה:** אוכלוסיות ותחומים שהארגון לא עובד איתם

### scoreDNAMatch(orgDna, oppCategories, oppPopulations, oppTitle, oppDescription?)
חישוב ציון התאמה 0-100:
- **Negative match: אוכלוסייה (ברזל!)** — אם קול קורא מיועד לאוכלוסייה שהארגון לא משרת → score≤15, isNegativeMatch=true
- **Negative match: תחום (חדש 2026-05-06!)** — אם קול קורא בתחום שהארגון לא עובד בו (excludeDomains) ואין חפיפה בתחומי הארגון → score≤15, isNegativeMatch=true. **תיקון באג: excludeDomains לא היה בשימוש בכלל!**
- אוכלוסייה: 30 נק' מקס (15 לכל חפיפה)
- תחום: 30 נק' מקס (12 לכל חפיפה). **חדש:** חצי נקודות (מקס 15) אם הקול קורא מערבב תחומים רלוונטיים ולא רלוונטיים
- גיאוגרפיה: 20 נק' מקס (10 לכל חפיפה) + 5 בונוס ארצי
- גיל: 10 נק' (תואם) או -5 (לא תואם)
- נושאי ליבה: 5 נק' לכל חפיפה

### AI scoring prompts (עודכן 2026-05-06)
- scan route + chat route: פרומפט מחמיר יותר — תחום שונה מהותית (חקלאות/מים/סביבה vs חינוך/נוער) = ציון 1-3 תמיד
- רובריקת ציון: 9-10 מושלם, 7-8 גבוה, 5-6 בינוני, 1-4 לא מתאים

## Pipeline מלא (עודכן 2026-05-05)

### Chat Pipeline
user message → `/api/chat` → detect intent (scan keywords?) →
  if scan: loadOpportunities + buildOrgContext + scanOpportunities(top15→Claude Haiku scoring) → save matches → stream response
  else: buildOrgContext (profile + docs + DNA) → Claude Sonnet streaming → save conversation
- **Document alerts (2026-05-06):** loadAllChunks כולל metadata, בודק תפוגה + 8 מסמכי חובה, מזריק "התראות מסמכים" ל-system prompt. Tab focus "העמותה" כולל הנחיות על דרישות מסמכים.

### Opportunities Pipeline
GET `/api/opportunities?org_id=X` →
  load taxonomy + opportunities(active, deadline>=today) + saved matches + profile →
  if no matches: extractOrgDNA(profile) → scoreDNAMatch per opportunity → filter(score>=20, !negative) → return

### Companies Pipeline
GET `/api/companies?org_id=X&matched=true` →
  load ALL companies(active, limit 1100) + stats + profile →
  scoreCompany(keywords+mission) → sort by relevance → filter matched(score>=20) → return top 200
**FIX 2026-05-06:** limit הועלה ל-1100 (היה 954). 1,014 חברות במאגר כולל 152 קרנות.

### Companies Knowledge Pipeline (ALWAYS loaded)
Every chat request → `loadCompaniesIndex(supabase)` →
  load ALL 1,014 companies (name, type, interests, donation, csr_rank) →
  group by type → compact index injected into system prompt →
  Goldfish ALWAYS knows every company name, type, and key details

### Grants Knowledge Pipeline (ALWAYS loaded — חדש 2026-05-05)
Every chat request → `loadGrantsIndex()` →
  load ALL grants from grants DB (vhmwijzcrqjjquxomccq) with full details →
  split by status: open (deadline>=today) / no-deadline / closed →
  format each grant: title, funder, deadline, amount, categories, populations, URL, description, eligibility, how_to_apply, contact →
  compact index injected into system prompt (max 40K chars) →
  Goldfish ALWAYS knows every grant: what it's about, who it's for, how to apply, deadline

### Funders Intelligence Pipeline (ALWAYS loaded — חדש 2026-05-05)
Every chat request → `loadFundersIndex(supabase)` →
  aggregate ALL grants by funder → build profile per funder (count, categories, populations, amounts) →
  load 75 scan sources from grant_sources →
  add hardcoded deep intel on 12 major funders →
  inject into system prompt →
  Goldfish ALWAYS knows every funder: what they fund, how much, what style, tips

### Company Search in Chat — Supabase ilike + Apostrophe Normalization (FIXED 2026-05-06)
`findSpecificCompany()` — triggered on EVERY message, searches directly in Supabase:
0. **`normalizeApostrophes()`** — converts ׳ ' ' ` ´ → ' before any search (fixes "צ׳ק פוינט" vs "צ'ק פוינט")
1. **Strategy 0:** Full phrase with ALL words (incl. stopwords like "קרן") — tries longest first (4→3→2 words). Also tries without apostrophes as fallback.
2. Strategy 1: Word pairs after stopword removal
3. Strategy 2: Single word ilike on name (with apostrophe-stripped fallback)
4. Strategy 3: Single word ilike on name+description (with stripped fallback)
**Key fix:** Hebrew geresh ׳ (U+05F3) ≠ ASCII apostrophe ' (U+0027). DB stores `'`, users type `׳`. `searchName()` helper tries both variants + stripped.

## מסד נתונים — 3 נכסי ליבה

### 1. קולות קוראים (opportunities) — 428 פריטים
- 22 שדות: id, source, title, description, amount_min/max, deadline, requirements (jsonb), categories[], regions[], url, embedding, active, scraped_at, funder, open_date, target_populations[], tags[], type, eligibility, how_to_apply, contact_info
- ~49 עם דדליין פתוח
- כולם active=true

### 2. חברות וארגונים (companies) — 954 פריטים
- 16 שדות: id, name, company_type, description, interests[], donation_amount, market_cap, csr_rank, contact_name, contact_email, contact_phone, contact_role, website, active, created_at, updated_at
- פירוט: business(524), public(224), private(114), fund(92)
- **כיסוי CSR: 954/954 (100%!)** — כל חברה עם תיאור + interests tags
- כיסוי אנשי קשר: 935+ עם טלפון ומייל
- מקור: Thunderbit scraping (862) + מאגר קרנות (92)

### 3. מקורות מימון (grant_sources) — 75 מקורות

### טבלאות תמיכה
- `matches` — 211+ התאמות (org_id, opportunity_id, score, reasoning)
- `documents` — 28+ מסמכי ידע
- `grant_taxonomy` — קטגוריות ואוכלוסיות
- `conversations` — היסטוריית צ'אט (טעינה מההיסטוריה עובדת!)
- `organizations` — ארגונים (1 - הופה)
- `org_profiles` — פרופיל ארגון (כולל contact_name/email/phone/website)
- `submissions` — הגשות

## RLS
- opportunities: SELECT מותר לכולם (active=true)
- All tables have anon_read_all / anon_all policies for API route access

## API Endpoints
- `POST /api/chat` — Main chat + inline scan (sends active_tab for context)
- `POST /api/scan` — Standalone scan
- `POST /api/upload` — Document upload + AI extraction (file or JSON text)
- `GET /api/conversations` — Last conversation for org+user
- `GET /api/conversations/[id]` — Load specific conversation by ID
- `GET /api/opportunities` — Opportunities + DNA-based matching
- `GET /api/companies` — Companies + keyword scoring
- `POST /api/org` — Save org profile
- `GET /api/org` — Load org profile + documents
- `POST /api/learn-url` — Scrape URL and save as document

## Key Files — מפת קוד מלאה
- `src/app/page.tsx` — Landing page (הוסר "לחברות ועסקים")
- `src/app/(dashboard)/layout.tsx` — Dashboard layout, mobile tabs, sidebar toggle
- `src/app/api/chat/route.ts` — Core chat: scanOpportunities(), scanCompanies(), loadCompaniesIndex(), loadGrantsIndex(), loadFundersIndex(), findSpecificCompany(ilike), fetchWithJinaReader(), buildOrgContext, streaming
- `src/app/api/opportunities/route.ts` — DNA-based matching (extractOrgDNA + scoreDNAMatch)
- `src/app/api/companies/route.ts` — Company scoring (scoreCompany)
- `src/app/api/conversations/[id]/route.ts` — Load conversation by ID
- `src/lib/ai/fishgold.ts` — System prompt (כולל כלל ברזל: חייב להכיר כל חברה במאגר!), FISHGOLD_WELCOME, buildOrgContext, TAB contexts
- `src/lib/ai/org-dna.ts` — DNA extraction + scoring (populations/domains/geo/age/themes)
- `src/lib/supabase/admin.ts` — Admin client (uses anon key!)
- `src/components/chat/ChatPanel.tsx` — Chat UI, streaming, tab-aware, loadConversation
- `src/components/sidebar/SidebarPanel.tsx` — 4 tabs: org, opportunities, business, foundations (היסטוריה הוסרה 2026-05-06)
- `src/components/sidebar/OrgTab.tsx` — Profile card, contact info, knowledge bar, documents
- `src/components/sidebar/OpportunitiesTab.tsx` — Opportunities list, match filters, calendar
- `src/components/sidebar/BusinessTab.tsx` — Companies list, relevance scoring, actions
- `src/types/index.ts` — All types (OrgProfileData has contact fields!)

## Cross-Component Communication (CustomEvents)
- `fishgold:send` — שליחת הודעה מכל מקום לצ'אט
- `fishgold:activeTab` — עדכון הצ'אט על לשונית פעילה (placeholder + quick actions)
- `fishgold:loadConversation` — טעינת שיחה קודמת מהיסטוריה
- `fishgold:closeSidebar` — סגירת סיידבר (mobile)

## בלוקי ידע מוזרקים ל-System Prompt (עודכן 2026-05-05)

### קבצי קוד:
- **`src/lib/ai/fishgold.ts`** — 3 exports עיקריים:
  - `FISHGOLD_SYSTEM_PROMPT` (~302 שורות) — אישיות, כללי ברזל, סגנון כתיבה, מומחיות גיוס, ניתוח קולות קוראים, כתיבת מיילים, פרואקטיביות
  - `FISHGOLD_GRANT_EXPERTISE` (~55 שורות) — מבנה הגשה 10-סעיפים, כללי תקציב, התאמה ל-4 סוגי קרנות, 10 טעויות שפוסלות, צ'קליסט, עקרונות ניסוח, מגמות 2026
  - `FISHGOLD_SECTOR_KNOWLEDGE` (~55 שורות) — מפת משרדי ממשלה+תקציבים, ועדות כנסת, עמותות גדולות, TOP 10 חברות תורמות+סכומים, ערוצי מימון, לוחות זמנים, מסמכים נדרשים
- **`src/app/api/chat/route.ts`** שורה ~968 — הרכבת prompt:
  ```
  systemPrompt = FISHGOLD_SYSTEM_PROMPT + FISHGOLD_GRANT_EXPERTISE + FISHGOLD_SECTOR_KNOWLEDGE + tabFocus + orgContext + docSummary + knowledge + rag + opportunityContext + companyContext + companiesIndex + grantsIndex + fundersIndex + sectorContext
  ```

### בלוקים דינמיים (נטענים מ-Supabase):
- `orgContext` — כרטיס ארגון (buildOrgContext)
- `docSummary` + `knowledge` + `rag` — מסמכים שהועלו (loadAllChunks)
- `opportunityContext` — קולות קוראים מתאימים (scanOpportunities + DNA scoring)
- `companyContext` — חברה ספציפית שנשאלו עליה (findSpecificCompany — Supabase ilike)
- `companiesIndex` — אינדקס כל 954 חברות (loadCompaniesIndex)
- `grantsIndex` — אינדקס כל הקולות קוראים (loadGrantsIndex)
- `fundersIndex` — מודיעין גופים מממנים + מקורות סריקה (loadFundersIndex) — חדש!
- `sectorContext` — חדשות מגזריות (loadSectorIntelligence)

### קבצי זיכרון (reference, לא מוזרקים לבוט):
- [fishgold_grants_knowledge.md](fishgold_grants_knowledge.md) — מאגר ידע מלא: 428 הזדמנויות, טקסונומיה, TOP 30 חברות, כללי הגשה
- [fishgold_social_sector_knowledge.md](fishgold_social_sector_knowledge.md) — מפה חברתית: מוסדות, עמותות, מגמות, שאלות onboarding
- [fishgold_grant_writing_agent.md](fishgold_grant_writing_agent.md) — מומחיות כתיבה: מבנה, תבניות, SMART, תקציב, התאמה לקרנות

## אופי Goldfish
-> ראה [fishgold_personality.md](fishgold_personality.md)

## סוכן חכם — Smart Reader (חדש 2026-05-05)

### API: `/api/smart-reader` (POST)
קורא כל סוג מסמך ושומר ל-RAG:
- **PDF** — pdf-parse + Claude OCR fallback (גם מלינק!)
- **DOCX/DOC** — mammoth (גם מלינק!)
- **XLSX** — Claude document API
- **URLs** — direct fetch + Jina Reader fallback
- **LinkedIn** — Jina Reader (company/in/posts/pulse/feed)
- **HTML/TXT/CSV** — קריאה ישירה

### Input modes:
- `POST JSON {org_id, url}` — קריאת URL בודד
- `POST JSON {org_id, urls: [...]}` — קריאת מספר URLs
- `POST JSON {org_id, text}` — טקסט חופשי
- `POST FormData {org_id, file}` — העלאת קובץ

### Pipeline:
1. זיהוי סוג (PDF/DOCX/LinkedIn/HTML/SPA)
2. חילוץ טקסט (pdf-parse / mammoth / Jina / strip HTML)
3. AI סיווג (identity/budget/project/grant/submission/impact/linkedin/other)
4. AI חילוץ מובנה (שם, מטרה, תקציב, אנשי קשר, פרויקטים)
5. AI סיכום
6. שמירה ב-documents + document_chunks (RAG)
7. החזרת תוצאות

### שינויים ב-chat route:
- `fetchUrlContent()` — עכשיו מוריד ופותח PDF ו-DOCX מלינקים (לא דוחה!)
- `isLinkedInUrl()` — זיהוי לינקדאין → Jina Reader אוטומטית
- `parsePdfBuffer()` + `parseDocxBuffer()` — פונקציות חילוץ inline

### קבצים:
- `src/app/api/smart-reader/route.ts` — API endpoint מאוחד
- `src/app/api/chat/route.ts` — שדרוג fetchUrlContent
- `src/lib/ai/fishgold.ts` — system prompt מעודכן

## כלל ברזל: סריקה רחבה — כל התחומים! (2026-05-06)
- Goldfish הוא SaaS לכל עמותה, **לא רק נוער/חינוך/רווחה**
- המאגר חייב לכסות קולות קוראים מכל תחום: מחקר, משפט, דת, סביבה, חקלאות, טכנולוגיה, ספורט, תרבות, בינלאומי
- **עיקרון:** "אם עמותה ישראלית יכולה להגיש לזה — זה צריך להיות במאגר"
- הסינון = DNA matching לכל ארגון, לא סינון בסריקה
- מקורות חסרים: רשות התחרות, ISF, BSF, משרד החקלאות, המשרד להגנ"ס, ועד אולימפי, קרנות רוחניות (האני, Mandel, Avi Chai)

## תחזוקה שוטפת — כלל ברזל!
- **סריקת קולות קוראים:** פעם ביום (סקיל `/resource-mobilization` או סוכן scanner) — **כל התחומים, לא רק חברתי!**
- **עדכון אנשי קשר companies:** פעם בשבוע — לבדוק שינויי טלפון/מייל/CSR contacts
- **בדיקת דדליינים:** לסמן opportunities שפג תוקפם כ-active=false
- **DNA patterns:** לעדכן org-dna.ts כשמתגלים דפוסים חדשים (אוכלוסיות/תחומים)
- **הרחבת מקורות סריקה:** להוסיף gov.il כולו (כל המשרדים), ISF, BSF, קרנות רוחניות, ספורט, חקלאות

## Known Issues & Fixes
- Model ID: use claude-haiku-4-5-20251001 (not deprecated 3-5)
- sb_secret_ keys: incompatible with supabase-js, must use JWT
- RLS: needed explicit anon policies
- GitHub push protection: never hardcode keys
- file_type check constraint: only pdf/docx/xlsx/url/txt allowed
- React {0 && ...} renders "0" — fixed with !! in BusinessTab
- **SPA links (gov.il etc) — FIXED 2026-05-05:** Added Jina Reader (r.jina.ai) fallback. Now: grants DB first → direct fetch → Jina Reader → error. Reads gov.il, ביטוח לאומי, ואתרים דינמיים אחרים
- Negative matching: prevents writing submissions for mismatched grants (e.g. disabilities for youth org)
- **matchedCount discrepancy (FIXED 2026-05-05):** Was showing different numbers on "matched" vs "all" tabs because query limit was 200 vs 954. Now always loads all 954.
- **Company search broken for Hebrew (FIXED 2026-05-05):** Old JS-based matching (`toLowerCase()+includes()`) failed with Hebrew. Replaced with direct Supabase `ilike` queries — 3 strategies (phrase, word, description).
- **Goldfish "לא מכיר" companies (FIXED 2026-05-05):** Added loadCompaniesIndex() — full company index always in system prompt. Added explicit rule in fishgold.ts: never say "לא מכיר" without checking the index first.
- **URL fetching for SPA sites (FIXED 2026-05-05):** Added `fetchWithJinaReader()` (r.jina.ai) as fallback for JavaScript-rendered pages. Check grants DB first → direct fetch → Jina Reader → error message. gov.il, ביטוח לאומי etc now readable.
- **Funders intelligence (NEW 2026-05-05):** `loadFundersIndex()` aggregates grants by funder + deep intel on 12 major funders + 75 scan sources. Always in system prompt.
- **Hebrew apostrophe search broken (FIXED 2026-05-06):** "קרן צ׳ק פוינט" not found because ׳ (U+05F3 geresh) ≠ ' (U+0027 apostrophe) in DB. Added `normalizeApostrophes()` + apostrophe-stripped fallback in `searchName()`. Also added Strategy 0: full-phrase search including stopwords (catches "קרן X", "חברת Y", "עמותת Z").
- **Rebranding → Goldfish (2026-05-06):** שם מותג = Goldfish, קוד פנימי = fishgold (exports, events, filenames). ריפו הועבר ל-golanliron/goldfish. דומיין: goldfish.co.il.
- **Landing page: הסרת AI (2026-05-06):** הוסרו כל אזכורי "AI/בינה מלאכותית" מדף הנחיתה. סלוגן חדש: "סורק · מתאים · כותב הגשות"
- **היסטוריה tab הוסרה (2026-05-06):** הוסרה מ-SidebarPanel, layout mobile tabs, ChatPanel, types. SidebarTab = org|opportunities|business|foundations
- **excludeDomains bug (FIXED 2026-05-06):** excludeDomains היה מחושב אבל אף פעם לא נבדק ב-scoreDNAMatch! PRIMA (חקלאות/מים) קיבל 60% להופה. תוקן עם domain negative matching + mixed-domain penalty + AI prompt hardening
- **חשיבה יצירתית בהתאמה (2026-05-06):** Goldfish כבר לא פוסל אוטומטית — קודם מחפש זווית יצירתית שמחברת (צעירות→נשים, טכנולוגיה→חדשנות, פריפריה→אוכלוסיות מגוונות). רק אם אין שום חיבור — שולל + מציע אלטרנטיבה. עיקרון: "הארגון הוא יותר מהגדרה אחת"
