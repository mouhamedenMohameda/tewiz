import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { AxiosRequestConfig } from 'axios';
import { api } from './api';

export interface ApiQueryOptions {
  /**
   * Poll cadence in ms while the screen is focused. Omit for a one-shot fetch.
   * Polling automatically pauses when the screen loses focus or the app is
   * backgrounded (see queryClient focusManager wiring).
   */
  pollMs?: number;
  /** Disable the query until a prerequisite is ready (e.g. an id is known). */
  enabled?: boolean;
  /** Override how long a fetched value stays fresh (default: client 30 s). */
  staleMs?: number;
  /** Extra axios config (params, headers…). */
  config?: AxiosRequestConfig;
}

/**
 * Thin bridge from the app's axios client to React Query. Drop-in replacement
 * for the old `useState + useEffect(load) + usePolling(load, ms)` trio:
 *
 *   const { data: cells = [], isLoading } =
 *     useApiQuery<Cell[]>(['captain', 'heatmap'], '/captain/heatmap', { pollMs: 60_000 });
 *
 * Benefits over the manual pattern:
 *  - one shared cache keyed by `key`, so two screens hitting the same endpoint
 *    de-duplicate and reuse each other's data;
 *  - in-flight requests are aborted on unmount / refetch via the passed signal;
 *  - React Query's structural sharing keeps the same object reference when the
 *    payload is unchanged (same re-render avoidance as `keepIfEqual`, for free);
 *  - polling pauses off-focus and in the background, on the network layer.
 */
export function useApiQuery<T>(
  key: readonly unknown[],
  path: string,
  opts: ApiQueryOptions = {},
): UseQueryResult<T> {
  const { pollMs, enabled = true, staleMs, config } = opts;

  // Pause polling when the screen isn't focused — mirrors usePolling's
  // useFocusEffect so a screen sitting in the back stack stops the network
  // chatter (battery + data on 2G/3G).
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  return useQuery<T>({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const r = await api.get<T>(path, { ...config, signal });
      return r.data;
    },
    enabled,
    staleTime: staleMs,
    refetchInterval: pollMs && focused ? pollMs : false,
    refetchIntervalInBackground: false,
  });
}
