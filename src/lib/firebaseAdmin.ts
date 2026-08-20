// Server-only Firebase Admin SDK. Laeuft NIE im Browser, nur in API-Routes.
// Nutzt Umgebungsvariablen statt einer eingecheckten Schluesseldatei - siehe
// scripts/migrate-cbrain.mjs fuer die einmalige lokale Migration mit derselben
// Service-Account-Datei.

import { getApps, initializeApp, cert, type App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function loadAdminApp(): App {
  const existing = getApps();
  if (existing.length) return existing[0];

  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Firebase Admin: FIREBASE_ADMIN_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY fehlen in den Umgebungsvariablen."
    );
  }

  return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

export const adminDb = getFirestore(loadAdminApp());
