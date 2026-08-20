// RFC 9728: sagt dem MCP-Client (ausgehend von /api/mcp), welcher
// Authorization-Server fuer diese Ressource zustaendig ist.

export const runtime = "nodejs";

export async function GET(req: Request) {
  const origin = new URL(req.url).origin;

  return Response.json({
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
  });
}
