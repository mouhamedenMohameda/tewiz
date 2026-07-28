/**
 * Encrypted persistence for the auth tokens (iOS Keychain / Android Keystore).
 *
 * Why not AsyncStorage: AsyncStorage is unencrypted plaintext on the device
 * filesystem, so a rooted/jailbroken phone or a device backup leaks the bearer
 * tokens. SecureStore keeps them in the platform secure enclave.
 *
 * `keychainAccessible: AFTER_FIRST_UNLOCK` is required, NOT the default
 * `WHEN_UNLOCKED`: the background location task (lib/track-task.ts) reads these
 * tokens while the phone is locked, and the default would make the Keychain
 * refuse the read once the screen locks, silently killing background tracking.
 *
 * Only the two secrets live here. Non-sensitive session data (user profile,
 * active mode) stays in AsyncStorage — see lib/auth.ts.
 *
 * Usable from both the normal app context and the headless TaskManager context,
 * so it must not import the Zustand store (would pull in a non-hydrated graph).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

const ACCESS_KEY = 'tewiz.accessToken';
const REFRESH_KEY = 'tewiz.refreshToken';

// The pre-SecureStore AsyncStorage blob (lib/auth.ts) used to carry the tokens
// inline. Kept here so both the app and the background task can migrate an
// existing session on first run after the update instead of logging users out.
const LEGACY_AUTH_KEY = '@tewiz/auth';

const OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

/** Persist both tokens. */
export async function setTokens(t: Tokens): Promise<void> {
  await SecureStore.setItemAsync(ACCESS_KEY, t.accessToken, OPTS);
  await SecureStore.setItemAsync(REFRESH_KEY, t.refreshToken, OPTS);
}

/** Update just the access token (refresh flow), leaving the refresh token. */
export async function setAccessToken(accessToken: string): Promise<void> {
  await SecureStore.setItemAsync(ACCESS_KEY, accessToken, OPTS);
}

/** Read both tokens, or null if either is missing (treated as signed out). */
export async function getTokens(): Promise<Tokens | null> {
  const [accessToken, refreshToken] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_KEY, OPTS),
    SecureStore.getItemAsync(REFRESH_KEY, OPTS),
  ]);
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken };
}

/** Remove both tokens (sign out). */
export async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_KEY, OPTS),
    SecureStore.deleteItemAsync(REFRESH_KEY, OPTS),
  ]);
}

/**
 * One-shot migration for sessions created before this change: if SecureStore
 * has no tokens but the legacy AsyncStorage blob still carries them, move them
 * into SecureStore and strip them from the blob. Returns the migrated tokens
 * (or null if there was nothing to migrate). Idempotent and safe to call from
 * either context.
 */
export async function migrateLegacyTokens(): Promise<Tokens | null> {
  const raw = await AsyncStorage.getItem(LEGACY_AUTH_KEY);
  if (!raw) return null;
  let blob: Record<string, unknown>;
  try {
    blob = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const accessToken = blob.accessToken;
  const refreshToken = blob.refreshToken;
  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') return null;

  await setTokens({ accessToken, refreshToken });
  // Rewrite the blob without the secrets so they don't linger in plaintext.
  delete blob.accessToken;
  delete blob.refreshToken;
  await AsyncStorage.setItem(LEGACY_AUTH_KEY, JSON.stringify(blob));
  return { accessToken, refreshToken };
}
