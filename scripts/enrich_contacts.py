#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Goldfish — Contact & CSR Enrichment Pipeline
מעשיר חברות ב-csr_focus, approach_strategy, contact_email אמיתי
"""
import json, os, re, sys, time
from datetime import datetime, timezone
from urllib.request import urlopen, Request
from urllib.parse import quote as urlquote, unquote

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment.")
    sys.exit(1)
if not GEMINI_KEY:
    print("ERROR: GEMINI_API_KEY must be set in environment.")
    sys.exit(1)

GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={GEMINI_KEY}"
UA = "Mozilla/5.0 Chrome/124"
MAX = 30
DELAY = 2.5


def jina(url, t=25):
    try:
        req = Request(f"https://r.jina.ai/{url}", headers={"Accept": "text/plain", "User-Agent": UA})
        with urlopen(req, timeout=t) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except:
        return ""


def ddg(q, n=3):
    text = jina(f"https://html.duckduckgo.com/html/?q={urlquote(q)}")
    res, seen = [], set()
    for m in re.finditer(r"uddg=(https?%3A%2F%2F[^&]+)", text):
        u = unquote(m.group(1))
        if "duckduckgo" in u or u in seen:
            continue
        seen.add(u)
        ctx = text[max(0, m.start() - 400):m.end() + 150]
        tm = re.search(r"## \[([^\]]{5,150})\]", ctx)
        snip_pattern = r"\]\([^)]+\)\s*\n+([^\n#\[]{20,250})"
        sm = re.search(snip_pattern, ctx)
        res.append({"url": u, "title": tm.group(1) if tm else "", "snip": sm.group(1) if sm else ""})
        if len(res) >= n:
            break
    return res


def sb_get(path, p):
    qs = "&".join(f"{k}={v}" for k, v in p.items())
    req = Request(
        f"{SUPABASE_URL}/rest/v1/{path}?{qs}",
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
    )
    with urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def sb_patch(tbl, rid, data):
    req = Request(
        f"{SUPABASE_URL}/rest/v1/{tbl}?id=eq.{rid}",
        data=json.dumps(data).encode(),
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
        },
        method="PATCH"
    )
    with urlopen(req, timeout=15) as resp:
        return resp.status


def collect(name, website):
    parts = []
    for q in [f"{name} CSR philanthropy grants contact director", f"{name} social responsibility community giving"]:
        for r in ddg(q, 3):
            if r["snip"]:
                parts.append(f"[{r['title']}] {r['snip']}")
        time.sleep(0.4)
    if website:
        for s in ["/csr", "/responsibility", "/community", "/about", "/grants"]:
            pg = jina(website.rstrip("/") + s, 20)
            if pg and len(pg) > 300:
                parts.append(pg[:2000])
                break
    return "\n\n".join(parts)


def gemini(name, ctype, content):
    prompt = f"""You analyze {ctype} "{name}" for CSR/philanthropy data.
Content:
---
{content[:2500]}
---
Return JSON only:
{{"contact_name":null or full name,"contact_email":null or direct personal email (NOT info@/contact@),"contact_role":null or exact title,"csr_focus":["topic1","topic2"],"approach_strategy":"RFP_ONLY|DIRECT_APPROACH|BOTH|UNKNOWN","funding_range_min":null or int ILS,"funding_range_max":null or int ILS,"funding_notes":null or brief Hebrew note}}
Rules: csr_focus in Hebrew like education/youth/periphery. approach=RFP_ONLY if only via RFPs, DIRECT_APPROACH if open to emails/LOI."""
    try:
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.1, "maxOutputTokens": 400}
        }
        req = Request(
            GEMINI_URL,
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urlopen(req, timeout=20) as resp:
            text = json.loads(resp.read())["candidates"][0]["content"]["parts"][0]["text"].strip()
        text = re.sub(r"^```json?\s*|```$", "", text, flags=re.MULTILINE).strip()
        return json.loads(text)
    except Exception as e:
        print(f"  Gemini error: {e}")
        return None


def main():
    print("=== Goldfish Contact + CSR Enrichment ===")
    companies = sb_get("companies", {
        "select": "id,name,company_type,website,contact_email,contact_name,csr_focus,approach_strategy",
        "active": "eq.true",
        "company_type": "in.(business,public,private)",
        "order": "donation_amount.desc.nullslast",
        "limit": str(MAX)
    })
    todo = [c for c in companies if not c.get("csr_focus") or not c.get("approach_strategy")]
    print(f"{len(companies)} fetched, {len(todo)} need enrichment\n")
    enriched = skipped = 0
    for i, c in enumerate(todo):
        name = c["name"]
        ctype = c.get("company_type", "business")
        ws = c.get("website") or ""
        print(f"[{i+1}/{len(todo)}] {name}")
        content = collect(name, ws)
        if not content.strip():
            print("  no content")
            skipped += 1
            continue
        ext = gemini(name, ctype, content)
        if not ext:
            skipped += 1
            continue
        upd = {}
        now = datetime.now(timezone.utc).isoformat()
        em = ext.get("contact_email") or ""
        if em and "@" in em and not any(g in em for g in ["info@", "contact@", "mail@", "office@"]):
            if not c.get("contact_email"):
                upd["contact_email"] = em
        if ext.get("contact_name") and not c.get("contact_name"):
            upd["contact_name"] = ext["contact_name"]
        if ext.get("contact_role"):
            upd["contact_role"] = ext["contact_role"]
        if ext.get("csr_focus") and isinstance(ext["csr_focus"], list):
            upd["csr_focus"] = ext["csr_focus"][:5]
        if ext.get("approach_strategy") in ("RFP_ONLY", "DIRECT_APPROACH", "BOTH", "UNKNOWN"):
            upd["approach_strategy"] = ext["approach_strategy"]
        if ext.get("funding_notes"):
            upd["funding_notes"] = ext["funding_notes"]
        if isinstance(ext.get("funding_range_min"), int):
            upd["funding_range_min"] = ext["funding_range_min"]
        if isinstance(ext.get("funding_range_max"), int):
            upd["funding_range_max"] = ext["funding_range_max"]
        if upd:
            upd.update({"updated_at": now, "enriched_at": now, "data_source": "contact_enriched_ddg"})
            try:
                sb_patch("companies", c["id"], upd)
                print(f"  -> {', '.join(k for k in upd if k not in ('updated_at', 'enriched_at', 'data_source'))}")
                enriched += 1
            except Exception as e:
                print(f"  DB error: {e}")
                skipped += 1
        else:
            print("  nothing new")
            skipped += 1
        time.sleep(DELAY)
    print(f"\n=== DONE: {enriched} enriched, {skipped} skipped ===")


if __name__ == "__main__":
    main()
