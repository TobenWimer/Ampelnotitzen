// CalDAV-Zugriff auf Apple Kalender + Erinnerungen (iCloud), nur server-seitig
// nutzbar. Nutzt tsdav als CalDAV-Client und ical.js zum Parsen der ICS-Antworten.
// Siehe scripts/test-caldav.mjs fuer den urspruenglichen Verbindungstest und
// Projects/Apple-Kalender-Erinnerungen-Connector im cbrain-Vault fuer den Kontext.

import { createDAVClient } from "tsdav";
import ICAL from "ical.js";

type DAVClient = Awaited<ReturnType<typeof createDAVClient>>;

let clientPromise: Promise<DAVClient> | null = null;

function getClient(): Promise<DAVClient> {
  if (!clientPromise) {
    const username = process.env.APPLE_ID;
    const password = process.env.APPLE_APP_PASSWORD;
    if (!username || !password) {
      throw new Error("APPLE_ID oder APPLE_APP_PASSWORD fehlt in den Umgebungsvariablen");
    }
    clientPromise = createDAVClient({
      serverUrl: "https://caldav.icloud.com",
      credentials: { username, password },
      authMethod: "Basic",
      defaultAccountType: "caldav",
    });
  }
  return clientPromise;
}

export type CalendarInfo = {
  url: string;
  displayName: string;
  components: string[];
};

export type EventEntry = {
  uid: string;
  summary: string;
  start: string;
  end: string;
  location?: string;
  description?: string;
};

export type ReminderEntry = {
  uid: string;
  summary: string;
  due?: string;
  completed: boolean;
  notes?: string;
};

export async function listCalendars(): Promise<CalendarInfo[]> {
  const client = await getClient();
  const calendars = await client.fetchCalendars();
  return calendars.map((cal) => ({
    url: cal.url,
    displayName: typeof cal.displayName === "string" ? cal.displayName : cal.url,
    components: cal.components ?? [],
  }));
}

export async function listEvents(input: {
  calendarUrl: string;
  start: string;
  end: string;
}): Promise<EventEntry[]> {
  // Bei wiederkehrenden Events liefert die ICS jeweils nur den ersten Termin;
  // spaetere Wiederholungen werden aktuell nicht expandiert.
  const client = await getClient();
  const objects = await client.fetchCalendarObjects({
    calendar: { url: input.calendarUrl },
    timeRange: { start: input.start, end: input.end },
  });

  const events: EventEntry[] = [];
  for (const obj of objects) {
    if (!obj.data) continue;
    const comp = new ICAL.Component(ICAL.parse(obj.data));
    for (const vevent of comp.getAllSubcomponents("vevent")) {
      const event = new ICAL.Event(vevent);
      const start = event.startDate?.toJSDate();
      const end = event.endDate?.toJSDate();
      if (!start || !end) continue;
      events.push({
        uid: event.uid,
        summary: event.summary ?? "",
        start: start.toISOString(),
        end: end.toISOString(),
        location: event.location || undefined,
        description: event.description || undefined,
      });
    }
  }
  return events;
}

export async function createEvent(input: {
  calendarUrl: string;
  summary: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
}): Promise<{ uid: string }> {
  const client = await getClient();
  const uid = crypto.randomUUID();
  const iCalString = buildEventIcs({ uid, ...input });

  await client.createCalendarObject({
    calendar: { url: input.calendarUrl },
    iCalString,
    filename: `${uid}.ics`,
  });

  return { uid };
}

const VTODO_FILTER = [
  {
    "comp-filter": {
      _attributes: { name: "VCALENDAR" },
      "comp-filter": {
        _attributes: { name: "VTODO" },
      },
    },
  },
];

export async function listReminders(input: { calendarUrl: string }): Promise<ReminderEntry[]> {
  const client = await getClient();
  const objects = await client.fetchCalendarObjects({
    calendar: { url: input.calendarUrl },
    filters: VTODO_FILTER,
  });

  const reminders: ReminderEntry[] = [];
  for (const obj of objects) {
    if (!obj.data) continue;
    const comp = new ICAL.Component(ICAL.parse(obj.data));
    for (const vtodo of comp.getAllSubcomponents("vtodo")) {
      const due = vtodo.getFirstPropertyValue("due") as ICAL.Time | null;
      reminders.push({
        uid: vtodo.getFirstPropertyValue("uid") as string,
        summary: (vtodo.getFirstPropertyValue("summary") as string) ?? "",
        due: due ? due.toJSDate().toISOString() : undefined,
        completed: vtodo.getFirstPropertyValue("status") === "COMPLETED",
        notes: (vtodo.getFirstPropertyValue("description") as string) || undefined,
      });
    }
  }
  return reminders;
}

export async function createReminder(input: {
  calendarUrl: string;
  summary: string;
  due?: string;
  notes?: string;
}): Promise<{ uid: string }> {
  const client = await getClient();
  const uid = crypto.randomUUID();
  const iCalString = buildReminderIcs({ uid, ...input });

  await client.createCalendarObject({
    calendar: { url: input.calendarUrl },
    iCalString,
    filename: `${uid}.ics`,
  });

  return { uid };
}

function toIcsDate(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function escapeIcsText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function buildEventIcs(input: {
  uid: string;
  summary: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
}): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//OneStepBehind//Apple Connector//DE",
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `DTSTAMP:${toIcsDate(new Date().toISOString())}`,
    `DTSTART:${toIcsDate(input.start)}`,
    `DTEND:${toIcsDate(input.end)}`,
    `SUMMARY:${escapeIcsText(input.summary)}`,
  ];
  if (input.description) lines.push(`DESCRIPTION:${escapeIcsText(input.description)}`);
  if (input.location) lines.push(`LOCATION:${escapeIcsText(input.location)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n");
}

function buildReminderIcs(input: { uid: string; summary: string; due?: string; notes?: string }): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//OneStepBehind//Apple Connector//DE",
    "BEGIN:VTODO",
    `UID:${input.uid}`,
    `DTSTAMP:${toIcsDate(new Date().toISOString())}`,
    `SUMMARY:${escapeIcsText(input.summary)}`,
    "STATUS:NEEDS-ACTION",
  ];
  if (input.due) lines.push(`DUE:${toIcsDate(input.due)}`);
  if (input.notes) lines.push(`DESCRIPTION:${escapeIcsText(input.notes)}`);
  lines.push("END:VTODO", "END:VCALENDAR");
  return lines.join("\r\n");
}
