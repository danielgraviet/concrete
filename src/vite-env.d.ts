declare module '*.svg?url' {
  const url: string;
  export default url;
}

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

/** Where a chat completion runs. Claude and Codex use the CLI login or an API key. */
type AiChatBackend = 'openrouter' | 'claude' | 'codex';

interface AiChatCompletionsRequest {
  backend?: AiChatBackend;
  model?: string;
  messages: AiChatMessage[];
  temperature?: number;
  max_tokens?: number;
  operation?: string;
  metadata?: Record<string, unknown>;
  capture?: 'preview' | 'full';
  /** OpenRouter provider routing prefs (order / fallbacks / sort). */
  provider?: {
    order?: string[];
    allow_fallbacks?: boolean;
    sort?: 'price' | 'throughput' | 'latency';
  };
  /** OpenRouter reasoning controls (disable thinking for short fills). */
  reasoning?: {
    enabled?: boolean;
    effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    exclude?: boolean;
  };
}

interface AiChatStreamRequest extends AiChatCompletionsRequest {
  /** Caller-chosen id; tags `onChatDelta` events and targets `chatCancel`. */
  streamId: string;
}

interface AiChatDeltaEvent {
  streamId: string;
  text: string;
}

interface AiChatCompletionsResult {
  content: string;
  model: string;
  usage: unknown;
  requestId?: string;
}

interface AiStatus {
  configured: boolean;
  provider: AiChatBackend;
  model: string | null;
  /** CLI login / API key status for Claude and Codex. */
  message?: string;
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
    readPdf?: (root: string, name: string) => Promise<Uint8Array>;
    write: (root: string, name: string, content: string) => Promise<boolean>;
    create: (root: string, name: string) => Promise<string>;
    /** App data under `.vault/` (JSON/JSONL only). Missing on older Electron builds. */
    readData?: (root: string, name: string) => Promise<string | null>;
    writeData?: (root: string, name: string, content: string) => Promise<boolean>;
    appendData?: (root: string, name: string, content: string) => Promise<boolean>;
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
    /** Picks a PDF from disk and copies it into `folder`. Null when cancelled. */
    importPdf: (root: string, folder: string) => Promise<string | null>;
    /** Raw text per page (capped at 500 pages); `totalPages` is the real count. */
    extractPdfText: (root: string, name: string) => Promise<{ pages: string[]; totalPages: number }>;
    /** Prints a note to a PDF beside it. Returns the vault-relative PDF path. */
    exportNotePdf?: (payload: {
      root: string;
      notePath: string;
      markdown: string;
      title: string;
    }) => Promise<string>;
    /** Job for the hidden export window. Null when nothing is waiting. */
    takePdfExport?: () => Promise<{
      root: string;
      notePath: string;
      markdown: string;
      title: string;
    } | null>;
    /** Tells the main process the export document has finished laying out. */
    pdfExportReady?: () => void;
    /** Local image beside a note, as a data URL. Empty when it cannot be read. */
    readImageDataUrl?: (root: string, notePath: string, src: string) => Promise<string>;
  };
  /** Code execution bridge — the runner (Docker, hosted, …) lives in Electron main. */
  sandbox?: {
    providers: () => Promise<Array<{ id: string; label: string }>>;
    status: (providerId?: string) => Promise<{
      available: boolean;
      detail?: string;
      languages: string[];
      images?: Array<{ id: string; label: string; ready: boolean; buildable?: boolean; sizeHint?: string }>;
    }>;
    prepare: (payload: { providerId?: string; tier: string }) => Promise<{ ok: boolean; error?: string }>;
    onProgress: (callback: (event: { message: string }) => void) => () => void;
    run: (payload: {
      providerId?: string;
      language: string;
      code: string;
      timeoutMs?: number;
      /** false: fail instead of building a missing image (used where a silent multi-minute build is wrong). */
      allowBuild?: boolean;
    }) => Promise<{
      ok: boolean;
      stdout: string;
      stderr: string;
      exitCode: number | null;
      timedOut: boolean;
      durationMs: number;
      error?: string;
    }>;
  };
  /** Model bridge — API keys and CLI logins stay in Electron main. */
  ai?: {
    status: (backend?: AiChatBackend) => Promise<AiStatus>;
    setApiKey: (apiKey: string, backend?: AiChatBackend) => Promise<AiStatus>;
    ping: () => Promise<AiPingResult>;
    chatCompletions: (
      request: AiChatCompletionsRequest,
    ) => Promise<AiChatCompletionsResult>;
    /** Streamed completion; text arrives through onChatDelta. Missing on older Electron builds. */
    chatStream?: (request: AiChatStreamRequest) => Promise<AiChatCompletionsResult>;
    chatCancel?: (streamId: string) => Promise<boolean>;
    onChatDelta?: (callback: (event: AiChatDeltaEvent) => void) => () => void;
    activity: () => Promise<Array<Record<string, unknown>>>;
    trajectories: () => Promise<Array<{ file: string; records: Array<Record<string, unknown>>; location: string }>>;
    activityClear: () => Promise<boolean>;
    telemetry: () => Promise<import('./telemetry/types').TelemetrySpan[]>;
    telemetryClear: () => Promise<boolean>;
    /** Log a renderer-side failure (with the raw model reply) to AI Activity. */
    recordActivity: (event: {
      operation: string;
      status?: 'error' | 'info';
      requestId?: string;
      model?: string;
      error?: string;
      responseText?: string;
      metadata?: Record<string, unknown>;
    }) => Promise<boolean>;
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
  /** Startup / interaction marks forwarded to Electron main logs. */
  perf?: {
    mark: (label: string) => Promise<boolean>;
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
  /** Tutor model the agent's generate_quiz tool should use. */
  aiBackend?: AiChatBackend;
  aiModel?: string;
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
