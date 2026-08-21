// RFC 9728, resource-spezifisch (Pfad-Suffix): sagt dem MCP-Client, der sich mit
// /api/apple verbinden will, welcher Authorization-Server zustaendig ist. Analog
// src/app/.well-known/oauth-protected-resource/route.ts (dort fest fuer /api/mcp).

export const runtime = "nodejs";

export async function GET(req: Request) {
  const origin = new URL(req.url).origin;

  return Response.json({
    resource: `${origin}/api/apple`,
    authorization_servers: [origin],
  });
}
