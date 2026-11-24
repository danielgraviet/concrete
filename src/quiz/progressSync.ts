/**
 * Cloud sync for quiz progress: attempts (quiz history), active days (the
 * streak) and recent files. Every device keeps its own local copy and merges
 * it into the vault's copy, so syncing only ever adds; nothing a device has
 * is overwritten by another.
 *
 *   .vault/progress.json                    { version, months, days, recent }
 *   .vault/progress-attempts-2026-11.json   { version, month, attempts }
 *
 * Attempts are split by month (UTC) because the web version stores each data
 * file as one Firestore document, rejected above 900 KB. A month that is still
 * too big keeps every score but loses answer details from its oldest attempts.
 * Names stay flat because the desktop `writeData` IPC only accepts files
 * directly inside `.vault/`.
 */
import type { QuizAttempt } from './history';

export type Progress = { attempts: QuizAttempt[]; days: string[]; recent: string[] };

/** Where progress is stored: the vault's `.vault/` data (disk on desktop, cloud on web). */
export interface ProgressRemote {
  readData(key: string): Promise<string | null>;
  writeData(key: string, text: string): Promise<void>;
}

export const PROGRESS_MANIFEST = '.vault/progress.json';
/** Below the cloud's 900 KB per-document limit, with room for UTF-8 overhead. */
export const MAX_PROGRESS_FILE_CHARS = 850_000;
export const MAX_RECENT_FILES = 50;

const VERSION = 1;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_PATTERN = /^\d{4}-\d{2}$/;

type Manifest = { version: 1; months: string[]; days: string[]; recent: string[] };
type MonthFile = { version: 1; month: string; attempts: QuizAttempt[] };

const monthFile = (month: string) => `.vault/progress-attempts-${month}.json`;
const monthOf = (attempt: QuizAttempt) => new Date(attempt.completedAt).toISOString().slice(0, 7);
const hasDetails = (attempt: QuizAttempt) => attempt.perQuestion.some((q) => q.prompt !== undefined);

/** Which copy of the same attempt to keep: graded beats pending, detailed beats trimmed. */
function better(first: QuizAttempt, second: QuizAttempt): QuizAttempt {
  if (first.pendingAiGrade && !second.pendingAiGrade) return second;
  if (second.pendingAiGrade && !first.pendingAiGrade) return first;
  if (!hasDetails(first) && hasDetails(second)) return second;
  return first;
}

function isAttempt(value: unknown): value is QuizAttempt {
  const a = value as QuizAttempt;
  return Boolean(a) && typeof a.id === 'string' && typeof a.completedAt === 'number' && Array.isArray(a.perQuestion);
}

/**
 * Union of two progress copies. `a` is this device: its recent files come
 * first, and it wins ties between equally good copies of an attempt.
 */
export function mergeProgress(a: Progress, b: Progress): Progress {
  const byId = new Map<string, QuizAttempt>();
  for (const attempt of [...a.attempts, ...b.attempts]) {
    const existing = byId.get(attempt.id);
    byId.set(attempt.id, existing ? better(existing, attempt) : attempt);
  }
  const attempts = [...byId.values()].sort((x, y) => x.completedAt - y.completedAt || x.id.localeCompare(y.id));
  const days = [...new Set([...a.days, ...b.days].filter((day) => DAY_PATTERN.test(day)))].sort();
  const recent = [...new Set([...a.recent, ...b.recent].filter((path) => typeof path === 'string' && path))].slice(
    0,
    MAX_RECENT_FILES,
  );
  return { attempts, days, recent };
}

function parse<T>(text: string | null): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

type RemoteState = { progress: Progress; texts: Map<string, string | null> };

async function readRemote(remote: ProgressRemote): Promise<RemoteState> {
  const texts = new Map<string, string | null>();
  const manifestText = await remote.readData(PROGRESS_MANIFEST);
  texts.set(PROGRESS_MANIFEST, manifestText);
  const manifest = parse<Partial<Manifest>>(manifestText);
  const valid = manifest?.version === VERSION;
  const months = valid && Array.isArray(manifest.months) ? manifest.months.filter((m) => MONTH_PATTERN.test(m)) : [];

  const attempts: QuizAttempt[] = [];
  for (const month of months) {
    const text = await remote.readData(monthFile(month));
    texts.set(monthFile(month), text);
    const file = parse<Partial<MonthFile>>(text);
    if (file?.version === VERSION && Array.isArray(file.attempts)) attempts.push(...file.attempts.filter(isAttempt));
  }
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);
  return {
    progress: mergeProgress(
      { attempts, days: valid ? strings(manifest.days) : [], recent: valid ? strings(manifest.recent) : [] },
      { attempts: [], days: [], recent: [] },
    ),
    texts,
  };
}

/** One month's file, trimming answer details from the oldest attempts until it fits. */
function serializeMonth(month: string, attempts: QuizAttempt[]): string {
  let current = attempts;
  for (;;) {
    const text = JSON.stringify({ version: VERSION, month, attempts: current } satisfies MonthFile);
    if (text.length <= MAX_PROGRESS_FILE_CHARS) return text;
    const index = current.findIndex(hasDetails);
    if (index < 0) return text; // Scores alone are over the limit; the write will report it.
    current = current.map((attempt, i) =>
      i === index
        ? {
            ...attempt,
            perQuestion: attempt.perQuestion.map(({ questionId, score, maxScore, correct, type, kind }) => ({
              questionId,
              score,
              maxScore,
              correct,
              ...(type !== undefined ? { type } : {}),
              ...(kind !== undefined ? { kind } : {}),
            })),
          }
        : attempt,
    );
  }
}

/** Write `progress` to the remote, skipping files whose text is unchanged. Months before manifest. */
async function writeRemote(remote: ProgressRemote, progress: Progress, previous: Map<string, string | null>) {
  const byMonth = new Map<string, QuizAttempt[]>();
  for (const attempt of progress.attempts) {
    const month = monthOf(attempt);
    byMonth.set(month, [...(byMonth.get(month) ?? []), attempt]);
  }
  const months = [...byMonth.keys()].sort();
  for (const month of months) {
    const text = serializeMonth(month, byMonth.get(month) ?? []);
    if (previous.get(monthFile(month)) !== text) await remote.writeData(monthFile(month), text);
  }
  const manifest = JSON.stringify({
    version: VERSION,
    months,
    days: progress.days,
    recent: progress.recent,
  } satisfies Manifest);
  if (previous.get(PROGRESS_MANIFEST) !== manifest) await remote.writeData(PROGRESS_MANIFEST, manifest);
}

/** The progress stored in the vault (empty when there is none or it is unreadable). */
export async function loadRemoteProgress(remote: ProgressRemote): Promise<Progress> {
  return (await readRemote(remote)).progress;
}

/**
 * Merge this device's progress with the vault's, store the union, and return
 * it for the device to keep locally.
 */
export async function syncProgress(remote: ProgressRemote, local: Progress): Promise<Progress> {
  const { progress: stored, texts } = await readRemote(remote);
  const merged = mergeProgress(local, stored);
  await writeRemote(remote, merged, texts);
  return merged;
}
