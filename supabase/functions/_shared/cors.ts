// CORS for the admin functions: only the console's origins (Pages, its previews, local dev).
// CORS is not auth: every function still checks the admin token.
const ALLOWED = /^(https:\/\/([a-z0-9-]+\.)?unimatch-1va\.pages\.dev|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;

export function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    vary: "Origin",
  };
  if (origin && ALLOWED.test(origin)) headers["access-control-allow-origin"] = origin;
  return headers;
}

// Answers preflights and adds the CORS headers to every response of `handle`.
export function withCors(handle: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    const cors = corsHeaders(req.headers.get("origin"));
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const res = await handle(req);
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  };
}
