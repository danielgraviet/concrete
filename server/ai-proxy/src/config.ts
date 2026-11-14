/** Worker bindings. Secrets and vars are documented in wrangler.toml and README.md. */
export interface Env {
  DB: D1Database;
  ANTHROPIC_API_KEY: string;
  FIREBASE_PROJECT_ID: string;
  ALLOWED_ORIGINS?: string;
  MODEL?: string;
  EFFORT?: string;
  MAX_TOKENS_CAP?: string;
  QUOTA_MONTHLY?: string;
  QUOTA_ALLOWLIST_UIDS?: string;
}

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];

export interface Config {
  firebaseProjectId: string;
  allowedOrigins: string[];
  model: string;
  effort: Effort;
  maxTokensCap: number;
  quotaMonthly: number;
  allowlist: Set<string>;
}

export const DEFAULT_MODEL = "claude-haiku-5-5";
export const DEFAULT_EFFORT: Effort = "low";
export const DEFAULT_MAX_TOKENS_CAP = 8000;
export const DEFAULT_QUOTA_MONTHLY = 100;

function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function positiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export function loadConfig(env: Env): Config {
  const effortRaw = (env.EFFORT ?? "").trim() as Effort;
  return {
    firebaseProjectId: (env.FIREBASE_PROJECT_ID ?? "").trim(),
    allowedOrigins: list(env.ALLOWED_ORIGINS),
    model: (env.MODEL ?? "").trim() || DEFAULT_MODEL,
    effort: EFFORTS.includes(effortRaw) ? effortRaw : DEFAULT_EFFORT,
    maxTokensCap: Math.max(1, positiveInt(env.MAX_TOKENS_CAP, DEFAULT_MAX_TOKENS_CAP)),
    quotaMonthly: positiveInt(env.QUOTA_MONTHLY, DEFAULT_QUOTA_MONTHLY),
    allowlist: new Set(list(env.QUOTA_ALLOWLIST_UIDS)),
  };
}
