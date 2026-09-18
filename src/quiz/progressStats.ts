import type { QuizAttempt } from './history';

/** Sentinel used by the folder picker for "every folder". */
export const ALL_FOLDERS = null;

/** Folder a quiz file lives in ('' = vault root). */
export function folderOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

export function folderLabel(folder: string): string {
  return folder === '' ? 'Vault root' : folder;
}

/** null = all folders; '' = vault root only; otherwise that folder and its subfolders. */
export function attemptInFolder(attempt: QuizAttempt, folder: string | null): boolean {
  if (folder === ALL_FOLDERS) return true;
  const own = folderOf(attempt.quizPath);
  if (folder === '') return own === '';
  return own === folder || own.startsWith(`${folder}/`);
}

export function listAttemptFolders(attempts: QuizAttempt[]): string[] {
  return [...new Set(attempts.map((a) => folderOf(a.quizPath)))].sort((a, b) => a.localeCompare(b));
}

export type ProgressKpis = {
  count: number;
  average: number;
  best: number;
  latest: number;
  /** Latest minus the attempt before it; null with fewer than two attempts. */
  delta: number | null;
};

export type TrendPoint = { id: string; percent: number; title: string; at: number };

export type SkillStat = { key: string; label: string; percent: number; questions: number };

export type ActivityCell = { date: Date; count: number };

export type ProgressSummary = {
  kpis: ProgressKpis;
  trend: TrendPoint[];
  skills: SkillStat[];
  /** Weeks as columns (Sun→Sat), oldest first; cells after today are omitted. */
  activity: ActivityCell[][];
  streak: number;
};

const TREND_LIMIT = 30;
const WEEKS = 12;

const TYPE_LABEL: Record<string, string> = { mcq: 'Multiple choice', cloze: 'Fill in the blank', open: 'Open response' };
const KIND_LABEL: Record<string, string> = {
  'predict-output': 'Predict the output',
  'find-bug': 'Find the bug',
  complexity: 'Complexity',
  scale: 'Scale it',
};

function skillOf(type?: string, kind?: string): { key: string; label: string } | null {
  if (type === 'code') {
    const key = kind ?? 'predict-output';
    return { key: `code:${key}`, label: KIND_LABEL[key] ?? 'Code' };
  }
  if (type && TYPE_LABEL[type]) return { key: type, label: TYPE_LABEL[type] };
  return null;
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** Everything the progress visuals need, for an already-scoped list of attempts. */
export function summarizeAttempts(attempts: QuizAttempt[], now = new Date()): ProgressSummary {
  const ordered = [...attempts].sort((a, b) => a.completedAt - b.completedAt);
  const percents = ordered.map((a) => a.percent);
  const latest = percents.length ? percents[percents.length - 1] : 0;

  const kpis: ProgressKpis = {
    count: ordered.length,
    average: ordered.length ? Math.round(percents.reduce((s, p) => s + p, 0) / ordered.length) : 0,
    best: percents.length ? Math.max(...percents) : 0,
    latest,
    delta: ordered.length >= 2 ? latest - percents[percents.length - 2] : null,
  };

  const trend: TrendPoint[] = ordered.slice(-TREND_LIMIT).map((a) => ({
    id: a.id,
    percent: a.percent,
    title: a.quizTitle,
    at: a.completedAt,
  }));

  const bySkill = new Map<string, { label: string; score: number; max: number; questions: number }>();
  for (const attempt of ordered) {
    for (const question of attempt.perQuestion) {
      const skill = skillOf(question.type, question.kind);
      if (!skill || question.maxScore <= 0) continue;
      const entry = bySkill.get(skill.key) ?? { label: skill.label, score: 0, max: 0, questions: 0 };
      entry.score += question.score;
      entry.max += question.maxScore;
      entry.questions += 1;
      bySkill.set(skill.key, entry);
    }
  }
  const skills: SkillStat[] = [...bySkill]
    .map(([key, v]) => ({ key, label: v.label, percent: Math.round((v.score / v.max) * 100), questions: v.questions }))
    .sort((a, b) => a.percent - b.percent || b.questions - a.questions);

  const counts = new Map<string, number>();
  for (const attempt of ordered) {
    const key = dayKey(new Date(attempt.completedAt));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(today);
  start.setDate(today.getDate() - today.getDay() - (WEEKS - 1) * 7);
  const activity: ActivityCell[][] = [];
  for (let week = 0; week < WEEKS; week += 1) {
    const column: ActivityCell[] = [];
    for (let day = 0; day < 7; day += 1) {
      const date = new Date(start);
      date.setDate(start.getDate() + week * 7 + day);
      if (date > today) break;
      column.push({ date, count: counts.get(dayKey(date)) ?? 0 });
    }
    activity.push(column);
  }

  // A streak survives until the end of the day after your last session.
  let streak = 0;
  const cursor = new Date(today);
  if (!counts.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (counts.has(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return { kpis, trend, skills, activity, streak };
}
