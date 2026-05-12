import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// ── Service Account JWT auth ─────────────────────────────────
// Uses the hopa-analytics service account to authenticate with Google APIs
// No API key needed — the private key signs a JWT that Google exchanges for an access token

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri: string;
}

let cachedToken: { token: string; expires: number } | null = null;

function base64url(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function getAccessToken(sa: ServiceAccountKey): Promise<string> {
  // Return cached token if still valid (with 60s margin)
  if (cachedToken && Date.now() < cachedToken.expires - 60_000) {
    return cachedToken.token;
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  };

  const enc = new TextEncoder();
  const headerB64 = base64url(enc.encode(JSON.stringify(header)));
  const payloadB64 = base64url(enc.encode(JSON.stringify(payload)));
  const unsigned = `${headerB64}.${payloadB64}`;

  // Import private key and sign
  const pemBody = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\n/g, "");
  const keyBytes = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, enc.encode(unsigned))
  );
  const jwt = `${unsigned}.${base64url(signature)}`;

  // Exchange JWT for access token
  const res = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token exchange failed: ${err}`);
  }

  const data = await res.json();
  cachedToken = {
    token: data.access_token,
    expires: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

// ── Drive API ────────────────────────────────────────────────

const FILE_FIELDS = "files(id,name,mimeType,size,modifiedTime,webViewLink,webContentLink,iconLink)";

async function listFolder(folderId: string, token: string) {
  const folderQ = encodeURIComponent(
    `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const fileQ = encodeURIComponent(
    `'${folderId}' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false`
  );

  const [foldersRes, filesRes] = await Promise.all([
    fetch(
      `https://www.googleapis.com/drive/v3/files?q=${folderQ}&fields=files(id,name)&orderBy=name&pageSize=200`,
      { headers: { Authorization: `Bearer ${token}` } }
    ),
    fetch(
      `https://www.googleapis.com/drive/v3/files?q=${fileQ}&fields=${FILE_FIELDS}&orderBy=name&pageSize=200`,
      { headers: { Authorization: `Bearer ${token}` } }
    ),
  ]);

  if (!foldersRes.ok) {
    const err = await foldersRes.text();
    throw new Error(`Drive API error (folders): ${err}`);
  }
  if (!filesRes.ok) {
    const err = await filesRes.text();
    throw new Error(`Drive API error (files): ${err}`);
  }

  const foldersData = await foldersRes.json();
  const filesData = await filesRes.json();

  return {
    folders: foldersData.files ?? [],
    files: filesData.files ?? [],
  };
}

// ── Handler ──────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const folderId = body.folder_id;

    if (!folderId || typeof folderId !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing folder_id" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Load service account from env
    const saJson = Deno.env.get("GOOGLE_SERVICE_ACCOUNT");
    if (!saJson) {
      return new Response(
        JSON.stringify({ error: "Service account not configured" }),
        { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const sa: ServiceAccountKey = JSON.parse(saJson);
    const token = await getAccessToken(sa);
    const result = await listFolder(folderId, token);

    console.log(`drive-list: folder=${folderId}, folders=${result.folders.length}, files=${result.files.length}`);

    return new Response(JSON.stringify(result), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("drive-list error:", String(err));
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
