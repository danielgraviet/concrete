import { describe, expect, it } from 'vitest';
import { DATA_MODULES, pickPythonTier, pythonImports } from './routing.cjs';

describe('pythonImports', () => {
  it('reads a plain import', () => {
    expect([...pythonImports('import numpy as np')]).toEqual(['numpy']);
  });

  it('reads a dotted from-import as its top-level module', () => {
    expect([...pythonImports('from numpy.linalg import norm')]).toEqual(['numpy']);
  });

  it('reads every module of a comma-separated import', () => {
    expect([...pythonImports('import os, pandas')].sort()).toEqual(['os', 'pandas']);
  });

  it('reads an indented import', () => {
    expect([...pythonImports('    import pandas')]).toEqual(['pandas']);
  });

  it('ignores a trailing comment on the import line', () => {
    expect([...pythonImports('import x  # comment')]).toEqual(['x']);
  });

  it('does not count a module named only in a comment', () => {
    expect([...pythonImports('# numpy is great\nprint("hi")')]).toEqual([]);
  });

  it('does not count a module named only inside a string', () => {
    expect([...pythonImports('print("import numpy")')]).toEqual([]);
  });

  it('reads nothing from an empty snippet', () => {
    expect([...pythonImports('')]).toEqual([]);
  });
});

describe('pickPythonTier', () => {
  it('picks the data image for a plain data-science import', () => {
    expect(pickPythonTier('import numpy as np')).toBe('python-data');
  });

  it('picks the data image for a dotted from-import', () => {
    expect(pickPythonTier('from numpy.linalg import norm')).toBe('python-data');
  });

  it('picks the data image when one of several imports is a data module', () => {
    expect(pickPythonTier('import os, pandas')).toBe('python-data');
  });

  it('picks the data image for an indented import', () => {
    expect(pickPythonTier('if True:\n    import pandas')).toBe('python-data');
  });

  it('picks the plain image when a data module is named only in a comment', () => {
    expect(pickPythonTier('# numpy is great\nimport os')).toBe('python');
  });

  it('picks the plain image when a data module is named only in a string', () => {
    expect(pickPythonTier('print("import numpy")')).toBe('python');
  });

  it('picks the plain image for an empty snippet', () => {
    expect(pickPythonTier('')).toBe('python');
  });

  it('picks the plain image for a non-data import', () => {
    expect(pickPythonTier('import os\nfrom pathlib import Path')).toBe('python');
  });

  it('routes every module in DATA_MODULES to the data image', () => {
    for (const module of DATA_MODULES) {
      expect(pickPythonTier(`import ${module}`)).toBe('python-data');
    }
  });
});
