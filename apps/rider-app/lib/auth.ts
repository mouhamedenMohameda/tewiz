import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

export interface AuthUser {
  id: string;
  phone: string;
  role: 'admin' | 'rider' | 'captain';
  fullName: string | null;
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  hydrated: boolean;
  setSession: (s: { user: AuthUser; accessToken: string; refreshToken: string }) => Promise<void>;
  setAccessToken: (t: string) => Promise<void>;
  clear: () => Promise<void>;
  hydrate: () => Promise<void>;
}

const KEY = '@tewiz/rider-auth';

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  hydrated: false,
  setSession: async (s) => {
    await AsyncStorage.setItem(KEY, JSON.stringify(s));
    set({ user: s.user, accessToken: s.accessToken, refreshToken: s.refreshToken });
  },
  setAccessToken: async (t) => {
    const cur = get();
    const next = { user: cur.user!, accessToken: t, refreshToken: cur.refreshToken! };
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
    set({ accessToken: t });
  },
  clear: async () => {
    await AsyncStorage.removeItem(KEY);
    set({ user: null, accessToken: null, refreshToken: null });
  },
  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw) {
        const p = JSON.parse(raw);
        set({
          user: p.user,
          accessToken: p.accessToken,
          refreshToken: p.refreshToken,
          hydrated: true,
        });
        return;
      }
    } catch {}
    set({ hydrated: true });
  },
}));
