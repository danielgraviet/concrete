/**
 * Code-execution provider registry (factory pattern).
 *
 * A "runner" executes untrusted snippets somewhere isolated. To add a backend
 * (Daytona, E2B, a remote worker, a user-supplied command …):
 *
 *   1. Write a module exporting a `create(config)` that returns a Runner.
 *   2. Register it in `sandbox/index.cjs` with `registerRunner(id, { label, create })`.
 *   3. It shows up in `sandbox:providers`, and the app selects it by id.
 *
 * Runner contract:
 *   id, label
 *   status(): Promise<{ available, detail?, languages, images?: [{ id, label, ready, buildable, sizeHint? }] }>
 *   run({ language, code, timeoutMs, onProgress?, allowBuild? }): Promise<RunResult>
 *   prepare?({ tier, onProgress? }): Promise<{ ok, error? }>   (optional: set up an image/environment ahead of time)
 *   RunResult = { ok, stdout, stderr, exitCode, timedOut, durationMs, error? }
 *
 * Runners must never throw from `run`: report failures as `{ ok: false, error }`.
 * Secrets (API keys) belong in the main process, passed through `config`.
 */

const definitions = new Map();
const instances = new Map();

function registerRunner(id, definition) {
  if (!id || typeof definition?.create !== 'function') {
    throw new Error(`Invalid runner registration: ${id}`);
  }
  definitions.set(id, { label: definition.label ?? id, create: definition.create });
  instances.delete(id);
}

function hasRunner(id) {
  return definitions.has(id);
}

function listRunners() {
  return [...definitions].map(([id, { label }]) => ({ id, label }));
}

/** Returns a cached runner for `id`; unknown ids fall back to `fallbackId`. */
function createRunner(id, fallbackId = 'off', config = {}) {
  const resolved = definitions.has(id) ? id : fallbackId;
  if (!definitions.has(resolved)) throw new Error(`No code runner registered: ${id}`);
  let runner = instances.get(resolved);
  if (!runner) {
    runner = definitions.get(resolved).create(config);
    instances.set(resolved, runner);
  }
  return runner;
}

module.exports = { registerRunner, hasRunner, listRunners, createRunner };
