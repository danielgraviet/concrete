import type { TelemetrySpan } from '../../telemetry/types';
import type { VaultBackend } from '../types';

const ACTIVITY_KEY = '.vault/ai-activity.jsonl';
const TELEMETRY_KEY = '.vault/ai-telemetry.jsonl';
const ACTIVITY_LIMIT = 200;
const TELEMETRY_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

async function readLines(vault: VaultBackend, key: string): Promise<unknown[]> {
  if (!vault.readData) return [];
  try {
    const text = await vault.readData('', key);
    return (text ?? '').split('\n').filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line) as unknown]; } catch { return []; }
    });
  } catch {
    return [];
  }
}

async function appendLine(vault: VaultBackend, key: string, value: unknown): Promise<boolean> {
  if (!vault.appendData) return false;
  try {
    return await vault.appendData('', key, `${JSON.stringify(value)}\n`);
  } catch {
    return false;
  }
}

export async function readWebAiActivity(vault: VaultBackend): Promise<Array<Record<string, unknown>>> {
  const entries = await readLines(vault, ACTIVITY_KEY);
  return entries
    .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object' && !Array.isArray(entry)))
    .slice(-ACTIVITY_LIMIT)
    .reverse();
}

export async function readWebAiTelemetry(vault: VaultBackend): Promise<TelemetrySpan[]> {
  const cutoff = Date.now() - TELEMETRY_MAX_AGE_MS;
  const entries = await readLines(vault, TELEMETRY_KEY);
  return entries.filter((entry): entry is TelemetrySpan =>
    Boolean(entry && typeof entry === 'object' && !Array.isArray(entry)
      && typeof (entry as TelemetrySpan).startedAt === 'number'
      && (entry as TelemetrySpan).startedAt >= cutoff),
  );
}

export const appendWebAiActivity = (vault: VaultBackend, activity: Record<string, unknown>) =>
  appendLine(vault, ACTIVITY_KEY, activity);

export const appendWebAiTelemetry = (vault: VaultBackend, span: TelemetrySpan) =>
  appendLine(vault, TELEMETRY_KEY, span);

async function clear(vault: VaultBackend, key: string): Promise<boolean> {
  if (!vault.deleteData) return false;
  try { return await vault.deleteData('', key); } catch { return false; }
}

export const clearWebAiActivity = (vault: VaultBackend) => clear(vault, ACTIVITY_KEY);
export const clearWebAiTelemetry = (vault: VaultBackend) => clear(vault, TELEMETRY_KEY);
