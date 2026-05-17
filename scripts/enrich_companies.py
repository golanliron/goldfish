"""
Goldfish — AI Company Enrichment Pipeline
מעשיר חברות חסרות תיאור ב-DB דרך Gemini API
"""

import os
import json
import sys
import time
import requests
from datetime import datetime, timezone

# ─── Config ───────────────────────────────────────────────
SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment.")
    sys.exit(1)
if not GEMINI_API_KEY:
    print("ERROR: GEMINI_API_KEY must be set in environment.")
    sys.exit(1)

GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={GEMINI_API_KEY}"

BATCH_SIZE = 20        # כמה חברות לעשות בפעם אחת
DELAY_SECONDS = 1.5    # השהייה בין קריאות (rate limit)
MAX_COMPANIES = 800    # מקסימום בהרצה אחת (שנה ל-None להכל)

# ─── Supabase helpers ──────────────────────────────────────

def sb_get(path, params=None):
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{path}", headers=headers, params=params)
    r.raise_for_status()
    return r.json()

def sb_patch(table, row_id, data):
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{row_id}",
        headers=headers,
        json=data
    )
    r.raise_for_status()

# ─── Data quality score ────────────────────────────────────

def calc_quality(company: dict) -> int:
    score = 0
    if company.get("name"): score += 10
    desc = company.get("description") or ""
    if len(desc) >= 150: score += 25
    elif len(desc) >= 50: score += 15
    if company.get("interests") and len(company["interests"]) > 0: score += 20
    if company.get("contact_email"): score += 25
    if company.get("website"): score += 10
    if company.get("contact_name"): score += 10
    return min(score, 100)

# ─── Gemini enrichment ─────────────────────────────────────

def enrich_with_gemini(company: dict) -> dict | None:
    name = company["name"]
    company_type = company.get("company_type", "")
    existing_desc = company.get("description") or ""
    existing_interests = company.get("interests") or []
    existing_website = company.get("website") or ""

    type_label = {
        "business": "חברה עסקית ישראלית",
        "public": "חברה ציבורית ישראלית",
        "private": "חברה פרטית ישראלית",
        "fund": "קרן פילנתרופית",
    }.get(company_type, "ארגון")

    prompt = f"""אתה מומחה לאחריות תאגידית (CSR) ופילנתרופיה בישראל.
תפקידך: לאסוף מידע על {type_label} בשם "{name}" לצורך מאגר תרומות ארגוניות.

החזר JSON בדיוק בפורמט הזה (ללא markdown, ללא הסברים):
{{
  "description": "תיאור קצר של החברה ופעילות ה-CSR/תרומות שלה (2-4 משפטים, עברית)",
  "interests": ["תחום1", "תחום2", "תחום3"],
  "website": "כתובת אתר רשמי או null"
}}

כללים:
- description: תאר מה החברה עושה, מה תחומי ה-CSR שלה, לאיזה אוכלוסיות תורמת
- interests: עד 5 תחומים מהרשימה: חינוך, נוער, תעסוקה, בריאות, רווחה, טכנולוגיה, סביבה, קהילה, ספורט, תרבות, נשים, אוכלוסיות מוחלשות, פריפריה, ביטחון, מחקר
- website: רק אם אתה בטוח. אחרת null
- אם אין לך מידע אמין על החברה — החזר description: null
{f'- תיאור קיים (שפר אם צריך): {existing_desc}' if existing_desc else ''}
{f'- interests קיים: {existing_interests}' if existing_interests else ''}
{f'- website קיים: {existing_website}' if existing_website else ''}
"""

    try:
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.2, "maxOutputTokens": 400}
        }
        r = requests.post(GEMINI_URL, json=payload, timeout=15)
        r.raise_for_status()
        text = r.json()["candidates"][0]["content"]["parts"][0]["text"].strip()

        # נקה markdown אם יש
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        text = text.strip()

        data = json.loads(text)

        result = {}
        if data.get("description") and len(data["description"]) > 30:
            result["description"] = data["description"]
        if data.get("interests") and isinstance(data["interests"], list):
            # שמור interests קיימים + הוסף חדשים
            merged = list(set((existing_interests or []) + data["interests"]))
            result["interests"] = merged[:8]
        if data.get("website") and not existing_website:
            result["website"] = data["website"]

        return result if result else None

    except Exception as e:
        print(f"  [!] Gemini error for {name}: {e}")
        return None

# ─── Main ──────────────────────────────────────────────────

def main():
    if not SUPABASE_KEY:
        print("ERROR: Set SUPABASE_ANON_KEY environment variable")
        return

    print("Goldfish Company Enrichment Pipeline")
    print("=" * 40)

    # שלוף חברות חסרות תיאור
    params = {
        "select": "id,name,company_type,description,interests,website,contact_email,contact_name,donation_amount",
        "active": "eq.true",
        "company_type": "in.(business,public,private)",
        "or": "(description.is.null,description.lt.50)",
        "order": "donation_amount.desc.nullslast",
    }
    if MAX_COMPANIES:
        params["limit"] = str(MAX_COMPANIES)

    # שלב 1: שלוף חברות בלי תיאור
    all_companies = sb_get("companies", {
        "select": "id,name,company_type,description,interests,website,contact_email,contact_name,donation_amount",
        "active": "eq.true",
        "order": "donation_amount.desc.nullslast",
        "limit": str(MAX_COMPANIES or 1000),
    })

    # סנן רק חסרות תיאור (כולל קרנות)
    to_enrich = [
        c for c in all_companies
        if c.get("company_type") in ("business", "public", "private", "fund")
        and (not c.get("description") or len(c.get("description", "")) < 50)
    ]

    print(f"נמצאו {len(to_enrich)} חברות לעשיר")
    print(f"מעשיר בקבוצות של {BATCH_SIZE}...")
    print()

    enriched = 0
    skipped = 0

    for i, company in enumerate(to_enrich):
        name = company["name"]
        print(f"[{i+1}/{len(to_enrich)}] {name}...", end=" ", flush=True)

        result = enrich_with_gemini(company)

        if not result:
            print("דולג (אין מידע)")
            skipped += 1
            time.sleep(DELAY_SECONDS)
            continue

        # חשב data_quality אחרי העשרה
        merged_company = {**company, **result}
        quality = calc_quality(merged_company)

        now = datetime.now(timezone.utc).isoformat()
        update_data = {
            **result,
            "data_quality": quality,
            "data_source": "ai_enriched_gemini",
            "enriched_at": now,
            "updated_at": now,
        }

        try:
            sb_patch("companies", company["id"], update_data)
            print(f"OK (quality={quality})")
            enriched += 1
        except Exception as e:
            print(f"ERROR saving: {e}")
            skipped += 1

        time.sleep(DELAY_SECONDS)

    print()
    print("=" * 40)
    print(f"סיום! עושרו: {enriched} | דולגו: {skipped}")

    # עדכן data_quality לכל החברות שכבר יש להן נתונים (גם בלי enrichment)
    print("\nמחשב data_quality לחברות קיימות...")
    update_existing_quality()

def update_existing_quality():
    """עדכן data_quality לחברות שכבר יש להן מידע טוב"""
    all_companies = sb_get("companies", {
        "select": "id,name,description,interests,website,contact_email,contact_name",
        "active": "eq.true",
        "data_quality": "is.null",
        "limit": "2000",
    })

    updated = 0
    for c in all_companies:
        quality = calc_quality(c)
        if quality > 0:
            try:
                sb_patch("companies", c["id"], {
                    "data_quality": quality,
                    "data_source": "manual" if quality > 40 else "imported",
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                })
                updated += 1
            except:
                pass

    print(f"עודכנו {updated} חברות עם data_quality")

if __name__ == "__main__":
    main()
