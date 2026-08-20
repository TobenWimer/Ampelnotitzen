// Firestore-Zugriff auf die cbrainEntries-Sammlung, nur server-seitig nutzbar
// (verwendet firebaseAdmin, nicht das Client-SDK). Siehe scripts/migrate-cbrain.mjs
// fuer die Herkunft der Daten und Decisions/2026-08-19-Cbrain-Struktur-fuer-Firestore.md
// im Vault fuer die Schema-Begruendung.

import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "./firebaseAdmin";

const COLLECTION = "cbrainEntries";

export type CbrainEntrySummary = {
  docId: string;
  folder: string;
  slug: string;
  type: string;
  summary: string;
  status?: string;
  updatedAt: string;
};

export type CbrainEntry = CbrainEntrySummary & {
  content: string;
};

function toSummary(docId: string, data: FirebaseFirestore.DocumentData): CbrainEntrySummary {
  return {
    docId,
    folder: data.folder,
    slug: data.slug,
    type: data.type,
    summary: data.summary ?? "",
    status: data.status,
    updatedAt: data.updatedAt?.toDate?.().toISOString() ?? "",
  };
}

export async function listEntries(filter: {
  folder?: string;
  type?: string;
  status?: string;
}): Promise<CbrainEntrySummary[]> {
  let query: FirebaseFirestore.Query = adminDb.collection(COLLECTION);
  if (filter.folder) query = query.where("folder", "==", filter.folder);
  if (filter.type) query = query.where("type", "==", filter.type);
  if (filter.status) query = query.where("status", "==", filter.status);

  const snap = await query.get();
  return snap.docs.map((doc) => toSummary(doc.id, doc.data()));
}

export async function readEntry(docId: string): Promise<CbrainEntry | null> {
  const doc = await adminDb.collection(COLLECTION).doc(docId).get();
  if (!doc.exists) return null;
  const data = doc.data()!;
  return { ...toSummary(doc.id, data), content: data.content ?? "" };
}

export async function searchEntries(query: string): Promise<CbrainEntrySummary[]> {
  const needle = query.toLowerCase();
  const snap = await adminDb.collection(COLLECTION).get();
  return snap.docs
    .filter((doc) => {
      const data = doc.data();
      return (
        (data.summary ?? "").toLowerCase().includes(needle) ||
        (data.content ?? "").toLowerCase().includes(needle)
      );
    })
    .map((doc) => toSummary(doc.id, doc.data()));
}

export async function writeEntry(input: {
  docId: string;
  folder?: string;
  slug?: string;
  type?: string;
  summary?: string;
  status?: string;
  content?: string;
}): Promise<void> {
  const { docId, ...rawFields } = input;
  const fields = Object.fromEntries(
    Object.entries(rawFields).filter(([, value]) => value !== undefined)
  );
  await adminDb
    .collection(COLLECTION)
    .doc(docId)
    .set({ ...fields, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}
