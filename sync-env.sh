#!/bin/bash
# sync-env.sh — מסנק .env.local ל-Vercel
# הרצה: bash sync-env.sh

VERCEL_TOKEN="${VERCEL_TOKEN:-}"  # set via: export VERCEL_TOKEN=vcp_...
PROJECT_ID="prj_iAdrhB0QROswERi9wH3yXjMfszts"
TEAM_ID="team_zt2np2QpRIfFKwDBKpp8ayQf"
ENV_FILE=".env.local"

# Keys שלא צריך לסנק (Vercel מנהל אותם בעצמו)
SKIP_KEYS="VERCEL|VERCEL_|NX_DAEMON|TURBO_"

if [ ! -f "$ENV_FILE" ]; then
  echo "לא נמצא $ENV_FILE"
  exit 1
fi

echo "מסנק $ENV_FILE ל-Vercel..."

while IFS= read -r line || [ -n "$line" ]; do
  # דלג על שורות ריקות והערות
  [[ -z "$line" || "$line" =~ ^# ]] && continue

  KEY=$(echo "$line" | cut -d'=' -f1)
  VALUE=$(echo "$line" | cut -d'=' -f2- | sed 's/^"//' | sed 's/"$//')

  # דלג על Vercel built-ins
  if echo "$KEY" | grep -qE "$SKIP_KEYS"; then
    continue
  fi

  # בדוק אם קיים
  EXISTING=$(curl -s "https://api.vercel.com/v9/projects/$PROJECT_ID/env?teamId=$TEAM_ID" \
    -H "Authorization: Bearer $VERCEL_TOKEN" | \
    python3 -c "import sys,json; d=json.load(sys.stdin); ids=[e['id'] for e in d.get('envs',[]) if e['key']=='$KEY']; print(ids[0] if ids else '')" 2>/dev/null)

  if [ -n "$EXISTING" ]; then
    # עדכן
    RESULT=$(curl -s -X PATCH "https://api.vercel.com/v9/projects/$PROJECT_ID/env/$EXISTING?teamId=$TEAM_ID" \
      -H "Authorization: Bearer $VERCEL_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"value\":\"$VALUE\",\"target\":[\"production\",\"preview\",\"development\"]}" | \
      python3 -c "import sys,json; d=json.load(sys.stdin); print('עודכן' if 'key' in d else d.get('error',{}).get('message','?'))" 2>/dev/null)
    echo "  $KEY → $RESULT"
  else
    # צור חדש
    RESULT=$(curl -s -X POST "https://api.vercel.com/v10/projects/$PROJECT_ID/env?teamId=$TEAM_ID" \
      -H "Authorization: Bearer $VERCEL_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"key\":\"$KEY\",\"value\":\"$VALUE\",\"type\":\"encrypted\",\"target\":[\"production\",\"preview\",\"development\"]}" | \
      python3 -c "import sys,json; d=json.load(sys.stdin); print('נוצר' if 'key' in d else d.get('error',{}).get('message','?'))" 2>/dev/null)
    echo "  $KEY → $RESULT"
  fi
done < "$ENV_FILE"

echo ""
echo "סיום. זכרי לעשות Redeploy ב-Vercel כדי שהשינויים ייכנסו לתוקף."
