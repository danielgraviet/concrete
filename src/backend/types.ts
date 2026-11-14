/**
 * Backend seam: every renderer access to platform services (disk vault, model
 * bridge, sandbox, OS clipboard, …) goes through these interfaces. The desktop
 * (Electron) implementation is a pass-through to the preload bridges; a web
 * implementation plugs into the same shapes.
 *
 * Signatures are derived from the preload bridge types declared on `Window`
 * in `src/vite-env.d.ts`, so the Electron implementation stays a pass-through.
 */

export type VaultBackend = NonNullable<Window['vault']>;
export type AiBackend = NonNullable<Window['ai']>;
export type SandboxBackend = NonNullable<Window['sandbox']>;
export type ClipboardBackend = NonNullable<Window['systemClipboard']>;
export type PerfBackend = NonNullable<Window['perf']>;
export type IntegrationsBackend = NonNullable<Window['integrations']>;

export type BackendTarget = 'desktop' | 'web';

/** Desktop-only features the UI should hide when unavailable (e.g. on web). */
export interface BackendCapabilities {
  /** Claude / Codex CLI agent runs (`ai.agentRun`). */
  localAgents: boolean;
  /** Reveal a vault file in Finder / Explorer (`vault.revealInFolder`). */
  revealInFolder: boolean;
  /** Open a vault file with the OS default app (`vault.openPath`). */
  openWithOsApp: boolean;
  /** Native folder imports: importObsidian / importNotion (desktop only). */
  diskImport: boolean;
  /**
   * "Import file…" into the vault (`vault.importFile`): a native picker on
   * desktop, a browser picker + cloud file storage (PDFs) on web.
   */
  fileImport: boolean;
  /** Print a note to PDF via the hidden Electron window (`vault.exportNotePdf`). */
  nativePdfExport: boolean;
  /** Local activity / trajectories / telemetry pages (`ai.activity`, `ai.telemetry`, …). */
  localTelemetry: boolean;
  /** Code execution sandbox (`sandbox`). */
  sandbox: boolean;
  /** API keys stored by the backend and editable in Settings (`ai.setApiKey`). */
  apiKeySettings: boolean;
}

/**
 * Members are optional: in browser demo mode (or on older Electron builds) a
 * bridge can be missing, and callers keep their optional-chaining fallbacks.
 */
export interface Backend {
  target: BackendTarget;
  vault?: VaultBackend;
  ai?: AiBackend;
  sandbox?: SandboxBackend;
  clipboard?: ClipboardBackend;
  perf?: PerfBackend;
  integrations?: IntegrationsBackend;
  capabilities: BackendCapabilities;
}
