# סוכן מודיעין גופים מממנים — Funder Intelligence Agent

## תפקיד
Goldfish מכיר כל גוף מממן בישראל לעומק. לא רק שם ולינק — אלא מה הם אוהבים, מה מכשיל, כמה נותנים, ומתי לפנות.

## מימוש טכני
- `loadFundersIndex()` ב-`src/app/api/chat/route.ts`
- טוען מ-grants DB (vhmwijzcrqjjquxomccq) — מצליב funder מול כל הגרנטים שלו
- מצרף 75 scan sources מ-Supabase הראשי (touqczopfjxcpmbxzdjr)
- כולל מודיעין עומק hardcoded על 12 גופים מרכזיים
- נטען במקביל עם כל שאר הידע (Promise.all)
- מוזרק ל-system prompt בכל בקשת צ'אט

## מאגר גופים מממנים — 38+ גופים מזוהים
נבנה מאגרוגציה של grants לפי funder. לכל גוף:
- כמות קולות קוראים (היסטורי + פתוחים)
- תחומים שהם ממנים
- אוכלוסיות יעד
- טווח סכומים
- דוגמאות קולות קוראים
- לינקים

## מודיעין עומק — 12 גופים מרכזיים

### ממשלתיים
1. **משרד החינוך** — מדדים כמותיים, שפה פורמלית, יעדים SMART, שיתוף רשויות. דדליינים: אוגוסט-ספטמבר
2. **ביטוח לאומי** — קרנות ייעודיות (מוגבלות, קשישים, ילדים). בירוקרטי, 46א חובה. 50K-500K
3. **מפעל הפיס** — פריפריה, נגישות, קהילה, תרבות. 20K-300K. תהליך פשוט יחסית
4. **ועדת העיזבונות** — 100K-2M, רווחה + חינוך. תהליך ארוך, מסמכים רבים

### קרנות ישראליות
5. **קרן עזריאלי** — חינוך, מדע, מנהיגות, ספורט. 100K-1M. תחרותי, מצוינות
6. **יד הנדיב (רוטשילד)** — חינוך, סביבה, אזרחות. סכומים גדולים, תהליך ארוך
7. **קרן רשי** — פריפריה (דרום ונגב), חינוך, תעסוקה. leverage ממשלתי
8. **קק"ל** — סביבה, פריפריה, חינוך. שותפויות עם רשויות

### בינלאומיות
9. **ג'וינט/JDC** — חדשנות, שיתופי פעולה, evidence-based, מדידה + למידה
10. **שוסטרמן** — חינוך יהודי, מנהיגות צעירה, ישראל-תפוצות. סגנון אמריקאי, ROI
11. **קרן ויינברג** — רווחה, בריאות, קהילה. שותפים מקומיים, ארגונים מבוססים
12. **הסוכנות היהודית** — עלייה, קליטה, זהות יהודית. חיבור ישראל-תפוצות

## 75 מקורות סריקה (grant_sources)
חלוקה לפי שכבה:
- **government (21):** tmichot.mof, gov.il, pob.education, btl.gov.il, innovationisrael, space.gov.il
- **private_il (14):** rashi, yadhanadiv, arison, azrieli, jerusalemfoundation, weinberg, schusterman, levilassen, thejoint, nif, hadassah, igul
- **international (19):** fundsforngos, grantwatch, developmentaid, britishcouncil/birax, kas.de, fes.de, eureka, wexner, jimjoseph, jewishfoundationla, unwomen, opentech, annalindhfoundation
- **aggregator (15):** shatil, socialmap, guidestar, hamal.migzar3, atlas, impala, arma, tamir-s, hackaveret, ezvonot, mashabim, ejewishphilanthropy, midot

## כללי שימוש
- כששואלים "ספר לי על קרן X" → תענה מהמודיעין
- כשמנתחים קול קורא → הוסף מודיעין על הגוף
- כשמציעים להגיש → תן טיפ ספציפי לגוף הזה
- כשמחפשים מימון → התאם גוף לפי תחום + אוכלוסייה + גיאוגרפיה
