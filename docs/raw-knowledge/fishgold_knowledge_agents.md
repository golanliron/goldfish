# סוכני ידע של Goldfish — מפת מוח מלאה

## ארכיטקטורה
Goldfish טוען 6 שכבות ידע במקביל בכל בקשת צ'אט. כל שכבה = סוכן חכם שנטען ל-system prompt.

## 6 סוכני ידע פעילים (Promise.all)

### 1. סוכן חברות — loadCompaniesIndex()
-> [project_fishgold.md](project_fishgold.md) — Companies Knowledge Pipeline
- 954 חברות וארגונים, מקובצים לפי סוג (business/public/private/fund)
- שם, תחומי עניין, סכום תרומה, דירוג CSR
- חיפוש דו-כיווני: findSpecificCompany() (3 כיוונים + ilike)

### 2. סוכן קולות קוראים — loadGrantsIndex()
-> [fishgold_grants_knowledge.md](fishgold_grants_knowledge.md)
- כל 428 הקולות הקוראים מ-grants DB
- מקובצים: פתוחים / ללא דדליין / סגורים
- כולל: כותרת, גוף, דדליין, סכום, תחומים, אוכלוסיות, URL, תיאור, תנאי סף, הגשה, קשר

### 3. סוכן גופים מממנים — loadFundersIndex()
-> [fishgold_funder_intelligence.md](fishgold_funder_intelligence.md)
- 38+ גופים מאוגרגציה של grants
- 75 מקורות סריקה (grant_sources)
- מודיעין עומק על 12 גופים מרכזיים (hardcoded)
- לכל גוף: כמות grants, תחומים, אוכלוסיות, סכומים, טיפים

### 4. סוכן הזדמנויות — scanOpportunities()
- סריקת התאמה: profiled org vs active grants
- Claude Haiku scoring (top 15 -> ציון 1-100)
- שמירת matches ל-DB
- DNA-based matching (org-dna.ts)

### 5. סוכן חברות מותאמות — scanCompanies()
- keyword scoring: org focus areas vs company interests
- Claude Haiku scoring (top 20 -> ציון 1-10)
- טיפ לפנייה לכל חברה

### 6. סוכן ידע מגזרי — loadSectorIntelligence()
- sector_knowledge topics
- daily digest
- sector_intelligence (news, trends)

## שכבות ידע נוספות (לא Promise.all, תמיד פעיל)
- **System Prompt** — אישיות, כללי ברזל, מומחיות
- **Org Context** — buildOrgContext (פרופיל + מסמכים)
- **Knowledge Chunks** — loadAllChunks (RAG)
- **Tab Focus** — TAB_FOCUS per active tab
- **URL Content** — fetchUrls + learnFromUrls

## סדר הזרקה ל-System Prompt
```
FISHGOLD_SYSTEM_PROMPT
+ FISHGOLD_GRANT_EXPERTISE
+ FISHGOLD_SECTOR_KNOWLEDGE
+ tabFocus
+ orgContext
+ docSummary
+ knowledge (chunks)
+ rag
+ opportunityContext (scan results)
+ companyContext (scan results)
+ companiesIndex (954 companies)
+ grantsIndex (428 grants)
+ fundersIndex (38+ funders + 75 sources)
+ sectorContext (sector intelligence)
```

## קבצי זיכרון (סוכנים חכמים)
| קובץ | תפקיד |
|---|---|
| fishgold_personality.md | אופי, סגנון, משפטי חתימה |
| fishgold_behavior_rules.md | 9 כללי ברזל |
| fishgold_funder_intelligence.md | מודיעין 38+ גופים + 75 מקורות |
| fishgold_grants_knowledge.md | ידע על מענקים |
| fishgold_grant_writing_agent.md | כתיבת הגשות |
| fishgold_social_sector_knowledge.md | ידע מגזר שלישי |
| fishgold_nonprofits_db_part1/2.md | מאגר עמותות |
| fishgold_developer_handoff.md | מידע טכני למפתחים |
| project_fishgold.md | מפת הפרויקט המלאה |
