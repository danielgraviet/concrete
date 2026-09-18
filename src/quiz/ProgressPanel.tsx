import { useEffect, useMemo, useState } from 'react';
import type { QuizHistoryStore } from './history';
import { ActivityHeatmap, SkillBars, StatTiles, TrendChart } from './ProgressCharts';
import {
  ALL_FOLDERS,
  attemptInFolder,
  folderLabel,
  listAttemptFolders,
  summarizeAttempts,
} from './progressStats';

const ALL_VALUE = '__all__';
const ROOT_VALUE = '__root__';

type Props = {
  store: QuizHistoryStore;
  /** Folder to show ('' = vault root). Defaults to it; the picker can override. */
  folder: string;
};

/**
 * Quiz progress for one folder at a time, so a Machine Learning quiz never shows
 * scores from an unrelated subject. The folder follows what you're working on,
 * and can be switched (or set to all folders) from the picker.
 */
export function ProgressPanel({ store, folder }: Props) {
  const [, refresh] = useState(0);
  useEffect(() => store.subscribe(() => refresh((n) => n + 1)), [store]);

  // A manual pick sticks only until the working folder changes.
  const [override, setOverride] = useState<{ base: string; value: string | null } | null>(null);
  const scope = override && override.base === folder ? override.value : folder;

  const all = store.getAll();
  const folders = useMemo(() => {
    const set = new Set(listAttemptFolders(all));
    set.add(folder);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [all, folder]);

  const attempts = useMemo(() => all.filter((a) => attemptInFolder(a, scope)), [all, scope]);
  const summary = useMemo(() => summarizeAttempts(attempts), [attempts]);
  const selectValue = scope === ALL_FOLDERS ? ALL_VALUE : scope === '' ? ROOT_VALUE : scope;

  return (
    <section className="mv-progress-panel">
      <div className="pg-head">
        <div className="mv-panel-label">LEARNING PROGRESS</div>
        <select
          className="pg-select"
          aria-label="Progress folder"
          value={selectValue}
          onChange={(e) => {
            const v = e.target.value;
            setOverride({ base: folder, value: v === ALL_VALUE ? ALL_FOLDERS : v === ROOT_VALUE ? '' : v });
          }}
        >
          <option value={ALL_VALUE}>All folders</option>
          {folders.map((f) => (
            <option key={f || ROOT_VALUE} value={f === '' ? ROOT_VALUE : f}>
              {folderLabel(f)}
            </option>
          ))}
        </select>
      </div>

      {attempts.length === 0 ? (
        <p className="pg-empty">
          No quiz attempts in <strong>{scope === ALL_FOLDERS ? 'your vault' : folderLabel(scope)}</strong> yet.
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
              <p className="pg-note">Accuracy by question type · weakest first · number of questions</p>
            </>
          ) : null}

          <h3 className="pg-title">Activity</h3>
          <ActivityHeatmap weeks={summary.activity} />

          <details className="pg-data">
            <summary>View data</summary>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Quiz</th>
                  <th>Score</th>
                </tr>
              </thead>
              <tbody>
                {[...summary.trend].reverse().map((p) => (
                  <tr key={p.id}>
                    <td>{new Date(p.at).toLocaleDateString()}</td>
                    <td>{p.title}</td>
                    <td>{p.percent}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </section>
  );
}
