import type { Backend, BackendCapabilities } from '../types';
import { AiProxyClient } from './aiProxyClient';
import { createWebAi } from './createWebAi';

export { AiProxyClient, AiProxyError, aiProxyErrorMessage } from './aiProxyClient';
export type {
  AiProxyChatRequest,
  AiProxyChatResult,
  AiProxyClientOptions,
  AiProxyErrorCode,
  AiProxyQuota,
} from './aiProxyClient';
export { createWebAi, WEB_AI_MODEL_LABEL } from './createWebAi';

export type IdTokenSource = () => Promise<string | null>;

const signedOut: IdTokenSource = async () => null;
let idTokenSource: IdTokenSource = signedOut;

/**
 * Where the web AI backend gets the caller's Firebase ID token. Auth wiring
 * calls this once (e.g. `() => auth.currentUser?.getIdToken() ?? null`);
 * pass `null` to reset to signed-out.
 */
export function setWebIdTokenSource(source: IdTokenSource | null): void {
  idTokenSource = source ?? signedOut;
}

/** Current token (or null when signed out). Reads the source on every call. */
export function getWebIdToken(): Promise<string | null> {
  return idTokenSource();
}

let proxyClient: AiProxyClient | null = null;

/**
 * Shared proxy client (null when `VITE_AI_PROXY_URL` is unset). Useful for UI
 * that wants `getQuota()` directly.
 */
export function getAiProxyClient(): AiProxyClient | null {
  const baseUrl = import.meta.env?.VITE_AI_PROXY_URL?.trim();
  if (!baseUrl) return null;
  proxyClient ??= new AiProxyClient({ baseUrl, getIdToken: getWebIdToken });
  return proxyClient;
}

const NO_CAPABILITIES: BackendCapabilities = {
  localAgents: false,
  revealInFolder: false,
  openWithOsApp: false,
  diskImport: false,
  fileImport: false,
  nativePdfExport: false,
  localTelemetry: false,
  sandbox: false,
  apiKeySettings: false,
};

/**
 * Web backend: AI via the proxy Worker when configured; the session mounts a
 * cloud vault on `vault` after sign-in. Every desktop-only capability is off.
 * `fileImport` follows the mounted vault: the cloud vault only exposes
 * `readPdf` (and a working `importFile`) when file storage is configured.
 */
export function createWebBackend(): Backend {
  const client = getAiProxyClient();
  const backend: Backend = {
    target: 'web',
    ...(client ? { ai: createWebAi(client) } : {}),
    capabilities: {
      ...NO_CAPABILITIES,
      get fileImport() {
        return typeof backend.vault?.readPdf === 'function';
      },
    },
  };
  return backend;
}
