// RFC 7591 Dynamic Client Registration. Jeder darf sich hier einen client_id
// holen (das ist bei OAuth so vorgesehen) - der eigentliche Schutz kommt erst
// danach beim /authorize-Schritt (Passphrase). Ein registrierter Client ohne
// gueltige Passphrase kommt nie an einen echten Code.

import { registerClient } from "@/lib/oauthStore";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const redirectUris = body?.redirect_uris;

  if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
    return Response.json({ error: "invalid_client_metadata" }, { status: 400 });
  }

  const client = await registerClient(redirectUris, body?.client_name);

  return Response.json(
    {
      client_id: client.clientId,
      redirect_uris: client.redirectUris,
      client_name: client.clientName,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
    },
    { status: 201 }
  );
}
