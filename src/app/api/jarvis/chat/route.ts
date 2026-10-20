// Aurora-Chat (Jarvis, Version 1: Text). Nur fuer den Besitzer (requireOwner).
// Ablauf: Verlauf vom Client -> System-Prompt aus cbrain (Agent-Master + Persona + Profil)
// -> Claude mit lesenden cbrain-Werkzeugen -> Antworttext plus Token-/Kostenangabe.
// Jeder Aufruf wird in Firestore (jarvisUsage, nur Server) protokolliert, damit wir mit echten
// Zahlen ueber Modellwahl entscheiden koennen.

import Anthropic from "@anthropic-ai/sdk";
import { requireOwner } from "@/lib/jarvisAuth";
import { readEntry } from "@/lib/cbrainStore";
import { adminDb } from "@/lib/firebaseAdmin";
import { JARVIS_TOOLS, runJarvisTool } from "@/lib/jarvisTools";

export const runtime = "nodejs";
export const maxDuration = 60;

type Mode = "normal" | "deep";

// $ pro 1 Mio. Tokens (Anthropic-Preisliste, Stand 2026-10-06). Cache-Schreiben 5 Min = 1.25x Input.
const MODELS: Record<Mode, { id: string; input: number; output: number; cacheRead: number; effort: "medium" | "high" }> = {
  normal: { id: "claude-sonnet-5-5", input: 2, output: 10, cacheRead: 0.2, effort: "medium" },
  deep: { id: "claude-opus-5-5", input: 4, output: 20, cacheRead: 0.2, effort: "high" },
};

const MAX_MESSAGES = 40;
const MAX_TOTAL_CHARS = 60000;
const MAX_TOOL_ROUNDS = 6;
const MAX_TOKENS = 4096;

const BASE_INSTRUCTIONS = `Du bist Aurora, Timons persoenliche KI-Assistentin im Projekt Jarvis.
Antworte auf Hochdeutsch, kurz und direkt, ohne Em-Dashes. Du hast lesenden Zugriff auf Timons cbrain
(Werkzeuge list_entries, read_entry, search_entries). Schreiben in cbrain kannst du noch nicht: wenn Timon
etwas ablegen will, sag ihm das und formuliere den Eintrag als Vorschlag. Raten statt nachschlagen ist
unerwuenscht: bei Fragen zu Timons Leben, Projekten, Personen oder Entscheidungen erst im cbrain nachsehen.
Du hast ausserdem get_weather. Was sich mit einem Werkzeug klaeren laesst (Wetter, cbrain), klaerst du selbst,
bevor du antwortest. Die folgenden Abschnitte sind deine Grundlagen aus dem cbrain. Bei Antwortlaenge und
Format hat die Aurora-Persona Vorrang vor dem Agent-Master: kurz, im Gespraechston, keine Listen. Wo etwas
als noch offen markiert ist, erfinde nichts.`;

const FOUNDATION_DOCS: { docId: string; title: string }[] = [
  { docId: "MOCs__Agent-Master", title: "Agent-Master (Basis, gilt immer)" },
  { docId: "Knowledge__Aurora-Persona", title: "Aurora-Persona" },
  { docId: "MOCs__Profile", title: "Timons Profil" },
];

async function buildFoundation(): Promise<string> {
  const parts = await Promise.all(
    FOUNDATION_DOCS.map(async ({ docId, title }) => {
      const entry = await readEntry(docId);
      return `# ${title}\n\n${entry ? entry.content : `(Eintrag ${docId} nicht gefunden)`}`;
    })
  );
  return `${BASE_INSTRUCTIONS}\n\n${parts.join("\n\n---\n\n")}`;
}

type ChatMessage = { role: "user" | "assistant"; content: string };

function parseBody(body: unknown): { messages: ChatMessage[]; mode: Mode } | string {
  if (!body || typeof body !== "object") return "invalid_body";
  const { messages, mode } = body as { messages?: unknown; mode?: unknown };
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) return "invalid_messages";
  let total = 0;
  const clean: ChatMessage[] = [];
  for (const m of messages) {
    if (!m || typeof m !== "object") return "invalid_messages";
    const { role, content } = m as { role?: unknown; content?: unknown };
    if ((role !== "user" && role !== "assistant") || typeof content !== "string" || !content.trim()) {
      return "invalid_messages";
    }
    total += content.length;
    clean.push({ role, content });
  }
  if (total > MAX_TOTAL_CHARS || clean[0].role !== "user" || clean[clean.length - 1].role !== "user") {
    return "invalid_messages";
  }
  return { messages: clean, mode: mode === "deep" ? "deep" : "normal" };
}

export async function POST(req: Request) {
  const owner = await requireOwner(req);
  if (!owner.ok) return owner.response;

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("[jarvis] ANTHROPIC_API_KEY fehlt");
    return Response.json({ error: "jarvis_no_llm_key" }, { status: 503 });
  }

  const parsed = parseBody(await req.json().catch(() => null));
  if (typeof parsed === "string") return Response.json({ error: parsed }, { status: 400 });
  const { messages, mode } = parsed;
  const model = MODELS[mode];

  const client = new Anthropic();
  const foundation = await buildFoundation();
  const now = new Date().toLocaleString("de-CH", { timeZone: "Europe/Zurich", dateStyle: "full", timeStyle: "short" });
  // Stabiler Teil zuerst und gecacht; die Uhrzeit aendert sich staendig und kommt dahinter.
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: foundation, cache_control: { type: "ephemeral" } },
    { type: "text", text: `Aktuelles Datum und Uhrzeit (Zuerich): ${now}` },
  ];

  const convo: Anthropic.MessageParam[] = messages.map((m) => ({ role: m.role, content: m.content }));
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 };
  const started = Date.now();
  let reply = "";

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const response = await client.messages.create({
        model: model.id,
        max_tokens: MAX_TOKENS,
        system,
        tools: JARVIS_TOOLS,
        messages: convo,
        output_config: { effort: model.effort },
      });

      usage.calls++;
      usage.input += response.usage.input_tokens;
      usage.output += response.usage.output_tokens;
      usage.cacheRead += response.usage.cache_read_input_tokens ?? 0;
      usage.cacheWrite += response.usage.cache_creation_input_tokens ?? 0;

      if (response.stop_reason === "refusal") {
        reply = "Dazu kann ich nichts sagen (Sicherheitsfilter hat angeschlagen).";
        break;
      }

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();

      if (response.stop_reason !== "tool_use") {
        reply = text || "(keine Antwort)";
        if (response.stop_reason === "max_tokens") reply += "\n[abgeschnitten]";
        break;
      }
      if (round === MAX_TOOL_ROUNDS) {
        reply = text || "Zu viele Nachschlage-Schritte, bitte die Frage enger fassen.";
        break;
      }

      // Antwort samt Denkbloecken unveraendert zurueckgeben, dann die Werkzeugergebnisse anhaengen.
      convo.push({ role: "assistant", content: response.content });
      const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      const results = await Promise.all(
        toolUses.map(async (tu): Promise<Anthropic.ToolResultBlockParam> => {
          const outcome = await runJarvisTool(tu.name, tu.input);
          return { type: "tool_result", tool_use_id: tu.id, content: outcome.text, is_error: outcome.isError };
        })
      );
      convo.push({ role: "user", content: results });
    }
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      console.error(`[jarvis] Anthropic-Fehler ${err.status}:`, err.message);
      return Response.json({ error: "llm_error", status: err.status, detail: err.message.slice(0, 300) }, { status: 502 });
    }
    console.error("[jarvis] Chat-Fehler:", err);
    return Response.json({ error: "chat_failed" }, { status: 500 });
  }

  const costUsd =
    (usage.input * model.input + usage.output * model.output + usage.cacheRead * model.cacheRead + usage.cacheWrite * model.input * 1.25) /
    1_000_000;
  const record = { model: model.id, mode, ...usage, costUsd, ms: Date.now() - started };
  console.log("[jarvis] usage", JSON.stringify(record));
  try {
    await adminDb.collection("jarvisUsage").add({ ...record, at: new Date() });
  } catch (err) {
    console.error("[jarvis] Usage-Log fehlgeschlagen:", err);
  }

  return Response.json({ reply, usage: record }, { headers: { "Cache-Control": "no-store" } });
}
