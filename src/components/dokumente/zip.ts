import JSZip from "jszip";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";

type ZipEntry = { downloadURL: string; zipPath: string };

// Durchsucht rekursiv alle Unterordner/Dokumente unterhalb eines Ordners und
// sammelt alle hochgeladenen Dateien (docKind:"file") mit ihrem Pfad im Zip
// (auf Basis der Anzeigenamen, nicht der Slugs -> lesbare Ordnerstruktur im Zip)
async function collectFilesInFolder(uid: string, fullSlugPath: string, displayPath: string): Promise<ZipEntry[]> {
  const entries: ZipEntry[] = [];
  const queue: { slugPath: string; displayPath: string }[] = [{ slugPath: fullSlugPath, displayPath }];

  while (queue.length) {
    const { slugPath, displayPath: dPath } = queue.shift()!;

    const snapF = await getDocs(
      query(collection(db, "folders"), where("parentPathSlug", "==", slugPath), where("uid", "==", uid))
    );
    for (const f of snapF.docs) {
      const data = f.data();
      const slug = data.slug as string;
      const name = (data.name as string) ?? slug;
      queue.push({ slugPath: `${slugPath}/${slug}`, displayPath: `${dPath}/${name}` });
    }

    const snapD = await getDocs(
      query(collection(db, "documents"), where("parentPathSlug", "==", slugPath), where("uid", "==", uid))
    );
    for (const d of snapD.docs) {
      const data = d.data();
      if (data.docKind === "file" && data.downloadURL) {
        const name = (data.name as string) ?? d.id;
        entries.push({ downloadURL: data.downloadURL as string, zipPath: `${dPath}/${name}` });
      }
    }
  }

  return entries;
}

// Laedt einen Ordner inkl. aller Unterordner/Dateien als eine ZIP-Datei herunter
export async function downloadFolderAsZip({
  uid,
  rootName,
  fullPathSlug,
  onProgress,
}: {
  uid: string;
  rootName: string;
  fullPathSlug: string;
  onProgress?: (pct: number) => void;
}) {
  const entries = await collectFilesInFolder(uid, fullPathSlug, rootName);
  if (entries.length === 0) {
    throw new Error("EMPTY_FOLDER");
  }

  const zip = new JSZip();
  let done = 0;
  for (const entry of entries) {
    const res = await fetch(entry.downloadURL);
    const blob = await res.blob();
    zip.file(entry.zipPath, blob);
    done += 1;
    onProgress?.(Math.round((done / entries.length) * 100));
  }

  const zipBlob = await zip.generateAsync({ type: "blob" });
  const objectUrl = URL.createObjectURL(zipBlob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = `${rootName}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}
