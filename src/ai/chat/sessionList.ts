import type { ChatSessionMeta } from './sessionStore';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Compact age for the history list: "just now", "5m", "3h", "2d", then a date. */
export function formatSessionAge(updatedAt: number, now = Date.now()): string {
  const age = Math.max(0, now - updatedAt);
  if (age < MINUTE) return 'just now';
  if (age < HOUR) return `${Math.floor(age / MINUTE)}m ago`;
  if (age < DAY) return `${Math.floor(age / HOUR)}h ago`;
  if (age < 7 * DAY) return `${Math.floor(age / DAY)}d ago`;
  return new Date(updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Sessions whose title or touched notes contain every word of `query`. */
export function filterSessions(sessions: ChatSessionMeta[], query: string): ChatSessionMeta[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return sessions;
  return sessions.filter((session) => {
    const haystack = `${session.title} ${session.notePaths.join(' ')}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
