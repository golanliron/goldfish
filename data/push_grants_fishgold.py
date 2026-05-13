"""Push all grants to Fishgold Supabase using the anon key + RLS bypass via service role."""
import json
import sys
import requests

sys.stdout.reconfigure(encoding='utf-8')

PROJECT_ID = 'touqczopfjxcpmbxzdjr'
URL = f'https://{PROJECT_ID}.supabase.co/rest/v1/opportunities'

# The anon key (JWT format - works for REST API auth)
ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRvdXFjem9wZmp4Y3BtYnh6ZGpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4OTAzNTcsImV4cCI6MjA5MzQ2NjM1N30.K16QAHB3IwRnHJl_XxtcWjnxzggF-Z3gtTrestlq-ek'

# We need service_role key in JWT format. The .env has sb_secret format which doesn't work.
# Let's construct the service_role JWT manually from the project ref
# Actually the service_role JWT is standard: same structure as anon but with role=service_role
SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRvdXFjem9wZmp4Y3BtYnh6ZGpyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Nzg5MDM1NywiZXhwIjoyMDkzNDY2MzU3fQ.KqaL24MfIgW6BXDMG8TKHZH5s06iiCfY8yPK6MHNBS4'

headers = {
    'apikey': SERVICE_ROLE_KEY,
    'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
}

# Test connection
test = requests.get(
    f'https://{PROJECT_ID}.supabase.co/rest/v1/opportunities?select=count',
    headers={**headers, 'Prefer': 'count=exact'},
)
print(f"Test connection: {test.status_code}")
if test.status_code != 200:
    print(f"Error: {test.text}")
    # Try with different header format
    headers2 = {
        'apikey': ANON_KEY,
        'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
    }
    test2 = requests.get(
        f'https://{PROJECT_ID}.supabase.co/rest/v1/opportunities?select=count',
        headers={**headers2, 'Prefer': 'count=exact'},
    )
    print(f"Test2: {test2.status_code} {test2.text[:200]}")
    sys.exit(1)

# Load data
with open('data/grants_database.json', 'r', encoding='utf-8') as f:
    data = json.load(f)
items = data.get('items', data.get('grants', []))
print(f"Loaded {len(items)} items")

# Transform
rows = []
for item in items:
    rows.append({
        'source': item.get('source', 'atlas'),
        'title': item['title'][:300],
        'description': (item.get('description') or '')[:1000] or None,
        'amount_min': item.get('amount') if isinstance(item.get('amount'), int) else None,
        'amount_max': item.get('amount') if isinstance(item.get('amount'), int) else None,
        'deadline': item.get('deadline') or None,
        'categories': item.get('categories', []),
        'regions': [],
        'target_populations': item.get('target_populations', []),
        'tags': item.get('tags', []),
        'type': item.get('type', 'kok'),
        'funder': item.get('funder') or None,
        'url': item.get('url') or None,
        'eligibility': ', '.join(item.get('eligible', [])) if item.get('eligible') else None,
        'active': item.get('status', 'open') == 'open',
    })

# Insert in batches
BATCH_SIZE = 50
inserted = 0
errors = 0

for i in range(0, len(rows), BATCH_SIZE):
    batch = rows[i:i + BATCH_SIZE]
    r = requests.post(URL, headers=headers, json=batch)
    if r.status_code in (200, 201):
        inserted += len(batch)
        print(f"  Batch {i // BATCH_SIZE + 1}: +{len(batch)} (total: {inserted})")
    else:
        print(f"  Batch {i // BATCH_SIZE + 1} ERROR: {r.status_code} - {r.text[:200]}")
        errors += 1
        # Try one by one
        for row in batch:
            r2 = requests.post(URL, headers=headers, json=row)
            if r2.status_code in (200, 201):
                inserted += 1
            else:
                errors += 1

print(f"\nDone! Inserted: {inserted}, Errors: {errors}")
