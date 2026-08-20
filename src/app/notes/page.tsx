"use client";

/**
 * OneStepBehind – Notiz-App mit Kategorien + Stacks (Nur für eingeloggte Google-User)
 * - Ohne Login oder bei anonymem User → Redirect auf "/"
 * - Filter oben steuert auch die Erstell-Kategorie (unten nur Stack-Auswahl)
 * - NEU: Stack löschen durch Klick auf Stack-Titel → zeigt „X“, löscht Stack und setzt zugehörige Notizen auf stackId:null
 */

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
import HudGlobalStyles from "@/components/hud/HudGlobalStyles";
import { HudFooter } from "@/components/hud/HudFooter";
import { SignalTower } from "@/components/hud/SignalTower";

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

const TONE_COLORS: Record<Color, string> = {
  green: "#4ade80",
  yellow: "#fbbf24",
  red: "#f87171",
};

// min-w-0: ohne das duerfen Grid-Spalten von langen Notiz-Woertern aufgeblaeht werden
const STACK_COL_CLASS = "space-y-3 min-w-0";
const STACK_HEADER_CLASS =
  "hud-panel sticky top-0 z-10 px-3 py-2 rounded-xl text-cyan-100 text-xs uppercase tracking-wider font-semibold flex items-center justify-between";

const filterChipClass = (active: boolean) =>
  `hud-btn ${active ? "hud-btn-primary" : "hud-btn-outline"}`;

const tinyXBtn =
  "inline-flex items-center justify-center w-7 h-7 rounded-lg border border-rose-400/35 text-rose-300 hover:border-rose-400/70 hover:bg-rose-500/10 transition";

const stackChipClass = (active: boolean) =>
  `hud-btn ${active ? "hud-btn-primary" : "hud-btn-outline"}`;

const addButtonClass = "hud-btn hud-btn-primary w-full mb-6";

const inputGlassClass =
  "hud-input w-full mb-2 text-base resize-y min-h-[100px]";

const circleClass = (active: boolean, tone: Color) => `w-7 h-7 rounded-full border-2 transition-all`;

const circleStyle = (active: boolean, tone: Color): React.CSSProperties => {
  const c = TONE_COLORS[tone];
  return {
    background: active ? c : "rgba(255,255,255,0.05)",
    borderColor: active ? c : `${c}55`,
    boxShadow: active ? `0 0 12px 2px ${c}99, inset 0 0 6px rgba(255,255,255,0.35)` : "none",
  };
};

const noteCardClass = () =>
  "hud-panel hud-panel-hover relative p-4 rounded-2xl text-cyan-50 text-base";

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
  const [colorFilter, setColorFilter] = useState<Color | null>(null);
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

  // Nur Notizen der aktuell gefilterten Kategorie zaehlen (bei "Alle" alle),
  // damit der Statusmast zur sichtbaren Liste passt statt immer global zu zaehlen.
  const notesInScope = useMemo(
    () => (filter === "ALL" ? notes : notes.filter((n) => (n.categoryId ?? null) === filter)),
    [notes, filter]
  );

  const signalCounts = useMemo(
    () => ({
      green: notesInScope.filter((n) => n.color === "green").length,
      yellow: notesInScope.filter((n) => n.color === "yellow").length,
      red: notesInScope.filter((n) => n.color === "red").length,
    }),
    [notesInScope]
  );

  const filteredNotes = useMemo(() => {
    let list = filter === "ALL" ? notes : notes.filter((n) => (n.categoryId ?? null) === filter);
    if (colorFilter) list = list.filter((n) => n.color === colorFilter);
    return list;
  }, [notes, filter, colorFilter]);

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
    <div className="min-h-screen hud-bg text-cyan-50 flex flex-col relative overflow-hidden font-mono">
      <div className="hud-grid pointer-events-none absolute inset-0" />

      {/* Einheitlicher Header wie in den anderen Modulen */}
      <header className="relative z-10 w-full flex items-center justify-between px-6 py-4 border-b border-cyan-400/20 bg-black/20 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-xs tracking-widest text-cyan-400/70 hover:text-cyan-300 transition uppercase">
            ← Zurück
          </Link>
          <span className="text-cyan-400/20">|</span>
          <h1 className="hud-title text-lg font-bold text-cyan-100 uppercase">Notizen</h1>
        </div>
        <span className="flex items-center gap-1.5 text-[10px] tracking-[0.2em] text-cyan-400/70 uppercase">
          <span className="hud-dot h-1.5 w-1.5 rounded-full bg-cyan-400" />
          Sync aktiv
        </span>
      </header>

      <div className="relative z-10 flex-1 p-6 md:p-8 max-w-5xl mx-auto w-full">
        {/* Ampel-Statusmast */}
        <div className="mb-8">
          <SignalTower counts={signalCounts} activeFilter={colorFilter} onFilter={setColorFilter} />
        </div>

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
              <button onClick={() => setCatDialogOpen(true)} className="hud-btn hud-btn-outline">
                + Kategorie
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  placeholder="Kategoriename"
                  className="hud-input"
                />
                <button onClick={addCategory} className="hud-btn hud-btn-primary">
                  Speichern
                </button>
                <button
                  onClick={() => {
                    setCatDialogOpen(false);
                    setNewCatName("");
                  }}
                  className="hud-btn hud-btn-outline"
                >
                  Abbrechen
                </button>
              </div>
            )}

            {filter !== "ALL" &&
              (!stackDialogOpen ? (
                <button onClick={() => setStackDialogOpen(true)} className="hud-btn hud-btn-outline">
                  + Stack
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    value={newStackTitle}
                    onChange={(e) => setNewStackTitle(e.target.value)}
                    placeholder="Stack-Titel"
                    className="hud-input"
                  />
                  <button onClick={addStack} className="hud-btn hud-btn-primary">
                    Speichern
                  </button>
                  <button
                    onClick={() => {
                      setStackDialogOpen(false);
                      setNewStackTitle("");
                    }}
                    className="hud-btn hud-btn-outline"
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
                className={`hud-btn ${selectedStackForNew === null ? "hud-btn-primary" : "hud-btn-outline"} min-w-[36px]`}
                title="Ohne Stack"
                aria-label="Kein Stack"
              >
                —
              </button>
              {loadingStacksForNew ? (
                <span className="text-cyan-300/40 text-xs">Lade Stacks…</span>
              ) : stacksForNew.length === 0 ? (
                <span className="text-cyan-300/40 text-xs">Keine Stacks – oben „+ Stack“ nutzen.</span>
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
            {(["green", "yellow", "red"] as const).map((tone) => (
              <button
                key={tone}
                onClick={() => setColor(tone)}
                aria-label={`${tone} wählen`}
                className={circleClass(color === tone, tone)}
                style={circleStyle(color === tone, tone)}
              />
            ))}
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

      <HudFooter />
      <HudGlobalStyles />
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

  if (loadingNotes || loadingStacks) return <div className="text-cyan-300/40 text-sm">Lade…</div>;

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
                className="relative z-10 text-left flex-1 truncate"
                title={col.title}
                onClick={() => isDeletable && onToggleStackHeader(col.id)}
              >
                {col.title}
              </button>
              <div className="relative z-10 flex items-center gap-2 shrink-0">
                <span className="text-[10px] text-cyan-300/50 tabular-nums">{list.length}</span>
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
              <div className="text-cyan-300/25 text-xs px-1 py-2">— Keine Notizen. —</div>
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
  if (loading) return <div className="text-cyan-300/40 text-sm">Lade Notizen…</div>;
  if (notes.length === 0) return <div className="text-cyan-300/30 text-sm">— Noch keine Notizen gespeichert. —</div>;

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
  const tone = TONE_COLORS[note.color];

  return (
    <div className={noteCardClass()} style={{ borderColor: `${tone}55` }}>
      {/* farbiger Statusstreifen links, ersetzt die frueheren Pastell-Flaechen */}
      <span
        className="absolute left-0 top-3 bottom-3 w-1 rounded-full"
        style={{ background: tone, boxShadow: `0 0 8px ${tone}` }}
      />

      {/* Löschen */}
      <button
        onClick={() => onDelete(note.id)}
        className="absolute top-2 right-2 z-20 text-cyan-300/40 hover:text-rose-300 transition"
        aria-label="Notiz löschen"
      >
        ✖
      </button>

      <div className="relative z-10 pl-3 min-w-0">
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
            className="cursor-pointer whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-cyan-50/90 leading-relaxed pr-5"
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
            className="text-[10px] uppercase tracking-wider text-cyan-200/70 rounded px-2 py-0.5 border border-cyan-400/25 bg-cyan-400/5 hover:border-cyan-400/60 transition"
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
                className="px-2 py-1 rounded text-[10px] uppercase tracking-wider border border-cyan-400/25 text-cyan-200/60 hover:border-cyan-400/60 transition"
              >
                (Keine)
              </button>
              {categories.map((c) => (
                <button
                  key={c.id}
                  onClick={() => onChangeCategory(note.id, c.id)}
                  className={`px-2 py-1 rounded text-[10px] uppercase tracking-wider border transition ${
                    note.categoryId === c.id
                      ? "border-cyan-400 text-cyan-100 bg-cyan-400/20"
                      : "border-cyan-400/25 text-cyan-200/60 hover:border-cyan-400/60"
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
              className={`text-[10px] uppercase tracking-wider rounded px-2 py-0.5 border transition ${
                note.stackId
                  ? "text-cyan-200/70 border-cyan-400/25 bg-cyan-400/5 hover:border-cyan-400/60"
                  : "text-transparent border-cyan-400/15 min-w-[24px] hover:border-cyan-400/40"
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
                  className="px-2 py-1 rounded text-[10px] uppercase tracking-wider border border-cyan-400/25 text-cyan-200/60 hover:border-cyan-400/60 transition"
                >
                  (Kein Stack)
                </button>
                {stacksInScope.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => onChangeStack(note.id, s.id)}
                    className={`px-2 py-1 rounded text-[10px] uppercase tracking-wider border transition ${
                      note.stackId === s.id
                        ? "border-cyan-400 text-cyan-100 bg-cyan-400/20"
                        : "border-cyan-400/25 text-cyan-200/60 hover:border-cyan-400/60"
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
            style={circleStyle(true, note.color)}
            aria-expanded={isColorOpen}
            aria-label="Farbe öffnen/schließen"
            title="Farbe ändern"
          />
          {isColorOpen && (
            <div className="mt-2 flex items-center gap-3">
              {(["green", "yellow", "red"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => onChangeColor(note.id, t)}
                  aria-label={`${t} setzen`}
                  className={circleClass(note.color === t, t)}
                  style={circleStyle(note.color === t, t)}
                  title={t}
                />
              ))}
            </div>
          )}
        </div>
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
        className="hud-input w-full text-base resize-none"
        placeholder="Notiz bearbeiten…"
      />
      <div className="flex items-center gap-2">
        <button onClick={() => onSave(val)} className="hud-btn hud-btn-primary">
          Speichern
        </button>
        <button onClick={onCancel} className="hud-btn hud-btn-outline">
          Abbrechen
        </button>
      </div>
    </div>
  );
}
