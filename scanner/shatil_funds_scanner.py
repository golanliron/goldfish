"""
Shatil Funds Scanner — v1.0
Scans shatil.org.il/funds/ — all 72+ foundation profiles.

For each fund:
1. Extracts contact info (email, phone, contact person, website, interests)
2. Upserts into Goldfish companies table
3. If open call found with deadline → also adds to opportunities table

Runs weekly via Task Scheduler (Sunday 08:00).
"""
import re
import sys
import time
import logging
import requests
import urllib3
from datetime import datetime, date
from html import unescape
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

LOG_DIR = Path(__file__).parent / "outputs"
LOG_DIR.mkdir(parents=True, exist_ok=True)
logging.basicConfig(
    filename=str(LOG_DIR / "shatil_funds.log"),
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    encoding="utf-8",
)

GOLDFISH_URL = "https://touqczopfjxcpmbxzdjr.supabase.co"
GOLDFISH_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRvdXFjem9wZmp4Y3BtYnh6ZGpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4OTAzNTcsImV4cCI6MjA5MzQ2NjM1N30.K16QAHB3IwRnHJl_XxtcWjnxzggF-Z3gtTrestlq-ek"

HEADERS_DB = {
    "apikey": GOLDFISH_KEY,
    "Authorization": f"Bearer {GOLDFISH_KEY}",
    "Content-Type": "application/json",
}

HEADERS_BROWSER = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Accept-Language": "he-IL,he;q=0.9,en;q=0.8",
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
}

BASE = "https://shatil.org.il"


# ============================================================
# UTILS
# ============================================================

def clean(text):
    text = re.sub(r"<script[^>]*>.*?</script>", "", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<style[^>]*>.*?</style>", "", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def fetch(url, timeout=20):
    try:
        r = requests.get(url, headers=HEADERS_BROWSER, timeout=timeout, verify=False)
        if r.status_code == 200:
            return r.text
    except Exception:
        pass
    return None


def extract_date(text):
    if not text:
        return None
    m = re.search(r"(\d{1,2})[./](\d{1,2})[./](20\d{2})", text)
    if m:
        d, mo, y = m.groups()
        return f"{y}-{mo.zfill(2)}-{d.zfill(2)}"
    m = re.search(r"(20\d{2})-(\d{2})-(\d{2})", text)
    if m:
        return m.group(0)
    return None


EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
PHONE_RE = re.compile(r"(?<!\d)(0[2-9]\d?[\-\s]?\d{3}[\-\s]?\d{4})(?!\d)")
SKIP_EMAILS = {"example@example.com", "info@info.com", "test@test.com", "noreply@noreply.com"}

# Map Hebrew interest words → our taxonomy keys
INTEREST_MAP = {
    "חינוך": "education", "מדע": "science", "מחקר": "science",
    "רווחה": "welfare", "סיוע": "welfare", "ליווי": "welfare",
    "קהילה": "community", "קהילתי": "community",
    "תרבות": "culture", "אמנות": "culture", "קולנוע": "culture",
    "סביבה": "environment", "אקלים": "environment",
    "תעסוקה": "employment", "עבודה": "employment",
    "בריאות": "health", "רפואה": "health",
    "טכנולוגיה": "technology", "דיגיטל": "technology", "סייבר": "technology",
    "שינוי חברתי": "social_innovation", "יזמות חברתית": "social_innovation",
    "דו-קיום": "coexistence", "שותפות": "coexistence",
    "משפט": "legal", "זכויות": "legal",
    "ספורט": "sport",
    "פריפריה": "periphery", "נגב": "periphery", "גליל": "periphery",
}


def map_interests(raw_interests):
    """Map Hebrew interest strings to taxonomy keys."""
    result = set()
    combined = " ".join(raw_interests).lower()
    for heb, key in INTEREST_MAP.items():
        if heb in combined:
            result.add(key)
    # Keep original Hebrew too
    result.update(raw_interests[:8])
    return list(result)


# ============================================================
# STEP 1 — Get all fund URLs from listing page
# ============================================================

def get_all_fund_urls():
    """Scrape the funds listing and return all /funds/slug/ URLs."""
    urls = []
    # Paginate — shatil uses ?paged=N or loads all on one page
    listing_pages = [
        f"{BASE}/funds/",
        f"{BASE}/funds/page/2/",
        f"{BASE}/funds/page/3/",
    ]
    seen = set()
    for page_url in listing_pages:
        html = fetch(page_url)
        if not html:
            continue
        matches = re.findall(r'href="(https?://shatil\.org\.il/funds/[^"]+/)"', html)
        for u in matches:
            if u not in seen and u != f"{BASE}/funds/":
                seen.add(u)
                urls.append(u)
        if not matches:
            break
        time.sleep(0.5)

    print(f"  Found {len(urls)} fund URLs")
    return urls


# ============================================================
# STEP 2 — Parse a single fund page
# ============================================================

def parse_fund_page(url):
    """
    Parse a single /funds/slug/ page.
    Returns dict with company fields + optional open_call.
    """
    html = fetch(url)
    if not html:
        return None

    text = clean(html[:30000])

    # --- Name ---
    name = ""
    m = re.search(r"<h1[^>]*>([^<]+)</h1>", html, re.IGNORECASE)
    if m:
        name = clean(m.group(1))
    if not name:
        # fallback: title tag
        m = re.search(r"<title>([^<]+)</title>", html, re.IGNORECASE)
        if m:
            name = clean(m.group(1)).split("|")[0].strip()
    if not name or len(name) < 3:
        return None

    # --- Email ---
    emails = [e for e in EMAIL_RE.findall(text) if e not in SKIP_EMAILS and "shatil" not in e]
    contact_email = emails[0] if emails else None

    # --- Phone ---
    phones = PHONE_RE.findall(text)
    contact_phone = re.sub(r"[\s\-]", "", phones[0]) if phones else None

    # --- Contact person ---
    contact_name = None
    contact_role = None
    # Look for patterns like "שם: X" or structured field
    for pat in [
        r"(?:שם|איש קשר|Contact)[:\s]+([^\n<,]{4,40})",
        r"(?:מנהל|מנהלת|רכז|רכזת|אחראי)[:\s]*([^\n<,]{4,40})",
    ]:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            candidate = m.group(1).strip()
            if len(candidate) > 3 and not re.search(r"\d{5,}", candidate):
                contact_name = candidate[:80]
                break

    for pat in [
        r"(?:תפקיד|Role|Title)[:\s]+([^\n<,]{4,60})",
        r"(מנהל[^\n<,]{0,20}(?:CSR|אחריות|תרומ|קשרי)[^\n<,]{0,30})",
    ]:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            contact_role = m.group(1).strip()[:100]
            break

    # --- Website ---
    website = None
    ext_links = re.findall(r'href="(https?://(?!shatil)[^"]+)"', html)
    for link in ext_links:
        if not any(s in link for s in ["facebook", "twitter", "linkedin", "youtube", "google", "wp-"]):
            website = link
            break

    # --- Interests / categories ---
    interests_raw = []
    # Look for taxonomy/category tags on the page
    cat_patterns = [
        r'class="[^"]*tag[^"]*"[^>]*>([^<]+)<',
        r'class="[^"]*category[^"]*"[^>]*>([^<]+)<',
        r'(?:תחומי תמיכה|תחומים)[:\s]*([^\n<]{10,200})',
        r'(?:support|areas|תחום)[:\s]*([^\n<]{5,150})',
    ]
    for pat in cat_patterns:
        for m in re.finditer(pat, html, re.IGNORECASE):
            val = clean(m.group(1)).strip()
            if 3 < len(val) < 60 and not re.search(r"[{@]", val):
                interests_raw.append(val)

    interests = map_interests(list(set(interests_raw)))[:10]

    # --- Description ---
    description = ""
    # meta description
    m = re.search(r'<meta[^>]*name="description"[^>]*content="([^"]+)"', html, re.IGNORECASE)
    if m:
        description = clean(m.group(1))[:500]
    if not description:
        # first substantial paragraph
        m = re.search(r"<p[^>]*>(.{80,500}?)</p>", html, re.DOTALL)
        if m:
            description = clean(m.group(1))[:500]

    # --- Open call + deadline ---
    open_call = None
    deadline_str = extract_date(text)
    # Check for explicit "קול קורא פתוח" or deadline markers
    has_open = bool(re.search(r"קול קורא|הגשת בקשות|deadline|מועד הגשה|תאריך סיום", text, re.IGNORECASE))
    if has_open and deadline_str:
        # Only if deadline is in the future
        try:
            dl = datetime.strptime(deadline_str, "%Y-%m-%d").date()
            if dl >= date.today():
                # Find a title for the open call
                call_title_match = re.search(
                    r"(?:קול קורא|תכנית|מענק)[:\s]*([^\n<]{10,100})", text, re.IGNORECASE
                )
                call_title = call_title_match.group(1).strip() if call_title_match else f"קול קורא — {name}"
                open_call = {
                    "title": call_title[:300],
                    "url": url,
                    "deadline": deadline_str,
                    "funder": name,
                    "source": "shatil_funds",
                    "description": description[:500],
                }
        except ValueError:
            pass

    return {
        "name": name[:200],
        "company_type": "fund",
        "contact_email": contact_email,
        "contact_phone": contact_phone,
        "contact_name": contact_name,
        "contact_role": contact_role,
        "website": website,
        "description": description,
        "interests": [str(x) for x in interests_raw[:8]],  # store raw Hebrew strings
        "source_url": url,
        "open_call": open_call,
    }


# ============================================================
# STEP 3 — Upsert to Goldfish companies
# ============================================================

def upsert_company(fund):
    """Upsert fund into companies table. Match by name (case-insensitive)."""
    name = fund["name"]

    # Check if exists
    resp = requests.get(
        f"{GOLDFISH_URL}/rest/v1/companies?name=ilike.{requests.utils.quote(name)}&select=id,name,contact_email",
        headers=HEADERS_DB,
        timeout=15,
    )
    existing = resp.json() if resp.status_code == 200 else []

    payload = {
        "name": name,
        "company_type": "fund",
        "active": True,
        "description": fund.get("description") or None,
        "website": fund.get("website") or None,
        "interests": fund.get("interests") or [],
        "data_source": "shatil_funds",
    }
    # Only update contact fields if we actually found them (don't overwrite good data with None)
    if fund.get("contact_email"):
        payload["contact_email"] = fund["contact_email"]
    if fund.get("contact_phone"):
        payload["contact_phone"] = fund["contact_phone"]
    if fund.get("contact_name"):
        payload["contact_name"] = fund["contact_name"]
    if fund.get("contact_role"):
        payload["contact_role"] = fund["contact_role"]

    if existing:
        company_id = existing[0]["id"]
        resp = requests.patch(
            f"{GOLDFISH_URL}/rest/v1/companies?id=eq.{company_id}",
            headers={**HEADERS_DB, "Prefer": "return=minimal"},
            json=payload,
        )
        return "updated", resp.status_code
    else:
        resp = requests.post(
            f"{GOLDFISH_URL}/rest/v1/companies",
            headers={**HEADERS_DB, "Prefer": "return=minimal"},
            json=payload,
        )
        return "inserted", resp.status_code


# ============================================================
# STEP 4 — Upload open call to opportunities
# ============================================================

def upload_opportunity(call):
    """Add open call to opportunities if not already there."""
    # Check by URL
    resp = requests.get(
        f"{GOLDFISH_URL}/rest/v1/opportunities?url=eq.{requests.utils.quote(call['url'])}&select=id",
        headers=HEADERS_DB,
        timeout=10,
    )
    if resp.status_code == 200 and resp.json():
        return "exists"

    row = {
        "title": call["title"],
        "url": call["url"],
        "deadline": call["deadline"],
        "funder": call["funder"],
        "source": call["source"],
        "description": call.get("description") or None,
        "active": True,
        "type": "grant",
        "categories": [],
        "target_populations": [],
        "tags": [],
    }
    resp = requests.post(
        f"{GOLDFISH_URL}/rest/v1/opportunities",
        headers={**HEADERS_DB, "Prefer": "return=minimal"},
        json=row,
    )
    return "inserted" if resp.status_code < 300 else f"error {resp.status_code}"


# ============================================================
# MAIN
# ============================================================

def main():
    print(f"{'='*60}")
    print(f"  SHATIL FUNDS SCANNER v1.0 — {date.today()}")
    print(f"  Target: Goldfish DB — companies + opportunities")
    print(f"{'='*60}\n")

    # Step 1: get all fund URLs
    print("--- Collecting fund URLs ---")
    fund_urls = get_all_fund_urls()
    if not fund_urls:
        print("No fund URLs found. Exiting.")
        return

    # Step 2-4: process each fund
    stats = {"parsed": 0, "companies_updated": 0, "companies_inserted": 0, "open_calls": 0, "errors": 0}

    print(f"\n--- Processing {len(fund_urls)} funds ---")
    for i, url in enumerate(fund_urls, 1):
        slug = url.rstrip("/").split("/")[-1]
        print(f"  [{i}/{len(fund_urls)}] {slug[:50]}...", end=" ", flush=True)

        fund = parse_fund_page(url)
        if not fund:
            print("SKIP (parse failed)")
            stats["errors"] += 1
            time.sleep(0.3)
            continue

        stats["parsed"] += 1

        # Upsert company
        action, status = upsert_company(fund)
        if status < 300:
            key = "companies_updated" if action == "updated" else "companies_inserted"
            stats[key] += 1
            print(f"{action}", end=" ")
        else:
            print(f"DB_ERR({status})", end=" ")
            stats["errors"] += 1

        # Upload open call if found
        if fund.get("open_call"):
            result = upload_opportunity(fund["open_call"])
            print(f"| call:{result}", end="")
            if result == "inserted":
                stats["open_calls"] += 1

        print()
        logging.info(f"Processed: {fund['name']} | {action} | call: {bool(fund.get('open_call'))}")
        time.sleep(0.8)  # polite delay

    print(f"\n{'='*60}")
    print(f"  SUMMARY — Shatil Funds Scanner")
    print(f"  Funds processed: {stats['parsed']}/{len(fund_urls)}")
    print(f"  Companies updated: {stats['companies_updated']}")
    print(f"  Companies inserted: {stats['companies_inserted']}")
    print(f"  Open calls added: {stats['open_calls']}")
    print(f"  Errors: {stats['errors']}")
    print(f"{'='*60}")
    logging.info(f"Shatil funds scan complete: {stats}")


if __name__ == "__main__":
    try:
        main()
        logging.info("Shatil funds scanner completed successfully")
    except Exception as e:
        logging.error(f"Scanner crashed: {e}", exc_info=True)
        raise
