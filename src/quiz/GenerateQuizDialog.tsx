import { useMemo, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { isQuizPath, quizFileTitle } from './paths';
import { noteTitle } from '../vault/fileTree';

export type GenerateQuizDialogResult = {
  title: string;
  sourcePaths: string[];
};

type Props = {
  files: string[];
  /** Currently open note — preselected when it is not a quiz. */
  defaultSourcePath: string;
  folderHint?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (result: GenerateQuizDialogResult) => void;
};

function defaultTitleFromSources(paths: string[]): string {
  if (paths.length === 0) return 'Untitled';
  if (paths.length === 1) return noteTitle(paths[0]);
  return `${noteTitle(paths[0])} +${paths.length - 1}`;
}

/**
 * Pick source note(s) and a quiz title before calling the AI generator.
 * Defaults to the open note; allows multi-select.
 */
export function GenerateQuizDialog({
  files,
  defaultSourcePath,
  folderHint,
  busy = false,
  onCancel,
  onConfirm,
}: Props) {
  const noteFiles = useMemo(
    () => files.filter((path) => !isQuizPath(path)).sort((a, b) => a.localeCompare(b)),
    [files],
  );

  const initialSources = useMemo(() => {
    if (defaultSourcePath && !isQuizPath(defaultSourcePath)) {
      return [defaultSourcePath];
    }
    return noteFiles[0] ? [noteFiles[0]] : [];
  }, [defaultSourcePath, noteFiles]);

  const [selected, setSelected] = useState<string[]>(initialSources);
  const [title, setTitle] = useState(() =>
    quizFileTitle(defaultTitleFromSources(initialSources)).replace(/^Quiz\s+/, ''),
  );

  const toggle = (path: string) => {
    setSelected((current) => {
      const next = current.includes(path)
        ? current.filter((p) => p !== path)
        : [...current, path];
      if (next.length > 0) {
        setTitle((prev) => {
          // Only auto-rename when the user hasn't customized away from a prior default.
          const prevDefault = defaultTitleFromSources(current).replace(/^Quiz\s+/i, '');
          if (!prev.trim() || prev.trim() === prevDefault) {
            return defaultTitleFromSources(next).replace(/^Quiz\s+/i, '');
          }
          return prev;
        });
      }
      return next;
    });
  };

  const submit = () => {
    if (busy || selected.length === 0) return;
    const descriptive = title.trim() || defaultTitleFromSources(selected);
    onConfirm({
      title: quizFileTitle(descriptive),
      sourcePaths: selected,
    });
  };

  return (
    <div className="mv-overlay mv-prompt-overlay" role="dialog" aria-modal="true">
      <div className="mv-prompt-panel generate-quiz-panel">
        <div className="generate-quiz-header">
          <ClipboardList size={20} />
          <div>
            <h3>Generate quiz</h3>
            <p className="quiz-muted">
              Ground questions in selected notes
              {folderHint ? ` · saves under ${folderHint}` : ''}.
            </p>
          </div>
        </div>

        <label className="mv-field">
          <span>Quiz title</span>
          <input
            className="mv-prompt-input"
            value={title}
            disabled={busy}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="t-tests"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
          />
        </label>

        <div className="generate-quiz-sources">
          <div className="generate-quiz-sources-label">
            Source notes
            <small>{selected.length} selected</small>
          </div>
          {noteFiles.length === 0 ? (
            <p className="quiz-muted">No notes available. Create a note first.</p>
          ) : (
            <div className="generate-quiz-file-list">
              {noteFiles.map((path) => {
                const checked = selected.includes(path);
                const isDefault = path === defaultSourcePath;
                return (
                  <label
                    key={path}
                    className={`generate-quiz-file ${checked ? 'selected' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={busy}
                      onChange={() => toggle(path)}
                    />
                    <span className="generate-quiz-file-name">{noteTitle(path)}</span>
                    <span className="generate-quiz-file-path">
                      {path}
                      {isDefault ? ' · current' : ''}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="mv-actions generate-quiz-actions">
          <button
            type="button"
            className="mv-btn mv-btn-ghost"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="generate-quiz-submit"
            disabled={busy || selected.length === 0}
            onClick={submit}
          >
            <ClipboardList size={18} />
            {busy ? 'Generating…' : 'Generate quiz'}
          </button>
        </div>
      </div>
    </div>
  );
}
