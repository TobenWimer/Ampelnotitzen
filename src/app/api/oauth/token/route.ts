// Tauscht den Authorization Code (mit PKCE-Verifier) gegen einen Access-Token.
// Kein Refresh-Token: der Token ist 180 Tage gueltig, danach oder bei Widerruf
// (Firestore-Dokument in mcpOAuthTokens loeschen) muss neu ueber /authorize
// verbunden werden - bewusst einfach gehalten fuer einen Einzelnutzer-Connector.

import { consumeAuthCode, issueToken, verifyPkce } from "@/lib/oauthStore";

export const runtime = "nodejs";

function errorResponse(error: string, status = 400) {
  return Response.json({ error }, { status });
}

export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";
  let params: URLSearchParams;
  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => ({}));
    params = new URLSearchParams(body as Record<string, string>);
  } else {
    params = new URLSearchParams(await req.text());
  }

  if (params.get("grant_type") !== "authorization_code") {
    return errorResponse("unsupported_grant_type");
  }

  const code = params.get("code");
  const codeVerifier = params.get("code_verifier");
  if (!code || !codeVerifier) {
    return errorResponse("invalid_request");
  }

  const stored = await consumeAuthCode(code);
  if (!stored) {
    return errorResponse("invalid_grant");
  }

  const redirectUri = params.get("redirect_uri");
  if (redirectUri && redirectUri !== stored.redirectUri) {
    return errorResponse("invalid_grant");
  }

  if (!verifyPkce(codeVerifier, stored.codeChallenge)) {
    return errorResponse("invalid_grant");
  }

  const { token, expiresInSeconds } = await issueToken(stored.clientId);

  return Response.json({
    access_token: token,
    token_type: "Bearer",
    expires_in: expiresInSeconds,
  });
}
