/**
 * Tiny retry + timeout helpers. We avoid the `p-retry` dep so the
 * server keeps a minimal install footprint.
 *
 * - `withTimeout`: rejects with TimeoutError after `ms` if the inner promise
 *   hasn't settled. Use with an AbortController where possible so the
 *   upstream socket is actually closed.
 *
 * - `withRetry`: re-runs `fn` on failures matching `shouldRetry`. Exponential
 *   backoff with jitter; small caps so the user never waits more than a few
 *   seconds extra. Aborts immediately on 4xx (other than 408/429).
 */

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Operation timed out after ${ms} ms`);
    this.name = 'TimeoutError';
  }
}

export function withTimeout<T>(p: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      onTimeout?.();
      reject(new TimeoutError(ms));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export interface RetryOptions {
  retries?: number;
  /** Base delay in ms; doubled each retry, ± 25% jitter. */
  baseDelayMs?: number;
  /** Cap on the per-attempt delay. */
  maxDelayMs?: number;
  /** Default: retry on 408/429/5xx + network errors. */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
}

function defaultShouldRetry(err: unknown): boolean {
  // OpenAI / Anthropic SDK errors expose `.status`.
  const status = (err as { status?: number; statusCode?: number })?.status
    ?? (err as { statusCode?: number })?.statusCode;
  if (typeof status === 'number') {
    return status === 408 || status === 429 || status >= 500;
  }
  // Network / abort / timeout — retry once or twice.
  const name = (err as Error)?.name;
  if (name === 'AbortError' || name === 'TimeoutError') return true;
  const code = (err as { code?: string })?.code;
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'EAI_AGAIN') return true;
  return false;
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 2;
  const baseDelay = opts.baseDelayMs ?? 300;
  const maxDelay = opts.maxDelayMs ?? 2_500;
  const shouldRetry = opts.shouldRetry ?? defaultShouldRetry;

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !shouldRetry(err, attempt)) throw err;
      const expo = baseDelay * 2 ** attempt;
      const jitter = expo * (0.75 + Math.random() * 0.5);
      const delay = Math.min(jitter, maxDelay);
      await new Promise((r) => setTimeout(r, delay));
      attempt++;
    }
  }
}
