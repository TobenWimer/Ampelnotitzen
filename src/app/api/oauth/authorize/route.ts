// Zeigt ein Passphrase-Formular (GET) und stellt bei richtiger Eingabe einen
// Authorization Code aus (POST). redirect_uri wird bei JEDEM Schritt neu gegen die
// beim Client registrierten URIs und gegen die Host-Allowlist geprueft, nie blind aus
// dem versteckten Formularfeld uebernommen - das waere ein offener Redirect. Das
// Formular zeigt Client-Namen und Ziel-Host, damit man sieht, wohin die Freigabe geht.

import { getClient, createAuthCode, verifyPassphrase, type TokenScope } from "@/lib/oauthStore";

export const runtime = "nodejs";

const RESOURCE_LABELS: Record<string, string> = {
  "/api/mcp": "cbrain",
  "/api/apple": "Apple Kalender & Erinnerungen",
};

const ALLOWED_REDIRECT_HOSTS = new Set([
  "claude.ai",
  "claude.com",
  "chatgpt.com",
  "chat.openai.com",
  "platform.openai.com",
  "localhost",
  "127.0.0.1",
]);

function redirectHostAllowed(redirectUri: string): boolean {
  try {
    const url = new URL(redirectUri);
    if (!ALLOWED_REDIRECT_HOSTS.has(url.hostname)) return false;
    const isLoopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    return url.protocol === "https:" || (isLoopback && url.protocol === "http:");
  } catch {
    return false;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resourceLabel(resource: string | null): string {
  if (!resource) return "cbrain";
  try {
    const path = new URL(resource).pathname;
    return RESOURCE_LABELS[path] ?? resource;
  } catch {
    return resource;
  }
}

type ConsentInfo = { clientName: string; redirectHost: string };

function renderForm(params: URLSearchParams, info: ConsentInfo, error?: string): Response {
  const hidden = ["client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method", "resource"]
    .map((key) => {
      const value = params.get(key) ?? "";
      return `<input type="hidden" name="${key}" value="${escapeHtml(value)}">`;
    })
    .join("\n");

  const label = escapeHtml(resourceLabel(params.get("resource")));

  const html = `<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<title>${label} – Zugriff bestätigen</title>
<style>
  body { background:#050708; color:#e6f6ff; font-family:system-ui,sans-serif;
         display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; }
  form { background:#0d1214; border:1px solid #1f2a2d; border-radius:12px; padding:2rem;
         width:min(90vw,360px); text-align:center; }
  h1 { font-size:1rem; letter-spacing:.08em; text-transform:uppercase; color:#7dd8ff; margin:0 0 1.2rem; }
  .who { font-size:.85rem; color:#9fb3b8; margin:0 0 1.2rem; line-height:1.5; word-break:break-word; }
  .who strong { color:#e6f6ff; }
  input[type=password] { width:100%; box-sizing:border-box; padding:.7rem; border-radius:8px;
         border:1px solid #2a373b; background:#050708; color:#e6f6ff; font-size:1rem; margin-bottom:1rem; }
  button { width:100%; padding:.7rem; border-radius:8px; border:none; background:#0f8fbf;
           color:#03181e; font-weight:600; cursor:pointer; }
  .err { color:#ff6b6b; font-size:.85rem; margin-bottom:1rem; }
  .scope { display:block; text-align:left; font-size:.9rem; margin:0 0 .6rem; cursor:pointer; }
  .scope input { margin-right:.5rem; }
</style></head>
<body>
  <form method="post">
    <h1>${label} – Zugriff bestätigen</h1>
    <p class="who">Client: <strong>${escapeHtml(info.clientName)}</strong><br>
      Ziel: <strong>${escapeHtml(info.redirectHost)}</strong></p>
    ${error ? `<div class="err">${escapeHtml(error)}</div>` : ""}
    <input type="password" name="passphrase" placeholder="Passphrase" autofocus required>
    <label class="scope"><input type="radio" name="scope" value="readwrite" checked> Lesen und Schreiben</label>
    <label class="scope"><input type="radio" name="scope" value="read"> Nur lesen</label>
    ${hidden}
    <button type="submit">Verbinden</button>
  </form>
</body></html>`;

  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}

function redirectError(redirectUri: string, error: string, state: string | null): Response {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  if (state) url.searchParams.set("state", state);
  return Response.redirect(url.toString(), 302);
}

async function validateRequest(
  params: URLSearchParams
): Promise<{ redirectUri: string; info: ConsentInfo } | Response> {
  const clientId = params.get("client_id");
  const redirectUri = params.get("redirect_uri");
  const codeChallengeMethod = params.get("code_challenge_method");

  if (!clientId || !redirectUri) {
    return new Response("client_id und redirect_uri sind erforderlich.", { status: 400 });
  }
  const client = await getClient(clientId);
  if (!client || !client.redirectUris.includes(redirectUri)) {
    return new Response("Unbekannter Client oder redirect_uri.", { status: 400 });
  }
  if (!redirectHostAllowed(redirectUri)) {
    return new Response("redirect_uri-Host ist nicht freigegeben.", { status: 400 });
  }
  if (codeChallengeMethod && codeChallengeMethod !== "S256") {
    return redirectError(redirectUri, "invalid_request", params.get("state"));
  }
  return {
    redirectUri,
    info: {
      clientName: client.clientName ?? "(ohne Namen)",
      redirectHost: new URL(redirectUri).host,
    },
  };
}

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const check = await validateRequest(params);
  if (check instanceof Response) return check;
  return renderForm(params, check.info);
}

export async function POST(req: Request) {
  const form = await req.formData();
  const params = new URLSearchParams();
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") params.set(key, value);
  }

  const check = await validateRequest(params);
  if (check instanceof Response) return check;
  const { redirectUri, info } = check;

  const passphrase = params.get("passphrase") ?? "";
  if (!verifyPassphrase(passphrase)) {
    return renderForm(params, info, "Falsche Passphrase, nochmal versuchen.");
  }

  const codeChallenge = params.get("code_challenge");
  if (!codeChallenge) {
    return redirectError(redirectUri, "invalid_request", params.get("state"));
  }

  // Fail-closed: Schreibrechte nur bei exakt "readwrite", alles andere ist Lesen.
  const scope: TokenScope = params.get("scope") === "readwrite" ? "readwrite" : "read";
  const code = await createAuthCode({
    clientId: params.get("client_id")!,
    redirectUri,
    codeChallenge,
    resource: params.get("resource") ?? undefined,
    scope,
  });

  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  const state = params.get("state");
  if (state) url.searchParams.set("state", state);
  return Response.redirect(url.toString(), 302);
}
