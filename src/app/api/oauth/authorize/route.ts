// Zeigt ein simples Passphrase-Formular (GET) und stellt bei richtiger Eingabe
// einen Authorization Code aus (POST). redirect_uri wird bei JEDEM Schritt neu
// gegen die beim Client registrierten URIs geprueft, nie blind aus dem
// versteckten Formularfeld uebernommen - das waere ein offener Redirect.

import { getClient, createAuthCode, verifyPassphrase } from "@/lib/oauthStore";

export const runtime = "nodejs";

function renderForm(params: URLSearchParams, error?: string): Response {
  const hidden = ["client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method"]
    .map((key) => {
      const value = params.get(key) ?? "";
      return `<input type="hidden" name="${key}" value="${value.replace(/"/g, "&quot;")}">`;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<title>cbrain – Zugriff bestätigen</title>
<style>
  body { background:#050708; color:#e6f6ff; font-family:system-ui,sans-serif;
         display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; }
  form { background:#0d1214; border:1px solid #1f2a2d; border-radius:12px; padding:2rem;
         width:min(90vw,360px); text-align:center; }
  h1 { font-size:1rem; letter-spacing:.08em; text-transform:uppercase; color:#7dd8ff; margin:0 0 1.2rem; }
  input[type=password] { width:100%; box-sizing:border-box; padding:.7rem; border-radius:8px;
         border:1px solid #2a373b; background:#050708; color:#e6f6ff; font-size:1rem; margin-bottom:1rem; }
  button { width:100%; padding:.7rem; border-radius:8px; border:none; background:#0f8fbf;
           color:#03181e; font-weight:600; cursor:pointer; }
  .err { color:#ff6b6b; font-size:.85rem; margin-bottom:1rem; }
</style></head>
<body>
  <form method="post">
    <h1>cbrain – Zugriff bestätigen</h1>
    ${error ? `<div class="err">${error}</div>` : ""}
    <input type="password" name="passphrase" placeholder="Passphrase" autofocus required>
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

async function validateRequest(params: URLSearchParams): Promise<{ redirectUri: string } | Response> {
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
  if (codeChallengeMethod && codeChallengeMethod !== "S256") {
    return redirectError(redirectUri, "invalid_request", params.get("state"));
  }
  return { redirectUri };
}

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const check = await validateRequest(params);
  if (check instanceof Response) return check;
  return renderForm(params);
}

export async function POST(req: Request) {
  const form = await req.formData();
  const params = new URLSearchParams();
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") params.set(key, value);
  }

  const check = await validateRequest(params);
  if (check instanceof Response) return check;
  const { redirectUri } = check;

  const passphrase = params.get("passphrase") ?? "";
  if (!verifyPassphrase(passphrase)) {
    return renderForm(params, "Falsche Passphrase, nochmal versuchen.");
  }

  const codeChallenge = params.get("code_challenge");
  if (!codeChallenge) {
    return redirectError(redirectUri, "invalid_request", params.get("state"));
  }

  const code = await createAuthCode({ clientId: params.get("client_id")!, redirectUri, codeChallenge });

  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  const state = params.get("state");
  if (state) url.searchParams.set("state", state);
  return Response.redirect(url.toString(), 302);
}
