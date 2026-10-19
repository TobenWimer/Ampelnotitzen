// Single-Tenant-Schutz fuer alle Jarvis-Routen. Nur der Account, dessen uid in
// JARVIS_OWNER_UID steht, kommt durch. Die allgemeine Freigabeliste (allowlist) zaehlt hier
// bewusst NICHT, die gilt fuer alle OSB-Mitglieder. Gueltiges Login allein reicht auch nicht:
// die App erlaubt anonyme Anmeldung, jeder Besucher kann sich ein gueltiges Token holen.
// Fail-closed: ist die Variable nicht gesetzt, ist Jarvis fuer niemanden erreichbar.

import { getAuth } from "firebase-admin/auth";
import { adminApp } from "./firebaseAdmin";

export type OwnerResult = { ok: true; uid: string } | { ok: false; response: Response };

function deny(status: number, error: string): OwnerResult {
  return {
    ok: false,
    response: Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } }),
  };
}

export async function requireOwner(req: Request): Promise<OwnerResult> {
  const ownerUid = process.env.JARVIS_OWNER_UID;
  if (!ownerUid) {
    console.error("[jarvis] JARVIS_OWNER_UID fehlt, Zugriff gesperrt");
    return deny(503, "jarvis_not_configured");
  }

  const match = (req.headers.get("authorization") ?? "").match(/^Bearer (.+)$/);
  if (!match) return deny(401, "unauthorized");

  let uid: string;
  try {
    const decoded = await getAuth(adminApp).verifyIdToken(match[1], true);
    uid = decoded.uid;
  } catch {
    return deny(401, "unauthorized");
  }

  if (uid !== ownerUid) {
    console.warn(`[jarvis] Zugriff verweigert, uid ${uid.slice(0, 6)}...`);
    return deny(403, "forbidden");
  }

  return { ok: true, uid };
}
