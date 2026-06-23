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
async function getDeviceId(): Promise<string> {
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
