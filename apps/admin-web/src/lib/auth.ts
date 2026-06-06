'use client';

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
  setSession: (s: { user: AuthUser; accessToken: string; refreshToken: string }) => void;
  setAccessToken: (t: string) => void;
  clear: () => void;
  hydrate: () => void;
}

const KEY = 'tewiz-admin-auth';

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  hydrated: false,
  setSession: (s) => {
    localStorage.setItem(KEY, JSON.stringify(s));
    set({ user: s.user, accessToken: s.accessToken, refreshToken: s.refreshToken });
  },
  setAccessToken: (t) => {
    const cur = get();
    const next = { ...cur, accessToken: t };
    if (cur.user && cur.refreshToken) {
      localStorage.setItem(KEY, JSON.stringify({
        user: cur.user, accessToken: t, refreshToken: cur.refreshToken,
      }));
    }
    set(next);
  },
  clear: () => {
    localStorage.removeItem(KEY);
    set({ user: null, accessToken: null, refreshToken: null });
  },
  hydrate: () => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        set({
          user: parsed.user,
          accessToken: parsed.accessToken,
          refreshToken: parsed.refreshToken,
          hydrated: true,
        });
        return;
      }
    } catch { /* ignore */ }
    set({ hydrated: true });
  },
}));
