type VaultWatchType = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';

interface VaultWatchEvent {
  type: VaultWatchType;
  path: string;
  root: string;
}

interface VaultOpenResult {
  root: string;
  files: string[];
  folders: string[];
}

interface VaultListResult {
  files: string[];
  folders: string[];
}

interface Window {
  /** Present only in the Electron renderer (missing in browser demo mode). */
  vault?: {
    open: () => Promise<VaultOpenResult | null>;
    list: (root: string) => Promise<VaultListResult>;
    read: (root: string, name: string) => Promise<string>;
    write: (root: string, name: string, content: string) => Promise<boolean>;
    create: (root: string, name: string) => Promise<string>;
    mkdir: (root: string, name: string) => Promise<string>;
    rename: (root: string, from: string, to: string) => Promise<string>;
    delete: (root: string, name: string) => Promise<boolean>;
    watchStart: (root: string) => Promise<boolean>;
    watchStop: () => Promise<boolean>;
    onWatch: (callback: (event: VaultWatchEvent) => void) => () => void;
    offWatch: (callback: (event: VaultWatchEvent) => void) => void;
  };
}

declare module '*.css';
