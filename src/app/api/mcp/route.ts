// Remote-MCP-Server fuer den cbrain-Vault. Wird als Connector in Claude.ai/Claude
// Desktop eingebunden. Jede Anfrage braucht den Bearer-Token aus CBRAIN_MCP_TOKEN,
// sonst kommt niemand an die Daten - auch kein anderer OSB-Account.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { listEntries, readEntry, searchEntries, writeEntry } from "@/lib/cbrainStore";
import { verifyTokenScope, type TokenScope } from "@/lib/oauthStore";

export const runtime = "nodejs";

// Zwei gueltige Wege rein: der feste CBRAIN_MCP_TOKEN (fuer eigene Skripte/Tests,
// immer Schreibrecht) oder ein per OAuth-Flow ausgestellter Token mit gespeichertem Scope.
async function resolveScope(req: Request): Promise<TokenScope | null> {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) return null;
  const token = match[1];

  const staticToken = process.env.CBRAIN_MCP_TOKEN;
  if (staticToken && token === staticToken) return "readwrite";

  const origin = new URL(req.url).origin;
  return verifyTokenScope(token, `${origin}/api/mcp`);
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

function buildServer(scope: TokenScope): McpServer {
  const server = new McpServer({ name: "cbrain", version: "0.1.0" });

  server.registerTool(
    "list_entries",
    {
      title: "cbrain-Einträge auflisten",
      description:
        "Listet cbrain-Vault-Einträge ohne den vollen Inhalt (nur Metadaten: folder, slug, type, summary, " +
        "status, tags, dueDate). Optional nach folder (People/Projects/Decisions/Knowledge/Companies), " +
        "type, status oder tag filtern. tag findet Einträge ordnerübergreifend (z.B. alle mit tag " +
        "'nadine', egal ob People/Knowledge/Reminders). dueDate ist bei Reminders gesetzt (YYYY-MM-DD), " +
        "direkt in den Metadaten enthalten, kein read_entry pro Eintrag nötig um Fristen zu prüfen.",
      inputSchema: {
        folder: z.string().optional(),
        type: z.string().optional(),
        status: z.string().optional(),
        tag: z.string().optional(),
      },
    },
    async ({ folder, type, status, tag }) => {
      const entries = await listEntries({ folder, type, status, tag });
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

  if (scope === "readwrite") {
    server.registerTool(
      "write_entry",
      {
        title: "cbrain-Eintrag anlegen oder aendern",
        description:
          "Legt einen cbrain-Eintrag an oder aendert ihn (merge, bestehende Felder bleiben erhalten wenn " +
          "nicht angegeben, tags ersetzt das ganze Array wenn mitgegeben). docId im Format '<folder>__<slug>'. " +
          "Beim Neuanlegen folder, slug, type, summary und content mitgeben. updatedAt wird automatisch gesetzt. " +
          "tags: kurze Stichworte fuer Themen/Personen/Projekte, die ueber mehrere Ordner hinweg zusammengehoeren " +
          "(z.B. ['nadine', 'beziehung']), damit list_entries sie ordnerübergreifend findet. dueDate (YYYY-MM-DD): " +
          "bei Eintraegen mit konkretem Ablaufdatum (v.a. Reminders) als echtes Feld setzen, nicht nur im Fliesstext, " +
          "damit list_entries Fristen liefert ohne jeden Eintrag einzeln lesen zu muessen.",
        inputSchema: {
          docId: z.string(),
          folder: z.string().optional(),
          slug: z.string().optional(),
          type: z.string().optional(),
          summary: z.string().optional(),
          status: z.string().optional(),
          tags: z.array(z.string()).optional(),
          dueDate: z.string().optional(),
          content: z.string().optional(),
        },
      },
      async ({ docId, folder, slug, type, summary, status, tags, dueDate, content }) => {
        await writeEntry({ docId, folder, slug, type, summary, status, tags, dueDate, content });
        return { content: [{ type: "text", text: `Gespeichert: ${docId}` }] };
      }
    );
  }

  return server;
}

async function handle(req: Request): Promise<Response> {
  const scope = await resolveScope(req);
  if (!scope) {
    return unauthorizedResponse(req);
  }

  const server = buildServer(scope);
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
