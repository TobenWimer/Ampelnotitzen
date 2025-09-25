"use client";

/**
 * OneStepBehind – Notiz-App mit Kategorien + Stacks (Nur für eingeloggte Google-User)
 * - Ohne Login oder bei anonymem User → Redirect auf "/"
 * - Filter oben steuert auch die Erstell-Kategorie (unten nur Stack-Auswahl)
 * - NEU: Stack löschen durch Klick auf Stack-Titel → zeigt „X“, löscht Stack und setzt zugehörige Notizen auf stackId:null
 */

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { db, auth } from "@/lib/firebase";
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
  getDocs,
  writeBatch,
} from "firebase/firestore";

/* =========================
   Typen
   ========================= */

type Color = "green" | "yellow" | "red";

type Category = {
  id: string;
  uid: string;
  name: string;
  order?: number;
  createdAt?: Date | null;
};
type CategoryDoc = {
  uid: string;
  name: string;
  order?: number;
  createdAt?: Timestamp;
};

type Stack = {
  id: string;
  uid: string;
  categoryId: string;
  title: string;
  order?: number;
  createdAt?: Date | null;
};
type StackDoc = {
  uid: string;
  categoryId: string;
  title: string;
  order?: number;
  createdAt?: Timestamp;
};

type Note = {
  id: string;
  uid?: string;
  text: string;
  color: Color;
  categoryId?: string | null;
  stackId?: string | null;
  createdAt?: Date | null;
  isEditing?: boolean;
};
type NoteDoc = {
  uid: string;
  text?: string;
  color?: Color;
  categoryId?: string | null;
  stackId?: string | null;
  createdAt?: Timestamp;
};

/* =========================
   Stile
   ========================= */

const STACK_COL_CLASS = "space-y-3";
const STACK_HEADER_CLASS =
  "sticky top-0 z-10 px-3 py-2 rounded-xl border border-black/20 " +
  "bg-gradient-to-br from-gray-200/55 via-white/35 to-gray-100/45 " +
  "backdrop-blur-md text-gray-900 font-semibold flex items-center justify-between";

const filterChipClass = (active: boolean) =>
  "px-3 py-1 rounded-full text-sm border backdrop-blur-md transition " +
  (active
    ? "border-black/60 text-white shadow bg-gradient-to-br from-black/70 via-neutral-900/60 to-neutral-800/60"
    : "border-black/25 text-gray-900 shadow-sm bg-gradient-to-br from-gray-200/60 via-white/40 to-gray-100/55 hover:bg-white/60");

const tinyXBtn =
  "inline-flex items-center justify-center w-6 h-6 rounded-lg border border-black/25 " +
  "bg-gradient-to-br from-gray-200/55 via-white/35 to-gray-100/45 text-gray-800 hover:border-black/50";

const stackChipClass = (active: boolean) =>
  "px-3 h-9 rounded-xl border text-sm font-semibold " +
  "bg-gradient-to-br from-gray-200/55 via-white/35 to-gray-100/45 " +
  "backdrop-blur-md " +
  (active
    ? "text-gray-900 border-black/80 shadow"
    : "text-gray-700 border-black/25 hover:border-black/40");

const addButtonClass =
  "w-full relative rounded-2xl border border-blue-950/25 " +
  "bg-gradient-to-br from-blue-700/45 via-blue-500/35 to-blue-200/30 " +
  "backdrop-blur-md text-black font-semibold py-2 mb-6 " +
  "shadow-lg hover:shadow-xl transition-shadow";

const inputGlassClass =
  "w-full p-3 rounded-2xl mb-2 text-lg resize-y min-h[100px] min-h-[100px] " +
  "border border-black/20 " +
  "bg-gradient-to-br from-slate-200/50 via-white/30 to-slate-100/30 " +
  "backdrop-blur-md text-gray-900 placeholder-gray-600 " +
  "focus:outline-none focus:ring-2 focus:ring-black/20";

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

/* =========================
   Seite
   ========================= */

export default function NotesPage() {
  const router = useRouter();

  // Eingabe
  const [text, setText] = useState("");
  const [color, setColor] = useState<Color>("green");
  const [categoryIdForNew, setCategoryIdForNew] = useState<string | "">("");
  const [selectedStackForNew, setSelectedStackForNew] = useState<string | null>(null);
  const [lastStackByCategory, setLastStackByCategory] = useState<Record<string, string | null>>({});

  // Daten
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadingCats, setLoadingCats] = useState(true);

  const [notes, setNotes] = useState<Note[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(true);

  const [stacks, setStacks] = useState<Stack[]>([]);
  const [loadingStacks, setLoadingStacks] = useState(false);

  const [stacksForNew, setStacksForNew] = useState<Stack[]>([]);
  const [loadingStacksForNew, setLoadingStacksForNew] = useState(false);

  // Filter + UI-Zustände
  const [filter, setFilter] = useState<"ALL" | string>("ALL");
  const [openColorFor, setOpenColorFor] = useState<string | null>(null);
  const [openCatFor, setOpenCatFor] = useState<string | null>(null);
  const [openStackFor, setOpenStackFor] = useState<string | null>(null);

  // Stack-Header-X sichtbar für welchen Stack?
  const [openStackHeaderFor, setOpenStackHeaderFor] = useState<string | null>(null);

  // Dialoge
  const [catDialogOpen, setCatDialogOpen] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [stackDialogOpen, setStackDialogOpen] = useState(false);
  const [newStackTitle, setNewStackTitle] = useState("");

  // Unsubs
  const catsUnsubRef = useRef<(() => void) | null>(null);
  const notesUnsubRef = useRef<(() => void) | null>(null);
  const stacksUnsubRef = useRef<(() => void) | null>(null);
  const stacksForNewUnsubRef = useRef<(() => void) | null>(null);

  /* Auth & Daten-Subscriptions */
  useEffect(() => {
    const offAuth = auth.onAuthStateChanged((u) => {
      // Wenn kein User oder anonymer User → zurück zur Startseite
      if (!u || u.isAnonymous) {
        catsUnsubRef.current?.(); catsUnsubRef.current = null;
        notesUnsubRef.current?.(); notesUnsubRef.current = null;
        stacksUnsubRef.current?.(); stacksUnsubRef.current = null;
        stacksForNewUnsubRef.current?.(); stacksForNewUnsubRef.current = null;

        setCategories([]); setLoadingCats(false);
        setNotes([]); setLoadingNotes(false);
        setStacks([]); setLoadingStacks(false);
        setStacksForNew([]); setLoadingStacksForNew(false);

        router.replace("/");
        return;
      }

      // Subscriptions zurücksetzen
      catsUnsubRef.current?.(); catsUnsubRef.current = null;
      notesUnsubRef.current?.(); notesUnsubRef.current = null;
      stacksUnsubRef.current?.(); stacksUnsubRef.current = null;
      stacksForNewUnsubRef.current?.(); stacksForNewUnsubRef.current = null;

      // Kategorien
      setLoadingCats(true);
      const qCats = query(collection(db, "categories"), where("uid", "==", u.uid));
      catsUnsubRef.current = onSnapshot(
        qCats,
        (snap: QuerySnapshot<DocumentData>) => {
          const cats: Category[] = snap.docs.map((d) => {
            const data = d.data() as CategoryDoc;
            return {
              id: d.id,
              uid: data.uid,
              name: data.name,
              order: data.order,
              createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : null,
            };
          });
          cats.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
          setCategories(cats);
          setLoadingCats(false);

          // Ungültige Filter korrigieren
          if (filter !== "ALL" && !cats.find((c) => c.id === filter)) {
            setFilter("ALL");
            setCategoryIdForNew("");
          }
          if (categoryIdForNew && !cats.find((c) => c.id === categoryIdForNew)) {
            setCategoryIdForNew("");
            setSelectedStackForNew(null);
          }
        },
        (err) => {
          console.warn("categories error", err);
          setCategories([]); setLoadingCats(false);
        }
      );

      // Notizen
      setLoadingNotes(true);
      const qNotes = query(collection(db, "notes"), where("uid", "==", u.uid));
      notesUnsubRef.current = onSnapshot(
        qNotes,
        (snap: QuerySnapshot<DocumentData>) => {
          const items: Note[] = snap.docs.map((d) => {
            const data = d.data() as NoteDoc;
            return {
              id: d.id,
              uid: data.uid,
              text: data.text ?? "",
              color: (data.color ?? "green") as Color,
              categoryId: data.categoryId ?? null,
              stackId: data.stackId ?? null,
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
          setLoadingNotes(false);
        },
        (err) => {
          console.warn("notes error", err);
          setNotes([]); setLoadingNotes(false);
        }
      );

      // Stacks-States zurücksetzen
      setStacks([]); setLoadingStacks(false);
      setStacksForNew([]); setLoadingStacksForNew(false);
    });

    return () => {
      offAuth();
      catsUnsubRef.current?.();
      notesUnsubRef.current?.();
      stacksUnsubRef.current?.();
      stacksForNewUnsubRef.current?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stacks für Grid (abhängig von Filter)
  useEffect(() => {
    stacksUnsubRef.current?.(); stacksUnsubRef.current = null;
    setStacks([]); setLoadingStacks(false);

    const u = auth.currentUser;
    if (!u || filter === "ALL") return;

    setLoadingStacks(true);
    const qStacks = query(
      collection(db, "stacks"),
      where("uid", "==", u.uid),
      where("categoryId", "==", filter)
    );
    stacksUnsubRef.current = onSnapshot(
      qStacks,
      (snap: QuerySnapshot<DocumentData>) => {
        const s: Stack[] = snap.docs.map((d) => {
          const data = d.data() as StackDoc;
          return {
            id: d.id,
            uid: data.uid,
            categoryId: data.categoryId,
            title: data.title,
            order: data.order,
            createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : null,
          };
        });
        s.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        setStacks(s);
        setLoadingStacks(false);
      },
      (err) => {
        console.warn("stacks(filter) error", err);
        setStacks([]); setLoadingStacks(false);
      }
    );
  }, [filter]);

  // Stacks für „Neue Notiz“ (abhängig von Erstell-Kategorie)
  useEffect(() => {
    stacksForNewUnsubRef.current?.(); stacksForNewUnsubRef.current = null;
    setStacksForNew([]); setLoadingStacksForNew(false);

    const u = auth.currentUser;
    if (!u || !categoryIdForNew) return;

    setLoadingStacksForNew(true);
    const qStacks = query(
      collection(db, "stacks"),
      where("uid", "==", u.uid),
      where("categoryId", "==", categoryIdForNew)
    );
    stacksForNewUnsubRef.current = onSnapshot(
      qStacks,
      (snap: QuerySnapshot<DocumentData>) => {
        const s: Stack[] = snap.docs.map((d) => {
          const data = d.data() as StackDoc;
          return {
            id: d.id,
            uid: data.uid,
            categoryId: data.categoryId,
            title: data.title,
            order: data.order,
            createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : null,
          };
        });
        s.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        setStacksForNew(s);
        setLoadingStacksForNew(false);

        const remembered = lastStackByCategory[categoryIdForNew];
        if (remembered && s.find((x) => x.id === remembered)) {
          setSelectedStackForNew(remembered);
        } else {
          setSelectedStackForNew(null);
        }
      },
      (err) => {
        console.warn("stacks(forNew) error", err);
        setStacksForNew([]); setLoadingStacksForNew(false);
        setSelectedStackForNew(null);
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryIdForNew]);

  /* Aktionen */

  const addCategory = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const name = newCatName.trim();
    if (!name) return;
    await addDoc(collection(db, "categories"), {
      uid,
      name,
      order: categories.length,
      createdAt: serverTimestamp(),
    });
    setNewCatName("");
    setCatDialogOpen(false);
  };

  const addStack = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid || filter === "ALL") return;
    const title = newStackTitle.trim();
    if (!title) return;
    await addDoc(collection(db, "stacks"), {
      uid,
      categoryId: filter,
      title,
      order: stacks.length,
      createdAt: serverTimestamp(),
    });
    setNewStackTitle("");
    setStackDialogOpen(false);
  };

  const addNote = async () => {
    if (!text.trim()) return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await addDoc(collection(db, "notes"), {
      uid,
      text: text.trim(),
      color,
      categoryId: categoryIdForNew || null,
      stackId: selectedStackForNew ?? null,
      createdAt: serverTimestamp(),
    });
    if (categoryIdForNew) {
      setLastStackByCategory((prev) => ({
        ...prev,
        [categoryIdForNew]: selectedStackForNew ?? null,
      }));
    }
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
    setOpenColorFor(null);
  };

  const changeCategoryForNote = async (id: string, newCatId: string | null) => {
    await updateDoc(doc(db, "notes", id), { categoryId: newCatId, stackId: null });
    setOpenCatFor(null);
  };

  const changeStackForNote = async (id: string, newStackId: string | null) => {
    await updateDoc(doc(db, "notes", id), { stackId: newStackId });
    setOpenStackFor(null);
  };

  /** Kategorie löschen (X neben aktivem Chip) */
  const deleteCategory = async (catId: string) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const [notesSnap, stacksSnap] = await Promise.all([
      getDocs(query(collection(db, "notes"), where("uid", "==", uid), where("categoryId", "==", catId))),
      getDocs(query(collection(db, "stacks"), where("uid", "==", uid), where("categoryId", "==", catId))),
    ]);

    const noteDocs = notesSnap.docs;
    const stackDocs = stacksSnap.docs;

    const ok = window.confirm(
      `Kategorie wirklich löschen?\n\n` +
        `• Notizen in dieser Kategorie: ${noteDocs.length} (werden auf „keine Kategorie“ gesetzt)\n` +
        `• Stacks in dieser Kategorie: ${stackDocs.length} (werden gelöscht)\n\n` +
        `Fortfahren?`
    );
    if (!ok) return;

    const batch = writeBatch(db);
    for (const nd of noteDocs) {
      batch.update(nd.ref, { categoryId: null, stackId: null });
    }
    for (const sd of stackDocs) {
      batch.delete(sd.ref);
    }
    batch.delete(doc(db, "categories", catId));
    await batch.commit();

    if (filter === catId) setFilter("ALL");
    if (categoryIdForNew === catId) {
      setCategoryIdForNew("");
      setSelectedStackForNew(null);
    }
  };

  /** NEU: Stack löschen (setzt Notizen auf stackId:null, Kategorie bleibt) */
  const deleteStack = async (stackId: string) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const [notesSnap] = await Promise.all([
      getDocs(
        query(
          collection(db, "notes"),
          where("uid", "==", uid),
          where("stackId", "==", stackId)
        )
      ),
    ]);

    const noteDocs = notesSnap.docs;

    const ok = window.confirm(
      `Diesen Stack wirklich löschen?\n\n` +
        `• Notizen in diesem Stack: ${noteDocs.length} (werden im Stapel entfernt, bleiben in der Kategorie)\n\n` +
        `Fortfahren?`
    );
    if (!ok) return;

    const batch = writeBatch(db);
    for (const nd of noteDocs) {
      batch.update(nd.ref, { stackId: null });
    }
    batch.delete(doc(db, "stacks", stackId));
    await batch.commit();

    // Eingabe-Stack ggf. zurücksetzen
    if (selectedStackForNew === stackId) {
      setSelectedStackForNew(null);
    }
    // Header-X schließen
    setOpenStackHeaderFor((prev) => (prev === stackId ? null : prev));
  };

  /* Abgeleitete Daten */

  const filteredNotes = useMemo(() => {
    if (filter === "ALL") return notes;
    return notes.filter((n) => (n.categoryId ?? null) === filter);
  }, [notes, filter]);

  const groupedByStack = useMemo(() => {
    if (filter === "ALL") return {};
    const groups: Record<string, Note[]> = {};
    for (const n of filteredNotes) {
      const key = n.stackId ?? "__none__";
      if (!groups[key]) groups[key] = [];
      groups[key].push(n);
    }
    return groups;
  }, [filteredNotes, filter]);

  /* Render */

  return (
    <div className="min-h-screen bg-white">
      <div className="p-8 max-w-5xl mx-auto font-sans">
        {/* Mini-Header: Logo + Title → Link zur Startseite */}
        <Link href="/" className="flex flex-col items-center mb-6 group" title="Zur Startseite">
          <Image
            src="/logo.png"
            alt="OneStepBehind Logo"
            width={88}
            height={88}
            priority
            className="transition-transform group-hover:scale-105"
          />
          <h1 className="mt-3 text-4xl md:text-5xl font-extrabold text-black tracking-tight group-hover:opacity-90">
            OneStepBehind
          </h1>
          <span className="mt-2 text-xs text-gray-6000 opacity-80"> </span>
        </Link>

        {/* Kategorien-Filter + Manager */}
        <div className="mb-4 flex flex-wrap items-center gap-2 justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <button
              className={filterChipClass(filter === "ALL")}
              onClick={() => {
                setFilter("ALL");
                setCategoryIdForNew(""); // Erstell-Kategorie leeren, wenn "Alle"
                setSelectedStackForNew(null);
              }}
            >
              Alle
            </button>

            {!loadingCats &&
              categories.map((c) => {
                const active = filter === c.id;
                return (
                  <span key={c.id} className="inline-flex items-center gap-1">
                    <button
                      className={filterChipClass(active)}
                      onClick={() => {
                        setFilter(c.id);
                        // Obere Auswahl setzt auch die Erstell-Kategorie
                        setCategoryIdForNew(c.id);
                        const remembered = lastStackByCategory[c.id];
                        setSelectedStackForNew(remembered ?? null);
                      }}
                      title={c.name}
                    >
                      {c.name}
                    </button>
                    {active && (
                      <button
                        className={tinyXBtn}
                        onClick={() => deleteCategory(c.id)}
                        title={`Kategorie „${c.name}“ löschen`}
                        aria-label={`Kategorie „${c.name}“ löschen`}
                      >
                        ×
                      </button>
                    )}
                  </span>
                );
              })}
          </div>

          {/* + Kategorie / + Stack */}
          <div className="flex items-center gap-2">
            {!catDialogOpen ? (
              <button
                onClick={() => setCatDialogOpen(true)}
                className="rounded-2xl px-3 py-2 text-sm border border-black/30 text-gray-900
                           bg-gradient-to-br from-gray-200/55 via-white/35 to-gray-100/45
                           backdrop-blur-md hover:bg-white/60 transition shadow-sm"
              >
                + Kategorie
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  placeholder="Kategoriename"
                  className="px-3 py-2 rounded-2xl border border-black/30
                             bg-gradient-to-br from-white/70 via-white/40 to-white/20
                             backdrop-blur-md text-gray-900 placeholder-gray-500
                             focus:outline-none focus:ring-2 focus:ring-black/20"
                />
                <button
                  onClick={addCategory}
                  className="rounded-2xl px-3 py-2 text-sm border border-black/30 text-gray-900
                             bg-gradient-to-br from-gray-200/55 via-white/35 to-gray-100/45
                             backdrop-blur-md hover:bg-white/60 transition shadow-sm"
                >
                  Speichern
                </button>
                <button
                  onClick={() => {
                    setCatDialogOpen(false);
                    setNewCatName("");
                  }}
                  className="rounded-2xl px-3 py-2 text-sm border border-black/30 text-gray-900
                             bg-gradient-to-br from-gray-200/55 via-white/35 to-gray-100/45
                             backdrop-blur-md hover:bg-white/60 transition shadow-sm"
                >
                  Abbrechen
                </button>
              </div>
            )}

            {filter !== "ALL" &&
              (!stackDialogOpen ? (
                <button
                  onClick={() => setStackDialogOpen(true)}
                  className="rounded-2xl px-3 py-2 text-sm border border-black/30 text-gray-900
                             bg-gradient-to-br from-gray-200/55 via-white/35 to-gray-100/45
                             backdrop-blur-md hover:bg-white/60 transition shadow-sm"
                >
                  + Stack
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    value={newStackTitle}
                    onChange={(e) => setNewStackTitle(e.target.value)}
                    placeholder="Stack-Titel"
                    className="px-3 py-2 rounded-2xl border border-black/30
                               bg-gradient-to-br from-white/70 via-white/40 to-white/20
                               backdrop-blur-md text-gray-900 placeholder-gray-500
                               focus:outline-none focus:ring-2 focus:ring-black/20"
                  />
                  <button
                    onClick={addStack}
                    className="rounded-2xl px-3 py-2 text-sm border border-black/30 text-gray-900
                               bg-gradient-to-br from-gray-200/55 via-white/35 to-gray-100/45
                               backdrop-blur-md hover:bg-white/60 transition shadow-sm"
                  >
                    Speichern
                  </button>
                  <button
                    onClick={() => {
                      setStackDialogOpen(false);
                      setNewStackTitle("");
                    }}
                    className="rounded-2xl px-3 py-2 text-sm border border-black/30 text-gray-900
                               bg-gradient-to-br from-gray-200/55 via-white/35 to-gray-100/45
                               backdrop-blur-md hover:bg-white/60 transition shadow-sm"
                  >
                    Abbrechen
                  </button>
                </div>
              ))}
          </div>
        </div>

        {/* Eingabe */}
        <textarea
          placeholder="Neue Notiz eingeben"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className={inputGlassClass}
        />

        {/* Stack-Auswahl (für oben gesetzte Erstell-Kategorie) + Ampel */}
        <div className="flex items-center gap-4 mb-2 flex-wrap">
          {categoryIdForNew && (
            <div className="flex items-center gap-2">
              {/* neutral = kein Stack */}
              <button
                onClick={() => {
                  setSelectedStackForNew(null);
                  setLastStackByCategory((prev) => ({
                    ...prev,
                    [categoryIdForNew]: null,
                  }));
                }}
                className={
                  (selectedStackForNew === null ? "border-black/80 shadow " : "border-black/25 hover:border-black/40 ") +
                  "h-9 min-w-[28px] rounded-xl border bg-gradient-to-br from-gray-200/55 via-white/35 to-gray-100/45 backdrop-blur-md"
                }
                title="Ohne Stack"
                aria-label="Kein Stack"
              />
              {loadingStacksForNew ? (
                <span className="text-gray-500 text-sm">Lade Stacks…</span>
              ) : stacksForNew.length === 0 ? (
                <span className="text-gray-500 text-sm">Keine Stacks – oben „+ Stack“ nutzen.</span>
              ) : (
                stacksForNew.map((s) => {
                  const active = selectedStackForNew === s.id;
                  return (
                    <button
                      key={s.id}
                      onClick={() => {
                        setSelectedStackForNew(s.id);
                        setLastStackByCategory((prev) => ({ ...prev, [categoryIdForNew]: s.id }));
                      }}
                      title={`Stack: ${s.title}`}
                      className={stackChipClass(active)}
                    >
                      {s.title}
                    </button>
                  );
                })
              )}
            </div>
          )}

          {/* Ampel */}
          <div className="flex gap-3">
            <button onClick={() => setColor("green")} aria-label="Grün wählen" className={circleClass(color === "green", "green")} />
            <button onClick={() => setColor("yellow")} aria-label="Gelb wählen" className={circleClass(color === "yellow", "yellow")} />
            <button onClick={() => setColor("red")} aria-label="Rot wählen" className={circleClass(color === "red", "red")} />
          </div>
        </div>

        {/* Add-Button */}
        <button onClick={addNote} className={addButtonClass}>
          Notiz hinzufügen
        </button>

        {/* Liste / Stacks */}
        {filter === "ALL" ? (
          <SectionList
            loading={loadingNotes}
            notes={filteredNotes}
            categories={categories}
            stacksInScope={[]}
            onDelete={deleteNote}
            onToggleEdit={toggleEdit}
            onSave={saveNote}
            openColorFor={openColorFor}
            onOpenColorFor={(id) => setOpenColorFor((x) => (x === id ? null : id))}
            onChangeColor={changeColor}
            openCatFor={openCatFor}
            onOpenCatFor={(id) => setOpenCatFor((x) => (x === id ? null : id))}
            onChangeCategory={changeCategoryForNote}
            openStackFor={openStackFor}
            onOpenStackFor={() => {}}
            onChangeStack={() => {}}
          />
        ) : (
          <StacksGrid
            loadingNotes={loadingNotes}
            loadingStacks={loadingStacks}
            groupedByStack={groupedByStack}
            stacks={stacks}
            categories={categories}
            onDelete={deleteNote}
            onToggleEdit={toggleEdit}
            onSave={saveNote}
            openColorFor={openColorFor}
            onOpenColorFor={(id) => setOpenColorFor((x) => (x === id ? null : id))}
            onChangeColor={changeColor}
            openCatFor={openCatFor}
            onOpenCatFor={(id) => setOpenCatFor((x) => (x === id ? null : id))}
            onChangeCategory={changeCategoryForNote}
            openStackFor={openStackFor}
            onOpenStackFor={(id) => setOpenStackFor((x) => (x === id ? null : id))}
            onChangeStack={changeStackForNote}
            // NEU:
            openStackHeaderFor={openStackHeaderFor}
            onToggleStackHeader={(id) => setOpenStackHeaderFor((prev) => (prev === id ? null : id))}
            onDeleteStack={deleteStack}
          />
        )}
      </div>
    </div>
  );
}

/* =========================
   Stacks-Grid (Spalten)
   ========================= */

function StacksGrid({
  loadingNotes,
  loadingStacks,
  groupedByStack,
  stacks,
  categories,
  onDelete,
  onToggleEdit,
  onSave,
  openColorFor,
  onOpenColorFor,
  onChangeColor,
  openCatFor,
  onOpenCatFor,
  onChangeCategory,
  openStackFor,
  onOpenStackFor,
  onChangeStack,
  // NEU:
  openStackHeaderFor,
  onToggleStackHeader,
  onDeleteStack,
}: {
  loadingNotes: boolean;
  loadingStacks: boolean;
  groupedByStack: Record<string, Note[]>;
  stacks: Stack[];
  categories: Category[];
  onDelete: (id: string) => void;
  onToggleEdit: (id: string) => void;
  onSave: (id: string, val: string) => void;
  openColorFor: string | null;
  onOpenColorFor: (id: string) => void;
  onChangeColor: (id: string, col: Color) => void;
  openCatFor: string | null;
  onOpenCatFor: (id: string) => void;
  onChangeCategory: (id: string, newCatId: string | null) => void;
  openStackFor: string | null;
  onOpenStackFor: (id: string) => void;
  onChangeStack: (id: string, newStackId: string | null) => void;
  // NEU:
  openStackHeaderFor: string | null;
  onToggleStackHeader: (id: string) => void;
  onDeleteStack: (id: string) => void;
}) {
  const noneKey = "__none__";
  const cols = [{ id: noneKey, title: "(Kein Stack)" }, ...stacks.map((s) => ({ id: s.id, title: s.title }))];

  if (loadingNotes || loadingStacks) return <div className="text-gray-500">Lade…</div>;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {cols.map((col) => {
        const list = groupedByStack[col.id] ?? [];
        const isDeletable = col.id !== noneKey;
        const isHeaderOpen = openStackHeaderFor === col.id;

        return (
          <div key={col.id} className={STACK_COL_CLASS}>
            <div className={STACK_HEADER_CLASS}>
              <button
                className="text-left flex-1"
                title={col.title}
                onClick={() => isDeletable && onToggleStackHeader(col.id)}
              >
                {col.title}
              </button>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-600">{list.length}</span>
                {isDeletable && isHeaderOpen && (
                  <button
                    className={tinyXBtn}
                    title="Diesen Stack löschen"
                    aria-label="Stack löschen"
                    onClick={() => onDeleteStack(col.id)}
                  >
                    ×
                  </button>
                )}
              </div>
            </div>

            {list.length === 0 ? (
              <div className="text-gray-400 italic px-1">Keine Notizen.</div>
            ) : (
              <div className="space-y-3">
                {list.map((note) => (
                  <NoteCard
                    key={note.id}
                    note={note}
                    categories={categories}
                    stacksInScope={stacks}
                    onDelete={onDelete}
                    onToggleEdit={onToggleEdit}
                    onSave={onSave}
                    openColorFor={openColorFor}
                    onOpenColorFor={onOpenColorFor}
                    onChangeColor={onChangeColor}
                    openCatFor={openCatFor}
                    onOpenCatFor={onOpenCatFor}
                    onChangeCategory={onChangeCategory}
                    openStackFor={openStackFor}
                    onOpenStackFor={onOpenStackFor}
                    onChangeStack={onChangeStack}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* =========================
   Klassische Liste (Alle)
   ========================= */

function SectionList({
  loading,
  notes,
  categories,
  stacksInScope,
  onDelete,
  onToggleEdit,
  onSave,
  openColorFor,
  onOpenColorFor,
  onChangeColor,
  openCatFor,
  onOpenCatFor,
  onChangeCategory,
  openStackFor,
  onOpenStackFor,
  onChangeStack,
}: {
  loading: boolean;
  notes: Note[];
  categories: Category[];
  stacksInScope: Stack[];
  onDelete: (id: string) => void;
  onToggleEdit: (id: string) => void;
  onSave: (id: string, val: string) => void;
  openColorFor: string | null;
  onOpenColorFor: (id: string) => void;
  onChangeColor: (id: string, col: Color) => void;
  openCatFor: string | null;
  onOpenCatFor: (id: string) => void;
  onChangeCategory: (id: string, newCatId: string | null) => void;
  openStackFor: string | null;
  onOpenStackFor: (id: string) => void;
  onChangeStack: (id: string, newStackId: string | null) => void;
}) {
  if (loading) return <div className="text-gray-500">Lade Notizen…</div>;
  if (notes.length === 0) return <div className="text-gray-500">Noch keine Notizen gespeichert.</div>;

  return (
    <div className="space-y-3">
      {notes.map((note) => (
        <NoteCard
          key={note.id}
          note={note}
          categories={categories}
          stacksInScope={stacksInScope}
          onDelete={onDelete}
          onToggleEdit={onToggleEdit}
          onSave={onSave}
          openColorFor={openColorFor}
          onOpenColorFor={onOpenColorFor}
          onChangeColor={onChangeColor}
          openCatFor={openCatFor}
          onOpenCatFor={onOpenCatFor}
          onChangeCategory={onChangeCategory}
          openStackFor={openStackFor}
          onOpenStackFor={onOpenStackFor}
          onChangeStack={onChangeStack}
        />
      ))}
    </div>
  );
}

/* =========================
   NoteCard
   ========================= */

function NoteCard({
  note,
  categories,
  stacksInScope,
  onDelete,
  onToggleEdit,
  onSave,
  openColorFor,
  onOpenColorFor,
  onChangeColor,
  openCatFor,
  onOpenCatFor,
  onChangeCategory,
  openStackFor,
  onOpenStackFor,
  onChangeStack,
}: {
  note: Note;
  categories: Category[];
  stacksInScope: Stack[];
  onDelete: (id: string) => void;
  onToggleEdit: (id: string) => void;
  onSave: (id: string, val: string) => void;
  openColorFor: string | null;
  onOpenColorFor: (id: string) => void;
  onChangeColor: (id: string, col: Color) => void;
  openCatFor: string | null;
  onOpenCatFor: (id: string) => void;
  onChangeCategory: (id: string, newCatId: string | null) => void;
  openStackFor: string | null;
  onOpenStackFor: (id: string) => void;
  onChangeStack: (id: string, newStackId: string | null) => void;
}) {
  const isColorOpen = openColorFor === note.id;
  const isCatOpen = openCatFor === note.id;
  const isStackOpen = openStackFor === note.id;

  return (
    <div className={noteCardClass(note.color)}>
      {/* Löschen */}
      <button
        onClick={() => onDelete(note.id)}
        className="absolute top-2 right-2 text-gray-700 hover:text-black"
        aria-label="Notiz löschen"
      >
        ✖
      </button>

      {/* Inhalt / Edit */}
      {note.isEditing ? (
        <EditRow
          defaultValue={note.text}
          onSave={(val) => onSave(note.id, val)}
          onCancel={() => onToggleEdit(note.id)}
        />
      ) : (
        <div
          onClick={() => onToggleEdit(note.id)}
          className="cursor-pointer whitespace-pre-wrap"
          title="Zum Bearbeiten klicken"
        >
          {note.text}
        </div>
      )}

      {/* Footer: Kategorie + Stack + Ampel */}
      <div className="flex items-center gap-3 mt-3 flex-wrap">
        {/* Kategorie-Badge */}
        <div className="relative">
          <button
            onClick={() => onOpenCatFor(note.id)}
            className="text-xs bg-white/80 text-gray-800 rounded px-2 py-0.5 border border-white/70 shadow-sm"
            aria-expanded={isCatOpen}
            aria-label="Kategorie öffnen/schließen"
            title="Kategorie ändern"
          >
            {note.categoryId
              ? categories.find((c) => c.id === note.categoryId)?.name ?? "Kategorie"
              : "—"}
          </button>

          {isCatOpen && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                onClick={() => onChangeCategory(note.id, null)}
                className="px-2 py-1 rounded text-xs border bg-white text-gray-700 border-gray-300 hover:border-gray-400"
              >
                (Keine)
              </button>
              {categories.map((c) => (
                <button
                  key={c.id}
                  onClick={() => onChangeCategory(note.id, c.id)}
                  className={`px-2 py-1 rounded text-xs border ${
                    note.categoryId === c.id
                      ? "bg-gray-900 text-white border-gray-900"
                      : "bg-white text-gray-700 border-gray-300 hover:border-gray-400"
                  }`}
                  title={`Zu "${c.name}" verschieben`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Stack-Badge */}
        {stacksInScope.length > 0 && (
          <div className="relative">
            <button
              onClick={() => onOpenStackFor(note.id)}
              className={`text-xs rounded px-2 py-0.5 border shadow-sm ${
                note.stackId
                  ? "bg-white/80 text-gray-800 border-white/70"
                  : "bg-white/50 text-transparent border-white/60 min-w-[24px]"
              }`}
              aria-expanded={isStackOpen}
              aria-label="Stack öffnen/schließen"
              title="Stack ändern"
            >
              {note.stackId
                ? stacksInScope.find((s) => s.id === note.stackId)?.title ?? ""
                : ""}
            </button>

            {isStackOpen && (
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  onClick={() => onChangeStack(note.id, null)}
                  className="px-2 py-1 rounded text-xs border bg-white text-gray-700 border-gray-300 hover:border-gray-400"
                >
                  (Kein Stack)
                </button>
                {stacksInScope.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => onChangeStack(note.id, s.id)}
                    className={`px-2 py-1 rounded text-xs border ${
                      note.stackId === s.id
                        ? "bg-gray-900 text-white border-gray-900"
                        : "bg-white text-gray-700 border-gray-300 hover:border-gray-400"
                    }`}
                    title={`Zu "${s.title}" verschieben`}
                  >
                    {s.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <span className="flex-1" />

        {/* Ampel */}
        <div className="relative">
          <button
            onClick={() => onOpenColorFor(note.id)}
            className={circleClass(true, note.color)}
            aria-expanded={isColorOpen}
            aria-label="Farbe öffnen/schließen"
            title="Farbe ändern"
          />
          {isColorOpen && (
            <div className="mt-2 flex items-center gap-3">
              <button onClick={() => onChangeColor(note.id, "green")} aria-label="Grün setzen" className={circleClass(note.color === "green", "green")} title="Grün" />
              <button onClick={() => onChangeColor(note.id, "yellow")} aria-label="Gelb setzen" className={circleClass(note.color === "yellow", "yellow")} title="Gelb" />
              <button onClick={() => onChangeColor(note.id, "red")} aria-label="Rot setzen" className={circleClass(note.color === "red", "red")} title="Rot" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* =========================
   EditRow
   ========================= */

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
