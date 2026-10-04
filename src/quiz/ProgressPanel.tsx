import { useEffect, useMemo, useState } from 'react';
import type { QuizHistoryStore } from './history';
import { ActivityHeatmap, SkillBars, StatTiles, TrendChart } from './ProgressCharts';
import { attemptInFolder, folderLabel, summarizeAttempts } from './progressStats';

type Props = {
  store: QuizHistoryStore;
  /** Folder to show ('' = vault root), derived from the open file. */
  folder: string;
};

/**
 * Quiz progress for the folder containing the open file and its subfolders.
 */
export function ProgressPanel({ store, folder }: Props) {
  const [, refresh] = useState(0);
  useEffect(() => store.subscribe(() => refresh((n) => n + 1)), [store]);

  const all = store.getAll();
  const attempts = useMemo(() => all.filter((a) => attemptInFolder(a, folder)), [all, folder]);
  const summary = useMemo(() => summarizeAttempts(attempts), [attempts]);
  return (
    <section className="mv-progress-panel">
      <div className="pg-head">
        <div className="mv-panel-label">LEARNING PROGRESS</div>
      </div>

      {attempts.length === 0 ? (
        <p className="pg-empty">
          No quiz attempts in <strong>{folderLabel(folder)}</strong> yet.
          Finish a quiz and your progress will appear here.
        </p>
      ) : (
        <>
          <StatTiles kpis={summary.kpis} streak={summary.streak} />

          <h3 className="pg-title">Score trend</h3>
          <TrendChart points={summary.trend} average={summary.kpis.average} />

          {summary.skills.length > 0 ? (
            <>
              <h3 className="pg-title">Skills</h3>
              <SkillBars skills={summary.skills} />
            </>
          ) : null}

          <h3 className="pg-title">Activity</h3>
          <ActivityHeatmap weeks={summary.activity} />

        </>
      )}
    </section>
  );
}
