import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GREEN_INSTANCE = "7105301719";
const GREEN_TOKEN = "2ed49585655e49169428bcbc2151146779e7835b208d45cdbf";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

let cachedKey: string | null = null;
async function getAnthropicKey(): Promise<string> {
  if (cachedKey) return cachedKey;
  const envKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (envKey) { cachedKey = envKey; return envKey; }
  try {
    const { data, error } = await supabase.rpc("vault_read_secret", { secret_name: "anthropic_api_key" });
    if (!error && data) { cachedKey = data as string; return cachedKey; }
  } catch (_) {}
  return "";
}

// ==================== UTILITIES ====================

async function sendWhatsApp(phone: string, msg: string) {
  // Normalize phone: remove +, spaces, dashes
  let clean = phone.replace(/[\s\-\+\(\)]/g, "");
  // If starts with 0, convert to 972
  if (clean.startsWith("0")) clean = "972" + clean.substring(1);
  // If doesn't start with 972, add it
  if (!clean.startsWith("972")) clean = "972" + clean;

  const chatId = clean + "@c.us";

  try {
    const r = await fetch(
      `https://api.green-api.com/waInstance${GREEN_INSTANCE}/sendMessage/${GREEN_TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, message: msg }),
      }
    );
    console.log("Green API:", r.status, (await r.text()).substring(0, 120));
    return { ok: r.ok, chatId };
  } catch (e) {
    console.error("send error:", String(e));
    return { ok: false, chatId };
  }
}

async function callClaude(prompt: string): Promise<string> {
  const apiKey = await getAnthropicKey();
  console.log("callClaude: key length =", apiKey.length, "prompt length =", prompt.length);
  if (!apiKey) { console.error("No API key!"); return ""; }
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 800,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const raw = await r.text();
    console.log("Claude status:", r.status, "response:", raw.substring(0, 300));
    if (!r.ok) return "";
    const d = JSON.parse(raw);
    return d?.content?.[0]?.text ?? "";
  } catch(e) {
    console.error("callClaude error:", String(e));
    return "";
  }
}

// ==================== MAIN ====================

Deno.serve(async (req: Request) => {
  // CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const name = String(body.name || "").trim();
  const phone = String(body.phone || "").trim();
  const message = String(body.message || "").trim();
  const subject = String(body.subject || "").trim();

  if (!phone) {
    return new Response(
      JSON.stringify({ ok: false, error: "missing phone" }),
      { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  }

  console.log(`Lead auto-reply: ${name} | ${phone} | ${subject} | ${message.substring(0, 50)}`);

  // Fetch active programs
  const { data: programs } = await supabase
    .from("programs")
    .select("name,category,subcategory,description,phone,url,geographic_area,age_track")
    .eq("status", "active")
    .limit(500);

  const programsList = (programs ?? [])
    .map(
      (p: Record<string, unknown>, i: number) =>
        `[${i + 1}] ${p.name} | ${p.category} | ${p.subcategory || ""} | ${p.geographic_area || "ארצי"} | גיל:${p.age_track === "1418" ? "14-18" : "18-26"} | ${(String(p.description || "")).substring(0, 80)}${p.phone ? " | ☎️" + p.phone : ""}${p.url ? " | 🔗" + p.url : ""}`
    )
    .join("\n");

  const prompt = `אתה הבוט של עמותת הופה. צעיר/ה השאיר/ה פנייה באתר hopa.org.il.

פרטי הפנייה:
- שם: ${name || "לא צוין"}
- נושא: ${subject || "לא צוין"}
- הודעה: ${message || "לא צוין"}

הנה כל ${(programs ?? []).length} המענים הפעילים:
${programsList}

=== משימה ===
כתוב הודעת וואטסאפ חמה וקצרה.

מבנה ההודעה:
1. פתיחה: "הופה! 🧡 שמחים שפנית אלינו${name ? ", " + name : ""}!"
2. משפט קצר שמראה שהבנת מה הצעיר/ה מחפש/ת
3. 3-5 מענים רלוונטיים מהרשימה — לכל מענה: *שם* + שורה קצרה + טלפון/קישור אם יש
4. סיום: "רוצה לשמוע עוד? כתוב/כתבי לנו כאן 😊" + קישור hopa.org.il

=== כללים ===
- עברית, פורמט וואטסאפ (*bold*)
- שפה חמה, ישירה, לא רשמית
- אל תמציא מענים — רק מהרשימה
- אם אין מספיק מידע בפנייה — בחר מענים פופולריים מגוונים
- אם הנושא/הודעה ריקים — תן סקירה כללית של מה הופה מציעה עם כמה דוגמאות
- קצר! לא יותר מ-15 שורות`;

  const reply = await callClaude(prompt);

  if (!reply) {
    // Fallback static message
    const fallback = `הופה! 🧡 שמחים שפנית אלינו${name ? ", " + name : ""}!\n\nקיבלנו את ההודעה שלך ונחזור אליך בהקדם.\n\nבינתיים, מוזמן/ת לחפש מענים באתר:\n🔗 hopa.org.il\n\nאו לכתוב לנו כאן בוואטסאפ ונעזור למצוא מה שמתאים לך 😊`;
    await sendWhatsApp(phone, fallback);
    return new Response(
      JSON.stringify({ ok: true, type: "fallback" }),
      { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  }

  const result = await sendWhatsApp(phone, reply);

  return new Response(
    JSON.stringify({ ok: result.ok, type: "smart", chatId: result.chatId }),
    { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
  );
});
