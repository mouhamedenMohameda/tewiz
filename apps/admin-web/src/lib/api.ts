'use client';

import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { API_URL } from './env';
import { useAuth } from './auth';

// Single axios instance. Bearer token attached from the Zustand store.
export const api: AxiosInstance = axios.create({
  baseURL: API_URL,
  timeout: 15_000,
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const t = useAuth.getState().accessToken;
  if (t) config.headers.set('Authorization', `Bearer ${t}`);
  return config;
});

// Auto-refresh on 401 using the refresh token, then retry once.
let refreshing: Promise<string | null> | null = null;

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const cfg = error.config;
    if (
      error.response?.status === 401 &&
      cfg && !cfg.__retry &&
      useAuth.getState().refreshToken
    ) {
      cfg.__retry = true;
      try {
        if (!refreshing) {
          refreshing = (async () => {
            const r = await axios.post(`${API_URL}/auth/refresh`, {
              refreshToken: useAuth.getState().refreshToken,
            });
            const next = r.data.accessToken as string;
            useAuth.getState().setAccessToken(next);
            return next;
          })();
        }
        const t = await refreshing;
        refreshing = null;
        if (t) {
          cfg.headers.Authorization = `Bearer ${t}`;
          return api.request(cfg);
        }
      } catch {
        useAuth.getState().clear();
      }
    }
    return Promise.reject(error);
  },
);

/**
 * Fetch an authenticated binary (used for document/screenshot images).
 * Returns an object URL the browser can render in <img src>.
 * Caller must URL.revokeObjectURL when done.
 */
export async function fetchImage(path: string): Promise<string> {
  const r = await api.get(path, { responseType: 'blob' });
  return URL.createObjectURL(r.data);
}
