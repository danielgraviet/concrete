import { useCallback, useEffect, useRef, useState } from 'react';
import { BotMessageSquare } from 'lucide-react';
import type { AiClient } from './AiClient';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
};

type Props = {
  client: AiClient;
  noteContext: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, open the panel and send this prompt once. */
  seedPrompt?: string | null;
  onSeedConsumed?: () => void;
};

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Floating tutor control bottom-right of the editor pane.
 * Click toggles a compact chat panel above the icon.
 */
export function AiOrb({
  client,
  noteContext,
  open,
  onOpenChange,
  seedPrompt = null,
  onSeedConsumed,
}: Props) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const seedRef = useRef<string | null>(null);

  const send = useCallback(
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

  useEffect(() => {
    if (!seedPrompt?.trim()) {
      seedRef.current = null;
      return;
    }
    if (seedRef.current === seedPrompt) return;
    seedRef.current = seedPrompt;
    onOpenChange(true);
    void send(seedPrompt);
    onSeedConsumed?.();
  }, [seedPrompt, onOpenChange, onSeedConsumed, send]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  return (
    <div className="ai-orb-root">
      {open ? (
        <div className="ai-orb-panel" role="dialog" aria-label="Tutor chat">
          <div className="ai-orb-panel-head">
            <span>Tutor</span>
            <button type="button" className="ai-orb-close" onClick={() => onOpenChange(false)}>
              Close
            </button>
          </div>
          <div className="ai-orb-messages" ref={listRef}>
            {messages.length === 0 ? (
              <p className="ai-orb-empty">Ask about this note or Markdown. Short answers only.</p>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`ai-orb-bubble ${msg.role === 'user' ? 'user' : 'assistant'}`}
                >
                  {msg.text}
                </div>
              ))
            )}
            {busy ? <div className="ai-orb-bubble assistant muted">Thinking…</div> : null}
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
              placeholder="Ask a short question…"
              disabled={busy}
              aria-label="Message tutor"
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
        title={open ? 'Hide tutor' : 'Ask tutor'}
        aria-label={open ? 'Hide tutor' : 'Ask tutor'}
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        <BotMessageSquare size={22} aria-hidden />
      </button>
    </div>
  );
}
