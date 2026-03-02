import { useEffect, useRef } from 'react';
import { eventBus } from '../lib/event-bus';
import { useStore } from '../lib/store';
import { isBackendEnabled } from '../lib/env';
import { disconnectSocket, getSocket } from '../services/socket-client';
import { mapBackendUser } from '../lib/backend-user';
import { ensureOwnersHaveAdminRole } from '../lib/server-owner-admin';
import { dataProvider } from '../lib/providers/data-provider';

const WORKSPACE_SYNC_POLL_MS = 9000;
const WORKSPACE_SYNC_MIN_GAP_MS = 2200;

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

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

const getFirstServerChannelId = (server: any): string | null => {
  if (!server || !Array.isArray(server.categories)) return null;
  for (const category of server.categories) {
    if (!category || !Array.isArray(category.channels)) continue;
    const firstChannel = category.channels.find((channel: any) => Boolean(channel?.id));
    if (firstChannel?.id) return firstChannel.id;
  }
  return null;
};

const serverContainsChannel = (server: any, channelId: string | null | undefined): boolean => {
  if (!channelId || !server || !Array.isArray(server.categories)) return false;
  for (const category of server.categories) {
    if (!category || !Array.isArray(category.channels)) continue;
    if (category.channels.some((channel: any) => channel?.id === channelId)) return true;
  }
  return false;
};

const buildServerSyncSignature = (servers: any[]): string => {
  if (!Array.isArray(servers) || servers.length === 0) return 'empty';
  return servers
    .map((server) => {
      const categoryCount = Array.isArray(server?.categories) ? server.categories.length : 0;
      const channelCount = Array.isArray(server?.categories)
        ? server.categories.reduce(
            (sum: number, category: any) => sum + (Array.isArray(category?.channels) ? category.channels.length : 0),
            0
          )
        : 0;
      const memberCount = Array.isArray(server?.members) ? server.members.length : 0;
      const roleCount = Array.isArray(server?.roles) ? server.roles.length : 0;
      return `${server?.id || 'x'}:${categoryCount}:${channelCount}:${memberCount}:${roleCount}`;
    })
    .join('|');
};

const normalizeIncomingAttachments = (value: unknown) => {
  if (!Array.isArray(value)) return undefined;
  const normalized = value
    .filter((entry) => Boolean(entry && typeof entry === 'object'))
    .map((entry, index) => {
      const url = typeof (entry as any).url === 'string' ? String((entry as any).url).trim() : '';
      if (!url) return null;
      const fallbackName = `attachment-${index + 1}`;
      const rawFilename = typeof (entry as any).filename === 'string' ? String((entry as any).filename).trim() : '';
      const filename = rawFilename || fallbackName;
      const rawContentType = typeof (entry as any).contentType === 'string' ? String((entry as any).contentType).trim() : '';
      const id = normalizeEntityId((entry as any).id) || `${fallbackName}-${index}`;
      const sizeRaw = Number((entry as any).size);
      return {
        id,
        url,
        filename,
        contentType: rawContentType || inferAttachmentContentType(filename),
        size: Number.isFinite(sizeRaw) && sizeRaw > 0 ? sizeRaw : 0,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  return normalized.length > 0 ? normalized : undefined;
};

export const useSocket = () => {
  const { addMessage, updateMessage, deleteMessage, setTyping, setPresence, toggleReaction, insertChannel, voiceJoin, voiceLeave, setVoiceMemberState, setSpeaking, receiveDMRequest, upsertUsers, updateCurrentUser, backendToken } = useStore();
  const speakingTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const workspaceSyncInFlightRef = useRef(false);
  const lastWorkspaceSyncAtRef = useRef(0);
  const lastWorkspaceUpdatedAtRef = useRef('');

  useEffect(() => {
    const unsubscribe = eventBus.subscribe((payload) => {
      if (payload.senderId === eventBus.clientId) return;
      // Don't process events from self for store updates that already happened locally
      // but do process for multi-tab sync (senderId !== 'local')
      
      switch (payload.type) {
        case 'MESSAGE_CREATED':
          addMessage(payload.data.channelId, payload.data.message);
          break;
        case 'MESSAGE_UPDATED':
          updateMessage(payload.data.channelId, payload.data.messageId, payload.data.updates);
          break;
        case 'MESSAGE_DELETED':
          deleteMessage(payload.data.channelId, payload.data.messageId);
          break;
        case 'REACTION_TOGGLED':
          toggleReaction(payload.data.channelId, payload.data.messageId, payload.data.emoji, payload.data.userId);
          break;
        case 'TYPING_START':
          setTyping(payload.data.channelId, payload.data.userId, true);
          break;
        case 'TYPING_STOP':
          setTyping(payload.data.channelId, payload.data.userId, false);
          break;
        case 'PRESENCE_UPDATE':
          setPresence(payload.data.userId, payload.data.presence);
          break;
        case 'CHANNEL_CREATED':
          insertChannel(payload.data.serverId, payload.data.categoryId, payload.data.channel, false);
          break;
        case 'CHANNEL_UPDATED':
          useStore.setState((st: any) => ({
            servers: (st.servers || []).map((server: any) => {
              if (server.id !== payload.data.serverId) return server;
              return {
                ...server,
                categories: (server.categories || []).map((category: any) => ({
                  ...category,
                  channels: (category.channels || []).map((channel: any) =>
                    channel.id === payload.data.channelId
                      ? {
                          ...channel,
                          ...(payload.data.updates || {}),
                        }
                      : channel
                  ),
                })),
              };
            }),
          }));
          break;
        case 'VOICE_JOIN':
          voiceJoin(payload.data.channelId, payload.data.userId, false);
          break;
        case 'VOICE_LEAVE':
          voiceLeave(payload.data.channelId, payload.data.userId, false);
          break;
        case 'VOICE_UPDATE':
          setVoiceMemberState(payload.data.userId, payload.data.updates, false);
          break;
        case 'VOICE_SPEAKING':
          setSpeaking(payload.data.channelId, payload.data.userId, payload.data.speaking, false);
          break;
        case 'DM_REQUEST_SENT':
          // Only the receiver should store it.
          {
            const id = normalizeEntityId(payload.data?.id);
            const fromUserId = normalizeEntityId(payload.data?.fromUserId);
            const toUserId = normalizeEntityId(payload.data?.toUserId);
            if (!id || !fromUserId || !toUserId) break;
            if (toUserId === String(useStore.getState().currentUser.id)) {
              receiveDMRequest({
                id,
                fromUserId,
                toUserId,
                createdAt:
                  typeof payload.data?.createdAt === 'string'
                    ? payload.data.createdAt
                    : new Date().toISOString(),
              });
            }
          }
          break;
        case 'DM_REQUEST_ACCEPTED':
          // Receiver already created DM locally; sender should clear outgoing and open DM.
          {
            const fromUserId = normalizeEntityId(payload.data?.fromUserId);
            const toUserId = normalizeEntityId(payload.data?.toUserId);
            const dmId = normalizeEntityId(payload.data?.dmId);
            const requestId = normalizeEntityId(payload.data?.requestId);
            if (!fromUserId || !toUserId) break;
            if (fromUserId !== String(useStore.getState().currentUser.id)) break;
            useStore.setState((st: any) => ({
              dmGroups:
                dmId && !(st.dmGroups || []).some((g: any) => g.id === dmId)
                  ? [...(st.dmGroups || []), { id: dmId, memberIds: [fromUserId, toUserId] }]
                  : st.dmGroups,
              dmRequestsOutgoing: requestId
                ? (st.dmRequestsOutgoing || []).filter((r: any) => r.id !== requestId)
                : st.dmRequestsOutgoing,
              activeServerId: dmId ? null : st.activeServerId,
              activeChannelId: dmId || st.activeChannelId,
            }));
          }
          break;
        case 'DM_REQUEST_REJECTED':
          if (normalizeEntityId(payload.data?.fromUserId) === String(useStore.getState().currentUser.id)) {
            const requestId = normalizeEntityId(payload.data?.requestId);
            useStore.setState((st: any) => ({
              dmRequestsOutgoing: requestId
                ? (st.dmRequestsOutgoing || []).filter((r: any) => r.id !== requestId)
                : st.dmRequestsOutgoing,
            }));
          }
          break;
        case 'USER_UPDATED': {
          const mapped = mapBackendUser(payload.data?.user);
          if (!mapped.id) break;
          upsertUsers([mapped]);
          if (mapped.id === useStore.getState().currentUser.id) {
            updateCurrentUser({
              username: mapped.username,
              discriminator: mapped.discriminator,
              displayName: mapped.displayName,
              pronouns: mapped.pronouns,
              bio: mapped.bio,
              avatar: mapped.avatar,
              banner: mapped.banner,
              bannerColor: mapped.bannerColor,
              createdAt: mapped.createdAt,
              updatedAt: mapped.updatedAt,
            });
          }
          break;
        }
      }
    });

    return () => unsubscribe();
  }, [addMessage, updateMessage, deleteMessage, setTyping, setPresence, toggleReaction, insertChannel, voiceJoin, voiceLeave, setVoiceMemberState, setSpeaking, receiveDMRequest, upsertUsers, updateCurrentUser]);

  useEffect(() => {
    if (!isBackendEnabled) return;
    if (!backendToken) return;

    const socket = getSocket(backendToken);
    if (!socket) return;
    const debugEnabled = (() => {
      if (process.env.NODE_ENV !== 'production') return true;
      if (typeof window === 'undefined') return false;
      try {
        return window.localStorage.getItem('diavlocord-debug-socket') === '1';
      } catch {
        return false;
      }
    })();
    const debugLog = (...args: unknown[]) => {
      if (!debugEnabled) return;
      console.log(...args);
    };
    const debugError = (...args: unknown[]) => {
      if (!debugEnabled) return;
      console.error(...args);
    };

    debugLog('[useSocket] connecting to socket', { token: backendToken?.slice(0, 20) + '...' });

    const onConnectLog = () => {
      debugLog('[useSocket] socket connected');
    };

    const onConnectErrorLog = (err: unknown) => {
      debugError('[useSocket] socket connect_error', err);
    };

    socket.on('connect', onConnectLog);
    socket.on('connect_error', onConnectErrorLog);

    const syncWorkspaceServers = async (force = false) => {
      if (!backendToken) return;
      if (!force && typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (workspaceSyncInFlightRef.current) return;
      if (!force && now - lastWorkspaceSyncAtRef.current < WORKSPACE_SYNC_MIN_GAP_MS) return;

      workspaceSyncInFlightRef.current = true;
      try {
        const res = await dataProvider.getWorkspace(backendToken, 'servers');
        if (!res.ok) return;
        const data = await res.json().catch(() => ({} as any));
        const state = (data as any)?.state;
        const updatedAt = typeof (data as any)?.updatedAt === 'string' ? (data as any).updatedAt : '';

        if (!isObjectRecord(state)) return;
        if (!Array.isArray((state as any).servers)) return;
        if (!force && updatedAt && updatedAt === lastWorkspaceUpdatedAtRef.current) return;

        const incomingServers = ensureOwnersHaveAdminRole((state as any).servers as any);
        useStore.setState((st: any) => {
          const currentUserId = st.currentUser?.id;
          const userServers = (incomingServers || []).filter((server: any) =>
            Array.isArray(server?.members) && server.members.some((member: any) => member?.userId === currentUserId)
          );

          let nextActiveServerId: string | null = st.activeServerId;
          let nextActiveChannelId: string | null = st.activeChannelId;

          if (typeof nextActiveServerId === 'string') {
            const activeServer = userServers.find((server: any) => server?.id === nextActiveServerId) || null;
            if (!activeServer) {
              const fallbackServer = userServers[0] || null;
              nextActiveServerId = fallbackServer?.id || null;
              nextActiveChannelId = fallbackServer ? getFirstServerChannelId(fallbackServer) : null;
            } else if (!serverContainsChannel(activeServer, nextActiveChannelId)) {
              nextActiveChannelId = getFirstServerChannelId(activeServer);
            }
          } else if (nextActiveServerId === null && typeof nextActiveChannelId === 'string') {
            const isDmChannel = Array.isArray(st.dmGroups) && st.dmGroups.some((group: any) => group?.id === nextActiveChannelId);
            if (!isDmChannel) nextActiveChannelId = null;
          }

          const nextServerSignature = buildServerSyncSignature(incomingServers);
          const currentServerSignature = buildServerSyncSignature(st.servers || []);
          const activeSelectionChanged =
            nextActiveServerId !== st.activeServerId || nextActiveChannelId !== st.activeChannelId;

          if (nextServerSignature === currentServerSignature && !activeSelectionChanged) {
            return st;
          }

          return {
            servers: incomingServers,
            activeServerId: nextActiveServerId,
            activeChannelId: nextActiveChannelId,
          };
        });

        if (updatedAt) lastWorkspaceUpdatedAtRef.current = updatedAt;
      } catch {
        // Ignore transient sync errors; next poll/event will retry.
      } finally {
        workspaceSyncInFlightRef.current = false;
        lastWorkspaceSyncAtRef.current = Date.now();
      }
    };

    const onWorkspaceUpdated = (payload: { updatedAt?: string; scope?: 'servers' | 'full' }) => {
      if (payload?.updatedAt && payload.updatedAt === lastWorkspaceUpdatedAtRef.current) return;
      void syncWorkspaceServers(payload?.scope === 'servers');
    };

    const onDmRequest = (payload: { fromUserId: string; toUserId: string; requestId: string; createdAt: string }) => {
      // Mirror backend event into local app event flow
      debugLog('[useSocket] dm:request received', payload);
      const id = normalizeEntityId(payload?.requestId);
      const fromUserId = normalizeEntityId(payload?.fromUserId);
      const toUserId = normalizeEntityId(payload?.toUserId);
      if (!id || !fromUserId || !toUserId) return;
      eventBus.emit(
        'DM_REQUEST_SENT',
        {
          id,
          fromUserId,
          toUserId,
          createdAt: typeof payload?.createdAt === 'string' ? payload.createdAt : new Date().toISOString(),
        },
        'socket'
      );
    };

    const onDmAccept = (payload: { fromUserId: string; toUserId: string; requestId: string; conversationId?: string; dmId?: string }) => {
      debugLog('[useSocket] dm:request:accept received', payload);
      const requestId = normalizeEntityId(payload?.requestId);
      const fromUserId = normalizeEntityId(payload?.fromUserId);
      const toUserId = normalizeEntityId(payload?.toUserId);
      const dmId = normalizeEntityId(payload?.conversationId || payload?.dmId);
      if (!requestId || !fromUserId || !toUserId) return;
      eventBus.emit(
        'DM_REQUEST_ACCEPTED',
        {
          requestId,
          fromUserId,
          toUserId,
          dmId: dmId || undefined,
        },
        'socket'
      );
    };

    const onDmReject = (payload: { fromUserId: string; toUserId: string; requestId: string }) => {
      debugLog('[useSocket] dm:request:reject received', payload);
      const requestId = normalizeEntityId(payload?.requestId);
      const fromUserId = normalizeEntityId(payload?.fromUserId);
      const toUserId = normalizeEntityId(payload?.toUserId);
      if (!requestId || !fromUserId || !toUserId) return;
      eventBus.emit('DM_REQUEST_REJECTED', { requestId, fromUserId, toUserId }, 'socket');
    };

    const onDmMessage = (payload: { conversationId: string; message: { id: string; authorId: string; content?: string; createdAt: string; attachments?: unknown } }) => {
      if (!payload?.message) return;
      debugLog('[useSocket] dm:message received', payload);
      const conversationId = normalizeEntityId(payload?.conversationId);
      const messageId = normalizeEntityId(payload?.message?.id);
      const authorId = normalizeEntityId(payload?.message?.authorId);
      if (!conversationId || !messageId || !authorId) return;
      eventBus.emit(
        'MESSAGE_CREATED',
        {
          channelId: conversationId,
          message: {
            id: messageId,
            channelId: conversationId,
            authorId,
            content: typeof payload.message.content === 'string' ? payload.message.content : '',
            timestamp:
              typeof payload.message.createdAt === 'string' && payload.message.createdAt.trim().length > 0
                ? payload.message.createdAt
                : new Date().toISOString(),
            attachments: normalizeIncomingAttachments(payload?.message?.attachments),
          },
        },
        'socket'
      );
    };

    const onChannelMessage = (payload: { channelId: string; message: { id: string; authorId: string; content?: string; timestamp?: string; createdAt?: string; attachments?: unknown; replyToId?: string; editedAt?: string; isPinned?: boolean; reactions?: any[]; threadId?: string } }) => {
      if (!payload?.channelId || !payload?.message) return;
      debugLog('[useSocket] channel:message received', payload);
      const channelId = normalizeEntityId(payload.channelId);
      const messageId = normalizeEntityId(payload.message.id);
      const authorId = normalizeEntityId(payload.message.authorId);
      if (!channelId || !messageId || !authorId) return;
      eventBus.emit(
        'MESSAGE_CREATED',
        {
          channelId,
          message: {
            id: messageId,
            channelId,
            authorId,
            content: typeof payload.message.content === 'string' ? payload.message.content : '',
            timestamp: payload.message.timestamp || payload.message.createdAt || new Date().toISOString(),
            attachments: normalizeIncomingAttachments(payload.message.attachments),
            replyToId: normalizeEntityId(payload.message.replyToId) || undefined,
            editedAt: payload.message.editedAt,
            isPinned: payload.message.isPinned,
            reactions: Array.isArray(payload.message.reactions) ? payload.message.reactions : undefined,
            threadId: normalizeEntityId(payload.message.threadId) || undefined,
          },
        },
        'socket'
      );
    };

    const onChannelCreate = (payload: { serverId: string; categoryId: string; channel: any }) => {
      if (!payload?.serverId || !payload?.categoryId || !payload?.channel) return;
      debugLog('[useSocket] channel:create received', payload);
      eventBus.emit('CHANNEL_CREATED', payload, 'socket');
    };

    const onChannelUpdate = (payload: { serverId: string; channelId: string; updates: any }) => {
      if (!payload?.serverId || !payload?.channelId || !payload?.updates) return;
      debugLog('[useSocket] channel:update received', payload);
      eventBus.emit('CHANNEL_UPDATED', payload, 'socket');
    };

    const onChannelMessageUpdate = (payload: { channelId: string; messageId: string; updates: any }) => {
      const channelId = normalizeEntityId(payload?.channelId);
      const messageId = normalizeEntityId(payload?.messageId);
      if (!channelId || !messageId || !payload?.updates) return;
      debugLog('[useSocket] channel:message:update received', payload);
      eventBus.emit(
        'MESSAGE_UPDATED',
        {
          channelId,
          messageId,
          updates: payload.updates,
        },
        'socket'
      );
    };

    const onChannelMessageDelete = (payload: { channelId: string; messageId: string }) => {
      const channelId = normalizeEntityId(payload?.channelId);
      const messageId = normalizeEntityId(payload?.messageId);
      if (!channelId || !messageId) return;
      debugLog('[useSocket] channel:message:delete received', payload);
      eventBus.emit(
        'MESSAGE_DELETED',
        {
          channelId,
          messageId,
        },
        'socket'
      );
    };

    const onChannelMessageReactions = (payload: { channelId: string; messageId: string; reactions: any[] }) => {
      const channelId = normalizeEntityId(payload?.channelId);
      const messageId = normalizeEntityId(payload?.messageId);
      if (!channelId || !messageId || !Array.isArray(payload.reactions)) return;
      debugLog('[useSocket] channel:message:reactions received', payload);
      eventBus.emit(
        'MESSAGE_UPDATED',
        {
          channelId,
          messageId,
          updates: { reactions: payload.reactions },
        },
        'socket'
      );
    };

    const onChannelMessagePin = (payload: { channelId: string; messageId: string; isPinned: boolean }) => {
      const channelId = normalizeEntityId(payload?.channelId);
      const messageId = normalizeEntityId(payload?.messageId);
      if (!channelId || !messageId || typeof payload.isPinned !== 'boolean') return;
      debugLog('[useSocket] channel:message:pin received', payload);
      eventBus.emit(
        'MESSAGE_UPDATED',
        {
          channelId,
          messageId,
          updates: { isPinned: payload.isPinned },
        },
        'socket'
      );
    };

    const onUserUpdated = (payload: { user?: any }) => {
      if (!payload?.user?.id) return;
      debugLog('[useSocket] user:updated received', payload);
      eventBus.emit('USER_UPDATED', { user: payload.user }, 'socket');
    };

    const onPresenceUpdate = (payload: { userId?: string; presence?: any }) => {
      const userId = normalizeEntityId(payload?.userId);
      if (!userId || !payload?.presence) return;
      debugLog('[useSocket] presence:update received', payload);
      eventBus.emit(
        'PRESENCE_UPDATE',
        {
          userId,
          presence: payload.presence,
        },
        'socket'
      );
    };

    const onVoiceJoin = (payload: { channelId?: string; userId?: string }) => {
      const channelId = normalizeEntityId(payload?.channelId);
      const userId = normalizeEntityId(payload?.userId);
      if (!channelId || !userId) return;
      debugLog('[useSocket] voice:join received', payload);
      eventBus.emit(
        'VOICE_JOIN',
        {
          channelId,
          userId,
        },
        'socket'
      );
    };

    const onVoiceLeave = (payload: { channelId?: string; userId?: string }) => {
      const channelId = normalizeEntityId(payload?.channelId);
      const userId = normalizeEntityId(payload?.userId);
      if (!channelId || !userId) return;
      debugLog('[useSocket] voice:leave received', payload);
      eventBus.emit(
        'VOICE_LEAVE',
        {
          channelId,
          userId,
        },
        'socket'
      );
    };

    const onVoiceUpdate = (payload: { userId?: string; updates?: any }) => {
      const userId = normalizeEntityId(payload?.userId);
      if (!userId || !payload?.updates) return;
      debugLog('[useSocket] voice:update received', payload);
      eventBus.emit(
        'VOICE_UPDATE',
        {
          userId,
          updates: payload.updates,
        },
        'socket'
      );
    };

    const onVoiceSpeaking = (payload: { channelId?: string; userId?: string; speaking?: boolean }) => {
      const channelId = normalizeEntityId(payload?.channelId);
      const userId = normalizeEntityId(payload?.userId);
      if (!channelId || !userId || typeof payload.speaking !== 'boolean') return;
      if (userId === String(useStore.getState().currentUser.id)) {
        // Ignore own echo from backend to prevent speaking-state oscillation/flicker.
        return;
      }
      debugLog('[useSocket] voice:speaking received', payload);
      const key = `${channelId}:${userId}`;
      const prevTimer = speakingTimeoutsRef.current.get(key);
      if (prevTimer) {
        clearTimeout(prevTimer);
        speakingTimeoutsRef.current.delete(key);
      }
      eventBus.emit(
        'VOICE_SPEAKING',
        {
          channelId,
          userId,
          speaking: payload.speaking,
        },
        'socket'
      );
      if (payload.speaking) {
        const timeoutId = setTimeout(() => {
          eventBus.emit(
            'VOICE_SPEAKING',
            {
              channelId,
              userId,
              speaking: false,
            },
            'socket'
          );
          speakingTimeoutsRef.current.delete(key);
        }, 2200);
        speakingTimeoutsRef.current.set(key, timeoutId);
      }
    };

    const onVoiceSnapshot = (payload: { channels?: Array<{ channelId?: string; userIds?: string[] }> }) => {
      const channels = Array.isArray(payload?.channels) ? payload.channels : [];
      useStore.setState((st: any) => {
        const nextVoice: Record<string, any> = { ...st.voice };
        const snapshotByChannel = new Map<string, string[]>();

        for (const entry of channels) {
          const channelId = normalizeEntityId(entry?.channelId);
          if (!channelId) continue;
          const normalizedIds = Array.from(
            new Set(
              (Array.isArray(entry.userIds) ? entry.userIds : [])
                .map((id) => normalizeEntityId(id))
                .filter((id): id is string => Boolean(id))
            )
          );
          snapshotByChannel.set(channelId, normalizedIds);
        }

        for (const [channelId, rawVoiceState] of Object.entries(st.voice || {})) {
          const voiceState =
            rawVoiceState && typeof rawVoiceState === 'object'
              ? (rawVoiceState as { speakingUserIds?: string[] })
              : {};
          const snapshotIds = snapshotByChannel.get(channelId);
          if (!snapshotIds) {
            nextVoice[channelId] = {
              ...voiceState,
              channelId,
              connectedUserIds: [],
              speakingUserIds: [],
            };
            continue;
          }
          const connectedSet = new Set(snapshotIds);
          nextVoice[channelId] = {
            ...voiceState,
            channelId,
            connectedUserIds: snapshotIds,
            speakingUserIds: (voiceState?.speakingUserIds || []).filter((id: string) => connectedSet.has(id)),
          };
        }

        for (const [channelId, userIds] of Array.from(snapshotByChannel.entries())) {
          if (nextVoice[channelId]) continue;
          nextVoice[channelId] = {
            channelId,
            connectedUserIds: userIds,
            speakingUserIds: [],
          };
        }

        return { voice: nextVoice };
      });
    };

    const onVoiceSync = (payload: { channelId?: string; userIds?: string[] }) => {
      const channelId = normalizeEntityId(payload?.channelId);
      if (!channelId) return;
      const normalizedIds = Array.from(
        new Set(
          (Array.isArray(payload.userIds) ? payload.userIds : [])
            .map((id) => normalizeEntityId(id))
            .filter((id): id is string => Boolean(id))
        )
      );
      useStore.setState((st: any) => {
        const prev = st.voice?.[channelId] || { channelId, connectedUserIds: [], speakingUserIds: [] };
        const connectedSet = new Set(normalizedIds);
        const nextVoiceForChannel = {
          ...prev,
          channelId,
          connectedUserIds: normalizedIds,
          speakingUserIds: (prev.speakingUserIds || []).filter((id: string) => connectedSet.has(id)),
        };
        return {
          voice: {
            ...st.voice,
            [channelId]: nextVoiceForChannel,
          },
        };
      });
    };

    socket.on('dm:request', onDmRequest);
    socket.on('dm:request:accept', onDmAccept);
    socket.on('dm:request:reject', onDmReject);
    socket.on('dm:message', onDmMessage);
    socket.on('channel:message', onChannelMessage);
    socket.on('channel:create', onChannelCreate);
    socket.on('channel:update', onChannelUpdate);
    socket.on('channel:message:update', onChannelMessageUpdate);
    socket.on('channel:message:delete', onChannelMessageDelete);
    socket.on('channel:message:reactions', onChannelMessageReactions);
    socket.on('channel:message:pin', onChannelMessagePin);
    socket.on('user:updated', onUserUpdated);
    socket.on('presence:update', onPresenceUpdate);
    socket.on('voice:join', onVoiceJoin);
    socket.on('voice:leave', onVoiceLeave);
    socket.on('voice:update', onVoiceUpdate);
    socket.on('voice:speaking', onVoiceSpeaking);
    socket.on('voice:snapshot', onVoiceSnapshot);
    socket.on('voice:sync', onVoiceSync);
    socket.on('workspace:updated', onWorkspaceUpdated);

    const requestVoiceSnapshot = () => {
      try {
        socket.emit('voice:snapshot:request');
      } catch {}
    };
    const syncWorkspaceOnConnect = () => {
      void syncWorkspaceServers(true);
    };
    socket.on('connect', requestVoiceSnapshot);
    socket.on('connect', syncWorkspaceOnConnect);
    socket.connect();
    requestVoiceSnapshot();
    void syncWorkspaceServers(true);
    const snapshotIntervalId =
      typeof window !== 'undefined'
        ? window.setInterval(requestVoiceSnapshot, 10_000)
        : null;
    const workspaceSyncIntervalId =
      typeof window !== 'undefined'
        ? window.setInterval(() => {
            void syncWorkspaceServers(false);
          }, WORKSPACE_SYNC_POLL_MS)
        : null;
    const onOnline = () => {
      void syncWorkspaceServers(true);
    };
    const onWindowFocus = () => {
      void syncWorkspaceServers(true);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      void syncWorkspaceServers(true);
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', onWindowFocus);
      document.addEventListener('visibilitychange', onVisibilityChange);
      window.addEventListener('online', onOnline);
    }

    return () => {
      socket.off('dm:request', onDmRequest);
      socket.off('dm:request:accept', onDmAccept);
      socket.off('dm:request:reject', onDmReject);
      socket.off('dm:message', onDmMessage);
      socket.off('channel:message', onChannelMessage);
      socket.off('channel:create', onChannelCreate);
      socket.off('channel:update', onChannelUpdate);
      socket.off('channel:message:update', onChannelMessageUpdate);
      socket.off('channel:message:delete', onChannelMessageDelete);
      socket.off('channel:message:reactions', onChannelMessageReactions);
      socket.off('channel:message:pin', onChannelMessagePin);
      socket.off('user:updated', onUserUpdated);
      socket.off('presence:update', onPresenceUpdate);
      socket.off('voice:join', onVoiceJoin);
      socket.off('voice:leave', onVoiceLeave);
      socket.off('voice:update', onVoiceUpdate);
      socket.off('voice:speaking', onVoiceSpeaking);
      socket.off('voice:snapshot', onVoiceSnapshot);
      socket.off('voice:sync', onVoiceSync);
      socket.off('workspace:updated', onWorkspaceUpdated);
      socket.off('connect', requestVoiceSnapshot);
      socket.off('connect', syncWorkspaceOnConnect);
      socket.off('connect', onConnectLog);
      socket.off('connect_error', onConnectErrorLog);
      if (snapshotIntervalId !== null) {
        window.clearInterval(snapshotIntervalId);
      }
      if (workspaceSyncIntervalId !== null) {
        window.clearInterval(workspaceSyncIntervalId);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', onWindowFocus);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        window.removeEventListener('online', onOnline);
      }
      for (const timeoutId of Array.from(speakingTimeoutsRef.current.values())) {
        clearTimeout(timeoutId);
      }
      speakingTimeoutsRef.current.clear();
      disconnectSocket();
    };
  }, [backendToken]);
};
