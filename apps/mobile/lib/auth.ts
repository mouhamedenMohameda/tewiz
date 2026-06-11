import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

export interface AuthUser {
  id: string;
  phone: string;
  role: 'admin' | 'rider' | 'captain';
  fullName: string | null;
}

export type ActiveMode = 'rider' | 'captain';

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  activeMode: ActiveMode;
  hydrated: boolean;
  setSession: (s: { user: AuthUser; accessToken: string; refreshToken: string }) => Promise<void>;
  setUser: (u: AuthUser) => Promise<void>;
  setAccessToken: (t: string) => Promise<void>;
  setActiveMode: (m: ActiveMode) => Promise<void>;
  clear: () => Promise<void>;
  hydrate: () => Promise<void>;
}

const KEY = '@tewiz/auth';

interface Persisted {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  activeMode: ActiveMode;
}

async function persist(s: Persisted) {
  await AsyncStorage.setItem(KEY, JSON.stringify(s));
}

// A rider can only be in rider mode. Only a captain may switch to captain mode.
function defaultMode(role: AuthUser['role'], stored?: ActiveMode): ActiveMode {
  if (role !== 'captain') return 'rider';
  return stored ?? 'rider';
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  activeMode: 'rider',
  hydrated: false,

  setSession: async (s) => {
    const activeMode = defaultMode(s.user.role);
    await persist({ ...s, activeMode });
    set({ user: s.user, accessToken: s.accessToken, refreshToken: s.refreshToken, activeMode });
  },

  setUser: async (u) => {
    const cur = get();
    if (!cur.accessToken || !cur.refreshToken) return;
    // Demotion → force rider mode. Promotion → keep current (defaults to rider).
    const activeMode = u.role === 'captain' ? cur.activeMode : 'rider';
    await persist({
      user: u,
      accessToken: cur.accessToken,
      refreshToken: cur.refreshToken,
      activeMode,
    });
    set({ user: u, activeMode });
  },

  setAccessToken: async (t) => {
    const cur = get();
    if (!cur.user || !cur.refreshToken) return;
    await persist({
      user: cur.user,
      accessToken: t,
      refreshToken: cur.refreshToken,
      activeMode: cur.activeMode,
    });
    set({ accessToken: t });
  },

  setActiveMode: async (m) => {
    const cur = get();
    if (!cur.user || !cur.accessToken || !cur.refreshToken) return;
    if (m === 'captain' && cur.user.role !== 'captain') return;
    await persist({
      user: cur.user,
      accessToken: cur.accessToken,
      refreshToken: cur.refreshToken,
      activeMode: m,
    });
    set({ activeMode: m });
  },

  clear: async () => {
    await AsyncStorage.removeItem(KEY);
    set({ user: null, accessToken: null, refreshToken: null, activeMode: 'rider' });
  },

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw) {
        const p = JSON.parse(raw) as Partial<Persisted>;
        if (p.user && p.accessToken && p.refreshToken) {
          set({
            user: p.user,
            accessToken: p.accessToken,
            refreshToken: p.refreshToken,
            activeMode: defaultMode(p.user.role, p.activeMode),
            hydrated: true,
          });
          return;
        }
      }
    } catch {}
    set({ hydrated: true });
  },
}));
