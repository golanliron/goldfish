"""
Enrich active grants with contact_info extracted from their URLs.
Pulls phone numbers, emails, and funder website from grant pages.
Uploads results to Goldfish DB.
"""
import re
import json
import sys
import requests
import urllib3
from html import unescape
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

SUPABASE_URL = "https://touqczopfjxcpmbxzdjr.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRvdXFjem9wZmp4Y3BtYnh6ZGpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4OTAzNTcsImV4cCI6MjA5MzQ2NjM1N30.K16QAHB3IwRnHJl_XxtcWjnxzggF-Z3gtTrestlq-ek"

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}

BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept-Language": "he-IL,he;q=0.9,en;q=0.8",
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
}

# Patterns
PHONE_RE = re.compile(r'(?:טלפון|טל|phone|tel)[\s:]*([0-9\-\s\(\)]{7,15})|(?<!\d)(0[2-9]\d?[\-\s]?\d{3}[\-\s]?\d{4})(?!\d)')
EMAIL_RE = re.compile(r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}')
# Skip generic emails
SKIP_EMAILS = {'example@example.com', 'info@info.com', 'test@test.com'}


def clean_html(text):
    text = re.sub(r'<script[^>]*>.*?</script>', '', text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r'<style[^>]*>.*?</style>', '', text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = unescape(text)
    return re.sub(r'\s+', ' ', text).strip()


def extract_contact_from_page(url):
    """Fetch a grant page and extract contact info."""
    try:
        resp = requests.get(url, headers=BROWSER_HEADERS, timeout=20, verify=False)
        if resp.status_code != 200:
            return None
        html = resp.text
        text = clean_html(html)
    except Exception:
        return None

    phones = []
    for m in PHONE_RE.finditer(text):
        phone = (m.group(1) or m.group(2) or '').strip()
        phone = re.sub(r'[\s\(\)]', '', phone)
        if phone and len(phone) >= 7 and phone not in phones:
            phones.append(phone)

    emails = []
    for m in EMAIL_RE.finditer(text):
        email = m.group(0).lower()
        if email not in SKIP_EMAILS and email not in emails:
            emails.append(email)

    if not phones and not emails:
        return None

    parts = []
    if phones:
        parts.append("tel: " + ", ".join(phones[:3]))
    if emails:
        parts.append("email: " + ", ".join(emails[:3]))
    return " | ".join(parts)


def get_active_grants():
    """Get all active grants missing contact_info."""
    url = f"{SUPABASE_URL}/rest/v1/opportunities?active=eq.true&contact_info=is.null&select=id,title,url,funder"
    resp = requests.get(url, headers=HEADERS)
    grants = resp.json()
    # Also get ones with empty string
    url2 = f"{SUPABASE_URL}/rest/v1/opportunities?active=eq.true&contact_info=eq.&select=id,title,url,funder"
    resp2 = requests.get(url2, headers=HEADERS)
    grants.extend(resp2.json())
    return grants


def update_contact(grant_id, contact_info):
    """Update contact_info via REST API."""
    url = f"{SUPABASE_URL}/rest/v1/opportunities?id=eq.{grant_id}"
    resp = requests.patch(url, headers={**HEADERS, "Prefer": "return=minimal"}, json={"contact_info": contact_info})
    return resp.status_code < 300


def main():
    grants = get_active_grants()
    print(f"Found {len(grants)} active grants without contact info")

    results = {"enriched": 0, "failed": 0, "no_contact": 0}
    enriched_list = []

    for i, g in enumerate(grants):
        url = g.get("url")
        title = g.get("title", "")[:60]
        if not url:
            results["failed"] += 1
            continue

        contact = extract_contact_from_page(url)
        if contact:
            success = update_contact(g["id"], contact)
            if success:
                results["enriched"] += 1
                enriched_list.append({"title": title, "contact": contact})
                print(f"  [{i+1}/{len(grants)}] {title} -> {contact}")
            else:
                results["failed"] += 1
                print(f"  [{i+1}/{len(grants)}] PATCH FAILED: {title}")
        else:
            results["no_contact"] += 1
            if (i + 1) % 20 == 0:
                print(f"  [{i+1}/{len(grants)}] scanning...")

    print(f"\nDone! Enriched: {results['enriched']}, No contact found: {results['no_contact']}, Failed: {results['failed']}")

    # Save results
    out = Path(__file__).parent / "outputs" / "enrich_contacts_result.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"results": results, "enriched": enriched_list}, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
