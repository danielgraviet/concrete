/**
 * Daytona code runner: snippets run in a Daytona cloud sandbox, so nothing
 * has to be installed locally. Every run gets its own sandbox, deleted as soon
 * as the run settles. Sandboxes are ephemeral with a short idle stop and a
 * hard TTL, so Daytona still removes them if the delete call or the app fails.
 *
 * The default snapshot ships Python (with the common data-science packages)
 * and Node, so there are no image tiers to build. Network is blocked, as with
 * the Docker runner: snippets can't install packages or reach the internet.
 *
 * The API key comes from main through `config.apiKey` (a resolver, so a key
 * saved in Settings takes effect without restarting).
 */
/** Backstops for a sandbox whose delete never arrives: Daytona's idle stop (ephemeral → deleted) and hard TTL. */
const BACKSTOP_IDLE_MINUTES = 1;
const BACKSTOP_TTL_MINUTES = 10;
const RUN_DIR = '/tmp/concrete';
const SESSION_ID = 'concrete-run';
const MAX_OUTPUT_BYTES = 64 * 1024;
/** Extra seconds the API call may take beyond the snippet's own timeout. */
const REQUEST_SLACK_S = 15;
/** Exit status of coreutils `timeout` when it kills the command. */
const TIMEOUT_EXIT_CODE = 124;

const ALIASES = { py: 'python', python3: 'python', ts: 'typescript', js: 'javascript', node: 'javascript' };
const LANGUAGE_NAMES = ['python', 'typescript', 'javascript'];

/** File and shell command for a snippet; null for unsupported languages. */
function resolveTarget(language) {
  const key = String(language ?? '').trim().toLowerCase();
  const name = ALIASES[key] ?? key;
  if (name === 'python') return { file: 'main.py', command: 'python3 -B main.py' };
  // The default snapshot's Node runs TypeScript natively (type stripping), as in the Docker runner.
  if (name === 'typescript') return { file: 'main.ts', command: 'node main.ts' };
  if (name === 'javascript') return { file: 'main.js', command: 'node main.js' };
  return null;
}

/** POSIX single-quote a string for the remote shell. */
function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function clip(text) {
  const value = String(text ?? '');
  return value.length > MAX_OUTPUT_BYTES ? `${value.slice(0, MAX_OUTPUT_BYTES)}\n…output truncated` : value;
}

function fail(error, extra = {}) {
  return { ok: false, stdout: '', stderr: '', exitCode: null, timedOut: false, durationMs: 0, error, ...extra };
}

function missingModuleHint(stderr) {
  const match = /ModuleNotFoundError: No module named '([\w.]+)'/.exec(stderr);
  if (!match) return null;
  return `"${match[1]}" isn't installed in the Daytona sandbox, which has no network access to install it.`;
}

class MissingKeyError extends Error {
  constructor() {
    super('No Daytona API key yet. Add one in Settings → Code execution.');
  }
}

/** User-facing message, and whether a fresh sandbox could help. */
function classifyError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const name = error?.constructor?.name ?? '';
  if (error instanceof MissingKeyError) return { message, retry: false };
  if (name === 'DaytonaAuthenticationError' || name === 'DaytonaForbiddenError' || /\b40[13]\b|unauthori[sz]ed/i.test(message)) {
    return { message: 'Daytona rejected the API key. Check it in Settings → Code execution.', retry: false };
  }
  if (name === 'DaytonaRateLimitError') {
    return { message: 'Daytona is rate limiting requests. Try again in a moment.', retry: false };
  }
  return { message: `Daytona: ${message}`, retry: true };
}

function create({ apiKey = () => null, loadSdk = () => require('@daytonaio/sdk') } = {}) {
  /** Sandboxes created and not yet deleted, so quitting mid-run can clean them up. */
  const live = new Set();

  async function createSandbox(onProgress) {
    const key = apiKey();
    if (!key) throw new MissingKeyError();
    onProgress?.('Starting a Daytona sandbox…');
    const { Daytona } = loadSdk();
    return new Daytona({ apiKey: key }).create({
      language: 'python',
      ephemeral: true,
      autoStopInterval: BACKSTOP_IDLE_MINUTES,
      ttlMinutes: BACKSTOP_TTL_MINUTES,
      networkBlockAll: true,
      labels: { app: 'concrete' },
    });
  }

  function destroy(sandbox) {
    // Don't make the user wait on cleanup; the backstops cover a failed delete.
    void Promise.resolve(sandbox.delete())
      .catch(() => {})
      .finally(() => live.delete(sandbox));
  }

  /** Run `fn` in a fresh sandbox that is deleted as soon as `fn` settles. */
  async function withSandbox(onProgress, fn) {
    const sandbox = await createSandbox(onProgress);
    live.add(sandbox);
    try {
      return await fn(sandbox);
    } finally {
      destroy(sandbox);
    }
  }

  async function execute(sandbox, target, code, timeoutMs) {
    const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
    await sandbox.process.executeCommand(`mkdir -p ${RUN_DIR}`);
    await sandbox.fs.uploadFile(Buffer.from(String(code), 'utf8'), `${RUN_DIR}/${target.file}`);
    // A session command reports stdout and stderr separately (codeRun merges them).
    await sandbox.process.createSession(SESSION_ID);
    return sandbox.process.executeSessionCommand(
      SESSION_ID,
      {
        command: `cd ${RUN_DIR} && PYTHONDONTWRITEBYTECODE=1 timeout ${seconds} sh -c ${shellQuote(target.command)}`,
        runAsync: false,
      },
      seconds + REQUEST_SLACK_S,
    );
  }

  return {
    id: 'daytona',
    label: 'Daytona (cloud)',

    async status() {
      const languages = LANGUAGE_NAMES;
      if (!apiKey()) return { available: false, detail: new MissingKeyError().message, languages, images: [] };
      return { available: true, detail: 'Daytona cloud sandbox', languages, images: [] };
    },

    async run({ language, code, timeoutMs = 8000, onProgress }) {
      const target = resolveTarget(language);
      if (!target) return fail(`Unsupported language: ${language}`);
      const startedAt = Date.now();

      // One retry on a fresh sandbox covers a transient create or exec failure.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await withSandbox(onProgress, (sandbox) => execute(sandbox, target, code, timeoutMs));
          const exitCode = typeof response.exitCode === 'number' ? response.exitCode : null;
          const timedOut = exitCode === TIMEOUT_EXIT_CODE;
          const stderr = clip(response.stderr);
          const hint = exitCode !== 0 && !timedOut ? missingModuleHint(stderr) : null;
          return {
            ok: exitCode === 0,
            stdout: clip(response.stdout ?? response.output),
            stderr,
            exitCode: timedOut ? null : exitCode,
            timedOut,
            durationMs: Date.now() - startedAt,
            ...(timedOut ? { error: `Timed out after ${Math.round(timeoutMs / 1000)}s` } : {}),
            ...(hint ? { error: hint } : {}),
          };
        } catch (error) {
          const { message, retry } = classifyError(error);
          if (!retry || attempt === 1) return fail(message, { durationMs: Date.now() - startedAt });
        }
      }
      return fail('Daytona run failed.');
    },

    /** Delete sandboxes still running (app quit). */
    dispose() {
      for (const sandbox of live) destroy(sandbox);
    },
  };
}

module.exports = { create, resolveTarget, shellQuote };
