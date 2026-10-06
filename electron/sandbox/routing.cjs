/**
 * Decide which image a snippet needs by reading its import statements.
 * Only real `import x` / `from x import y` lines count, so a comment or prose
 * that mentions numpy never pulls in the large data-science image.
 */

/** Top-level modules that need the data-science image (and its bundled dependencies). */
const DATA_MODULES = new Set(['numpy', 'pandas', 'scipy', 'sklearn', 'sympy']);

/** Top-level module names imported by a Python snippet. */
function pythonImports(code) {
  const modules = new Set();
  for (const line of String(code).split('\n')) {
    const from = /^\s*from\s+([A-Za-z_][\w]*)(?:\.[\w.]*)?\s+import\s/.exec(line);
    if (from) {
      modules.add(from[1]);
      continue;
    }
    const plain = /^\s*import\s+(.+?)\s*(?:#.*)?$/.exec(line);
    if (plain) {
      for (const part of plain[1].split(',')) {
        const name = /^\s*([A-Za-z_][\w]*)/.exec(part);
        if (name) modules.add(name[1]);
      }
    }
  }
  return modules;
}

/** 'python-data' when the snippet imports a data-science module, else 'python'. */
function pickPythonTier(code) {
  for (const module of pythonImports(code)) {
    if (DATA_MODULES.has(module)) return 'python-data';
  }
  return 'python';
}

module.exports = { DATA_MODULES, pythonImports, pickPythonTier };
