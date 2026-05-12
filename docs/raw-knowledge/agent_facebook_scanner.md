---
name: agent_facebook_scanner
description: סוכן סריקת פייסבוק — מודיעין מגזר שלישי (2026-05-05)
type: agent
---

## תפקיד

סוכן שסורק את הפייסבוק של לירון **כל יום** ומחפש תוכן רלוונטי:
- קולות קוראים חדשים
- תרומות ושותפויות
- חדשות מגזר שלישי
- סטארטאפים חברתיים ואקזיטים
- מדיניות ורגולציה

## קבצים

- **סקריפט:** `scanner/facebook_sector_scanner.py`
- **תזמון:** `scanner/schedule_facebook_scan.ps1` (יומי 07:15, אחרי סורק קולות קוראים)
- **סקיל:** `/facebook-scanner`
- **תוצאות מקומיות:** `scanner/facebook_scan_results.json` (fallback)

## מקורות סריקה

### 1. פיד אישי של לירון
- 7 ימים אחרונים
- סינון לפי ~45 מילות מפתח

### 2. קבוצות רלוונטיות
- מזהה קבוצות לפי שם/תיאור
- סורק עד 10 קבוצות, 25 פוסטים כל אחת

### 3. דפים מנוטרים (9 דפים)
- מגזר 3, שתיל, מעבורת, GuideStar, SFI, כל זכות, ג'וינט, מידות, מעבורת

### 4. דף הופה — תגובות
- מזהה מגיבים שקשורים למגזר (לידים פוטנציאליים)

## שמירה ב-Supabase

### sector_intelligence
- source: `facebook_feed` / `facebook_group:שם` / `facebook_page:שם` / `facebook_hopa_comments`
- כל השדות הרגילים: title, summary, category, entities, tags, relevance_score

### sector_knowledge
- topic: `facebook_digest_YYYY_WNN`
- סיכום שבועי מנותח

## כלל ברזל: אמינות!
- **high** = מקור רשמי (ממשלה, קרן, עמותה מוכרת) — תמיד נשמר
- **medium** = מקור מוכר — נשמר אם relevance >= 40
- **low** = פוסט אישי/שמועה — נשמר רק אם relevance >= 60
- spam, MLM, מידע מפוקפק → skip=true

## טוקנים
- `FB_USER_TOKEN` — Long-Lived User Token (תוקף 60 יום, לרענן!)
- `FB_PAGE_TOKEN` — Page Access Token (קבוע, מוגדר ב-social-post.md)
- נדרשות הרשאות: user_posts, groups_access_member_info, pages_read_engagement

## שילוב עם Goldfish
- הצ'אט טוען sector_knowledge + sector_intelligence אוטומטית
- ממצאי פייסבוק זמינים בשיחה יחד עם ממצאי חדשות (sector_scanner.py)
- Goldfish יודע לציין מקור: "לפי סריקת פייסבוק מהשבוע"
