import { mapBackendUser } from '../backend-user';
import { demoData } from '../demo-data';
import { env, isBackendEnabled, isDemoMode } from '../env';
import type { User } from '../types';

type BootMode = 'demo' | 'backend' | 'local' | 'none';

export type BootResult = {
  mode: BootMode;
  token: string | null;
  user: User | null;
  userId: string | null;
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const safeLocalStorageGet = (key: string): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const safeLocalStorageRemove = (key: string) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {}
};

export const authProvider = {
  async me(token: string, signal?: AbortSignal): Promise<Response> {
    if (isDemoMode) {
      return jsonResponse({ user: demoData.currentUser });
    }
    if (!isBackendEnabled || !env.apiUrl || !token) {
      return jsonResponse({ error: 'backend_disabled' }, 400);
    }
    return fetch(`${env.apiUrl}/me`, {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
  },

  async login(input: { username: string; password: string }, signal?: AbortSignal): Promise<Response> {
    if (isDemoMode) {
      return jsonResponse({ error: 'demo_read_only' }, 403);
    }
    if (!isBackendEnabled || !env.apiUrl) {
      return jsonResponse({ error: 'backend_disabled' }, 400);
    }
    return fetch(`${env.apiUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    });
  },

  async register(input: { username: string; password: string }, signal?: AbortSignal): Promise<Response> {
    if (isDemoMode) {
      return jsonResponse({ error: 'demo_read_only' }, 403);
    }
    if (!isBackendEnabled || !env.apiUrl) {
      return jsonResponse({ error: 'backend_disabled' }, 400);
    }
    return fetch(`${env.apiUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    });
  },

  async recover(
    input: { username: string; recoveryCode: string; newPassword: string },
    signal?: AbortSignal
  ): Promise<Response> {
    if (isDemoMode) {
      return jsonResponse({ error: 'demo_read_only' }, 403);
    }
    if (!isBackendEnabled || !env.apiUrl) {
      return jsonResponse({ error: 'backend_disabled' }, 400);
    }
    return fetch(`${env.apiUrl}/auth/recover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    });
  },

  async health(signal?: AbortSignal): Promise<Response> {
    if (isDemoMode) {
      return jsonResponse({ ok: true, mode: 'demo' });
    }
    if (!isBackendEnabled || !env.apiUrl) {
      return jsonResponse({ error: 'backend_disabled' }, 400);
    }
    return fetch(`${env.apiUrl}/health`, {
      method: 'GET',
      cache: 'no-store',
      signal,
    });
  },

  async updateProfile(
    token: string,
    input: {
      username: string;
      displayName: string | null;
      pronouns: string | null;
      bio: string | null;
      avatar: string | null;
      banner: string | null;
      bannerColor: string | null;
    },
    signal?: AbortSignal
  ): Promise<Response> {
    if (isDemoMode) {
      return jsonResponse({ ok: true, mode: 'demo' });
    }
    if (!isBackendEnabled || !env.apiUrl || !token) {
      return jsonResponse({ error: 'backend_disabled' }, 400);
    }
    return fetch(`${env.apiUrl}/me/profile`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
      signal,
    });
  },

  async bootstrapSession(): Promise<BootResult> {
    if (typeof window === 'undefined') {
      return { mode: 'none', token: null, user: null, userId: null };
    }

    if (isDemoMode) {
      return {
        mode: 'demo',
        token: null,
        user: demoData.currentUser,
        userId: demoData.currentUser.id,
      };
    }

    if (isBackendEnabled) {
      const token = safeLocalStorageGet('diavlocord-backend-token');
      if (!token) {
        return { mode: 'none', token: null, user: null, userId: null };
      }

      try {
        const response = await this.me(token);
        const payload = await response.json().catch(() => ({} as any));
        const backendUser = (payload as any)?.user;
        if (response.ok && backendUser?.id) {
          return {
            mode: 'backend',
            token,
            user: mapBackendUser(backendUser),
            userId: String(backendUser.id),
          };
        }
      } catch {}

      safeLocalStorageRemove('diavlocord-backend-token');
      return { mode: 'none', token: null, user: null, userId: null };
    }

    const localSessionUserId = safeLocalStorageGet('diavlocord-session');
    if (localSessionUserId) {
      return { mode: 'local', token: null, user: null, userId: localSessionUserId };
    }
    return { mode: 'none', token: null, user: null, userId: null };
  },
};
