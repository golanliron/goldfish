import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Green API Instance 2 (Liron's personal number)
const GREEN_API_INSTANCE = "7105564230";
const GREEN_API_TOKEN = "aa3deab0a5444ba4a7457cf663e16be8c727af135f994707ad";

// Chatwoot API
const CHATWOOT_URL = "https://app.chatwoot.com";
const CHATWOOT_ACCOUNT_ID = "157872";
const CHATWOOT_API_TOKEN = "FhY8hV7X3NCqHLLfpAEaMiAK";

// Supabase (admin project - for tracking sent messages)
const SUPABASE_URL = "https://vhmwijzcrqjjquxomccq.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZobXdpanpjcnFqanF1eG9tY2NxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1Nzk0MDgsImV4cCI6MjA4OTE1NTQwOH0.rMnAcdMiPddUAoap63tMiqeQQanJoF-HDmzra7P-5Cc";

// Our inbox IDs
const VALID_INBOXES = [102354, 102355, 102358];

async function chatwootAPI(endpoint: string) {
  const res = await fetch(
    `${CHATWOOT_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}${endpoint}`,
    { headers: { "api_access_token": CHATWOOT_API_TOKEN } }
  );
  if (!res.ok) return null;
  return res.json();
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  try {
    // This function is called by a cron/scheduler
    // It checks all open conversations for new outgoing messages and forwards them

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // Get last check timestamp (or default to 2 minutes ago)
    const { data: lastCheck } = await supabase
      .from("chatwoot_sync")
      .select("last_checked_at")
      .eq("id", 1)
      .single();

    const sinceTime = lastCheck?.last_checked_at || new Date(Date.now() - 120000).toISOString();
    const sinceEpoch = Math.floor(new Date(sinceTime).getTime() / 1000);

    console.log("chatwoot-to-whatsapp v4 polling since:", sinceTime);

    let sent = 0;
    const errors: string[] = [];

    // Check each inbox
    for (const inboxId of VALID_INBOXES) {
      // Get open conversations
      const convData = await chatwootAPI(`/conversations?inbox_id=${inboxId}&status=open&page=1`);
      const conversations = convData?.data?.payload || [];

      for (const conv of conversations) {
        const convId = conv.id;

        // Get recent messages for this conversation
        const msgData = await chatwootAPI(`/conversations/${convId}/messages`);
        const messages = msgData?.payload || [];

        for (const msg of messages) {
          // Only outgoing (agent) messages
          if (msg.message_type !== 1) continue;

          // Only messages after last check
          if (msg.created_at <= sinceEpoch) continue;

          // Skip private notes
          if (msg.private) continue;

          // Skip empty
          if (!msg.content || msg.content.trim() === "") continue;

          // Check if already sent
          const { data: existing } = await supabase
            .from("chatwoot_sent")
            .select("id")
            .eq("chatwoot_message_id", msg.id)
            .single();

          if (existing) continue;

          // Get contact to find group_id
          const contactId = conv.meta?.sender?.id;
          if (!contactId) {
            errors.push(`No contact for conv ${convId}`);
            continue;
          }

          const contactData = await chatwootAPI(`/contacts/${contactId}`);
          const groupId = contactData?.custom_attributes?.group_id || "";

          if (!groupId || !groupId.endsWith("@g.us")) {
            // Try from identifier
            const identifier = contactData?.identifier || "";
            const parsed = identifier.replace(/_v\d+[a-z]?$/, "").replace(/_test$/, "").replace("_at_", "@");
            if (!parsed.endsWith("@g.us")) {
              errors.push(`No group_id for conv ${convId}, contact ${contactId}`);
              continue;
            }
            // Send with parsed ID
            const greenApiUrl = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE}/sendMessage/${GREEN_API_TOKEN}`;
            const waRes = await fetch(greenApiUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chatId: parsed, message: msg.content }),
            });
            const waResult = await waRes.json();
            console.log(`✅ Sent to ${parsed}: ${msg.content.slice(0, 50)}`);

            // Mark as sent
            await supabase.from("chatwoot_sent").insert({
              chatwoot_message_id: msg.id,
              group_id: parsed,
              content: msg.content,
              sent_at: new Date().toISOString(),
            });
            sent++;
            continue;
          }

          // Send to WhatsApp
          const greenApiUrl = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE}/sendMessage/${GREEN_API_TOKEN}`;
          const waRes = await fetch(greenApiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chatId: groupId, message: msg.content }),
          });
          const waResult = await waRes.json();
          console.log(`✅ Sent to ${groupId}: ${msg.content.slice(0, 50)}`);

          // Mark as sent
          await supabase.from("chatwoot_sent").insert({
            chatwoot_message_id: msg.id,
            group_id: groupId,
            content: msg.content,
            sent_at: new Date().toISOString(),
          });
          sent++;
        }
      }
    }

    // Update last check time
    await supabase.from("chatwoot_sync").upsert({
      id: 1,
      last_checked_at: new Date().toISOString(),
    });

    return new Response(
      JSON.stringify({ status: "ok", sent, errors: errors.length, error_details: errors }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("chatwoot-to-whatsapp error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
