import { io, type Socket } from 'socket.io-client';
import { env, isBackendEnabled } from '../lib/env';

let socket: Socket | null = null;
let lastToken: string | null = null;
const shouldLogSocketClient = () => {
  if (typeof window === 'undefined') return process.env.NODE_ENV !== 'production';
  try {
    if (window.localStorage.getItem('diavlocord-debug-socket') === '1') return true;
  } catch {}
  return process.env.NODE_ENV !== 'production';
};

export function getSocket(token?: string | null): Socket | null {
  if (!isBackendEnabled) return null;
  const nextToken = token ?? null;

  if (socket && lastToken === nextToken) return socket;

  try {
    socket?.disconnect();
  } catch {}

  lastToken = nextToken;
  socket = io(env.wsUrl, {
    autoConnect: false,
    auth: nextToken ? { token: nextToken } : undefined,
  });

  if (shouldLogSocketClient()) {
    console.log('[socket-client] getSocket', { wsUrl: env.wsUrl, hasToken: !!nextToken });
  }

  return socket;
}

export function disconnectSocket() {
  try {
    socket?.disconnect();
    if (shouldLogSocketClient()) {
      console.log('[socket-client] disconnectSocket');
    }
  } catch {}
  socket = null;
  lastToken = null;
}
