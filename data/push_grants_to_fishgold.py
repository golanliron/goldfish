"""Push all 428 grants to Fishgold Supabase using Management API SQL endpoint."""
import json
import sys
import requests

sys.stdout.reconfigure(encoding='utf-8')

# Supabase Management API - uses the same auth as MCP
# We'll use the project's REST API with service_role key derived from the project
PROJECT_ID = 'touqczopfjxcpmbxzdjr'
SUPABASE_URL = f'https://{PROJECT_ID}.supabase.co'

# Use management API (service_role key loaded from env)
# Set SUPABASE_SERVICE_ROLE_KEY in environment before running

# Use Supabase Management API (same as MCP uses)
MGMT_URL = f'https://api.supabase.com/v1/projects/{PROJECT_ID}/database/query'

# We need the access token that MCP uses - let's try a different approach
# Use the SQL endpoint via supabase-js compatible REST with proper service role JWT

# Actually, let's generate proper INSERT SQL and write to files for MCP execution
with open('data/grants_database.json', 'r', encoding='utf-8') as f:
    data = json.load(f)
items = data.get('items', data.get('grants', []))


def escape_sql(s):
    if s is None:
        return 'NULL'
    s = str(s).replace("'", "''")
    return f"'{s}'"


def array_literal(arr):
    if not arr:
        return "'{}'::text[]"
    cleaned = []
    for s in arr:
        if not s:
            continue
        # Remove problematic chars for pg array literal
        s = s.replace('"', '').replace("'", "''").replace('{', '').replace('}', '').replace(',', ' ')
        cleaned.append(s)
    if not cleaned:
        return "'{}'::text[]"
    return "'{" + ','.join(cleaned) + "}'::text[]"


def build_value(item):
    title = escape_sql(item['title'][:250])
    desc = escape_sql(item.get('description', '')[:400]) if item.get('description') else 'NULL'
    source = escape_sql(item.get('source', 'atlas'))
    deadline = escape_sql(item.get('deadline')) if item.get('deadline') else 'NULL'
    funder = escape_sql(item.get('funder')) if item.get('funder') else 'NULL'
    url = escape_sql(item.get('url')) if item.get('url') else 'NULL'
    typ = escape_sql(item.get('type', 'kok'))
    cats = array_literal(item.get('categories', []))
    pops = array_literal(item.get('target_populations', []))
    tags = array_literal(item.get('tags', []))
    active = 'true' if item.get('status', 'open') == 'open' else 'false'
    return f"({source},{title},{desc},NULL,NULL,{deadline},{cats},'{{}}'::text[],{pops},{tags},{typ},{funder},{url},NULL,{active})"


# Build full SQL in one shot - split to batches of 20
BATCH_SIZE = 20
total_inserted = 0

for batch_start in range(0, len(items), BATCH_SIZE):
    batch_items = items[batch_start:batch_start + BATCH_SIZE]
    values = [build_value(item) for item in batch_items]
    sql = (
        'INSERT INTO opportunities (source,title,description,amount_min,amount_max,deadline,'
        'categories,regions,target_populations,tags,type,funder,url,eligibility,active) VALUES '
        + ','.join(values) + ';'
    )

    batch_num = batch_start // BATCH_SIZE
    with open(f'data/sql_batches/final_{batch_num:02d}.sql', 'w', encoding='utf-8') as f:
        f.write(sql)
    total_inserted += len(batch_items)

print(f"Generated {(len(items) + BATCH_SIZE - 1) // BATCH_SIZE} SQL files")
print(f"Total items: {total_inserted}")
print(f"Files in: data/sql_batches/final_XX.sql")
print(f"Run each file through MCP execute_sql to insert")
