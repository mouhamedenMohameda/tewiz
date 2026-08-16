import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { setUser as setSentryUser } from './sentry';
import { setTokens, setAccessToken as persistAccessToken, getTokens, clearTokens, migrateLegacyTokens } from './secureTokens';

export interface AuthUser {
  id: string;
  // Null for a fresh guest who hasn't entered a number yet. Captured before the
  // first ride (or captain application) via POST /auth/me/phone.
  phone: string | null;
  role: 'admin' | 'rider' | 'captain';
  fullName: string | null;
  // True for an anonymous guest account (POST /auth/guest). Cleared when the
  // guest is promoted to a real captain. Optional so older persisted sessions
  // (pre-guest) and login/refresh paths can omit it.
  isGuest?: boolean;
  // Grants the voice-dataset collection screen. Server-side flag, refreshed
  // from /auth/me on boot — the JWT does not carry it, so a grant or a
  // revocation takes effect without the tester logging out. Optional so
  // sessions persisted before the flag existed still deserialize.
  isTester?: boolean;
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

// Only non-sensitive session data lives in AsyncStorage. The two tokens are
// held in SecureStore (see lib/secureTokens.ts).
interface StoredProfile {
  user: AuthUser;
  activeMode: ActiveMode;
}

async function persist(s: Persisted) {
  await AsyncStorage.setItem(
    KEY,
    JSON.stringify({ user: s.user, activeMode: s.activeMode } satisfies StoredProfile),
  );
  await setTokens({ accessToken: s.accessToken, refreshToken: s.refreshToken });
}

// A rider can only be in rider mode. Only a captain may switch to captain mode.
function defaultMode(role: AuthUser['role'], stored?: ActiveMode): ActiveMode {
  if (role !== 'captain') return 'rider';
  return stored ?? 'captain';
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
    // Tag crash reports with the signed-in user so we can correlate
    // crashes to specific accounts on the Sentry dashboard.
    setSentryUser({ id: s.user.id, phone: s.user.phone ?? '(no-phone)' });
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
    await persistAccessToken(t);
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
    await clearTokens();
    set({ user: null, accessToken: null, refreshToken: null, activeMode: 'rider' });
    setSentryUser(null);
  },

  hydrate: async () => {
    try {
      // Tokens live in SecureStore now; a session created before this change
      // still carries them in the legacy AsyncStorage blob — migrate on first
      // run so existing users aren't logged out.
      let tokens = await getTokens();
      if (!tokens) tokens = await migrateLegacyTokens();

      const raw = await AsyncStorage.getItem(KEY);
      if (raw && tokens) {
        const p = JSON.parse(raw) as Partial<StoredProfile>;
        if (p.user) {
          set({
            user: p.user,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            activeMode: defaultMode(p.user.role, p.activeMode),
            hydrated: true,
          });
          setSentryUser({ id: p.user.id, phone: p.user.phone ?? '(no-phone)' });
          return;
        }
      }
    } catch {}
    set({ hydrated: true });
  },
}));
