// Remote-MCP-Server fuer Apple Kalender + Erinnerungen (iCloud, via CalDAV).
// Eigener Connector, analog zu src/app/api/mcp/route.ts (cbrain). Jede Anfrage
// braucht den Bearer-Token aus APPLE_MCP_TOKEN.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import {
  listCalendars,
  listEvents,
  createEvent,
  listReminders,
  createReminder,
} from "@/lib/appleCalendarStore";
import { verifyToken } from "@/lib/oauthStore";

export const runtime = "nodejs";

// Zwei gueltige Wege rein: der feste APPLE_MCP_TOKEN (fuer eigene Skripte/Tests)
// oder ein per OAuth-Flow ausgestellter, auf diese Resource beschraenkter Token
// (fuer Claude Desktop/claude.ai als Connector, siehe src/lib/oauthStore.ts).
async function isAuthorized(req: Request): Promise<boolean> {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) return false;
  const token = match[1];

  const staticToken = process.env.APPLE_MCP_TOKEN;
  if (staticToken && token === staticToken) return true;

  const origin = new URL(req.url).origin;
  return verifyToken(token, `${origin}/api/apple`);
}

function unauthorizedResponse(req: Request): Response {
  const origin = new URL(req.url).origin;
  return new Response("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/api/apple"`,
    },
  });
}

function buildServer(): McpServer {
  const server = new McpServer({ name: "apple-calendar", version: "0.1.0" });

  server.registerTool(
    "list_calendars",
    {
      title: "Apple Kalender/Listen auflisten",
      description:
        "Listet alle iCloud-Kalender und Erinnerungslisten mit ihrer URL und Art " +
        "(components: VEVENT = Kalender, VTODO = Erinnerungsliste). Die url wird " +
        "fuer alle anderen Tools als calendarUrl gebraucht.",
      inputSchema: {},
    },
    async () => {
      const calendars = await listCalendars();
      return { content: [{ type: "text", text: JSON.stringify(calendars, null, 2) }] };
    }
  );

  server.registerTool(
    "list_events",
    {
      title: "Termine auflisten",
      description:
        "Listet Termine aus einem Kalender (calendarUrl, siehe list_calendars) in einem " +
        "Zeitraum. start und end als ISO-8601-Zeitstempel.",
      inputSchema: { calendarUrl: z.string(), start: z.string(), end: z.string() },
    },
    async ({ calendarUrl, start, end }) => {
      const events = await listEvents({ calendarUrl, start, end });
      return { content: [{ type: "text", text: JSON.stringify(events, null, 2) }] };
    }
  );

  server.registerTool(
    "create_event",
    {
      title: "Termin anlegen",
      description:
        "Legt einen neuen Termin in einem Kalender an (calendarUrl, siehe list_calendars). " +
        "start und end als ISO-8601-Zeitstempel.",
      inputSchema: {
        calendarUrl: z.string(),
        summary: z.string(),
        start: z.string(),
        end: z.string(),
        description: z.string().optional(),
        location: z.string().optional(),
      },
    },
    async ({ calendarUrl, summary, start, end, description, location }) => {
      const result = await createEvent({ calendarUrl, summary, start, end, description, location });
      return { content: [{ type: "text", text: `Termin angelegt: ${result.uid}` }] };
    }
  );

  server.registerTool(
    "list_reminders",
    {
      title: "Erinnerungen auflisten",
      description:
        "Listet Erinnerungen aus einer Erinnerungsliste (calendarUrl mit components VTODO, " +
        "siehe list_calendars).",
      inputSchema: { calendarUrl: z.string() },
    },
    async ({ calendarUrl }) => {
      const reminders = await listReminders({ calendarUrl });
      return { content: [{ type: "text", text: JSON.stringify(reminders, null, 2) }] };
    }
  );

  server.registerTool(
    "create_reminder",
    {
      title: "Erinnerung anlegen",
      description:
        "Legt eine neue Erinnerung in einer Erinnerungsliste an (calendarUrl mit components " +
        "VTODO, siehe list_calendars). due optional als ISO-8601-Zeitstempel, sonst ohne Faelligkeitsdatum.",
      inputSchema: {
        calendarUrl: z.string(),
        summary: z.string(),
        due: z.string().optional(),
        notes: z.string().optional(),
      },
    },
    async ({ calendarUrl, summary, due, notes }) => {
      const result = await createReminder({ calendarUrl, summary, due, notes });
      return { content: [{ type: "text", text: `Erinnerung angelegt: ${result.uid}` }] };
    }
  );

  return server;
}

async function handle(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return unauthorizedResponse(req);
  }

  const server = buildServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
