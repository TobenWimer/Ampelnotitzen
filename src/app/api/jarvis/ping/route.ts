// Mini-Endpunkt, der nur beweist, dass die Besitzer-Pruefung greift. Dient als Vorlage
// fuer jede weitere Jarvis-Route: erst requireOwner, dann erst Arbeit.

import { requireOwner } from "@/lib/jarvisAuth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const owner = await requireOwner(req);
  if (!owner.ok) return owner.response;
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
