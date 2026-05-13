"""
Atlas Grants -> Supabase Uploader
קורא את data/atlas_full_export.json ומעדכן את טבלת opportunities
- קולות קוראים (kok) -> type='grant', active=true (אם דדליין בתוקף)
- קרנות (fund) -> type='fund'
- עסקים (business) -> type='business'
- מדלג על כפילויות לפי title
- מעדכן דדליין וסטטוס לקיימים
"""

import json
import os
import sys
from datetime import datetime, date
from supabase import create_client

SUPABASE_URL = "https://touqczopfjxcpmbxzdjr.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRvdXFjem9wZmp4Y3BtYnh6ZGpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDY3MTQ2MTIsImV4cCI6MjA2MjI5MDYxMn0.TS5V-PBSbSJUFQCFKLqggWDHLhSo56ck0bPH2C9MKkY"

ATLAS_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "atlas_full_export.json")

# Mapping atlas tags -> our categories
TAG_TO_CATEGORY = {
    "חינוך": "education", "השכלה": "education", "הכשרה": "education",
    "רווחה": "welfare", "סיוע": "welfare", "שיקום": "welfare",
    "בריאות": "health", "רפואה": "health", "נפש": "health",
    "תעסוקה": "employment", "יזמות": "employment", "עסק": "employment",
    "קהילה": "community", "חברה": "community", "מעורבות": "community",
    "תרבות": "culture", "אמנות": "culture", "ספורט": "sport",
    "סביבה": "environment", "קיימות": "environment", "אקלים": "environment",
    "טכנולוגיה": "technology", "חדשנות": "technology", "מו\"פ": "technology",
    "דיור": "housing", "שיכון": "housing",
    "משפט": "legal", "זכויות": "legal",
}

TAG_TO_POPULATION = {
    "נוער": "youth", "צעירים": "young_adults", "בני נוער": "youth",
    "נשים": "women", "קשישים": "elderly", "מבוגרים": "elderly",
    "מוגבלויות": "disabilities", "נכויות": "disabilities",
    "עולים": "immigrants", "חרדים": "haredi", "ערבים": "arab",
    "חיילים": "soldiers", "משוחררים": "soldiers", "צבא": "soldiers",
    "סטודנטים": "students", "אקדמיה": "students",
    "פריפריה": "periphery_residents", "דרום": "periphery_residents", "צפון": "periphery_residents",
    "סיכון": "youth_at_risk", "מצוקה": "youth_at_risk",
    "אתיופים": "immigrants", "בדואים": "arab",
}


def parse_deadline(dl_str):
    """Parse DD-MM-YYYY or YYYY-MM-DD to date"""
    if not dl_str:
        return None
    for fmt in ("%d-%m-%Y", "%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(dl_str.strip(), fmt).date()
        except ValueError:
            continue
    return None


def extract_categories(tags):
    cats = set()
    for tag in tags:
        for keyword, cat in TAG_TO_CATEGORY.items():
            if keyword in tag:
                cats.add(cat)
    return list(cats) or ["other"]


def extract_populations(tags, title="", description=""):
    pops = set()
    all_text = " ".join(tags) + " " + title + " " + description
    for keyword, pop in TAG_TO_POPULATION.items():
        if keyword in all_text:
            pops.add(pop)
    return list(pops) or ["other"]


def main():
    print("=== Atlas -> Supabase Uploader ===\n")

    if not os.path.exists(ATLAS_FILE):
        print(f"[X] File not found: {ATLAS_FILE}")
        print("    Run atlas_scraper.py first to generate the export.")
        sys.exit(1)

    with open(ATLAS_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    items = data.get("items", [])
    scraped_date = data.get("metadata", {}).get("scraped_date", "unknown")
    print(f"[*] Loaded {len(items)} items (scraped: {scraped_date})")

    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    today = date.today()

    # Get existing atlas items to avoid duplicates
    existing = supabase.table("opportunities").select("id, title").ilike("source", "%atlas%").execute()
    existing_titles = {r["title"][:40].lower() for r in (existing.data or [])}
    print(f"[*] {len(existing_titles)} existing Atlas items in DB")

    stats = {"new": 0, "skipped": 0, "expired": 0, "updated": 0}
    type_map = {"kok": "grant", "fund": "fund", "business": "business", "endowment": "fund"}

    for item in items:
        title = item.get("title") or item.get("name") or ""
        if not title or len(title) < 8:
            stats["skipped"] += 1
            continue

        # Check duplicate
        if title[:40].lower() in existing_titles:
            stats["skipped"] += 1
            continue

        atlas_type = item.get("type", "unknown")
        our_type = type_map.get(atlas_type, "other")

        dl = parse_deadline(item.get("deadline", ""))
        is_expired = dl and dl < today

        tags = item.get("tags", [])
        description = item.get("description", "")

        categories = extract_categories(tags)
        populations = extract_populations(tags, title, description)

        # Only insert kok (grants) as active opportunities
        # Funds and businesses go in as reference data (not active)
        is_active = (atlas_type == "kok" and not is_expired)

        row = {
            "title": title,
            "description": description[:1000] if description else None,
            "funder": item.get("funder") or None,
            "deadline": dl.isoformat() if dl else None,
            "url": item.get("url") or None,
            "categories": categories,
            "target_populations": populations,
            "active": is_active,
            "source": "Atlas Grants",
            "type": our_type,
            "amount_max": None,
        }

        # Try to extract amount
        amt = item.get("amount", "")
        if amt:
            import re
            nums = re.findall(r"[\d,]+", str(amt).replace(",", ""))
            if nums:
                try:
                    row["amount_max"] = int(nums[0])
                except ValueError:
                    pass

        try:
            supabase.table("opportunities").insert(row).execute()
            existing_titles.add(title[:40].lower())
            if is_active:
                stats["new"] += 1
            elif is_expired:
                stats["expired"] += 1
            else:
                stats["updated"] += 1
        except Exception as e:
            print(f"  [!] Error inserting '{title[:50]}': {e}")
            stats["skipped"] += 1

    print(f"\n{'='*50}")
    print(f" New active grants: {stats['new']}")
    print(f" Reference items (funds/business): {stats['updated']}")
    print(f" Expired (inserted as inactive): {stats['expired']}")
    print(f" Skipped (duplicates): {stats['skipped']}")
    print(f"{'='*50}")

    # Also reactivate any existing atlas grants whose deadline is still valid
    reactivated = supabase.table("opportunities") \
        .update({"active": True}) \
        .ilike("source", "%atlas%") \
        .eq("type", "grant") \
        .gte("deadline", today.isoformat()) \
        .eq("active", False) \
        .execute()
    if reactivated.data:
        print(f" Reactivated {len(reactivated.data)} grants with valid deadlines")

    # Deactivate expired
    deactivated = supabase.table("opportunities") \
        .update({"active": False}) \
        .ilike("source", "%atlas%") \
        .eq("active", True) \
        .lt("deadline", today.isoformat()) \
        .execute()
    if deactivated.data:
        print(f" Deactivated {len(deactivated.data)} expired grants")


if __name__ == "__main__":
    main()
