import type { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import { prisma } from './prisma.js';
import { createCorsOriginValidator, getAllowedCorsOrigins } from './cors.js';

export type SocketUser = { userId: string };
let ioRef: SocketIOServer | null = null;
let snapshotQueue: Promise<void> = Promise.resolve();
const voiceChannelPresence = new Map<string, Map<string, number>>();
const presenceSocketCounts = new Map<string, number>();
const pendingOfflinePresenceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const PRESENCE_OFFLINE_GRACE_MS = Math.max(800, Number(process.env.PRESENCE_OFFLINE_GRACE_MS || 4000));

const getPresenceSocketCount = (userId: string): number => presenceSocketCounts.get(userId) ?? 0;

const incrementPresenceSocketCount = (userId: string): number => {
  const nextCount = getPresenceSocketCount(userId) + 1;
  presenceSocketCounts.set(userId, nextCount);
  return nextCount;
};

const decrementPresenceSocketCount = (userId: string): number => {
  const nextCount = Math.max(0, getPresenceSocketCount(userId) - 1);
  if (nextCount === 0) presenceSocketCounts.delete(userId);
  else presenceSocketCounts.set(userId, nextCount);
  return nextCount;
};

const clearPendingOfflinePresence = (userId: string) => {
  const timer = pendingOfflinePresenceTimers.get(userId);
  if (!timer) return;
  clearTimeout(timer);
  pendingOfflinePresenceTimers.delete(userId);
};
const VALID_PERMISSIONS = new Set([
  'ADMINISTRATOR',
  'MANAGE_SERVER',
  'MANAGE_CHANNELS',
  'MANAGE_ROLES',
  'VIEW_AUDIT_LOG',
  'MANAGE_MESSAGES',
  'SEND_MESSAGES',
  'READ_MESSAGES',
  'ATTACH_FILES',
  'CREATE_INSTANT_INVITE',
  'VIEW_CHANNEL',
]);

const normalizePermissionList = (value: unknown): string[] => {
  const list = Array.isArray(value) ? value : [];
  const out = new Set<string>();
  for (const entry of list) {
    if (typeof entry !== 'string') continue;
    if (!VALID_PERMISSIONS.has(entry)) continue;
    out.add(entry);
  }
  return Array.from(out);
};

const normalizePermissionOverwrites = (value: unknown): Array<{
  id: string;
  type: 'role' | 'member';
  allow: string[];
  deny: string[];
}> => {
  const list = Array.isArray(value) ? value : [];
  const out: Array<{ id: string; type: 'role' | 'member'; allow: string[]; deny: string[] }> = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const id = typeof (entry as any).id === 'string' ? (entry as any).id.trim() : '';
    const type = (entry as any).type;
    if (!id) continue;
    if (type !== 'role' && type !== 'member') continue;
    out.push({
      id,
      type,
      allow: normalizePermissionList((entry as any).allow),
      deny: normalizePermissionList((entry as any).deny),
    });
  }
  return out;
};

const addVoicePresence = (channelId: string, userId: string): boolean => {
  const userCounts = voiceChannelPresence.get(channelId) ?? new Map<string, number>();
  const prevCount = userCounts.get(userId) ?? 0;
  userCounts.set(userId, prevCount + 1);
  voiceChannelPresence.set(channelId, userCounts);
  return prevCount === 0;
};

const removeVoicePresence = (channelId: string, userId: string): boolean => {
  const userCounts = voiceChannelPresence.get(channelId);
  if (!userCounts) return false;

  const prevCount = userCounts.get(userId) ?? 0;
  if (prevCount <= 0) return false;

  if (prevCount === 1) userCounts.delete(userId);
  else userCounts.set(userId, prevCount - 1);

  if (userCounts.size === 0) voiceChannelPresence.delete(channelId);
  return !userCounts.has(userId);
};

const isUserPresentInVoiceChannel = (channelId: string, userId: string): boolean => {
  const userCounts = voiceChannelPresence.get(channelId);
  if (!userCounts) return false;
  return (userCounts.get(userId) ?? 0) > 0;
};

const getVoiceSnapshotChannels = (): Array<{ channelId: string; userIds: string[] }> =>
  Array.from(voiceChannelPresence.entries()).map(([channelId, userCounts]) => ({
    channelId,
    userIds: Array.from(userCounts.keys()),
  }));

const getVoiceUserIdsForChannel = (channelId: string): string[] => {
  const userCounts = voiceChannelPresence.get(channelId);
  if (!userCounts) return [];
  return Array.from(userCounts.keys());
};

const DEFAULT_MEMBER_PERMISSIONS = [
  'VIEW_CHANNEL',
  'READ_MESSAGES',
  'SEND_MESSAGES',
  'ATTACH_FILES',
  'CREATE_INSTANT_INVITE',
];

const MAX_CHANNEL_ATTACHMENTS = 8;
const MAX_CHANNEL_ATTACHMENT_URL_LENGTH = 8192;
const MAX_CHANNEL_FILENAME_LENGTH = 512;
const MAX_CHANNEL_CONTENT_TYPE_LENGTH = 256;
const MAX_CHANNEL_CONTENT_LENGTH = 4000;

const normalizeChannelAttachments = (value: unknown) => {
  if (!Array.isArray(value)) return undefined;
  const output: Array<{
    id: string;
    url: string;
    filename: string;
    contentType: string;
    size: number;
  }> = [];

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const id = typeof (entry as any).id === 'string' ? (entry as any).id.trim().slice(0, 128) : '';
    const rawUrl = typeof (entry as any).url === 'string' ? (entry as any).url.trim() : '';
    const filename = typeof (entry as any).filename === 'string' ? (entry as any).filename.trim() : '';
    const contentType = typeof (entry as any).contentType === 'string' ? (entry as any).contentType.trim() : '';
    const rawSize = Number((entry as any).size);

    if (!id || !rawUrl || rawUrl.startsWith('data:')) continue;
    if (rawUrl.length > MAX_CHANNEL_ATTACHMENT_URL_LENGTH) continue;
    if (!filename || !contentType) continue;

    output.push({
      id,
      url: rawUrl,
      filename: filename.slice(0, MAX_CHANNEL_FILENAME_LENGTH),
      contentType: contentType.slice(0, MAX_CHANNEL_CONTENT_TYPE_LENGTH),
      size: Number.isFinite(rawSize) ? Math.max(0, Math.floor(rawSize)) : 0,
    });
    if (output.length >= MAX_CHANNEL_ATTACHMENTS) break;
  }

  return output.length > 0 ? output : undefined;
};

const normalizeChannelMessage = (value: unknown, channelId: string, fallbackAuthorId: string) => {
  if (!value || typeof value !== 'object') return null;
  const id = typeof (value as any).id === 'string' ? (value as any).id.trim().slice(0, 128) : '';
  if (!id) return null;

  const authorId =
    typeof (value as any).authorId === 'string' && (value as any).authorId.trim().length > 0
      ? (value as any).authorId.trim().slice(0, 128)
      : fallbackAuthorId;
  const content = typeof (value as any).content === 'string' ? (value as any).content.slice(0, MAX_CHANNEL_CONTENT_LENGTH) : '';
  const timestamp =
    typeof (value as any).timestamp === 'string' && (value as any).timestamp.trim().length > 0
      ? (value as any).timestamp
      : new Date().toISOString();
  const attachments = normalizeChannelAttachments((value as any).attachments);

  if (!content.trim() && (!attachments || attachments.length === 0)) return null;

  return {
    id,
    channelId,
    authorId,
    content,
    timestamp,
    attachments,
    replyToId: typeof (value as any).replyToId === 'string' ? (value as any).replyToId.slice(0, 128) : undefined,
    editedAt: typeof (value as any).editedAt === 'string' ? (value as any).editedAt : undefined,
    isPinned: Boolean((value as any).isPinned),
    threadId: typeof (value as any).threadId === 'string' ? (value as any).threadId.slice(0, 128) : undefined,
  };
};

const findServerAndChannelById = (
  servers: any[],
  channelId: string
): { server: any; channel: any } | null => {
  for (const server of servers) {
    if (!server || !Array.isArray(server.categories)) continue;
    for (const category of server.categories) {
      if (!category || !Array.isArray(category.channels)) continue;
      const channel = category.channels.find((entry: any) => entry?.id === channelId);
      if (channel) return { server, channel };
    }
  }
  return null;
};

const getChannelMemberPermissions = (server: any, channel: any, userId: string): Set<string> => {
  if (!server || !channel || !userId) return new Set();
  if (server.ownerId === userId) return new Set<string>(['ADMINISTRATOR']);

  const members = Array.isArray(server.members) ? server.members : [];
  const roles = Array.isArray(server.roles) ? server.roles : [];
  const member = members.find((entry: any) => entry?.userId === userId);
  if (!member) return new Set();

  const roleIds = new Set(Array.isArray(member.roleIds) ? member.roleIds : []);
  const permissions = new Set<string>(DEFAULT_MEMBER_PERMISSIONS);
  for (const role of roles) {
    if (!role || !roleIds.has(role.id)) continue;
    const rolePermissions = Array.isArray(role.permissions) ? role.permissions : [];
    for (const permission of rolePermissions) {
      if (typeof permission === 'string' && permission.length > 0) permissions.add(permission);
    }
  }

  if (permissions.has('ADMINISTRATOR')) return permissions;

  const overwrites = Array.isArray(channel.permissionOverwrites) ? channel.permissionOverwrites : [];
  for (const overwrite of overwrites) {
    if (!overwrite || overwrite.type !== 'role' || !roleIds.has(overwrite.id)) continue;
    const deny = Array.isArray(overwrite.deny) ? overwrite.deny : [];
    const allow = Array.isArray(overwrite.allow) ? overwrite.allow : [];
    for (const permission of deny) permissions.delete(permission);
    for (const permission of allow) permissions.add(permission);
  }

  const userOverwrite = overwrites.find((overwrite: any) => overwrite?.type === 'member' && overwrite?.id === userId);
  if (userOverwrite) {
    const deny = Array.isArray(userOverwrite.deny) ? userOverwrite.deny : [];
    const allow = Array.isArray(userOverwrite.allow) ? userOverwrite.allow : [];
    for (const permission of deny) permissions.delete(permission);
    for (const permission of allow) permissions.add(permission);
  }

  return permissions;
};

const hasChannelPermission = (
  server: any,
  channel: any,
  userId: string,
  permission: string
): boolean => {
  const permissions = getChannelMemberPermissions(server, channel, userId);
  return permissions.has('ADMINISTRATOR') || permissions.has(permission);
};

const hasChannelViewPermission = (server: any, channel: any, userId: string): boolean => {
  return hasChannelPermission(server, channel, userId, 'VIEW_CHANNEL');
};

const getVoiceChannelRules = async (
  channelId: string,
  userId: string
): Promise<{ userLimit: number | null; canJoin: boolean }> => {
  try {
    const row = await prisma.appStateSnapshot.findUnique({
      where: { id: 'global' },
      select: { data: true },
    });
    const root = row?.data as any;
    const servers = Array.isArray(root?.servers) ? root.servers : [];
    for (const server of servers) {
      const categories = Array.isArray(server?.categories) ? server.categories : [];
      for (const category of categories) {
        const channels = Array.isArray(category?.channels) ? category.channels : [];
        for (const channel of channels) {
          if (channel?.id !== channelId) continue;
          if (channel?.type !== 'voice') {
            return { userLimit: null, canJoin: false };
          }
          const raw = channel?.userLimit;
          const canJoin = hasChannelViewPermission(server, channel, userId);
          if (typeof raw === 'number' && raw > 0) {
            return {
              userLimit: Math.max(1, Math.min(99, Math.floor(raw))),
              canJoin,
            };
          }
          return { userLimit: null, canJoin };
        }
      }
    }
  } catch (err) {
    console.warn('[socket] failed to resolve voice channel rules', { channelId, userId, err });
  }
  return { userLimit: null, canJoin: false };
};

export function emitToUser(userId: string, event: string, payload: any) {
  ioRef?.to(`user:${userId}`).emit(event, payload);
}

export function emitToAll(event: string, payload: any) {
  ioRef?.emit(event, payload);
}

const enqueueSnapshotMutation = (mutator: (state: Record<string, any>) => Record<string, any>) => {
  snapshotQueue = snapshotQueue
    .then(async () => {
      try {
        const row = await prisma.appStateSnapshot.findUnique({
          where: { id: 'global' },
          select: { data: true },
        });
        const base =
          row?.data && typeof row.data === 'object' && !Array.isArray(row.data)
            ? (JSON.parse(JSON.stringify(row.data)) as Record<string, any>)
            : {};
        const next = mutator(base);
        await prisma.appStateSnapshot.upsert({
          where: { id: 'global' },
          update: { data: next },
          create: { id: 'global', data: next },
        });
      } catch (err) {
        console.warn('[socket] snapshot mutation failed', err);
      }
    })
    .catch((err) => {
      console.warn('[socket] snapshot queue failed', err);
    });
};

export function createSocketServer(httpServer: HttpServer) {
  const allowedCorsOrigins = getAllowedCorsOrigins();
  const io = new SocketIOServer(httpServer, {
    maxHttpBufferSize: Number(process.env.SOCKET_MAX_BUFFER_BYTES || 45 * 1024 * 1024),
    cors: {
      origin: createCorsOriginValidator(allowedCorsOrigins),
      credentials: true,
    },
  });
  ioRef = io;
  const emitVoiceSnapshot = () => {
    io.emit('voice:snapshot', { channels: getVoiceSnapshotChannels() });
  };
  const emitVoiceChannelSync = (channelId: string) => {
    io.emit('voice:sync', {
      channelId,
      userIds: getVoiceUserIdsForChannel(channelId),
    });
  };

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    const secret = process.env.JWT_SECRET;
    if (!secret) return next(new Error('server_misconfigured'));
    if (!token) return next(new Error('unauthorized'));

    try {
      const decoded = jwt.verify(token, secret) as SocketUser;
      (socket.data as any).user = decoded;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const user = (socket.data as any).user as SocketUser;
    const socketVoiceChannels = new Set<string>();
    console.log('[socket] connection', { userId: user.userId });
    incrementPresenceSocketCount(user.userId);
    clearPendingOfflinePresence(user.userId);
    socket.join(`user:${user.userId}`);
    socket.emit('voice:snapshot', { channels: getVoiceSnapshotChannels() });
    socket.on('voice:snapshot:request', () => {
      socket.emit('voice:snapshot', { channels: getVoiceSnapshotChannels() });
    });

    socket.on('channel:message', (payload: { channelId: string; message: any }) => {
      if (!payload?.channelId || !payload?.message) return;
      const normalizedMessage = normalizeChannelMessage(payload.message, payload.channelId, user.userId);
      if (!normalizedMessage) return;
      const outboundPayload = { channelId: payload.channelId, message: normalizedMessage };
      socket.broadcast.emit('channel:message', outboundPayload);
      enqueueSnapshotMutation((state) => {
        if (!state.messages || typeof state.messages !== 'object' || Array.isArray(state.messages)) {
          state.messages = {};
        }
        const current = Array.isArray(state.messages[payload.channelId]) ? state.messages[payload.channelId] : [];
        if (!current.some((m: any) => m?.id === normalizedMessage.id)) {
          current.push(normalizedMessage);
        }
        state.messages[payload.channelId] = current;
        return state;
      });
    });

    socket.on('channel:create', (payload: { serverId: string; categoryId: string; channel: any }) => {
      if (!payload?.serverId || !payload?.categoryId || !payload?.channel) return;
      socket.broadcast.emit('channel:create', payload);
      enqueueSnapshotMutation((state) => {
        if (!Array.isArray(state.servers)) return state;
        const server = state.servers.find((s: any) => s?.id === payload.serverId);
        if (!server || !Array.isArray(server.categories)) return state;
        const category = server.categories.find((c: any) => c?.id === payload.categoryId);
        if (!category) return state;
        if (!Array.isArray(category.channels)) category.channels = [];
        const exists = category.channels.some((ch: any) => ch?.id === payload.channel.id);
        if (!exists) category.channels.push(payload.channel);
        return state;
      });
    });

    socket.on('channel:update', (payload: { serverId?: string; channelId?: string; updates?: any }) => {
      const serverId = payload?.serverId;
      const channelId = payload?.channelId;
      const updates = payload?.updates;
      if (!serverId || !channelId || !updates || typeof updates !== 'object') return;

      const nextUpdates: Record<string, any> = {};
      if (typeof updates.name === 'string') {
        const normalized = updates.name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');
        if (normalized.length >= 2) nextUpdates.name = normalized;
      }
      if (typeof updates.topic === 'string') {
        nextUpdates.topic = updates.topic.trim() || undefined;
      }
      if (updates.userLimit !== undefined) {
        const parsed = Number(updates.userLimit);
        const normalizedLimit =
          Number.isFinite(parsed) && parsed > 0
            ? Math.max(1, Math.min(99, Math.floor(parsed)))
            : null;
        nextUpdates.userLimit = normalizedLimit;
      }
      if (updates.permissionOverwrites !== undefined) {
        nextUpdates.permissionOverwrites = normalizePermissionOverwrites(updates.permissionOverwrites);
      }
      if (Object.keys(nextUpdates).length === 0) return;

      socket.broadcast.emit('channel:update', {
        serverId,
        channelId,
        updates: nextUpdates,
      });

      enqueueSnapshotMutation((state) => {
        if (!Array.isArray(state.servers)) return state;
        for (const server of state.servers) {
          if (!server || server.id !== serverId || !Array.isArray(server.categories)) continue;
          for (const category of server.categories) {
            if (!category || !Array.isArray(category.channels)) continue;
            for (const channel of category.channels) {
              if (!channel || channel.id !== channelId) continue;
              Object.assign(channel, nextUpdates);
              if (channel.type !== 'voice') {
                delete channel.userLimit;
              }
              return state;
            }
          }
        }
        return state;
      });
    });

    socket.on('channel:message:update', (payload: { channelId: string; messageId: string; updates: any }) => {
      if (!payload?.channelId || !payload?.messageId || !payload?.updates) return;
      socket.broadcast.emit('channel:message:update', payload);
      enqueueSnapshotMutation((state) => {
        if (!state.messages || typeof state.messages !== 'object' || Array.isArray(state.messages)) {
          state.messages = {};
        }
        const current = Array.isArray(state.messages[payload.channelId]) ? state.messages[payload.channelId] : [];
        const idx = current.findIndex((m: any) => m?.id === payload.messageId);
        if (idx === -1) return state;
        const editedAt =
          payload.updates?.editedAt ||
          (payload.updates?.content !== undefined ? new Date().toISOString() : current[idx]?.editedAt);
        current[idx] = { ...current[idx], ...payload.updates, editedAt };
        state.messages[payload.channelId] = current;
        return state;
      });
    });

    socket.on('channel:message:delete', async (payload: { channelId: string; messageId: string }) => {
      if (!payload?.channelId || !payload?.messageId) return;

      try {
        const row = await prisma.appStateSnapshot.findUnique({
          where: { id: 'global' },
          select: { data: true },
        });
        const root = row?.data as any;
        const messageMap = root?.messages && typeof root.messages === 'object' ? root.messages : {};
        const channelMessages = Array.isArray(messageMap[payload.channelId]) ? messageMap[payload.channelId] : [];
        const targetMessage = channelMessages.find((entry: any) => entry?.id === payload.messageId);
        if (!targetMessage) return;

        const authorId = typeof targetMessage?.authorId === 'string' ? targetMessage.authorId : null;
        const isOwnMessage = authorId === user.userId;
        let canModerate = false;

        const servers = Array.isArray(root?.servers) ? root.servers : [];
        const found = findServerAndChannelById(servers, payload.channelId);
        if (found) {
          canModerate = hasChannelPermission(found.server, found.channel, user.userId, 'MANAGE_MESSAGES');
        }

        if (!isOwnMessage && !canModerate) {
          socket.emit('channel:message:delete:denied', {
            channelId: payload.channelId,
            messageId: payload.messageId,
            reason: 'forbidden',
          });
          return;
        }
      } catch (err) {
        console.warn('[socket] failed to validate channel:message:delete', err);
        return;
      }

      socket.broadcast.emit('channel:message:delete', payload);
      enqueueSnapshotMutation((state) => {
        if (!state.messages || typeof state.messages !== 'object' || Array.isArray(state.messages)) {
          state.messages = {};
        }
        const current = Array.isArray(state.messages[payload.channelId]) ? state.messages[payload.channelId] : [];
        state.messages[payload.channelId] = current.filter((m: any) => m?.id !== payload.messageId);
        return state;
      });
    });

    socket.on('channel:message:reactions', (payload: { channelId: string; messageId: string; reactions: any[] }) => {
      if (!payload?.channelId || !payload?.messageId || !Array.isArray(payload.reactions)) return;
      socket.broadcast.emit('channel:message:reactions', payload);
      enqueueSnapshotMutation((state) => {
        if (!state.messages || typeof state.messages !== 'object' || Array.isArray(state.messages)) {
          state.messages = {};
        }
        const current = Array.isArray(state.messages[payload.channelId]) ? state.messages[payload.channelId] : [];
        const idx = current.findIndex((m: any) => m?.id === payload.messageId);
        if (idx === -1) return state;
        current[idx] = { ...current[idx], reactions: payload.reactions };
        state.messages[payload.channelId] = current;
        return state;
      });
    });

    socket.on('channel:message:pin', (payload: { channelId: string; messageId: string; isPinned: boolean }) => {
      if (!payload?.channelId || !payload?.messageId || typeof payload.isPinned !== 'boolean') return;
      socket.broadcast.emit('channel:message:pin', payload);
      enqueueSnapshotMutation((state) => {
        if (!state.messages || typeof state.messages !== 'object' || Array.isArray(state.messages)) {
          state.messages = {};
        }
        const current = Array.isArray(state.messages[payload.channelId]) ? state.messages[payload.channelId] : [];
        const idx = current.findIndex((m: any) => m?.id === payload.messageId);
        if (idx === -1) return state;
        current[idx] = { ...current[idx], isPinned: payload.isPinned };
        state.messages[payload.channelId] = current;
        return state;
      });
    });

    socket.on('dm:request', (payload: { toUserId: string; requestId: string; createdAt: string }) => {
      console.log('[socket] dm:request', { from: user.userId, to: payload.toUserId, requestId: payload.requestId });
      io.to(`user:${payload.toUserId}`).emit('dm:request', { ...payload, fromUserId: user.userId });
    });

    socket.on('dm:request:accept', (payload: { toUserId: string; requestId: string; conversationId: string }) => {
      console.log('[socket] dm:request:accept', { from: user.userId, to: payload.toUserId, requestId: payload.requestId });
      io.to(`user:${payload.toUserId}`).emit('dm:request:accept', { ...payload, fromUserId: user.userId });
    });

    socket.on('dm:request:reject', (payload: { toUserId: string; requestId: string }) => {
      console.log('[socket] dm:request:reject', { from: user.userId, to: payload.toUserId, requestId: payload.requestId });
      io.to(`user:${payload.toUserId}`).emit('dm:request:reject', { ...payload, fromUserId: user.userId });
    });

    socket.on('presence:update', (payload: { status?: 'online' | 'idle' | 'dnd' | 'offline' }) => {
      const status = payload?.status;
      if (!status || !['online', 'idle', 'dnd', 'offline'].includes(status)) return;
      if (status !== 'offline') {
        clearPendingOfflinePresence(user.userId);
      }
      socket.broadcast.emit('presence:update', {
        userId: user.userId,
        presence: { userId: user.userId, status },
      });
    });

    socket.on('voice:join', async (payload: { channelId?: string; userId?: string }) => {
      const channelId = payload?.channelId;
      if (!channelId) return;
      if (payload?.userId && payload.userId !== user.userId) return;

      for (const existingChannelId of Array.from(socketVoiceChannels)) {
        if (existingChannelId === channelId) continue;
        socketVoiceChannels.delete(existingChannelId);
        const fullyLeftExisting = removeVoicePresence(existingChannelId, user.userId);
        emitVoiceChannelSync(existingChannelId);
        if (fullyLeftExisting) {
          socket.broadcast.emit('voice:leave', {
            channelId: existingChannelId,
            userId: user.userId,
          });
        }
      }

      const alreadyInChannelForSocket = socketVoiceChannels.has(channelId);
      const alreadyPresentInChannel = isUserPresentInVoiceChannel(channelId, user.userId);

      if (!alreadyInChannelForSocket && !alreadyPresentInChannel) {
        const { userLimit, canJoin } = await getVoiceChannelRules(channelId, user.userId);
        if (!canJoin) {
          socket.emit('voice:join:denied', {
            channelId,
            userId: user.userId,
            reason: 'forbidden',
          });
          emitVoiceChannelSync(channelId);
          emitVoiceSnapshot();
          return;
        }
        const connectedCount = getVoiceUserIdsForChannel(channelId).length;
        if (userLimit && connectedCount >= userLimit) {
          socket.emit('voice:join:denied', {
            channelId,
            userId: user.userId,
            reason: 'limit_reached',
            limit: userLimit,
            connectedCount,
          });
          emitVoiceSnapshot();
          return;
        }
      }

      if (!alreadyInChannelForSocket) {
        socketVoiceChannels.add(channelId);
      }

      const firstForUserInChannel = alreadyPresentInChannel ? false : addVoicePresence(channelId, user.userId);
      socket.emit('voice:sync', {
        channelId,
        userIds: getVoiceUserIdsForChannel(channelId),
      });
      emitVoiceChannelSync(channelId);
      emitVoiceSnapshot();
      if (!firstForUserInChannel) return;

      socket.broadcast.emit('voice:join', {
        channelId,
        userId: user.userId,
      });
    });

    socket.on('voice:leave', (payload: { channelId?: string; userId?: string }) => {
      const channelId = payload?.channelId;
      if (!channelId) return;
      if (payload?.userId && payload.userId !== user.userId) return;

      if (!socketVoiceChannels.has(channelId)) {
        socket.emit('voice:sync', {
          channelId,
          userIds: getVoiceUserIdsForChannel(channelId),
        });
        emitVoiceChannelSync(channelId);
        emitVoiceSnapshot();
        return;
      }

      socketVoiceChannels.delete(channelId);
      const fullyLeftChannel = removeVoicePresence(channelId, user.userId);
      emitVoiceChannelSync(channelId);
      emitVoiceSnapshot();
      if (!fullyLeftChannel) return;

      socket.broadcast.emit('voice:leave', {
        channelId,
        userId: user.userId,
      });
    });

    socket.on('voice:update', (payload: { userId?: string; updates?: { muted?: boolean; deafened?: boolean } }) => {
      if (payload?.userId && payload.userId !== user.userId) return;
      const updates: { muted?: boolean; deafened?: boolean } = {};
      if (typeof payload?.updates?.muted === 'boolean') updates.muted = payload.updates.muted;
      if (typeof payload?.updates?.deafened === 'boolean') updates.deafened = payload.updates.deafened;
      if (Object.keys(updates).length === 0) return;

      socket.broadcast.emit('voice:update', {
        userId: user.userId,
        updates,
      });
    });

    socket.on('voice:speaking', (payload: { channelId?: string; userId?: string; speaking?: boolean }) => {
      const channelId = payload?.channelId;
      if (!channelId) return;
      if (payload?.userId && payload.userId !== user.userId) return;
      if (typeof payload?.speaking !== 'boolean') return;
      const isInChannel = socketVoiceChannels.has(channelId) || isUserPresentInVoiceChannel(channelId, user.userId);
      if (!isInChannel) return;

      socket.broadcast.emit('voice:speaking', {
        channelId,
        userId: user.userId,
        speaking: payload.speaking,
      });
    });

    socket.on('webrtc:offer', (payload: { channelId?: string; toUserId?: string; sdp?: { type?: string; sdp?: string } }) => {
      const channelId = payload?.channelId;
      const toUserId = payload?.toUserId;
      const sdp = payload?.sdp;
      if (!channelId || !toUserId || !sdp) return;
      if (toUserId === user.userId) return;
      const fromPresent = isUserPresentInVoiceChannel(channelId, user.userId);
      const toPresent = isUserPresentInVoiceChannel(channelId, toUserId);
      if (!fromPresent) {
        socketVoiceChannels.add(channelId);
        addVoicePresence(channelId, user.userId);
      }
      if (!fromPresent || !toPresent) {
        console.warn('[socket] webrtc:offer presence mismatch', {
          channelId,
          fromUserId: user.userId,
          toUserId,
          fromPresent,
          toPresent,
        });
      }
      io.to(`user:${toUserId}`).emit('webrtc:offer', {
        channelId,
        fromUserId: user.userId,
        sdp,
      });
    });

    socket.on('webrtc:answer', (payload: { channelId?: string; toUserId?: string; sdp?: { type?: string; sdp?: string } }) => {
      const channelId = payload?.channelId;
      const toUserId = payload?.toUserId;
      const sdp = payload?.sdp;
      if (!channelId || !toUserId || !sdp) return;
      if (toUserId === user.userId) return;
      const fromPresent = isUserPresentInVoiceChannel(channelId, user.userId);
      const toPresent = isUserPresentInVoiceChannel(channelId, toUserId);
      if (!fromPresent) {
        socketVoiceChannels.add(channelId);
        addVoicePresence(channelId, user.userId);
      }
      if (!fromPresent || !toPresent) {
        console.warn('[socket] webrtc:answer presence mismatch', {
          channelId,
          fromUserId: user.userId,
          toUserId,
          fromPresent,
          toPresent,
        });
      }
      io.to(`user:${toUserId}`).emit('webrtc:answer', {
        channelId,
        fromUserId: user.userId,
        sdp,
      });
    });

    socket.on('webrtc:ice-candidate', (payload: { channelId?: string; toUserId?: string; candidate?: any }) => {
      const channelId = payload?.channelId;
      const toUserId = payload?.toUserId;
      if (!channelId || !toUserId || !payload?.candidate) return;
      if (toUserId === user.userId) return;
      const fromPresent = isUserPresentInVoiceChannel(channelId, user.userId);
      const toPresent = isUserPresentInVoiceChannel(channelId, toUserId);
      if (!fromPresent) {
        socketVoiceChannels.add(channelId);
        addVoicePresence(channelId, user.userId);
      }
      if (!fromPresent || !toPresent) {
        console.warn('[socket] webrtc:ice-candidate presence mismatch', {
          channelId,
          fromUserId: user.userId,
          toUserId,
          fromPresent,
          toPresent,
        });
      }
      io.to(`user:${toUserId}`).emit('webrtc:ice-candidate', {
        channelId,
        fromUserId: user.userId,
        candidate: payload.candidate,
      });
    });

    socket.on('disconnect', () => {
      console.log('[socket] disconnect', { userId: user.userId });
      const remainingSockets = decrementPresenceSocketCount(user.userId);
      if (remainingSockets <= 0) {
        clearPendingOfflinePresence(user.userId);
        const timer = setTimeout(() => {
          pendingOfflinePresenceTimers.delete(user.userId);
          if (getPresenceSocketCount(user.userId) > 0) return;
          io.emit('presence:update', {
            userId: user.userId,
            presence: { userId: user.userId, status: 'offline' },
          });
        }, PRESENCE_OFFLINE_GRACE_MS);
        pendingOfflinePresenceTimers.set(user.userId, timer);
      }

      for (const channelId of Array.from(socketVoiceChannels)) {
        const fullyLeftChannel = removeVoicePresence(channelId, user.userId);
        emitVoiceChannelSync(channelId);
        if (!fullyLeftChannel) continue;
        socket.broadcast.emit('voice:leave', {
          channelId,
          userId: user.userId,
        });
      }
      socketVoiceChannels.clear();
      emitVoiceSnapshot();
    });
  });

  return io;
}
