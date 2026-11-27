/** Group note paths for the mobile list: root-level notes first, then folders. */
export function groupNotes(paths: string[]): {
  rootFiles: string[];
  folders: Array<[folder: string, paths: string[]]>;
} {
  const rootFiles: string[] = [];
  const byFolder = new Map<string, string[]>();
  for (const path of paths) {
    const slash = path.indexOf('/');
    if (slash === -1) {
      rootFiles.push(path);
      continue;
    }
    const folder = path.slice(0, slash);
    const list = byFolder.get(folder);
    if (list) list.push(path);
    else byFolder.set(folder, [path]);
  }
  return { rootFiles, folders: [...byFolder.entries()].sort((a, b) => a[0].localeCompare(b[0])) };
}
