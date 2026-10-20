// Lesende Werkzeuge fuer Aurora (Jarvis): cbrain, Wetter, Kalender. Bewusst NUR lesen: kein write_entry,
// keine Kalender-Aenderungen. (Die Websuche ist ein Anthropic-Server-Werkzeug und steht in der Chat-Route.)
// Wird von der Chat-Route genutzt und spaeter vom Telefon-Tool-Endpunkt wiederverwendet.
// Aufrufer muessen vorher requireOwner bestanden haben.

import type Anthropic from "@anthropic-ai/sdk";
import { listEntries, readEntry, searchEntries } from "./cbrainStore";
import { listCalendars, listEvents } from "./appleCalendarStore";

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

JARVIS_TOOLS.push({
  name: "get_weather",
  description:
    "Aktuelles Wetter und Vorhersage fuer die naechsten 8 Tage, also auch das kommende Wochenende " +
    "(Temperatur, Regen, Wind, Hoehe des Ortes). Ab Tag 5 wird die Vorhersage unsicherer, dann als Tendenz nennen. " +
    "place ist ein Ortsname, z.B. 'Zug' oder 'Sustenpass'. Nennt Timon keinen Ort, den Wohnort aus seinem Profil nehmen.",
  input_schema: {
    type: "object",
    properties: { place: { type: "string" } },
    required: ["place"],
  },
});

JARVIS_TOOLS.push({
  name: "get_calendar",
  description:
    "Timons Termine aus dem Apple-Kalender zwischen start und end (beide inklusive, Format YYYY-MM-DD, hoechstens 31 Tage). " +
    "Nur lesen. Liefert Titel, Beginn, Ende, Ort und Kalendername. Wiederkehrende Termine erscheinen nur beim ersten Auftreten. " +
    "Nutze es, wenn es um Zeit, Plaene oder Verfuegbarkeit geht (z.B. 'Was habe ich am Wochenende vor?').",
  input_schema: {
    type: "object",
    properties: { start: { type: "string" }, end: { type: "string" } },
    required: ["start", "end"],
  },
});

const ZURICH = "Europe/Zurich";
const dayOf = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: ZURICH }); // YYYY-MM-DD
const stampOf = (d: Date) =>
  d.toLocaleString("de-CH", { timeZone: ZURICH, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

async function getCalendar(start: string, end: string): Promise<unknown> {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(start) || !datePattern.test(end)) return { error: "start und end muessen YYYY-MM-DD sein." };
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  if (!(endMs >= startMs) || endMs - startMs > 31 * 86400000) return { error: "Zeitraum ungueltig oder laenger als 31 Tage." };

  // Abfrage etwas weiter fassen (Zeitzonenraender), danach nach Zuercher Kalendertag filtern.
  const rangeStart = new Date(startMs - 86400000).toISOString();
  const rangeEnd = new Date(endMs + 2 * 86400000).toISOString();
  const calendars = (await listCalendars()).filter((c) => c.components.includes("VEVENT"));
  const perCalendar = await Promise.all(
    calendars.map(async (cal) => {
      const events = await listEvents({ calendarUrl: cal.url, start: rangeStart, end: rangeEnd });
      return events.map((e) => ({ cal: cal.displayName, e }));
    })
  );
  const items = perCalendar
    .flat()
    .filter(({ e }) => {
      const day = dayOf(new Date(e.start));
      return day >= start && day <= end;
    })
    .sort((a, b) => a.e.start.localeCompare(b.e.start))
    .map(({ cal, e }) => ({
      titel: e.summary,
      von: stampOf(new Date(e.start)),
      bis: stampOf(new Date(e.end)),
      ort: e.location,
      kalender: cal,
    }));
  return { zeitraum: `${start} bis ${end}`, anzahl: items.length, termine: items };
}

// WMO-Wettercodes (Open-Meteo) in kurzen deutschen Text
const WEATHER_CODES: Record<number, string> = {
  0: "klar", 1: "meist klar", 2: "teils bewoelkt", 3: "bedeckt", 45: "Nebel", 48: "Reifnebel",
  51: "leichter Niesel", 53: "Niesel", 55: "starker Niesel", 56: "gefrierender Niesel", 57: "starker gefrierender Niesel",
  61: "leichter Regen", 63: "Regen", 65: "starker Regen", 66: "gefrierender Regen", 67: "starker gefrierender Regen",
  71: "leichter Schneefall", 73: "Schneefall", 75: "starker Schneefall", 77: "Schneekoerner",
  80: "leichte Schauer", 81: "Schauer", 82: "heftige Schauer", 85: "leichte Schneeschauer", 86: "Schneeschauer",
  95: "Gewitter", 96: "Gewitter mit Hagel", 99: "starkes Gewitter mit Hagel",
};
const describeCode = (code: number) => WEATHER_CODES[code] ?? `Code ${code}`;

// Antworten von Open-Meteo sind dynamisch geformt, deshalb bewusst lose typisiert.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getWeather(place: string): Promise<unknown> {
  const geo = await fetchJson(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=de&format=json`
  );
  const hit = geo.results?.[0];
  if (!hit) return { error: `Ort "${place}" nicht gefunden.` };
  const params = new URLSearchParams({
    latitude: String(hit.latitude),
    longitude: String(hit.longitude),
    current: "temperature_2m,apparent_temperature,precipitation,wind_speed_10m,weather_code",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max",
    timezone: "Europe/Zurich",
    forecast_days: "8",
  });
  const data = await fetchJson(`https://api.open-meteo.com/v1/forecast?${params}`);
  const d = data.daily;
  return {
    ort: `${hit.name}${hit.admin1 ? `, ${hit.admin1}` : ""}`,
    hoeheM: Math.round(data.elevation ?? hit.elevation ?? 0),
    jetzt: {
      wetter: describeCode(data.current.weather_code),
      tempC: data.current.temperature_2m,
      gefuehltC: data.current.apparent_temperature,
      regenMm: data.current.precipitation,
      windKmh: data.current.wind_speed_10m,
    },
    tage: d.time.map((date: string, i: number) => ({
      datum: date,
      wetter: describeCode(d.weather_code[i]),
      minC: d.temperature_2m_min[i],
      maxC: d.temperature_2m_max[i],
      regenMm: d.precipitation_sum[i],
      regenWahrscheinlichkeitProzent: d.precipitation_probability_max[i],
      windMaxKmh: d.wind_speed_10m_max[i],
    })),
  };
}

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
    } else if (name === "get_weather") {
      const place = asString(args.place);
      if (!place) return { text: "place fehlt.", isError: true };
      result = await getWeather(place);
    } else if (name === "get_calendar") {
      const start = asString(args.start);
      const end = asString(args.end);
      if (!start || !end) return { text: "start und end fehlen.", isError: true };
      result = await getCalendar(start, end);
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
    return { text: `Werkzeugfehler bei ${name}.`, isError: true };
  }
}
