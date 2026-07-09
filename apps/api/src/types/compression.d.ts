// Minimal ambient types for `compression`. The upstream `@types/compression`
// package isn't installed (and the hoisted pnpm linker would need it at the
// repo root); this declaration covers exactly the surface we use in index.ts.
declare module 'compression' {
  import type { RequestHandler } from 'express';
  import type { IncomingMessage, ServerResponse } from 'node:http';

  interface CompressionOptions {
    /** Only compress responses at/above this byte size (default 1024). */
    threshold?: number | string;
    /** zlib compression level, 0–9 (default -1 = default). */
    level?: number;
    /** Decide per-request whether to compress. */
    filter?: (req: IncomingMessage, res: ServerResponse) => boolean;
    chunkSize?: number;
    memLevel?: number;
    windowBits?: number;
  }

  function compression(options?: CompressionOptions): RequestHandler;
  namespace compression {
    /** Default predicate: skip when the client set `x-no-compression`. */
    function filter(req: IncomingMessage, res: ServerResponse): boolean;
  }

  export = compression;
}
