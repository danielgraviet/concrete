import { describe, expect, it } from 'vitest';
import { filterSessions, formatSessionAge } from './sessionList';
import type { ChatSessionMeta } from './sessionStore';

const session = (title: string, notePaths: string[] = []): ChatSessionMeta => ({
  id: title,
  title,
  createdAt: 0,
  updatedAt: 0,
  notePaths,
});

describe('formatSessionAge', () => {
  const now = Date.UTC(2026, 9, 8, 12);
  it('buckets recent ages', () => {
    expect(formatSessionAge(now - 10_000, now)).toBe('just now');
    expect(formatSessionAge(now - 5 * 60_000, now)).toBe('5m ago');
    expect(formatSessionAge(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(formatSessionAge(now - 2 * 86_400_000, now)).toBe('2d ago');
  });
  it('falls back to a date after a week', () => {
    expect(formatSessionAge(now - 10 * 86_400_000, now)).not.toMatch(/ago/);
  });
});

describe('filterSessions', () => {
  const sessions = [session('Entropy basics', ['Physics.md']), session('Gradient descent', ['ML/Optimizers.md'])];
  it('matches every word against title and note paths', () => {
    expect(filterSessions(sessions, 'entropy').map((s) => s.title)).toEqual(['Entropy basics']);
    expect(filterSessions(sessions, 'ml descent').map((s) => s.title)).toEqual(['Gradient descent']);
    expect(filterSessions(sessions, 'entropy ml')).toEqual([]);
  });
  it('returns everything for a blank query', () => {
    expect(filterSessions(sessions, '  ')).toBe(sessions);
  });
});
