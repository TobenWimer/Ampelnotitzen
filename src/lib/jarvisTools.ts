// Lesende cbrain-Werkzeuge fuer Aurora (Jarvis). Bewusst NUR lesen: kein write_entry.
// Wird von der Chat-Route genutzt und spaeter vom Telefon-Tool-Endpunkt wiederverwendet.
// Aufrufer muessen vorher requireOwner bestanden haben.

import type Anthropic from "@anthropic-ai/sdk";
import { listEntries, readEntry, searchEntries } from "./cbrainStore";

const MAX_RESULT_CHARS = 40000;

export const JARVIS_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_entries",
    description:
      "Listet cbrain-Eintraege ohne vollen Inhalt (folder, slug, type, summary, status, tags, dueDate). " +
      "Optional nach folder (People/Projects/Decisions/Knowledge/Companies/Meetings/Daily/Reminders/MOCs), " +
      "type, status oder tag filtern. tag findet Eintraege ordneruebergreifend.",
    input_schema: {
      type: "object",
      properties: {
        folder: { type: "string" },
        type: { type: "string" },
        status: { type: "string" },
        tag: { type: "string" },
      },
    },
  },
  {
    name: "read_entry",
    description:
      "Liest einen cbrain-Eintrag komplett. docId hat das Format '<folder>__<slug>', z.B. 'People__Nadine-Schurch'.",
    input_schema: {
      type: "object",
      properties: { docId: { type: "string" } },
      required: ["docId"],
    },
  },
  {
    name: "search_entries",
    description:
      "Einfache Teilstring-Suche (ohne Gross-/Kleinschreibung) in summary und content aller Eintraege. " +
      "Liefert nur Metadaten, den Inhalt danach mit read_entry holen. Bei Misserfolg Synonyme probieren.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
];

export type ToolOutcome = { text: string; isError: boolean };

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function runJarvisTool(name: string, input: unknown): Promise<ToolOutcome> {
  const args = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  try {
    let result: unknown;
    if (name === "list_entries") {
      result = await listEntries({
        folder: asString(args.folder),
        type: asString(args.type),
        status: asString(args.status),
        tag: asString(args.tag),
      });
    } else if (name === "read_entry") {
      const docId = asString(args.docId);
      if (!docId) return { text: "docId fehlt.", isError: true };
      result = await readEntry(docId);
      if (!result) return { text: `Kein Eintrag mit docId "${docId}" gefunden.`, isError: true };
    } else if (name === "search_entries") {
      const query = asString(args.query);
      if (!query) return { text: "query fehlt.", isError: true };
      result = await searchEntries(query);
    } else {
      return { text: `Unbekanntes Werkzeug "${name}".`, isError: true };
    }
    const text = JSON.stringify(result);
    return {
      text: text.length > MAX_RESULT_CHARS ? text.slice(0, MAX_RESULT_CHARS) + "\n[gekuerzt]" : text,
      isError: false,
    };
  } catch (err) {
    console.error(`[jarvis] Werkzeug ${name} fehlgeschlagen:`, err);
    return { text: "Werkzeugfehler beim Lesen aus cbrain.", isError: true };
  }
}
