import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { API_URL } from './env';
import { useAuth } from './auth';

export const api: AxiosInstance = axios.create({
  baseURL: API_URL,
  timeout: 15_000,
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const t = useAuth.getState().accessToken;
  if (t) config.headers.set('Authorization', `Bearer ${t}`);
  return config;
});

let refreshing: Promise<string | null> | null = null;

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const cfg: any = error.config;
    if (
      error.response?.status === 401 &&
      cfg && !cfg.__retry &&
      useAuth.getState().refreshToken
    ) {
      cfg.__retry = true;
      if (!refreshing) {
        refreshing = (async () => {
          try {
            const r = await axios.post(`${API_URL}/auth/refresh`, {
              refreshToken: useAuth.getState().refreshToken,
            });
            await useAuth.getState().setAccessToken(r.data.accessToken);
            return r.data.accessToken as string;
          } catch {
            await useAuth.getState().clear();
            return null;
          }
        })();
      }
      const t = await refreshing;
      refreshing = null;
      if (t) {
        cfg.headers.Authorization = `Bearer ${t}`;
        return api.request(cfg);
      }
    }
    return Promise.reject(error);
  },
);
