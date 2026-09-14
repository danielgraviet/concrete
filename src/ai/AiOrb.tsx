import { useCallback, useEffect, useRef, useState } from 'react';
import { BotMessageSquare } from 'lucide-react';
import type { AiClient } from './AiClient';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'log';
  text: string;
  kind?: string;
};

export type OrbMode = 'tutor' | 'agent';

type Props = {
  client: AiClient;
  noteContext: string;
  notePath: string;
  vaultRoot: string | null;
  /** Settings → Agent → Codex (BYO). */
  agentEnabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, open the panel and send this prompt once (tutor mode). */
  seedPrompt?: string | null;
  onSeedConsumed?: () => void;
  /** Flush open note before agent edits; force-reload after. */
  onBeforeAgentRun?: () => Promise<void>;
  onAfterAgentRun?: () => Promise<void>;
};

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Floating tutor / agent control bottom-right of the editor pane.
 */
export function AiOrb({
  client,
  noteContext,
  notePath,
  vaultRoot,
  agentEnabled,
  open,
  onOpenChange,
  seedPrompt = null,
  onSeedConsumed,
  onBeforeAgentRun,
  onAfterAgentRun,
}: Props) {
  const [mode, setMode] = useState<OrbMode>('tutor');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const seedRef = useRef<string | null>(null);

  const appendLog = useCallback((text: string, kind = 'status') => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      // Collapse repeated status lines (e.g. many "Thinking…")
      if (
        last?.role === 'log' &&
        last.kind === kind &&
        kind === 'status' &&
        last.text === trimmed
      ) {
        return prev;
      }
      return [...prev, { id: newId(), role: 'log', kind, text: trimmed }];
    });
  }, []);

  const sendTutor = useCallback(
    async (raw: string) => {
      const prompt = raw.trim();
      if (!prompt || busy) return;
      const userMsg: ChatMessage = { id: newId(), role: 'user', text: prompt };
      setMessages((prev) => [...prev, userMsg]);
      setInput('');
      setBusy(true);
      try {
        const text = await client.complete({
          prompt,
          context: noteContext || undefined,
        });
        setMessages((prev) => [...prev, { id: newId(), role: 'assistant', text }]);
      } catch (err) {
        const text = err instanceof Error ? err.message : 'Request failed';
        setMessages((prev) => [...prev, { id: newId(), role: 'assistant', text }]);
      } finally {
        setBusy(false);
      }
    },
    [busy, client, noteContext],
  );

  const sendAgent = useCallback(
    async (raw: string) => {
      const prompt = raw.trim();
      if (!prompt || busy) return;

      if (!agentEnabled) {
        setMessages((prev) => [
          ...prev,
          { id: newId(), role: 'user', text: prompt },
          {
            id: newId(),
            role: 'assistant',
            text: 'Agent is off. Enable Codex (BYO) in Settings → Agent.',
          },
        ]);
        setInput('');
        return;
      }

      if (!vaultRoot) {
        setMessages((prev) => [
          ...prev,
          { id: newId(), role: 'user', text: prompt },
          {
            id: newId(),
            role: 'assistant',
            text: 'Open a vault first so Codex has a folder to edit.',
          },
        ]);
        setInput('');
        return;
      }

      if (typeof window.ai?.agentRun !== 'function') {
        setMessages((prev) => [
          ...prev,
          { id: newId(), role: 'user', text: prompt },
          {
            id: newId(),
            role: 'assistant',
            text: 'Agent bridge missing. Fully restart Electron after updating.',
          },
        ]);
        setInput('');
        return;
      }

      setMessages((prev) => [...prev, { id: newId(), role: 'user', text: prompt }]);
      setInput('');
      setBusy(true);

      const stopProgress = window.ai.onAgentProgress?.((event) => {
        appendLog(event.text, event.kind);
      });

      try {
        await onBeforeAgentRun?.();
        appendLog(
          notePath ? `Starting on ${notePath}…` : 'Starting Codex…',
          'status',
        );
        const result = await window.ai.agentRun({
          vaultRoot,
          notePath: notePath || null,
          prompt,
        });
        const changed =
          result.changedPaths?.length > 0
            ? `\n\nChanged: ${result.changedPaths.join(', ')}`
            : '';
        setMessages((prev) => [
          ...prev,
          {
            id: newId(),
            role: 'assistant',
            text: `${result.finalResponse || 'Done.'}${changed}`,
          },
        ]);
        await onAfterAgentRun?.();
      } catch (err) {
        const text = err instanceof Error ? err.message : 'Agent failed';
        setMessages((prev) => [...prev, { id: newId(), role: 'assistant', text }]);
      } finally {
        stopProgress?.();
        setBusy(false);
      }
    },
    [
      agentEnabled,
      appendLog,
      busy,
      notePath,
      onAfterAgentRun,
      onBeforeAgentRun,
      vaultRoot,
    ],
  );

  const send = useCallback(
    async (raw: string) => {
      if (mode === 'agent') return sendAgent(raw);
      return sendTutor(raw);
    },
    [mode, sendAgent, sendTutor],
  );

  useEffect(() => {
    if (!seedPrompt?.trim()) {
      seedRef.current = null;
      return;
    }
    if (seedRef.current === seedPrompt) return;
    seedRef.current = seedPrompt;
    setMode('tutor');
    onOpenChange(true);
    void sendTutor(seedPrompt);
    onSeedConsumed?.();
  }, [seedPrompt, onOpenChange, onSeedConsumed, sendTutor]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, open, busy]);

  const cancelAgent = () => {
    void window.ai?.agentCancel?.();
  };

  return (
    <div className="ai-orb-root">
      {open ? (
        <div className="ai-orb-panel" role="dialog" aria-label="Tutor chat">
          <div className="ai-orb-panel-head">
            <div className="ai-orb-mode">
              <button
                type="button"
                className={mode === 'tutor' ? 'active' : ''}
                onClick={() => setMode('tutor')}
                disabled={busy}
              >
                Tutor
              </button>
              <button
                type="button"
                className={mode === 'agent' ? 'active' : ''}
                onClick={() => setMode('agent')}
                disabled={busy}
              >
                Agent
              </button>
            </div>
            {busy && mode === 'agent' ? (
              <button type="button" className="ai-orb-close" onClick={cancelAgent}>
                Cancel
              </button>
            ) : (
              <button
                type="button"
                className="ai-orb-close"
                onClick={() => onOpenChange(false)}
              >
                Close
              </button>
            )}
          </div>
          <div className="ai-orb-messages" ref={listRef}>
            {messages.length === 0 ? (
              <p className="ai-orb-empty">
                {mode === 'agent'
                  ? agentEnabled
                    ? 'Ask Codex to edit this note (add sections, rewrite, expand).'
                    : 'Enable Codex (BYO) in Settings → Agent to edit notes.'
                  : 'Ask about this note or Markdown. Short answers only.'}
              </p>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`ai-orb-bubble ${
                    msg.role === 'user'
                      ? 'user'
                      : msg.role === 'log'
                        ? `log log-${msg.kind || 'status'}`
                        : 'assistant'
                  }`}
                >
                  {msg.text}
                </div>
              ))
            )}
            {busy && mode === 'tutor' ? (
              <div className="ai-orb-bubble assistant muted">Thinking…</div>
            ) : null}
          </div>
          <form
            className="ai-orb-form"
            onSubmit={(event) => {
              event.preventDefault();
              void send(input);
            }}
          >
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={
                mode === 'agent'
                  ? 'e.g. Add a ## Summary section…'
                  : 'Ask a short question…'
              }
              disabled={busy}
              aria-label={mode === 'agent' ? 'Message agent' : 'Message tutor'}
            />
            <button type="submit" disabled={busy || !input.trim()}>
              Send
            </button>
          </form>
        </div>
      ) : null}

      <button
        type="button"
        className={`ai-orb ${open ? 'open' : ''}`}
        title={open ? 'Hide chat' : 'Ask tutor or agent'}
        aria-label={open ? 'Hide chat' : 'Ask tutor or agent'}
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        <BotMessageSquare size={22} aria-hidden />
      </button>
    </div>
  );
}
