/** Worker bindings. Secrets and vars are documented in wrangler.toml and README.md. */
export interface Env {
  DB: D1Database;
  /** R2 bucket for images/PDFs (`/v1/files`). Optional: file routes answer 503 without it. */
  FILES?: R2Bucket;
  ANTHROPIC_API_KEY: string;
  FIREBASE_PROJECT_ID: string;
  ALLOWED_ORIGINS?: string;
  MODEL?: string;
  EFFORT?: string;
  MAX_TOKENS_CAP?: string;
  QUOTA_MONTHLY?: string;
  QUOTA_ALLOWLIST_UIDS?: string;
  MAX_FILE_MB?: string;
  STORAGE_QUOTA_MB?: string;
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
  /** Largest single upload to `/v1/files`, in bytes. */
  maxFileBytes: number;
  /** Per-user total R2 storage, in bytes. */
  storageQuotaBytes: number;
}

export const DEFAULT_MODEL = "claude-haiku-5-5";
export const DEFAULT_EFFORT: Effort = "low";
export const DEFAULT_MAX_TOKENS_CAP = 8000;
export const DEFAULT_QUOTA_MONTHLY = 100;
export const DEFAULT_MAX_FILE_MB = 20;
export const DEFAULT_STORAGE_QUOTA_MB = 100;
const MB = 1024 * 1024;

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

function megabytes(value: string | undefined, fallbackMb: number): number {
  const n = value === undefined || value.trim() === "" ? NaN : Number(value);
  return Math.floor((Number.isFinite(n) && n > 0 ? n : fallbackMb) * MB);
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
    maxFileBytes: megabytes(env.MAX_FILE_MB, DEFAULT_MAX_FILE_MB),
    storageQuotaBytes: megabytes(env.STORAGE_QUOTA_MB, DEFAULT_STORAGE_QUOTA_MB),
  };
}
