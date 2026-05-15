import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VERIFY_TOKEN = "goldfish_webhook_2026";
const SUPABASE_URL = "https://touqczopfjxcpmbxzdjr.supabase.co";
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";
const WA_TOKEN = Deno.env.get("WA_ACCESS_TOKEN") || "";
const WA_PHONE_ID = Deno.env.get("WA_PHONE_NUMBER_ID") || "1125971160599592";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const GOLDFISH_SYSTEM = `אתה גולדפיש — דג זהב עתיק עם 50+ שנות ניסיון בגיוס משאבים לעמותות בישראל.
אתה מומחה ב: קולות קוראים, כתיבת הגשות, זיהוי קרנות, אסטרטגיית גיוס, CSR, ומיפוי מגזר שלישי.

כללי ברזל:
1. תמיד חוקר בעצמך — לא מבקש מהמשתמש לחפש
2. עונה בעברית, קצר וענייני (וואטסאפ = הודעות קצרות!)
3. מכיר 954 חברות, 572 קולות קוראים, 185 עמותות
4. לעולם לא ממציא — אם לא יודע, אומר "לא מכיר, בוא נבדוק"
5. נותן URL כשיש, תמיד עם דדליין
6. משתמש באמוג'י דג 🐟 מדי פעם

סגנון: חם, ישיר, מקצועי. לא רובוטי. כמו יועץ ותיק שמכיר את כל השוק.
הודעות קצרות — מקסימום 3-4 משפטים בתשובה רגילה. רק בהגשה/ניתוח ארוך יותר.`;

// --- Webhook verification (GET) ---
function handleVerification(url: URL): Response {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified!");
    return new Response(challenge, { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

// --- Get or create conversation ---
async function getOrCreateConversation(phone: string) {
  const { data: existing } = await supabase
    .from("wa_conversations")
    .select("*")
    .eq("phone", phone)
    .single();

  if (existing) return existing;

  const { data: newConv } = await supabase
    .from("wa_conversations")
    .insert({ phone })
    .select()
    .single();

  return newConv;
}

// --- Save message ---
async function saveMessage(conversationId: string, phone: string, direction: string, body: string, waMessageId?: string) {
  await supabase.from("wa_messages").insert({
    conversation_id: conversationId,
    phone,
    direction,
    body,
    wa_message_id: waMessageId,
  });
}

// --- Get recent history ---
async function getRecentHistory(conversationId: string, limit = 10) {
  const { data } = await supabase
    .from("wa_messages")
    .select("direction, body, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!data) return [];
  return data.reverse();
}

// --- Search grants for context ---
async function searchGrants(query: string) {
  const words = query.split(/\s+/).filter(w => w.length > 2).slice(0, 3);
  if (words.length === 0) return [];

  let results: any[] = [];
  for (const word of words) {
    const { data } = await supabase
      .from("opportunities")
      .select("title, funder, deadline, url, categories, target_populations")
      .eq("active", true)
      .ilike("title", `%${word}%`)
      .limit(5);
    if (data) results.push(...data);
  }

  // Deduplicate by title
  const seen = new Set();
  return results.filter(r => {
    if (seen.has(r.title)) return false;
    seen.add(r.title);
    return true;
  }).slice(0, 5);
}

// --- Search companies for context ---
async function searchCompanies(query: string) {
  const words = query.split(/\s+/).filter(w => w.length > 2).slice(0, 2);
  if (words.length === 0) return [];

  for (const word of words) {
    const { data } = await supabase
      .from("companies")
      .select("name, company_type, description, contact_name, contact_email, contact_role")
      .ilike("name", `%${word}%`)
      .limit(3);
    if (data && data.length > 0) return data;
  }
  return [];
}

// --- Call Claude API ---
async function callClaude(messages: any[], orgContext: string) {
  const systemPrompt = GOLDFISH_SYSTEM + (orgContext ? `\n\nהקשר ארגוני:\n${orgContext}` : "");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
      system: systemPrompt,
      messages,
    }),
  });

  const result = await response.json();
  return result.content?.[0]?.text || "סליחה, לא הצלחתי לעבד את ההודעה. נסי שוב 🐟";
}

// --- Send WhatsApp message ---
async function sendWhatsAppMessage(to: string, text: string) {
  // Split long messages (WA limit ~4096 chars)
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= 4000) {
      chunks.push(remaining);
      break;
    }
    // Find last newline before 4000
    let splitAt = remaining.lastIndexOf("\n", 4000);
    if (splitAt < 2000) splitAt = 4000;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trim();
  }

  for (const chunk of chunks) {
    await fetch(`https://graph.facebook.com/v19.0/${WA_PHONE_ID}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${WA_TOKEN}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: chunk },
      }),
    });
  }
}

// --- Mark message as read ---
async function markAsRead(messageId: string) {
  await fetch(`https://graph.facebook.com/v19.0/${WA_PHONE_ID}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${WA_TOKEN}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    }),
  });
}

// --- Main handler ---
serve(async (req: Request) => {
  const url = new URL(req.url);

  // Webhook verification
  if (req.method === "GET") {
    return handleVerification(url);
  }

  // Incoming message
  if (req.method === "POST") {
    // Parse body first so we can respond immediately
    let body: any;
    try {
      body = await req.json();
    } catch {
      return new Response("OK", { status: 200 });
    }

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    // Skip status updates — respond immediately
    if (!value?.messages) {
      return new Response("OK", { status: 200 });
    }

    const message = value.messages[0];
    const msgId = message.id;

    // Idempotency check — abort if already processed
    const { data: existing } = await supabase
      .from("wa_messages")
      .select("id")
      .eq("wa_message_id", msgId)
      .maybeSingle();

    if (existing) {
      return new Response("OK", { status: 200 });
    }

    // Respond 200 immediately to Meta, process in background
    const responsePromise = new Response("OK", { status: 200 });

    // Process in background (dangling promise — Deno edge keeps alive)
    (async () => {
    try {
      const from = message.from; // phone number
      const msgType = message.type;

      // Only handle text messages for now
      let userText = "";
      if (msgType === "text") {
        userText = message.text.body;
      } else if (msgType === "document" || msgType === "image") {
        userText = "[קובץ שנשלח — בגרסה הבאה אוכל לקרוא קבצים 🐟]";
      } else {
        userText = message.text?.body || "[הודעה לא טקסטואלית]";
      }

      // Mark as read
      await markAsRead(msgId);

      // Get/create conversation
      const conversation = await getOrCreateConversation(from);
      if (!conversation) {
        return new Response("OK", { status: 200 });
      }

      // Save incoming message
      await saveMessage(conversation.id, from, "in", userText, msgId);

      // Get recent history
      const history = await getRecentHistory(conversation.id);

      // Build context: search for relevant grants/companies
      let orgContext = "";
      if (conversation.org_name) {
        orgContext = `עמותה: ${conversation.org_name}\n`;
      }

      // Search grants if message mentions relevant keywords
      const grantKeywords = ["קול קורא", "מענק", "קרן", "הגשה", "דדליין", "מימון", "תקציב", "פתוח"];
      const hasGrantKeyword = grantKeywords.some(kw => userText.includes(kw));
      if (hasGrantKeyword) {
        const grants = await searchGrants(userText);
        if (grants.length > 0) {
          orgContext += "\nקולות קוראים רלוונטיים:\n" + grants.map(g =>
            `- ${g.title} | ${g.funder} | דדליין: ${g.deadline || "פתוח"} | ${g.url || "אין לינק"}`
          ).join("\n");
        }
      }

      // Search companies if mentioned
      const companyKeywords = ["חברה", "חברת", "תורם", "CSR", "קרן"];
      const hasCompanyKeyword = companyKeywords.some(kw => userText.includes(kw));
      if (hasCompanyKeyword) {
        const companies = await searchCompanies(userText);
        if (companies.length > 0) {
          orgContext += "\nחברות רלוונטיות:\n" + companies.map(c =>
            `- ${c.name} (${c.company_type}) | ${c.description?.slice(0, 100) || ""} | איש קשר: ${c.contact_name || "אין"}`
          ).join("\n");
        }
      }

      // Build Claude messages from history
      const claudeMessages = history.map(m => ({
        role: m.direction === "in" ? "user" : "assistant",
        content: m.body,
      }));

      // If first message (no history except current), add welcome context
      if (claudeMessages.length <= 1) {
        if (!conversation.org_name) {
          orgContext += "\nזו הודעה ראשונה מהמשתמש הזה. הצג את עצמך בקצרה (שורה אחת) ושאל מה שם העמותה/הארגון שלו.";
        }
      }

      // Check if user told us their org name (simple detection)
      if (!conversation.org_name && claudeMessages.length <= 3) {
        const namePatterns = ["העמותה שלי", "אני מ", "הארגון שלנו", "שם העמותה"];
        if (namePatterns.some(p => userText.includes(p)) || claudeMessages.length === 2) {
          // Ask Claude to extract org name
          orgContext += "\nאם המשתמש ציין שם עמותה/ארגון, ענה בשורה הראשונה: ORG_NAME:שם הארגון (בדיוק). אחרי זה המשך בתשובה רגילה.";
        }
      }

      // Call Claude
      const aiResponse = await callClaude(claudeMessages, orgContext);

      // Extract org name if Claude detected it
      let cleanResponse = aiResponse;
      if (aiResponse.startsWith("ORG_NAME:")) {
        const firstLine = aiResponse.split("\n")[0];
        const orgName = firstLine.replace("ORG_NAME:", "").trim();
        cleanResponse = aiResponse.split("\n").slice(1).join("\n").trim();

        // Update conversation with org name
        await supabase
          .from("wa_conversations")
          .update({ org_name: orgName, updated_at: new Date().toISOString() })
          .eq("id", conversation.id);
      }

      // Save outgoing message
      await saveMessage(conversation.id, from, "out", cleanResponse);

      // Send via WhatsApp
      await sendWhatsAppMessage(from, cleanResponse);

    } catch (error) {
      console.error("Error processing message:", error);
    }
    })();

    return responsePromise;
  }

  return new Response("Method not allowed", { status: 405 });
});
