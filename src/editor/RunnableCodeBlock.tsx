import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CodeMirrorEditor,
  type CodeBlockEditorDescriptor,
  type CodeBlockEditorProps,
} from '@mdxeditor/editor';
import {
  getSandboxStatus,
  isRunnableLanguage,
  onSandboxProgress,
  runSandboxCode,
  type SandboxRunResult,
} from '../sandbox';
import { settingsStore } from '../settings';

/** Fired by the Mod-Enter keymap inside a code block; caught by the block's wrapper. */
export const RUN_CODE_EVENT = 'concrete-run-code';

type RunState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; result: SandboxRunResult };

/**
 * The standard code block editor plus a Run bar. Code runs in the configured
 * sandbox (Docker by default); output is shown under the block and never saved.
 */
export function RunnableCodeBlock(props: CodeBlockEditorProps) {
  const [state, setState] = useState<RunState>({ status: 'idle' });
  const rootRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef(props.code);
  codeRef.current = props.code;
  const languageRef = useRef(props.language);
  languageRef.current = props.language;
  const runningRef = useRef(false);
  const [progress, setProgress] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setProgress(null);
    setState({ status: 'running' });
    const stopProgress = onSandboxProgress(setProgress);
    const providerId = settingsStore.get().sandboxProviderId;
    try {
      const status = await getSandboxStatus(providerId);
      const result: SandboxRunResult = status.available
        ? await runSandboxCode({ language: languageRef.current, code: codeRef.current, timeoutMs: 10000 }, providerId)
        : {
            ok: false, stdout: '', stderr: '', exitCode: null, timedOut: false, durationMs: 0,
            error: status.detail ?? 'Code execution is unavailable.',
          };
      setState({ status: 'done', result });
    } finally {
      stopProgress();
      setProgress(null);
      runningRef.current = false;
    }
  }, []);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onRun = () => void run();
    el.addEventListener(RUN_CODE_EVENT, onRun);
    return () => el.removeEventListener(RUN_CODE_EVENT, onRun);
  }, [run]);

  const running = state.status === 'running';
  const result = state.status === 'done' ? state.result : null;

  return (
    <div className="runnable-code" ref={rootRef}>
      <CodeMirrorEditor {...props} />
      <div className="code-run-bar" contentEditable={false}>
        <button
          type="button"
          className="code-run-button"
          disabled={running}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void run()}
          title="Run in the sandbox (Cmd/Ctrl+Enter)"
        >
          {running ? 'Running…' : '▶ Run'}
        </button>
        <span className="code-run-hint">{running && progress ? progress : 'Cmd/Ctrl+Enter'}</span>
        {result ? (
          <button
            type="button"
            className="code-run-clear"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setState({ status: 'idle' })}
          >
            Clear
          </button>
        ) : null}
      </div>
      {result ? (
        <div className="code-run-output" contentEditable={false}>
          {result.stdout ? <pre className="code-run-stdout">{result.stdout}</pre> : null}
          {result.stderr ? <pre className="code-run-stderr">{result.stderr}</pre> : null}
          {result.error && !result.stderr ? <pre className="code-run-stderr">{result.error}</pre> : null}
          {result.ok && !result.stdout && !result.stderr ? (
            <pre className="code-run-empty">(no output)</pre>
          ) : null}
          <div className="code-run-meta">
            {result.ok
              ? `Exited 0 · ${result.durationMs}ms`
              : result.timedOut
                ? 'Timed out'
                : result.exitCode !== null
                  ? `Exited ${result.exitCode} · ${result.durationMs}ms`
                  : 'Did not run'}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export const runnableCodeBlockDescriptor: CodeBlockEditorDescriptor = {
  // Above the default CodeMirror descriptor; other languages keep the plain editor.
  priority: 100,
  match: (language) => isRunnableLanguage(language),
  Editor: RunnableCodeBlock,
};
