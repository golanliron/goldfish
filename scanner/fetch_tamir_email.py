"""
Fetch latest תמיר שרעבי newsletter from Gmail via IMAP.
Extracts grants and uploads to shared Supabase DB (used by Fishgold).

Runs daily as part of the grants scanner pipeline.

Setup:
1. Enable IMAP in Gmail settings
2. Create App Password: Google Account > Security > 2-Step Verification > App Passwords
3. Set GMAIL_APP_PASSWORD environment variable (or edit below)
"""
import sys
import re
import imaplib
import email
from email.header import decode_header
from datetime import datetime, timedelta
from pathlib import Path
import json
import requests

sys.stdout.reconfigure(encoding='utf-8')

# Config
GMAIL_USER = "golanliron1@gmail.com"
GMAIL_APP_PASSWORD = ""  # Set via env var or edit here

OUTPUT_DIR = Path(__file__).parent / "outputs"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
CACHE_FILE = OUTPUT_DIR / "tamir_latest.txt"

SUPABASE_URL = "https://vhmwijzcrqjjquxomccq.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZobXdpanpjcnFqanF1eG9tY2NxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1Nzk0MDgsImV4cCI6MjA4OTE1NTQwOH0.rMnAcdMiPddUAoap63tMiqeQQanJoF-HDmzra7P-5Cc"

HEADERS_SUPABASE = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}


def extract_date(text):
    """Extract date from text (DD/MM/YYYY format)."""
    if not text:
        return None
    m = re.search(r'(\d{1,2})[./](\d{1,2})[./](20\d{2})', text)
    if m:
        d, mo, y = m.groups()
        return f"{y}-{mo.zfill(2)}-{d.zfill(2)}"
    return None


def fetch_latest_tamir_email():
    """Connect to Gmail via IMAP and fetch latest תמיר email."""
    import os
    password = os.environ.get("GMAIL_APP_PASSWORD", GMAIL_APP_PASSWORD)
    if not password:
        print("  [tamir-fetch] No GMAIL_APP_PASSWORD set. Using cached file.")
        return None

    try:
        mail = imaplib.IMAP4_SSL("imap.gmail.com")
        mail.login(GMAIL_USER, password)
        mail.select("inbox")

        # Search for recent emails from Tamir (last 14 days)
        since_date = (datetime.now() - timedelta(days=14)).strftime("%d-%b-%Y")
        _, messages = mail.search(None, f'(FROM "tamir@tamir-s.co.il" SINCE {since_date})')

        msg_ids = messages[0].split()
        if not msg_ids:
            print("  [tamir-fetch] No recent emails from Tamir.")
            mail.logout()
            return None

        # Get the latest one
        _, msg_data = mail.fetch(msg_ids[-1], "(RFC822)")
        raw_email = msg_data[0][1]
        msg = email.message_from_bytes(raw_email)

        # Extract body
        body = ""
        if msg.is_multipart():
            for part in msg.walk():
                if part.get_content_type() == "text/plain":
                    charset = part.get_content_charset() or "utf-8"
                    body = part.get_payload(decode=True).decode(charset, errors="replace")
                    break
                elif part.get_content_type() == "text/html" and not body:
                    charset = part.get_content_charset() or "utf-8"
                    html = part.get_payload(decode=True).decode(charset, errors="replace")
                    # Strip HTML tags
                    body = re.sub(r'<[^>]+>', '\n', html)
                    body = re.sub(r'&nbsp;', ' ', body)
                    body = re.sub(r'\n{3,}', '\n\n', body)
        else:
            charset = msg.get_content_charset() or "utf-8"
            body = msg.get_payload(decode=True).decode(charset, errors="replace")

        mail.logout()

        if body:
            # Clean up
            body = re.sub(r'https://trailer\.web-view\.net/[^\s]+', '', body)
            body = re.sub(r'\u200c+', '', body)
            body = re.sub(r'\n{3,}', '\n\n', body)
            body = body.strip()

            # Save cache
            CACHE_FILE.write_text(body, encoding="utf-8")
            print(f"  [tamir-fetch] Saved latest email ({len(body)} chars)")
            return body

    except Exception as e:
        print(f"  [tamir-fetch] Error: {e}")
        return None


def parse_tamir_grants(text):
    """Parse grants from תמיר's newsletter text."""
    results = []
    if not text:
        return results

    lines = [l.strip() for l in text.split('\n') if l.strip()]

    current_funder = ""
    skip_words = ['קישור', 'תאריך אחרון', 'מפרסם', 'למדריך', 'בשורות טובות',
                  'אין מכרזים', 'אין טיוטות', 'שלום לכולם', 'להלן רשימת',
                  'כדי להקל', 'אשמח לקבל', 'כאן ניתן', 'תמיר שרעבי',
                  'למען הסר', 'נשלח באמצעות', 'ActiveTrail', 'הסר', 'דווח כספאם',
                  'טלפון:', 'כתובת:', 'מייל:', 'אתר:']

    i = 0
    while i < len(lines):
        line = lines[i]

        # Skip noise
        if any(sw in line for sw in skip_words) or len(line) < 5:
            i += 1
            continue

        # Detect funder headers (short lines with known org types)
        if len(line) < 50 and any(kw in line for kw in ['משרד', 'קרן', 'רשות', 'הסוכנות', 'ועדת']):
            current_funder = line
            i += 1
            continue

        # Detect section headers
        if any(kw in line for kw in ['משרדי ממשלה', 'תמיכות שונות', 'מכרזים', 'טיוטת']):
            i += 1
            continue

        # Check if this line is a grant title (followed by a date)
        if i + 1 < len(lines):
            next_line = lines[i + 1]
            deadline = extract_date(next_line)

            if deadline and len(line) > 10:
                results.append({
                    "title": line[:300],
                    "deadline": deadline,
                    "source": "tamir_newsletter",
                    "type": "kok",
                    "status": "open",
                    "funder": current_funder or None,
                    "is_database": True,
                })
                i += 2  # Skip the date line
                continue

        i += 1

    # Deduplicate
    seen = set()
    unique = []
    for r in results:
        if r["title"] not in seen:
            seen.add(r["title"])
            unique.append(r)

    return unique


def upload_grants(grants):
    """Upload extracted grants to Supabase (shared grants DB)."""
    if not grants:
        return 0

    # Check existing titles to avoid duplicates
    try:
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/grants?select=title&is_database=eq.true&source=eq.tamir_newsletter",
            headers=HEADERS_SUPABASE,
            timeout=30
        )
        existing_titles = {item["title"] for item in resp.json()} if resp.status_code == 200 else set()
    except:
        existing_titles = set()

    new_grants = [g for g in grants if g["title"] not in existing_titles]
    if not new_grants:
        print(f"  [tamir-upload] All {len(grants)} grants already in DB.")
        return 0

    rows = []
    for g in new_grants:
        rows.append({
            "title": g["title"],
            "deadline": g.get("deadline"),
            "source": "tamir_newsletter",
            "source_type": "kok",
            "type": "kok",
            "status": "open",
            "funder": g.get("funder"),
            "is_database": True,
            "is_new": True,
            "foundation_name": (g.get("funder") or g["title"])[:80],
            "categories": [],
            "target_populations": [],
            "tags": [],
        })

    resp = requests.post(
        f"{SUPABASE_URL}/rest/v1/grants",
        headers={**HEADERS_SUPABASE, "Prefer": "return=minimal"},
        json=rows
    )

    if resp.status_code < 300:
        print(f"  [tamir-upload] Uploaded {len(rows)} new grants!")
        return len(rows)
    else:
        print(f"  [tamir-upload] Failed ({resp.status_code}): {resp.text[:100]}")
        return 0


def main():
    print("=== Tamir Newsletter Scanner ===")

    # Step 1: Fetch latest email (or use cache)
    body = fetch_latest_tamir_email()
    if not body and CACHE_FILE.exists():
        body = CACHE_FILE.read_text(encoding="utf-8")
        print(f"  Using cached file ({len(body)} chars)")

    if not body:
        print("  No email content available.")
        return

    # Step 2: Parse grants
    grants = parse_tamir_grants(body)
    print(f"  Found {len(grants)} grants in newsletter")

    for g in grants:
        print(f"    - {g['title']} | {g.get('deadline', 'N/A')} | {g.get('funder', '')}")

    # Step 3: Upload to Supabase
    uploaded = upload_grants(grants)
    print(f"\n  Done. Uploaded: {uploaded}")


if __name__ == "__main__":
    main()
