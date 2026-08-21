// Minimaler OAuth-2.1-Server (Authorization Code + PKCE, kein Client-Secret,
// kein Refresh-Token), gemeinsam genutzt von allen MCP-Connectoren dieses
// Projekts (cbrain, Apple Kalender/Erinnerungen, ...). Einziger vorgesehener
// Nutzer ist Timon selbst, das /authorize-Formular ist deshalb per Passphrase
// (env CBRAIN_OAUTH_PASSPHRASE) geschuetzt statt eines echten Nutzerkontensystems,
// der Name ist historisch, gilt aber fuer alle Resourcen.
//
// Tokens sind per RFC 8707 "resource" auf genau eine Resource-URL (z.B.
// https://.../api/mcp oder https://.../api/apple) beschraenkt, damit ein
// Connector nicht versehentlich Zugriff auf einen anderen bekommt. Tokens ohne
// gespeicherte resource (vor dieser Aenderung ausgestellt) gelten weiterhin als
// gueltig fuer jede Resource, aus Kompatibilitaetsgruenden.
//
// Drei Firestore-Sammlungen, alle nur ueber das Admin SDK erreichbar (siehe
// firestore.rules): mcpOAuthClients, mcpOAuthCodes, mcpOAuthTokens.

import crypto from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "./firebaseAdmin";

const CODE_TTL_MS = 5 * 60 * 1000;
const TOKEN_TTL_MS = 180 * 24 * 60 * 60 * 1000; // 180 Tage

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export type RegisteredClient = {
  clientId: string;
  redirectUris: string[];
  clientName?: string;
};

export async function registerClient(redirectUris: string[], clientName?: string): Promise<RegisteredClient> {
  const clientId = crypto.randomBytes(16).toString("hex");
  await adminDb
    .collection("mcpOAuthClients")
    .doc(clientId)
    .set({ redirectUris, clientName: clientName ?? null, createdAt: FieldValue.serverTimestamp() });
  return { clientId, redirectUris, clientName };
}

export async function getClient(clientId: string): Promise<RegisteredClient | null> {
  const doc = await adminDb.collection("mcpOAuthClients").doc(clientId).get();
  if (!doc.exists) return null;
  const data = doc.data()!;
  return { clientId, redirectUris: data.redirectUris, clientName: data.clientName ?? undefined };
}

export async function createAuthCode(input: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource?: string;
}): Promise<string> {
  const code = crypto.randomBytes(32).toString("base64url");
  await adminDb
    .collection("mcpOAuthCodes")
    .doc(code)
    .set({
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      resource: input.resource ?? null,
      used: false,
      expiresAt: Timestamp.fromMillis(Date.now() + CODE_TTL_MS),
    });
  return code;
}

export async function consumeAuthCode(
  code: string
): Promise<{ clientId: string; redirectUri: string; codeChallenge: string; resource?: string } | null> {
  const ref = adminDb.collection("mcpOAuthCodes").doc(code);
  const doc = await ref.get();
  if (!doc.exists) return null;
  const data = doc.data()!;
  if (data.used || (data.expiresAt as Timestamp).toMillis() < Date.now()) return null;
  await ref.update({ used: true });
  return {
    clientId: data.clientId,
    redirectUri: data.redirectUri,
    codeChallenge: data.codeChallenge,
    resource: data.resource ?? undefined,
  };
}

export async function issueToken(
  clientId: string,
  resource?: string
): Promise<{ token: string; expiresInSeconds: number }> {
  const token = "osb-oauth-" + crypto.randomBytes(32).toString("base64url");
  await adminDb
    .collection("mcpOAuthTokens")
    .doc(sha256Hex(token))
    .set({
      clientId,
      resource: resource ?? null,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + TOKEN_TTL_MS),
    });
  return { token, expiresInSeconds: Math.floor(TOKEN_TTL_MS / 1000) };
}

export async function verifyToken(token: string, expectedResource?: string): Promise<boolean> {
  const doc = await adminDb.collection("mcpOAuthTokens").doc(sha256Hex(token)).get();
  if (!doc.exists) return false;
  const data = doc.data()!;
  if ((data.expiresAt as Timestamp).toMillis() < Date.now()) return false;
  const storedResource: string | undefined = data.resource ?? undefined;
  if (storedResource && expectedResource && storedResource !== expectedResource) return false;
  return true;
}

export function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  const computed = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  const a = Buffer.from(computed);
  const b = Buffer.from(codeChallenge);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function verifyPassphrase(input: string): boolean {
  const expected = process.env.CBRAIN_OAUTH_PASSPHRASE ?? "";
  if (!expected) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
