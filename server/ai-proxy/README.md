# Concrete AI proxy

A Cloudflare Worker that sits between the Concrete web app and [OpenRouter](https://openrouter.ai) (the same LLM gateway the desktop app uses). It also stores the web app's images and PDFs in Cloudflare R2 (see [File storage](#file-storage)). The browser can't hold an OpenRouter API key, so for AI this Worker does four things:

1. Holds `OPENROUTER_API_KEY` as a Worker secret.
2. Checks that each caller is a signed-in Firebase user. It verifies the Firebase ID token with `jose` against Google's public keys (RS256, `iss`/`aud` = your project, `exp`/`iat`/`sub`).
3. Enforces a per-user monthly request quota stored in Cloudflare D1. It reserves one unit before calling the model and refunds it if the upstream call fails. It also records each user's OpenRouter spend per month (`cost_usd`) so you can see who costs what.
4. Forwards the request to OpenRouter's chat completions API (`https://openrouter.ai/api/v1/chat/completions`). The model must be on the server's allowlist, the token cap is fixed on the server, and only a sanitized subset of OpenRouter options is passed through.

It runs on the Workers **free plan**, so no card is needed. The spending backstop is a per-key credit limit on OpenRouter (see [Spend cap](#spend-cap-read-this)).

## HTTP API

Every `/v1/*` endpoint requires `Authorization: Bearer <Firebase ID token>`. Without a valid token the response is `401 {"error":"unauthorized"}`. CORS is allowed for the origins listed in `ALLOWED_ORIGINS`. The headers `authorization, content-type` are allowed, and `OPTIONS` preflight is handled (403 for unknown origins).

### `POST /v1/chat`

```jsonc
{
  "messages": [{ "role": "system" | "user" | "assistant", "content": "..." }],
  "model": "openai/gpt-5.6-luna", // optional; used if in ALLOWED_MODELS, else DEFAULT_MODEL (logged)
  "max_tokens": 4000,     // optional, clamped to MAX_TOKENS_CAP
  "temperature": 0.4,     // optional, clamped to 0–2 (default 0.5, like the desktop app)
  "provider": { "order": ["Cerebras"], "allow_fallbacks": true, "sort": "throughput" }, // optional
  "reasoning": { "enabled": false, "effort": "low", "exclude": true },                 // optional
  "operation": "quiz",    // optional, logged
  "stream": false,        // optional
  "metadata": {}          // optional, ignored
}
```

- Messages are passed to OpenRouter as-is (OpenAI style; `system` messages stay in the list, and a trailing `assistant` turn is allowed). Whitespace-only messages are dropped. At least one non-empty `user`/`assistant` message is required, and at most 200 messages. Otherwise the response is `400 {"error":"bad_request","detail":"..."}`.
- `provider` keeps only `order` (up to 5 provider names), `allow_fallbacks` (boolean) and `sort` (`price` | `throughput` | `latency`). `reasoning` keeps only `enabled`, `effort` (`none` | `minimal` | `low` | `medium` | `high` | `xhigh` | `max`) and `exclude`. Anything else is silently dropped.
- The Worker always calls OpenRouter with `stream: true` and `usage: {include: true}`, so token counts and `cost` come back on every request.
- Bodies over 400 KB get `413 {"error":"payload_too_large"}`.

**Non-stream 200**

```json
{ "content": "...", "model": "deepseek/deepseek-v4-flash-0731",
  "usage": { "prompt_tokens": 812, "completion_tokens": 431, "total_tokens": 1243, "cost": 0.00042 },
  "requestId": "gen-...", "quota": { "used": 3, "limit": 100, "resetsAt": "2026-12-01T00:00:00.000Z" } }
```

`usage` is OpenRouter's usage object as returned (it may carry extra detail fields). `requestId` is OpenRouter's generation id. An empty completion is returned as `"content": ""` (the app's quiz/grading fallbacks handle it).

**Stream (`"stream": true`)**: `content-type: text/event-stream`. Each event is one `data: <json>\n\n` line:

```
data: {"type":"delta","text":"..."}            (answer text only; reasoning is never forwarded)
data: {"type":"done","content":"...","model":"...","usage":{...},"requestId":"...","quota":{...}}
data: {"type":"error","code":"upstream_error","message":"..."}   (then the stream closes)
```

If OpenRouter fails before its first data chunk arrives (including an `error` object sent as the first chunk), the response is a normal JSON HTTP error, not a 200 stream (see below).

**Errors**

| Status | Body `error` | When |
|---|---|---|
| 400 | `bad_request` (+ `detail`) | invalid JSON or invalid message list |
| 401 | `unauthorized` | missing or invalid Firebase token |
| 413 | `payload_too_large` | body > 400 KB |
| 422 | `refused` | moderation flagged the input/output (OpenRouter 403 with flag reasons, a flagged stream error, or `finish_reason: "content_filter"`) |
| 429 | `quota_exceeded` (+ `used`, `limit`, `resetsAt`) | monthly quota used up (checked before calling the model) |
| 429 | `rate_limited` | per-user burst limit (5 concurrent / 10 per minute, best effort) |
| 502 | `upstream_error` | OpenRouter 401/403 (key problems), 400, 408, 5xx, timeouts, network errors, mid-stream errors |
| 503 | `upstream_out_of_credits` | OpenRouter 402: the key's credit limit or the account balance is used up. Message: "AI is temporarily unavailable" |
| 503 | `upstream_rate_limited` | OpenRouter returned 429 |
| 500 | `internal_error` | bug |

Error bodies also carry a short generic `message`. Upstream bodies and headers are never forwarded. The Worker gives up if OpenRouter sends nothing (headers or stream data) for 90 seconds.

### `GET /v1/quota`

`{ "used": 3, "limit": 100, "resetsAt": "2026-12-01T00:00:00.000Z" }`. For allowlisted uids, `limit` is `-1`, meaning unlimited.

### File storage

Images and PDFs for the web app live in the R2 bucket bound as `FILES`, keyed `users/<uid>/<vault-relative path>`. The uid always comes from the verified token, never from the client, so a user can only reach their own files. These routes never touch the AI quota or the burst limiter. Without the `FILES` binding they answer `503 {"error":"files_unavailable"}`.

Paths are vault-relative (`Stats/.attachments/plot.png`, `Papers/Lecture 1.pdf`) and sent URL-encoded as one segment (`encodeURIComponent`). A path gets `400 bad_path` when it is empty or absolute, contains `\` or control characters, has an empty, `.` or `..` segment, or is longer than 1024 characters.

| Route | What it does |
|---|---|
| `PUT /v1/files/<path>` | Raw body. `content-type` must match the extension: `image/png`, `image/jpeg` (`.jpg`/`.jpeg`), `image/gif`, `image/webp`, `image/svg+xml`, `application/pdf`. With `?ifAbsent=1`, an existing file gets `409 already_exists` instead of an overwrite. Returns `{path, size, contentType, uploaded}`. |
| `GET /v1/files/<path>` | Streams the bytes with the stored `content-type`, `cache-control: private`, `x-content-type-options: nosniff`. SVGs also get `content-security-policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` and `content-disposition: attachment`, so an uploaded SVG can't run script on the Worker origin. |
| `DELETE /v1/files/<path>` | Deletes the file. With `?recursive=1` and no file at `<path>`, deletes everything under `<path>/` (up to 1000 per call; repeat while `truncated`). Returns `{deleted, truncated}`. |
| `GET /v1/files?prefix=` | Lists `{files: [{path, size, contentType, uploaded}], truncated}` (up to 10,000). |
| `POST /v1/files/move` | `{from, to}`. Moves one file (the new extension must keep the same type), or every file under the folder `from/` to `to/` (100 per call; repeat while `truncated`). Returns `{moved, truncated}`. |
| `GET /v1/storage` | `{usedBytes, limitBytes}` |

Limits:

- **`MAX_FILE_MB`** (default 20) per upload. Larger uploads get `413 {"error":"too_large","limitBytes":…}`. Disallowed or mismatched types get `415 unsupported_type`.
- **`STORAGE_QUOTA_MB`** (default 100) per user. Uploads over it get `413 {"error":"storage_quota_exceeded","usedBytes":…,"limitBytes":…}`. Usage lives in D1 (table `storage_usage`, migration `0002`):
  - An overwrite charges only the size difference.
  - A delete gives the bytes back.
  - A move that replaces a file gives back the replaced file's size.
  - Bytes are reserved atomically before the upload and refunded if R2 fails. Two concurrent overwrites of the same path can skew the counter slightly, but it never goes below zero.

R2's free tier covers 10 GB of storage, 1M Class A operations and 10M Class B operations a month. What each action costs:

- An upload is 1 head (Class B) plus 1 put (Class A).
- A list is 1 Class A operation per 1000 objects. The web app lists once per vault load.
- A move is about 4 operations per file.

### `GET /health`

`{ "ok": true }`. Needs no auth.

## Quota semantics

- One `/v1/chat` call is one unit, counted per UTC calendar month (`period = 'YYYY-MM'`). The quota resets at 00:00 UTC on the 1st of the month.
- A unit is reserved atomically before the model call (`INSERT … ON CONFLICT DO UPDATE … WHERE used < limit RETURNING used`).
- The unit is refunded when the OpenRouter call fails, either before or during streaming. It is **not** refunded on a `content_filter` refusal or when the client disconnects mid-stream, because those tokens were already billed.
- Spend: whenever OpenRouter reports `usage.cost`, it is added to `usage.cost_usd` for that user and month (migration `0003`). This is for your visibility only; the limit stays request-count based.
- Uids in `QUOTA_ALLOWLIST_UIDS` are still counted but never blocked.
- The burst limiter keeps its state in each isolate's memory, so it is not global across Cloudflare's edge. It only blunts runaway client loops. The D1 quota is the real limit.

## Configuration

| Name | Kind | Default | Notes |
|---|---|---|---|
| `OPENROUTER_API_KEY` | **secret** | – | `wrangler secret put OPENROUTER_API_KEY`. Use a dedicated key with a credit limit. |
| `FIREBASE_PROJECT_ID` | var | – | Required. Tokens from other projects are rejected. |
| `ALLOWED_ORIGINS` | var | (none) | Comma-separated, e.g. `https://concrete.example.com,http://localhost:5173` |
| `APP_URL` | var | (empty) | Sent as `HTTP-Referer` to OpenRouter (app attribution). Omitted when empty. `X-Title: Concrete` is always sent. |
| `DEFAULT_MODEL` | var | `openai/gpt-5.6-luna` | Used when the client sends no model or one outside `ALLOWED_MODELS` |
| `ALLOWED_MODELS` | var | the 5 curated ids | Comma-separated. Default: `deepseek/deepseek-v4-flash-0731`, `qwen/qwen3.8-27b`, `qwen/qwen3.7-flash`, `openai/gpt-5.6-luna`, `openai/gpt-4o-mini` (mirrors `src/ai/openRouterModels.ts`). `DEFAULT_MODEL` is always allowed. |
| `MAX_TOKENS_CAP` | var | `8000` | |
| `QUOTA_MONTHLY` | var | `100` | Requests per user per month |
| `QUOTA_ALLOWLIST_UIDS` | var | (empty) | Comma-separated uids exempt from the quota |
| `MAX_FILE_MB` | var | `20` | Largest single image/PDF upload |
| `STORAGE_QUOTA_MB` | var | `100` | File storage per user |
| `DB` | D1 binding | – | Database `concrete-ai-quota` (AI usage, spend and storage usage) |
| `FILES` | R2 binding | – | Bucket `concrete-files`. Optional: without it, the file routes answer 503. |

## Local development

```bash
cd server/ai-proxy
npm install
npm test                 # vitest, no network (OpenRouter is faked)
npx tsc --noEmit         # typecheck

# Optional: run the Worker locally against a local D1
echo 'OPENROUTER_API_KEY=sk-or-...' > .dev.vars        # gitignored
npm run db:migrate:local
# Set FIREBASE_PROJECT_ID in wrangler.toml (or add it to .dev.vars), then:
npm run dev              # http://localhost:8787
curl localhost:8787/health
```

To call `/v1/chat` locally, you need a real Firebase ID token from the web app. In the browser console, run `await firebase.auth().currentUser.getIdToken()` or the modular `getIdToken(auth.currentUser)`.

## Deploy checklist (owner)

Run these from `server/ai-proxy/`.

1. **Log in to Cloudflare:** `npx wrangler login`
2. **Create the D1 database** (first deploy only): `npx wrangler d1 create concrete-ai-quota`. Paste the printed `database_id` into `wrangler.toml` under `[[d1_databases]]`.
3. **Apply the migrations to the remote DB:** `npm run db:migrate:remote` (runs `wrangler d1 migrations apply concrete-ai-quota --remote`). This applies `0001_usage.sql`, `0002_storage.sql` and `0003_cost.sql`. Run it again whenever you pull new migrations.
4. **Create the R2 bucket for images and PDFs** (first deploy only): `npx wrangler r2 bucket create concrete-files`. The `[[r2_buckets]]` binding (`FILES` → `concrete-files`) is already in `wrangler.toml`. R2 is included in the free plan (10 GB), but Cloudflare may ask you to enable R2 once in the dashboard first.
5. **Create a dedicated OpenRouter key with a hard cap:** at [openrouter.ai/keys](https://openrouter.ai/keys), create a new key just for this Worker (don't reuse your desktop key) and set its **credit limit to $20, resetting monthly**. Keep account **auto top-up off** (see [Spend cap](#spend-cap-read-this)).
6. **Set the vars** in `wrangler.toml` `[vars]`:
   - `FIREBASE_PROJECT_ID` = your Firebase project id
   - `ALLOWED_ORIGINS` = your production web origin(s), comma-separated
   - `APP_URL` = your production web origin (shown as the app in OpenRouter's activity)
   - `QUOTA_ALLOWLIST_UIDS` = your own Firebase uid (optional)
   - review `DEFAULT_MODEL`, `ALLOWED_MODELS`, `MAX_TOKENS_CAP`, `QUOTA_MONTHLY`, `MAX_FILE_MB`, `STORAGE_QUOTA_MB`
7. **Set the API key secret:** `npx wrangler secret put OPENROUTER_API_KEY` and paste the key from step 5. If you deployed the Anthropic version before, remove the old secret: `npx wrangler secret delete ANTHROPIC_API_KEY`.
8. **Deploy:** `npx wrangler deploy`. Note the `https://concrete-ai-proxy.<subdomain>.workers.dev` URL and point the web app at it (`VITE_AI_PROXY_URL`).
9. **Smoke test:** `curl https://<worker-url>/health` should return `{"ok":true}`. Then sign in on the web app, pick a model under Settings → Tutor AI, and generate a quiz and some cards. Paste an image into a note and import a PDF to check file storage.
10. **Watch it:** `npx wrangler tail`, or the Workers dashboard's Logs view (observability is enabled). Each chat logs uid, operation, model, usage (including cost) and finish reason, but never content. OpenRouter's Activity page shows the same requests per key.

To check usage and spend: `npx wrangler d1 execute concrete-ai-quota --remote --command "SELECT uid, period, used, ROUND(cost_usd, 4) AS cost_usd FROM usage ORDER BY cost_usd DESC LIMIT 20"`.

## Spend cap (read this)

The hard spending limit is a **per-key credit limit on OpenRouter**, not this Worker:

- Create a **dedicated OpenRouter API key** for this Worker and give it a **credit limit of $20/month** (OpenRouter supports per-key credit limits with a monthly reset). When the key hits its limit, OpenRouter answers 402 and users see "AI is temporarily unavailable" (`upstream_out_of_credits`) until the limit resets or you raise it. Your other keys (e.g. the desktop app's) are unaffected.
- **Keep auto top-up OFF** on your OpenRouter account, so a runaway can never charge your card. The account balance is a second backstop: when it reaches $0, every key stops.

The per-user quota (`QUOTA_MONTHLY`) only stops one user from draining the key's budget. Per-request cost depends on the model (prices are on each model's OpenRouter page); the curated models are all low-cost, and the 400 KB body cap (about 100K input tokens) plus the 8K output cap bound the worst case. Check `cost_usd` in D1 after a few days of real use, then raise or lower `QUOTA_MONTHLY` to match your budget and user count.
