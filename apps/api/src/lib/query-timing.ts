/**
 * DB query timing — wrap a node-postgres `query` function so every call is
 * timed and slow ones are surfaced, without touching the ~100 call sites that
 * use `pool.query` / `client.query`. Kept dependency-free and side-effect-free
 * (the caller passes in the clock and the "on slow" sink) so it's unit-testable
 * with a fake query fn and no real database.
 */

/**
 * Collapse a SQL string to a single line and cap its length for logging. We log
 * the query TEXT only, never the parameter array, so bound values (phones,
 * tokens, coordinates) never leak into the logs.
 */
export function normalizeSql(sql: unknown, maxLen = 300): string {
  const text = typeof sql === 'string' ? sql : String((sql as { text?: unknown })?.text ?? '');
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > maxLen ? `${oneLine.slice(0, maxLen)}…` : oneLine;
}

export interface InstrumentOptions {
  /** Queries at or above this many ms trigger `onSlow`. `0` disables timing. */
  thresholdMs: number;
  /** Called with the elapsed ms and normalized SQL when a query is slow. */
  onSlow: (info: { ms: number; sql: string }) => void;
  /** Monotonic clock in ms. Injected for tests; defaults to performance.now. */
  now?: () => number;
}

// A node-postgres query is heavily overloaded (text, config, callback forms).
// We only need to time it and pass everything through untouched, so we accept
// the loosest signature and preserve the original return value (a Promise for
// the promise API, or whatever the callback form returns).
type QueryFn = (...args: any[]) => any;

/**
 * Return a drop-in replacement for `rawQuery` that times each call and reports
 * slow ones. Timing wraps only the promise path (the API's own code always uses
 * `await pool.query(...)`); the callback form is passed straight through.
 */
export function instrumentQuery<F extends QueryFn>(rawQuery: F, opts: InstrumentOptions): F {
  const { thresholdMs, onSlow } = opts;
  const now = opts.now ?? (() => performance.now());

  if (thresholdMs <= 0) return rawQuery;

  const wrapped = function (this: unknown, ...args: any[]) {
    // Callback form (last arg is a function): don't wrap — pg invokes the
    // callback itself and there's no promise to time. The API doesn't use it.
    if (typeof args[args.length - 1] === 'function') {
      return rawQuery.apply(this, args);
    }

    const started = now();
    const result = rawQuery.apply(this, args);

    // Guard: if a non-thenable slips through, return it untouched.
    if (!result || typeof result.then !== 'function') return result;

    return result.finally(() => {
      const ms = now() - started;
      if (ms >= thresholdMs) {
        onSlow({ ms: Math.round(ms), sql: normalizeSql(args[0]) });
      }
    });
  };

  return wrapped as F;
}
