/**
 * Pluggable storage interface.
 * Local disk for dev; Cloudflare R2 / S3 in prod.
 */
export interface StorageProvider {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /**
   * Absolute filesystem path backing `key`, when the provider is disk-backed.
   * Lets callers stream large objects (e.g. APKs via res.download) instead of
   * loading the whole Buffer into memory. Returns undefined for remote
   * providers (R2/S3) where no local path exists — callers must fall back to
   * `get()`.
   */
  localPath?(key: string): string | undefined;
}

/**
 * Thrown by `get()` when the requested key has no backing object.
 * Callers convert this to a 404 (instead of a 500) so an opaque "Request
 * failed with status code 500" never hides a missing-file situation again.
 */
export class StorageNotFoundError extends Error {
  constructor(public readonly key: string) {
    super(`Storage key not found: ${key}`);
    this.name = 'StorageNotFoundError';
  }
}
