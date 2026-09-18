const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const SECRET_KEY = /(api[_-]?key|authorization|token|password|secret|cookie|set-cookie)/i;
const MAX_STRING = 200_000;

function redact(value, key = '') {
  if (SECRET_KEY.test(key)) return '[REDACTED]';
  if (typeof value === 'string') {
    const clipped = value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}\n[TRUNCATED]` : value;
    return clipped
      .replace(/(Bearer\s+)[^\s]+/gi, '$1[REDACTED]')
      .replace(/(sk-[A-Za-z0-9_-]{12,})/g, '[REDACTED_API_KEY]');
  }
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]));
  }
  return value;
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function relativePath(root, file) {
  if (!file || !root) return file || null;
  const relative = path.relative(path.resolve(root), path.resolve(file));
  return relative && !relative.startsWith('..') ? relative.split(path.sep).join('/') : file;
}

async function createTrajectory({ provider, vaultRoot, notePath, prompt }) {
  const trajectoryId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID()}`;
  // Keep trajectories beside the user's Concrete documents, but outside the
  // selected Markdown vault so the normal vault index never sees them.
  const directory = path.join(
    process.env.CONCRETE_TRAJECTORY_DIR || path.join(require('electron').app.getPath('documents'), 'Concrete', 'agent-trajectories'),
  );
  const file = path.join(directory, `${trajectoryId}.jsonl`);
  await fs.mkdir(directory, { recursive: true });
  const startedAt = new Date().toISOString();
  let writeQueue = Promise.resolve();
  const append = (record) => {
    const line = `${JSON.stringify(redact({ trajectoryId, ...record }))}\n`;
    writeQueue = writeQueue.then(() => fs.appendFile(file, line, { mode: 0o600 }));
    return writeQueue;
  };
  await append({
    type: 'trajectory.started', timestamp: startedAt, provider,
    vaultRoot: hash(path.resolve(vaultRoot)), notePath: relativePath(vaultRoot, notePath),
    prompt,
  });
  return {
    trajectoryId,
    record: (type, data = {}) => append({ type, timestamp: new Date().toISOString(), ...data }),
    finish: (data = {}) => append({ type: 'trajectory.finished', timestamp: new Date().toISOString(), ...data, durationMs: Date.now() - Date.parse(startedAt) }),
  };
}

module.exports = { createTrajectory, relativePath };
