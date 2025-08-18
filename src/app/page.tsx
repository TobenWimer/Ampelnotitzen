"use client";

import { useEffect, useState } from "react";
import { db, auth, ensureAnonAuth } from "@/lib/firebase";
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
} from "firebase/firestore";

type Color = "green" | "yellow" | "red";

type Note = {
  id: string;
  text: string;
  color: Color;
  createdAt?: Date | null;
  isEditing?: boolean;
};

export default function Home() {
  const [text, setText] = useState("");
  const [color, setColor] = useState<Color>("green");
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);

  // 1) Anonym bei Firebase anmelden & Listener starten
  useEffect(() => {
    let unsub: (() => void) | undefined;

    (async () => {
      try {
        // stellt sicher, dass ein (anonymer) User vorhanden ist
        await ensureAnonAuth();

        const uid = auth.currentUser?.uid;
        if (!uid) return;

        // Nur Notizen des aktuellen Users laden
        const q = query(collection(db, "notes"), where("uid", "==", uid));

        unsub = onSnapshot(q, (snap) => {
          const items: Note[] = snap.docs.map((d) => {
            const data = d.data() as any;
            return {
              id: d.id,
              text: data.text ?? "",
              color: (data.color ?? "green") as Color,
              createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : null,
              isEditing: false,
            };
          });

          // Sortierung: Grün → Gelb → Rot (danach nach Datum)
          const order = { green: 1, yellow: 2, red: 3 } as const;
          items.sort((a, b) => {
            const byColor = order[a.color] - order[b.color];
            if (byColor !== 0) return byColor;
            // jüngste zuerst
            const at = a.createdAt?.getTime() ?? 0;
            const bt = b.createdAt?.getTime() ?? 0;
            return bt - at;
          });

          setNotes(items);
          setLoading(false);
        });
      } catch (e) {
        console.error(e);
        setLoading(false);
      }
    })();

    return () => {
      if (unsub) unsub();
    };
  }, []);

  // 2) Neue Notiz in Firestore speichern
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

  // 3) Notiz löschen
  const deleteNote = async (id: string) => {
    await deleteDoc(doc(db, "notes", id));
  };

  // 4) Bearbeiten ein/aus
  const toggleEdit = (id: string) => {
    setNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, isEditing: !n.isEditing } : n))
    );
  };

  // 5) Text speichern (Update in Firestore)
  const saveNote = async (id: string, newText: string) => {
    await updateDoc(doc(db, "notes", id), { text: newText.trim() });
    setNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, isEditing: false } : n))
    );
  };

  // 6) Farbe ändern (Update in Firestore)
  const changeColor = async (id: string, newColor: Color) => {
    await updateDoc(doc(db, "notes", id), { color: newColor });
  };

  return (
    <div className="p-8 max-w-md mx-auto font-sans">
      <h1 className="text-3xl font-extrabold mb-6 text-gray-800">
        Meine Notizen
      </h1>

      {/* Eingabe-Feld */}
      <input
        type="text"
        placeholder="Neue Notiz eingeben"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="w-full p-3 border border-gray-300 rounded mb-2 text-lg"
      />

      {/* Ampel-Buttons (Erstellen) */}
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

      {/* Notiz hinzufügen */}
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

/** Kleines Inline-Formular für die Bearbeitung */
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
      <button
        onClick={onCancel}
        className="px-3 py-1 bg-gray-200 rounded"
      >
        Abbrechen
      </button>
    </div>
  );
}
