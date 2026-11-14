import type Anthropic from "@anthropic-ai/sdk";

/** Request body for POST /v1/chat (mirrors the desktop app's request type). */
export interface ChatRequest {
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  max_tokens?: number;
  operation?: string;
  stream?: boolean;
  model?: string;
  metadata?: Record<string, unknown>;
}

export class BadRequest extends Error {}

export interface SplitResult {
  system: string | undefined;
  messages: Anthropic.MessageParam[];
}

/** Validates the raw JSON body shape. Throws BadRequest with a human-readable detail. */
export function parseChatRequest(body: unknown): ChatRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new BadRequest("body must be a JSON object");
  }
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.messages) || b.messages.length === 0) {
    throw new BadRequest("messages must be a non-empty array");
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
 * System-role messages are concatenated (in order) into the top-level system prompt.
 * The rest must form a valid conversation: consecutive same-role turns are merged,
 * the first turn must be `user`, and the last must be `user` (assistant prefill is not
 * supported by current models).
 */
export function splitMessages(input: ChatRequest["messages"]): SplitResult {
  const systemParts: string[] = [];
  const turns: { role: "user" | "assistant"; content: string }[] = [];

  for (const m of input) {
    if (m.role === "system") {
      if (m.content.trim()) systemParts.push(m.content);
      continue;
    }
    if (!m.content.trim()) continue; // the API rejects empty text blocks
    const last = turns[turns.length - 1];
    if (last && last.role === m.role) {
      last.content += "\n\n" + m.content;
    } else {
      turns.push({ role: m.role, content: m.content });
    }
  }

  if (turns.length === 0) throw new BadRequest("at least one non-empty user message is required");
  if (turns[0].role !== "user") throw new BadRequest("conversation must start with a user message");
  if (turns[turns.length - 1].role !== "user") {
    throw new BadRequest("conversation must end with a user message");
  }

  return {
    system: systemParts.length ? systemParts.join("\n\n") : undefined,
    messages: turns,
  };
}

/** The client's max_tokens is honored only up to the server cap. */
export function clampMaxTokens(requested: number | undefined, cap: number): number {
  if (requested === undefined || !Number.isFinite(requested)) return cap;
  return Math.max(1, Math.min(Math.floor(requested), cap));
}
