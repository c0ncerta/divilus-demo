import { buildDemoBootstrapData, buildDemoWorkspaceSnapshot, demoData } from '../demo-data';
import { env, isBackendEnabled, isDemoMode } from '../env';

type WorkspaceScope = 'full' | 'servers';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const backendHeaders = (token: string, includeJson = false) => ({
  ...(includeJson ? { 'Content-Type': 'application/json' } : {}),
  Authorization: `Bearer ${token}`,
});

const filterDemoUsers = (query: string) => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return demoData.users;
  return demoData.users.filter((user) => {
    const haystack = `${user.username} ${user.displayName || ''} ${user.id} ${user.discriminator}`.toLowerCase();
    return haystack.includes(normalized);
  });
};

export const dataProvider = {
  async bootstrap(token: string, options?: { includeUsers?: boolean; includeMessages?: boolean }): Promise<Response> {
    if (isDemoMode) {
      return jsonResponse(buildDemoBootstrapData(options));
    }
    if (!isBackendEnabled || !env.apiUrl || !token) {
      return jsonResponse({ error: 'backend_disabled' }, 400);
    }
    const query = new URLSearchParams({
      users: options?.includeUsers === false ? '0' : '1',
      messages: options?.includeMessages === false ? '0' : '1',
    });
    return fetch(`${env.apiUrl}/bootstrap?${query.toString()}`, {
      cache: 'no-store',
      headers: backendHeaders(token),
    });
  },

  async getWorkspace(token: string, scope: WorkspaceScope): Promise<Response> {
    if (isDemoMode) {
      return jsonResponse({ state: buildDemoWorkspaceSnapshot() });
    }
    if (!isBackendEnabled || !env.apiUrl || !token) {
      return jsonResponse({ error: 'backend_disabled' }, 400);
    }
    return fetch(`${env.apiUrl}/state/app?scope=${scope}`, {
      cache: 'no-store',
      headers: backendHeaders(token),
    });
  },

  async saveWorkspace(token: string, state: unknown, keepalive = false): Promise<Response> {
    if (isDemoMode) {
      return jsonResponse({ ok: true, mode: 'demo' });
    }
    if (!isBackendEnabled || !env.apiUrl || !token) {
      return jsonResponse({ error: 'backend_disabled' }, 400);
    }
    return fetch(`${env.apiUrl}/state/app`, {
      method: 'PUT',
      keepalive,
      headers: backendHeaders(token, true),
      body: JSON.stringify({ state }),
    });
  },

  async searchUsers(token: string, query: string, signal?: AbortSignal): Promise<Response> {
    if (isDemoMode) {
      const users = filterDemoUsers(query);
      return jsonResponse({ users });
    }
    if (!isBackendEnabled || !env.apiUrl || !token) {
      return jsonResponse({ error: 'backend_disabled' }, 400);
    }
    return fetch(`${env.apiUrl}/users/search?q=${encodeURIComponent(query)}`, {
      cache: 'no-store',
      headers: backendHeaders(token),
      signal,
    });
  },

  async getInvite(code: string, signal?: AbortSignal): Promise<Response> {
    if (isDemoMode) {
      return jsonResponse({ error: 'demo_mode' }, 404);
    }
    if (!isBackendEnabled || !env.apiUrl) {
      return jsonResponse({ error: 'backend_disabled' }, 400);
    }
    return fetch(`${env.apiUrl}/invites/${encodeURIComponent(code)}`, {
      cache: 'no-store',
      signal,
    });
  },

  async joinInvite(token: string, code: string, signal?: AbortSignal): Promise<Response> {
    if (isDemoMode) {
      return jsonResponse({ error: 'demo_mode' }, 403);
    }
    if (!isBackendEnabled || !env.apiUrl || !token) {
      return jsonResponse({ error: 'backend_disabled' }, 400);
    }
    return fetch(`${env.apiUrl}/invites/${encodeURIComponent(code)}/join`, {
      method: 'POST',
      headers: backendHeaders(token),
      signal,
    });
  },

  async sendDmMessage(
    token: string,
    conversationId: string,
    input: { content: string; attachments: unknown[] }
  ): Promise<Response> {
    if (isDemoMode) {
      return jsonResponse({ ok: true, mode: 'demo' });
    }
    if (!isBackendEnabled || !env.apiUrl || !token) {
      return jsonResponse({ error: 'backend_disabled' }, 400);
    }
    return fetch(`${env.apiUrl}/dm/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: 'POST',
      headers: backendHeaders(token, true),
      body: JSON.stringify(input),
    });
  },

  async createDmRequest(token: string, toUserId: string): Promise<Response> {
    if (isDemoMode) {
      return jsonResponse({ error: 'demo_mode' }, 403);
    }
    if (!isBackendEnabled || !env.apiUrl || !token) {
      return jsonResponse({ error: 'backend_disabled' }, 400);
    }
    return fetch(`${env.apiUrl}/dm/requests`, {
      method: 'POST',
      headers: backendHeaders(token, true),
      body: JSON.stringify({ toUserId }),
    });
  },

  async acceptDmRequest(token: string, requestId: string): Promise<Response> {
    if (isDemoMode) {
      return jsonResponse({ error: 'demo_mode' }, 403);
    }
    if (!isBackendEnabled || !env.apiUrl || !token) {
      return jsonResponse({ error: 'backend_disabled' }, 400);
    }
    return fetch(`${env.apiUrl}/dm/requests/${encodeURIComponent(requestId)}/accept`, {
      method: 'POST',
      headers: backendHeaders(token),
    });
  },

  async rejectDmRequest(token: string, requestId: string): Promise<Response> {
    if (isDemoMode) {
      return jsonResponse({ error: 'demo_mode' }, 403);
    }
    if (!isBackendEnabled || !env.apiUrl || !token) {
      return jsonResponse({ error: 'backend_disabled' }, 400);
    }
    return fetch(`${env.apiUrl}/dm/requests/${encodeURIComponent(requestId)}/reject`, {
      method: 'POST',
      headers: backendHeaders(token),
    });
  },

  async cancelDmRequest(token: string, requestId: string): Promise<Response> {
    if (isDemoMode) {
      return jsonResponse({ error: 'demo_mode' }, 403);
    }
    if (!isBackendEnabled || !env.apiUrl || !token) {
      return jsonResponse({ error: 'backend_disabled' }, 400);
    }
    const encoded = encodeURIComponent(requestId);
    const headers = backendHeaders(token);
    const cancelRes = await fetch(`${env.apiUrl}/dm/requests/${encoded}/cancel`, {
      method: 'POST',
      headers,
    }).catch(() => null);
    if (cancelRes && cancelRes.ok) return cancelRes;
    const deleteRes = await fetch(`${env.apiUrl}/dm/requests/${encoded}`, {
      method: 'DELETE',
      headers,
    }).catch(() => null);
    if (deleteRes) return deleteRes;
    return jsonResponse({ error: 'network_error' }, 503);
  },
};
