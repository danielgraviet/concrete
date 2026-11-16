/**
 * Typed errors every CloudRepository implementation throws. Callers branch on
 * `instanceof` (or on `code`, which survives structured cloning / postMessage).
 */

export type CloudErrorCode = 'not-found' | 'conflict' | 'payload-too-large' | 'permission' | 'invalid-path';

export abstract class CloudError extends Error {
  abstract readonly code: CloudErrorCode;
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The note, folder, data key or share does not exist. */
export class NotFoundError extends CloudError {
  readonly code = 'not-found' as const;
}

/** The destination path already exists (create / rename). */
export class ConflictError extends CloudError {
  readonly code = 'conflict' as const;
}

/** The write would exceed the per-record limit (Firestore: 1 MiB per document). */
export class PayloadTooLargeError extends CloudError {
  readonly code = 'payload-too-large' as const;
  constructor(
    /** Note path, data key or share title the write targeted. */
    readonly target: string,
    readonly bytes: number,
    readonly limit: number,
  ) {
    super(`"${target}" is too large to save to the cloud (${formatBytes(bytes)}; limit ${formatBytes(limit)}).`);
  }
}

/** Not signed in, or the record belongs to another workspace/user. */
export class PermissionError extends CloudError {
  readonly code = 'permission' as const;
}

/** Empty path, `..` segment, renaming a folder into itself, etc. */
export class InvalidPathError extends CloudError {
  readonly code = 'invalid-path' as const;
}

export function isCloudError(error: unknown): error is CloudError {
  return error instanceof CloudError;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
