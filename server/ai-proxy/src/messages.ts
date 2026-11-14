/** Request body for POST /v1/chat (mirrors the desktop app's OpenRouter request type). */
export interface ChatRequest {
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  operation?: string;
  stream?: boolean;
  model?: string;
  /** Raw client value; only sanitized via `sanitizeProvider` before it reaches OpenRouter. */
  provider?: unknown;
  /** Raw client value; only sanitized via `sanitizeReasoning` before it reaches OpenRouter. */
  reasoning?: unknown;
  metadata?: Record<string, unknown>;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class BadRequest extends Error {}

export const MAX_MESSAGES = 200;

/** Validates the raw JSON body shape. Throws BadRequest with a human-readable detail. */
export function parseChatRequest(body: unknown): ChatRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new BadRequest("body must be a JSON object");
  }
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.messages) || b.messages.length === 0) {
    throw new BadRequest("messages must be a non-empty array");
  }
  if (b.messages.length > MAX_MESSAGES) {
    throw new BadRequest(`messages may contain at most ${MAX_MESSAGES} entries`);
  }
  b.messages.forEach((m, i) => {
    if (!m || typeof m !== "object") throw new BadRequest(`messages[${i}] must be an object`);
    const { role, content } = m as Record<string, unknown>;
    if (role !== "system" && role !== "user" && role !== "assistant") {
      throw new BadRequest(`messages[${i}].role must be system, user, or assistant`);
    }
    if (typeof content !== "string") {
      throw new BadRequest(`messages[${i}].content must be a string`);
    }
  });
  if (b.max_tokens !== undefined && (typeof b.max_tokens !== "number" || !Number.isFinite(b.max_tokens))) {
    throw new BadRequest("max_tokens must be a number");
  }
  if (b.temperature !== undefined && (typeof b.temperature !== "number" || !Number.isFinite(b.temperature))) {
    throw new BadRequest("temperature must be a number");
  }
  if (b.stream !== undefined && typeof b.stream !== "boolean") {
    throw new BadRequest("stream must be a boolean");
  }
  if (b.operation !== undefined && typeof b.operation !== "string") {
    throw new BadRequest("operation must be a string");
  }
  if (b.model !== undefined && typeof b.model !== "string") {
    throw new BadRequest("model must be a string");
  }
  return b as unknown as ChatRequest;
}

/**
 * OpenAI-style messages pass straight through (system messages stay in place).
 * Only whitespace-only entries are dropped, since several providers reject empty
 * content; at least one non-empty user/assistant message must remain.
 */
export function normalizeMessages(input: ChatMessage[]): ChatMessage[] {
  const out = input
    .filter((m) => m.content.trim().length > 0)
    .map(({ role, content }) => ({ role, content }));
  if (!out.some((m) => m.role !== "system")) {
    throw new BadRequest("at least one non-empty user or assistant message is required");
  }
  return out;
}

/** The client's max_tokens is honored only up to the server cap. */
export function clampMaxTokens(requested: number | undefined, cap: number): number {
  if (requested === undefined || !Number.isFinite(requested)) return cap;
  return Math.max(1, Math.min(Math.floor(requested), cap));
}

/** Matches the desktop app's OpenRouter default when the client sends none. */
export const DEFAULT_TEMPERATURE = 0.5;

export function clampTemperature(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return DEFAULT_TEMPERATURE;
  return Math.max(0, Math.min(requested, 2));
}

export interface ProviderPrefs {
  order?: string[];
  allow_fallbacks?: boolean;
  sort?: "price" | "throughput" | "latency";
}

const SORTS = new Set(["price", "throughput", "latency"]);
const MAX_PROVIDER_ORDER = 5;

/** Keeps only `order` (≤ 5 short strings), `allow_fallbacks` and `sort`. Undefined if nothing survives. */
export function sanitizeProvider(raw: unknown): ProviderPrefs | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: ProviderPrefs = {};
  if (Array.isArray(r.order)) {
    const order = r.order
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= 64)
      .map((v) => v.trim())
      .slice(0, MAX_PROVIDER_ORDER);
    if (order.length) out.order = order;
  }
  if (typeof r.allow_fallbacks === "boolean") out.allow_fallbacks = r.allow_fallbacks;
  if (typeof r.sort === "string" && SORTS.has(r.sort)) out.sort = r.sort as ProviderPrefs["sort"];
  return Object.keys(out).length ? out : undefined;
}

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
const EFFORTS = new Set<string>(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);

export interface ReasoningPrefs {
  enabled?: boolean;
  effort?: ReasoningEffort;
  exclude?: boolean;
}

/** Keeps only `enabled`, `effort` (fixed list) and `exclude`. Undefined if nothing survives. */
export function sanitizeReasoning(raw: unknown): ReasoningPrefs | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: ReasoningPrefs = {};
  if (typeof r.enabled === "boolean") out.enabled = r.enabled;
  if (typeof r.effort === "string" && EFFORTS.has(r.effort)) out.effort = r.effort as ReasoningEffort;
  if (typeof r.exclude === "boolean") out.exclude = r.exclude;
  return Object.keys(out).length ? out : undefined;
}
