export type Cors = Record<string, string>;

export function json(status: number, body: unknown, cors: Cors): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...cors },
  });
}
