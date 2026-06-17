import * as Application from 'expo-application';
import { api } from './api';
import { useAuth } from './auth';

/**
 * Provisions an anonymous "guest" rider session (POST /auth/guest) and stores
 * it. Called from the welcome screen so a user can enter the app and browse
 * without any sign-up. The account has no phone yet — it's captured the first
 * time it's needed (before a ride or a captain application).
 */
export async function loginAsGuest(): Promise<void> {
  const deviceId =
    (await Application.getIosIdForVendorAsync()) ??
    Application.getAndroidId() ??
    `guest-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

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
