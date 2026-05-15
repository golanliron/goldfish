"""
Goldfish — Contact Enrichment Pipeline
מחלץ מיילים ואנשי קשר CSR מאתרי החברות
"""

import os
import json
import time
import requests
import re
from datetime import datetime, timezone

# ─── Config ───────────────────────────────────────────────
SUPABASE_URL = "https://touqczopfjxcpmbxzdjr.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRvdXFjem9wZmp4Y3BtYnh6ZGpyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Nzg5MDM1NywiZXhwIjoyMDkzNDY2MzU3fQ.rjr4XAb1jskScBwyp9bnpjyfNrQu0CgZTZ3QTIqvpqY"
GEMINI_API_KEY = "AIzaSyDAgELlXCiGJRtGeDtpw9sUi0fgEvLKJEA"
GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={GEMINI_API_KEY}"

DELAY_SECONDS = 2.0
MAX_COMPANIES = 300

# דפים נפוצים לCSR בחברות ישראליות
CSR_PATHS = [
    "/csr", "/responsibility", "/community", "/social-responsibility",
    "/about/csr", "/about/community", "/about/responsibility",
    "/אחריות-תאגידית", "/קהילה", "/אודות/קהילה",
    "/sustainability", "/esg",
]

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

# ─── Web scraping ──────────────────────────────────────────

def fetch_page(url: str, timeout=8) -> str | None:
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        "Accept-Language": "he-IL,he;q=0.9,en;q=0.8",
    }
    try:
        r = requests.get(url, headers=headers, timeout=timeout, allow_redirects=True)
        if r.status_code == 200:
            return r.text[:15000]  # רק 15K תווים ראשונים
    except:
        pass
    return None

def find_csr_page(base_url: str) -> str | None:
    base = base_url.rstrip("/")
    if not base.startswith("http"):
        base = f"https://{base}"

    for path in CSR_PATHS:
        url = f"{base}{path}"
        try:
            r = requests.head(url, timeout=5, allow_redirects=True)
            if r.status_code == 200:
                return url
        except:
            continue
    return None

def extract_emails_from_html(html: str) -> list[str]:
    emails = re.findall(r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}', html)
    # סנן כתובות מזויפות
    filtered = [
        e for e in emails
        if not any(skip in e.lower() for skip in [
            'example', 'test', 'noreply', 'no-reply', 'spam',
            '.png', '.jpg', '.gif', 'sentry', 'wix', 'placeholder'
        ])
    ]
    return list(set(filtered))[:5]

# ─── Gemini contact extraction ─────────────────────────────

def extract_contact_with_gemini(company_name: str, html_content: str, emails_found: list) -> dict | None:
    emails_str = ", ".join(emails_found) if emails_found else "לא נמצאו"

    prompt = f"""אתה מומחה לחילוץ פרטי קשר מאתרי אינטרנט של חברות.

חברה: {company_name}
מיילים שנמצאו בדף: {emails_str}

תוכן הדף (חלקי):
{html_content[:3000]}

משימה: מצא את איש הקשר הכי מתאים לפנייה בנושא תרומות/CSR/אחריות תאגידית.

החזר JSON בדיוק (ללא markdown):
{{
  "contact_email": "המייל הכי מתאים לCSR או null",
  "contact_name": "שם איש הקשר אם נמצא או null",
  "contact_role": "תפקיד כמו מנהל CSR / רכז קהילה וכו' או null"
}}

כללים:
- תן עדיפות למיילים עם: community, csr, social, kehila, tzibur, responsibility
- אם אין מייל מתאים — החזר null
- אל תמציא — רק מה שמופיע בטקסט
"""

    try:
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.1, "maxOutputTokens": 200}
        }
        r = requests.post(GEMINI_URL, json=payload, timeout=15)
        r.raise_for_status()
        text = r.json()["candidates"][0]["content"]["parts"][0]["text"].strip()

        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        text = text.strip()

        data = json.loads(text)
        result = {}
        if data.get("contact_email"):
            result["contact_email"] = data["contact_email"]
        if data.get("contact_name"):
            result["contact_name"] = data["contact_name"]
        if data.get("contact_role"):
            result["contact_role"] = data["contact_role"]
        return result if result else None

    except Exception as e:
        return None

# ─── Main ──────────────────────────────────────────────────

def main():
    print("Goldfish Contact Enrichment Pipeline")
    print("=" * 40)

    # שלוף חברות עם אתר אבל בלי מייל
    all_companies = sb_get("companies", {
        "select": "id,name,company_type,website,contact_email",
        "active": "eq.true",
        "website": "not.is.null",
        "contact_email": "is.null",
        "order": "data_quality.desc.nullslast",
        "limit": str(MAX_COMPANIES),
    })

    to_enrich = [c for c in all_companies if c.get("website")]

    print(f"נמצאו {len(to_enrich)} חברות עם אתר ובלי מייל")
    print()

    enriched = 0
    skipped = 0

    for i, company in enumerate(to_enrich):
        name = company["name"]
        website = company["website"]
        print(f"[{i+1}/{len(to_enrich)}] {name}...", end=" ", flush=True)

        # חפש דף CSR
        csr_url = find_csr_page(website)
        page_url = csr_url or website
        html = fetch_page(page_url)

        if not html:
            print("לא נגיש")
            skipped += 1
            time.sleep(0.5)
            continue

        # חלץ מיילים מה-HTML
        emails = extract_emails_from_html(html)

        # שלח ל-Gemini לניתוח
        result = extract_contact_with_gemini(name, html, emails)

        if not result:
            print("אין קשר")
            skipped += 1
            time.sleep(DELAY_SECONDS)
            continue

        # עדכן data_quality
        now = datetime.now(timezone.utc).isoformat()
        update_data = {
            **result,
            "updated_at": now,
        }

        try:
            sb_patch("companies", company["id"], update_data)
            contact = result.get("contact_email", "")
            print(f"OK → {contact}")
            enriched += 1
        except Exception as e:
            print(f"ERROR: {e}")
            skipped += 1

        time.sleep(DELAY_SECONDS)

    print()
    print("=" * 40)
    print(f"סיום! קשרים נוספו: {enriched} | דולגו: {skipped}")

if __name__ == "__main__":
    main()
