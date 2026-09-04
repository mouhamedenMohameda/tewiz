import { Platform } from 'react-native';
import * as Application from 'expo-application';
import { api } from './api';
import { useAuth } from './auth';

/**
 * Reads a stable, anonymous device identifier per platform. Crucially,
 * `getIosIdForVendorAsync()` THROWS `ERR_UNAVAILABLE` on Android (it doesn't
 * just return null), so we must branch on Platform.OS — otherwise the whole
 * guest login rejects before the network call ever happens.
 */
export async function getDeviceId(): Promise<string> {
  try {
    if (Platform.OS === 'ios') {
      const id = await Application.getIosIdForVendorAsync();
      if (id) return id;
    } else if (Platform.OS === 'android') {
      const id = Application.getAndroidId();
      if (id) return id;
    }
  } catch {
    // fall through to random fallback
  }
  return `guest-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/**
 * Provisions an anonymous "guest" rider session (POST /auth/guest) and stores
 * it. Called from the welcome screen so a user can enter the app and browse
 * without any sign-up. The account has no phone yet — it's captured the first
 * time it's needed (before a ride or a captain application).
 */
export async function loginAsGuest(): Promise<void> {
  const deviceId = await getDeviceId();

  const r = await api.post<{
    user: {
      id: string;
      phone: string | null;
      role: 'rider' | 'captain' | 'admin';
      fullName: string | null;
      isGuest?: boolean;
    };
    tokens: { accessToken: string; refreshToken: string };
  }>('/auth/guest', { deviceId });

  await useAuth.getState().setSession({
    user: {
      id: r.data.user.id,
      phone: r.data.user.phone,
      role: r.data.user.role,
      fullName: r.data.user.fullName,
      isGuest: r.data.user.isGuest ?? true,
    },
    accessToken: r.data.tokens.accessToken,
    refreshToken: r.data.tokens.refreshToken,
  });
}

/**
 * Reviewer / demonstration accounts. Self-signup is disabled, so App Store and
 * Google Play reviewers need a frictionless way in. Both accounts are
 * provisioned by `pnpm --filter @tewiz/api seed:store-test`:
 *   - rider:   browse + book a ride.
 *   - captain: KYC approved + active vehicle (also exposes the rider/captain
 *     ModeToggle, so it covers every feature).
 * These are surfaced as one-tap buttons on the welcome screen so a reviewer
 * never has to type the phone/password on an unfamiliar keyboard (the original
 * Guideline 2.1 rejection cause).
 */
export const DEMO_ACCOUNTS = {
  rider: { phone: '+22244000001', password: 'Demo2026!' },
  captain: { phone: '+22244000002', password: 'Demo2026!' },
} as const;

export type DemoRole = keyof typeof DEMO_ACCOUNTS;

/**
 * Logs into a fixed reviewer account (POST /auth/login) and stores the session.
 * Shared by the welcome screen demo buttons and the login screen so the device
 * id handling and session bookkeeping live in one place. The backend promotes
 * the captain account to its real role, so the stored session reflects it.
 */
export async function loginAsDemo(roleAccount: DemoRole): Promise<void> {
  const { phone, password } = DEMO_ACCOUNTS[roleAccount];
  const deviceId = await getDeviceId();

  const r = await api.post<{
    user: {
      id: string;
      phone: string | null;
      role: 'rider' | 'captain' | 'admin';
      fullName: string | null;
    };
    tokens: { accessToken: string; refreshToken: string };
  }>('/auth/login', { phone, password, role: 'rider', deviceId });

  await useAuth.getState().setSession({
    user: {
      id: r.data.user.id,
      phone: r.data.user.phone,
      role: r.data.user.role,
      fullName: r.data.user.fullName,
      isGuest: false,
    },
    accessToken: r.data.tokens.accessToken,
    refreshToken: r.data.tokens.refreshToken,
  });
}
