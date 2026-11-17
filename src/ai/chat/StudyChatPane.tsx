import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  CheckIcon,
  CopyIcon,
  CounterClockwiseClockIcon,
  Cross2Icon,
  CursorTextIcon,
  FileTextIcon,
  LayersIcon,
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
import { settingsStore } from '../../settings/SettingsStore';
import { ChatMarkdown } from './ChatMarkdown';
import { ChatSessionList } from './ChatSessionList';
import { asBlockquote, chatHistory } from './history';
import type { ChatSessionStore } from './sessionStore';
import type { StudyChatMessage, StudyChatMode } from './threadStore';
import { getBackend } from '../../backend';
import type { VaultListResult } from '../../vault/types';

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
  /** Model id/alias to request from the BYO agent's own CLI; '' = CLI default. */
  agentModelId?: string;
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

function compactAgentProgress(kind: string | undefined, text: string): string | null {
  if (kind === 'progress') return text;
  if (kind === 'error') return text;
  if (kind === 'tool') {
    if (/excalidraw\.create_view/i.test(text)) return 'Creating diagram preview…';
    if (/excalidraw/i.test(text)) return 'Using Excalidraw…';
    if (/concrete/i.test(text)) return 'Using app tools…';
    return null;
  }
  if (kind === 'file') return 'Updated note';
  if (kind !== 'status') return null;
  if (/^editing\s/i.test(text)) return 'Preparing note…';
  if (/preparing file edits/i.test(text)) return 'Updating note…';
  if (/excalidraw mcp connected/i.test(text)) return 'Excalidraw MCP ready';
  return null;
}

function noteTitle(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.md$/i, '') || 'Untitled';
}

type VaultAgentAction = { type: string; path?: string; from?: string; to?: string; content?: string };

type VaultAgentPlan = { done: boolean; actions?: VaultAgentAction[]; response?: string };

function vaultAgentPath(path: unknown): string {
  if (typeof path !== 'string') throw new Error('Path must be text.');
  const clean = path.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!clean || clean.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Use a non-empty path inside the vault.');
  }
  return clean;
}

function parseVaultAgentPlan(raw: string): VaultAgentPlan {
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error('The web agent returned an invalid action plan.');
  const value = JSON.parse(json) as Partial<VaultAgentPlan>;
  if (typeof value.done !== 'boolean' || (value.actions !== undefined && !Array.isArray(value.actions))) {
    throw new Error('The web agent returned an invalid action plan.');
  }
  return value as VaultAgentPlan;
}

const WEB_AGENT_SYSTEM = `You are the helpful assistant in a user's online Markdown vault. Answer ordinary questions directly. When the user asks to organize, create, move, rename, or otherwise change vault files, use the available actions to do that work. Infer whether they want an action from their request; do not require a special command or mention. For ordinary questions or hypotheticals that do not ask for a change, return a direct answer with done:true and no actions. Reply with exactly one JSON object and no markdown: {"done":boolean,"actions":[],"response":"..."}. Available tool calls: {"type":"list","path":"optional folder"} lists vault folders, Markdown files, and PDFs; {"type":"read","path":"vault relative file"} reads a Markdown or PDF; {"type":"mkdir","path":"folder"} creates a folder; {"type":"move","from":"existing path","to":"new path"} moves a note, quiz, PDF, or folder; {"type":"create","path":"new .md path","content":"markdown"} creates a Markdown note. You can list/read first, then use another turn to act. Preserve all existing content, quizzes, PDFs, and folders while organizing. Never invent mappings; inspect filenames and note contents when needed. Never overwrite, delete, or move anything outside the user's requested scope. Avoid moving a folder into itself. If the request is unclear, ask a question in response and return done:true with no actions. Use done:true after work is complete, with a concise response.`;

async function runWebVaultAgent(args: {
  client: AiClient;
  root: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  noteContext?: { path: string; content: string };
  signal: AbortSignal;
  onProgress: (text: string) => void;
}): Promise<{ response: string; changed: string[] }> {
  const vault = getBackend().vault;
  if (!vault) throw new Error('Open a signed-in online vault to use file tools.');
  let tree: VaultListResult = await vault.list(args.root);
  const results: string[] = [];
  const changed: string[] = [];
  const listText = (path = '') => {
    const prefix = path ? `${path}/` : '';
    return JSON.stringify({
      folders: tree.folders.filter((item) => !prefix || item === path || item.startsWith(prefix)),
      files: tree.files.filter((item) => !prefix || item.startsWith(prefix)),
      pdfFiles: tree.pdfFiles.filter((item) => !prefix || item.startsWith(prefix)),
    });
  };
  const known = () => new Set([...tree.files, ...tree.pdfFiles, ...tree.folders]);
  for (let turn = 0; turn < 10; turn += 1) {
    if (args.signal.aborted) throw new DOMException('Stopped', 'AbortError');
    const userMessages = args.history.filter((m) => m.role === 'user');
    const userContent = JSON.stringify({
      userRequest: userMessages[userMessages.length - 1]?.content ?? '',
      conversation: args.history,
      ...(args.noteContext ? { openNote: args.noteContext } : {}),
      currentVaultTree: JSON.parse(listText()),
      priorToolResults: results,
      instructions: 'Choose at most 8 actions in this turn. Use list/read to inspect before changing anything. Return done:false when more inspection or action turns are needed.',
    });
    const raw = await args.client.chat({
      system: WEB_AGENT_SYSTEM,
      messages: [{ role: 'user', content: userContent }],
      signal: args.signal,
      maxTokens: 1800,
      operation: 'web_vault_agent_plan',
    });
    const plan = parseVaultAgentPlan(raw);
    if (plan.done) return { response: plan.response?.trim() || 'Done.', changed };
    const actions = plan.actions ?? [];
    if (!actions.length) throw new Error('The web agent did not provide an action or a response.');
    if (actions.length > 8 || changed.length >= 20) throw new Error('The web agent reached its safe action limit.');
    for (const action of actions) {
      if (args.signal.aborted) throw new DOMException('Stopped', 'AbortError');
      const type = action.type;
      let result = '';
      if (type === 'list') {
        const path = action.path ? vaultAgentPath(action.path) : '';
        result = listText(path);
      } else if (type === 'read') {
        const path = vaultAgentPath(action.path);
        if (tree.files.includes(path)) result = (await vault.read(args.root, path)).slice(0, 12000);
        else if (tree.pdfFiles.includes(path) && vault.extractPdfText) result = (await vault.extractPdfText(args.root, path)).pages.join('\n').slice(0, 12000);
        else throw new Error(`Can't read ${path}; it is not an available Markdown or PDF file.`);
      } else if (type === 'mkdir') {
        const path = vaultAgentPath(action.path);
        if (known().has(path)) throw new Error(`Destination already exists: ${path}`);
        await vault.mkdir(args.root, path);
        changed.push(path);
        tree = await vault.list(args.root);
        result = `Created folder ${path}`;
      } else if (type === 'move') {
        const from = vaultAgentPath(action.from);
        const to = vaultAgentPath(action.to);
        const existing = known();
        if (!existing.has(from)) throw new Error(`Source no longer exists: ${from}`);
        if ([...existing].some((path) => path === to || path.startsWith(`${to}/`)) || from === to || to.startsWith(`${from}/`)) {
          throw new Error(`Move destination is occupied or unsafe: ${to}`);
        }
        await vault.rename(args.root, from, to);
        changed.push(`${from} → ${to}`);
        tree = await vault.list(args.root);
        result = `Moved ${from} to ${to}`;
      } else if (type === 'create') {
        const path = vaultAgentPath(action.path);
        if (!path.toLowerCase().endsWith('.md')) throw new Error('New notes must use the .md extension.');
        if (known().has(path)) throw new Error(`Destination already exists: ${path}`);
        const created = await vault.create(args.root, path);
        await vault.write(args.root, created, typeof action.content === 'string' ? action.content : '');
        changed.push(created);
        tree = await vault.list(args.root);
        result = `Created note ${created}`;
      } else {
        throw new Error(`Unsupported web agent action: ${String(type)}`);
      }
      results.push(`${type}: ${result.slice(0, 12000)}`);
      args.onProgress(type === 'read' || type === 'list' ? 'Reviewing vault files…' : 'Organizing vault files…');
    }
  }
  throw new Error('The web agent reached its planning limit before finishing.');
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
  agentModelId,
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
  const agentLabel = getBackend().target === 'web' ? 'Vault agent' : agentProviderId === 'claude' ? 'Claude' : 'Codex';
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
      const useExcalidrawMcp = settingsStore.get().excalidrawMcpEnabled || /(?:^|\s)@excalidraw\b/i.test(prompt);
      const sessionId = sessions.ensureActive();
      const push = (...items: Omit<StudyChatMessage, 'id' | 'mode'>[]) =>
        updateThread(sessionId, (list) => [
          ...list,
          ...items.map((item) => ({ ...item, id: newId(), mode: 'agent' as const })),
        ]);
      setInput('');
      stickToBottomRef.current = true;

      const isWebVaultAgent = getBackend().target === 'web';
      const blocked = isWebVaultAgent
        ? !vaultRoot || !getBackend().vault ? 'Open your online vault before asking the agent to organize files.' : null
        : !agentEnabled
          ? 'Agent is off. Enable Codex or Claude (BYO) in Settings → Agent.'
          : !vaultRoot
            ? `Open a vault first so ${agentLabel} has a folder to edit.`
            : !getBackend().capabilities.localAgents
              ? 'Agent bridge missing. Fully restart Electron after updating.'
              : null;
      const userMsg = { role: 'user' as const, text: prompt, ...(path ? { notePath: path } : {}) };
      if (blocked || !vaultRoot) {
        push(userMsg, { role: 'assistant', text: blocked ?? '' });
        setMode('chat');
        persist(sessionId);
        return;
      }

      push(userMsg);
      setBusy(true);
      const appendLog = (text: string, kind = 'status') => {
        const summary = compactAgentProgress(kind, text.trim());
        if (!summary) return;
        updateThread(sessionId, (list) => {
          const last = list[list.length - 1];
          if (last?.role === 'log' && last.mode === 'agent' && last.text === summary) return list;
          return [...list, { id: newId(), role: 'log', mode: 'agent', kind: 'progress', text: summary }];
        });
      };
      appendLog(path ? 'Preparing note…' : 'Starting agent…', 'progress');
      const stopProgress = getBackend().ai?.onAgentProgress?.((event) => appendLog(event.text, event.kind));

      try {
        if (getBackend().target === 'web') {
          const abort = new AbortController();
          abortRef.current = abort;
          appendLog('Thinking…', 'progress');
          const outcome = await runWebVaultAgent({
            client,
            root: vaultRoot,
            history: sessions.messages(sessionId)
              .filter((message) => message.role === 'user' || message.role === 'assistant')
              .map((message) => ({ role: message.role as 'user' | 'assistant', content: message.text })),
            noteContext: includeNote && path ? { path, content: noteContent } : undefined,
            signal: abort.signal,
            onProgress: (message) => appendLog(message, 'progress'),
          });
          const changed = outcome.changed.length ? `\n\nChanged: ${outcome.changed.join(', ')}` : '';
          push({ role: 'assistant', text: `${outcome.response}${changed}` });
          return;
        }
        await onBeforeAgentRun?.();
        const tutor = client.getProvider();
        const result = await getBackend().ai!.agentRun({
          vaultRoot,
          notePath: path || null,
          prompt,
          agentProviderId: agentProviderId === 'claude' ? 'claude' : 'codex',
          // Model the BYO agent's own CLI should use; '' lets the CLI pick its default.
          ...(agentModelId ? { agentModel: agentModelId } : {}),
          excalidrawMcpEnabled: useExcalidrawMcp,
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
        abortRef.current = null;
        stopProgress?.();
        setBusy(false);
        setMode('chat');
        persist(sessionId);
      }
    },
    [
      agentEnabled,
      agentLabel,
      agentProviderId,
      agentModelId,
      busy,
      client,
      includeNote,
      notePath,
      noteContent,
      onAfterAgentRun,
      onBeforeAgentRun,
      persist,
      sessions,
      updateThread,
      vaultRoot,
    ],
  );

  // Desktop uses its local runner; web mode uses authenticated cloud-vault tools.
  const localAgents = getBackend().capabilities.localAgents;
  const webVaultAgent = getBackend().target === 'web' && Boolean(vaultRoot && getBackend().vault);
  const send = (raw: string) =>
    (webVaultAgent || (localAgents && (mode === 'agent' || /(?:^|\s)@(agent|excalidraw)\b/i.test(raw))))
      ? sendAgent(raw)
      : sendChat(raw);

  const seedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!seedPrompt?.trim()) {
      seedRef.current = null;
      return;
    }
    if (seedRef.current === seedPrompt || busy) return;
    seedRef.current = seedPrompt;
    setMode('chat');
    void send(seedPrompt);
    onSeedConsumed?.();
  }, [seedPrompt, busy, onSeedConsumed, send]);

  const stop = () => {
    if (mode === 'agent' && getBackend().target !== 'web') void getBackend().ai?.agentCancel?.();
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
  const mentionMatch = /(?:^|\s)@([\w-]*)$/.exec(input);
  const mentionQuery = mentionMatch?.[1]?.toLowerCase() ?? null;
  const mentionSuggestions = mentionQuery === null || (!localAgents && !webVaultAgent) ? [] : [
    ...(localAgents && 'excalidraw'.startsWith(mentionQuery) ? [{ key: 'excalidraw', title: 'Excalidraw', detail: 'Create or edit a diagram in this Markdown note', badge: 'MCP' }] : []),
    ...('agent'.startsWith(mentionQuery) ? [{ key: 'agent', title: 'Agent', detail: webVaultAgent ? 'Organize and create files in your online vault' : 'Ask the agent to edit files or use app tools', badge: 'Agent' }] : []),
  ];
  const usesExcalidraw = localAgents && /(?:^|\s)@excalidraw\b/i.test(input);

  const selectMention = (mention: 'agent' | 'excalidraw') => {
    if (!mentionMatch) return;
    const start = input.length - mentionMatch[0].length;
    const nextInput = `${input.slice(0, start)}${mentionMatch[0].startsWith(' ') ? ' ' : ''}@${mention} `;
    setInput(nextInput);
    setMode('agent');
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(nextInput.length, nextInput.length);
    });
  };
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
              const progress = msg.mode === 'agent' ? compactAgentProgress(msg.kind, msg.text) : null;
              return progress ? <div key={msg.id} className="study-chat-log log-progress">{progress}</div> : null;
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
                        {getBackend().capabilities.openWithOsApp ? (
                          <button type="button" onClick={() => void getBackend().vault?.openPath(vaultRoot, pdfPath)}>
                            Open PDF
                          </button>
                        ) : null}
                        {getBackend().capabilities.revealInFolder ? (
                          <button
                            type="button"
                            onClick={() => void getBackend().vault?.revealInFolder(vaultRoot, pdfPath)}
                          >
                            Reveal in Finder
                          </button>
                        ) : null}
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
        {mentionSuggestions.length > 0 ? (
          <div className="study-chat-mention-menu" role="listbox" aria-label="Agent tools">
            {mentionSuggestions.map((suggestion) => (
              <button
                key={suggestion.key}
                type="button"
                role="option"
                aria-selected="true"
                className="study-chat-mention-option"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectMention(suggestion.key as 'agent' | 'excalidraw')}
              >
                <span className="study-chat-mention-icon"><LayersIcon /></span>
                <span className="study-chat-mention-copy">
                  <strong>{suggestion.title}</strong>
                  <small>{suggestion.detail}</small>
                </span>
                <span className="study-chat-mention-badge">{suggestion.badge}</span>
              </button>
            ))}
          </div>
        ) : null}
        {usesExcalidraw ? (
          <div className="study-chat-tool-indicator" role="status">
            <LayersIcon /> <span>Excalidraw MCP will be used for this request</span>
          </div>
        ) : null}
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
            onChange={(event) => {
              const nextInput = event.target.value;
              setInput(nextInput);
              setMode((localAgents || webVaultAgent) && /(?:^|\s)@(agent|excalidraw)\b/i.test(nextInput) ? 'agent' : 'chat');
            }}
            onKeyDown={(event) => {
              if (mentionSuggestions.length > 0 && (event.key === 'Enter' || event.key === 'Tab')) {
                event.preventDefault();
                selectMention(mentionSuggestions[0].key as 'agent' | 'excalidraw');
                return;
              }
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send(input);
              }
            }}
            placeholder={quote ? 'Ask about the excerpt…' : 'Ask a question or type @ for tools…'}
            aria-label="Message chat or agent"
            disabled={busy}
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
