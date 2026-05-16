#!/usr/bin/env python3
"""
Local grant scanner — writes directly to Goldfish Supabase (touqczopfjxcpmbxzdjr)
Run: python scan_local.py

Architecture:
- NEVER DELETE records. Junk gets active=false (soft-delete).
- URL already in DB = skip (even if active=false — prevents re-adding junk).
- Filters only technical garbage, not by topic/sector.

Fetch strategy (3-layer fallback):
  1. Direct HTTP with browser UA
  2. Jina Reader (bypasses 403 / JS-light pages)
  3. Tavily Search (for full SPA / gov.il dynamic pages that return empty shells)
"""
import json, re, time, os, ssl
from datetime import datetime
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError

# SSL context for gov.il sites on Windows Python 3.14
# Sets minimum to TLS 1.2 (secure; TLS 1.0/1.1 are deprecated)
_GOV_SSL_CTX = ssl.create_default_context()
_GOV_SSL_CTX.minimum_version = ssl.TLSVersion.TLSv1_2

SUPABASE_URL = "https://touqczopfjxcpmbxzdjr.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRvdXFjem9wZmp4Y3BtYnh6ZGpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4OTAzNTcsImV4cCI6MjA5MzQ2NjM1N30.K16QAHB3IwRnHJl_XxtcWjnxzggF-Z3gtTrestlq-ek"
# Load .env.local if present (Vercel wraps values in quotes — strip them)
_env_file = os.path.join(os.path.dirname(__file__), ".env.local")
if os.path.exists(_env_file):
    with open(_env_file, encoding="utf-8") as _ef:
        for _line in _ef:
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _, _v = _line.partition("=")
                _v = _v.strip().strip('"').strip("'")
                os.environ.setdefault(_k.strip(), _v)

TAVILY_API_KEY = os.environ.get("TAVILY_API_KEY", "")

CURRENT_YEAR = datetime.now().year

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
}

# Sources where we can parse HTML links directly
SOURCES = [
    {"name": "שתיל",               "url": "https://shatil.org.il/%D7%A7%D7%A8%D7%A0%D7%95%D7%AA-%D7%95%D7%A7%D7%95%D7%9C%D7%95%D7%AA-%D7%A7%D7%95%D7%A8%D7%90%D7%99%D7%9D/", "funder": "שתיל"},
    {"name": "ביטוח לאומי",        "url": "https://www.btl.gov.il/Funds/kolotkorim/Pages/default.aspx", "funder": "ביטוח לאומי"},
    {"name": "ג'וינט ישראל",       "url": "https://www.jdc.org.il/calls-for-proposals/", "funder": "ג׳וינט ישראל"},
    {"name": "SocialMap",           "url": "https://socialmap.org.il/hakol-kore", "funder": ""},
    {"name": "גיידסטאר",           "url": "https://www.guidestar.org.il/search-announcements", "funder": ""},
    {"name": "רשות החדשנות",       "url": "https://innovationisrael.org.il/kol_kore/", "funder": "רשות החדשנות"},
    {"name": "קק\"ל",              "url": "https://www.kkl.org.il/about-us/tenders/call-for-proposals/", "funder": "קק\"ל"},
    {"name": "Rothschild Foundation","url": "https://rothschildfoundation.eu/grants-page/", "funder": "Rothschild Foundation"},
    {"name": "Jewish Federation Bay Area","url": "https://jewishfed.org/get-involved/nonprofits/apply-for-a-grant/", "funder": "Jewish Federation Bay Area"},
    {"name": "UJA Federation NY",  "url": "https://www.ujafedny.org/grants-and-scholarships/", "funder": "UJA Federation New York"},
    {"name": "קרן מנדל",           "url": "https://www.mandelfoundation.org.il/programs", "funder": "קרן מנדל"},
    {"name": "New Israel Fund",    "url": "https://www.nif.org/apply/", "funder": "New Israel Fund"},
    {"name": "קרן רשי",            "url": "https://www.rashi.org.il/he/%D7%9E%D7%A2%D7%A0%D7%A7%D7%99%D7%9D", "funder": "קרן רש\"י"},
    {"name": "Pears Foundation",   "url": "https://pearsfoundation.org.uk/grants/", "funder": "Pears Foundation"},
    {"name": "קרן יד הנדיב",      "url": "https://www.yadhanadiv.org.il/calls-for-proposals", "funder": "קרן יד הנדיב"},
    {"name": "קרן אבי חי",        "url": "https://www.avichai.org.il/", "funder": "קרן אבי חי"},
    {"name": "Alliance Magazine",  "url": "https://alliancemagazine.org/category/grants/", "funder": ""},
    {"name": "Schusterman",        "url": "https://schusterman.org/what-we-fund", "funder": "Schusterman Foundation"},
    {"name": "קרן ביאליק",        "url": "https://www.bialik-fund.org.il/", "funder": "קרן ביאליק"},
    {"name": "קרן טראמפ",         "url": "https://www.trump-foundation.org.il/grants", "funder": "קרן טראמפ"},
    {"name": "קרן תל אביב",       "url": "https://www.telavivfoundation.org/grants", "funder": "קרן תל אביב"},
]

# Gov.il sources that are SPAs — use Tavily proactive search
TAVILY_GOV_SOURCES = [
    {
        "name": "משרד החינוך — קולות קוראים",
        "funder": "משרד החינוך",
        "queries": [
            f"site:gov.il קול קורא חינוך עמותות {CURRENT_YEAR}",
            f"site:education.gov.il קול קורא מענק תמיכה {CURRENT_YEAR}",
        ],
    },
    {
        "name": "משרד הרווחה — תמיכות",
        "funder": "משרד הרווחה",
        "queries": [
            f"site:gov.il קול קורא רווחה עמותות תמיכה {CURRENT_YEAR}",
            f"site:molsa.gov.il קול קורא מענק {CURRENT_YEAR}",
        ],
    },
    {
        "name": "פורטל תמיכות — mof.gov.il",
        "funder": "",
        "queries": [
            f"site:mof.gov.il תמיכות קול קורא עמותות {CURRENT_YEAR}",
            f"site:tmichot.mof.gov.il קול קורא {CURRENT_YEAR}",
        ],
    },
    {
        "name": "משרד הנגב והגליל",
        "funder": "משרד הנגב, הגליל והחוסן הלאומי",
        "queries": [
            f"site:gov.il קול קורא נגב גליל עמותות {CURRENT_YEAR}",
        ],
    },
    {
        "name": "משרד הכלכלה",
        "funder": "משרד הכלכלה",
        "queries": [
            f"site:gov.il קול קורא כלכלה עסקים עמותות {CURRENT_YEAR}",
        ],
    },
    {
        "name": "משרד הבריאות",
        "funder": "משרד הבריאות",
        "queries": [
            f"site:health.gov.il קול קורא מענק עמותות {CURRENT_YEAR}",
            f"site:gov.il קול קורא בריאות תמיכה {CURRENT_YEAR}",
        ],
    },
    {
        "name": "קולות קוראים ממשלתיים כלליים",
        "funder": "",
        "queries": [
            f"site:gov.il קול קורא ציבורי עמותות מענק {CURRENT_YEAR}",
            f"site:govextra.gov.il קול קורא תמיכה {CURRENT_YEAR}",
        ],
    },
    {
        "name": "תקומה",
        "funder": "רשות תקומה",
        "queries": [
            f"site:govextra.gov.il תקומה קול קורא {CURRENT_YEAR}",
            f"רשות תקומה קול קורא מענק עמותות {CURRENT_YEAR}",
        ],
    },
]

# Technical junk — only structural garbage, not topic filtering
JUNK_TITLE_PATTERNS = [
    r'^manage my grant',
    r"^what we don.t fund",
    r'^פתח תפריט',
    r'^המשך על ',
    r'^פרסומי קול קורא פומבי',
    r'קול קורא לא פומבי',
    r'קול קורא לא פעילים',
    r'^fundsforngos',
    r'fundsforngospremium',
    r'^[\w\.]+\.(?:com|org|ai|io)$',
    r'^חידוש רישיון',
    r'^רשות המסים',
    r'^זימון תורים',
    r'^אזור אישי',
    r'^דלג לתוכן',
    r'^לדף הבית',
    r'^חפשו שירות',
]
JUNK_COMPILED = [re.compile(p, re.I) for p in JUNK_TITLE_PATTERNS]

def is_junk(title):
    t = title.strip().lower()
    return any(p.search(t) for p in JUNK_COMPILED)


# ─── Fetch helpers ─────────────────────────────────────────────────────────────

def fetch_direct(url, timeout=25):
    """Layer 1: direct HTTP. Returns None on 403/connection error (signal: try Jina)."""
    try:
        req = Request(url, headers=HEADERS)
        ctx = _GOV_SSL_CTX if ".gov.il" in url else None
        with urlopen(req, timeout=timeout, context=ctx) as r:
            raw = r.read()
            if r.info().get("Content-Encoding") == "gzip":
                import gzip
                raw = gzip.decompress(raw)
            try:
                return raw.decode("utf-8")
            except Exception:
                return raw.decode("windows-1255", errors="replace")
    except HTTPError as e:
        if e.code in (403, 429, 503):
            return None
        print(f"  HTTP {e.code} — skipping")
        return ""
    except Exception:
        return None


def fetch_jina(url, timeout=30):
    """Layer 2: Jina Reader. Returns None if response is an empty SPA shell."""
    jina_url = f"https://r.jina.ai/{url}"
    try:
        req = Request(jina_url, headers={"Accept": "text/plain", "User-Agent": HEADERS["User-Agent"]})
        with urlopen(req, timeout=timeout) as r:
            text = r.read().decode("utf-8", errors="replace")
            if len(text) > 500 and any(kw in text for kw in ["קול קורא", "מענק", "תמיכה", "grant", "call"]):
                return text
            return None
    except Exception as e:
        print(f"  jina error: {e}")
        return None


def tavily_search(query, max_results=8, include_domains=None):
    """Layer 3: Tavily REST API — no SDK required."""
    if not TAVILY_API_KEY:
        return []
    try:
        payload = {"query": query, "max_results": max_results, "search_depth": "advanced"}
        if include_domains:
            payload["include_domains"] = include_domains
        body = json.dumps(payload).encode("utf-8")
        req = Request(
            "https://api.tavily.com/search",
            data=body,
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {TAVILY_API_KEY}"},
            method="POST"
        )
        with urlopen(req, timeout=30) as r:
            return json.loads(r.read()).get("results", [])
    except Exception as e:
        print(f"  tavily error: {e}")
        return []


def fetch_with_fallback(url, source_name):
    """3-layer fetch: direct → Jina → None (caller decides on Tavily)."""
    html = fetch_direct(url)
    if html is not None:
        return html

    print(f"  direct blocked — trying Jina...")
    jina = fetch_jina(url)
    if jina is not None:
        return jina

    print(f"  Jina empty shell — will use Tavily search")
    return None


# ─── tmichot.mof — direct API ──────────────────────────────────────────────────

def scan_tmichot():
    """
    tmichot.mof.gov.il is a React SPA — no public REST API.
    Parse the homepage HTML for any direct links, then rely on DDG/Tavily
    Phase 3 queries to surface the actual grant pages.
    """
    html = fetch_with_fallback("https://tmichot.mof.gov.il/", "tmichot")
    if not html:
        return []
    links = extract_links(html, "https://tmichot.mof.gov.il/")
    for lnk in links:
        lnk["funder"] = lnk.get("funder") or "פורטל תמיכות ממשלתי"
    print(f"  tmichot homepage: {len(links)} links found")
    return links


# ─── Tavily gov search ─────────────────────────────────────────────────────────

def ddg_search(query, max_results=10):
    """DuckDuckGo search via Jina — free, no key needed."""
    from urllib.parse import quote as urlquote
    ddg_url = f"https://html.duckduckgo.com/html/?q={urlquote(query)}"
    text = fetch_jina(ddg_url, timeout=30) or ""
    results = []
    seen = set()
    # Extract real URLs from DDG redirect links: uddg=https%3A%2F%2F...
    for m in re.finditer(r'uddg=(https?%3A%2F%2F[^&"]+)', text):
        from urllib.parse import unquote
        url = unquote(m.group(1))
        if "duckduckgo" in url or "duck.com" in url:
            continue
        if url in seen:
            continue
        seen.add(url)
        # Extract title from surrounding Markdown heading ## [title](...)
        ctx_start = max(0, m.start() - 500)
        ctx_end = min(len(text), m.end() + 200)
        ctx = text[ctx_start:ctx_end]
        title_m = re.search(r'##\s+\[([^\]]{8,250})\]', ctx)
        title = title_m.group(1).strip() if title_m else url
        deadline = extract_date(ctx)
        if len(results) >= max_results:
            break
        results.append({"url": url, "title": title, "deadline": deadline})
    return results


def scan_ddg_source(source):
    """Run DuckDuckGo discovery queries (free, no key)."""
    results = []
    seen_urls = set()

    for query in source["queries"]:
        print(f"  DDG: {query}")
        for r in ddg_search(query, max_results=8):
            url = r.get("url", "")
            title = r.get("title", "").strip()
            if not url or not title or len(title) < 8:
                continue
            if url in seen_urls:
                continue
            if is_junk(title):
                continue
            if not any(kw in (url + title) for kw in
                       ["קול קורא", "מענק", "תמיכה", "grant", "call", "tender", "מכרז", "rfp", "bids"]):
                continue
            deadline = r.get("deadline")
            seen_urls.add(url)
            results.append({"title": title[:250], "url": url, "funder": source["funder"] or None, "deadline": deadline})
        time.sleep(1)

    return results


def scan_tavily_source(source):
    """Run targeted Tavily queries (requires TAVILY_API_KEY)."""
    results = []
    seen_urls = set()

    for query in source["queries"]:
        print(f"  Tavily: {query}")
        for r in tavily_search(query, max_results=8):
            url = r.get("url", "")
            title = r.get("title", "").strip()
            content = r.get("content", "")
            if not url or not title or len(title) < 8:
                continue
            if url in seen_urls:
                continue
            if is_junk(title):
                continue
            if not any(kw in (url + title + content).lower() for kw in
                       ["קול קורא", "מענק", "תמיכה", "grant", "call", "proposal", "tender", "מכרז"]):
                continue
            deadline = extract_date(content) or extract_date(title)
            seen_urls.add(url)
            results.append({"title": title[:250], "url": url, "funder": source["funder"] or None, "deadline": deadline})
        time.sleep(0.5)

    return results


# ─── Parsing helpers ───────────────────────────────────────────────────────────

def extract_date(text):
    if not text:
        return None
    m = re.search(r'(\d{1,2})[./](\d{1,2})[./](20\d{2})', text)
    if m:
        return f"{m.group(3)}-{m.group(2).zfill(2)}-{m.group(1).zfill(2)}"
    m = re.search(r'(20\d{2}-\d{2}-\d{2})', text)
    return m.group(1) if m else None


def clean_title(raw):
    title = re.sub(r'<[^>]+>', '', raw).strip()
    title = re.sub(r'[\r\n\t]+', ' ', title)
    title = re.sub(r'\s{2,}', ' ', title).strip()
    title = re.sub(r'^דדליין\s+(\d+\.\d+\.\d+\s+|אין דדליין\s+)', '', title).strip()
    title = title.replace('&quot;', '"').replace('&amp;', '&').replace('&#8211;', '–').replace('&#8212;', '—')
    return title


def extract_links(html, base_url):
    links = []
    pattern = re.compile(r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', re.I | re.S)
    grant_keywords = ["קול קורא", "מענק", "תמיכה", "הגשה", "מלגה", "grant", "call", "proposal",
                      "fund", "fellowship", "tender", "תכנית", "פרס", "מכרז", "בקשה"]
    nav_skip = ["צור קשר", "אודות", "privacy", "cookie", "home", "menu", "login",
                "facebook", "twitter", "instagram", "linkedin", "youtube", "rss"]

    for m in pattern.finditer(html):
        href = m.group(1).strip()
        title = clean_title(m.group(2))

        if not title or len(title) < 8 or len(title) > 250:
            continue
        if any(s in title.lower() for s in nav_skip):
            continue
        if not any(k in title for k in grant_keywords):
            continue
        if is_junk(title):
            continue

        if href.startswith("http"):
            url = href
        elif href.startswith("/"):
            from urllib.parse import urlparse
            p = urlparse(base_url)
            url = f"{p.scheme}://{p.netloc}{href}"
        else:
            continue

        if any(url.lower().endswith(ext) for ext in [".png", ".jpg", ".gif", ".zip", ".exe"]):
            continue

        ctx_start = max(0, m.start() - 300)
        ctx_end = min(len(html), m.end() + 300)
        deadline = extract_date(html[ctx_start:ctx_end])
        links.append({"title": title[:250], "url": url, "deadline": deadline})

    return links


# ─── Supabase helpers ──────────────────────────────────────────────────────────

def get_existing(supabase_url, key):
    try:
        req = Request(
            f"{supabase_url}/rest/v1/opportunities?select=title,url&limit=5000",
            headers={"apikey": key, "Authorization": f"Bearer {key}"}
        )
        with urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
            titles = set(d["title"][:40] for d in data if d.get("title"))
            urls = set(d["url"] for d in data if d.get("url"))
            return titles, urls
    except Exception as e:
        print(f"  get_existing error: {e}")
        return set(), set()


def insert_row(supabase_url, key, item):
    try:
        body = json.dumps(item).encode("utf-8")
        req = Request(
            f"{supabase_url}/rest/v1/opportunities",
            data=body,
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
            method="POST"
        )
        with urlopen(req, timeout=15) as r:
            return r.status in (200, 201)
    except Exception as e:
        print(f"  insert error: {e}")
        return False


def process_items(items, source_funder, source_name, existing_titles, existing_urls):
    added = 0
    for item in items:
        url = item.get("url", "")
        title = item.get("title", "")
        if not url or not title:
            continue
        if url in existing_urls:
            continue
        if title[:40] in existing_titles:
            continue

        row = {
            "title": title,
            "funder": item.get("funder") or source_funder or None,
            "url": url,
            "deadline": item.get("deadline"),
            "active": True,
            "type": "grant",
            "source": source_name,
            "categories": [],
            "target_populations": [],
            "regions": [],
        }

        if insert_row(SUPABASE_URL, SUPABASE_KEY, row):
            added += 1
            existing_urls.add(url)
            existing_titles.add(title[:40])
            print(f"  + {title[:70]}")

    return added


# ─── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("=== Goldfish Local Scanner ===")
    print(f"Time: {datetime.now().strftime('%d/%m/%Y %H:%M')}")
    print(f"HTML sources: {len(SOURCES)} | Gov Tavily: {len(TAVILY_GOV_SOURCES)} | tmichot API: 1")
    print(f"Tavily: {'ENABLED' if TAVILY_API_KEY else 'DISABLED (set TAVILY_API_KEY to enable gov.il scanning)'}")
    print()

    existing_titles, existing_urls = get_existing(SUPABASE_URL, SUPABASE_KEY)
    print(f"Existing in DB: {len(existing_urls)} URLs, {len(existing_titles)} titles\n")

    total_new = 0

    # Phase 1: HTML sources — direct + Jina + Tavily fallback
    print("--- Phase 1: HTML sources ---")
    for source in SOURCES:
        print(f"Scanning: {source['name']}...")
        html = fetch_with_fallback(source["url"], source["name"])

        if html is None and TAVILY_API_KEY:
            # Both direct and Jina failed — Tavily last resort
            print(f"  Tavily fallback for {source['name']}...")
            from urllib.parse import urlparse
            domain = urlparse(source["url"]).netloc
            raw = tavily_search(f"site:{domain} קול קורא מענק {CURRENT_YEAR}", max_results=6, include_domains=[domain])
            items = []
            for r in raw:
                t = r.get("title", "").strip()
                u = r.get("url", "")
                if t and u and len(t) >= 8 and not is_junk(t):
                    items.append({"title": t[:250], "url": u, "deadline": extract_date(r.get("content", ""))})
            added = process_items(items, source["funder"], source["name"], existing_titles, existing_urls)
            total_new += added
            print(f"  -> added {added} via Tavily")
        elif html is None:
            print("  -> skipped (blocked, no Tavily key)")
        elif not html:
            print("  -> no response")
        else:
            items = extract_links(html, source["url"])
            added = process_items(items, source["funder"], source["name"], existing_titles, existing_urls)
            total_new += added
            print(f"  -> added {added} / {len(items)} found")

        time.sleep(1)

    # Phase 2: tmichot.mof direct API
    print("\n--- Phase 2: tmichot.mof API ---")
    print("Scanning: פורטל תמיכות ממשלתי...")
    tmichot_items = scan_tmichot()
    added = process_items(tmichot_items, "פורטל תמיכות ממשלתי", "tmichot.mof", existing_titles, existing_urls)
    total_new += added
    print(f"  -> added {added} / {len(tmichot_items)} found")

    # Phase 3: DuckDuckGo proactive discovery (free, no key)
    print("\n--- Phase 3: DuckDuckGo gov.il discovery ---")
    for source in TAVILY_GOV_SOURCES:
        print(f"Scanning: {source['name']}...")
        if TAVILY_API_KEY:
            items = scan_tavily_source(source)
        else:
            items = scan_ddg_source(source)
        added = process_items(items, source["funder"], source["name"], existing_titles, existing_urls)
        total_new += added
        print(f"  -> added {added} / {len(items)} found")
        time.sleep(1)

    print(f"\n=== DONE: {total_new} new opportunities added ===")
    print(f"Total DB size (approx): {len(existing_urls)}")


if __name__ == "__main__":
    main()
