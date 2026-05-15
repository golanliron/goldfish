"""
fix_grant_urls.py — מחפש URL ספציפי לכל קול קורא ומעדכן ב-DB
"""
import requests
import time
import json

TAVILY_KEY = "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"
SUPABASE_URL = "https://touqczopfjxcpmbxzdjr.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRvdXFjem9wZmp4Y3BtYnh6ZGpyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0MTk3ODExNSwiZXhwIjoyMDU3NTU0MTE1fQ.R_J9oa9bVijFnBBKLi0qsO5Pxh1DsHFhD8leFLGpI6s"

GENERIC_DOMAINS = [
    "tmichot.gov.il",
    "negev.gov.il",
    "negev.co.il",
    "innovationisrael.org.il/kalpiot",
    "kkl.org.il",
    "matnasim.org.il",
    "haifa.muni.il",
    "shatil.org.il/kol",
    "classaction.co.il",
    "missfixtheuniverse.com",
    "goldmanfund.org",
    "gesherfilm.org",
    "givathaviva.org",
    "filmfund.org.il",
]

def is_generic(url):
    if not url:
        return True
    for domain in GENERIC_DOMAINS:
        if domain in url and url.rstrip("/") == f"https://{domain}" or url.rstrip("/") == f"http://{domain}":
            return True
        # Check if URL ends at domain level (no specific path)
        stripped = url.replace("https://", "").replace("http://", "").rstrip("/")
        if stripped == domain:
            return True
    # tmichot.gov.il with no path
    if "tmichot.gov.il" in url and len(url.replace("https://tmichot.gov.il", "").strip("/")) == 0:
        return True
    return False

def search_specific_url(title, funder, current_url):
    """Search Tavily for specific grant URL"""
    query = f'"{title}"'
    if funder:
        query += f' {funder}'
    query += " קול קורא הגשה"

    try:
        res = requests.post(
            "https://api.tavily.com/search",
            json={
                "api_key": TAVILY_KEY,
                "query": query,
                "max_results": 5,
                "search_depth": "basic",
                "include_domains": [],
            },
            timeout=15
        )
        if not res.ok:
            return None

        data = res.json()
        results = data.get("results", [])

        for r in results:
            url = r.get("url", "")
            # Skip if it's the same generic URL
            if not url or url == current_url:
                continue
            # Skip generic/homepage URLs
            if is_generic(url):
                continue
            # Prefer gov.il, specific pages
            if any(domain in url for domain in ["gov.il", "tmichot.gov.il/tmiha", "pais.co.il", "kkl.org.il/about"]):
                if len(url.replace("https://", "").split("/")) > 2:
                    return url
            # Any URL with a specific path
            path = url.replace("https://", "").replace("http://", "")
            if len(path.split("/")) > 2 and path.split("/")[1]:
                return url

        return None
    except Exception as e:
        print(f"  Tavily error: {e}")
        return None

def get_opportunities():
    """Fetch all active opportunities"""
    res = requests.get(
        f"{SUPABASE_URL}/rest/v1/opportunities",
        params={
            "select": "id,title,funder,url,deadline",
            "active": "eq.true",
            "order": "deadline.asc.nullslast",
        },
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
        }
    )
    return res.json()

def update_url(opp_id, new_url):
    """Update opportunity URL in DB"""
    res = requests.patch(
        f"{SUPABASE_URL}/rest/v1/opportunities",
        params={"id": f"eq.{opp_id}"},
        json={"url": new_url},
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        }
    )
    return res.ok

def main():
    print("טוען קולות קוראים...")
    opps = get_opportunities()
    print(f"סה\"כ: {len(opps)} קולות קוראים")

    to_fix = [o for o in opps if is_generic(o.get("url", ""))]
    print(f"צריכים תיקון: {len(to_fix)}")
    print()

    updated = 0
    failed = []

    for i, opp in enumerate(to_fix):
        title = opp.get("title", "")
        funder = opp.get("funder", "")
        current_url = opp.get("url", "")
        deadline = opp.get("deadline", "ללא דדליין")

        print(f"[{i+1}/{len(to_fix)}] {title[:60]}...")
        print(f"  גוף: {funder} | דדליין: {deadline}")
        print(f"  URL נוכחי: {current_url}")

        new_url = search_specific_url(title, funder, current_url)

        if new_url:
            success = update_url(opp["id"], new_url)
            if success:
                print(f"  ✓ עודכן: {new_url}")
                updated += 1
            else:
                print(f"  ✗ שגיאת DB")
                failed.append(title)
        else:
            print(f"  — לא נמצא URL ספציפי")
            failed.append(title)

        time.sleep(1)  # Rate limit
        print()

    print("=" * 60)
    print(f"עודכנו: {updated}/{len(to_fix)}")
    print(f"\nלא נמצא URL ל-{len(failed)} קולות קוראים:")
    for f in failed:
        print(f"  - {f}")

if __name__ == "__main__":
    main()
