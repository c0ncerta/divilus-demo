'use client';

import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { ServerSidebar } from '../components/layout/ServerSidebar';
import { ChannelSidebar } from '../components/layout/ChannelSidebar';
import { RightSidebar } from '../components/layout/RightSidebar';
import { ChatView } from '../components/chat/ChatView';
import { useSocket } from '../hooks/useSocket';
import { SettingsModal } from '../components/modals/SettingsModal';
import { useStore } from '../lib/store';
import { env, isBackendEnabled, isDemoMode } from '../lib/env';
import { mapBackendUser } from '../lib/backend-user';
import { demoData } from '../lib/demo-data';
import { authProvider } from '../lib/providers/auth-provider';
import { dataProvider } from '../lib/providers/data-provider';
import { ensureOwnersHaveAdminRole } from '../lib/server-owner-admin';
import { getSocket } from '../services/socket-client';
import { cn } from '../lib/utils';
import { announce } from '../lib/a11y/announcer';
import { Info, Menu, Settings2, Users, X } from 'lucide-react';

// Lazy-load components not needed in demo mode
const LoginVideo = isDemoMode ? null : lazy(() => import('../components/LoginVideo'));

const isObject = (v: any) => !!v && typeof v === 'object' && !Array.isArray(v);
const hasMembershipInServers = (servers: any[], userId: string) =>
  Array.isArray(servers)
    ? servers.some(
      (server) =>
        Array.isArray(server?.members) &&
        server.members.some((member: any) => member?.userId === userId)
    )
    : false;

const normalizeEntityId = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const next = String(value).trim();
  return next.length > 0 ? next : null;
};

const inferAttachmentContentType = (filename: string): string => {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  return 'application/octet-stream';
};

const normalizeAttachmentsForRuntime = (value: unknown) => {
  if (!Array.isArray(value)) return undefined;
  const normalized = value
    .filter((entry) => Boolean(entry && typeof entry === 'object'))
    .map((entry, index) => {
      const url = typeof (entry as any).url === 'string' ? String((entry as any).url).trim() : '';
      if (!url) return null;
      const fallbackName = `attachment-${index + 1}`;
      const filenameRaw = typeof (entry as any).filename === 'string' ? String((entry as any).filename).trim() : '';
      const filename = filenameRaw || fallbackName;
      const id = normalizeEntityId((entry as any).id) || `${fallbackName}-${index}`;
      const rawContentType = typeof (entry as any).contentType === 'string' ? String((entry as any).contentType).trim() : '';
      const sizeRaw = Number((entry as any).size);
      return {
        id,
        url,
        filename,
        contentType: rawContentType || inferAttachmentContentType(filename),
        size: Number.isFinite(sizeRaw) && sizeRaw > 0 ? sizeRaw : 0,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .slice(0, 12);
  return normalized.length > 0 ? normalized : undefined;
};

const MAX_SYNC_MESSAGES_PER_CHANNEL = 120;
const MAX_SYNC_THREAD_MESSAGES_PER_THREAD = 80;
const MAX_SYNC_CONTENT_LENGTH = 2000;

const sanitizeAttachmentsForWorkspaceSync = (value: unknown) => {
  if (!Array.isArray(value)) return undefined;
  const out = value
    .filter(
      (entry) =>
        entry &&
        typeof entry === 'object' &&
        typeof (entry as any).id === 'string' &&
        typeof (entry as any).url === 'string' &&
        typeof (entry as any).filename === 'string' &&
        typeof (entry as any).contentType === 'string' &&
        !String((entry as any).url).startsWith('data:')
    )
    .slice(0, 8)
    .map((entry) => ({
      id: String((entry as any).id).slice(0, 128),
      url: String((entry as any).url).slice(0, 8192),
      filename: String((entry as any).filename).slice(0, 512),
      contentType: String((entry as any).contentType).slice(0, 256),
      size: Number((entry as any).size) || 0,
    }));
  return out.length > 0 ? out : undefined;
};

const sanitizeMessagesForWorkspaceSync = (
  messages: Record<string, unknown>,
  perChannelLimit: number
): Record<string, any[]> => {
  const output: Record<string, any[]> = {};
  for (const [channelId, list] of Object.entries(messages || {})) {
    if (!Array.isArray(list) || list.length === 0) continue;
    const safeList = list
      .filter((message): message is Record<string, unknown> => Boolean(message && typeof message === 'object'))
      .slice(-perChannelLimit)
      .map((message) => ({
        ...message,
        content:
          typeof message.content === 'string'
            ? message.content.slice(0, MAX_SYNC_CONTENT_LENGTH)
            : '',
        attachments: sanitizeAttachmentsForWorkspaceSync(message.attachments),
      }));
    if (safeList.length > 0) output[channelId] = safeList;
  }
  return output;
};

const areStringArraysEqual = (a: string[], b: string[]) => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

const areDmGroupsEqual = (a: Array<{ id: string; memberIds: string[] }>, b: Array<{ id: string; memberIds: string[] }>) => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i]?.id !== b[i]?.id) return false;
    if (!areStringArraysEqual(a[i]?.memberIds || [], b[i]?.memberIds || [])) return false;
  }
  return true;
};

const areDmRequestsEqual = (
  a: Array<{ id: string; fromUserId: string; toUserId: string; createdAt: string }>,
  b: Array<{ id: string; fromUserId: string; toUserId: string; createdAt: string }>
) => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (
      left?.id !== right?.id ||
      left?.fromUserId !== right?.fromUserId ||
      left?.toUserId !== right?.toUserId ||
      left?.createdAt !== right?.createdAt
    ) {
      return false;
    }
  }
  return true;
};

const areMessageListsEqual = (a: any[], b: any[]) => {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (
      left?.id !== right?.id ||
      left?.authorId !== right?.authorId ||
      left?.timestamp !== right?.timestamp ||
      left?.content !== right?.content
    ) {
      return false;
    }
    const leftAtt = Array.isArray(left?.attachments) ? left.attachments : [];
    const rightAtt = Array.isArray(right?.attachments) ? right.attachments : [];
    if (leftAtt.length !== rightAtt.length) return false;
  }
  return true;
};

export default function DiscordClone() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'profile' | 'server'>('profile');
  const [socketStatus, setSocketStatus] = useState<'offline' | 'connecting' | 'online' | 'error'>('offline');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isMobileLayout, setIsMobileLayout] = useState(false);
  const [isDesktopRuntime, setIsDesktopRuntime] = useState(false);
  const backendToken = useStore((s) => s.backendToken);
  const currentUserId = useStore((s) => s.currentUser.id);
  const servers = useStore((s) => s.servers);
  const users = useStore((s) => s.users);
  const activeServerId = useStore((s) => s.activeServerId);
  const activeChannelId = useStore((s) => s.activeChannelId);
  const rightSidebarOpen = useStore((s) => s.rightSidebarOpen);
  const rightSidebarView = useStore((s) => s.rightSidebarView);
  const setRightSidebarOpen = useStore((s) => s.setRightSidebarOpen);
  const setRightSidebarView = useStore((s) => s.setRightSidebarView);
  const saveStateRef = useRef<{ lastSerialized: string; inFlight: boolean }>({ lastSerialized: '', inFlight: false });
  const hydratedForRef = useRef('');
  const lastAnnouncedChannelRef = useRef<string | null>(null);
  const previousSocketStatusRef = useRef<'offline' | 'connecting' | 'online' | 'error'>('offline');

  // Initialize event listeners
  useSocket();

  const hydrateBackendData = async (
    token: string,
    options?: { includeUsers?: boolean; includeMessages?: boolean }
  ) => {
    try {
      const includeUsers = options?.includeUsers !== false;
      const includeMessages = options?.includeMessages !== false;

      const res = await dataProvider.bootstrap(token, {
        includeUsers,
        includeMessages,
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) return false;

      const users = Array.isArray((data as any).users)
        ? (data as any).users.map((u: any) => mapBackendUser(u))
        : [];

      const dmConversations = Array.isArray((data as any).dmConversations)
        ? ((data as any).dmConversations as any[])
        : [];

      const dmGroups = dmConversations
        .map((c: any) => {
          const id = normalizeEntityId(c?.id);
          if (!id) return null;
          const memberIds = Array.isArray(c?.memberIds)
            ? (c.memberIds as unknown[])
              .map((memberId) => normalizeEntityId(memberId))
              .filter((memberId): memberId is string => typeof memberId === 'string' && memberId.length > 0)
            : [];
          if (memberIds.length === 0) return null;
          return {
            id,
            memberIds,
          };
        })
        .filter((entry): entry is { id: string; memberIds: string[] } => Boolean(entry));

      const dmMessages = dmConversations.reduce((acc: Record<string, any[]>, c: any) => {
        const conversationId = normalizeEntityId(c?.id);
        if (!conversationId || !includeMessages || !Array.isArray(c?.messages)) return acc;
        const list = (c.messages as any[])
          .map((m: any) => {
            const messageId = normalizeEntityId(m?.id);
            const authorId = normalizeEntityId(m?.authorId);
            if (!messageId || !authorId) return null;
            const createdAt =
              typeof m?.createdAt === 'string' && m.createdAt.trim().length > 0
                ? m.createdAt
                : new Date().toISOString();
            return {
              id: messageId,
              channelId: conversationId,
              authorId,
              content: typeof m?.content === 'string' ? m.content : '',
              timestamp: createdAt,
              attachments: normalizeAttachmentsForRuntime(m?.attachments),
            };
          })
          .filter((message): message is NonNullable<typeof message> => Boolean(message));
        acc[conversationId] = list;
        return acc;
      }, {});

      const dmRequestsIncoming = Array.isArray((data as any).dmRequestsIncoming)
        ? (data as any).dmRequestsIncoming
          .map((r: any) => {
            const id = normalizeEntityId(r?.id);
            const fromUserId = normalizeEntityId(r?.fromUserId);
            const toUserId = normalizeEntityId(r?.toUserId);
            if (!id || !fromUserId || !toUserId) return null;
            return {
              id,
              fromUserId,
              toUserId,
              createdAt: typeof r?.createdAt === 'string' ? r.createdAt : new Date().toISOString(),
            };
          })
          .filter(
            (
              entry: { id: string; fromUserId: string; toUserId: string; createdAt: string } | null
            ): entry is { id: string; fromUserId: string; toUserId: string; createdAt: string } => Boolean(entry)
          )
        : [];

      const dmRequestsOutgoing = Array.isArray((data as any).dmRequestsOutgoing)
        ? (data as any).dmRequestsOutgoing
          .map((r: any) => {
            const id = normalizeEntityId(r?.id);
            const fromUserId = normalizeEntityId(r?.fromUserId);
            const toUserId = normalizeEntityId(r?.toUserId);
            if (!id || !fromUserId || !toUserId) return null;
            return {
              id,
              fromUserId,
              toUserId,
              createdAt: typeof r?.createdAt === 'string' ? r.createdAt : new Date().toISOString(),
            };
          })
          .filter(
            (
              entry: { id: string; fromUserId: string; toUserId: string; createdAt: string } | null
            ): entry is { id: string; fromUserId: string; toUserId: string; createdAt: string } => Boolean(entry)
          )
        : [];

      if (users.length > 0) {
        useStore.getState().upsertUsers(users);
      }
      useStore.setState((st: any) => {
        const nextPinnedDmIds = Array.isArray(st.pinnedDmIds)
          ? st.pinnedDmIds.filter((id: string) => dmGroups.some((g: any) => g?.id === id))
          : [];

        const sameGroups = areDmGroupsEqual(st.dmGroups || [], dmGroups);
        const samePinned = areStringArraysEqual(st.pinnedDmIds || [], nextPinnedDmIds);
        const sameIncoming = areDmRequestsEqual(st.dmRequestsIncoming || [], dmRequestsIncoming);
        const sameOutgoing = areDmRequestsEqual(st.dmRequestsOutgoing || [], dmRequestsOutgoing);

        let messagesChanged = false;
        let nextMessages = st.messages;

        if (includeMessages) {
          const previousDmIds = new Set((st.dmGroups || []).map((g: any) => g.id));
          const preservedMessages = Object.fromEntries(
            Object.entries(st.messages || {}).filter(([channelId]) => !previousDmIds.has(channelId))
          );
          nextMessages = { ...preservedMessages, ...dmMessages };

          const nextDmIds = dmGroups.map((g) => g.id);
          const prevDmIds = Array.isArray(st.dmGroups) ? st.dmGroups.map((g: any) => g.id) : [];
          const dmIdSet = new Set<string>([...prevDmIds, ...nextDmIds]);
          for (const dmId of Array.from(dmIdSet.values())) {
            const before = Array.isArray(st.messages?.[dmId]) ? st.messages[dmId] : [];
            const after = Array.isArray(nextMessages?.[dmId]) ? nextMessages[dmId] : [];
            if (!areMessageListsEqual(before, after)) {
              messagesChanged = true;
              break;
            }
          }
        }

        if (sameGroups && samePinned && sameIncoming && sameOutgoing && !messagesChanged) {
          return st;
        }

        return {
          ...(includeMessages ? { messages: nextMessages } : {}),
          dmGroups,
          pinnedDmIds: nextPinnedDmIds,
          dmRequestsIncoming,
          dmRequestsOutgoing,
        };
      });
      return true;
    } catch {
      return false;
    }
  };

  const buildWorkspacePayload = () => {
    const st: any = useStore.getState();
    const dmIds = new Set((st.dmGroups || []).map((g: any) => g.id));
    const nonDmMessagesRaw = Object.fromEntries(
      Object.entries(st.messages || {}).filter(([channelId]) => !dmIds.has(channelId))
    );
    const nonDmMessages = sanitizeMessagesForWorkspaceSync(nonDmMessagesRaw, MAX_SYNC_MESSAGES_PER_CHANNEL);
    const safeThreadMessages = sanitizeMessagesForWorkspaceSync(
      isObject(st.threadMessages) ? st.threadMessages : {},
      MAX_SYNC_THREAD_MESSAGES_PER_THREAD
    );
    return {
      servers: st.servers,
      messages: nonDmMessages,
      presences: st.presences,
      activeServerId: st.activeServerId,
      activeChannelId: st.activeChannelId,
      memberTimeouts: st.memberTimeouts,
      serverBans: st.serverBans,
      auditLog: st.auditLog,
      threads: st.threads,
      threadMessages: safeThreadMessages,
      activeThreadId: st.activeThreadId,
    };
  };

  const applyWorkspaceSnapshot = (snapshot: any) => {
    if (!isObject(snapshot)) return;
    useStore.setState((st: any) => {
      const dmIds = new Set((st.dmGroups || []).map((g: any) => g.id));
      const snapshotMessages = isObject(snapshot.messages)
        ? Object.fromEntries(
          Object.entries(snapshot.messages as Record<string, any>).filter(([channelId]) => !dmIds.has(channelId))
        )
        : {};
      const incomingMessages = sanitizeMessagesForWorkspaceSync(
        snapshotMessages as Record<string, any[]>,
        MAX_SYNC_MESSAGES_PER_CHANNEL
      );
      const incomingServers = Array.isArray(snapshot.servers) && snapshot.servers.length > 0
        ? ensureOwnersHaveAdminRole(snapshot.servers as any)
        : st.servers;

      const toServerChannelIds = (serverId: string | null | undefined) => {
        if (!serverId) return new Set<string>();
        const server = Array.isArray(incomingServers)
          ? incomingServers.find((entry: any) => entry?.id === serverId)
          : null;
        const ids =
          server?.categories?.flatMap((cat: any) => cat?.channels || []).map((ch: any) => ch?.id).filter(Boolean) || [];
        return new Set<string>(ids);
      };

      const isDmChannel = (channelId: string | null | undefined) =>
        !!channelId && Array.isArray(st.dmGroups) && st.dmGroups.some((group: any) => group?.id === channelId);

      const localServerChannelIds = toServerChannelIds(st.activeServerId);
      const localSelectionLooksValid =
        (st.activeServerId === null && (st.activeChannelId === null || isDmChannel(st.activeChannelId))) ||
        (st.activeServerId !== null &&
          (st.activeChannelId === null || localServerChannelIds.has(st.activeChannelId)));
      const navigationIsFresh =
        typeof st.lastNavigationAt === 'number' && Date.now() - st.lastNavigationAt < 8000;

      const snapshotActiveServerId =
        typeof snapshot.activeServerId === 'string' || snapshot.activeServerId === null
          ? snapshot.activeServerId
          : null;
      const snapshotActiveChannelId =
        typeof snapshot.activeChannelId === 'string' || snapshot.activeChannelId === null
          ? snapshot.activeChannelId
          : null;

      let nextActiveServerId = st.activeServerId;
      let nextActiveChannelId = st.activeChannelId;

      // Do not override a valid local navigation selection with stale backend snapshot data.
      if (!localSelectionLooksValid && !navigationIsFresh) {
        if (snapshotActiveServerId) {
          const snapshotServerChannelIds = toServerChannelIds(snapshotActiveServerId);
          const fallbackServer = Array.isArray(incomingServers)
            ? incomingServers.find((entry: any) => entry?.id === snapshotActiveServerId)
            : null;
          const fallbackChannelId = fallbackServer?.categories?.[0]?.channels?.[0]?.id || null;
          nextActiveServerId = snapshotActiveServerId;
          nextActiveChannelId =
            typeof snapshotActiveChannelId === 'string' && snapshotServerChannelIds.has(snapshotActiveChannelId)
              ? snapshotActiveChannelId
              : fallbackChannelId;
        } else if (snapshotActiveServerId === null) {
          nextActiveServerId = null;
          nextActiveChannelId = isDmChannel(snapshotActiveChannelId) ? snapshotActiveChannelId : null;
        }
      }

      return {
        servers: incomingServers,
        messages: { ...st.messages, ...incomingMessages },
        presences: isObject(snapshot.presences) ? snapshot.presences : st.presences,
        activeServerId: nextActiveServerId,
        activeChannelId: nextActiveChannelId,
        memberTimeouts: isObject(snapshot.memberTimeouts) ? snapshot.memberTimeouts : st.memberTimeouts,
        serverBans: isObject(snapshot.serverBans) ? snapshot.serverBans : st.serverBans,
        auditLog: isObject(snapshot.auditLog) ? snapshot.auditLog : st.auditLog,
        threads: isObject(snapshot.threads) ? snapshot.threads : st.threads,
        threadMessages: isObject(snapshot.threadMessages)
          ? sanitizeMessagesForWorkspaceSync(
            snapshot.threadMessages as Record<string, any[]>,
            MAX_SYNC_THREAD_MESSAGES_PER_THREAD
          )
          : st.threadMessages,
        activeThreadId:
          typeof snapshot.activeThreadId === 'string' || snapshot.activeThreadId === null
            ? snapshot.activeThreadId
            : st.activeThreadId,
      };
    });
  };

  const hydrateWorkspaceState = async (token: string) => {
    try {
      const res = await dataProvider.getWorkspace(token, 'full');
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) return false;
      const state = (data as any).state;
      if (!state || !isObject(state)) return false;
      applyWorkspaceSnapshot(state);
      saveStateRef.current.lastSerialized = JSON.stringify(buildWorkspacePayload());
      return true;
    } catch {
      return false;
    }
  };

  const hydrateWorkspaceShellState = async (token: string) => {
    try {
      const res = await dataProvider.getWorkspace(token, 'servers');
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) return false;
      const state = (data as any).state;
      if (!state || !isObject(state)) return false;
      applyWorkspaceSnapshot(state);
      return true;
    } catch {
      return false;
    }
  };

  useEffect(() => {
    let cancelled = false;

    // In demo mode, boot is synchronous — no async needed, no network calls.
    if (isDemoMode) {
      useStore.getState().resetData();
      useStore.getState().upsertUsers(demoData.users);
      useStore.getState().setBackendToken(null);
      useStore.getState().loginUser(demoData.currentUser.id);
      return;
    }

    const boot = async () => {
      if (typeof window === 'undefined') return;
      const session = await authProvider.bootstrapSession();

      if (session.mode === 'backend' && session.user && session.token) {
        useStore.getState().setBackendToken(session.token);
        useStore.getState().upsertUsers([session.user]);
        useStore.getState().loginUser(session.user.id);
        try { localStorage.setItem('diavlocord-session', session.user.id); } catch { }
        return;
      }

      if (session.mode === 'local' && session.userId) {
        const ok = useStore.getState().loginUser(session.userId);
        if (ok) {
          return;
        }
      }

      if (isBackendEnabled) {
        try { localStorage.removeItem('diavlocord-session'); } catch { }
        useStore.getState().logout();
        return;
      }
      if (!cancelled) useStore.getState().logout();
    };

    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (isDemoMode || !isBackendEnabled || !backendToken || !currentUserId) return;
    const hydrationKey = `${backendToken}:${currentUserId}`;
    if (hydratedForRef.current === hydrationKey) return;

    let cancelled = false;
    let retryTimer: number | null = null;

    const attemptHydration = async () => {
      if (cancelled) return;
      const shellOk = await hydrateWorkspaceShellState(backendToken);
      const [bootstrapOk, workspaceOk] = await Promise.all([
        hydrateBackendData(backendToken, { includeUsers: true, includeMessages: true }),
        hydrateWorkspaceState(backendToken),
      ]);
      if (cancelled) return;

      if (bootstrapOk && workspaceOk) {
        hydratedForRef.current = hydrationKey;
        return;
      }

      retryTimer = window.setTimeout(() => {
        void attemptHydration();
      }, 2500);
    };
    void attemptHydration();

    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [backendToken, currentUserId]);

  useEffect(() => {
    if (isDemoMode || !isBackendEnabled || !backendToken) {
      setSocketStatus('offline');
      return;
    }
    const socket = getSocket(backendToken);
    if (!socket) {
      setSocketStatus('offline');
      return;
    }

    const onConnect = () => setSocketStatus('online');
    const onDisconnect = () => setSocketStatus('offline');
    const onReconnectAttempt = () => setSocketStatus('connecting');
    const onConnectError = () => setSocketStatus('error');

    setSocketStatus(socket.connected ? 'online' : 'connecting');
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('reconnect_attempt', onReconnectAttempt);
    socket.on('connect_error', onConnectError);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('reconnect_attempt', onReconnectAttempt);
      socket.off('connect_error', onConnectError);
    };
  }, [backendToken]);

  useEffect(() => {
    if (isDemoMode || !isBackendEnabled || !backendToken || !currentUserId) return;
    const hydrationKey = `${backendToken}:${currentUserId}`;
    if (hydratedForRef.current !== hydrationKey) return;

    let cancelled = false;
    const save = async (keepalive = false) => {
      if (cancelled || saveStateRef.current.inFlight) return;
      const payload = buildWorkspacePayload();
      const shouldWriteWorkspace =
        Array.isArray((payload as any).servers) &&
        ((payload as any).servers.length === 0 ||
          hasMembershipInServers((payload as any).servers, currentUserId));
      if (!shouldWriteWorkspace) return;

      const serialized = JSON.stringify(payload);
      if (serialized === saveStateRef.current.lastSerialized) return;

      saveStateRef.current.inFlight = true;
      try {
        const res = await dataProvider.saveWorkspace(backendToken, payload, keepalive);
        if (res.ok) saveStateRef.current.lastSerialized = serialized;
      } catch { } finally {
        saveStateRef.current.inFlight = false;
      }
    };

    const intervalId = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      void save();
    }, 4500);
    void save();

    const onBeforeUnload = () => {
      void save(true);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        void save(true);
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [backendToken, currentUserId]);

  useEffect(() => {
    if (isDemoMode || !isBackendEnabled || !backendToken || !currentUserId) return;

    let cancelled = false;
    let refreshInFlight = false;
    const bootstrapPollMs = socketStatus === 'online' ? 45_000 : 16_000;

    const refreshBootstrap = async () => {
      if (cancelled || refreshInFlight) return;
      refreshInFlight = true;
      try {
        await hydrateBackendData(backendToken, { includeUsers: false, includeMessages: false });
      } finally {
        refreshInFlight = false;
      }
    };

    const intervalId = window.setInterval(() => {
      void refreshBootstrap();
    }, bootstrapPollMs);

    const onFocus = () => {
      void refreshBootstrap();
    };
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      void refreshBootstrap();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [backendToken, currentUserId, socketStatus]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(max-width: 1023px)');
    const handleChange = () => {
      const mobile = media.matches;
      setIsMobileLayout(mobile);
      if (mobile) {
        setRightSidebarOpen(false);
      } else {
        setMobileNavOpen(false);
      }
    };
    handleChange();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', handleChange);
      return () => media.removeEventListener('change', handleChange);
    }
    media.addListener(handleChange);
    return () => media.removeListener(handleChange);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Electron shell exposes this bridge in desktop builds.
    setIsDesktopRuntime(Boolean((window as any).diavloDesktop));
  }, []);

  useEffect(() => {
    if (!isMobileLayout) return;
    setMobileNavOpen(false);
    setRightSidebarOpen(false);
  }, [activeChannelId, isMobileLayout, setRightSidebarOpen]);

  useEffect(() => {
    if (!activeChannelId) return;
    if (lastAnnouncedChannelRef.current === activeChannelId) return;
    lastAnnouncedChannelRef.current = activeChannelId;

    let label = activeChannelId;
    if (activeServerId) {
      const server = servers.find((entry) => entry.id === activeServerId);
      const channel = server?.categories.flatMap((category) => category.channels).find((entry) => entry.id === activeChannelId);
      if (channel?.name) label = `#${channel.name}`;
    } else {
      const dmPeerId =
        useStore.getState().dmGroups.find((group) => group.id === activeChannelId)?.memberIds.find((id) => id !== currentUserId) || '';
      const dmPeer = users.find((entry) => entry.id === dmPeerId);
      if (dmPeer?.username) label = `DM con ${dmPeer.username}`;
    }

    announce(`Canal cambiado: ${label}`, {
      priority: 'polite',
      dedupeKey: `channel-change-${activeChannelId}`,
      minIntervalMs: 350,
    });
  }, [activeChannelId, activeServerId, servers, users, currentUserId]);

  useEffect(() => {
    const previous = previousSocketStatusRef.current;
    if (socketStatus === previous) return;
    previousSocketStatusRef.current = socketStatus;

    if (socketStatus === 'online' && previous !== 'online') {
      announce('Conexion en tiempo real restablecida.', {
        priority: 'polite',
        dedupeKey: 'socket-online',
        minIntervalMs: 2000,
      });
      return;
    }

    if (socketStatus === 'error') {
      announce('Error en conexion en tiempo real.', {
        priority: 'assertive',
        dedupeKey: 'socket-error',
        minIntervalMs: 2200,
      });
    }
  }, [socketStatus]);

  const openSettings = (tab: 'profile' | 'server') => {
    setSettingsTab(tab);
    requestAnimationFrame(() => setSettingsOpen(true));
    setMobileNavOpen(false);
  };

  const openMobileMembers = () => {
    setMobileNavOpen(false);
    setRightSidebarView('members');
    setRightSidebarOpen(true);
  };

  const openMobileDetails = () => {
    setMobileNavOpen(false);
    setRightSidebarView('details');
    setRightSidebarOpen(true);
  };

  const shouldRenderDesktopRightSidebar = rightSidebarOpen && !(activeServerId === null && activeChannelId === null);

  return (
    <div className="h-[100dvh] w-screen overflow-hidden diavlocord-stage-shell">
      {isDemoMode ? (
        <div className="fixed top-1 left-1/2 -translate-x-1/2 z-[640] pointer-events-auto">
          <div className="px-2.5 py-1 rounded-lg border border-neon-blue/35 bg-black/65 backdrop-blur-xl shadow-[0_12px_30px_rgba(0,0,0,0.45)] flex items-center gap-3">
            <span className="text-[10px] font-black uppercase tracking-[0.14em] text-neon-blue">
              ⚡ Demo — Sin login · Datos simulados
            </span>
            {env.realAppUrl ? (
              <a
                href={env.realAppUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] font-black uppercase tracking-[0.12em] text-white/85 hover:text-white underline underline-offset-4"
              >
                App real →
              </a>
            ) : null}
          </div>
        </div>
      ) : null}

      {!isMobileLayout ? (
        <div
          className={cn(
            "flex h-[100dvh] w-full bg-[#1E1F22] overflow-hidden text-[#DBDEE1] font-sans transition-colors duration-300",
            !isDesktopRuntime && "diavlocord-stage-scaled"
          )}
        >
          {LoginVideo ? <Suspense fallback={null}><LoginVideo /></Suspense> : null}
          <ServerSidebar />
          <ChannelSidebar onOpenSettings={openSettings} />

          <main id="main-content" className="flex-1 flex flex-col h-full overflow-hidden">
            <ChatView />
          </main>

          <div
            className={cn(
              "transition-[width,opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] overflow-hidden",
              shouldRenderDesktopRightSidebar
                ? "w-[300px] opacity-100 translate-x-0"
                : "w-0 opacity-0 translate-x-3 pointer-events-none"
            )}
          >
            <RightSidebar />
          </div>
        </div>
      ) : (
        <div className="relative h-[100dvh] w-full bg-[#1E1F22] overflow-hidden text-[#DBDEE1] font-sans">
          {LoginVideo ? <Suspense fallback={null}><LoginVideo /></Suspense> : null}

          <main id="main-content" className="relative z-[20] h-full min-w-0 flex-1 flex flex-col overflow-hidden pb-[calc(5.15rem+env(safe-area-inset-bottom))]">
            <ChatView />
          </main>

          <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[345] px-3 pb-[max(0.45rem,env(safe-area-inset-bottom))]">
            <div className="pointer-events-auto rounded-2xl border border-white/12 bg-[linear-gradient(165deg,rgba(255,255,255,0.08),rgba(11,12,18,0.9))] backdrop-blur-2xl shadow-[0_16px_34px_rgba(0,0,0,0.44)] px-1.5 py-1.5">
              <div className="grid grid-cols-4 gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setRightSidebarOpen(false);
                    setMobileNavOpen((prev) => !prev);
                  }}
                  className={cn(
                    "h-12 rounded-xl border text-[10px] font-black uppercase tracking-[0.12em] transition-colors inline-flex items-center justify-center gap-1.5",
                    mobileNavOpen
                      ? "border-neon-blue/45 bg-neon-blue/16 text-neon-blue"
                      : "border-white/10 bg-white/[0.03] text-white/75 hover:text-white"
                  )}
                  aria-label="Navegacion"
                  title="Navegacion"
                >
                  <Menu size={14} />
                  NAV
                </button>
                <button
                  type="button"
                  onClick={openMobileMembers}
                  className={cn(
                    "h-12 rounded-xl border text-[10px] font-black uppercase tracking-[0.12em] transition-colors inline-flex items-center justify-center gap-1.5",
                    rightSidebarOpen && rightSidebarView === 'members'
                      ? "border-neon-blue/45 bg-neon-blue/16 text-neon-blue"
                      : "border-white/10 bg-white/[0.03] text-white/75 hover:text-white"
                  )}
                  aria-label="Miembros"
                  title="Miembros"
                >
                  <Users size={14} />
                  LISTA
                </button>
                <button
                  type="button"
                  onClick={openMobileDetails}
                  className={cn(
                    "h-12 rounded-xl border text-[10px] font-black uppercase tracking-[0.12em] transition-colors inline-flex items-center justify-center gap-1.5",
                    rightSidebarOpen && rightSidebarView === 'details'
                      ? "border-neon-blue/45 bg-neon-blue/16 text-neon-blue"
                      : "border-white/10 bg-white/[0.03] text-white/75 hover:text-white"
                  )}
                  aria-label="Info"
                  title="Info"
                >
                  <Info size={14} />
                  INFO
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMobileNavOpen(false);
                    setRightSidebarOpen(false);
                    openSettings('profile');
                  }}
                  className={cn(
                    "h-12 rounded-xl border text-[10px] font-black uppercase tracking-[0.12em] transition-colors inline-flex items-center justify-center gap-1.5",
                    settingsOpen
                      ? "border-neon-blue/45 bg-neon-blue/16 text-neon-blue"
                      : "border-white/10 bg-white/[0.03] text-white/75 hover:text-white"
                  )}
                  aria-label="Ajustes"
                  title="Ajustes"
                >
                  <Settings2 size={14} />
                  AJUSTE
                </button>
              </div>
            </div>
          </div>

          <div
            className={cn(
              'fixed inset-0 z-[400] transition-opacity duration-300 lg:hidden',
              mobileNavOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
            )}
          >
            <button
              type="button"
              className={cn(
                'absolute inset-0 bg-black/68 backdrop-blur-sm transition-opacity duration-300',
                mobileNavOpen ? 'opacity-100' : 'opacity-0'
              )}
              onClick={() => setMobileNavOpen(false)}
              aria-label="Cerrar navegacion"
            />

            <div
              className={cn(
                'absolute inset-y-0 left-0 w-[min(100vw,360px)] flex transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
                mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
              )}
            >
              <div className="relative flex h-full w-full overflow-hidden border-r border-white/10 shadow-[0_12px_36px_rgba(0,0,0,0.55)]">
                <button
                  type="button"
                  onClick={() => setMobileNavOpen(false)}
                  className="absolute top-[max(0.5rem,env(safe-area-inset-top))] right-2 z-[450] w-8 h-8 rounded-lg border border-white/15 bg-black/50 backdrop-blur-xl text-white/80 hover:text-white hover:bg-black/70 inline-flex items-center justify-center"
                  aria-label="Cerrar"
                >
                  <X size={14} />
                </button>
                <ServerSidebar />
                <ChannelSidebar onOpenSettings={openSettings} />
              </div>
            </div>
          </div>

          <div
            className={cn(
              'fixed inset-0 z-[410] transition-opacity duration-300 lg:hidden',
              rightSidebarOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
            )}
          >
            <button
              type="button"
              className={cn(
                'absolute inset-0 bg-black/62 backdrop-blur-sm transition-opacity duration-300',
                rightSidebarOpen ? 'opacity-100' : 'opacity-0'
              )}
              onClick={() => setRightSidebarOpen(false)}
              aria-label="Cerrar panel derecho"
            />
            <div
              className={cn(
                'absolute top-0 right-0 h-full transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
                rightSidebarOpen ? 'translate-x-0' : 'translate-x-full'
              )}
            >
              <RightSidebar />
            </div>
          </div>
        </div>
      )}

      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        initialTab={settingsTab}
      />

      {isBackendEnabled && backendToken ? (
        <div
          className={cn(
            "fixed right-4 z-[530] pointer-events-none",
            isMobileLayout
              ? "bottom-[calc(6.1rem+env(safe-area-inset-bottom))]"
              : "bottom-4"
          )}
        >
          <div className="px-3 py-1.5 rounded-xl border border-white/10 bg-black/45 backdrop-blur-xl shadow-[0_10px_28px_rgba(0,0,0,0.45)]">
            <div className="flex items-center gap-2">
              <span
                className={
                  socketStatus === 'online'
                    ? 'w-2 h-2 rounded-full bg-neon-green shadow-[0_0_8px_rgba(0,255,148,0.7)]'
                    : socketStatus === 'connecting'
                      ? 'w-2 h-2 rounded-full bg-neon-blue animate-pulse'
                      : socketStatus === 'error'
                        ? 'w-2 h-2 rounded-full bg-neon-pink animate-pulse'
                        : 'w-2 h-2 rounded-full bg-[#5f6770]'
                }
              />
              <span className="text-[10px] font-black uppercase tracking-[0.16em] text-white/80">
                {socketStatus === 'online'
                  ? 'Realtime online'
                  : socketStatus === 'connecting'
                    ? 'Realtime conectando'
                    : socketStatus === 'error'
                      ? 'Realtime error'
                      : 'Realtime offline'}
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
