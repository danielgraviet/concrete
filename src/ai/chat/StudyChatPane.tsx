import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  CheckIcon,
  CopyIcon,
  CounterClockwiseClockIcon,
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
import { ChatSessionList } from './ChatSessionList';
import { asBlockquote, chatHistory } from './history';
import type { ChatSessionStore } from './sessionStore';
import type { StudyChatMessage, StudyChatMode } from './threadStore';

export type ChatInsertTarget = 'cursor' | 'end';

type Props = {
  client: AiClient;
  /** Open note path ('' when none); sent as context with each question. */
  notePath: string;
  noteContent: string;
  vaultRoot: string | null;
  /** Vault-wide sessions; the active one follows the user across notes. */
  sessions: ChatSessionStore;
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
  sessions,
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
  const [historyOpen, setHistoryOpen] = useState(false);

  useSyncExternalStore(sessions.subscribe, sessions.getVersion);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  const messages = sessions.messages();

  // Turns write to the session they started in, even if the user switches mid-reply.
  const updateThread = useCallback(
    (sessionId: string, fn: (messages: StudyChatMessage[]) => StudyChatMessage[]) =>
      sessions.update(sessionId, fn),
    [sessions],
  );

  const patchMessage = useCallback(
    (sessionId: string, id: string, patch: Partial<StudyChatMessage>) => {
      updateThread(sessionId, (list) => list.map((m) => (m.id === id ? { ...m, ...patch } : m)));
    },
    [updateThread],
  );

  const persist = useCallback((sessionId: string) => sessions.save(sessionId), [sessions]);

  useEffect(() => {
    void ensureKatexCss();
  }, []);

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
      const sessionId = sessions.ensureActive();
      const userMsg: StudyChatMessage = {
        id: newId(),
        role: 'user',
        mode: 'chat',
        text: prompt,
        ...(path ? { notePath: path } : {}),
        ...(quote ? { quote } : {}),
      };
      const replyId = newId();
      const history = chatHistory([...sessions.messages(sessionId), userMsg]);
      updateThread(sessionId, (list) => [
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
        patchMessage(sessionId, replyId, { text: streamed });
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
        patchMessage(sessionId, replyId, { text });
      } catch (err) {
        if (frame) cancelAnimationFrame(frame);
        const message = err instanceof Error ? err.message : 'Request failed';
        const text = abort.signal.aborted
          ? streamed || '_Stopped._'
          : streamed
            ? `${streamed}\n\n_${message}_`
            : message;
        patchMessage(sessionId, replyId, { text, error: true });
      } finally {
        abortRef.current = null;
        setBusy(false);
        setStreamingId(null);
        persist(sessionId);
      }
    },
    [busy, client, includeNote, noteContent, notePath, patchMessage, persist, quote, sessions, updateThread],
  );

  const sendAgent = useCallback(
    async (raw: string) => {
      const prompt = raw.trim();
      if (!prompt || busy) return;
      const path = notePath;
      const sessionId = sessions.ensureActive();
      const push = (...items: Omit<StudyChatMessage, 'id' | 'mode'>[]) =>
        updateThread(sessionId, (list) => [
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
      const userMsg = { role: 'user' as const, text: prompt, ...(path ? { notePath: path } : {}) };
      if (blocked || !vaultRoot) {
        push(userMsg, { role: 'assistant', text: blocked ?? '' });
        persist(sessionId);
        return;
      }

      push(userMsg);
      setBusy(true);
      const appendLog = (text: string, kind = 'status') => {
        const trimmed = text.trim();
        if (!trimmed) return;
        updateThread(sessionId, (list) => {
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
        persist(sessionId);
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
      sessions,
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
    sessions.startNew();
    setHistoryOpen(false);
    setQuote(null);
    inputRef.current?.focus();
  };

  const openSession = (id: string) => {
    setHistoryOpen(false);
    stickToBottomRef.current = true;
    void sessions.open(id).then(() => inputRef.current?.focus());
  };

  const copy = (message: StudyChatMessage) => {
    void navigator.clipboard?.writeText(message.text).then(() => {
      setCopiedId(message.id);
      window.setTimeout(() => setCopiedId((id) => (id === message.id ? null : id)), 1200);
    });
  };

  const insertDisabledReason = canInsert ? undefined : 'Open a Markdown note to insert';
  // Mark where the conversation moved to another note.
  const noteChanges = new Set<string>();
  let lastNote: string | undefined;
  for (const m of messages) {
    if (m.role !== 'user' || !m.notePath) continue;
    if (m.notePath !== lastNote) noteChanges.add(m.id);
    lastNote = m.notePath;
  }

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
          className={`study-chat-icon${historyOpen ? ' active' : ''}`}
          onClick={() => setHistoryOpen((open) => !open)}
          title="Chat history"
          aria-label="Chat history"
          aria-pressed={historyOpen}
        >
          <CounterClockwiseClockIcon />
        </button>
        <button
          type="button"
          className="study-chat-icon"
          onClick={newChat}
          disabled={busy || messages.length === 0}
          title="New chat"
          aria-label="New chat"
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

      {historyOpen ? (
        <ChatSessionList
          sessions={sessions.sessions()}
          activeId={sessions.activeId}
          onOpen={openSession}
          onDelete={(id) => sessions.remove(id)}
        />
      ) : (
      <div
        className="study-chat-messages"
        ref={listRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {messages.length === 0 ? (
          <div className="study-chat-empty">
            <p>Let’s make it concrete.</p>
          </div>
        ) : (
          messages.map((msg) => {
            if (msg.role === 'log') {
              return (
                <div key={msg.id} className={`study-chat-log log-${msg.kind || 'status'}`}>
                  {msg.text}
                </div>
              );
            }
            if (msg.role === 'user') {
              return (
                <div key={msg.id} className="study-chat-turn">
                  {msg.notePath && noteChanges.has(msg.id) ? (
                    <div className="study-chat-note-change" title={msg.notePath}>
                      <FileTextIcon />
                      <span>{noteTitle(msg.notePath)}</span>
                    </div>
                  ) : null}
                  <div className="study-chat-user">
                    {msg.mode === 'agent' ? <span className="study-chat-user-mode">{agentLabel}</span> : null}
                    {msg.quote ? <blockquote>{msg.quote}</blockquote> : null}
                    <div>{msg.text}</div>
                  </div>
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
      )}

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
