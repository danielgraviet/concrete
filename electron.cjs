const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const chokidar = require('chokidar');

let mainWindow = null;
let watcher = null;
let watchedRoot = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#191919',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true
    }
  });
  mainWindow.loadURL('http://localhost:5173');
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
    ignored: /(^|[/\\])(\.git|node_modules|\.obsidian|\.trash|\.vault)([/\\]|$)/,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    depth: 99
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
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths[0]) return null;
  const root = path.resolve(result.filePaths[0]);
  const { files, folders } = await listVaultEntries(root);
  await startWatch(root);
  return { root, files, folders };
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
  const safeTo = ensureMdExtension(to.replace(/\\/g, '/'));
  assertMarkdown(from);
  assertMarkdown(safeTo);
  const fromPaths = resolveWithinRoot(root, from);
  const toPaths = resolveWithinRoot(root, safeTo);
  await fs.mkdir(path.dirname(toPaths.resolved), { recursive: true });
  await fs.rename(fromPaths.resolved, toPaths.resolved);
  return toPaths.relative;
});

ipcMain.handle('vault:delete', async (_, root, name) => {
  assertMarkdown(name);
  const { resolved } = resolveWithinRoot(root, name);
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

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  void stopWatch();
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => {
  void stopWatch();
});
