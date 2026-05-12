# Goldfish — הפרדה מוחלטת: חברות vs קרנות ופדרציות
> תאריך: 2026-05-06 | עדיפות: קריטית | באג קיים!

---

## הבעיה הנוכחית

כרגע במערכת, חברות ופדרציות מעורבבים:
- הכותרת אומרת "964 חברות וארגונים" — אבל זה כולל גם פדרציות וקרנות
- הפדרציות (12) מופיעות כפילטר בתוך לשונית החברות
- הספירה "96 מותאמים" מערבבת חברות + קרנות + פדרציות

**זה שגוי.** חברות עסקיות ופדרציות/קרנות הם עולמות שונים לגמרי.

---

## מה צריך להיות

### לשונית "חברות עסקיות"
- **רק:** business (524) + public (224) + private (114) = **862 חברות**
- **כותרת:** "862 חברות עסקיות"
- **פילטרים:** עסקיות / ציבוריות / פרטיות
- **התאמה:** לפי CSR interests, donation_amount, תחום
- **ספירה נפרדת:** "X מותאמים לארגון" — רק חברות!

### לשונית "קרנות ופדרציות"
- **רק:** fund (92) + federations (150+) = **~242 גופים**
- **כותרת:** "242 קרנות ופדרציות"
- **פילטרים:** קרנות בינלאומיות / פדרציות יהודיות / קרנות ישראליות
- **התאמה:** לפי grant programs, Israel focus, target populations
- **ספירה נפרדת:** "X מותאמים לארגון" — רק קרנות ופדרציות!

---

## שינויים נדרשים

### 1. DB — הוספת company_type לפדרציות

הפדרציות כרגע אולי ב-companies עם type='fund'. צריך להבדיל:

```sql
-- אופציה א: הוספת type חדש
UPDATE companies SET company_type = 'federation'
WHERE name ILIKE '%federation%' OR name ILIKE '%פדרציה%';

-- אופציה ב: שדה is_federation
ALTER TABLE companies ADD COLUMN is_federation BOOLEAN DEFAULT false;
```

### 2. API — שאילתות נפרדות

```typescript
// לשונית חברות עסקיות
const companies = await supabase
  .from('companies')
  .select('*')
  .in('company_type', ['business', 'public', 'private'])
  .eq('active', true);

// לשונית קרנות ופדרציות
const foundations = await supabase
  .from('companies')
  .select('*')
  .in('company_type', ['fund', 'federation'])
  .eq('active', true);
```

### 3. UI — כותרות וספירות נפרדות

```typescript
// לשונית חברות
<h2>{companiesCount} חברות עסקיות</h2>
<p>{matchedCompaniesCount} מותאמים לארגון</p>

// לשונית קרנות ופדרציות
<h2>{foundationsCount} קרנות ופדרציות</h2>
<p>{matchedFoundationsCount} מותאמים לארגון</p>
```

### 4. Chat — TAB_FOCUS נפרד (כבר מוגדר ב-spec_tab_aware_chat.md)

- `business` tab → מומחה CSR, רק חברות
- `foundations` tab → מומחה פילנתרופיה, רק קרנות ופדרציות

---

## כלל ברזל

**חברות עסקיות ≠ קרנות ופדרציות**

- אל תערבב בספירות
- אל תערבב בפילטרים
- אל תערבב ב-matching
- אל תערבב בצ'אט
- כל אחד בלשונית שלו, עם מומחיות שלו
