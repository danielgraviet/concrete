import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  EditorStateSubject,
  PersistenceObserver,
  type EditorSelection,
  type EditorStateEvent,
  type Observer,
  type SaveFn,
} from '../patterns/observer';
import type { EditorCommand, EditorCommandHandler } from './types';

export type UseEditorControllerOptions = {
  initialContent?: string;
  /** Called when content changes (after subject notify). */
  onChange?: (content: string) => void;
  /** Called when dirty flag changes. */
  onDirtyChange?: (isDirty: boolean) => void;
  /** Called after markSaved. */
  onSaved?: (content: string) => void;
  /** Optional command bridge for future Command pattern / palette. */
  onCommand?: EditorCommandHandler;
  /** Debounce for autosave when saveFn is provided. */
  autosaveMs?: number;
  /** If provided, PersistenceObserver will schedule this on content change. */
  saveFn?: SaveFn;
};

export type EditorController = {
  content: string;
  setContent: (value: string, options?: { markDirty?: boolean }) => void;
  loadContent: (value: string) => void;
  markSaved: (content?: string) => void;
  isDirty: boolean;
  selection: EditorSelection | null;
  setSelection: (selection: EditorSelection | null) => void;
  undo: () => void;
  redo: () => void;
  dispatchCommand: (command: EditorCommand) => boolean;
  subject: EditorStateSubject;
  persistence: PersistenceObserver;
  scheduleSave: (fn?: SaveFn) => void;
};

/**
 * Wires EditorStateSubject + PersistenceObserver and exposes a React-friendly API.
 * Undo/redo are stubs that dispatch window events and optional onCommand callbacks
 * until a real history stack / Command pattern is wired.
 */
export function useEditorController(
  options: UseEditorControllerOptions = {},
): EditorController {
  const {
    initialContent = '',
    onChange,
    onDirtyChange,
    onSaved,
    onCommand,
    autosaveMs = 800,
    saveFn,
  } = options;

  const subjectRef = useRef<EditorStateSubject | null>(null);
  if (!subjectRef.current) {
    const s = new EditorStateSubject();
    s.loadContent(initialContent);
    subjectRef.current = s;
  }
  const subject = subjectRef.current;

  const persistenceRef = useRef<PersistenceObserver | null>(null);
  if (!persistenceRef.current) {
    persistenceRef.current = new PersistenceObserver({ debounceMs: autosaveMs });
  }
  const persistence = persistenceRef.current;

  const saveFnRef = useRef(saveFn);
  saveFnRef.current = saveFn;
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;

  const [content, setContentState] = useState(() => subject.getContent());
  const [isDirty, setIsDirty] = useState(() => subject.isDirty());
  const [selection, setSelectionState] = useState<EditorSelection | null>(
    () => subject.getSelection(),
  );

  useEffect(() => {
    const observer: Observer<EditorStateEvent> = {
      update(event) {
        if (event.type === 'content') {
          setContentState(event.content);
          onChange?.(event.content);
          if (saveFnRef.current) {
            persistence.scheduleSave(saveFnRef.current);
          }
        } else if (event.type === 'dirty') {
          setIsDirty(event.isDirty);
          onDirtyChange?.(event.isDirty);
        } else if (event.type === 'saved') {
          setIsDirty(false);
          onSaved?.(event.content);
        } else if (event.type === 'selection') {
          setSelectionState(event.selection);
        }
      },
    };
    subject.attach(observer);
    subject.attach(persistence);
    return () => {
      subject.detach(observer);
      subject.detach(persistence);
      persistence.cancel();
    };
  }, [subject, persistence, onChange, onDirtyChange, onSaved]);

  const setContent = useCallback(
    (value: string, opts?: { markDirty?: boolean }) => {
      subject.setContent(value, opts);
    },
    [subject],
  );

  const loadContent = useCallback(
    (value: string) => {
      subject.loadContent(value);
      setContentState(value);
      setIsDirty(false);
    },
    [subject],
  );

  const markSaved = useCallback(
    (value?: string) => {
      subject.markSaved(value);
    },
    [subject],
  );

  const setSelection = useCallback(
    (next: EditorSelection | null) => {
      subject.setSelection(next);
    },
    [subject],
  );

  const dispatchCommand = useCallback((command: EditorCommand): boolean => {
    const handled = onCommandRef.current?.(command);
    if (handled === true) return true;

    // Window-event bridge for future Command / menu integration
    window.dispatchEvent(
      new CustomEvent('concrete:editor-command', { detail: command }),
    );
    return false;
  }, []);

  const undo = useCallback(() => {
    const handled = dispatchCommand({ name: 'undo' });
    if (!handled) {
      // Document-level stub; MDXEditor/Lexical owns real history internally
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }),
      );
    }
  }, [dispatchCommand]);

  const redo = useCallback(() => {
    const handled = dispatchCommand({ name: 'redo' });
    if (!handled) {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'z',
          metaKey: true,
          shiftKey: true,
          bubbles: true,
        }),
      );
    }
  }, [dispatchCommand]);

  const scheduleSave = useCallback(
    (fn?: SaveFn) => {
      const target = fn ?? saveFnRef.current;
      if (!target) return;
      persistence.scheduleSave(target);
    },
    [persistence],
  );

  return useMemo(
    () => ({
      content,
      setContent,
      loadContent,
      markSaved,
      isDirty,
      selection,
      setSelection,
      undo,
      redo,
      dispatchCommand,
      subject,
      persistence,
      scheduleSave,
    }),
    [
      content,
      setContent,
      loadContent,
      markSaved,
      isDirty,
      selection,
      setSelection,
      undo,
      redo,
      dispatchCommand,
      subject,
      persistence,
      scheduleSave,
    ],
  );
}
