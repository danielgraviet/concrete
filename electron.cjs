const { app, BrowserWindow, dialog, ipcMain, Menu, clipboard } = require('electron');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const chokidar = require('chokidar');

let mainWindow = null;
let watcher = null;
let watchedRoot = null;

const AI_SETTINGS_PATH = path.join(app.getPath('userData'), 'ai-settings.json');
const APP_STATE_PATH = path.join(app.getPath('userData'), 'app-state.json');

function savedVaultPath() {
  try {
    const state = JSON.parse(fsSync.readFileSync(APP_STATE_PATH, 'utf8'));
    return typeof state.lastVaultPath === 'string' ? state.lastVaultPath : null;
  } catch { return null; }
}

async function saveVaultPath(root) {
  await fs.mkdir(path.dirname(APP_STATE_PATH), { recursive: true });
  await fs.writeFile(APP_STATE_PATH, JSON.stringify({ lastVaultPath: root }), { mode: 0o600 });
}

function configuredApiKey() {
  try {
    const saved = JSON.parse(fsSync.readFileSync(AI_SETTINGS_PATH, 'utf8'));
    if (typeof saved.openRouterApiKey === 'string' && saved.openRouterApiKey.trim()) {
      return saved.openRouterApiKey.trim();
    }
  } catch {}
  return process.env.OPENROUTER_API_KEY?.trim() ?? '';
}

/** @type {{ url: string, token: string } | null} */
let concreteBridgeInfo = null;
/** Latest vault/note context for MCP tool handlers. */
let concreteToolContext = {
  vaultRoot: null,
  notePath: null,
  openRouterModel: null,
};

/** Native Edit roles so Cmd+C / Cmd+V work in the renderer. */
function setupAppMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [isMac ? { role: 'close' } : { role: 'quit' }],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** Load repo-root `.env` into process.env.
 *  File values win over inherited shell env so stale OPENROUTER_* keys
 *  in the parent terminal cannot override a fresh `.env`.
 */
function loadDotEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (!fsSync.existsSync(envPath)) {
      console.warn('[ai] .env not found at', envPath);
      return;
    }
    const text = fsSync.readFileSync(envPath, 'utf8');
    let loaded = 0;
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!key) continue;
      process.env[key] = value;
      loaded += 1;
    }
    const key = process.env.OPENROUTER_API_KEY?.trim() ?? '';
    console.log(
      `[ai] loaded ${loaded} env var(s) from .env; OPENROUTER_API_KEY ${
        key ? `set (…${key.slice(-4)}, len=${key.length})` : 'missing'
      }`,
    );
  } catch (error) {
    console.error('Failed to load .env', error);
  }
}

loadDotEnv();

ipcMain.handle('clipboard:writeText', (_event, text) => {
  if (typeof text !== 'string' || !text) return false;
  // Plain text only — terminals (Cursor, iTerm, etc.) ignore HTML-only pasteboards.
  clipboard.writeText(text);
  return true;
});

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
/** Cheap OpenAI model kept for ai:ping smoke tests. */
const PING_OPENROUTER_MODEL = 'openai/gpt-4o-mini';
/** Default completion model when the renderer omits one. */
const DEFAULT_OPENROUTER_MODEL = 'deepseek/deepseek-v4-flash-0731';

async function ensureConcreteBridge() {
  if (concreteBridgeInfo) return concreteBridgeInfo;
  const bridge = await import(
    pathToFileURL(path.join(__dirname, 'concreteBridge.mjs')).href
  );
  concreteBridgeInfo = await bridge.startConcreteBridge({
    getMainWindow: () => mainWindow,
    getContext: () => ({
      vaultRoot: concreteToolContext.vaultRoot || watchedRoot,
      notePath: concreteToolContext.notePath,
      openRouterModel:
        concreteToolContext.openRouterModel || DEFAULT_OPENROUTER_MODEL,
    }),
    BrowserWindow,
  });
  console.log('[concrete] tool bridge on', concreteBridgeInfo.url);
  return concreteBridgeInfo;
}

function buildConcreteMcpConfig() {
  if (!concreteBridgeInfo) return null;
  const mcpPath = path.join(__dirname, 'concreteMcp.mjs');
  const unpacked = mcpPath.includes(`${path.sep}app.asar${path.sep}`)
    ? mcpPath.replace(
        `${path.sep}app.asar${path.sep}`,
        `${path.sep}app.asar.unpacked${path.sep}`,
      )
    : mcpPath;

  if (!fsSync.existsSync(unpacked)) {
    console.error('[concrete] MCP entry missing:', unpacked);
    return null;
  }

  // Persist bridge creds for CLI fallback (agent shell).
  const bridgeFile = path.join(app.getPath('temp'), 'concrete-bridge.json');
  try {
    fsSync.writeFileSync(
      bridgeFile,
      JSON.stringify({
        url: concreteBridgeInfo.url,
        token: concreteBridgeInfo.token,
      }),
      { mode: 0o600 },
    );
  } catch (error) {
    console.error('[concrete] failed to write bridge file', error);
  }

  const pathPrefix = '/opt/homebrew/bin:/usr/local/bin';
  // Keep this small — Codex flattens env into CLI --config flags (argv limits).
  const mergedEnv = {
    PATH: `${pathPrefix}:${process.env.PATH || ''}`,
    HOME: process.env.HOME || '',
    TMPDIR: process.env.TMPDIR || '',
    USER: process.env.USER || '',
    LANG: process.env.LANG || 'en_US.UTF-8',
    CONCRETE_BRIDGE_URL: concreteBridgeInfo.url,
    CONCRETE_BRIDGE_TOKEN: concreteBridgeInfo.token,
    CONCRETE_BRIDGE_FILE: bridgeFile,
  };

  const cliPathRaw = path.join(__dirname, 'concreteToolCli.mjs');
  const cliPath = cliPathRaw.includes(`${path.sep}app.asar${path.sep}`)
    ? cliPathRaw.replace(
        `${path.sep}app.asar${path.sep}`,
        `${path.sep}app.asar.unpacked${path.sep}`,
      )
    : cliPathRaw;

  /** @type {{ command: string, args: string[], env: Record<string, string>, cliPath: string, bridgeFile: string }} */
  let launch = null;

  // Prefer real Node when available (dev + typical Mac).
  for (const candidate of ['/opt/homebrew/bin/node', '/usr/local/bin/node']) {
    if (fsSync.existsSync(candidate)) {
      launch = {
        command: candidate,
        args: [unpacked],
        env: mergedEnv,
        cliPath,
        bridgeFile,
      };
      break;
    }
  }

  if (!launch) {
    launch = {
      command: process.execPath,
      args: [unpacked],
      env: {
        ...mergedEnv,
        ELECTRON_RUN_AS_NODE: '1',
      },
      cliPath,
      bridgeFile,
    };
  }

  return launch;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#191919',
    title: 'Concrete',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true
    }
  });

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  } else {
    mainWindow.loadURL('http://localhost:5173');
  }

  mainWindow.webContents.on('context-menu', (_event, params) => {
    const items = [];
    if (params.isEditable) {
      items.push(
        { role: 'cut', enabled: params.editFlags.canCut },
        { role: 'copy', enabled: params.editFlags.canCopy },
        { role: 'paste', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', enabled: params.editFlags.canSelectAll },
      );
    } else if (params.selectionText) {
      items.push({ role: 'copy', enabled: params.editFlags.canCopy });
    }
    if (items.length > 0) {
      Menu.buildFromTemplate(items).popup({ window: mainWindow });
    }
  });
}

/** Resolve `name` under `root` and reject path escape. */
function resolveWithinRoot(root, name) {
  if (typeof root !== 'string' || typeof name !== 'string' || !root || !name) {
    throw new Error('Invalid vault path');
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, name);
  const relative = path.relative(resolvedRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path escapes vault root');
  }
  return { resolvedRoot, resolved, relative: toPosix(relative) };
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function assertMarkdown(name) {
  const base = path.basename(name);
  if (!base.toLowerCase().endsWith('.md')) {
    throw new Error('Only .md files are allowed');
  }
}

function ensureMdExtension(name) {
  return name.toLowerCase().endsWith('.md') ? name : `${name}.md`;
}

const SKIP_DIRS = new Set(['.git', 'node_modules', '.obsidian', '.trash', '.vault']);
const MAX_VAULT_FILES = 10000;

/**
 * Recursively list markdown files and folders (including empty folders).
 * @returns {{ files: string[], folders: string[] }}
 */
async function listVaultEntries(root) {
  const resolvedRoot = path.resolve(root);
  const files = [];
  const folders = [];

  async function walk(dir, relBase) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        const nextRel = relBase ? `${relBase}/${entry.name}` : entry.name;
        folders.push(nextRel);
        await walk(path.join(dir, entry.name), nextRel);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
      files.push(relBase ? `${relBase}/${entry.name}` : entry.name);
      if (files.length > MAX_VAULT_FILES) {
        throw new Error(`Vault contains more than ${MAX_VAULT_FILES.toLocaleString()} Markdown files and cannot be opened.`);
      }
    }
  }

  await walk(resolvedRoot, '');
  files.sort((a, b) => a.localeCompare(b));
  folders.sort((a, b) => a.localeCompare(b));
  return { files, folders };
}

async function stopWatch() {
  if (!watcher) return;
  const current = watcher;
  watcher = null;
  watchedRoot = null;
  await current.close();
}

async function startWatch(root) {
  const resolvedRoot = path.resolve(root);
  if (watchedRoot === resolvedRoot && watcher) return;
  await stopWatch();
  watchedRoot = resolvedRoot;

  watcher = chokidar.watch('.', {
    cwd: resolvedRoot,
    ignoreInitial: true,
    ignored: /(^|[/\\])(\.git|node_modules|\.obsidian|\.trash|\.vault|dist|release|build)([/\\]|$)/,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    depth: 12,
    ignorePermissionErrors: true,
  });

  watcher.on('error', (error) => {
    console.error('[vault] watch error', error);
    const code = error && typeof error === 'object' ? error.code : null;
    if (code === 'EMFILE' || code === 'ENOSPC') {
      void stopWatch();
      void saveVaultPath(null);
    }
  });

  const send = (type, filePath) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const rel = toPosix(filePath);
    mainWindow.webContents.send('vault:watch', {
      type,
      path: rel,
      root: resolvedRoot
    });
  };

  watcher.on('add', (filePath) => {
    if (!toPosix(filePath).toLowerCase().endsWith('.md')) return;
    send('add', filePath);
  });
  watcher.on('change', (filePath) => {
    if (!toPosix(filePath).toLowerCase().endsWith('.md')) return;
    send('change', filePath);
  });
  watcher.on('unlink', (filePath) => {
    if (!toPosix(filePath).toLowerCase().endsWith('.md')) return;
    send('unlink', filePath);
  });
  watcher.on('addDir', (dirPath) => send('addDir', dirPath));
  watcher.on('unlinkDir', (dirPath) => send('unlinkDir', dirPath));
}

ipcMain.handle('vault:open', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || !result.filePaths[0]) return null;
  const root = path.resolve(result.filePaths[0]);
  try {
    const { files, folders } = await listVaultEntries(root);
    await startWatch(root);
    await saveVaultPath(root);
    return { root, files, folders };
  } catch (error) {
    await stopWatch();
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message);
  }
});

ipcMain.handle('vault:restore', async () => {
  const root = savedVaultPath();
  if (!root) return null;
  try {
    const { files, folders } = await listVaultEntries(root);
    await startWatch(root);
    return { root, files, folders };
  } catch (error) {
    console.error('[vault] restore failed; clearing saved vault', error);
    await stopWatch();
    await saveVaultPath(null);
    return null;
  }
});

ipcMain.handle('vault:clearSaved', async () => {
  await stopWatch();
  await saveVaultPath(null);
  return true;
});
ipcMain.handle('vault:list', async (_, root) => {
  const { files, folders } = await listVaultEntries(root);
  return { files, folders };
});

ipcMain.handle('vault:read', async (_, root, name) => {
  const { resolved } = resolveWithinRoot(root, name);
  return fs.readFile(resolved, 'utf8');
});

ipcMain.handle('vault:write', async (_, root, name, content) => {
  assertMarkdown(name);
  const { resolved } = resolveWithinRoot(root, name);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, content, 'utf8');
  return true;
});

ipcMain.handle('vault:create', async (_, root, name) => {
  const safeName = ensureMdExtension(name.replace(/\\/g, '/'));
  assertMarkdown(safeName);
  const { resolved, relative } = resolveWithinRoot(root, safeName);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  const title = path.basename(relative, '.md');
  await fs.writeFile(resolved, `# ${title}\n\n`, { flag: 'wx' });
  return relative;
});

ipcMain.handle('vault:mkdir', async (_, root, name) => {
  const folder = name.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!folder) throw new Error('Invalid folder name');
  if (folder.split('/').some((part) => part === '..' || part.startsWith('.'))) {
    throw new Error('Invalid folder name');
  }
  const { resolved, relative } = resolveWithinRoot(root, folder);
  await fs.mkdir(resolved, { recursive: true });
  return relative;
});

ipcMain.handle('vault:rename', async (_, root, from, to) => {
  const fromPaths = resolveWithinRoot(root, from);
  const toRaw = String(to || '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
  if (!toRaw || toRaw.split('/').some((part) => part === '..' || !part)) {
    throw new Error('Invalid destination path');
  }

  const stat = await fs.stat(fromPaths.resolved);
  if (stat.isDirectory()) {
    const toPaths = resolveWithinRoot(root, toRaw);
    if (toPaths.resolved === fromPaths.resolved) return fromPaths.relative;
    // Prevent renaming a folder into itself / a descendant.
    const rel = path.relative(fromPaths.resolved, toPaths.resolved);
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
      throw new Error('Cannot rename a folder into itself');
    }
    await fs.mkdir(path.dirname(toPaths.resolved), { recursive: true });
    await fs.rename(fromPaths.resolved, toPaths.resolved);
    return toPaths.relative;
  }

  const safeTo = ensureMdExtension(toRaw);
  assertMarkdown(from);
  assertMarkdown(safeTo);
  const toPaths = resolveWithinRoot(root, safeTo);
  await fs.mkdir(path.dirname(toPaths.resolved), { recursive: true });
  await fs.rename(fromPaths.resolved, toPaths.resolved);
  return toPaths.relative;
});

ipcMain.handle('vault:delete', async (_, root, name) => {
  const { resolved } = resolveWithinRoot(root, name);
  const stat = await fs.stat(resolved);
  if (stat.isDirectory()) {
    await fs.rm(resolved, { recursive: true, force: true });
    return true;
  }
  assertMarkdown(name);
  await fs.unlink(resolved);
  return true;
});

ipcMain.handle('vault:watchStart', async (_, root) => {
  await startWatch(root);
  return true;
});

ipcMain.handle('vault:watchStop', async () => {
  await stopWatch();
  return true;
});

ipcMain.handle('ai:status', async () => {
  const key = configuredApiKey();
  return {
    configured: key.length > 0,
    provider: 'openrouter',
    model: DEFAULT_OPENROUTER_MODEL,
    keySuffix: key ? key.slice(-4) : null,
    keyLength: key.length,
  };
});

ipcMain.handle('ai:setApiKey', async (_, apiKey) => {
  if (typeof apiKey !== 'string') throw new Error('API key must be text');
  const value = apiKey.trim();
  await fs.mkdir(path.dirname(AI_SETTINGS_PATH), { recursive: true });
  await fs.writeFile(AI_SETTINGS_PATH, JSON.stringify({ openRouterApiKey: value }), { mode: 0o600 });
  return {
    configured: value.length > 0,
    provider: 'openrouter',
    model: DEFAULT_OPENROUTER_MODEL,
    keySuffix: value ? value.slice(-4) : null,
    keyLength: value.length,
  };
});

async function loadCodexAgent() {
  return import(pathToFileURL(path.join(__dirname, 'codexAgent.mjs')).href);
}

ipcMain.handle('ai:agentStatus', async () => {
  try {
    const agent = await loadCodexAgent();
    return await agent.getAgentStatus();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      available: false,
      authenticated: false,
      cliPath: null,
      message: `Codex agent failed to load: ${message}`,
    };
  }
});

ipcMain.handle('ai:agentRun', async (event, payload) => {
  await ensureConcreteBridge();
  const agent = await loadCodexAgent();
  const vaultRoot =
    typeof payload?.vaultRoot === 'string' ? payload.vaultRoot.trim() : '';
  const notePath =
    typeof payload?.notePath === 'string' ? payload.notePath.trim() : null;
  concreteToolContext = {
    vaultRoot: vaultRoot || watchedRoot,
    notePath: notePath || null,
    openRouterModel: DEFAULT_OPENROUTER_MODEL,
  };
  return agent.runAgentTurn(
    {
      ...(payload ?? {}),
      concreteMcp: buildConcreteMcpConfig(),
    },
    (progress) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('ai:agentProgress', progress);
      }
    },
  );
});

ipcMain.handle('ai:agentCancel', async () => {
  try {
    const agent = await loadCodexAgent();
    return agent.cancelAgentTurn();
  } catch {
    return false;
  }
});

/** Minimal smoke test: cheap model, one short completion. */
ipcMain.handle('ai:ping', async () => {
  const apiKey = configuredApiKey();
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY missing after .env load');
  }

  const model = PING_OPENROUTER_MODEL;
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/danielgraviet/concrete',
      'X-Title': 'Concrete',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'Reply with exactly: pong' }],
      max_tokens: 16,
      temperature: 0,
    }),
  });

  const rawText = await response.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    return {
      ok: false,
      status: response.status,
      model,
      keySuffix: apiKey.slice(-4),
      error: `non-JSON: ${rawText.slice(0, 200)}`,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      model,
      keySuffix: apiKey.slice(-4),
      error: data?.error?.message || data?.message || rawText.slice(0, 200),
    };
  }

  return {
    ok: true,
    status: response.status,
    model: data.model ?? model,
    keySuffix: apiKey.slice(-4),
    content: data?.choices?.[0]?.message?.content ?? null,
  };
});

ipcMain.handle('ai:chatCompletions', async (_, payload = {}) => {
  const apiKey = configuredApiKey();
  if (!apiKey) {
    throw new Error(
      'OPENROUTER_API_KEY is missing. Add it to the project .env and restart Electron.',
    );
  }

  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  if (messages.length === 0) {
    throw new Error('chatCompletions requires messages');
  }

  const body = {
    model: typeof payload.model === 'string' && payload.model
      ? payload.model
      : DEFAULT_OPENROUTER_MODEL,
    messages,
    temperature:
      typeof payload.temperature === 'number' ? payload.temperature : 0.5,
    max_tokens:
      typeof payload.max_tokens === 'number' ? payload.max_tokens : 4096,
  };

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/danielgraviet/concrete',
      'X-Title': 'Concrete',
    },
    body: JSON.stringify(body),
  });

  const rawText = await response.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error(
      `OpenRouter returned non-JSON (${response.status}): ${rawText.slice(0, 240)}`,
    );
  }

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.message ||
      `OpenRouter HTTP ${response.status}`;
    const lower = String(message).toLowerCase();
    if (
      response.status === 401 ||
      lower.includes('user not found') ||
      lower.includes('invalid api key') ||
      lower.includes('unauthorized')
    ) {
      throw new Error(
        `OpenRouter auth failed (${response.status}): ${message}. ` +
          'Check OPENROUTER_API_KEY in .env — create a fresh key at openrouter.ai/keys, save .env, then fully restart Electron.',
      );
    }
    throw new Error(`OpenRouter error (${response.status}): ${message}`);
  }

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('OpenRouter returned an empty completion');
  }

  return {
    content,
    model: data.model ?? body.model,
    usage: data.usage ?? null,
  };
});

const STARTER_SEED = [
  {
    path: 'Welcome.md',
    body: '# Welcome to your vault\n\nA fast, local-first home for your thinking.\n\n## Start here\n\n- Notes here are real files on disk\n- Create folders to organize topics\n- Link notes with [[Projects]]\n',
  },
  {
    path: 'Projects.md',
    body: '# Projects\n\nA place for active work.\n\nSee also [[Welcome]].\n\n- [ ] Build the review queue\n- [ ] Add backlinks\n',
  },
  {
    path: 'Ideas.md',
    body: '# Ideas\n\nCapture quickly. Organize later.\n\nBack to [[Welcome]].\n',
  },
  {
    path: 'Stats/Overview.md',
    body: '# Stats\n\nNotes under the Stats folder.\n',
  },
  {
    path: 'Machine Learning/Notes.md',
    body: '# Machine Learning\n\nA topic folder for ML notes.\n',
  },
];

/** Prefer Documents/Concrete; keep using Documents/Markdown Vault if that already exists. */
function defaultVaultRoot() {
  const documents = app.getPath('documents');
  const preferred = path.join(documents, 'Concrete');
  const legacy = path.join(documents, 'Markdown Vault');
  if (fsSync.existsSync(preferred)) return preferred;
  if (fsSync.existsSync(legacy)) return legacy;
  return preferred;
}

async function ensureDefaultVaultDirectory() {
  await fs.mkdir(path.join(app.getPath('documents'), 'Concrete'), { recursive: true });
}

/** Open (or create) the default on-disk vault under Documents/Concrete. */
ipcMain.handle('vault:ensureDefault', async () => {
  const root = defaultVaultRoot();
  await fs.mkdir(root, { recursive: true });
  const existing = await listVaultEntries(root);
  if (existing.files.length === 0) {
    for (const seed of STARTER_SEED) {
      const target = path.join(root, seed.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      try {
        await fs.writeFile(target, seed.body, { flag: 'wx' });
      } catch (error) {
        if (error && error.code !== 'EEXIST') throw error;
      }
    }
  }
  const { files, folders } = await listVaultEntries(root);
  await startWatch(root);
  await saveVaultPath(root);
  return { root, files, folders };
});

app.whenReady().then(async () => {
  setupAppMenu();
  await ensureDefaultVaultDirectory();
  createWindow();
  try {
    await ensureConcreteBridge();
  } catch (error) {
    console.error('[concrete] failed to start tool bridge', error);
  }
});
app.on('window-all-closed', () => {
  void stopWatch();
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => {
  void stopWatch();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
