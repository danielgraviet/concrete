import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import {
  CheckIcon,
  CopyIcon,
  Cross2Icon,
  CursorTextIcon,
  FileTextIcon,
  PaperPlaneIcon,
  Pencil2Icon,
  QuoteIcon,
  StopIcon,
  TextAlignBottomIcon,
} from '@radix-ui/react-icons';
import type { AiClient } from '../AiClient';
import { ChatModelProvider } from '../ChatModelProvider';
import { buildStudyChatSystemPrompt } from '../systemPrompt';
import { ensureKatexCss } from '../../editor/math/ensureKatexCss';
import type { AgentProviderId } from '../../settings/types';
import { ChatMarkdown } from './ChatMarkdown';
import { asBlockquote, chatHistory } from './history';
import {
  loadThread,
  saveThread,
  type StudyChatMessage,
  type StudyChatMode,
} from './threadStore';

export type ChatInsertTarget = 'cursor' | 'end';

type Props = {
  client: AiClient;
  /** Open note path ('' when none). Threads are kept per note. */
  notePath: string;
  noteContent: string;
  vaultRoot: string | null;
  agentProviderId: AgentProviderId;
  /** False when the open file is not an editable Markdown note. */
  canInsert: boolean;
  onInsert: (markdown: string, target: ChatInsertTarget) => void;
  onClose: () => void;
  /** Send this prompt once (slash menu handoff). */
  seedPrompt?: string | null;
  onSeedConsumed?: () => void;
  /** Note excerpt to attach to the next question (⌘L). */
  pendingQuote?: string | null;
  onQuoteConsumed?: () => void;
  /** Bump to move focus into the composer. */
  focusToken?: number;
  /** Flush open note before agent edits; force-reload after. */
  onBeforeAgentRun?: () => Promise<void>;
  onAfterAgentRun?: () => Promise<void>;
};

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function noteTitle(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.md$/i, '') || 'Untitled';
}

/**
 * Split-pane study chat beside the note. Replies stream in, render math, and
 * go into the note with one click (whole reply or a single block).
 */
export function StudyChatPane({
  client,
  notePath,
  noteContent,
  vaultRoot,
  agentProviderId,
  canInsert,
  onInsert,
  onClose,
  seedPrompt = null,
  onSeedConsumed,
  pendingQuote = null,
  onQuoteConsumed,
  focusToken = 0,
  onBeforeAgentRun,
  onAfterAgentRun,
}: Props) {
  const agentEnabled = agentProviderId !== 'off';
  const agentLabel = agentProviderId === 'claude' ? 'Claude' : 'Codex';
  const [mode, setMode] = useState<StudyChatMode>('chat');
  const [input, setInput] = useState('');
  const [quote, setQuote] = useState<string | null>(null);
  const [includeNote, setIncludeNote] = useState(true);
  const [busy, setBusy] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Threads live in a ref so async turns can read and save the latest copy.
  const threadsRef = useRef<Record<string, StudyChatMessage[]>>({});
  const loadedRef = useRef(new Set<string>());
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  const messages = threadsRef.current[notePath] ?? [];

  const updateThread = useCallback(
    (path: string, fn: (messages: StudyChatMessage[]) => StudyChatMessage[]) => {
      threadsRef.current = { ...threadsRef.current, [path]: fn(threadsRef.current[path] ?? []) };
      rerender();
    },
    [],
  );

  const patchMessage = useCallback(
    (path: string, id: string, patch: Partial<StudyChatMessage>) => {
      updateThread(path, (list) => list.map((m) => (m.id === id ? { ...m, ...patch } : m)));
    },
    [updateThread],
  );

  const persist = useCallback(
    (path: string) => void saveThread(vaultRoot, path, threadsRef.current[path] ?? []),
    [vaultRoot],
  );

  useEffect(() => {
    void ensureKatexCss();
  }, []);

  // Load the open note's saved thread once per session.
  useEffect(() => {
    if (!notePath || loadedRef.current.has(notePath)) return;
    loadedRef.current.add(notePath);
    let cancelled = false;
    void loadThread(vaultRoot, notePath).then((saved) => {
      if (cancelled || saved.length === 0) return;
      // Keep anything sent while the file was loading.
      updateThread(notePath, (current) => [...saved, ...current]);
    });
    return () => {
      cancelled = true;
    };
  }, [notePath, vaultRoot, updateThread]);

  // The attached excerpt belongs to the note it came from.
  useEffect(() => {
    setQuote(null);
    stickToBottomRef.current = true;
  }, [notePath]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  });

  // Grow the composer with its content, up to a cap.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [input]);

  useEffect(() => {
    if (focusToken > 0) inputRef.current?.focus();
  }, [focusToken]);

  useEffect(() => {
    if (!pendingQuote?.trim()) return;
    setQuote(pendingQuote.trim());
    setMode('chat');
    onQuoteConsumed?.();
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [pendingQuote, onQuoteConsumed]);

  const sendChat = useCallback(
    async (raw: string) => {
      const prompt = raw.trim();
      if (!prompt || busy) return;
      const path = notePath;
      const userMsg: StudyChatMessage = {
        id: newId(),
        role: 'user',
        mode: 'chat',
        text: prompt,
        ...(quote ? { quote } : {}),
      };
      const replyId = newId();
      const history = chatHistory([...(threadsRef.current[path] ?? []), userMsg]);
      updateThread(path, (list) => [
        ...list,
        userMsg,
        { id: replyId, role: 'assistant', mode: 'chat', text: '' },
      ]);
      setInput('');
      setQuote(null);
      setBusy(true);
      setStreamingId(replyId);
      stickToBottomRef.current = true;

      const abort = new AbortController();
      abortRef.current = abort;
      // Re-render once per frame, not once per token.
      let streamed = '';
      let frame = 0;
      const flush = () => {
        frame = 0;
        patchMessage(path, replyId, { text: streamed });
      };

      try {
        const text = await client.chat({
          system: buildStudyChatSystemPrompt(
            includeNote && path ? { path, content: noteContent } : undefined,
          ),
          messages: history,
          signal: abort.signal,
          onDelta: (chunk) => {
            streamed += chunk;
            if (!frame) frame = requestAnimationFrame(flush);
          },
        });
        if (frame) cancelAnimationFrame(frame);
        patchMessage(path, replyId, { text });
      } catch (err) {
        if (frame) cancelAnimationFrame(frame);
        const message = err instanceof Error ? err.message : 'Request failed';
        const text = abort.signal.aborted
          ? streamed || '_Stopped._'
          : streamed
            ? `${streamed}\n\n_${message}_`
            : message;
        patchMessage(path, replyId, { text, error: true });
      } finally {
        abortRef.current = null;
        setBusy(false);
        setStreamingId(null);
        persist(path);
      }
    },
    [busy, client, includeNote, noteContent, notePath, patchMessage, persist, quote, updateThread],
  );

  const sendAgent = useCallback(
    async (raw: string) => {
      const prompt = raw.trim();
      if (!prompt || busy) return;
      const path = notePath;
      const push = (...items: Omit<StudyChatMessage, 'id' | 'mode'>[]) =>
        updateThread(path, (list) => [
          ...list,
          ...items.map((item) => ({ ...item, id: newId(), mode: 'agent' as const })),
        ]);
      setInput('');
      stickToBottomRef.current = true;

      const blocked = !agentEnabled
        ? 'Agent is off. Enable Codex or Claude (BYO) in Settings → Agent.'
        : !vaultRoot
          ? `Open a vault first so ${agentLabel} has a folder to edit.`
          : typeof window.ai?.agentRun !== 'function'
            ? 'Agent bridge missing. Fully restart Electron after updating.'
            : null;
      if (blocked || !vaultRoot) {
        push({ role: 'user', text: prompt }, { role: 'assistant', text: blocked ?? '' });
        return;
      }

      push({ role: 'user', text: prompt });
      setBusy(true);
      const appendLog = (text: string, kind = 'status') => {
        const trimmed = text.trim();
        if (!trimmed) return;
        updateThread(path, (list) => {
          const last = list[list.length - 1];
          // Collapse repeated status lines (e.g. many "Thinking…").
          if (last?.role === 'log' && last.kind === kind && kind === 'status' && last.text === trimmed) {
            return list;
          }
          return [...list, { id: newId(), role: 'log', mode: 'agent', kind, text: trimmed }];
        });
      };
      const stopProgress = window.ai?.onAgentProgress?.((event) => appendLog(event.text, event.kind));

      try {
        await onBeforeAgentRun?.();
        appendLog(path ? `Starting on ${path}…` : `Starting ${agentLabel}…`);
        const tutor = client.getProvider();
        const result = await window.ai!.agentRun({
          vaultRoot,
          notePath: path || null,
          prompt,
          agentProviderId: agentProviderId === 'claude' ? 'claude' : 'codex',
          // The agent's generate_quiz tool writes quizzes with the tutor's model.
          ...(tutor instanceof ChatModelProvider ? { aiBackend: tutor.id, aiModel: tutor.model } : {}),
        });
        const changed = result.changedPaths?.length
          ? `\n\nChanged: ${result.changedPaths.join(', ')}`
          : '';
        const pdfPaths = (result.changedPaths ?? []).filter((p) => p.toLowerCase().endsWith('.pdf'));
        push({
          role: 'assistant',
          text: `${result.finalResponse || 'Done.'}${changed}`,
          ...(pdfPaths.length ? { pdfPaths } : {}),
        });
        await onAfterAgentRun?.();
      } catch (err) {
        push({ role: 'assistant', text: err instanceof Error ? err.message : 'Agent failed', error: true });
      } finally {
        stopProgress?.();
        setBusy(false);
        persist(path);
      }
    },
    [
      agentEnabled,
      agentLabel,
      agentProviderId,
      busy,
      client,
      notePath,
      onAfterAgentRun,
      onBeforeAgentRun,
      persist,
      updateThread,
      vaultRoot,
    ],
  );

  const send = (raw: string) => (mode === 'agent' ? sendAgent(raw) : sendChat(raw));

  const seedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!seedPrompt?.trim()) {
      seedRef.current = null;
      return;
    }
    if (seedRef.current === seedPrompt || busy) return;
    seedRef.current = seedPrompt;
    setMode('chat');
    void sendChat(seedPrompt);
    onSeedConsumed?.();
  }, [seedPrompt, busy, onSeedConsumed, sendChat]);

  const stop = () => {
    if (mode === 'agent') void window.ai?.agentCancel?.();
    else abortRef.current?.abort();
  };

  const newChat = () => {
    if (busy) return;
    updateThread(notePath, (list) => list.filter((m) => m.mode !== mode));
    persist(notePath);
    setQuote(null);
    inputRef.current?.focus();
  };

  const copy = (message: StudyChatMessage) => {
    void navigator.clipboard?.writeText(message.text).then(() => {
      setCopiedId(message.id);
      window.setTimeout(() => setCopiedId((id) => (id === message.id ? null : id)), 1200);
    });
  };

  const insertDisabledReason = canInsert ? undefined : 'Open a Markdown note to insert';
  // Chat and Agent keep separate transcripts for the same note.
  const visible = messages.filter((m) => m.mode === mode);

  return (
    <section className="study-chat" aria-label="Study chat">
      <header className="study-chat-head">
        <div className="study-chat-mode" role="tablist" aria-label="Chat mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'chat'}
            className={mode === 'chat' ? 'active' : ''}
            onClick={() => setMode('chat')}
            disabled={busy}
          >
            Chat
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'agent'}
            className={mode === 'agent' ? 'active' : ''}
            onClick={() => setMode('agent')}
            disabled={busy}
          >
            Agent
          </button>
        </div>
        <span className="study-chat-model" title={client.getProvider().label}>
          {client.getProvider().label}
        </span>
        <button
          type="button"
          className="study-chat-icon"
          onClick={newChat}
          disabled={busy || visible.length === 0}
          title="New chat for this note"
          aria-label="New chat for this note"
        >
          <Pencil2Icon />
        </button>
        <button
          type="button"
          className="study-chat-icon"
          onClick={onClose}
          title="Close chat (⌘J)"
          aria-label="Close chat"
        >
          <Cross2Icon />
        </button>
      </header>

      <div
        className="study-chat-messages"
        ref={listRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {visible.length === 0 ? (
          <div className="study-chat-empty">
            <p>Let’s make it concrete.</p>
          </div>
        ) : (
          visible.map((msg) => {
            if (msg.role === 'log') {
              return (
                <div key={msg.id} className={`study-chat-log log-${msg.kind || 'status'}`}>
                  {msg.text}
                </div>
              );
            }
            if (msg.role === 'user') {
              return (
                <div key={msg.id} className="study-chat-user">
                  {msg.quote ? <blockquote>{msg.quote}</blockquote> : null}
                  <div>{msg.text}</div>
                </div>
              );
            }
            const streaming = msg.id === streamingId;
            const insertable = msg.mode === 'chat' && !streaming && Boolean(msg.text.trim()) && !msg.error;
            return (
              <article
                key={msg.id}
                className={`study-chat-reply${msg.error ? ' error' : ''}${streaming ? ' streaming' : ''}`}
              >
                {msg.text ? (
                  <ChatMarkdown
                    text={msg.text}
                    onInsertBlock={
                      insertable && canInsert ? (md) => onInsert(md, 'cursor') : undefined
                    }
                  />
                ) : (
                  <div className="study-chat-thinking" aria-label="Thinking">
                    <span />
                    <span />
                    <span />
                  </div>
                )}
                {msg.pdfPaths?.length && vaultRoot ? (
                  <div className="study-chat-pdfs">
                    {msg.pdfPaths.map((pdfPath) => (
                      <div key={pdfPath}>
                        <span>{pdfPath}</span>
                        <button type="button" onClick={() => void window.vault?.openPath(vaultRoot, pdfPath)}>
                          Open PDF
                        </button>
                        <button
                          type="button"
                          onClick={() => void window.vault?.revealInFolder(vaultRoot, pdfPath)}
                        >
                          Reveal in Finder
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                {insertable ? (
                  <div className="study-chat-actions">
                    <button
                      type="button"
                      disabled={!canInsert}
                      title={insertDisabledReason ?? 'Insert at the cursor in your note'}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => onInsert(msg.text, 'cursor')}
                    >
                      <CursorTextIcon /> Insert
                    </button>
                    <button
                      type="button"
                      disabled={!canInsert}
                      title={insertDisabledReason ?? 'Add to the end of your note'}
                      onClick={() => onInsert(msg.text, 'end')}
                    >
                      <TextAlignBottomIcon /> Append
                    </button>
                    <button
                      type="button"
                      disabled={!canInsert}
                      title={insertDisabledReason ?? 'Insert at the cursor as a quote'}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => onInsert(asBlockquote(msg.text), 'cursor')}
                    >
                      <QuoteIcon /> Quote
                    </button>
                    <button type="button" title="Copy Markdown" onClick={() => copy(msg)}>
                      {copiedId === msg.id ? <CheckIcon /> : <CopyIcon />}
                      {copiedId === msg.id ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })
        )}
      </div>

      <form
        className="study-chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send(input);
        }}
      >
        {mode === 'chat' && (notePath || quote) ? (
          <div className="study-chat-chips">
            {notePath ? (
              <button
                type="button"
                className={`study-chat-chip${includeNote ? '' : ' off'}`}
                onClick={() => setIncludeNote((v) => !v)}
                title={includeNote ? 'The note is sent with each question. Click to leave it out.' : 'Click to send the note with each question'}
                aria-pressed={includeNote}
              >
                <FileTextIcon />
                <span>{noteTitle(notePath)}</span>
              </button>
            ) : null}
            {quote ? (
              <span className="study-chat-chip quote" title={quote}>
                <QuoteIcon />
                <span>{quote.replace(/\s+/g, ' ').slice(0, 80)}</span>
                <button type="button" aria-label="Remove excerpt" onClick={() => setQuote(null)}>
                  <Cross2Icon />
                </button>
              </span>
            ) : null}
          </div>
        ) : null}
        <div className="study-chat-input">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send(input);
              }
            }}
            placeholder={
              mode === 'agent'
                ? `Ask ${agentLabel} to edit this note…`
                : quote
                  ? 'Ask about the excerpt…'
                  : 'Ask a question…'
            }
            aria-label={mode === 'agent' ? 'Message agent' : 'Message study chat'}
          />
          {busy ? (
            <button type="button" className="study-chat-send stop" onClick={stop} title="Stop" aria-label="Stop">
              <StopIcon />
            </button>
          ) : (
            <button
              type="submit"
              className="study-chat-send"
              disabled={!input.trim()}
              title="Send (Enter)"
              aria-label="Send"
            >
              <PaperPlaneIcon />
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
