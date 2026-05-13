"""
Find URLs for 405 atlas grants that have no URL.
Uses Jina Search (s.jina.ai) to find the grant page for each record.
Updates Supabase directly.
"""

import requests
import time
import json
import os
from datetime import datetime

SUPABASE_URL = "https://touqczopfjxcpmbxzdjr.supabase.co"
SUPABASE_KEY = os.environ.get("SUPABASE_ANON_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRvdXFjem9wZmp4Y3BtYnh6ZGpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4OTAzNTcsImV4cCI6MjA5MzQ2NjM1N30.K16QAHB3IwRnHJl_XxtcWjnxzggF-Z3gtTrestlq-ek")

HEADERS_SB = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal"
}

HEADERS_DDG = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}


def fetch_grants_without_url():
    """Get all opportunities without URL from Supabase."""
    url = f"{SUPABASE_URL}/rest/v1/opportunities?url=is.null&select=id,title,type,description&order=type.asc"
    resp = requests.get(url, headers=HEADERS_SB)
    grants = resp.json()
    if isinstance(grants, dict):
        print(f"Error fetching null URLs: {grants}")
        grants = []

    # Also get ones with empty string URL
    url2 = f"{SUPABASE_URL}/rest/v1/opportunities?url=eq.&select=id,title,type,description&order=type.asc"
    resp2 = requests.get(url2, headers=HEADERS_SB)
    grants2 = resp2.json()
    if isinstance(grants2, dict):
        print(f"Error fetching empty URLs: {grants2}")
        grants2 = []

    all_grants = grants + grants2
    print(f"Found {len(all_grants)} grants without URL")
    return all_grants


def search_ddg(query, max_retries=2):
    """Search using DuckDuckGo HTML (no API key needed)."""
    import urllib.parse
    import re

    SKIP_DOMAINS = ["atlas-grants.com", "facebook.com", "google.com/search",
                    "webcache", "youtube.com", "twitter.com", "instagram.com",
                    "linkedin.com/feed", "duckduckgo.com"]

    # Preferred domains get priority
    PREFERRED = ["gov.il", "kkl.org.il", "btl.gov.il", "guidestar.org.il",
                 "mof.gov.il", "pais.co.il", "education.gov.il"]

    for attempt in range(max_retries):
        try:
            search_url = f"https://html.duckduckgo.com/html/?q={urllib.parse.quote(query)}"
            resp = requests.get(search_url, headers=HEADERS_DDG, timeout=15)
            if resp.status_code == 200:
                # Extract redirect URLs
                redirects = re.findall(r'uddg=([^&"]+)', resp.text)
                urls = [urllib.parse.unquote(u) for u in redirects]
                # Filter bad domains
                good = [u for u in urls if not any(s in u for s in SKIP_DOMAINS)]
                if not good:
                    return None
                # Prefer known reliable domains
                for u in good[:10]:
                    if any(p in u for p in PREFERRED):
                        return u
                # Otherwise return first result
                return good[0]
            elif resp.status_code == 429 or resp.status_code == 202:
                print(f"  Rate limited, waiting 8s...")
                time.sleep(8)
                continue
            return None
        except Exception as e:
            print(f"  Error: {e}")
            if attempt < max_retries - 1:
                time.sleep(3)
    return None


def update_url(grant_id, url):
    """Update the URL in Supabase."""
    patch_url = f"{SUPABASE_URL}/rest/v1/opportunities?id=eq.{grant_id}"
    resp = requests.patch(patch_url, headers=HEADERS_SB, json={"url": url})
    return resp.status_code < 300


def build_search_query(grant):
    """Build an optimal search query for the grant."""
    title = grant["title"][:120]  # Truncate very long titles
    grant_type = grant.get("type", "")

    if grant_type == "kok":
        return f"{title} קול קורא הגשה"
    elif grant_type == "fund":
        return f"{title} קרן"
    elif grant_type == "business":
        return f"{title} אחריות תאגידית"
    else:
        return f"{title} קול קורא"


def main():
    grants = fetch_grants_without_url()
    if not grants:
        print("No grants without URL found!")
        return

    # Prioritize: kok first (most likely to find), then funds, then business
    type_order = {"kok": 0, "fund": 1, "endowment": 2, "business": 3, "unknown": 4}
    grants.sort(key=lambda g: type_order.get(g.get("type", "unknown"), 5))

    found = 0
    failed = 0
    results_log = []

    print(f"\nSearching URLs for {len(grants)} grants...")
    print(f"{'='*60}")

    for i, grant in enumerate(grants):
        query = build_search_query(grant)
        short_title = grant["title"][:60]
        print(f"\n[{i+1}/{len(grants)}] ({grant.get('type','?')}) {short_title}")
        print(f"  Query: {query[:80]}")

        url = search_ddg(query)

        if url:
            print(f"  FOUND: {url[:80]}")
            if update_url(grant["id"], url):
                found += 1
                results_log.append({"id": grant["id"], "title": short_title, "url": url, "status": "updated"})
            else:
                print(f"  ERROR updating Supabase!")
                results_log.append({"id": grant["id"], "title": short_title, "url": url, "status": "update_failed"})
        else:
            print(f"  NOT FOUND")
            failed += 1
            results_log.append({"id": grant["id"], "title": short_title, "url": None, "status": "not_found"})

        # Rate limiting - be nice to Jina
        time.sleep(1.5)

        # Save progress every 20 items
        if (i + 1) % 20 == 0:
            save_progress(results_log, found, failed, i + 1, len(grants))

    # Final save
    save_progress(results_log, found, failed, len(grants), len(grants))

    print(f"\n{'='*60}")
    print(f"DONE! Found: {found}, Not found: {failed}, Total: {len(grants)}")
    print(f"Success rate: {100*found/len(grants):.1f}%")


def save_progress(results_log, found, failed, processed, total):
    """Save progress to file."""
    output = {
        "timestamp": datetime.now().isoformat(),
        "processed": processed,
        "total": total,
        "found": found,
        "failed": failed,
        "results": results_log
    }
    output_path = os.path.join(os.path.dirname(__file__), "grant_urls_progress.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"\n  [Progress saved: {found} found, {failed} not found, {processed}/{total}]")


if __name__ == "__main__":
    main()
