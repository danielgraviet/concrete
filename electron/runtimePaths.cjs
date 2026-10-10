const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Desktop launchers often provide a much smaller PATH than a terminal. Keep
 * the usual user-level package-manager directories explicit, then honour PATH
 * as the final source of truth. These locations cover Linux, macOS, and dev.
 */
function commonBinDirs() {
  const home = os.homedir();
  return [
    path.join(home, '.local', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    path.join(home, '.local', 'share', 'pnpm'),
    '/home/linuxbrew/.linuxbrew/bin',
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
  ];
}

function pathDirs() {
  return (process.env.PATH || '').split(path.delimiter).filter(Boolean);
}

function executableAt(candidate) {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return candidate;
  } catch {
    return null;
  }
}

/** Find an executable without relying solely on the GUI process's PATH. */
function findExecutable(name, extraDirs = []) {
  for (const dir of [...extraDirs, ...commonBinDirs(), ...pathDirs()]) {
    const found = executableAt(path.join(dir, name));
    if (found) return found;
  }
  return null;
}

function commandPathPrefix() {
  return [...new Set([...commonBinDirs(), ...pathDirs()])].join(path.delimiter);
}

module.exports = { commonBinDirs, findExecutable, commandPathPrefix };
