import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Green API Instance 2 (Liron's number)
const GREEN_API_INSTANCE = "7105564230";
const GREEN_API_TOKEN = "aa3deab0a5444ba4a7457cf663e16be8c727af135f994707ad";

// Supabase Admin
const SUPABASE_URL = "https://vhmwijzcrqjjquxomccq.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZobXdpanpjcnFqanF1eG9tY2NxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1Nzk0MDgsImV4cCI6MjA4OTE1NTQwOH0.rMnAcdMiPddUAoap63tMiqeQQanJoF-HDmzra7P-5Cc";

// Bogrim group IDs
const BOGRIM_GROUPS: Record<string, string> = {
  "120363380900242399@g.us": "בוגרי מגשימים בית שאן",
  "120363394756590628@g.us": "בוגרי אורט אדיבי אשקלון - עדכונים",
  "120363399755519966@g.us": "בוגרי תשפד אורט אדיבי אשקלון",
  "120363400657148600@g.us": "בוגרי אדיבי מחזור נ״ח",
  "120363402150440555@g.us": "בוגרי אורט אדיבי תשפב",
  "120363423694074008@g.us": "בוגרי אורט צור ברק: הופה",
  "120363423050268834@g.us": "בוגרי עתיד טכנולוגי מוצקין: הופה",
  "120363419427852860@g.us": "בוגרי הופה",
  "972506669721-1589385462@g.us": "בוגרי אורט בית הערבה",
  "120363405307796811@g.us": "בוגרי אורט מרום עכו",
  "120363384258069791@g.us": "בוגרי אורט אדיבי מחזור נ׳ תשפה",
};

// Test group
const TEST_GROUPS: Record<string, string> = {
  "120363024544452787@g.us": "משימות לירון",
};

async function sendToWhatsApp(chatId: string, message: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.green-api.com/waInstance${GREEN_API_INSTANCE}/sendMessage/${GREEN_API_TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, message }),
      }
    );
    const data = await res.json();
    console.log(`✅ Sent to ${chatId}: ${data.idMessage || "ok"}`);
    return true;
  } catch (e) {
    console.error(`❌ Failed to send to ${chatId}:`, e);
    return false;
  }
}

Deno.serve(async (req: Request) => {
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
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // Get pending messages where scheduled_at <= now
    const now = new Date().toISOString();
    const { data: messages, error } = await supabase
      .from("scheduled_messages")
      .select("*")
      .eq("status", "pending")
      .lte("scheduled_at", now)
      .order("scheduled_at", { ascending: true })
      .limit(10);

    if (error) {
      console.error("DB error:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!messages || messages.length === 0) {
      return new Response(JSON.stringify({ status: "no_pending" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log(`send-scheduled v1: ${messages.length} messages to send`);

    const results: any[] = [];

    for (const msg of messages) {
      // Mark as sending (prevent double-send)
      await supabase
        .from("scheduled_messages")
        .update({ status: "sending" })
        .eq("id", msg.id);

      // Determine target groups
      let targetGroups: Record<string, string> = {};

      if (msg.target_groups && msg.target_groups.length > 0) {
        // Specific groups listed
        for (const gid of msg.target_groups) {
          const name = BOGRIM_GROUPS[gid] || TEST_GROUPS[gid] || gid;
          targetGroups[gid] = name;
        }
      } else if (msg.target_category === "bogrim") {
        targetGroups = BOGRIM_GROUPS;
      } else if (msg.target_category === "test") {
        targetGroups = TEST_GROUPS;
      }

      let sentCount = 0;
      let failCount = 0;
      const groupIds = Object.keys(targetGroups);

      for (const groupId of groupIds) {
        const ok = await sendToWhatsApp(groupId, msg.content);
        if (ok) sentCount++;
        else failCount++;
        // Small delay between sends to avoid rate limiting
        if (groupIds.length > 1) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      // Mark as sent
      await supabase
        .from("scheduled_messages")
        .update({
          status: failCount === 0 ? "sent" : "partial",
          sent_at: new Date().toISOString(),
          note: `${sentCount}/${groupIds.length} groups sent`,
        })
        .eq("id", msg.id);

      results.push({
        id: msg.id,
        sent: sentCount,
        failed: failCount,
        total: groupIds.length,
      });
    }

    return new Response(JSON.stringify({ status: "ok", results }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("send-scheduled error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
