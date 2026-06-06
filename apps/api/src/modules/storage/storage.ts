/**
 * Pluggable storage interface.
 * Local disk for dev; Cloudflare R2 / S3 in prod.
 */
export interface StorageProvider {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
