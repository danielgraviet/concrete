# Concrete AI proxy

A Cloudflare Worker that sits between the Concrete web app and the Claude API. The browser can't hold an Anthropic API key, so this Worker does four things:

1. Holds `ANTHROPIC_API_KEY` as a Worker secret.
2. Checks that each caller is a signed-in Firebase user. It verifies the Firebase ID token with `jose` against Google's public keys (RS256, `iss`/`aud` = your project, `exp`/`iat`/`sub`).
3. Enforces a per-user monthly request quota stored in Cloudflare D1. It reserves one unit before calling the model and refunds it if the upstream call fails.
4. Forwards the request to Claude. The model, effort and token cap are fixed on the server, and prompt caching is turned on.

It runs on the Workers **free plan**, so no card is needed. The spending backstop is your Anthropic prepaid balance (see [Spend cap](#spend-cap-read-this)).

## HTTP API

Every `/v1/*` endpoint requires `Authorization: Bearer <Firebase ID token>`. Without a valid token the response is `401 {"error":"unauthorized"}`. CORS is allowed for the origins listed in `ALLOWED_ORIGINS`. The headers `authorization, content-type` are allowed, and `OPTIONS` preflight is handled (403 for unknown origins).

### `POST /v1/chat`

```jsonc
{
  "messages": [{ "role": "system" | "user" | "assistant", "content": "..." }],
  "max_tokens": 4000,     // optional, clamped to MAX_TOKENS_CAP
  "operation": "quiz",    // optional, logged
  "stream": false,        // optional
  "model": "...",         // optional, logged and IGNORED (server uses MODEL)
  "metadata": {}          // optional, ignored
}
```

- `system` messages are joined in order (with blank lines) into the top-level system prompt.
- The other messages are merged when consecutive turns have the same role. Empty messages are dropped. The result must start **and end** with a `user` turn, because assistant prefill isn't supported. Otherwise the response is `400 {"error":"bad_request","detail":"..."}`.
- Bodies over 400 KB get `413 {"error":"payload_too_large"}`.

**Non-stream 200**

```json
{ "content": "...", "model": "claude-haiku-5-5", "usage": { "...": "Anthropic usage object" },
  "requestId": "req_...", "quota": { "used": 3, "limit": 100, "resetsAt": "2026-12-01T00:00:00.000Z" } }
```

**Stream (`"stream": true`)**: `content-type: text/event-stream`. Each event is one `data: <json>\n\n` line:

```
data: {"type":"delta","text":"..."}            (text only; thinking is never forwarded)
data: {"type":"done","content":"...","model":"...","usage":{...},"requestId":"...","quota":{...}}
data: {"type":"error","code":"upstream_error","message":"..."}   (then the stream closes)
```

If the upstream fails before the first event arrives, the response is a normal JSON HTTP error, not a 200 stream (see below).

**Errors**

| Status | Body `error` | When |
|---|---|---|
| 400 | `bad_request` (+ `detail`) | invalid JSON or invalid message list |
| 401 | `unauthorized` | missing or invalid Firebase token |
| 413 | `payload_too_large` | body > 400 KB |
| 422 | `refused` | model returned `stop_reason: "refusal"` |
| 429 | `quota_exceeded` (+ `used`, `limit`, `resetsAt`) | monthly quota used up (checked before calling the model) |
| 429 | `rate_limited` | per-user burst limit (5 concurrent / 10 per minute, best effort) |
| 502 | `upstream_error` | any other Anthropic API error |
| 503 | `upstream_rate_limited` | Anthropic returned 429 |
| 500 | `internal_error` | bug |

Error bodies also carry a short generic `message`. Upstream bodies and headers are never forwarded.

### `GET /v1/quota`

`{ "used": 3, "limit": 100, "resetsAt": "2026-12-01T00:00:00.000Z" }`. For allowlisted uids, `limit` is `-1`, meaning unlimited.

### `GET /health`

`{ "ok": true }`. Needs no auth.

## Quota semantics

- One `/v1/chat` call is one unit, counted per UTC calendar month (`period = 'YYYY-MM'`). The quota resets at 00:00 UTC on the 1st of the month.
- A unit is reserved atomically before the model call (`INSERT … ON CONFLICT DO UPDATE … WHERE used < limit RETURNING used`).
- The unit is refunded when the Anthropic call throws, either before or during streaming. It is **not** refunded on a refusal or when the client disconnects mid-stream, because those tokens were already billed.
- Uids in `QUOTA_ALLOWLIST_UIDS` are still counted but never blocked.
- The burst limiter keeps its state in each isolate's memory, so it is not global across Cloudflare's edge. It only blunts runaway client loops. The D1 quota is the real limit.

## Configuration

| Name | Kind | Default | Notes |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | **secret** | – | `wrangler secret put ANTHROPIC_API_KEY` |
| `FIREBASE_PROJECT_ID` | var | – | Required. Tokens from other projects are rejected. |
| `ALLOWED_ORIGINS` | var | (none) | Comma-separated, e.g. `https://concrete.example.com,http://localhost:5173` |
| `MODEL` | var | `claude-haiku-5-5` | |
| `EFFORT` | var | `low` | `low`/`medium`/`high`/`xhigh`/`max`, sent as `output_config.effort` |
| `MAX_TOKENS_CAP` | var | `8000` | |
| `QUOTA_MONTHLY` | var | `100` | Requests per user per month |
| `QUOTA_ALLOWLIST_UIDS` | var | (empty) | Comma-separated uids exempt from the quota |
| `DB` | D1 binding | – | Database `concrete-ai-quota` |

The proxy never sends `temperature`/`top_p`/`top_k`, `budget_tokens`, or assistant prefill. It sends top-level `cache_control: {type: "ephemeral"}` so that repeated note context is billed at the cache-read rate.

## Local development

```bash
cd server/ai-proxy
npm install
npm test                 # vitest, no network
npx tsc --noEmit         # typecheck

# Optional: run the Worker locally against a local D1
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .dev.vars        # gitignored
npm run db:migrate:local
# Set FIREBASE_PROJECT_ID in wrangler.toml (or add it to .dev.vars), then:
npm run dev              # http://localhost:8787
curl localhost:8787/health
```

To call `/v1/chat` locally, you need a real Firebase ID token from the web app. In the browser console, run `await firebase.auth().currentUser.getIdToken()` or the modular `getIdToken(auth.currentUser)`.

## Deploy checklist (owner)

Run these from `server/ai-proxy/`.

1. **Log in to Cloudflare:** `npx wrangler login`
2. **Create the D1 database:** `npx wrangler d1 create concrete-ai-quota`. Paste the printed `database_id` into `wrangler.toml` under `[[d1_databases]]`.
3. **Apply the migration to the remote DB:** `npm run db:migrate:remote` (runs `wrangler d1 migrations apply concrete-ai-quota --remote`)
4. **Set the vars** in `wrangler.toml` `[vars]`:
   - `FIREBASE_PROJECT_ID` = your Firebase project id
   - `ALLOWED_ORIGINS` = your production web origin(s), comma-separated
   - `QUOTA_ALLOWLIST_UIDS` = your own Firebase uid (optional)
   - review `MODEL`, `EFFORT`, `MAX_TOKENS_CAP`, `QUOTA_MONTHLY`
5. **Set the API key secret:** `npx wrangler secret put ANTHROPIC_API_KEY`. Use a key from a dedicated Anthropic workspace if you can, so its spend is easy to see.
6. **Deploy:** `npx wrangler deploy`. Note the `https://concrete-ai-proxy.<subdomain>.workers.dev` URL and point the web app at it.
7. **Smoke test:** `curl https://<worker-url>/health` should return `{"ok":true}`. Then sign in on the web app and generate a quiz.
8. **Watch it:** `npx wrangler tail`, or the Workers dashboard's Logs view (observability is enabled). Each chat logs uid, operation, usage and stop reason, but never content.

To check usage: `npx wrangler d1 execute concrete-ai-quota --remote --command "SELECT * FROM usage ORDER BY used DESC LIMIT 20"`.

## Spend cap (read this)

The hard spending limit is your **Anthropic prepaid credit balance**, not this Worker:

- In the Anthropic Console, under **Billing**, buy prepaid credit (for example $20).
- **Turn auto-reload OFF.** With auto-reload off, the API stops serving requests when the balance reaches $0, whatever this Worker does. Users then see `upstream_error`.
- Optionally, also set a monthly spend limit on the workspace that owns the key.

The per-user quota (`QUOTA_MONTHLY`) only stops one user from draining the balance. Do the math: Claude Haiku 5.5 costs $0.10 per million input tokens and $0.50 per million output tokens. A request costs roughly $0.001–$0.015: the 400 KB body cap is about 100K input tokens, and the output cap is 8K tokens. So at `QUOTA_MONTHLY = 100`, one user costs at most about $1.50 a month, and usually far less. Raise or lower the quota to match your budget and user count.
