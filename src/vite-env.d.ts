type VaultWatchType = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';

interface VaultWatchEvent {
  type: VaultWatchType;
  path: string;
  root: string;
}

interface VaultOpenResult {
  root: string;
  files: string[];
  /** Non-markdown files also shown in the tree (currently exported PDFs). */
  pdfFiles: string[];
  folders: string[];
}

interface VaultListResult {
  files: string[];
  pdfFiles: string[];
  folders: string[];
}

interface AiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface AiChatCompletionsRequest {
  model?: string;
  messages: AiChatMessage[];
  temperature?: number;
  max_tokens?: number;
  operation?: string;
  metadata?: Record<string, unknown>;
  capture?: 'preview' | 'full';
}

interface AiChatCompletionsResult {
  content: string;
  model: string;
  usage: unknown;
  requestId?: string;
}

interface AiStatus {
  configured: boolean;
  provider: string;
  model: string;
  keySuffix?: string | null;
  keyLength?: number;
}

interface AiPingResult {
  ok: boolean;
  status: number;
  model: string;
  keySuffix: string;
  content?: string | null;
  error?: string;
}

interface Window {
  /** Present only in the Electron renderer (missing in browser demo mode). */
  vault?: {
    open: () => Promise<VaultOpenResult | null>;
    list: (root: string) => Promise<VaultListResult>;
    read: (root: string, name: string) => Promise<string>;
    write: (root: string, name: string, content: string) => Promise<boolean>;
    create: (root: string, name: string) => Promise<string>;
    mkdir: (root: string, name: string) => Promise<string>;
    ensureDefault: () => Promise<VaultOpenResult>;
    importObsidian: (root: string) => Promise<VaultOpenResult>;
    restore: () => Promise<VaultOpenResult | null>;
    rename: (root: string, from: string, to: string) => Promise<string>;
    delete: (root: string, name: string) => Promise<boolean>;
    watchStart: (root: string) => Promise<boolean>;
    watchStop: () => Promise<boolean>;
    onWatch: (callback: (event: VaultWatchEvent) => void) => () => void;
    offWatch: (callback: (event: VaultWatchEvent) => void) => void;
    /** Opens a vault-relative file with the OS default app (e.g. a PDF viewer). */
    openPath: (root: string, name: string) => Promise<boolean>;
    /** Reveals a vault-relative file in Finder / Explorer. */
    revealInFolder: (root: string, name: string) => Promise<boolean>;
  };
  /** OpenRouter bridge — key stays in Electron main. */
  ai?: {
    status: () => Promise<AiStatus>;
    setApiKey: (apiKey: string) => Promise<AiStatus>;
    ping: () => Promise<AiPingResult>;
    chatCompletions: (
      request: AiChatCompletionsRequest,
    ) => Promise<AiChatCompletionsResult>;
    activity: () => Promise<Array<Record<string, unknown>>>;
    activityClear: () => Promise<boolean>;
    agentStatus: (request?: AiAgentStatusRequest) => Promise<AiAgentStatus>;
    agentRun: (request: AiAgentRunRequest) => Promise<AiAgentRunResult>;
    agentCancel: () => Promise<boolean>;
    onAgentProgress: (
      callback: (event: AiAgentProgressEvent) => void,
    ) => () => void;
    onSetTheme: (
      callback: (payload: { themePack: string }) => void,
    ) => () => void;
  };
  /** Electron system pasteboard (plain text for terminals / other apps). */
  systemClipboard?: {
    writeText: (text: string) => Promise<boolean>;
  };
}

interface AiAgentStatus {
  available: boolean;
  authenticated: boolean;
  cliPath: string | null;
  message: string;
}

interface AiAgentStatusRequest {
  agentProviderId?: 'codex' | 'claude';
}

interface AiAgentRunRequest {
  vaultRoot: string;
  notePath?: string | null;
  prompt: string;
  agentProviderId?: 'codex' | 'claude';
}

interface AiAgentRunResult {
  ok: boolean;
  finalResponse: string;
  threadId: string | null;
  changedPaths: string[];
}

interface AiAgentProgressEvent {
  kind: string;
  text: string;
}

declare module '*.css';
