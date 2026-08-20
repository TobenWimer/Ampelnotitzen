// Remote-MCP-Server fuer den cbrain-Vault. Wird als Connector in Claude.ai/Claude
// Desktop eingebunden. Jede Anfrage braucht den Bearer-Token aus CBRAIN_MCP_TOKEN,
// sonst kommt niemand an die Daten - auch kein anderer OSB-Account.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { listEntries, readEntry, searchEntries, writeEntry } from "@/lib/cbrainStore";
import { verifyToken } from "@/lib/oauthStore";

export const runtime = "nodejs";

// Zwei gueltige Wege rein: der feste CBRAIN_MCP_TOKEN (fuer eigene Skripte/Tests)
// oder ein per OAuth-Flow ausgestellter Token (fuer den claude.ai-Connector).
async function isAuthorized(req: Request): Promise<boolean> {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) return false;
  const token = match[1];

  const staticToken = process.env.CBRAIN_MCP_TOKEN;
  if (staticToken && token === staticToken) return true;

  return verifyToken(token);
}

function unauthorizedResponse(req: Request): Response {
  const origin = new URL(req.url).origin;
  return new Response("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
    },
  });
}

function buildServer(): McpServer {
  const server = new McpServer({ name: "cbrain", version: "0.1.0" });

  server.registerTool(
    "list_entries",
    {
      title: "cbrain-Einträge auflisten",
      description:
        "Listet cbrain-Vault-Einträge ohne den vollen Inhalt (nur Metadaten: folder, slug, type, summary, status). " +
        "Optional nach folder (People/Projects/Decisions/Knowledge/Companies), type oder status filtern.",
      inputSchema: {
        folder: z.string().optional(),
        type: z.string().optional(),
        status: z.string().optional(),
      },
    },
    async ({ folder, type, status }) => {
      const entries = await listEntries({ folder, type, status });
      return { content: [{ type: "text", text: JSON.stringify(entries, null, 2) }] };
    }
  );

  server.registerTool(
    "read_entry",
    {
      title: "cbrain-Eintrag lesen",
      description:
        "Liest einen einzelnen cbrain-Eintrag komplett, inkl. Inhalt. docId hat das Format " +
        "'<folder>__<slug>', z.B. 'People__Nadine-Schurch' (siehe list_entries oder search_entries).",
      inputSchema: { docId: z.string() },
    },
    async ({ docId }) => {
      const entry = await readEntry(docId);
      if (!entry) {
        return { content: [{ type: "text", text: `Kein Eintrag mit docId "${docId}" gefunden.` }], isError: true };
      }
      return { content: [{ type: "text", text: JSON.stringify(entry, null, 2) }] };
    }
  );

  server.registerTool(
    "search_entries",
    {
      title: "cbrain-Einträge durchsuchen",
      description:
        "Volltextsuche (einfache Teilstring-Suche, gross/klein ignoriert) ueber summary und content " +
        "aller Eintraege. Liefert Metadaten wie list_entries, kein voller Inhalt.",
      inputSchema: { query: z.string() },
    },
    async ({ query }) => {
      const entries = await searchEntries(query);
      return { content: [{ type: "text", text: JSON.stringify(entries, null, 2) }] };
    }
  );

  server.registerTool(
    "write_entry",
    {
      title: "cbrain-Eintrag anlegen oder aendern",
      description:
        "Legt einen cbrain-Eintrag an oder aendert ihn (merge, bestehende Felder bleiben erhalten wenn " +
        "nicht angegeben). docId im Format '<folder>__<slug>'. Beim Neuanlegen folder, slug, type, summary " +
        "und content mitgeben. updatedAt wird automatisch gesetzt.",
      inputSchema: {
        docId: z.string(),
        folder: z.string().optional(),
        slug: z.string().optional(),
        type: z.string().optional(),
        summary: z.string().optional(),
        status: z.string().optional(),
        content: z.string().optional(),
      },
    },
    async ({ docId, folder, slug, type, summary, status, content }) => {
      await writeEntry({ docId, folder, slug, type, summary, status, content });
      return { content: [{ type: "text", text: `Gespeichert: ${docId}` }] };
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
