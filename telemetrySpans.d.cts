import type { TelemetrySpan } from './src/telemetry/types';

type Collector = {
  traceId: string;
  ingest(event: unknown, atMs?: number): void;
  finish(options?: { status?: TelemetrySpan['status']; error?: string | null; endedAt?: number }): TelemetrySpan[];
};

export function normalizeUsage(usage: unknown): { tokens: TelemetrySpan['tokens']; costUsd: number | null };
export function createSpanCollector(options: {
  traceId: string;
  backend: string;
  model?: string | null;
  source?: string;
  startedAt?: number;
  costSource?: TelemetrySpan['costSource'];
}): Collector;
export function chatSpan(options: Record<string, unknown>): TelemetrySpan;
export function spansFromLegacyActivity(records: unknown[]): TelemetrySpan[];
export function spansFromTrajectory(records: unknown[]): TelemetrySpan[];
