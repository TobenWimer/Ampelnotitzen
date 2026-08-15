import { collection, doc, getDocs, query, updateDoc, where, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Folder } from "./types";

// Verschiebt ein einzelnes Dokument (canvas oder Datei) in einen anderen Ordner.
// parentPathSlug ist bereits im hasOnly-Regelwerk erlaubt -> keine Rules-Aenderung noetig
export async function moveDocument({ docId, newParentPathSlug }: { docId: string; newParentPathSlug: string }) {
  await updateDoc(doc(db, "documents", docId), { parentPathSlug: newParentPathSlug });
}

// Verschiebt einen Ordner (inkl. gesamtem Unterbaum) an einen neuen Ort. Da Pfade als
// flacher parentPathSlug-String gespeichert sind (kein Parent-ID-Feld), muss beim
// Verschieben der alte Pfad-Praefix bei ALLEN Nachfahren (Ordner + Dokumente) durch den
// neuen ersetzt werden - aehnliche Rekursion wie beim Loeschen eines Ordnerbaums
export async function moveFolder({
  uid,
  folder,
  oldParentPathSlug,
  newParentPathSlug,
}: {
  uid: string;
  folder: Folder;
  oldParentPathSlug: string;
  newParentPathSlug: string;
}) {
  const oldFullPath = oldParentPathSlug ? `${oldParentPathSlug}/${folder.slug}` : folder.slug;
  const newFullPath = newParentPathSlug ? `${newParentPathSlug}/${folder.slug}` : folder.slug;

  if (newParentPathSlug === oldParentPathSlug) return; // no-op, gleicher Ort
  if (newFullPath === oldFullPath || newFullPath.startsWith(`${oldFullPath}/`)) {
    throw new Error("CANNOT_MOVE_INTO_OWN_SUBTREE");
  }

  const updates: { ref: ReturnType<typeof doc>; newParentPathSlug: string }[] = [
    { ref: doc(db, "folders", folder.id), newParentPathSlug },
  ];

  const queue: string[] = [oldFullPath];
  while (queue.length) {
    const oldPath = queue.shift()!;
    const relativeSuffix = oldPath.slice(oldFullPath.length); // "" oder "/unterordner/..."
    const newPath = `${newFullPath}${relativeSuffix}`;

    const snapF = await getDocs(
      query(collection(db, "folders"), where("parentPathSlug", "==", oldPath), where("uid", "==", uid))
    );
    for (const f of snapF.docs) {
      updates.push({ ref: doc(db, "folders", f.id), newParentPathSlug: newPath });
      const childSlug = f.data().slug as string;
      queue.push(oldPath ? `${oldPath}/${childSlug}` : childSlug);
    }

    const snapD = await getDocs(
      query(collection(db, "documents"), where("parentPathSlug", "==", oldPath), where("uid", "==", uid))
    );
    for (const d of snapD.docs) {
      updates.push({ ref: doc(db, "documents", d.id), newParentPathSlug: newPath });
    }
  }

  const CHUNK = 450;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const batch = writeBatch(db);
    updates.slice(i, i + CHUNK).forEach((u) => batch.update(u.ref, { parentPathSlug: u.newParentPathSlug }));
    await batch.commit();
  }
}
