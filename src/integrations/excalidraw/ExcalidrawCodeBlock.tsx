import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { CodeMirrorEditor, useCodeBlockEditorContext, type CodeBlockEditorDescriptor, type CodeBlockEditorProps } from '@mdxeditor/editor';
import type { ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types';
import './excalidraw.css';
import '@excalidraw/excalidraw/index.css';

const Excalidraw = lazy(async () => {
  const module = await import('@excalidraw/excalidraw');
  return { default: module.Excalidraw };
});

function parseScene(code: string): ExcalidrawInitialDataState {
  if (!code.trim()) return { elements: [], appState: { viewBackgroundColor: '#ffffff' } };
  const parsed = JSON.parse(code) as Partial<ExcalidrawInitialDataState>;
  if (!Array.isArray(parsed.elements)) throw new Error('Scene JSON must contain an elements array.');
  return parsed;
}

export function ExcalidrawCodeBlock(props: CodeBlockEditorProps) {
  const { setCode } = useCodeBlockEditorContext();
  const [initialData] = useState(() => {
    try { return { scene: parseScene(props.code), error: '' }; }
    catch (error) { return { scene: null, error: error instanceof Error ? error.message : 'Invalid Excalidraw scene.' }; }
  });
  const [saveState, setSaveState] = useState<'saved' | 'saving'>('saved');
  const latestCode = useRef(props.code);
  const pendingCode = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (pendingCode.current !== null) setCode(pendingCode.current);
  }, [setCode]);

  const saveScene = useCallback(async (elements: readonly unknown[], appState: Record<string, unknown>, files: Record<string, unknown>) => {
    const { serializeAsJSON } = await import('@excalidraw/excalidraw');
    const serialized = serializeAsJSON(elements as never[], appState as never, files as never, 'local');
    if (serialized === latestCode.current) return;
    if (timer.current) clearTimeout(timer.current);
    pendingCode.current = serialized;
    setSaveState('saving');
    timer.current = setTimeout(() => {
      latestCode.current = serialized;
      pendingCode.current = null;
      setCode(serialized);
      setSaveState('saved');
    }, 400);
  }, [setCode]);

  if (!initialData.scene) {
    return <div className="excalidraw-code-invalid">
      <p>Could not render this Excalidraw block: {initialData.error} Edit the JSON below to repair it.</p>
      <CodeMirrorEditor {...props} />
    </div>;
  }

  return <div className="excalidraw-code-block" contentEditable={false}>
    <div className="excalidraw-code-status" role="status">Excalidraw diagram · {saveState === 'saving' ? 'Saving to this note…' : 'Saved in this note'}</div>
    <Suspense fallback={<div className="excalidraw-loading">Loading Excalidraw…</div>}>
      <Excalidraw
        key={props.nodeKey}
        initialData={initialData.scene}
        onChange={(elements, appState, files) => void saveScene(elements, appState as unknown as Record<string, unknown>, files as unknown as Record<string, unknown>)}
        UIOptions={{ canvasActions: { saveToActiveFile: false, loadScene: false } }}
      />
    </Suspense>
  </div>;
}

export const excalidrawCodeBlockDescriptor: CodeBlockEditorDescriptor = {
  priority: 5,
  match: (language) => language?.toLowerCase() === 'excalidraw',
  Editor: ExcalidrawCodeBlock,
};
