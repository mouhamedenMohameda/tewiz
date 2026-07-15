import { type ReactNode, useState } from 'react';
import { AppState, type AppStateStatus, Platform } from 'react-native';
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
} from '@tanstack/react-query';

/**
 * Shared data-fetching cache for the whole app.
 *
 * Why this exists: every screen used to fetch on its own (axios + a manual
 * poll), so two screens showing the same thing (e.g. the demand heatmap on the
 * captain home AND the heatmap screen) each hit the network independently, and
 * a screen re-mounting always refetched from scratch. React Query gives us one
 * shared cache keyed by endpoint: overlapping requests are de-duplicated, a
 * value stays "fresh" for a while so re-opening a screen is instant, and
 * background refetches update every subscriber at once. On 2G/3G that means
 * fewer bytes and less battery.
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // A fetched value is considered fresh for 30 s — remounting a screen
        // within that window paints from cache with no network call. Screens
        // that need it fresher/staler override per-query.
        staleTime: 30_000,
        // Keep an unused (unsubscribed) value around for 5 min before it's
        // garbage-collected, so quick back-and-forth navigation stays instant.
        gcTime: 5 * 60_000,
        // Weak networks drop requests constantly; one retry smooths over a
        // transient failure without hammering the link on a real outage.
        retry: 1,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
        // We drive "focus" off React Native AppState below, so refetch when the
        // user returns to the app if the data went stale while backgrounded.
        refetchOnWindowFocus: true,
        // The network layer already sends compact JSON; don't refetch on mount
        // if the cached value is still fresh.
        refetchOnReconnect: true,
      },
    },
  });
}

// Bridge React Query's "focus" concept to the app's foreground/background
// state. Backgrounding the app stops interval refetches (battery + data);
// returning to the foreground refetches anything that went stale. Registered
// once at module load — it's a global, not per-render.
focusManager.setEventListener((handleFocus) => {
  const sub = AppState.addEventListener('change', (status: AppStateStatus) => {
    if (Platform.OS !== 'web') handleFocus(status === 'active');
  });
  return () => sub.remove();
});

export function AppQueryProvider({ children }: { children: ReactNode }) {
  // One client per app instance, created lazily so it survives re-renders but
  // isn't shared across Fast Refresh reloads in dev.
  const [client] = useState(makeQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
