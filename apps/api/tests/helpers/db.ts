import type { Mock } from 'vitest';

export type SqlResult = { rows: any[]; rowCount: number };
export type SqlHandler = SqlResult | ((params: any[] | undefined) => SqlResult);

/** Build a pg-style result from rows. */
export function rows(list: any[]): SqlResult {
  return { rows: list, rowCount: list.length };
}

/**
 * Route a mocked pool.query by matching the SQL text against regexes,
 * in order. Unmatched queries resolve to an empty result so incidental
 * statements (heartbeat bumps, audit inserts…) never fail a test.
 */
export function dispatchSql(queryMock: Mock, table: Array<[RegExp, SqlHandler]>): void {
  queryMock.mockImplementation(async (sql: unknown, params?: any[]) => {
    const text = typeof sql === 'string' ? sql : String((sql as any)?.text ?? '');
    for (const [re, handler] of table) {
      if (re.test(text)) {
        return typeof handler === 'function' ? handler(params) : handler;
      }
    }
    return { rows: [], rowCount: 0 };
  });
}
