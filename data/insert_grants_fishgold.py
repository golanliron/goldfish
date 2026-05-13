"""Insert grants data into Fishgold Supabase (touqczopfjxcpmbxzdjr) via execute_sql batches."""
import json
import sys
import os

sys.stdout.reconfigure(encoding='utf-8')

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
        s = s.replace('"', '').replace("'", "''").replace('{', '').replace('}', '').replace(',', ' ')
        cleaned.append(s)
    if not cleaned:
        return "'{}'::text[]"
    return "'{" + ','.join(cleaned) + "}'::text[]"


# Generate SQL VALUES
all_values = []
for item in items:
    title = escape_sql(item['title'][:250])
    desc = escape_sql(item.get('description', '')[:500]) if item.get('description') else 'NULL'
    source = escape_sql(item.get('source', 'atlas'))
    deadline = escape_sql(item.get('deadline')) if item.get('deadline') else 'NULL'
    funder = escape_sql(item.get('funder')) if item.get('funder') else 'NULL'
    url = escape_sql(item.get('url')) if item.get('url') else 'NULL'
    typ = escape_sql(item.get('type', 'kok'))
    cats = array_literal(item.get('categories', []))
    pops = array_literal(item.get('target_populations', []))
    tags = array_literal(item.get('tags', []))
    active = 'true' if item.get('status', 'open') == 'open' else 'false'

    val = f"({source},{title},{desc},NULL,NULL,{deadline},{cats},'{{}}'::text[],{pops},{tags},{typ},{funder},{url},NULL,{active})"
    all_values.append(val)

# Split into batches of 15
batch_size = 15
batches = []
for i in range(0, len(all_values), batch_size):
    batch = all_values[i:i+batch_size]
    sql = 'INSERT INTO opportunities (source,title,description,amount_min,amount_max,deadline,categories,regions,target_populations,tags,type,funder,url,eligibility,active) VALUES ' + ','.join(batch) + ';'
    batches.append(sql)

# Write batches to files
os.makedirs('data/sql_batches', exist_ok=True)
for i, sql in enumerate(batches):
    with open(f'data/sql_batches/b{i:02d}.sql', 'w', encoding='utf-8') as f:
        f.write(sql)

print(f"Generated {len(batches)} batch files in data/sql_batches/")
print(f"Total items: {len(all_values)}")
print(f"Max batch size: {max(len(b) for b in batches)} chars")
print(f"Avg batch size: {sum(len(b) for b in batches)//len(batches)} chars")
