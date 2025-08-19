"use client";

import { useEffect, useRef, useState } from "react";
import {
  db,
  auth,
  ensureAnonAuth,
  signInWithGoogleLinked,
  signOut,
} from "@/lib/firebase";
import {
  collection,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  serverTimestamp,
  Timestamp,
  QuerySnapshot,
  DocumentData,
} from "firebase/firestore";

type Color = "green" | "yellow" | "red";

type Note = {
  id: string;
  text: string;
  color: Color;
  createdAt?: Date | null;
  isEditing?: boolean;
};

type NoteDoc = {
  uid: string;
  text?: string;
  color?: Color;
  createdAt?: Timestamp;
};

export default function Home() {
  const [text, setText] = useState("");
  const [color, setColor] = useState<Color>("green");
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);

  // Auth-Anzeige
  const [isAnonymous, setIsAnonymous] = useState(true);
  const [isGoogle, setIsGoogle] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const snapshotUnsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // Mind. anonym einloggen
    ensureAnonAuth().catch((e) => console.error(e));

    // Auf Auth-Änderungen reagieren
    const offAuth = auth.onAuthStateChanged((u) => {
      const anon = !!u?.isAnonymous;
      const google = !!u?.providerData?.some((p) => p.providerId === "google.com");
      setIsAnonymous(anon);
      setIsGoogle(google);
      setUserEmail(u?.email ?? null);

      // alten Snapshot schließen
      if (snapshotUnsubRef.current) {
        snapshotUnsubRef.current();
        snapshotUnsubRef.current = null;
      }

      if (!u) {
        setNotes([]);
        setLoading(false);
        return;
      }

      // neuen Snapshot für aktuelle UID
      setLoading(true);
      const q = query(collection(db, "notes"), where("uid", "==", u.uid));
      const unsub = onSnapshot(
        q,
        (snap: QuerySnapshot<DocumentData>) => {
          const items: Note[] = snap.docs.map((d) => {
            const data = d.data() as NoteDoc;
            return {
              id: d.id,
              text: data.text ?? "",
              color: (data.color ?? "green") as Color,
              createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : null,
              isEditing: false,
            };
          });

          const order = { green: 1, yellow: 2, red: 3 } as const;
          items.sort((a, b) => {
            const byColor = order[a.color] - order[b.color];
            if (byColor !== 0) return byColor;
            const at = a.createdAt?.getTime() ?? 0;
            const bt = b.createdAt?.getTime() ?? 0;
            return bt - at;
          });

          setNotes(items);
          setLoading(false);
        },
        (error) => {
          console.warn("Snapshot error:", error);
          setNotes([]);
          setLoading(false);
        }
      );
      snapshotUnsubRef.current = unsub;
    });

    return () => {
      offAuth();
      if (snapshotUnsubRef.current) {
        snapshotUnsubRef.current();
        snapshotUnsubRef.current = null;
      }
    };
  }, []);

  const addNote = async () => {
    if (!text.trim()) return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    await addDoc(collection(db, "notes"), {
      uid,
      text: text.trim(),
      color,
      createdAt: serverTimestamp(),
    });

    setText("");
  };

  const deleteNote = async (id: string) => {
    await deleteDoc(doc(db, "notes", id));
  };

  const toggleEdit = (id: string) => {
    setNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, isEditing: !n.isEditing } : n))
    );
  };

  const saveNote = async (id: string, newText: string) => {
    await updateDoc(doc(db, "notes", id), { text: newText.trim() });
    setNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, isEditing: false } : n))
    );
  };

  const changeColor = async (id: string, newColor: Color) => {
    await updateDoc(doc(db, "notes", id), { color: newColor });
  };

  return (
    <div className="p-8 max-w-md mx-auto font-sans">
      {/* Header + Auth */}
      <div className="mb-6">
        <h1 className="text-3xl font-extrabold text-gray-900">AmpelNotizen</h1>

        {/* Status-Badge: Google-G, Anonym oder (Fallback) E-Mail */}
        <div className="mt-2 flex items-center gap-2">
          {isGoogle ? (
            <GoogleGIcon />
          ) : isAnonymous ? (
            <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700">
              Anonymer Benutzer
            </span>
          ) : (
            <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700">
              {userEmail}
            </span>
          )}
        </div>

        <div className="mt-3 flex gap-2">
          <button
            onClick={signInWithGoogleLinked}
            className="border border-gray-300 rounded px-3 py-2 text-sm hover:bg-gray-50"
            title="Anonymen Account mit Google verknüpfen (oder anmelden)"
          >
            Mit Google anmelden
          </button>
          <button
            onClick={signOut}
            className="border border-gray-300 rounded px-3 py-2 text-sm hover:bg-gray-50"
          >
            Abmelden
          </button>
        </div>
      </div>

      {/* Eingabe */}
      <input
        type="text"
        placeholder="Neue Notiz eingeben"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="w-full p-3 border border-gray-300 rounded mb-2 text-lg"
      />

      {/* Ampeln (Erstellen) */}
      <div className="flex gap-3 mb-2">
        <button
          onClick={() => setColor("green")}
          aria-label="Grün wählen"
          className={`w-8 h-8 rounded-full border-2 ${
            color === "green" ? "bg-green-600 border-green-800" : "bg-green-300"
          }`}
        />
        <button
          onClick={() => setColor("yellow")}
          aria-label="Gelb wählen"
          className={`w-8 h-8 rounded-full border-2 ${
            color === "yellow"
              ? "bg-yellow-500 border-yellow-700"
              : "bg-yellow-200"
          }`}
        />
        <button
          onClick={() => setColor("red")}
          aria-label="Rot wählen"
          className={`w-8 h-8 rounded-full border-2 ${
            color === "red" ? "bg-red-600 border-red-800" : "bg-red-300"
          }`}
        />
      </div>

      <button
        onClick={addNote}
        className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded mb-6 font-bold"
      >
        Notiz hinzufügen
      </button>

      {/* Liste */}
      {loading ? (
        <div className="text-gray-500">Lade Notizen…</div>
      ) : notes.length === 0 ? (
        <div className="text-gray-500">Noch keine Notizen gespeichert.</div>
      ) : (
        <div className="space-y-3">
          {notes.map((note) => (
            <div
              key={note.id}
              className={`relative p-4 rounded-xl shadow-lg text-black font-medium text-lg ${
                note.color === "green"
                  ? "bg-green-200"
                  : note.color === "yellow"
                  ? "bg-yellow-200"
                  : "bg-red-200"
              }`}
            >
              {/* Löschen */}
              <button
                onClick={() => deleteNote(note.id)}
                className="absolute top-2 right-2 text-gray-600 hover:text-black"
                aria-label="Notiz löschen"
              >
                ✖
              </button>

              {/* Inhalt / Bearbeiten */}
              {note.isEditing ? (
                <EditRow
                  defaultValue={note.text}
                  onSave={(val) => saveNote(note.id, val)}
                  onCancel={() => toggleEdit(note.id)}
                />
              ) : (
                <div
                  onClick={() => toggleEdit(note.id)}
                  className="cursor-pointer"
                  title="Zum Bearbeiten klicken"
                >
                  {note.text}
                </div>
              )}

              {/* Ampeln – nachträgliche Farbänderung */}
              <div className="flex gap-3 mt-3">
                <button
                  onClick={() => changeColor(note.id, "green")}
                  aria-label="Farbe Grün setzen"
                  className={`w-6 h-6 rounded-full border-2 ${
                    note.color === "green"
                      ? "bg-green-600 border-green-800"
                      : "bg-green-300"
                  }`}
                />
                <button
                  onClick={() => changeColor(note.id, "yellow")}
                  aria-label="Farbe Gelb setzen"
                  className={`w-6 h-6 rounded-full border-2 ${
                    note.color === "yellow"
                      ? "bg-yellow-500 border-yellow-700"
                      : "bg-yellow-200"
                  }`}
                />
                <button
                  onClick={() => changeColor(note.id, "red")}
                  aria-label="Farbe Rot setzen"
                  className={`w-6 h-6 rounded-full border-2 ${
                    note.color === "red"
                      ? "bg-red-600 border-red-800"
                      : "bg-red-300"
                  }`}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Kleines Google-"G"-Icon (inline SVG, 16x16) */
function GoogleGIcon() {
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-gray-100">
      <svg
        width="16"
        height="16"
        viewBox="0 0 533.5 544.3"
        aria-label="Google"
        role="img"
      >
        <path fill="#EA4335" d="M533.5 278.4c0-17.4-1.6-34.1-4.7-50.3H272v95.2h146.9c-6.3 34-25.4 62.7-54.2 81.8v67h87.7c51.3-47.2 81.1-116.6 81.1-193.7z"/>
        <path fill="#34A853" d="M272 544.3c73.3 0 134.8-24.2 179.8-66.1l-87.7-67c-24.3 16.3-55.3 25.9-92.1 25.9-70.9 0-131-47.7-152.5-112.1H29.4v70.6C74.2 490.6 167.1 544.3 272 544.3z"/>
        <path fill="#4A90E2" d="M119.5 324.9c-10.6-31.6-10.6-66.2 0-97.8V156.5H29.4c-39.2 78.4-39.2 171.1 0 249.5l90.1-81.1z"/>
        <path fill="#FBBC05" d="M272 107.7c39.8-.6 77.8 14 106.8 41.2l79.8-79.8C430.5 26.1 371.4 0 272 0 167.1 0 74.2 53.7 29.4 156.5l90.1 70.6C141 155.4 201.1 107.7 272 107.7z"/>
      </svg>
      <span className="text-gray-700">Google</span>
    </span>
  );
}

function EditRow({
  defaultValue,
  onSave,
  onCancel,
}: {
  defaultValue: string;
  onSave: (val: string) => void;
  onCancel: () => void;
}) {
  const [val, setVal] = useState(defaultValue);

  return (
    <div className="flex gap-2 items-center">
      <input
        type="text"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSave(val);
          if (e.key === "Escape") onCancel();
        }}
        className="w-full p-2 rounded border border-gray-400 text-black text-lg"
        autoFocus
      />
      <button
        onClick={() => onSave(val)}
        className="px-3 py-1 bg-blue-500 text-white rounded"
      >
        Speichern
      </button>
      <button onClick={onCancel} className="px-3 py-1 bg-gray-200 rounded">
        Abbrechen
      </button>
    </div>
  );
}
