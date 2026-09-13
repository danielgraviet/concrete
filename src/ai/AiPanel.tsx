import { useState } from 'react';
import type { AiClient } from './AiClient';
import { LocalEchoProvider } from './LocalEchoProvider';
import { MockAiProvider } from './MockAiProvider';

const PROVIDERS = [new MockAiProvider(), new LocalEchoProvider()];

type Props = {
  client: AiClient;
  defaultContext?: string;
  onClose?: () => void;
};

/**
 * Full-screen overlay assistant (legacy). Prefer AiOrb for the editor UX.
 */
export function AiPanel({ client, defaultContext = '', onClose }: Props) {
  const [prompt, setPrompt] = useState('');
  const [context, setContext] = useState(defaultContext);
  const [output, setOutput] = useState('');
  const [busy, setBusy] = useState(false);
  const [providerId, setProviderId] = useState(client.getProvider().id);

  const switchProvider = (id: string) => {
    const next = PROVIDERS.find((p) => p.id === id);
    if (!next) return;
    client.setProvider(next);
    setProviderId(next.id);
  };

  const run = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    try {
      const text = await client.complete({
        prompt: prompt.trim(),
        context: context.trim() || undefined,
      });
      setOutput(text);
    } catch (err) {
      setOutput(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mv-ai-panel">
      <div className="mv-panel-header">
        <div className="mv-panel-label">TUTOR</div>
        {onClose ? (
          <button type="button" className="mv-link" onClick={onClose}>
            Close
          </button>
        ) : null}
      </div>
      <label className="mv-field">
        <span>Provider</span>
        <select value={providerId} onChange={(e) => switchProvider(e.target.value)}>
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label className="mv-field">
        <span>Ask</span>
        <textarea
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ask a short question about this note…"
        />
      </label>
      <label className="mv-field">
        <span>Note context</span>
        <textarea
          rows={3}
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder="Note excerpt…"
        />
      </label>
      <button type="button" className="mv-btn" disabled={busy || !prompt.trim()} onClick={() => void run()}>
        {busy ? 'Working…' : 'Ask'}
      </button>
      {output ? (
        <pre className="mv-ai-output">{output}</pre>
      ) : null}
    </div>
  );
}
