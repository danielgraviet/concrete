/** Renderer-side access to the code-execution bridge (runner lives in Electron main). */

export type SandboxImage = {
  id: string;
  label: string;
  ready: boolean;
  /** True when the image is built locally and can be set up ahead of time. */
  buildable?: boolean;
  sizeHint?: string;
};

export type SandboxStatus = {
  available: boolean;
  detail?: string;
  languages: string[];
  images?: SandboxImage[];
};

export type SandboxRunResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  error?: string;
};

export type SandboxRunRequest = {
  language: string;
  code: string;
  timeoutMs?: number;
  /** false: never start a long image build for this run. */
  allowBuild?: boolean;
};

const UNAVAILABLE: SandboxStatus = {
  available: false,
  detail: 'Code execution needs the desktop app.',
  languages: [],
};

const RUNNABLE_LANGUAGES = new Set([
  'python', 'py', 'python3',
  'typescript', 'ts',
  'javascript', 'js', 'node',
]);

/** Languages the sandbox runners can execute (used to decide where to show Run). */
export function isRunnableLanguage(language: string | null | undefined): boolean {
  return RUNNABLE_LANGUAGES.has(String(language ?? '').trim().toLowerCase());
}

export async function getSandboxStatus(providerId?: string): Promise<SandboxStatus> {
  if (typeof window === 'undefined' || !window.sandbox?.status) return UNAVAILABLE;
  try {
    return await window.sandbox.status(providerId);
  } catch {
    return UNAVAILABLE;
  }
}

export async function runSandboxCode(
  request: SandboxRunRequest,
  providerId?: string,
): Promise<SandboxRunResult> {
  if (typeof window === 'undefined' || !window.sandbox?.run) {
    return {
      ok: false, stdout: '', stderr: '', exitCode: null, timedOut: false, durationMs: 0,
      error: UNAVAILABLE.detail,
    };
  }
  return window.sandbox.run({ ...request, providerId });
}

/** Progress messages for long setup steps (e.g. building the data-science image). */
export function onSandboxProgress(callback: (message: string) => void): () => void {
  if (typeof window === 'undefined' || !window.sandbox?.onProgress) return () => {};
  return window.sandbox.onProgress((event) => callback(event.message));
}

export async function prepareSandboxImage(
  tier: string,
  providerId?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (typeof window === 'undefined' || !window.sandbox?.prepare) {
    return { ok: false, error: UNAVAILABLE.detail };
  }
  return window.sandbox.prepare({ providerId, tier });
}
