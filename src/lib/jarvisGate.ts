// Laengen-Gate fuer Aurora: der Code prueft die fertige Antwort und laesst sie bei Bedarf von einem
// guenstigen Modell kuerzen. Die Persona-Regel "maximal zwei Saetze" allein haelt das Hauptmodell nicht
// zuverlaessig ein, deshalb wird sie hier per Code erzwungen. Fail-open: bei jedem Fehler bleibt die
// Originalantwort, das Gate darf nie eine Antwort verhindern.

import Anthropic from "@anthropic-ai/sdk";

const GATE_MODEL = "claude-haiku-5-5";
const PRICE_INPUT = 0.1; // $ pro 1 Mio. Tokens
const PRICE_OUTPUT = 0.5;

// Ab dieser Satzzahl greift das Gate. Die Persona erlaubt 2 Saetze, bei Sachfragen bis 4; ob die Frage eine
// Sachfrage ist, entscheidet das Kuerzer-Modell selbst und gibt passende Antworten unveraendert zurueck.
export const GATE_THRESHOLD = 2;

const GATE_SYSTEM = `Du bist der Kuerzer fuer Aurora, Timons KI-Assistentin (spitz, trocken, sarkastisch-nerdig, leichter Schweizer Einschlag).
Du bekommst Timons Frage und Auroras Antwort. Gib die Antwort so zurueck, dass sie hoechstens 2 Saetze hat. Hat die Frage klar Fakten
oder eine Erklaerung verlangt (z.B. "Was steht als Naechstes an?"), sind hoechstens 4 Saetze erlaubt. Ist die Antwort schon kurz genug,
gib sie unveraendert zurueck.
Beim Kuerzen: behalte den wichtigsten Fakt, das Urteil und den spitzen Ton. Streiche Aufzaehlungen, Zahlenbloecke, ungefragte
Ratschlaege, Absicherungen und Nebenbemerkungen. Erfinde nichts Neues, uebernimm keine Fakten, die nicht in der Antwort stehen.
Hochdeutsch, keine Em-Dashes. Gib nur die fertige Antwort aus, ohne Kommentar oder Anfuehrungszeichen.`;

// Zaehlt Saetze grob: Satzende (. ! ?) gefolgt von Leerraum und Grossbuchstabe oder Textende.
// Dezimalzahlen ("13.5") und Abkuerzungen mit Folgebuchstaben klein ("z.B. am") zaehlen nicht mit.
export function countSentences(text: string): number {
  const matches = text.match(/[.!?]+(?=\s+["„«(]?[A-ZÄÖÜ]|\s*$)/g);
  return Math.max(1, matches ? matches.length : 1);
}

export type GateResult = {
  text: string;
  applied: boolean;
  before: number;
  after: number;
  costUsd: number;
};

export async function shortenIfNeeded(client: Anthropic, question: string, reply: string): Promise<GateResult> {
  const before = countSentences(reply);
  const unchanged: GateResult = { text: reply, applied: false, before, after: before, costUsd: 0 };
  // Code und Tabellen/Listen nicht anfassen, das waere zerstoert.
  if (before <= GATE_THRESHOLD || reply.includes("```")) return unchanged;

  try {
    const response = await client.messages.create({
      model: GATE_MODEL,
      max_tokens: 600,
      system: GATE_SYSTEM,
      messages: [{ role: "user", content: `Timons Frage:\n${question}\n\nAuroras Antwort:\n${reply}` }],
      thinking: { type: "disabled" },
      output_config: { effort: "low" },
    });
    const costUsd = (response.usage.input_tokens * PRICE_INPUT + response.usage.output_tokens * PRICE_OUTPUT) / 1_000_000;
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (response.stop_reason !== "end_turn" || !text) return { ...unchanged, costUsd };
    const after = countSentences(text);
    // Nur uebernehmen, wenn es wirklich kuerzer geworden ist.
    if (after >= before || text.length >= reply.length) return { ...unchanged, costUsd };
    return { text, applied: true, before, after, costUsd };
  } catch (err) {
    console.error("[jarvis] Laengen-Gate fehlgeschlagen, Original bleibt:", err);
    return unchanged;
  }
}
