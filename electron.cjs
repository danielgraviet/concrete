const { app, BrowserWindow, dialog, ipcMain, Menu, clipboard, shell, session } = require('electron');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const chokidar = require('chokidar');
const sandbox = require('./sandbox/index.cjs');
const { createTrajectory } = require('./agentTrajectory.cjs');

/** Cap Chromium disk cache (~50MB) before app ready. */
app.commandLine.appendSwitch('disk-cache-size', String(50 * 1024 * 1024));

const PERF_BOOT_MS = Date.now();
function perfMark(label) {
  console.log(`[perf] ${label} +${Date.now() - PERF_BOOT_MS}ms`);
}

let mainWindow = null;
let watcher = null;
let watchedRoot = null;
let concreteBridgeInfo = null;
let concreteToolContext = {
  vaultRoot: null,
  notePath: null,
  aiBackend: 'openrouter',
  aiModel: null,
};
let dotEnvLoaded = false;

const AI_SETTINGS_PATH = path.join(app.getPath('userData'), 'ai-settings.json');
const APP_STATE_PATH = path.join(app.getPath('userData'), 'app-state.json');
const AI_ACTIVITY_PATH = path.join(app.getPath('userData'), 'ai-activity.jsonl');
const TRAJECTORY_DIR = path.join(app.getPath('documents'), 'Concrete', 'agent-trajectories');

async function recordAiActivity(event) {
  try {
    await fs.mkdir(path.dirname(AI_ACTIVITY_PATH), { recursive: true });
    await fs.appendFile(AI_ACTIVITY_PATH, `${JSON.stringify(event)}\n`, { mode: 0o600 });
  } catch (error) {
    console.warn('Unable to record AI activity:', error?.message ?? error);
  }
}

async function readAiActivity() {
  try {
    const lines = (await fs.readFile(AI_ACTIVITY_PATH, 'utf8')).trim().split('\n').filter(Boolean);
    return lines.slice(-200).flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    }).reverse();
  } catch { return []; }
}

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

/** Chat backends and where each one's optional API key comes from. */
const CHAT_BACKENDS = {
  openrouter: { env: 'OPENROUTER_API_KEY', saved: 'openRouterApiKey' },
  // Claude Code and Codex read these variables themselves; without a key they
  // fall back to the user's subscription login.
  claude: { env: 'ANTHROPIC_API_KEY', saved: 'anthropicApiKey' },
  codex: { env: 'CODEX_API_KEY', saved: 'openAiApiKey' },
};

function resolveChatBackend(id) {
  return typeof id === 'string' && CHAT_BACKENDS[id] ? id : 'openrouter';
}

function readAiSettings() {
  try {
    const saved = JSON.parse(fsSync.readFileSync(AI_SETTINGS_PATH, 'utf8'));
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}

function configuredApiKey(backend) {
  // A project .env key is the operator-controlled source of truth.  The
  // persisted key is only a fallback for users who configure the key through
  // Settings (and have no .env key).  Previously the persisted value won,
  // which made rotating OPENROUTER_API_KEY in .env appear to have no effect.
  const source = CHAT_BACKENDS[resolveChatBackend(backend)];
  const envKey = process.env[source.env]?.trim() ?? '';
  if (envKey) return envKey;
  const saved = readAiSettings()[source.saved];
  return typeof saved === 'string' ? saved.trim() : '';
}

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
  if (dotEnvLoaded) return;
  dotEnvLoaded = true;
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
// Keep the default on a broadly available model; unavailable model IDs leave
// the tutor stuck behind the renderer's "Thinking…" state.
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
    }),
    // The agent's generate_quiz tool uses the same model as the tutor.
    chat: ({ messages, temperature, max_tokens }) =>
      completeChat(concreteToolContext.aiBackend, {
        model: concreteToolContext.aiModel,
        messages,
        temperature,
        max_tokens,
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
  perfMark('window-create-start');
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#191919',
    title: 'Concrete',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Command-clicked Markdown links should open in the user's browser rather
    // than creating another Electron window.
    if (/^(https?:|mailto:)/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.once('ready-to-show', () => {
    perfMark('window-ready-to-show');
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
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

/** Non-markdown files the vault tree also displays (read-only-ish: open/reveal/rename/delete). */
const DISPLAYED_EXTENSIONS = new Set(['.md', '.pdf']);

function displayedExtension(name) {
  const ext = path.extname(name).toLowerCase();
  return DISPLAYED_EXTENSIONS.has(ext) ? ext : null;
}

const SKIP_DIRS = new Set(['.git', 'node_modules', '.obsidian', '.trash', '.vault', 'agent-trajectories']);
const MAX_VAULT_FILES = 10000;
const OBSIDIAN_IMPORT_MARKER = '.concrete-obsidian-imported';

/** Copy an Obsidian vault's user files into Concrete without replacing existing work. */
async function importObsidianVault(sourceRoot, destinationRoot, markerName = OBSIDIAN_IMPORT_MARKER) {
  const marker = path.join(destinationRoot, markerName);
  if (!fsSync.existsSync(sourceRoot) || fsSync.existsSync(marker)) return false;

  async function copyDirectory(sourceDir, destinationDir) {
    const entries = await fs.readdir(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === OBSIDIAN_IMPORT_MARKER) continue;
      if (entry.isDirectory() && (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.'))) continue;
      const source = path.join(sourceDir, entry.name);
      const destination = path.join(destinationDir, entry.name);
      if (entry.isDirectory()) {
        await fs.mkdir(destination, { recursive: true });
        await copyDirectory(source, destination);
      } else if (entry.isFile()) {
        await fs.mkdir(path.dirname(destination), { recursive: true });
        try {
          await fs.copyFile(source, destination, fsSync.constants.COPYFILE_EXCL);
        } catch (error) {
          if (error?.code !== 'EEXIST') throw error;
        }
      }
    }
  }

  await copyDirectory(sourceRoot, destinationRoot);
  await fs.writeFile(marker, 'Imported from Documents/Obsidian Vault\n');
  return true;
}

/**
 * Recursively list markdown notes, exported PDFs, and folders (including empty folders).
 * @returns {{ files: string[], pdfFiles: string[], folders: string[] }}
 */
async function listVaultEntries(root) {
  const resolvedRoot = path.resolve(root);
  const files = [];
  const pdfFiles = [];
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
      if (!entry.isFile()) continue;
      const ext = entry.name.toLowerCase().endsWith('.md')
        ? '.md'
        : entry.name.toLowerCase().endsWith('.pdf')
          ? '.pdf'
          : null;
      if (!ext) continue;
      const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
      (ext === '.md' ? files : pdfFiles).push(rel);
      if (files.length > MAX_VAULT_FILES) {
        throw new Error(`Vault contains more than ${MAX_VAULT_FILES.toLocaleString()} Markdown files and cannot be opened.`);
      }
    }
  }

  await walk(resolvedRoot, '');
  files.sort((a, b) => a.localeCompare(b));
  pdfFiles.sort((a, b) => a.localeCompare(b));
  folders.sort((a, b) => a.localeCompare(b));
  return { files, pdfFiles, folders };
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
    usePolling: false,
    ignored: [
      /(^|[/\\])(\.git|node_modules|\.obsidian|\.trash|\.vault|agent-trajectories|dist|release|build|\.cache|\.turbo|\.next|coverage)([/\\]|$)/,
      /\.(?:DS_Store|log|tmp|swp|map)$/i,
    ],
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    depth: 10,
    ignorePermissionErrors: true,
  });

  watcher.on('error', (error) => {
    console.error('[vault] watch error', error);
    const code = error && typeof error === 'object' ? error.code : null;
    if (code === 'EMFILE' || code === 'ENOSPC') {
      void stopWatch();
      void saveVaultPath(null);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('vault:watch', {
          type: 'error',
          path: '',
          root: resolvedRoot,
          code,
          message: error?.message ?? String(error),
        });
      }
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
    if (!displayedExtension(filePath)) return;
    send('add', filePath);
  });
  watcher.on('change', (filePath) => {
    if (!displayedExtension(filePath)) return;
    send('change', filePath);
  });
  watcher.on('unlink', (filePath) => {
    if (!displayedExtension(filePath)) return;
    send('unlink', filePath);
  });
  watcher.on('addDir', (dirPath) => {
    if (!/(^|[/\\])agent-trajectories([/\\]|$)/.test(dirPath)) send('addDir', dirPath);
  });
  watcher.on('unlinkDir', (dirPath) => {
    if (!/(^|[/\\])agent-trajectories([/\\]|$)/.test(dirPath)) send('unlinkDir', dirPath);
  });
}

ipcMain.handle('vault:open', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || !result.filePaths[0]) return null;
  const root = path.resolve(result.filePaths[0]);
  try {
    const { files, pdfFiles, folders } = await listVaultEntries(root);
    await startWatch(root);
    await saveVaultPath(root);
    return { root, files, pdfFiles, folders };
  } catch (error) {
    await stopWatch();
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message);
  }
});

ipcMain.handle('vault:restore', async () => {
  let root = savedVaultPath();
  if (!root) return null;
  try {
    if (path.basename(root) === 'Markdown Vault') {
      root = defaultVaultRoot();
      await fs.mkdir(root, { recursive: true });
      await importObsidianVault(path.join(app.getPath('documents'), 'Markdown Vault'), root, '.concrete-legacy-imported');
      await saveVaultPath(root);
    }
    // Existing Concrete users should also receive the one-time Obsidian import.
    if (path.resolve(root) === path.resolve(defaultVaultRoot())) {
      if (path.basename(root) === 'Concrete') {
        await importObsidianVault(path.join(app.getPath('documents'), 'Markdown Vault'), root, '.concrete-legacy-imported');
      }
      await importObsidianVault(path.join(app.getPath('documents'), 'Obsidian Vault'), root);
    }
    const { files, pdfFiles, folders } = await listVaultEntries(root);
    await startWatch(root);
    return { root, files, pdfFiles, folders };
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
  const { files, pdfFiles, folders } = await listVaultEntries(root);
  return { files, pdfFiles, folders };
});

ipcMain.handle('vault:read', async (_, root, name) => {
  const { resolved } = resolveWithinRoot(root, name);
  try {
    return await fs.readFile(resolved, 'utf8');
  } catch (error) {
    // A note can disappear between list/watch notification and a renderer read
    // (for example, when it is moved or deleted in Finder). Treat that race as
    // a normal cache miss so Electron does not emit a noisy rejected IPC call.
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
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

  const ext = displayedExtension(from);
  if (!ext) throw new Error('Only .md and .pdf files are allowed');
  const safeTo =
    ext === '.md'
      ? ensureMdExtension(toRaw)
      : toRaw.toLowerCase().endsWith(ext)
        ? toRaw
        : `${toRaw}${ext}`;
  if (displayedExtension(safeTo) !== ext) {
    throw new Error(`Cannot change ${ext} file to a different type`);
  }
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
  if (!displayedExtension(name)) throw new Error('Only .md and .pdf files are allowed');
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

ipcMain.handle('vault:openPath', async (_, root, name) => {
  const { resolved } = resolveWithinRoot(root, name);
  const error = await shell.openPath(resolved);
  if (error) throw new Error(error);
  return true;
});

ipcMain.handle('vault:revealInFolder', async (_, root, name) => {
  const { resolved } = resolveWithinRoot(root, name);
  shell.showItemInFolder(resolved);
  return true;
});

/** OpenRouter needs a key; Claude and Codex also accept their CLI login. */
async function aiStatusFor(backend) {
  const key = configuredApiKey(backend);
  const keyInfo = { keySuffix: key ? key.slice(-4) : null, keyLength: key.length };
  if (backend === 'openrouter') {
    return { configured: key.length > 0, provider: backend, model: DEFAULT_OPENROUTER_MODEL, ...keyInfo };
  }
  const status = await (await loadAgentModule(backend)).getAgentStatus({ apiKey: key });
  return {
    configured: status.available && status.authenticated,
    provider: backend,
    model: null,
    message: status.message,
    ...keyInfo,
  };
}

ipcMain.handle('ai:status', async (_, backend) => {
  loadDotEnv();
  return aiStatusFor(resolveChatBackend(backend));
});

ipcMain.handle('ai:setApiKey', async (_, apiKey, backend) => {
  loadDotEnv();
  if (typeof apiKey !== 'string') throw new Error('API key must be text');
  const id = resolveChatBackend(backend);
  const source = CHAT_BACKENDS[id];
  const value = apiKey.trim();
  // Make a key entered in Settings effective for the current Electron
  // session. On a later launch, a project .env key (if present) takes
  // precedence over this persisted fallback.
  if (value) process.env[source.env] = value;
  else delete process.env[source.env];
  await fs.mkdir(path.dirname(AI_SETTINGS_PATH), { recursive: true });
  await fs.writeFile(
    AI_SETTINGS_PATH,
    JSON.stringify({ ...readAiSettings(), [source.saved]: value }),
    { mode: 0o600 },
  );
  return aiStatusFor(id);
});

// Code execution for quiz questions. The provider id picks a registered runner
// (see sandbox/factory.cjs), so Docker can be swapped for a hosted sandbox.
ipcMain.handle('sandbox:providers', async () => sandbox.listRunners());

ipcMain.handle('sandbox:status', async (_, providerId) => {
  try {
    return await sandbox.getRunner(providerId).status();
  } catch (error) {
    return { available: false, detail: error?.message ?? 'Sandbox unavailable', languages: [] };
  }
});

// Long setup steps (image builds) report progress back to the window that asked.
function sandboxProgress(event) {
  return (message) => {
    if (!event.sender.isDestroyed()) event.sender.send('sandbox:progress', { message: String(message) });
  };
}

ipcMain.handle('sandbox:prepare', async (event, payload = {}) => {
  try {
    const runner = sandbox.getRunner(payload.providerId);
    if (typeof runner.prepare !== 'function') return { ok: false, error: 'This runner needs no setup.' };
    return await runner.prepare({ tier: String(payload.tier ?? ''), onProgress: sandboxProgress(event) });
  } catch (error) {
    return { ok: false, error: error?.message ?? 'Setup failed.' };
  }
});

ipcMain.handle('sandbox:run', async (event, payload = {}) => {
  const language = typeof payload.language === 'string' ? payload.language : '';
  const code = typeof payload.code === 'string' ? payload.code : '';
  if (!language || !code.trim() || code.length > 20000) {
    return {
      ok: false, stdout: '', stderr: '', exitCode: null, timedOut: false, durationMs: 0,
      error: 'Invalid code run request.',
    };
  }
  const timeoutMs = Math.min(30000, Math.max(1000, Number(payload.timeoutMs) || 8000));
  try {
    return await sandbox.getRunner(payload.providerId).run({
      language,
      code,
      timeoutMs,
      allowBuild: payload.allowBuild !== false,
      onProgress: sandboxProgress(event),
    });
  } catch (error) {
    return {
      ok: false, stdout: '', stderr: '', exitCode: null, timedOut: false, durationMs: 0,
      error: error?.message ?? 'Code run failed.',
    };
  }
});

const AGENT_MODULES = {
  codex: 'codexAgent.mjs',
  claude: 'claudeAgent.mjs',
};

/** Provider id of the agent module last used for run/status, so cancel targets the right one. */
let lastAgentProviderId = 'codex';

function resolveAgentProviderId(payload) {
  const id = typeof payload?.agentProviderId === 'string' ? payload.agentProviderId : null;
  return id && AGENT_MODULES[id] ? id : 'codex';
}

async function loadAgentModule(providerId) {
  const file = AGENT_MODULES[providerId] || AGENT_MODULES.codex;
  return import(pathToFileURL(path.join(__dirname, file)).href);
}

ipcMain.handle('ai:agentStatus', async (_event, payload) => {
  loadDotEnv();
  const providerId = resolveAgentProviderId(payload);
  lastAgentProviderId = providerId;
  try {
    const agent = await loadAgentModule(providerId);
    return await agent.getAgentStatus({ apiKey: configuredApiKey(providerId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      available: false,
      authenticated: false,
      cliPath: null,
      message: `Agent failed to load: ${message}`,
    };
  }
});

ipcMain.handle('ai:agentRun', async (event, payload) => {
  loadDotEnv();
  await ensureConcreteBridge();
  const providerId = resolveAgentProviderId(payload);
  lastAgentProviderId = providerId;
  const agent = await loadAgentModule(providerId);
  const vaultRoot =
    typeof payload?.vaultRoot === 'string' ? payload.vaultRoot.trim() : '';
  const notePath =
    typeof payload?.notePath === 'string' ? payload.notePath.trim() : null;
  concreteToolContext = {
    vaultRoot: vaultRoot || watchedRoot,
    notePath: notePath || null,
    aiBackend: resolveChatBackend(payload?.aiBackend),
    aiModel: typeof payload?.aiModel === 'string' && payload.aiModel ? payload.aiModel : null,
  };
  const trajectory = await createTrajectory({
    provider: providerId,
    vaultRoot,
    notePath,
    prompt: typeof payload?.prompt === 'string' ? payload.prompt : '',
  });
  await trajectory.record('run.started', { agentProviderId: providerId });
  try {
    const result = await agent.runAgentTurn(
    {
      ...(payload ?? {}),
      apiKey: configuredApiKey(providerId),
      concreteMcp: buildConcreteMcpConfig(),
    },
    (progress) => {
      void trajectory.record('ui.progress', progress);
      if (!event.sender.isDestroyed()) {
        event.sender.send('ai:agentProgress', progress);
      }
    },
    (rawEvent) => { void trajectory.record('provider.event', { event: rawEvent }); },
    );
    await trajectory.finish({ status: 'success', result });
    return result;
  } catch (error) {
    await trajectory.finish({ status: 'error', error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
});

ipcMain.handle('ai:agentCancel', async () => {
  try {
    const agent = await loadAgentModule(lastAgentProviderId);
    return agent.cancelAgentTurn();
  } catch {
    return false;
  }
});

/** Minimal smoke test: cheap model, one short completion. */
ipcMain.handle('ai:ping', async () => {
  loadDotEnv();
  const apiKey = configuredApiKey('openrouter');
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

async function openRouterChat(body) {
  const apiKey = configuredApiKey('openrouter');
  if (!apiKey) {
    throw new Error(
      'OPENROUTER_API_KEY is missing. Add it to the project .env and restart Electron.',
    );
  }
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

  const rawContent = data?.choices?.[0]?.message?.content;
  // OpenRouter normally returns a string, but some providers return content
  // parts. Preserve text from those responses instead of misclassifying it as
  // an empty completion.
  const content = Array.isArray(rawContent)
    ? rawContent
        .map((part) => (typeof part === 'string' ? part : part?.text))
        .filter((part) => typeof part === 'string')
        .join('')
    : rawContent;
  const choice = data?.choices?.[0] ?? {};
  if (typeof content !== 'string' || !content.trim()) {
    const reason = choice.finish_reason || choice.native_finish_reason || 'unknown';
    const refusal = choice.message?.refusal;
    const detail = refusal ? ` refusal=${String(refusal).slice(0, 180)}` : '';
    throw new Error(`OpenRouter returned an empty completion (finish_reason=${reason}).${detail}`);
  }
  return {
    content,
    model: data.model ?? body.model,
    usage: data.usage ?? null,
    finishReason: choice.finish_reason ?? null,
    nativeFinishReason: choice.native_finish_reason ?? null,
  };
}

/** One chat completion on the chosen backend: OpenRouter, Claude Code, or Codex. */
async function completeChat(backend, { model, messages, temperature, max_tokens }) {
  const id = resolveChatBackend(backend);
  if (id === 'openrouter') {
    return openRouterChat({
      model: typeof model === 'string' && model ? model : DEFAULT_OPENROUTER_MODEL,
      messages,
      temperature: typeof temperature === 'number' ? temperature : 0.5,
      max_tokens: typeof max_tokens === 'number' ? max_tokens : 4096,
    });
  }
  const agent = await loadAgentModule(id);
  return agent.completeChat({
    messages,
    model: typeof model === 'string' && model ? model : undefined,
    apiKey: configuredApiKey(id),
  });
}

ipcMain.handle('ai:chatCompletions', async (_, payload = {}) => {
  loadDotEnv();
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  const operation = typeof payload.operation === 'string' ? payload.operation : 'chat_completion';
  const backend = resolveChatBackend(payload.backend);
  const requestedModel = payload.model ?? (backend === 'openrouter' ? DEFAULT_OPENROUTER_MODEL : backend);
  // Write a start event before network work so even crashes, timeouts, and
  // malformed provider responses remain visible in the activity log.
  await recordAiActivity({
    requestId,
    operation,
    startedAt,
    status: 'started',
    backend,
    model: requestedModel,
    metadata: payload.metadata ?? null,
  });

  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  if (messages.length === 0) {
    await recordAiActivity({ requestId, operation, startedAt, durationMs: Date.now() - startedAt, status: 'error', error: 'chatCompletions requires messages' });
    throw new Error('chatCompletions requires messages');
  }

  let result;
  try {
    result = await completeChat(backend, {
      model: payload.model,
      messages,
      temperature: payload.temperature,
      max_tokens: payload.max_tokens,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordAiActivity({
      requestId,
      operation,
      startedAt,
      durationMs: Date.now() - startedAt,
      status: 'error',
      backend,
      model: requestedModel,
      error: message,
      metadata: payload.metadata ?? null,
    });
    throw error;
  }

  const { content } = result;
  const activity = {
    requestId, operation, startedAt, completedAt: Date.now(), durationMs: Date.now() - startedAt,
    status: 'success', backend, model: result.model,
    finishReason: result.finishReason ?? null,
    nativeFinishReason: result.nativeFinishReason ?? null,
    temperature: payload.temperature ?? null, maxTokens: payload.max_tokens ?? null,
    promptChars: messages.reduce((sum, message) => sum + String(message.content).length, 0),
    responseChars: content.length, usage: result.usage ?? null,
    metadata: payload.metadata ?? null,
    messages: payload.capture === 'full' ? messages : messages.map((message) => ({ ...message, content: String(message.content).slice(0, 500) })),
    responsePreview: content.slice(0, 1000),
    // Full reply for captured calls, so parse failures downstream can be diagnosed.
    ...(payload.capture === 'full' ? { responseText: content.slice(0, 50000) } : {}),
  };
  await recordAiActivity(activity);
  return {
    content,
    model: result.model,
    usage: result.usage ?? null,
    requestId,
  };
});

ipcMain.handle('ai:activity', () => readAiActivity());
ipcMain.handle('ai:trajectories', async () => {
  console.log('[trajectory] scan requested', TRAJECTORY_DIR);
  try {
    const files = (await fs.readdir(TRAJECTORY_DIR, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => ({ entry, directory: TRAJECTORY_DIR }))
      .sort((a, b) => b.entry.name.localeCompare(a.entry.name));
    const result = (await Promise.all(files.map(async ({ entry, directory }) => {
      const records = (await fs.readFile(path.join(directory, entry.name), 'utf8'))
        .trim().split('\n').filter(Boolean).flatMap((line) => {
          try { return [JSON.parse(line)]; } catch { return []; }
        });
      return { file: entry.name, records, location: 'Documents/Concrete' };
    }))).slice(0, 200);
    console.log('[trajectory] scan complete', result.length, 'file(s)');
    return result;
  } catch (error) {
    console.error('[trajectory] scan failed', error);
    return [];
  }
});
// Lets the renderer log failures that happen after a successful API call
// (e.g. an unparseable quiz), keeping the raw model reply for debugging.
ipcMain.handle('ai:recordActivity', async (_, event = {}) => {
  await recordAiActivity({
    requestId: typeof event.requestId === 'string' ? event.requestId : `${Date.now()}-renderer`,
    operation: typeof event.operation === 'string' ? event.operation.slice(0, 80) : 'renderer_event',
    startedAt: Date.now(),
    completedAt: Date.now(),
    status: event.status === 'error' ? 'error' : 'info',
    model: typeof event.model === 'string' ? event.model : undefined,
    error: typeof event.error === 'string' ? event.error.slice(0, 2000) : undefined,
    responseText: typeof event.responseText === 'string' ? event.responseText.slice(0, 50000) : undefined,
    metadata: event.metadata && typeof event.metadata === 'object' ? event.metadata : null,
  });
  return true;
});

ipcMain.handle('ai:activityClear', async () => {
  try { await fs.unlink(AI_ACTIVITY_PATH); } catch {}
  return true;
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

/** Concrete is the canonical default vault; legacy folders are merged into it. */
function defaultVaultRoot() {
  const documents = app.getPath('documents');
  return path.join(documents, 'Concrete');
}

async function ensureDefaultVaultDirectory() {
  await fs.mkdir(path.join(app.getPath('documents'), 'Concrete'), { recursive: true });
}

/** Open (or create) the default on-disk vault under Documents/Concrete. */
ipcMain.handle('vault:ensureDefault', async () => {
  const root = defaultVaultRoot();
  await fs.mkdir(root, { recursive: true });
  if (path.basename(root) === 'Concrete') {
    await importObsidianVault(path.join(app.getPath('documents'), 'Markdown Vault'), root, '.concrete-legacy-imported');
  }
  await importObsidianVault(path.join(app.getPath('documents'), 'Obsidian Vault'), root);
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
  const { files, pdfFiles, folders } = await listVaultEntries(root);
  await startWatch(root);
  await saveVaultPath(root);
  return { root, files, pdfFiles, folders };
});

ipcMain.handle('vault:importObsidian', async (_, root) => {
  const destination = path.resolve(typeof root === 'string' ? root : '');
  if (!destination || destination === path.parse(destination).root) throw new Error('Invalid vault root');
  await fs.mkdir(destination, { recursive: true });
  await importObsidianVault(path.join(app.getPath('documents'), 'Obsidian Vault'), destination);
  const { files, pdfFiles, folders } = await listVaultEntries(destination);
  await startWatch(destination);
  await saveVaultPath(destination);
  return { root: destination, files, pdfFiles, folders };
});

app.whenReady().then(async () => {
  perfMark('app-ready');
  setupAppMenu();
  // Window first — vault mkdir and bridge wait until needed.
  createWindow();
  setImmediate(() => {
    void ensureDefaultVaultDirectory().catch((error) => {
      console.error('[vault] ensure default failed', error);
    });
  });
});
app.on('window-all-closed', () => {
  void stopWatch();
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => {
  void stopWatch();
  // Shrink App Support growth: drop Chromium disk cache on quit.
  void session.defaultSession.clearCache().catch(() => {});
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('perf:mark', (_event, label) => {
  if (typeof label === 'string' && label.trim()) perfMark(label.trim().slice(0, 80));
  return true;
});
