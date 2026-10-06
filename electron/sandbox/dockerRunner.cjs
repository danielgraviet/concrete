/**
 * Docker code runner: one throwaway, network-less, resource-limited container
 * per snippet. Requires the `docker` CLI and a running daemon (Docker Desktop,
 * Colima, OrbStack, Rancher Desktop …).
 *
 * Images are "tiers" so ordinary code stays fast and small:
 *   python       python:3.12-slim (pulled)
 *   python-data  numpy, pandas, scipy, scikit-learn, sympy (built locally on first use)
 *   node         node:24-slim (pulled; TypeScript via native type stripping)
 * Python snippets are routed to a tier by their imports (see routing.cjs).
 * Containers have no network, so packages must be baked into the image.
 */
const { spawn, execFile } = require('node:child_process');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const { DATA_MODULES, pickPythonTier } = require('./routing.cjs');

const DATA_DOCKERFILE = [
  'FROM python:3.12-slim',
  'ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1',
  'RUN pip install numpy pandas scipy scikit-learn sympy',
  '',
].join('\n');

/** Tag derives from the Dockerfile, so changing the package list rebuilds automatically. */
const DATA_IMAGE = `concrete-sandbox-python-data:${createHash('sha256').update(DATA_DOCKERFILE).digest('hex').slice(0, 10)}`;

const TIERS = {
  python: { id: 'python', label: 'Python', image: 'python:3.12-slim', memory: '256m', pids: 64, env: {} },
  'python-data': {
    id: 'python-data',
    label: `Python data science (${[...DATA_MODULES].join(', ')})`,
    image: DATA_IMAGE,
    dockerfile: DATA_DOCKERFILE,
    sizeHint: '~700 MB, built once',
    memory: '768m',
    pids: 128,
    // BLAS/OpenMP spawn a thread per core; keep them within the pid limit.
    env: { OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '1', MKL_NUM_THREADS: '1' },
  },
  node: { id: 'node', label: 'Node / TypeScript', image: 'node:24-slim', memory: '256m', pids: 64, env: {} },
};

const ALIASES = { py: 'python', python3: 'python', ts: 'typescript', js: 'javascript', node: 'javascript' };
const LANGUAGE_NAMES = ['python', 'typescript', 'javascript'];

/** Which tier, file and command run this snippet; null for unsupported languages. */
function resolveTarget(language, code) {
  const key = String(language ?? '').trim().toLowerCase();
  const name = ALIASES[key] ?? key;
  if (name === 'python') {
    return { tier: TIERS[pickPythonTier(code)], file: 'main.py', command: 'python -B /tmp/main.py' };
  }
  if (name === 'typescript') return { tier: TIERS.node, file: 'main.ts', command: 'node /tmp/main.ts' };
  if (name === 'javascript') return { tier: TIERS.node, file: 'main.js', command: 'node /tmp/main.js' };
  return null;
}

const MAX_OUTPUT_BYTES = 64 * 1024;
const PULL_TIMEOUT_MS = 10 * 60 * 1000;
const BUILD_TIMEOUT_MS = 20 * 60 * 1000;
const DOCKER_START_TIMEOUT_MS = 45 * 1000;
const DOCKER_START_POLL_MS = 1000;

/** GUI apps on macOS get a minimal PATH, so probe the usual install spots. */
function findDocker() {
  const home = os.homedir();
  const candidates = [
    process.env.CONCRETE_DOCKER_PATH,
    '/usr/local/bin/docker',
    '/opt/homebrew/bin/docker',
    '/Applications/Docker.app/Contents/Resources/bin/docker',
    path.join(home, '.docker/bin/docker'),
    path.join(home, '.orbstack/bin/docker'),
    path.join(home, '.rd/bin/docker'),
    '/usr/bin/docker',
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      fsSync.accessSync(candidate, fsSync.constants.X_OK);
      return candidate;
    } catch {
      // try the next one
    }
  }
  return null;
}

function exec(file, args, timeout) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), error });
    });
  });
}

function dockerDesktopInstalled() {
  return process.platform === 'darwin' && fsSync.existsSync('/Applications/Docker.app');
}

function launchDockerDesktop() {
  if (!dockerDesktopInstalled()) return false;
  try {
    const child = spawn('/usr/bin/open', ['-a', 'Docker'], { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/** Start Docker Desktop when it is installed, then wait for its daemon. */
async function ensureDockerReady(docker, onProgress) {
  const initial = await exec(docker, ['info', '--format', '{{.ServerVersion}}'], 6000);
  if (initial.ok) return { ready: true, version: initial.stdout.trim(), started: false };
  if (!launchDockerDesktop()) return { ready: false, started: false };

  onProgress?.('Starting Docker Desktop…');
  const deadline = Date.now() + DOCKER_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await wait(DOCKER_START_POLL_MS);
    const info = await exec(docker, ['info', '--format', '{{.ServerVersion}}'], 6000);
    if (info.ok) return { ready: true, version: info.stdout.trim(), started: true };
  }
  return { ready: false, started: true };
}

/** `docker build -t tag -` with the Dockerfile on stdin (no build context needed). */
function buildImage(docker, tag, dockerfile) {
  return new Promise((resolve) => {
    const child = spawn(docker, ['build', '-t', tag, '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let tail = '';
    const keep = (chunk) => {
      tail = (tail + chunk.toString('utf8')).slice(-2000);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => child.kill('SIGKILL'), BUILD_TIMEOUT_MS);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, tail: error.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, tail });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(dockerfile);
  });
}

function fail(error, extra = {}) {
  return { ok: false, stdout: '', stderr: '', exitCode: null, timedOut: false, durationMs: 0, error, ...extra };
}

function missingModuleHint(stderr, tier) {
  const match = /ModuleNotFoundError: No module named '([\w.]+)'/.exec(stderr);
  if (!match) return null;
  const available =
    tier.id === 'python-data'
      ? `the standard library, ${[...DATA_MODULES].join(', ')}`
      : `the standard library (numpy, pandas, scipy, scikit-learn and sympy switch on automatically when imported)`;
  return `"${match[1]}" isn't installed in the sandbox, which has no network. Available: ${available}.`;
}

function create() {
  const readyImages = new Set();
  const pending = new Map();

  async function imagePresent(docker, tier) {
    if (readyImages.has(tier.image)) return true;
    const inspect = await exec(docker, ['image', 'inspect', tier.image], 15000);
    if (inspect.ok) readyImages.add(tier.image);
    return inspect.ok;
  }

  /** Pull or build the tier's image. Deduplicated so parallel runs share one build. */
  async function ensureImage(docker, tier, onProgress) {
    if (await imagePresent(docker, tier)) return;
    if (!pending.has(tier.id)) {
      pending.set(
        tier.id,
        (async () => {
          if (tier.dockerfile) {
            onProgress?.(`Setting up ${tier.label} — one-time build (${tier.sizeHint}). This can take a few minutes…`);
            const built = await buildImage(docker, tier.image, tier.dockerfile);
            if (!built.ok) throw new Error(`Could not build the ${tier.id} image: ${built.tail.trim().split('\n').slice(-3).join(' ')}`);
          } else {
            onProgress?.(`Downloading ${tier.image}…`);
            const pull = await exec(docker, ['pull', tier.image], PULL_TIMEOUT_MS);
            if (!pull.ok) throw new Error(`Could not pull ${tier.image}: ${pull.stderr.trim() || pull.error?.message}`);
          }
          readyImages.add(tier.image);
        })().finally(() => pending.delete(tier.id)),
      );
    }
    await pending.get(tier.id);
  }

  return {
    id: 'docker',
    label: 'Docker (local)',

    async status() {
      const languages = LANGUAGE_NAMES;
      const docker = findDocker();
      if (!docker) return { available: false, detail: 'Docker is not installed.', languages, images: [] };
      const ready = await ensureDockerReady(docker);
      if (!ready.ready) {
        return {
          available: false,
          detail: dockerDesktopInstalled()
            ? 'Docker Desktop could not be started. Open it and try again.'
            : 'Docker is installed but its runtime is not running.',
          languages,
          images: [],
        };
      }
      const images = await Promise.all(
        Object.values(TIERS).map(async (tier) => ({
          id: tier.id,
          label: tier.label,
          ready: await imagePresent(docker, tier),
          // Only images that must be built are worth offering to set up ahead of time.
          buildable: Boolean(tier.dockerfile),
          sizeHint: tier.sizeHint,
        })),
      );
      return { available: true, detail: `Docker ${ready.version}`, languages, images };
    },

    /** Build/pull a tier's image ahead of time (e.g. from Settings). */
    async prepare({ tier: tierId, onProgress } = {}) {
      const tier = TIERS[tierId];
      if (!tier) return fail(`Unknown image: ${tierId}`);
      const docker = findDocker();
      if (!docker) return fail('Docker is not installed.');
      try {
        const ready = await ensureDockerReady(docker, onProgress);
        if (!ready.ready) return fail('Docker is installed but its runtime could not be started.');
        await ensureImage(docker, tier, onProgress);
        return { ok: true };
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    },

    async run({ language, code, timeoutMs = 8000, onProgress, allowBuild = true }) {
      const target = resolveTarget(language, code);
      if (!target) return fail(`Unsupported language: ${language}`);
      const { tier } = target;
      const docker = findDocker();
      if (!docker) return fail('Docker is not installed.');
      try {
        const ready = await ensureDockerReady(docker, onProgress);
        if (!ready.ready) return fail('Docker is installed but its runtime could not be started.');
        if (!allowBuild && tier.dockerfile && !(await imagePresent(docker, tier))) {
          return fail(`The ${tier.id} image hasn't been set up yet.`);
        }
        await ensureImage(docker, tier, onProgress);
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }

      const name = `concrete-run-${randomBytes(6).toString('hex')}`;
      const envArgs = Object.entries({ PYTHONDONTWRITEBYTECODE: '1', HOME: '/tmp', ...tier.env }).flatMap(([k, v]) => [
        '-e',
        `${k}=${v}`,
      ]);
      const args = [
        'run', '--rm', '-i', '--name', name,
        '--network', 'none',
        '--memory', tier.memory, '--memory-swap', tier.memory,
        '--cpus', '1', '--pids-limit', String(tier.pids),
        '--read-only', '--tmpfs', '/tmp:rw,exec,size=32m',
        '--user', '65534:65534',
        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        ...envArgs,
        tier.image,
        'sh', '-c', `cat > /tmp/${target.file} && ${target.command}`,
      ];

      return new Promise((resolve) => {
        const startedAt = Date.now();
        const child = spawn(docker, args, { stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        let truncated = false;
        let timedOut = false;
        let settled = false;

        const append = (current, chunk) => {
          if (current.length >= MAX_OUTPUT_BYTES) {
            truncated = true;
            return current;
          }
          return current + chunk.toString('utf8');
        };
        child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
        child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });

        const timer = setTimeout(() => {
          timedOut = true;
          execFile(docker, ['kill', name], () => {});
          child.kill('SIGKILL');
          // Don't wait on pipes a stray grandchild might hold open.
          finish({ ok: false, exitCode: null, error: `Timed out after ${Math.round(timeoutMs / 1000)}s` });
        }, Math.max(1000, timeoutMs));

        const finish = (result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const hint = !result.ok && !timedOut ? missingModuleHint(stderr, tier) : null;
          resolve({
            stdout: truncated ? `${stdout.slice(0, MAX_OUTPUT_BYTES)}\n…output truncated` : stdout,
            stderr: stderr.slice(0, MAX_OUTPUT_BYTES),
            timedOut,
            durationMs: Date.now() - startedAt,
            ...result,
            ...(hint ? { error: hint } : {}),
          });
        };

        child.on('error', (error) => finish({ ok: false, exitCode: null, error: error.message }));
        child.on('close', (exitCode) => finish({ ok: !timedOut && exitCode === 0, exitCode }));

        child.stdin.on('error', () => {});
        child.stdin.end(String(code));
      });
    },
  };
}

module.exports = { create, resolveTarget, TIERS };
