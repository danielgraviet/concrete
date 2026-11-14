export function isOriginAllowed(origin: string | null, allowed: string[]): boolean {
  if (!origin) return false;
  return allowed.includes("*") || allowed.includes(origin);
}

export function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  if (!origin || !isOriginAllowed(origin, allowed)) return { Vary: "Origin" };
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Expose-Headers": "content-type",
    Vary: "Origin",
  };
}

export function preflight(req: Request, allowed: string[]): Response {
  const origin = req.headers.get("origin");
  if (!isOriginAllowed(origin, allowed)) {
    return new Response(null, { status: 403, headers: { Vary: "Origin" } });
  }
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(origin, allowed),
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, content-type",
      "Access-Control-Max-Age": "86400",
    },
  });
}
