/** Worker bindings. Secrets and vars are documented in wrangler.toml and README.md. */
export interface Env {
  DB: D1Database;
  /** R2 bucket for images/PDFs (`/v1/files`). Optional: file routes answer 503 without it. */
  FILES?: R2Bucket;
  OPENROUTER_API_KEY: string;
  FIREBASE_PROJECT_ID: string;
  ALLOWED_ORIGINS?: string;
  /** Sent to OpenRouter as `HTTP-Referer` (app attribution). */
  APP_URL?: string;
  DEFAULT_MODEL?: string;
  ALLOWED_MODELS?: string;
  MAX_TOKENS_CAP?: string;
  QUOTA_MONTHLY?: string;
  QUOTA_ALLOWLIST_UIDS?: string;
  MAX_FILE_MB?: string;
  STORAGE_QUOTA_MB?: string;
}

export interface Config {
  firebaseProjectId: string;
  allowedOrigins: string[];
  /** OpenRouter model used when the client sends none, or one outside `allowedModels`. */
  defaultModel: string;
  /** OpenRouter model ids a client may pick (always includes `defaultModel`). */
  allowedModels: Set<string>;
  /** `HTTP-Referer` sent to OpenRouter; empty means the header is omitted. */
  appUrl: string;
  maxTokensCap: number;
  quotaMonthly: number;
  allowlist: Set<string>;
  /** Largest single upload to `/v1/files`, in bytes. */
  maxFileBytes: number;
  /** Per-user total R2 storage, in bytes. */
  storageQuotaBytes: number;
}

export const DEFAULT_MODEL = "deepseek/deepseek-v4-flash-0731";
/** Mirrors OPENROUTER_MODEL_OPTIONS in the app's `src/ai/openRouterModels.ts`. */
export const DEFAULT_ALLOWED_MODELS: readonly string[] = [
  "deepseek/deepseek-v4-flash-0731",
  "qwen/qwen3.8-27b",
  "qwen/qwen3.7-flash",
  "openai/gpt-5.6-luna",
  "openai/gpt-4o-mini",
];
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
  const defaultModel = (env.DEFAULT_MODEL ?? "").trim() || DEFAULT_MODEL;
  const allowed = list(env.ALLOWED_MODELS);
  return {
    firebaseProjectId: (env.FIREBASE_PROJECT_ID ?? "").trim(),
    allowedOrigins: list(env.ALLOWED_ORIGINS),
    defaultModel,
    allowedModels: new Set([defaultModel, ...(allowed.length ? allowed : DEFAULT_ALLOWED_MODELS)]),
    appUrl: (env.APP_URL ?? "").trim(),
    maxTokensCap: Math.max(1, positiveInt(env.MAX_TOKENS_CAP, DEFAULT_MAX_TOKENS_CAP)),
    quotaMonthly: positiveInt(env.QUOTA_MONTHLY, DEFAULT_QUOTA_MONTHLY),
    allowlist: new Set(list(env.QUOTA_ALLOWLIST_UIDS)),
    maxFileBytes: megabytes(env.MAX_FILE_MB, DEFAULT_MAX_FILE_MB),
    storageQuotaBytes: megabytes(env.STORAGE_QUOTA_MB, DEFAULT_STORAGE_QUOTA_MB),
  };
}
