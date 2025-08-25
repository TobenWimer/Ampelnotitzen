"use client";

/**
 * OneStepBehind – Notiz-App
 * - Firebase Auth (anonym + Google-Link/Login)
 * - Firestore Realtime-Sync (notes pro Nutzer via UID)
 * - Kategorien (T/W/I/B), Filter-Chips (Alle/T/W/I/B)
 * - Inline-Menüs: Kategorie-Badge & aktueller Ampelkreis klappen Optionen auf
 * - Editieren per Klick mit auto-resizing Textarea
 * - Design:
 *    • Seitenhintergrund weiß
 *    • Notizkarten: glassy + Farbverlauf (grün/gelb/rot) + dunkler Rand
 *    • Texteingabe: glassy grau (blur, dezenter Verlauf)
 *    • Google-Buttons: glassy grau (weiß/grau, dünner schwarzer Rand, schwarze Schrift)
 *    • „Neue Notiz“: glassy, dunkles Blau mit Verlauf
 */

import Image from "next/image";
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

/* =========================
   Typen & Konstanten
   ========================= */

type Color = "green" | "yellow" | "red";
type Cat = "T" | "W" | "I" | "B";

type Note = {
  id: string;
  text: string;
  color: Color;
  category?: Cat | "";
  createdAt?: Date | null;
  isEditing?: boolean;
};

type NoteDoc = {
  uid: string;
  text?: string;
  color?: Color;
  category?: Cat | "";
  createdAt?: Timestamp;
};

const CATS: Cat[] = ["T", "W", "I", "B"];

/* =========================
   Komponente
   ========================= */

export default function Home() {
  // Eingabe neue Notiz
  const [text, setText] = useState("");
  const [color, setColor] = useState<Color>("green");
  const [category, setCategory] = useState<Cat | "">("");

  // Daten/UI
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);

  // Auth-Indikatoren
  const [isAnonymous, setIsAnonymous] = useState(true);
  const [isGoogle, setIsGoogle] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // Filter
  const [filter, setFilter] = useState<"ALL" | Cat>("ALL");

  // Inline-Menüs (pro Karte)
  const [openCatFor, setOpenCatFor] = useState<string | null>(null);
  const [openColorFor, setOpenColorFor] = useState<string | null>(null);

  // Firestore unsub
  const snapshotUnsubRef = useRef<(() => void) | null>(null);

  /* =========================
     Effekt: Auth + Notes-Sync
     ========================= */
  useEffect(() => {
    ensureAnonAuth().catch((e) => console.error(e));

    const offAuth = auth.onAuthStateChanged((u) => {
      const anon = !!u?.isAnonymous;
      const google = !!u?.providerData?.some((p) => p.providerId === "google.com");
      setIsAnonymous(anon);
      setIsGoogle(google);
      setUserEmail(u?.email ?? null);

      if (snapshotUnsubRef.current) {
        snapshotUnsubRef.current();
        snapshotUnsubRef.current = null;
      }

      if (!u) {
        setNotes([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      const qRef = query(collection(db, "notes"), where("uid", "==", u.uid));
      const unsub = onSnapshot(
        qRef,
        (snap: QuerySnapshot<DocumentData>) => {
          const items: Note[] = snap.docs.map((d) => {
            const data = d.data() as NoteDoc;
            return {
              id: d.id,
              text: data.text ?? "",
              color: (data.color ?? "green") as Color,
              category: (data.category as Cat | "") ?? "",
              createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : null,
              isEditing: false,
            };
          });

          // Sortierung: Grün → Gelb → Rot; innerhalb: neueste zuerst
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

  /* =========================
     Aktionen: CRUD + Updates
     ========================= */

  const addNote = async () => {
    if (!text.trim()) return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    await addDoc(collection(db, "notes"), {
      uid,
      text: text.trim(),
      color,
      category: category || null,
      createdAt: serverTimestamp(),
    });

    setText("");
    setCategory("");
    // color bleibt erhalten (QoL)
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
    setOpenColorFor(null);
  };

  const changeCategory = async (id: string, cat: Cat | "") => {
    await updateDoc(doc(db, "notes", id), { category: cat || null });
    setOpenCatFor(null);
  };

  /* =========================
     Derivierte Daten
     ========================= */

  const visibleNotes =
    filter === "ALL" ? notes : notes.filter((n) => (n.category ?? "") === filter);

  /* =========================
     UI Helper (Design)
     ========================= */

  // Ampelkreise
  const circleClass = (active: boolean, tone: "green" | "yellow" | "red") =>
    `w-6 h-6 rounded-full border-2 ${
      active
        ? tone === "green"
          ? "bg-green-600 border-green-800"
          : tone === "yellow"
          ? "bg-yellow-500 border-yellow-700"
          : "bg-red-600 border-red-800"
        : tone === "green"
        ? "bg-green-300"
        : tone === "yellow"
        ? "bg-yellow-200"
        : "bg-red-300"
    }`;

  // Notizkarte
  const noteCardClass = (tone: Color) => {
    const base =
      "relative p-4 rounded-2xl shadow-lg text-black font-medium text-lg border backdrop-blur-md transition-all";
    const glass = "border-black/20 bg-white/40";
    const byTone =
      tone === "green"
        ? "bg-gradient-to-br from-emerald-200/60 via-emerald-100/40 to-emerald-50/30"
        : tone === "yellow"
        ? "bg-gradient-to-br from-amber-200/60 via-amber-100/40 to-amber-50/30"
        : "bg-gradient-to-br from-rose-200/60 via-rose-100/40 to-rose-50/30";
    const hover = "hover:shadow-xl";
    return `${base} ${glass} ${byTone} ${hover}`;
  };

  // „Neue Notiz“: glassy, dunkles Blau mit Verlauf
  const addButtonClass =
    "w-full relative rounded-2xl border border-blue-950/30 " +
    "bg-gradient-to-br from-blue-900/40 via-blue-700/40 to-blue-600/40 " +
    "backdrop-blur-md text-white font-semibold py-2 mb-6 " +
    "shadow-lg hover:shadow-xl transition-shadow";

  // Texteingabe: glassy grau
  const inputGlassClass =
    "w-full p-3 rounded-2xl mb-2 text-lg resize-y min-h-[100px] " +
    "border border-black/20 " +
    "bg-gradient-to-br from-slate-200/50 via-white/30 to-slate-100/30 " +
    "backdrop-blur-md text-gray-900 placeholder-gray-600 " +
    "focus:outline-none focus:ring-2 focus:ring-black/20";

  // Google-Buttons: glassy grau (weiß/grau, dünner schwarzer Rand)
  const googleBtnClass =
    "rounded-2xl px-3 py-2 text-sm bg-gradient-to-br from-gray-200/50 via-white/30 to-gray-100/30 " +
    "text-gray-900 border border-black/30 backdrop-blur-md " +
    "hover:bg-white/50 transition shadow-sm";

  /* =========================
     Render
     ========================= */

  return (
    <div className="min-h-screen bg-white">
      <div className="p-8 max-w-md mx-auto font-sans">
        {/* Header */}
        <div className="flex flex-col items-center mb-6">
          <Image
            src="/logo.png"
            alt="OneStepBehind Logo"
            width={80}
            height={80}
            priority
          />
          <h1 className="mt-3 text-3xl font-extrabold text-gray-900">
            OneStepBehind
          </h1>
        </div>

        {/* Auth */}
        <div className="mb-6">
          <div className="mt-1 flex items-center gap-2">
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
              className={googleBtnClass}
              title="Anonymen Account mit Google verknüpfen (oder anmelden)"
            >
              Mit Google anmelden
            </button>
            <button onClick={signOut} className={googleBtnClass}>
              Abmelden
            </button>
          </div>
        </div>

        {/* Filter */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <FilterChip active={filter === "ALL"} onClick={() => setFilter("ALL")}>
            Alle
          </FilterChip>
          {CATS.map((c) => (
            <FilterChip key={c} active={filter === c} onClick={() => setFilter(c)}>
              {c}
            </FilterChip>
          ))}
        </div>

        {/* Eingabe */}
        <textarea
          placeholder="Neue Notiz eingeben"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className={inputGlassClass}
        />

        {/* Kategorien + Ampel (neue Notiz) */}
        <div className="flex items-center gap-4 mb-2">
          <div className="flex items-center gap-2">
            {CATS.map((c) => {
              const active = category === c;
              return (
                <button
                  key={c}
                  onClick={() => setCategory(active ? "" : c)}
                  aria-label={`Kategorie ${c} wählen`}
                  className={`w-8 h-8 rounded border text-sm font-semibold ${
                    active
                      ? "bg-white text-gray-900 border-gray-500"
                      : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
                  }`}
                  title={`Kategorie ${c}`}
                >
                  {c}
                </button>
              );
            })}
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setColor("green")}
              aria-label="Grün wählen"
              className={circleClass(color === "green", "green")}
            />
            <button
              onClick={() => setColor("yellow")}
              aria-label="Gelb wählen"
              className={circleClass(color === "yellow", "yellow")}
            />
            <button
              onClick={() => setColor("red")}
              aria-label="Rot wählen"
              className={circleClass(color === "red", "red")}
            />
          </div>
        </div>

        {/* „Neue Notiz“ – glassy, dunkles Blau mit Verlauf */}
        <button onClick={addNote} className={addButtonClass}>
          Notiz hinzufügen
        </button>

        {/* Liste */}
        {loading ? (
          <div className="text-gray-500">Lade Notizen…</div>
        ) : visibleNotes.length === 0 ? (
          <div className="text-gray-500">
            {filter === "ALL"
              ? "Noch keine Notizen gespeichert."
              : "Keine Notizen in dieser Kategorie."}
          </div>
        ) : (
          <div className="space-y-3">
            {visibleNotes.map((note) => {
              const isCatOpen = openCatFor === note.id;
              const isColorOpen = openColorFor === note.id;
              return (
                <div key={note.id} className={noteCardClass(note.color)}>
                  {/* Löschen */}
                  <button
                    onClick={() => deleteNote(note.id)}
                    className="absolute top-2 right-2 text-gray-700 hover:text-black"
                    aria-label="Notiz löschen"
                  >
                    ✖
                  </button>

                  {/* Inhalt / Edit */}
                  {note.isEditing ? (
                    <EditRow
                      defaultValue={note.text}
                      onSave={(val) => saveNote(note.id, val)}
                      onCancel={() => toggleEdit(note.id)}
                    />
                  ) : (
                    <div
                      onClick={() => toggleEdit(note.id)}
                      className="cursor-pointer whitespace-pre-wrap"
                      title="Zum Bearbeiten klicken"
                    >
                      {note.text}
                    </div>
                  )}

                  {/* Footer: Kategorie + Ampel */}
                  <div className="flex items-center gap-3 mt-3">
                    {/* Kategorie-Badge */}
                    <div className="relative">
                      <button
                        onClick={() =>
                          setOpenCatFor(isCatOpen ? null : note.id)
                        }
                        className="text-xs bg-white/80 text-gray-800 rounded px-2 py-0.5 border border-white/70 shadow-sm"
                        aria-expanded={isCatOpen}
                        aria-label="Kategorie öffnen/schließen"
                        title="Kategorie ändern"
                      >
                        {note.category || "—"}
                      </button>

                      {isCatOpen && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {CATS.map((c) => (
                            <button
                              key={c}
                              onClick={() => changeCategory(note.id, c)}
                              className={`px-2 py-1 rounded text-xs border ${
                                note.category === c
                                  ? "bg-gray-900 text-white border-gray-900"
                                  : "bg-white text-gray-700 border-gray-300 hover:border-gray-400"
                              }`}
                              title={`Kategorie ${c} setzen`}
                            >
                              {c}
                            </button>
                          ))}
                          <button
                            onClick={() => changeCategory(note.id, "")}
                            className="px-2 py-1 rounded text-xs border bg-white text-gray-700 border-gray-300 hover:border-gray-400"
                            title="Kategorie entfernen"
                          >
                            Keine
                          </button>
                        </div>
                      )}
                    </div>

                    <span className="flex-1" />

                    {/* Ampel-Farbe */}
                    <div className="relative">
                      <button
                        onClick={() =>
                          setOpenColorFor(isColorOpen ? null : note.id)
                        }
                        className={circleClass(true, note.color)}
                        aria-expanded={isColorOpen}
                        aria-label="Farbe öffnen/schließen"
                        title="Farbe ändern"
                      />
                      {isColorOpen && (
                        <div className="mt-2 flex items-center gap-3">
                          <button
                            onClick={() => changeColor(note.id, "green")}
                            aria-label="Grün setzen"
                            className={circleClass(note.color === "green", "green")}
                            title="Grün"
                          />
                          <button
                            onClick={() => changeColor(note.id, "yellow")}
                            aria-label="Gelb setzen"
                            className={circleClass(note.color === "yellow", "yellow")}
                            title="Gelb"
                          />
                          <button
                            onClick={() => changeColor(note.id, "red")}
                            aria-label="Rot setzen"
                            className={circleClass(note.color === "red", "red")}
                            title="Rot"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* =========================
   UI-Bausteine
   ========================= */

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-sm border ${
        active
          ? "bg-gray-900 text-white border-gray-900"
          : "bg-white text-gray-700 border-gray-300 hover:border-gray-400"
      }`}
    >
      {children}
    </button>
  );
}

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

/** Edit-Zeile – auto-resizing Textarea */
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
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    autoResize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const autoResize = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.max(el.scrollHeight, 120) + "px";
  };

  return (
    <div className="flex flex-col gap-2">
      <textarea
        ref={taRef}
        value={val}
        onChange={(e) => {
          setVal(e.target.value);
          autoResize();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) onSave(val);
          if (e.key === "Escape") onCancel();
        }}
        className="w-full p-3 rounded-2xl border border-black/30 text-black text-lg
                   bg-gradient-to-br from-slate-200/50 via-white/30 to-slate-100/30
                   backdrop-blur-md focus:outline-none focus:ring-2 focus:ring-black/20 resize-none"
        placeholder="Notiz bearbeiten…"
      />
      <div className="flex items-center gap-2">
        <button
          onClick={() => onSave(val)}
          className="rounded-2xl px-3 py-2 text-sm bg-gradient-to-br from-gray-200/50 via-white/30 to-gray-100/30
                     text-gray-900 border border-black/30 backdrop-blur-md hover:bg-white/50 transition shadow-sm"
        >
          Speichern
        </button>
        <button
          onClick={onCancel}
          className="rounded-2xl px-3 py-2 text-sm bg-gradient-to-br from-gray-200/50 via-white/30 to-gray-100/30
                     text-gray-900 border border-black/30 backdrop-blur-md hover:bg-white/50 transition shadow-sm"
        >
          Abbrechen
        </button>
      </div>
    </div>
  );
}
