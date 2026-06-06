import { promises as fs } from 'node:fs';
import path from 'node:path';
import { env } from '../../config/env.js';
import type { StorageProvider } from './storage.js';

/**
 * Stores files under env.UPLOAD_DIR.
 * Keys can be slashed (e.g. "applications/<uuid>/selfie.jpg") and intermediate
 * directories are created on demand.
 *
 * Safety: keys are validated to forbid `..` so we don't write outside root.
 */
export class LocalDiskStorage implements StorageProvider {
  private readonly root: string;

  constructor(root?: string) {
    this.root = path.resolve(root ?? env.UPLOAD_DIR);
  }

  private safePath(key: string): string {
    if (key.includes('..')) {
      throw new Error(`Unsafe storage key: ${key}`);
    }
    return path.join(this.root, key);
  }

  async put(key: string, body: Buffer, _contentType: string): Promise<void> {
    const filePath = this.safePath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, body);
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.safePath(key));
  }

  async delete(key: string): Promise<void> {
    await fs.unlink(this.safePath(key)).catch(() => {});
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.safePath(key));
      return true;
    } catch {
      return false;
    }
  }
}

// Default storage instance for the app.
// To switch to R2/S3, replace this with a new impl reading the same StorageProvider interface.
export const defaultStorage: StorageProvider = new LocalDiskStorage();
