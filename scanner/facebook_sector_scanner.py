"""
Facebook Sector Intelligence Scanner
Scans Facebook feed, groups, and pages for Israeli third-sector news.
Saves relevant findings to Supabase sector_intelligence table.
Runs weekly via skill /facebook-scanner or Task Scheduler.
"""

import json
import os
import re
import time
from datetime import datetime, date, timedelta
from urllib.parse import quote

import requests
from supabase import create_client

# -- Config --
SUPABASE_URL = "https://touqczopfjxcpmbxzdjr.supabase.co"
SUPABASE_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

# Facebook tokens
USER_TOKEN = os.environ.get("FB_USER_TOKEN", "")
PAGE_TOKEN = os.environ.get("FB_PAGE_TOKEN", "")
PAGE_ID = "105767899268083"

GRAPH_API = "https://graph.facebook.com/v19.0"

# Keywords to identify relevant content
SECTOR_KEYWORDS = [
    "עמותה", "עמותות", "מגזר שלישי", "מגזר חברתי", "ארגון חברתי",
    "קול קורא", "קולות קוראים", "מענק", "מענקים", "תרומה", "תרומות",
    "גיוס משאבים", "פילנתרופיה", "אחריות תאגידית", "CSR",
    "השפעה חברתית", "social impact", "אימפקט", "impact",
    "נוער בסיכון", "צעירים", "חינוך", "רווחה", "קהילה",
    "קרן", "קרנות", "foundation", "grant", "nonprofit",
    "ביטוח לאומי", "משרד הרווחה", "משרד החינוך",
    "סטארטאפ חברתי", "יזמות חברתית", "social enterprise",
    "שוויון הזדמנויות", "הכלה חברתית", "שילוב",
    "מכרז", "מכרזים", "התנדבות", "מתנדבים",
    "פעילות חברתית", "אקטיביזם", "שינוי חברתי",
    "GuideStar", "guidestar", "ניהול תקין", "שקיפות",
    "דוח אימפקט", "מדידת השפעה", "תוצאות חברתיות",
]

# Known relevant Facebook pages/groups to monitor
MONITORED_PAGES = [
    {"id": "migzar3", "name": "מגזר 3"},
    {"id": "shatil.org.il", "name": "שתיל"},
    {"id": "maaboret", "name": "מעבורת"},
    {"id": "guidestarisrael", "name": "GuideStar Israel"},
    {"id": "socialfinanceisrael", "name": "Social Finance Israel"},
    {"id": "midotcsr", "name": "מידות - מרכז לצדק חברתי"},
    {"id": "kolzchut", "name": "כל זכות"},
    {"id": "jdc.israel", "name": "ג'וינט ישראל"},
    {"id": "maboret", "name": "מעבורת — עיתונות עומק"},
]

# Facebook groups to always scan (regardless of keyword match)
MONITORED_GROUPS = [
    {"id": "1149531235180634", "name": "ערך לדרך"},
]


def is_relevant(text: str) -> bool:
    """Check if text contains sector-relevant keywords."""
    if not text:
        return False
    text_lower = text.lower()
    return any(kw in text_lower or kw in text for kw in SECTOR_KEYWORDS)


def fetch_graph(endpoint: str, token: str, params: dict = None) -> dict | None:
    """Make a Facebook Graph API call."""
    url = f"{GRAPH_API}/{endpoint}"
    all_params = {"access_token": token}
    if params:
        all_params.update(params)

    try:
        res = requests.get(url, params=all_params, timeout=15)
        if res.status_code == 200:
            return res.json()
        else:
            print(f"  [!] Graph API error {res.status_code}: {res.text[:200]}")
            return None
    except Exception as e:
        print(f"  [!] Graph API request failed: {e}")
        return None


def scan_user_feed(token: str) -> list[dict]:
    """Scan user's Facebook feed for relevant posts."""
    print("\n>> Scanning user feed...")
    items = []

    # Get recent feed posts (last 7 days)
    since = int((datetime.now() - timedelta(days=7)).timestamp())
    data = fetch_graph("me/feed", token, {
        "fields": "id,message,story,created_time,from,permalink_url,shares,reactions.summary(true)",
        "limit": 100,
        "since": since,
    })

    if not data or "data" not in data:
        print("  [!] Could not read user feed (may need user_posts permission)")
        return items

    for post in data["data"]:
        message = post.get("message", "") or post.get("story", "")
        if not message or len(message) < 30:
            continue

        if is_relevant(message):
            items.append({
                "source": "facebook_feed",
                "source_url": post.get("permalink_url", ""),
                "title": message[:100].strip(),
                "raw_content": message[:3000],
                "from_name": post.get("from", {}).get("name", ""),
                "created_time": post.get("created_time", ""),
                "reactions": post.get("reactions", {}).get("summary", {}).get("total_count", 0),
                "shares": post.get("shares", {}).get("count", 0),
            })

    print(f"   Found {len(items)} relevant posts in feed")
    return items


def scan_user_groups(token: str) -> list[dict]:
    """Scan user's Facebook groups for relevant content."""
    print("\n>> Scanning user groups...")
    items = []

    # Get user's groups
    groups_data = fetch_graph("me/groups", token, {
        "fields": "id,name,description,member_count",
        "limit": 50,
    })

    if not groups_data or "data" not in groups_data:
        print("  [!] Could not read user groups")
        return items

    relevant_groups = []
    for group in groups_data["data"]:
        name = group.get("name", "")
        desc = group.get("description", "")
        if is_relevant(name) or is_relevant(desc):
            relevant_groups.append(group)
            print(f"   Relevant group: {name} ({group.get('member_count', '?')} members)")

    # Scan each relevant group's feed
    since = int((datetime.now() - timedelta(days=7)).timestamp())
    for group in relevant_groups[:10]:  # Max 10 groups
        group_feed = fetch_graph(f"{group['id']}/feed", token, {
            "fields": "id,message,created_time,from,permalink_url,reactions.summary(true)",
            "limit": 25,
            "since": since,
        })

        if not group_feed or "data" not in group_feed:
            continue

        for post in group_feed["data"]:
            message = post.get("message", "")
            if not message or len(message) < 50:
                continue

            if is_relevant(message):
                items.append({
                    "source": f"facebook_group:{group['name'][:50]}",
                    "source_url": post.get("permalink_url", ""),
                    "title": message[:100].strip(),
                    "raw_content": message[:3000],
                    "from_name": post.get("from", {}).get("name", ""),
                    "group_name": group["name"],
                    "created_time": post.get("created_time", ""),
                    "reactions": post.get("reactions", {}).get("summary", {}).get("total_count", 0),
                })

        time.sleep(0.5)  # Rate limit

    print(f"   Found {len(items)} relevant group posts")
    return items


def scan_monitored_groups(token: str) -> list[dict]:
    """Scan specific monitored groups (always, no keyword filter)."""
    print("\n>> Scanning monitored groups...")
    items = []

    since = int((datetime.now() - timedelta(days=7)).timestamp())
    for group_info in MONITORED_GROUPS:
        group_feed = fetch_graph(f"{group_info['id']}/feed", token, {
            "fields": "id,message,created_time,from,permalink_url,reactions.summary(true)",
            "limit": 25,
            "since": since,
        })

        if not group_feed or "data" not in group_feed:
            print(f"   [!] Could not read group: {group_info['name']}")
            continue

        for post in group_feed["data"]:
            message = post.get("message", "")
            if not message or len(message) < 30:
                continue

            items.append({
                "source": f"facebook_group:{group_info['name']}",
                "source_url": post.get("permalink_url", ""),
                "title": message[:100].strip(),
                "raw_content": message[:3000],
                "from_name": post.get("from", {}).get("name", ""),
                "group_name": group_info["name"],
                "created_time": post.get("created_time", ""),
                "reactions": post.get("reactions", {}).get("summary", {}).get("total_count", 0),
            })

        time.sleep(0.3)

    print(f"   Found {len(items)} posts from monitored groups")
    return items


def scan_monitored_pages(token: str) -> list[dict]:
    """Scan known sector pages for recent posts."""
    print("\n>> Scanning monitored pages...")
    items = []

    since = int((datetime.now() - timedelta(days=7)).timestamp())
    for page_info in MONITORED_PAGES:
        page_feed = fetch_graph(f"{page_info['id']}/posts", token, {
            "fields": "id,message,created_time,permalink_url,shares,reactions.summary(true)",
            "limit": 10,
            "since": since,
        })

        if not page_feed or "data" not in page_feed:
            continue

        for post in page_feed["data"]:
            message = post.get("message", "")
            if not message or len(message) < 30:
                continue

            items.append({
                "source": f"facebook_page:{page_info['name']}",
                "source_url": post.get("permalink_url", ""),
                "title": message[:100].strip(),
                "raw_content": message[:3000],
                "from_name": page_info["name"],
                "created_time": post.get("created_time", ""),
                "reactions": post.get("reactions", {}).get("summary", {}).get("total_count", 0),
                "shares": post.get("shares", {}).get("count", 0),
            })

        time.sleep(0.3)

    print(f"   Found {len(items)} posts from monitored pages")
    return items


def scan_own_page(token: str) -> list[dict]:
    """Scan Hopa's own page insights — engagement, comments, reach."""
    print("\n>> Scanning Hopa page activity...")
    items = []

    # Get page posts with insights
    page_feed = fetch_graph(f"{PAGE_ID}/posts", token, {
        "fields": "id,message,created_time,permalink_url,reactions.summary(true),comments.summary(true),shares",
        "limit": 10,
    })

    if not page_feed or "data" not in page_feed:
        return items

    for post in page_feed["data"]:
        message = post.get("message", "")
        comments_count = post.get("comments", {}).get("summary", {}).get("total_count", 0)

        if comments_count > 0:
            # Read comments for potential leads/connections
            comments_data = fetch_graph(f"{post['id']}/comments", token, {
                "fields": "message,from,created_time",
                "limit": 20,
            })

            if comments_data and "data" in comments_data:
                for comment in comments_data["data"]:
                    comment_text = comment.get("message", "")
                    if is_relevant(comment_text) and len(comment_text) > 20:
                        items.append({
                            "source": "facebook_hopa_comments",
                            "source_url": post.get("permalink_url", ""),
                            "title": f"תגובה על: {message[:60]}",
                            "raw_content": comment_text[:1000],
                            "from_name": comment.get("from", {}).get("name", ""),
                            "created_time": comment.get("created_time", ""),
                        })

    print(f"   Found {len(items)} relevant interactions on Hopa page")
    return items


def analyze_with_ai(items: list[dict]) -> list[dict]:
    """Use Claude to analyze, classify and score findings."""
    if not ANTHROPIC_KEY or not items:
        return items

    items_text = "\n".join(
        f"{i+1}. [{item.get('source', '')}] {item['title']}\n{item.get('raw_content', '')[:400]}"
        for i, item in enumerate(items[:20])
    )

    try:
        res = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": ANTHROPIC_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": "claude-haiku-4-5-20251001",
                "max_tokens": 3000,
                "system": """אתה מנתח תוכן מפייסבוק שקשור למגזר השלישי הישראלי. עבור כל פריט, החזר JSON:
[{
  "index": 1,
  "category": "donation|grant|startup|policy|trend|nonprofit|competition|event|partnership",
  "summary": "סיכום של 1-2 משפטים בעברית",
  "entities": [{"name": "שם", "type": "org|person|company|fund|government", "role": "תיאור קצר"}],
  "tags": ["תג1", "תג2"],
  "relevance_score": 70,
  "reliability": "high|medium|low",
  "actionable": true,
  "skip": false
}]

כללים:
- relevance_score: 1-100 כמה רלוונטי לגיוס משאבים של עמותות
- reliability: high = מקור רשמי/מוסדי, medium = מקור מוכר, low = פוסט אישי/לא מאומת
- actionable: true אם יש כאן הזדמנות ממשית (קול קורא, שותפות, אירוע)
- skip=true אם זה לא רלוונטי, פרסומת, או תוכן ריק
- entities: חלץ ארגונים, אנשים, קרנות, גופי ממשלה
- **חשוב: סנן תוכן לא מהימן! אם משהו נראה כמו spam, MLM, או מידע מפוקפק — סמן skip=true**
החזר JSON בלבד.""",
                "messages": [
                    {
                        "role": "user",
                        "content": f"תוכן מפייסבוק — סריקה שבועית {date.today().isoformat()}:\n{items_text}",
                    }
                ],
            },
            timeout=30,
        )
        res.raise_for_status()
        data = res.json()
        raw = data["content"][0]["text"]

        json_match = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw)
        parsed = json.loads(json_match.group(1) if json_match else raw)

        for analysis in parsed:
            idx = analysis.get("index", 0) - 1
            if 0 <= idx < len(items) and not analysis.get("skip", False):
                # Only keep reliable items
                if analysis.get("reliability", "low") == "low" and analysis.get("relevance_score", 0) < 60:
                    continue
                items[idx]["category"] = analysis.get("category", "other")
                items[idx]["summary"] = analysis.get("summary", "")
                items[idx]["entities"] = analysis.get("entities", [])
                items[idx]["tags"] = analysis.get("tags", [])
                items[idx]["relevance_score"] = analysis.get("relevance_score", 50)
                items[idx]["reliability"] = analysis.get("reliability", "medium")
                items[idx]["actionable"] = analysis.get("actionable", False)
                items[idx]["analyzed"] = True

        return items

    except Exception as e:
        print(f"  [!] AI analysis failed: {e}")
        return items


def save_to_supabase(items: list[dict]):
    """Save findings to Supabase sector_intelligence table."""
    results = [item for item in items if item.get("analyzed") and item.get("relevance_score", 0) >= 40]

    if not SUPABASE_KEY:
        print("[!] No SUPABASE_ANON_KEY — saving to local JSON")
        with open("scanner/facebook_scan_results.json", "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
        print(f"   Saved {len(results)} items locally")
        return results

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    saved = 0
    skipped = 0

    for item in results:
        # Check for duplicate
        existing = (
            sb.table("sector_intelligence")
            .select("id")
            .eq("source_url", item.get("source_url", ""))
            .execute()
        )

        if existing.data:
            skipped += 1
            continue

        sb.table("sector_intelligence").insert({
            "source": item.get("source", "facebook"),
            "source_url": item.get("source_url", ""),
            "title": item["title"][:200],
            "summary": item.get("summary"),
            "category": item.get("category"),
            "entities": json.dumps(item.get("entities", []), ensure_ascii=False),
            "tags": item.get("tags", []),
            "relevance_score": item.get("relevance_score", 50),
            "raw_content": item.get("raw_content", "")[:5000],
            "scan_date": date.today().isoformat(),
        }).execute()
        saved += 1

    print(f"\n>> Saved {saved} new items, skipped {skipped} duplicates")
    return results


def generate_weekly_digest(items: list[dict]) -> str | None:
    """Generate a weekly digest of Facebook findings."""
    if not ANTHROPIC_KEY or not items:
        return None

    items_text = "\n".join(
        f"- [{item.get('category', '?')}] {item['title']}: {item.get('summary', '')}"
        for item in sorted(items, key=lambda x: x.get("relevance_score", 0), reverse=True)[:15]
    )

    try:
        res = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": ANTHROPIC_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": "claude-haiku-4-5-20251001",
                "max_tokens": 1000,
                "system": """אתה כותב סיכום שבועי למנהלת גיוס משאבים בעמותה ישראלית.
כתוב סיכום קצר של מה שנמצא בפייסבוק השבוע שרלוונטי למגזר השלישי.
פורמט: 3-5 נקודות עיקריות, כל אחת 1-2 משפטים.
סמן בכוכבית (*) פריטים שדורשים פעולה (actionable).
כתוב בעברית, סגנון מקצועי-ידידותי.""",
                "messages": [
                    {
                        "role": "user",
                        "content": f"ממצאי סריקת פייסבוק — שבוע של {date.today().isoformat()}:\n{items_text}",
                    }
                ],
            },
            timeout=30,
        )
        res.raise_for_status()
        return res.json()["content"][0]["text"]
    except Exception as e:
        print(f"[!] Digest generation failed: {e}")
        return None


def save_weekly_digest(digest: str):
    """Save weekly digest to sector_knowledge."""
    if not SUPABASE_KEY or not digest:
        return

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    week = date.today().isocalendar()
    week_key = f"facebook_digest_{week.year}_W{week.week:02d}"

    sb.table("sector_knowledge").upsert({
        "topic": week_key,
        "content": digest,
        "source": "facebook_scanner",
        "last_updated": datetime.now().isoformat(),
        "metadata": json.dumps({
            "week": f"{week.year}-W{week.week:02d}",
            "type": "facebook_weekly_digest",
            "scan_date": date.today().isoformat(),
        }, ensure_ascii=False),
    }, on_conflict="topic").execute()

    print(f">> Weekly Facebook digest saved: {week_key}")


def main():
    print(f"=== Facebook Sector Scanner — {date.today().isoformat()} ===\n")

    token = USER_TOKEN or PAGE_TOKEN
    if not token:
        print("[!] No Facebook token available. Set FB_USER_TOKEN or FB_PAGE_TOKEN.")
        print("    Using PAGE_TOKEN from social-post skill as fallback...")
        token = PAGE_TOKEN

    if not ANTHROPIC_KEY:
        print("[!] Warning: ANTHROPIC_API_KEY not set — scanning without AI analysis")

    all_items = []

    # 1. Scan user's feed
    try:
        items = scan_user_feed(token)
        all_items.extend(items)
    except Exception as e:
        print(f"  [!] Feed scan error: {e}")

    # 2. Scan user's groups
    try:
        items = scan_user_groups(token)
        all_items.extend(items)
    except Exception as e:
        print(f"  [!] Group scan error: {e}")

    # 3. Scan monitored groups (always, no keyword filter)
    try:
        items = scan_monitored_groups(token)
        all_items.extend(items)
    except Exception as e:
        print(f"  [!] Monitored group scan error: {e}")

    # 4. Scan monitored sector pages
    try:
        items = scan_monitored_pages(token)
        all_items.extend(items)
    except Exception as e:
        print(f"  [!] Page scan error: {e}")

    # 5. Scan Hopa's own page interactions
    try:
        items = scan_own_page(token)
        all_items.extend(items)
    except Exception as e:
        print(f"  [!] Hopa page scan error: {e}")

    print(f"\n=== Total raw findings: {len(all_items)} ===")

    # 6. AI analysis & classification
    if all_items:
        # Process in batches of 20
        analyzed = []
        for i in range(0, len(all_items), 20):
            batch = all_items[i:i+20]
            analyzed.extend(analyze_with_ai(batch))
            time.sleep(1)

        # 7. Save to Supabase
        results = save_to_supabase(analyzed)

        # 8. Generate weekly digest
        digest = generate_weekly_digest(results)
        if digest:
            print(f"\n>> Weekly Digest:\n{digest}")
            save_weekly_digest(digest)
    else:
        print("No items found to analyze.")

    print("\n=== Facebook scan complete ===")


if __name__ == "__main__":
    main()
