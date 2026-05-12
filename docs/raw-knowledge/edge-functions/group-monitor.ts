import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ===== CONFIG =====
const ADMIN_SUPABASE_URL = "https://vhmwijzcrqjjquxomccq.supabase.co";
const ADMIN_SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZobXdpanpjcnFqanF1eG9tY2NxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1Nzk0MDgsImV4cCI6MjA4OTE1NTQwOH0.rMnAcdMiPddUAoap63tMiqeQQanJoF-HDmzra7P-5Cc";

const CHATWOOT_URL = "https://app.chatwoot.com";
const CHATWOOT_ACCOUNT_ID = "157872";
const CHATWOOT_API_TOKEN = "FhY8hV7X3NCqHLLfpAEaMiAK";

// Chatwoot Inbox IDs (separated by category)
const BOGRIM_INBOX_ID = 102354;
const MAANIM_INBOX_ID = 102355;
const COORDINATORS_INBOX_ID = 102358;

// ===== MONITORED GROUPS =====
interface GroupInfo {
  name: string;
  category: "bogrim" | "maanim" | "coordinators";
}

const MONITORED_GROUPS: Record<string, GroupInfo> = {
  // ===== בוגרים (14) =====
  "120363377574465550@g.us": { name: "צוות והנהלת מגשימים בית שאן", category: "coordinators" },
  "120363380900242399@g.us": { name: "בוגרי מגשימים בית שאן", category: "bogrim" },
  "120363394756590628@g.us": { name: "בוגרי אורט אדיבי אשקלון - עדכונים", category: "bogrim" },
  "120363396630972934@g.us": { name: "צוות אורט אדיבי אשקלון: הופה", category: "coordinators" },
  "120363399755519966@g.us": { name: "בוגרי תשפד אורט אדיבי אשקלון", category: "bogrim" },
  "120363400657148600@g.us": { name: "בוגרי אדיבי מחזור נ״ח", category: "bogrim" },
  "120363402150440555@g.us": { name: "בוגרי אורט אדיבי תשפב", category: "bogrim" },
  "120363404469988624@g.us": { name: "צוות עתיד טכנולוגי מוצקין: הופה", category: "coordinators" },
  "120363420058434830@g.us": { name: "צוות אורט צור ברק: הופה", category: "coordinators" },
  "120363423694074008@g.us": { name: "בוגרי אורט צור ברק: הופה", category: "bogrim" },
  "120363423050268834@g.us": { name: "בוגרי עתיד טכנולוגי מוצקין: הופה", category: "bogrim" },
  "120363419427852860@g.us": { name: "בוגרי הופה", category: "bogrim" },
  "972506669721-1589385462@g.us": { name: "בוגרי אורט בית הערבה", category: "bogrim" },
  "120363405307796811@g.us": { name: "בוגרי אורט מרום עכו", category: "bogrim" },

  // ===== רכזים (5) =====
  "120363353291333340@g.us": { name: "רכזות מניעת נשירה - תוכנית הופה", category: "coordinators" },

  // ===== מענים (26) =====
  "120363022172540216@g.us": { name: "הורים בחופשת לידה מקריית מוצקין", category: "maanim" },
  "120363023268962256@g.us": { name: "מענים עירוניים לנוער", category: "maanim" },
  "120363041737860261@g.us": { name: "שירות צבאי/לאומי מוצקין", category: "maanim" },
  "120363050008394690@g.us": { name: "עדכוני מלגות 1", category: "maanim" },
  "120363168304078914@g.us": { name: "צעירים באר שבע 1", category: "maanim" },
  "120363188057739013@g.us": { name: "צעירים באר שבע 2", category: "maanim" },
  "120363357077015604@g.us": { name: "מרכז לאודר לתעסוקה בגליל-מעסיקים", category: "maanim" },
  "120363374650260457@g.us": { name: "מרכז לאודר לתעסוקה בגליל-עדכונים", category: "maanim" },
  "120363384005738605@g.us": { name: "עדכוני מלגות 2", category: "maanim" },
  "120363384258069791@g.us": { name: "בוגרי אורט אדיבי מחזור נ׳ תשפה", category: "bogrim" },
  "120363421331538827@g.us": { name: "עדכוני מלגות 3", category: "maanim" },
  "120363423388610537@g.us": { name: "מילואימניקים ירושלמים", category: "maanim" },
  "120363425787447330@g.us": { name: "מילואימניקים בירושלים", category: "maanim" },
  "120363424339988903@g.us": { name: "מרכז לאודר-משרות מפה לאוזן", category: "maanim" },
  "972525433327-1599721174@g.us": { name: "נקסט - משוחררי ירושלים", category: "maanim" },
  "972526308994-1616052722@g.us": { name: "צעירי מוצקין", category: "maanim" },
  "972526308994-1625648656@g.us": { name: "משוחררים מוצקין", category: "maanim" },
  "972542893760-1598272222@g.us": { name: "שאלות בנושא השכלה ומלגות", category: "maanim" },
  "120363076892540063@g.us": { name: "מועדון עכוג׳וב", category: "maanim" },
  "120363255773098568@g.us": { name: "מרכז צעירים עכו 1", category: "maanim" },
  "120363256200881405@g.us": { name: "מרכז צעירים עכו 2", category: "maanim" },
  "120363275057499188@g.us": { name: "מרכז צעירים עכו 3", category: "maanim" },
  "97246168191-1617533670@g.us": { name: "חיילים משוחררים מרכז צעירים עכו", category: "maanim" },
  "120363045325945780@g.us": { name: "נציגות ונציגי פורום נראות", category: "maanim" },
  "120363156384410839@g.us": { name: "מרחבי נראוּת", category: "maanim" },
  "972526648551-1413881629@g.us": { name: "פורום מצב", category: "maanim" },
};

// ===== CHATWOOT HELPERS =====
async function chatwootAPI(endpoint: string, method = "GET", body: any = null) {
  const options: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      "api_access_token": CHATWOOT_API_TOKEN,
    },
  };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(
    `${CHATWOOT_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}${endpoint}`,
    options
  );
  if (!res.ok) {
    console.error(`Chatwoot API error: ${res.status} ${await res.text()}`);
    return null;
  }
  return res.json();
}

function getInboxId(category: string): number {
  if (category === "bogrim") return BOGRIM_INBOX_ID;
  if (category === "coordinators") return COORDINATORS_INBOX_ID;
  return MAANIM_INBOX_ID;
}

// Moved groups get special suffix to avoid identifier conflicts
// Groups that were moved between inboxes need special identifier suffixes
const MOVED_GROUPS: Record<string, string> = {
  "120363394756590628@g.us": "_v5",   // bogrim adivi ashkelon updates
  "120363399755519966@g.us": "_v5",   // bogrim tashpad adivi ashkelon
  "120363400657148600@g.us": "_v5",   // bogrim adivi machzor 58
  "120363402150440555@g.us": "_v5",   // bogrim adivi tashpab
  "120363384258069791@g.us": "_v5",   // bogrim adivi machzor 50
};

function toSafeId(groupId: string, category: string): string {
  if (MOVED_GROUPS[groupId]) return groupId.replace("@", "_at_") + MOVED_GROUPS[groupId];
  const suffix = category === "coordinators" ? "_v3" : "_v2";
  return groupId.replace("@", "_at_") + suffix;
}

async function findContactByIdentifier(groupId: string, category: string): Promise<any> {
  const safeId = toSafeId(groupId, category);
  const data = await chatwootAPI(`/contacts/search?q=${encodeURIComponent(safeId)}&include_contacts=true`);
  if (data?.payload) {
    return data.payload.find((c: any) => c.identifier === safeId);
  }
  return null;
}

async function createContact(groupId: string, groupName: string, category: string): Promise<any> {
  const emoji = category === "bogrim" ? "🎓" : category === "coordinators" ? "👥" : "📋";
  const inboxId = getInboxId(category);
  const result = await chatwootAPI("/contacts", "POST", {
    inbox_id: inboxId,
    name: `${emoji} ${groupName}`,
    identifier: toSafeId(groupId, category),
    custom_attributes: { category, group_id: groupId },
  });
  return result?.payload?.contact || result;
}

async function getOrCreateConversation(contactId: number, category: string): Promise<number | null> {
  const inboxId = getInboxId(category);
  // Check existing conversations for this contact
  const convos = await chatwootAPI(`/contacts/${contactId}/conversations`);
  if (convos?.payload) {
    const open = convos.payload.find(
      (c: any) => c.inbox_id === inboxId && (c.status === "open" || c.status === "pending")
    );
    if (open) return open.id;
  }

  // Create new conversation
  const label = category === "bogrim" ? "בוגרים" : category === "coordinators" ? "רכזים" : "מענים";
  const result = await chatwootAPI("/conversations", "POST", {
    contact_id: contactId,
    inbox_id: inboxId,
    status: "open",
    custom_attributes: { category },
  });

  const convoId = result?.id;
  if (convoId) {
    // Add label
    await chatwootAPI(`/conversations/${convoId}/labels`, "POST", {
      labels: [label],
    });
  }

  return convoId;
}

async function forwardToChatwoot(
  groupId: string,
  groupName: string,
  senderName: string,
  messageText: string,
  category: string
) {
  try {
    // Find or create contact for this group
    let contact = await findContactByIdentifier(groupId, category);
    if (!contact) {
      contact = await createContact(groupId, groupName, category);
    }
    if (!contact?.id) {
      console.error("Could not find/create contact for group:", groupName);
      return;
    }

    // Find or create conversation
    const conversationId = await getOrCreateConversation(contact.id, category);
    if (!conversationId) {
      console.error("Could not find/create conversation for group:", groupName);
      return;
    }

    // Send message
    const content = `**${senderName}**:\n${messageText}`;

    await chatwootAPI(`/conversations/${conversationId}/messages`, "POST", {
      content,
      message_type: "incoming",
    });

    console.log(`✅ Forwarded to Chatwoot: ${groupName} (${category})`);
  } catch (e) {
    console.error("Chatwoot forward error:", e);
  }
}

// ===== MAIN HANDLER =====
serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  try {
    const body = await req.json();
    console.log("group-monitor v9:", JSON.stringify(body).slice(0, 300));

    // Green API webhook format
    const typeWebhook = body.typeWebhook;
    if (typeWebhook !== "incomingMessageReceived") {
      return new Response(JSON.stringify({ status: "ignored", reason: "not incoming message" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const messageData = body.messageData;
    const chatId = body.senderData?.chatId || "";
    const senderName = body.senderData?.senderName || "unknown";
    const senderPhone = body.senderData?.sender || "";

    // ONLY process group messages
    if (!chatId.endsWith("@g.us")) {
      return new Response(JSON.stringify({ status: "ignored", reason: "not a group message" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Check if this group is monitored
    const group = MONITORED_GROUPS[chatId];
    if (!group) {
      return new Response(JSON.stringify({ status: "ignored", reason: "group not monitored" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Extract message text
    let messageText = "";
    let messageType = "text";

    if (messageData?.textMessageData?.textMessage) {
      messageText = messageData.textMessageData.textMessage;
    } else if (messageData?.extendedTextMessageData?.text) {
      messageText = messageData.extendedTextMessageData.text;
    } else if (messageData?.imageMessageData?.caption) {
      messageText = messageData.imageMessageData.caption;
      messageType = "image";
    } else if (messageData?.videoMessageData?.caption) {
      messageText = messageData.videoMessageData.caption;
      messageType = "video";
    } else if (messageData?.documentMessageData?.caption) {
      messageText = messageData.documentMessageData.caption;
      messageType = "document";
    } else {
      messageType = messageData?.typeMessage || "unknown";
      messageText = `[${messageType}]`;
    }

    // Extract URLs
    const urls: string[] = [];
    const urlRegex = /https?:\/\/[^\s]+/g;
    const matches = messageText.match(urlRegex);
    if (matches) urls.push(...matches);

    // Save to Supabase
    const supabase = createClient(ADMIN_SUPABASE_URL, ADMIN_SUPABASE_KEY);
    const { error } = await supabase.from("group_messages").insert({
      group_id: chatId,
      group_name: group.name,
      sender_name: senderName,
      sender_phone: senderPhone,
      message_text: messageText,
      message_type: messageType,
      urls: urls.length > 0 ? urls : null,
      status: "new",
      category: group.category,
    });

    if (error) {
      console.error("Supabase insert error:", error);
    }

    // Forward to Chatwoot
    await forwardToChatwoot(chatId, group.name, senderName, messageText, group.category);

    return new Response(
      JSON.stringify({
        status: "saved",
        group: group.name,
        category: group.category,
        sender: senderName,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("group-monitor error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
