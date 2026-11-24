import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DailyActivityStore } from '../quiz/dailyActivity';
import type { QuizAttempt, QuizHistoryStore } from '../quiz/history';
import { QUIZ_RANKS } from './homeMilestones';
import { RankBadge } from './RankBadge';
import { VaultHome } from './VaultHome';

function render(attemptCount: number, days: string[]) {
  const attempts = Array.from({ length: attemptCount }, (_, i) => ({
    id: `a${i}`,
    quizPath: 'quiz.quiz.md',
    quizTitle: 'Quiz',
    completedAt: new Date(2026, 0, 1).getTime(),
    percent: 80,
    perQuestion: [],
  })) as unknown as QuizAttempt[];
  const historyStore = { getAll: () => attempts, subscribe: () => () => {} } as unknown as QuizHistoryStore;
  const activityStore = { getDays: () => days, subscribe: () => () => {} } as unknown as DailyActivityStore;
  return renderToStaticMarkup(
    <VaultHome
      recentPaths={[]}
      availablePaths={new Set()}
      historyStore={historyStore}
      activityStore={activityStore}
      vaultRoot="/vault"
      onOpen={() => {}}
      onCreate={() => {}}
      onNewQuiz={() => {}}
      onSearch={() => {}}
    />,
  );
}

describe('VaultHome milestones', () => {
  it('shows a cold ember and sand rank for a brand-new vault', () => {
    const html = render(0, []);
    expect(html).toContain('streak-flame-ember-stage');
    expect(html).toContain('Cold ember');
    expect(html).toContain('rank-badge-sand');
    expect(html).toContain('0 / 1 to Pebble');
  });

  it('shows the flame stage and rank for the current totals', () => {
    const days = Array.from({ length: 8 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`);
    const html = render(38, days);
    expect(html).toContain('streak-flame-bonfire');
    expect(html).toContain('6 more days to Blue core');
    expect(html).toContain('rank-badge-concrete');
    expect(html).toContain('38 / 50 to Granite');
    expect(html).toContain('Ranks unlocked: 3 of 8');
  });

  it('renders every rank badge with unique gradient ids', () => {
    const html = renderToStaticMarkup(<>{QUIZ_RANKS.map((rank) => <RankBadge key={rank.key} rank={rank} progress={0.5} />)}</>);
    const ids = [...html.matchAll(/<clipPath id="([^"]+)"/g)].map((match) => match[1]);
    expect(ids).toHaveLength(QUIZ_RANKS.length);
    expect(new Set(ids).size).toBe(ids.length);
    expect(html).not.toMatch(/NaN|undefined/);
  });
});

describe('VaultHome actions', () => {
  it('offers New quiz as the main action, after New note', () => {
    const html = render(0, []);
    expect(html).toContain('New quiz');
    expect(html.indexOf('New note')).toBeLessThan(html.indexOf('New quiz'));
  });
});
