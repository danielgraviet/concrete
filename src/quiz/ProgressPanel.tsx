import { useEffect, useMemo, useState } from 'react';
import type { QuizHistoryStore } from './history';
import { ActivityHeatmap, SkillBars, StatTiles, TrendChart } from './ProgressCharts';
import { attemptInFolder, summarizeAttempts } from './progressStats';
import type { DailyActivityStore } from './dailyActivity';

type Props = {
  store: QuizHistoryStore;
  activityStore?: DailyActivityStore;
  /** Folder to show ('' = vault root), derived from the open file. */
  folder: string;
};

/**
 * Quiz progress for the folder containing the open file and its subfolders.
 */
export function ProgressPanel({ store, activityStore, folder }: Props) {
  const [, refresh] = useState(0);
  useEffect(() => {
    const unsubs = [store.subscribe(() => refresh((n) => n + 1))];
    if (activityStore) unsubs.push(activityStore.subscribe(() => refresh((n) => n + 1)));
    return () => unsubs.forEach((unsubscribe) => unsubscribe());
  }, [store, activityStore]);

  const all = store.getAll();
  const attempts = useMemo(() => all.filter((a) => attemptInFolder(a, folder)), [all, folder]);
  const activeDays = activityStore?.getDays() ?? [];
  const summary = useMemo(() => summarizeAttempts(attempts, new Date(), activeDays), [attempts, activeDays.join('|')]);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const activityByDay = new Map(summary.activity.flat().map((cell) => [cell.date.toDateString(), cell.count]));
  const recentDays = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - 29 + index);
    return { date, count: activityByDay.get(date.toDateString()) ?? 0 };
  });
  return (
    <section className="mv-progress-panel">
      <div className="pg-head">
        <div className="mv-panel-label">YOUR ACTIVITY</div>
      </div>

      <div className="pg-activity-streak" aria-label={`${summary.streak} day streak`}>
        <strong>{summary.streak}</strong>
        <span>day streak</span>
      </div>
      <h3 className="pg-title">Past 30 days</h3>
      <ActivityHeatmap days={recentDays} />

      {attempts.length > 0 ? (
        <>
          <StatTiles kpis={summary.kpis} />

          <h3 className="pg-title">Score trend</h3>
          <TrendChart points={summary.trend} average={summary.kpis.average} />

          {summary.skills.length > 0 ? (
            <>
              <h3 className="pg-title">Skills</h3>
              <SkillBars skills={summary.skills} />
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
