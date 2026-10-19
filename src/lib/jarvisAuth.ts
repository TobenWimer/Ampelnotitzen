// Single-Tenant-Schutz fuer alle Jarvis-Routen. Nur der Account, dessen uid in
// JARVIS_OWNER_UID steht, kommt durch. Die allgemeine Freigabeliste (allowlist) zaehlt hier
// bewusst NICHT, die gilt fuer alle OSB-Mitglieder. Gueltiges Login allein reicht auch nicht:
// die App erlaubt anonyme Anmeldung, jeder Besucher kann sich ein gueltiges Token holen.
// Fail-closed: ist die Variable nicht gesetzt, ist Jarvis fuer niemanden erreichbar.
//
// Das Firebase-ID-Token wird direkt mit jose geprueft (Signatur gegen Googles oeffentliche
// Schluessel, Issuer, Audience, Ablauf). firebase-admin/auth ist bewusst nicht im Spiel: dessen
// Abhaengigkeit jwks-rsa laesst sich in Vercel nicht laden (ESM/CommonJS-Konflikt mit jose).
// Nicht geprueft wird die Sperrliste widerrufener Tokens, die Gueltigkeit ist auf 1 Stunde begrenzt.

import { createRemoteJWKSet, jwtVerify } from "jose";

export type OwnerResult = { ok: true; uid: string } | { ok: false; response: Response };

const FIREBASE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com")
);

function deny(status: number, error: string): OwnerResult {
  return {
    ok: false,
    response: Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } }),
  };
}

export async function requireOwner(req: Request): Promise<OwnerResult> {
  const ownerUid = process.env.JARVIS_OWNER_UID;
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  if (!ownerUid || !projectId) {
    console.error("[jarvis] JARVIS_OWNER_UID oder FIREBASE_ADMIN_PROJECT_ID fehlt, Zugriff gesperrt");
    return deny(503, "jarvis_not_configured");
  }

  const match = (req.headers.get("authorization") ?? "").match(/^Bearer (.+)$/);
  if (!match) return deny(401, "unauthorized");

  let uid: string;
  try {
    const { payload } = await jwtVerify(match[1], FIREBASE_JWKS, {
      algorithms: ["RS256"],
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
    });
    if (typeof payload.sub !== "string" || !payload.sub) return deny(401, "unauthorized");
    uid = payload.sub;
  } catch {
    return deny(401, "unauthorized");
  }

  if (uid !== ownerUid) {
    console.warn(`[jarvis] Zugriff verweigert, uid ${uid.slice(0, 6)}...`);
    return deny(403, "forbidden");
  }

  return { ok: true, uid };
}
