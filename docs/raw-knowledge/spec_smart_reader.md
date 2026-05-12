# Goldfish — Smart Reader: קריאת מסמכים חכמה
> תאריך: 2026-05-06

---

## מה זה Smart Reader?

המשתמש מעלה קובץ (PDF, DOCX, URL, LinkedIn) → Goldfish קורא, מסווג, חותך ל-chunks, ושומר ב-RAG.
מהרגע הזה Goldfish "זוכר" את המסמך ויכול להשתמש בו בכל שיחה.

---

## זרימה

```
משתמש מעלה קובץ / מדביק URL
    ↓
[1] חילוץ טקסט (PDF→text, DOCX→text, URL→fetch+parse, LinkedIn→parse)
    ↓
[2] AI סיווג: מה סוג המסמך? (דוח כספי / אימפקט / מצגת / קול קורא / אחר)
    ↓
[3] AI חילוץ מובנה: מחלץ שדות רלוונטיים לפי סוג
    ↓
[4] Chunking: חיתוך ל-chunks של ~500 tokens עם overlap
    ↓
[5] שמירה ב-Supabase: org_documents + org_chunks
    ↓
[6] זמין ב-RAG לכל שיחה עתידית
```

---

## סוגי מסמכים נתמכים

### PDF
- **ספרייה:** pdf-parse (server-side)
- **מגבלה:** עד 50 עמודים, 100K תווים
- **טיפול מיוחד:** סרוקים (OCR) — לא נתמך כרגע, הודעה למשתמש

### DOCX
- **ספרייה:** mammoth (server-side)
- **מגבלה:** עד 100K תווים
- **מחלץ:** טקסט + כותרות + טבלאות

### URL (אתר)
- **שיטה:** Edge Function `fetch-url` → cheerio parse
- **מחלץ:** title, meta description, main content (מסיר nav/footer/ads)
- **מגבלה:** עד 50K תווים

### LinkedIn Profile
- **שיטה:** URL → fetch → parse structured data
- **מחלץ:** שם, תפקיד, חברה, ניסיון, חינוך
- **שימוש:** זיהוי אנשי קשר פוטנציאליים

---

## AI סיווג — מה המסמך?

```typescript
const DOC_TYPES = [
  'financial_report',    // דוח כספי שנתי
  'impact_report',       // דוח אימפקט / תוצאות
  'presentation',        // מצגת ארגון
  'grant_proposal',      // הגשה קודמת
  'call_for_proposals',  // קול קורא
  'strategic_plan',      // תכנית אסטרטגית
  'budget',              // תקציב פרויקט
  'legal',               // מסמך ניהול תקין / תקנון
  'article',             // כתבה / פרסום
  'other',               // אחר
];
```

**Prompt לסיווג:**
```
קרא את הטקסט הבא וזהה את סוג המסמך.
החזר JSON: { type: string, confidence: number, summary: string }
```

---

## AI חילוץ מובנה — לפי סוג

### financial_report
```json
{
  "year": 2025,
  "total_income": 2500000,
  "total_expenses": 2300000,
  "government_funding": 1200000,
  "donations": 800000,
  "self_income": 500000,
  "staff_costs": 1500000,
  "program_costs": 600000
}
```

### impact_report
```json
{
  "year": 2025,
  "beneficiaries": 1200,
  "programs": ["mentoring", "employment", "education"],
  "key_metrics": [
    { "name": "שיעור מניעת נשירה", "value": 87, "unit": "%" },
    { "name": "משתתפים שהשתלבו בתעסוקה", "value": 156, "unit": "אנשים" }
  ],
  "highlights": ["פרס חינוך", "הרחבה ל-3 ערים"]
}
```

### call_for_proposals
```json
{
  "funder": "קרן רש\"י",
  "title": "נוער בסיכון — תכנית מענה 2026",
  "deadline": "2026-06-15",
  "amount_max": 500000,
  "eligibility": ["ניהול תקין", "3 שנות פעילות", "סעיף 46"],
  "categories": ["youth", "welfare"],
  "url": "https://..."
}
```

---

## Chunking Strategy

```typescript
function chunkText(text: string, maxTokens = 500, overlap = 50): string[] {
  // 1. פיצול לפי פסקאות
  // 2. אם פסקה > maxTokens → פיצול לפי משפטים
  // 3. overlap: כל chunk מתחיל עם 50 tokens אחרונים מה-chunk הקודם
  // 4. כל chunk מקבל metadata: { doc_id, chunk_index, doc_type }
}
```

**למה overlap?** כדי ש-RAG לא יפספס מידע שחצוי בין chunks.

---

## שמירה ב-Supabase

### org_documents
```sql
CREATE TABLE org_documents (
  id UUID PRIMARY KEY,
  org_id UUID REFERENCES organizations(id),
  title TEXT,
  doc_type TEXT,              -- financial_report, impact_report, etc.
  original_filename TEXT,
  extracted_data JSONB,       -- structured data from AI extraction
  summary TEXT,               -- AI-generated summary
  total_chunks INT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### org_chunks (for RAG)
```sql
CREATE TABLE org_chunks (
  id UUID PRIMARY KEY,
  doc_id UUID REFERENCES org_documents(id),
  org_id UUID,
  chunk_index INT,
  content TEXT,               -- the actual text chunk
  embedding VECTOR(1536),     -- for semantic search (optional, future)
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_chunks_org ON org_chunks(org_id);
```

---

## RAG — איך Goldfish משתמש במסמכים

### בכל שיחה:
```typescript
async function loadRAGContext(orgId: string, query: string): Promise<string> {
  // 1. חיפוש keyword ב-chunks
  const { data } = await supabase
    .from('org_chunks')
    .select('content, doc_id')
    .eq('org_id', orgId)
    .textSearch('content', query)
    .limit(10);

  // 2. הרכבת context string
  return data.map(c => c.content).join('\n---\n');
}
```

### בעתיד — semantic search:
```typescript
// עם embeddings:
const embedding = await getEmbedding(query);
const { data } = await supabase.rpc('match_chunks', {
  query_embedding: embedding,
  match_threshold: 0.7,
  match_count: 10,
  p_org_id: orgId,
});
```

---

## UX — איך זה נראה למשתמש

1. **כפתור "העלה מסמך"** בלשונית העמותה
2. **drag & drop** או בחירת קובץ
3. **progress:** "קורא את המסמך... מסווג... שומר..."
4. **סיכום:** "קראתי את הדוח הכספי ל-2025. הנה מה שלמדתי: [סיכום]"
5. **רשימת מסמכים:** המשתמש רואה כל מה שהעלה + סיכום AI לכל אחד
6. **בצ'אט:** "הדבק לינק" → Smart Reader מפעיל אוטומטית

---

## מגבלות ידועות

- PDF סרוק (תמונה) → לא נתמך, צריך OCR
- קבצי Excel → לא נתמך כרגע (עתידי)
- קבצים מעל 10MB → דחייה
- עברית ב-PDF → לפעמים בעיות encoding, צריך בדיקה
