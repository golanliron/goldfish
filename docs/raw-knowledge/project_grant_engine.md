---
name: מנוע הגשות חכם — הופה לב יוצר
description: מצב ומבנה מנוע ניתוח קולות קוראים וכתיבה אוטומטית במערכת הופה לב יוצר
type: project
---

# מנוע הגשות חכם — hopa-lev-yotzer

## מיקום פרויקט
- תיקייה: `c:\Users\golan\OneDrive\Desktop\hopa-lev-yotzer`
- GitHub: golanliron/hopa-lev-yotzer (branch: main)
- **URL חי:** https://hopagrants.lovable.app/
- Supabase project: vhmwijzcrqjjquxomccq
- Edge Function פעילה: `fetch-url` (ללא JWT, שולפת תוכן מ-URL)

## מסכים שנבנו (2026-03-20)

| מסך | נתיב | קובץ |
|-----|------|------|
| דשבורד | / | Index.tsx |
| קולות קוראים + הוספה | /calls | Calls.tsx |
| ניתוח וכתיבה AI | /grant-analysis | GrantAnalysisPage.tsx |
| קרנות | /funds | Funds.tsx |
| הזדמנויות | /opportunities | Opportunities.tsx |
| ניתוח AI (ישן) | /ai-analysis | AIAnalysis.tsx |
| פרויקטי הופה | /projects | Projects.tsx |
| מסמכי הגשה (multi-upload) | /documents | Documents.tsx |
| תוכן הופה (knowledge base) | /knowledge | HopaKnowledge.tsx |
| תקציב (3 תרחישים) | /budget | Budget.tsx |
| שותפויות + פגישות | /partners | Partners.tsx |
| הגדרות | /settings | SettingsPage.tsx |

## טבלאות Supabase שנוצרו
- `grants` — קולות קוראים
- `scanner_calls` — הזדמנויות פעילות
- `hopa_projects` — פרויקטים
- `hopa_documents` — מסמכי הגשה (Storage bucket: "documents")
- `hopa_knowledge` — מאגר ידע (Storage bucket: "hopa-knowledge")
- `hopa_budget` — תקציב (3 תרחישים × 4 שורות)
- `resource_contacts` — שותפויות/גיוס (מ-Monday board 5088494589)
- `meetings` — פגישות ופולאפ
- `grant_analyses` — ניתוחי קולות קוראים שמורים

## מנוע ניתוח קולות קוראים
- Claude API: claude-sonnet-4-6, מפתח ב-localStorage ("hopa_claude_api_key")
- Hook: `useGrantAnalyses.ts` — save/updateAnswers/updateStatus/remove
- Hook: `useHopaKnowledge.ts` — buildContext() לבניית הקשר למאגר הידע
- GrantAnalysisPage מחזיר JSON מובנה: summary, fit, questions, answers, gaps
- כל תשובה: draft + source + status (ready/needs_review/missing_info)

## תיקון חשוב — שמות קבצים עם עברית
useHopaKnowledge.ts ו-useDocuments.ts כוללים פונקציית safeStorageName()
שמנקה עברית מ-storage path לפני העלאה ל-Supabase Storage.

## חסר (נכון ל-2026-03-20)
- יצוא לWord/PDF של טיוטת הגשה
- היסטוריית ניתוחים שמורים (רשימה ב-UI)
- דף מחקר ונתונים (research_articles table + UI)
