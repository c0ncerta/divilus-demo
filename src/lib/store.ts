import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { User, Server, ServerInvite, Message, Presence, Channel, DMGroup, Permission, Role } from './types';
import type { Language } from './i18n';
import { initialData as localInitialData } from './mock-data';
import { demoData } from './demo-data';
import { v4 as uuidv4 } from 'uuid';
import { eventBus } from './event-bus';
import { isBackendEnabled, isDemoMode } from './env';
import { getSocket } from '../services/socket-client';
import { hasPermission } from './permissions';
import { ensureOwnerHasAdminRole, ensureOwnersHaveAdminRole } from './server-owner-admin';
import { dataProvider } from './providers/data-provider';

const seedData = isDemoMode ? demoData : localInitialData;

const computeActiveForUser = (
  servers: Server[],
  userId: string,
  preferredServerId?: string | null
): { activeServerId: string | null; activeChannelId: string | null } => {
  const validServers = servers.filter((s) => s.members.some((m) => m.userId === userId));
  const activeServer =
    (preferredServerId ? validServers.find((s) => s.id === preferredServerId) : null) ||
    validServers[0] ||
    null;
  const activeChannelId = activeServer ? activeServer.categories[0]?.channels[0]?.id ?? null : null;
  return { activeServerId: activeServer?.id ?? null, activeChannelId };
};

const buildInviteLink = (code: string): string => {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/invite/${code}`;
  }
  return `diavlocord://invite/${code}`;
};

const extractInviteCode = (input: string): string | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const knownInvitePatterns = [
    /(?:^|\/)invite\/([a-zA-Z0-9-]{2,64})(?:[/?#]|$)/i,
    /(?:https?:\/\/)?(?:www\.)?discord\.gg\/([a-zA-Z0-9-]{2,64})(?:[/?#]|$)/i,
    /(?:https?:\/\/)?(?:www\.)?discord(?:app)?\.com\/invite\/([a-zA-Z0-9-]{2,64})(?:[/?#]|$)/i,
    /diavlocord:\/\/invite\/([a-zA-Z0-9-]{2,64})(?:[/?#]|$)/i,
  ];
  for (const pattern of knownInvitePatterns) {
    const match = trimmed.match(pattern);
    if (match?.[1]) return match[1].toLowerCase();
  }

  const bareCodeMatch = trimmed.match(/^([a-zA-Z0-9-]{2,64})$/);
  if (bareCodeMatch?.[1]) return bareCodeMatch[1].toLowerCase();

  return null;
};

const normalizeInvite = (invite: ServerInvite): ServerInvite => ({
  ...invite,
  maxUses: typeof invite.maxUses === 'number' ? invite.maxUses : null,
  expiresAt: invite.expiresAt ?? null,
  revoked: Boolean(invite.revoked),
  revokedAt: invite.revokedAt ?? null,
});

const isInviteExpired = (invite: ServerInvite): boolean => {
  if (!invite.expiresAt) return false;
  const expiresAtMs = new Date(invite.expiresAt).getTime();
  if (Number.isNaN(expiresAtMs)) return false;
  return expiresAtMs <= Date.now();
};

const isInviteMaxed = (invite: ServerInvite): boolean => {
  if (!invite.maxUses || invite.maxUses <= 0) return false;
  return invite.uses >= invite.maxUses;
};

const normalizeRoleColor = (raw: string | undefined): string => {
  const value = (raw || '').trim();
  if (!value) return '#B5BAC1';
  if (/^#?[0-9a-fA-F]{3,8}$/.test(value)) {
    return value.startsWith('#') ? value : `#${value}`;
  }
  return value;
};

const buildWorkspacePayloadFromState = (state: any) => {
  const dmIds = new Set((state.dmGroups || []).map((g: any) => g.id));
  const nonDmMessages = Object.fromEntries(
    Object.entries(state.messages || {}).filter(([channelId]) => !dmIds.has(channelId))
  );
  return {
    servers: state.servers,
    messages: nonDmMessages,
    presences: state.presences,
    activeServerId: state.activeServerId,
    activeChannelId: state.activeChannelId,
    memberTimeouts: state.memberTimeouts,
    serverBans: state.serverBans,
    auditLog: state.auditLog,
    threads: state.threads,
    threadMessages: state.threadMessages,
    activeThreadId: state.activeThreadId,
  };
};

const pushWorkspaceStateToBackend = (state: any) => {
  if (!isBackendEnabled || !state?.backendToken) return;
  const payload = buildWorkspacePayloadFromState(state);
  void dataProvider.saveWorkspace(state.backendToken, payload).catch(() => { });
};

const USERS_STORAGE_KEY = 'diavlocord-users';
const MAX_USERS_STORAGE_COUNT = 320;
const MAX_USERS_STORAGE_URL_LENGTH = 2200;
const usersStorageWriteCache = new Map<string, string>();

const sanitizeUsersIndexUrl = (raw: unknown): string | undefined => {
  if (typeof raw !== 'string') return undefined;
  const next = raw.trim();
  if (!next) return undefined;
  // User index is only for account lookup; skip heavy inline blobs.
  if (next.startsWith('data:')) return undefined;
  return next.slice(0, MAX_USERS_STORAGE_URL_LENGTH);
};

const sanitizeUserForUsersStorage = (user: User): User => ({
  ...user,
  username: String(user.username || '').slice(0, 120) || 'Usuario',
  displayName: user.displayName ? String(user.displayName).slice(0, 120) : undefined,
  bio: user.bio ? String(user.bio).slice(0, 320) : undefined,
  customStatus: user.customStatus ? String(user.customStatus).slice(0, 140) : undefined,
  avatar: sanitizeUsersIndexUrl(user.avatar),
  banner: sanitizeUsersIndexUrl(user.banner),
});

const sanitizeUsersForUsersStorage = (users: User[]): User[] => {
  const byId = new Map<string, User>();
  for (const user of users || []) {
    if (!user || typeof user.id !== 'string' || !user.id) continue;
    const safe = sanitizeUserForUsersStorage(user);
    const prev = byId.get(safe.id);
    byId.set(safe.id, prev ? { ...prev, ...safe } : safe);
  }
  return Array.from(byId.values()).slice(-MAX_USERS_STORAGE_COUNT);
};

const readUsersFromMainStorage = (): User[] => {
  try {
    if (typeof window === 'undefined') return [];
    const rawMain = localStorage.getItem('diavlocord-storage');
    if (!rawMain) return [];
    const parsed = JSON.parse(rawMain);
    const state = parsed?.state;
    const users = state?.users;
    if (!Array.isArray(users) || users.length === 0) return [];
    return sanitizeUsersForUsersStorage(users as User[]);
  } catch {
    return [];
  }
};

const mergeUsers = (base: User[], extra: User[]): User[] => {
  const byId = new Map<string, User>();
  for (const u of base) byId.set(u.id, u);
  for (const u of extra) {
    const prev = byId.get(u.id);
    byId.set(u.id, prev ? { ...prev, ...u } : u);
  }
  return Array.from(byId.values());
};

const loadUsersFromStorage = (): User[] => {
  try {
    if (typeof window === 'undefined') return [];
    const raw = localStorage.getItem(USERS_STORAGE_KEY);
    const fromMain = readUsersFromMainStorage();
    if (!raw) {
      if (fromMain.length > 0) {
        const payload = JSON.stringify(fromMain);
        localStorage.setItem(USERS_STORAGE_KEY, payload);
        usersStorageWriteCache.set(USERS_STORAGE_KEY, payload);
        return fromMain;
      }
      return [];
    }

    usersStorageWriteCache.set(USERS_STORAGE_KEY, raw);
    const parsed = JSON.parse(raw);
    const current = sanitizeUsersForUsersStorage(Array.isArray(parsed) ? (parsed as User[]) : []);

    // If main storage has additional users, merge them in.
    if (fromMain.length > 0) {
      const merged = sanitizeUsersForUsersStorage(mergeUsers(current, fromMain));
      const hasNew = merged.length !== current.length;
      const looksLikeOnlyDemo = current.length === 1 && current[0]?.id === seedData.currentUser.id;
      if (hasNew || looksLikeOnlyDemo) {
        const payload = JSON.stringify(merged);
        localStorage.setItem(USERS_STORAGE_KEY, payload);
        usersStorageWriteCache.set(USERS_STORAGE_KEY, payload);
        return merged;
      }
    }

    return current;
  } catch {
    return [];
  }
};

const saveUsersToStorage = (users: User[]) => {
  if (typeof window === 'undefined') return;
  const safeUsers = sanitizeUsersForUsersStorage(users);
  const payload = JSON.stringify(safeUsers);
  if (usersStorageWriteCache.get(USERS_STORAGE_KEY) === payload) return;

  try {
    localStorage.setItem(USERS_STORAGE_KEY, payload);
    usersStorageWriteCache.set(USERS_STORAGE_KEY, payload);
    return;
  } catch (error) {
    const isQuotaError =
      error instanceof DOMException &&
      (error.name === 'QuotaExceededError' || error.code === 22 || error.code === 1014);
    if (!isQuotaError) return;
  }

  try {
    const emergencyUsers = safeUsers.slice(-80).map((user) => ({
      ...user,
      bio: undefined,
      banner: undefined,
      avatar: user.avatar && user.avatar.startsWith('http') ? user.avatar : undefined,
    }));
    const emergencyPayload = JSON.stringify(emergencyUsers);
    localStorage.setItem(USERS_STORAGE_KEY, emergencyPayload);
    usersStorageWriteCache.set(USERS_STORAGE_KEY, emergencyPayload);
  } catch {
    try {
      localStorage.removeItem(USERS_STORAGE_KEY);
      usersStorageWriteCache.delete(USERS_STORAGE_KEY);
    } catch { }
  }
};

const MAX_PERSISTED_MESSAGES_PER_CHANNEL = 48;
const MAX_PERSISTED_THREAD_MESSAGES = 28;
const MAX_PERSISTED_AUDIT_ENTRIES = 56;
const MAX_PERSISTED_CONTENT_LENGTH = 900;
const MAX_PERSISTED_URL_LENGTH = 2200;
const MAX_PERSISTED_DATA_URL_LENGTH = 90_000;
const MAX_PERSISTED_GIF_DATA_URL_LENGTH = 920_000;
const MAX_PERSISTED_SERVER_COUNT = 40;
const MAX_PERSISTED_SERVER_CATEGORIES = 40;
const MAX_PERSISTED_CHANNELS_PER_CATEGORY = 80;
const MAX_PERSISTED_SERVER_ROLES = 80;
const MAX_PERSISTED_SERVER_MEMBERS = 260;
const MAX_PERSISTED_ROLE_IDS_PER_MEMBER = 20;
const MAX_PERSISTED_DM_GROUPS = 140;
const MAX_PERSISTED_DM_REQUESTS = 180;
const MAX_PERSISTED_PINNED_DM_IDS = 90;
const MAX_PERSISTED_DEVICE_SESSIONS_PER_USER = 10;
const MAX_RUNTIME_MESSAGES_PER_CHANNEL = 420;
const MAX_RUNTIME_THREAD_MESSAGES = 220;
const MAX_RUNTIME_CONTENT_LENGTH = 4000;
const MAX_RUNTIME_ATTACHMENTS_PER_MESSAGE = 12;
const MAX_RUNTIME_ATTACHMENT_URL_LENGTH = 16_000;
const MAX_RUNTIME_ATTACHMENT_DATA_URL_LENGTH = 260_000;

const isQuotaExceededError = (error: unknown): boolean => {
  if (!(error instanceof DOMException)) return false;
  return error.name === 'QuotaExceededError' || error.code === 22 || error.code === 1014;
};

const sanitizeMessageForPersist = (message: Message): Message => {
  const safeContent =
    typeof message.content === 'string' && message.content.length > MAX_PERSISTED_CONTENT_LENGTH
      ? `${message.content.slice(0, MAX_PERSISTED_CONTENT_LENGTH)}...`
      : message.content;
  const safeAttachments =
    Array.isArray(message.attachments) && message.attachments.length > 0
      ? message.attachments
        .filter((att) => Boolean(att && typeof att.url === 'string' && !att.url.startsWith('data:')))
        .map((att) => ({
          ...att,
          filename: String(att.filename || 'file').slice(0, 220),
          url: String(att.url || '').slice(0, MAX_PERSISTED_URL_LENGTH),
        }))
      : undefined;
  return {
    ...message,
    content: safeContent,
    attachments: safeAttachments && safeAttachments.length > 0 ? safeAttachments : undefined,
  };
};

const sanitizeMessagesMapForPersist = (messages: Record<string, Message[]>) => {
  const safe: Record<string, Message[]> = {};
  for (const [channelId, list] of Object.entries(messages || {})) {
    if (!Array.isArray(list) || list.length === 0) continue;
    safe[channelId] = list.slice(-MAX_PERSISTED_MESSAGES_PER_CHANNEL).map((msg) => sanitizeMessageForPersist(msg));
  }
  return safe;
};

const sanitizePersistedUrl = (raw: unknown): string | undefined => {
  if (typeof raw !== 'string') return undefined;
  const next = raw.trim();
  if (!next) return undefined;
  if (next.startsWith('data:image/gif')) {
    if (next.length > MAX_PERSISTED_GIF_DATA_URL_LENGTH) return undefined;
    return next;
  }
  if (next.startsWith('data:') && next.length > MAX_PERSISTED_DATA_URL_LENGTH) return undefined;
  return next.slice(0, MAX_PERSISTED_URL_LENGTH);
};

const sanitizeUserForPersist = (user: User): User => ({
  ...user,
  username: String(user.username || '').slice(0, 120) || 'Usuario',
  displayName: user.displayName ? String(user.displayName).slice(0, 120) : undefined,
  bio: user.bio ? String(user.bio).slice(0, 600) : undefined,
  customStatus: user.customStatus ? String(user.customStatus).slice(0, 140) : undefined,
  avatar: sanitizePersistedUrl(user.avatar),
  banner: sanitizePersistedUrl(user.banner),
});

const sanitizeServerForPersist = (server: Server): Server => ({
  ...server,
  name: String(server.name || 'Server').slice(0, 120),
  description: server.description ? String(server.description).slice(0, 600) : undefined,
  tag: server.tag ? String(server.tag).slice(0, 32) : undefined,
  icon: sanitizePersistedUrl(server.icon),
  banner: sanitizePersistedUrl(server.banner),
  stickers: Array.isArray(server.stickers)
    ? server.stickers
      .slice(0, 80)
      .map((sticker) => {
        const safeUrl = sanitizePersistedUrl(sticker?.url);
        if (!safeUrl) return null;
        return {
          id: String(sticker?.id || '').slice(0, 128) || `stk-${uuidv4()}`,
          name: String(sticker?.name || 'sticker').slice(0, 64),
          url: safeUrl,
          contentType: String(sticker?.contentType || 'image/webp').slice(0, 120),
          size: Number.isFinite(Number(sticker?.size)) ? Math.max(0, Math.floor(Number(sticker?.size))) : 0,
          animated: Boolean(sticker?.animated),
          createdAt: sticker?.createdAt ? String(sticker.createdAt).slice(0, 64) : undefined,
          createdBy: sticker?.createdBy ? String(sticker.createdBy).slice(0, 120) : undefined,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    : undefined,
  categories: (server.categories || []).slice(0, MAX_PERSISTED_SERVER_CATEGORIES).map((category) => ({
    ...category,
    name: String(category.name || 'Category').slice(0, 80),
    channels: (category.channels || []).slice(0, MAX_PERSISTED_CHANNELS_PER_CATEGORY).map((channel) => ({
      ...channel,
      name: String(channel.name || 'channel').slice(0, 80),
      topic: channel.topic ? String(channel.topic).slice(0, 300) : undefined,
    })),
  })),
  roles: (server.roles || []).slice(0, MAX_PERSISTED_SERVER_ROLES).map((role) => ({
    ...role,
    name: String(role.name || 'role').slice(0, 80),
  })),
  members: (server.members || []).slice(0, MAX_PERSISTED_SERVER_MEMBERS).map((member) => ({
    userId: String(member?.userId || '').slice(0, 120),
    serverId: String(member?.serverId || server.id).slice(0, 120),
    nickname: member?.nickname ? String(member.nickname).slice(0, 64) : undefined,
    roleIds: Array.isArray(member?.roleIds)
      ? member.roleIds
        .filter((roleId): roleId is string => typeof roleId === 'string' && roleId.length > 0)
        .slice(0, MAX_PERSISTED_ROLE_IDS_PER_MEMBER)
      : [],
    joinedAt: member?.joinedAt || new Date().toISOString(),
  })),
});

const sanitizeServersForPersist = (servers: Server[]): Server[] =>
  (servers || []).slice(0, MAX_PERSISTED_SERVER_COUNT).map(sanitizeServerForPersist);

const sanitizeDmGroupsForPersist = (groups: DMGroup[]): DMGroup[] =>
  (groups || [])
    .slice(0, MAX_PERSISTED_DM_GROUPS)
    .map((group) => ({
      id: String(group?.id || ''),
      memberIds: Array.isArray(group?.memberIds)
        ? group.memberIds.filter((id): id is string => typeof id === 'string').slice(0, 20)
        : [],
      name: group?.name ? String(group.name).slice(0, 120) : undefined,
    }))
    .filter((group) => group.id && group.memberIds.length > 0);

const sanitizeDmRequestsForPersist = (
  requests: Array<{ id: string; fromUserId: string; toUserId: string; createdAt: string }>
) =>
  (requests || [])
    .slice(0, MAX_PERSISTED_DM_REQUESTS)
    .map((req) => ({
      id: String(req?.id || ''),
      fromUserId: String(req?.fromUserId || ''),
      toUserId: String(req?.toUserId || ''),
      createdAt: req?.createdAt || new Date().toISOString(),
    }))
    .filter((req) => req.id && req.fromUserId && req.toUserId);

const sanitizeDeviceSessionsForPersist = (
  sessions: Record<string, DeviceSession[]>,
  currentUserId: string
): Record<string, DeviceSession[]> => {
  const current = Array.isArray(sessions?.[currentUserId]) ? sessions[currentUserId] : [];
  return {
    [currentUserId]: current.slice(0, MAX_PERSISTED_DEVICE_SESSIONS_PER_USER),
  };
};

const sanitizeThreadMessagesMapForPersist = (threadMessages: Record<string, Message[]>) => {
  const safe: Record<string, Message[]> = {};
  for (const [threadId, list] of Object.entries(threadMessages || {})) {
    if (!Array.isArray(list) || list.length === 0) continue;
    safe[threadId] = list.slice(-MAX_PERSISTED_THREAD_MESSAGES).map((msg) => sanitizeMessageForPersist(msg));
  }
  return safe;
};

const sanitizeAuditLogForPersist = (auditLog: Record<string, AuditEntry[]>) => {
  const safe: Record<string, AuditEntry[]> = {};
  for (const [serverId, list] of Object.entries(auditLog || {})) {
    if (!Array.isArray(list) || list.length === 0) continue;
    safe[serverId] = list.slice(0, MAX_PERSISTED_AUDIT_ENTRIES);
  }
  return safe;
};

const sanitizeUserForEmergencyPersist = (user: User): User => {
  const safe = sanitizeUserForPersist(user);
  return {
    ...safe,
    avatar: safe.avatar && safe.avatar.startsWith('data:') ? undefined : safe.avatar,
    banner: safe.banner && safe.banner.startsWith('data:') ? undefined : safe.banner,
  };
};

const sanitizeMessageForRuntime = (message: Message): Message => {
  const safeContent =
    typeof message.content === 'string'
      ? message.content.slice(0, MAX_RUNTIME_CONTENT_LENGTH)
      : '';
  const safeAttachments = Array.isArray(message.attachments)
    ? message.attachments
      .filter((attachment) => {
        if (!attachment || typeof attachment.url !== 'string') return false;
        if (attachment.url.startsWith('data:')) {
          return attachment.url.length <= MAX_RUNTIME_ATTACHMENT_DATA_URL_LENGTH;
        }
        return attachment.url.length <= MAX_RUNTIME_ATTACHMENT_URL_LENGTH;
      })
      .slice(0, MAX_RUNTIME_ATTACHMENTS_PER_MESSAGE)
      .map((attachment) => ({
        ...attachment,
        filename: String(attachment.filename || 'file').slice(0, 240),
        contentType: String(attachment.contentType || 'application/octet-stream').slice(0, 180),
        size: Number(attachment.size) || 0,
      }))
    : undefined;

  return {
    ...message,
    content: safeContent,
    attachments: safeAttachments && safeAttachments.length > 0 ? safeAttachments : undefined,
  };
};

const persistWriteCache = new Map<string, string>();
const persistQuotaBackoffUntil = new Map<string, number>();
const PERSIST_QUOTA_BACKOFF_MS = 12_000;

const createSafeZustandStorage = () => ({
  getItem: (name: string): string | null => {
    try {
      const value = localStorage.getItem(name);
      if (typeof value === 'string') {
        persistWriteCache.set(name, value);
      }
      return value;
    } catch {
      return null;
    }
  },
  setItem: (name: string, value: string): void => {
    const backoffUntil = persistQuotaBackoffUntil.get(name) || 0;
    if (backoffUntil > Date.now()) return;
    if (persistWriteCache.get(name) === value) return;
    try {
      localStorage.setItem(name, value);
      persistWriteCache.set(name, value);
      persistQuotaBackoffUntil.delete(name);
      return;
    } catch (error) {
      if (!isQuotaExceededError(error)) return;
      persistQuotaBackoffUntil.set(name, Date.now() + PERSIST_QUOTA_BACKOFF_MS);
    }

    try {
      const parsed = JSON.parse(value) as { state?: any; version?: number };
      if (parsed?.state) {
        parsed.state.messages = {};
        parsed.state.threadMessages = {};
        parsed.state.auditLog = {};
        parsed.state.presences = {};
        parsed.state.dmGroups = [];
        parsed.state.pinnedDmIds = [];
        parsed.state.dmRequestsIncoming = [];
        parsed.state.dmRequestsOutgoing = [];
        parsed.state.servers = sanitizeServersForPersist(Array.isArray(parsed.state.servers) ? parsed.state.servers : []);
        if (parsed.state.currentUser) {
          parsed.state.currentUser = sanitizeUserForEmergencyPersist(parsed.state.currentUser);
        }
        if (parsed.state.activeServerId && Array.isArray(parsed.state.servers)) {
          const exists = parsed.state.servers.some((s: any) => s?.id === parsed.state.activeServerId);
          if (!exists) {
            parsed.state.activeServerId = null;
            parsed.state.activeChannelId = null;
          }
        }
      }
      const fallback = JSON.stringify(parsed);
      localStorage.setItem(name, fallback);
      persistWriteCache.set(name, fallback);
      persistQuotaBackoffUntil.delete(name);
    } catch {
      try {
        localStorage.removeItem(name);
        persistWriteCache.delete(name);
      } catch { }
    }
  },
  removeItem: (name: string): void => {
    try {
      localStorage.removeItem(name);
      persistWriteCache.delete(name);
      persistQuotaBackoffUntil.delete(name);
    } catch { }
  },
});

export interface VoiceMemberState {
  muted: boolean;
  deafened: boolean;
}

export interface VoiceChannelState {
  channelId: string;
  connectedUserIds: string[];
  speakingUserIds: string[];
}

export type VoiceQualityProfile = 'balanced' | 'clarity' | 'extreme';

export interface MediaSettings {
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  cameraDeviceId: string | null;
  microphoneVolume: number; // 0..1
  speakerVolume: number; // 0..1
  alwaysPreviewVideo: boolean;
  voiceQuality: VoiceQualityProfile;
}

export interface ServerBanEntry {
  userId: string;
  reason?: string;
  bannedAt: string;
  bannedBy: string;
}

export interface AuditEntry {
  id: string;
  serverId: string;
  action:
  | 'server_update'
  | 'role_create'
  | 'role_update'
  | 'role_delete'
  | 'member_role_update'
  | 'member_timeout'
  | 'member_untimeout'
  | 'member_kick'
  | 'member_ban'
  | 'member_unban'
  | 'channel_permission_update';
  actorUserId: string;
  targetUserId?: string;
  channelId?: string;
  roleId?: string;
  permission?: Permission;
  allowed?: boolean;
  reason?: string;
  createdAt: string;
}

export interface ThreadState {
  id: string;
  channelId: string;
  parentMessageId: string;
  name: string;
  createdBy: string;
  createdAt: string;
}

export interface DeviceSession {
  id: string;
  userId: string;
  deviceId: string;
  client: string;
  location: string;
  ip: string;
  userAgent: string;
  createdAt: string;
  lastActiveAt: string;
}

export type JoinServerByInviteResult =
  | { ok: true; serverId: string; alreadyMember: boolean }
  | { ok: false; reason: 'invalid' | 'not_found' | 'revoked' | 'expired' | 'maxed' | 'banned' };

const DEVICE_ID_STORAGE_KEY = 'diavlocord-device-id';

const getBrowserDeviceId = (): string => {
  if (typeof window === 'undefined') return `dev-${uuidv4()}`;
  try {
    const existing = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (existing) return existing;
    const next = `dev-${uuidv4()}`;
    localStorage.setItem(DEVICE_ID_STORAGE_KEY, next);
    return next;
  } catch {
    return `dev-${uuidv4()}`;
  }
};

const pickPlatform = (ua: string): string => {
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'macOS';
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Unknown OS';
};

const pickClient = (ua: string): string => {
  if (/Edg\//i.test(ua)) return 'Edge';
  if (/OPR\//i.test(ua)) return 'Opera';
  if (/Firefox\//i.test(ua)) return 'Firefox';
  if (/Chrome\//i.test(ua)) return 'Chrome';
  if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) return 'Safari';
  return 'Web';
};

const hashString = (value: string): number => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
};

const pseudoIpFromDeviceId = (deviceId: string): string => {
  const hash = hashString(deviceId);
  const a = ((hash >> 16) & 0xff) || 10;
  const b = ((hash >> 8) & 0xff) || 20;
  const c = (hash & 0xff) || 30;
  return `10.${a}.${b}.${c}`;
};

const buildDeviceSnapshot = (deviceId: string): Omit<DeviceSession, 'id' | 'userId' | 'createdAt' | 'lastActiveAt'> => {
  if (typeof window === 'undefined') {
    return {
      deviceId,
      client: 'Unknown OS - Web',
      location: 'Unknown location',
      ip: pseudoIpFromDeviceId(deviceId),
      userAgent: 'server',
    };
  }

  const ua = navigator.userAgent || '';
  const platform = pickPlatform(ua);
  const client = pickClient(ua);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown timezone';
  const locale = (navigator.language || 'en').toUpperCase();

  return {
    deviceId,
    client: `${platform} - ${client}`,
    location: `${tz} - ${locale}`,
    ip: pseudoIpFromDeviceId(deviceId),
    userAgent: ua,
  };
};

const upsertDeviceSessionMap = (
  map: Record<string, DeviceSession[]> | undefined,
  userId: string,
  deviceId: string
): Record<string, DeviceSession[]> => {
  const source = map || {};
  const now = new Date().toISOString();
  const snapshot = buildDeviceSnapshot(deviceId);
  const list = [...(source[userId] || [])];
  const idx = list.findIndex((session) => session.deviceId === deviceId);

  if (idx >= 0) {
    list[idx] = {
      ...list[idx],
      ...snapshot,
      userId,
      lastActiveAt: now,
    };
  } else {
    list.unshift({
      id: `sess-${uuidv4()}`,
      userId,
      createdAt: now,
      lastActiveAt: now,
      ...snapshot,
    });
  }

  list.sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime());
  return { ...source, [userId]: list.slice(0, 20) };
};

interface AppState {
  currentUser: User;
  backendToken?: string | null;
  servers: Server[];
  messages: Record<string, Message[]>; // channelId -> Message[]
  presences: Record<string, Presence>; // userId -> Presence
  activeServerId: string | null;
  activeChannelId: string | null;
  lastNavigationAt: number;
  typingUsers: Record<string, Set<string>>; // channelId -> Set of userIds
  voice: Record<string, VoiceChannelState>; // channelId -> voice state
  voiceMember: Record<string, VoiceMemberState>; // userId -> voice member state
  memberTimeouts: Record<string, string>; // `${serverId}:${userId}` -> ISO timestamp
  serverBans: Record<string, ServerBanEntry[]>; // serverId -> bans
  auditLog: Record<string, AuditEntry[]>; // serverId -> audit entries
  threads: Record<string, ThreadState>; // threadId -> thread metadata
  threadMessages: Record<string, Message[]>; // threadId -> messages
  activeThreadId: string | null;
  dmGroups: DMGroup[];
  pinnedDmIds: string[];
  dmRequestsIncoming: Array<{ id: string; fromUserId: string; toUserId: string; createdAt: string }>;
  dmRequestsOutgoing: Array<{ id: string; fromUserId: string; toUserId: string; createdAt: string }>;
  selectedUserId: string | null;
  rightSidebarOpen: boolean;
  rightSidebarView: 'members' | 'details';
  language: Language;
  developerMode: boolean;
  notificationSettings: {
    enableMentions: boolean;
    enableThreadReplies: boolean;
    enableSoundMentions: boolean;
    enableSoundThreadReplies: boolean;
    desktopMentions: boolean;
    desktopThreadReplies: boolean;
  };

  contentSocial: {
    sensitiveMedia: {
      friendDMs: 'show' | 'block';
      otherDMs: 'show' | 'block';
      serverChannels: 'show' | 'block';
    };
    dmSpamFilter: 'all' | 'non_friends' | 'none';
    allowAgeRestrictedCommandsInDMs: boolean;
    allowAgeRestrictedServersInIOS: boolean;
    allowDMs: boolean;
    messageRequests: boolean;
    friendRequests: {
      everyone: boolean;
      friendsOfFriends: boolean;
      serverMembers: boolean;
    };
  };

  privacy: {
    useDataToImprove: boolean;
    useDataToPersonalize: boolean;
    useThirdPartyDataToPersonalize: boolean;
    useDataToPersonalizeExperience: boolean;
    allowVoiceRecordingClips: boolean;
    persistentVerificationCodes: boolean;
  };
  mediaSettings: MediaSettings;
  activeDeviceId: string;
  deviceSessionsByUser: Record<string, DeviceSession[]>;

  // Actions
  setRightSidebarOpen: (open: boolean) => void;
  setRightSidebarView: (view: 'members' | 'details') => void;
  setSelectedUserId: (id: string | null) => void;
  setActiveServer: (id: string | null) => void;
  setActiveChannel: (id: string | null) => void;
  setLanguage: (lang: Language) => void;
  setDeveloperMode: (enabled: boolean) => void;
  setNotificationSettings: (updates: Partial<AppState['notificationSettings']>) => void;
  setBackendToken: (token: string | null) => void;
  setContentSocial: (updates: Partial<AppState['contentSocial']>) => void;
  setPrivacy: (updates: Partial<AppState['privacy']>) => void;
  setMediaSettings: (updates: Partial<MediaSettings>) => void;
  updateCurrentUser: (updates: Partial<User>) => void;
  addMessage: (channelId: string, message: Message) => void;
  updateMessage: (channelId: string, messageId: string, updates: Partial<Message>) => void;
  deleteMessage: (channelId: string, messageId: string) => void;
  toggleReaction: (channelId: string, messageId: string, emoji: string, userId: string) => void;
  togglePinMessage: (channelId: string, messageId: string) => void;
  setPresence: (userId: string, presence: Presence) => void;
  setTyping: (channelId: string, userId: string, isTyping: boolean) => void;
  createServer: (input: { name: string; icon?: string; description?: string; tag?: string; accentColor?: string }) => string;
  createServerInviteLink: (
    serverId: string,
    options?: { maxUses?: number | null; expiresInHours?: number | null }
  ) => string | null;
  revokeServerInvite: (serverId: string, inviteCode: string) => boolean;
  joinServerByInvite: (invite: string) => JoinServerByInviteResult;
  createChannel: (serverId: string, categoryId: string, channel: Pick<Channel, 'name' | 'type' | 'topic' | 'userLimit'>) => string;
  insertChannel: (serverId: string, categoryId: string, channel: Channel, broadcast?: boolean) => void;
  updateChannel: (
    serverId: string,
    channelId: string,
    updates: Partial<Pick<Channel, 'name' | 'topic' | 'userLimit'>>
  ) => void;
  createDM: (memberIds: string[]) => string;
  togglePinnedDM: (dmId: string) => void;
  removeDM: (dmId: string) => void;
  sendDMRequest: (toUserId: string) => { ok: boolean; reason?: string };
  receiveDMRequest: (req: { id: string; fromUserId: string; toUserId: string; createdAt: string }) => void;
  acceptDMRequest: (requestId: string) => void;
  rejectDMRequest: (requestId: string) => void;
  cancelDMRequest: (requestId: string) => void;
  voiceJoin: (channelId: string, userId: string, broadcast?: boolean) => void;
  voiceLeave: (channelId: string, userId: string, broadcast?: boolean) => void;
  setVoiceMemberState: (userId: string, updates: Partial<VoiceMemberState>, broadcast?: boolean) => void;
  setSpeaking: (channelId: string, userId: string, speaking: boolean, broadcast?: boolean) => void;
  resetData: () => void;
  users: User[];
  upsertUsers: (users: User[]) => void;
  registerUser: (input: { username: string; avatar?: string }) => string;
  loginUser: (userId: string) => boolean;
  logout: () => void;
  logoutUser: (userId: string) => void;
  registerUserWithPassword: (input: { username: string; password: string; avatar?: string }) => { id: string; recoveryCode: string };
  loginUserWithPassword: (username: string, password: string) => boolean;
  recoverPasswordWithCode: (username: string, recoveryCode: string, newPassword: string) => boolean;
  ensureCurrentDeviceSession: () => void;
  logoutDeviceSession: (sessionId: string) => void;
  joinServer: (serverId: string) => void;
  leaveServer: (serverId: string) => void;
  deleteServer: (serverId: string) => boolean;
  updateServer: (
    serverId: string,
    updates: Partial<Pick<Server, 'name' | 'icon' | 'banner' | 'description' | 'tag' | 'accentColor' | 'stickers'>>
  ) => void;
  createRole: (
    serverId: string,
    input?: Partial<Pick<Role, 'name' | 'color' | 'nameEffect' | 'permissions' | 'hoist' | 'mentionable'>>
  ) => string | null;
  updateRole: (
    serverId: string,
    roleId: string,
    updates: Partial<Pick<Role, 'name' | 'color' | 'nameEffect' | 'permissions' | 'hoist' | 'mentionable' | 'position'>>
  ) => void;
  deleteRole: (serverId: string, roleId: string) => void;
  setMemberRole: (serverId: string, userId: string, roleId: string, enabled: boolean) => void;
  timeoutMember: (serverId: string, userId: string, minutes: number, reason?: string) => void;
  clearMemberTimeout: (serverId: string, userId: string) => void;
  kickMember: (serverId: string, userId: string, reason?: string) => void;
  banMember: (serverId: string, userId: string, reason?: string) => void;
  unbanMember: (serverId: string, userId: string) => void;
  updateChannelRolePermission: (
    serverId: string,
    channelId: string,
    roleId: string,
    permission: Permission,
    allowed: boolean
  ) => void;
  updateChannelMemberPermission: (
    serverId: string,
    channelId: string,
    userId: string,
    permission: Permission,
    allowed: boolean
  ) => void;
  createThread: (input: { channelId: string; parentMessageId: string; name?: string }) => string;
  setActiveThread: (threadId: string | null) => void;
  addThreadMessage: (threadId: string, message: Message) => void;
}

export const useStore = create<AppState>()(
  persist(
    (set): AppState => {
      const storedUsers = loadUsersFromStorage();
      const bootUsers = storedUsers.length > 0 ? storedUsers : [seedData.currentUser];

      // Ensure current user is always in the users array
      const allUsers = bootUsers.some(u => u.id === seedData.currentUser.id)
        ? bootUsers
        : [...bootUsers, seedData.currentUser];

      if (storedUsers.length === 0) {
        saveUsersToStorage(allUsers);
      }

      const initialDeviceId = getBrowserDeviceId();
      const initialDeviceSessionsByUser = upsertDeviceSessionMap(
        {},
        seedData.currentUser.id,
        initialDeviceId
      );
      const initialServers = ensureOwnersHaveAdminRole(seedData.servers);

      return {
        currentUser: seedData.currentUser,
        backendToken: null,
        servers: initialServers,
        messages: isDemoMode ? { ...seedData.messages, ...demoData.dmMessages } : seedData.messages,
        presences: seedData.presences,
        ...computeActiveForUser(initialServers, seedData.currentUser.id, null),
        lastNavigationAt: 0,
        typingUsers: {},
        voice: {},
        voiceMember: {},
        memberTimeouts: {},
        serverBans: {},
        auditLog: {},
        threads: {},
        threadMessages: {},
        activeThreadId: null,
        dmGroups: isDemoMode ? demoData.dmGroups : [],
        pinnedDmIds: [],
        dmRequestsIncoming: [],
        dmRequestsOutgoing: [],
        users: allUsers,
        selectedUserId: null,
        rightSidebarOpen: true,
        rightSidebarView: 'members',
        language: 'es',
        developerMode: false,
        notificationSettings: {
          enableMentions: true,
          enableThreadReplies: true,
          enableSoundMentions: true,
          enableSoundThreadReplies: true,
          desktopMentions: false,
          desktopThreadReplies: false,
        },
        contentSocial: {
          sensitiveMedia: {
            friendDMs: 'show',
            otherDMs: 'block',
            serverChannels: 'show',
          },
          dmSpamFilter: 'non_friends',
          allowAgeRestrictedCommandsInDMs: false,
          allowAgeRestrictedServersInIOS: false,
          allowDMs: true,
          messageRequests: true,
          friendRequests: {
            everyone: true,
            friendsOfFriends: true,
            serverMembers: true,
          },
        },
        privacy: {
          useDataToImprove: true,
          useDataToPersonalize: true,
          useThirdPartyDataToPersonalize: true,
          useDataToPersonalizeExperience: true,
          allowVoiceRecordingClips: true,
          persistentVerificationCodes: false,
        },
        mediaSettings: {
          inputDeviceId: null,
          outputDeviceId: null,
          cameraDeviceId: null,
          microphoneVolume: 1,
          speakerVolume: 0.6,
          alwaysPreviewVideo: false,
          voiceQuality: 'clarity',
        },
        activeDeviceId: initialDeviceId,
        deviceSessionsByUser: initialDeviceSessionsByUser,

        setRightSidebarOpen: (open) => set({ rightSidebarOpen: open }),
        setRightSidebarView: (view) =>
          set({
            rightSidebarView: view,
            rightSidebarOpen: true,
          }),
        setSelectedUserId: (id) =>
          set((state) => ({
            selectedUserId: id,
            rightSidebarOpen: id ? true : state.rightSidebarOpen,
          })),
        setLanguage: (lang) => set({ language: lang }),
        setDeveloperMode: (enabled) => set({ developerMode: enabled }),
        setNotificationSettings: (updates) =>
          set((state) => ({
            notificationSettings: {
              ...state.notificationSettings,
              ...updates,
            },
          })),
        setBackendToken: (token) => set({ backendToken: token }),
        setContentSocial: (updates) =>
          set((state) => ({
            contentSocial: {
              ...state.contentSocial,
              ...updates,
              sensitiveMedia: {
                ...state.contentSocial.sensitiveMedia,
                ...(updates as any).sensitiveMedia,
              },
              friendRequests: {
                ...state.contentSocial.friendRequests,
                ...(updates as any).friendRequests,
              },
            },
          })),
        setPrivacy: (updates) =>
          set((state) => ({
            privacy: {
              ...state.privacy,
              ...updates,
            },
          })),
        setMediaSettings: (updates) =>
          set((state) => ({
            mediaSettings: {
              ...state.mediaSettings,
              ...updates,
              microphoneVolume:
                updates.microphoneVolume !== undefined
                  ? Math.max(0, Math.min(1, updates.microphoneVolume))
                  : state.mediaSettings.microphoneVolume,
              speakerVolume:
                updates.speakerVolume !== undefined
                  ? Math.max(0, Math.min(1, updates.speakerVolume))
                  : state.mediaSettings.speakerVolume,
              voiceQuality:
                updates.voiceQuality === 'balanced' ||
                  updates.voiceQuality === 'clarity' ||
                  updates.voiceQuality === 'extreme'
                  ? updates.voiceQuality
                  : state.mediaSettings.voiceQuality,
            },
          })),
        setActiveServer: (id) =>
          set((state) => {
            const now = Date.now();
            if (id === null) {
              return { activeServerId: null, activeChannelId: null, lastNavigationAt: now };
            }

            const isMember = (server: Server) =>
              Array.isArray(server.members) && server.members.some((member) => member.userId === state.currentUser.id);

            const visibleServers = state.servers.filter(isMember);
            if (visibleServers.length === 0) {
              return { activeServerId: null, activeChannelId: null, lastNavigationAt: now };
            }

            const requestedServer = visibleServers.find((server) => server.id === id) || visibleServers[0];
            const requestedChannelIds = new Set(
              requestedServer.categories.flatMap((category) => category.channels.map((channel) => channel.id))
            );
            const keepCurrentChannel =
              typeof state.activeChannelId === 'string' && requestedChannelIds.has(state.activeChannelId);
            const fallbackChannelId = requestedServer.categories[0]?.channels[0]?.id || null;

            return {
              activeServerId: requestedServer.id,
              activeChannelId: keepCurrentChannel ? state.activeChannelId : fallbackChannelId,
              lastNavigationAt: now,
            };
          }),
        setActiveChannel: (id) =>
          set((state) => {
            const now = Date.now();
            if (id === null) return { activeChannelId: null, lastNavigationAt: now };

            const dmMatch = state.dmGroups.find((group) => group.id === id);
            if (dmMatch) {
              return { activeServerId: null, activeChannelId: id, lastNavigationAt: now };
            }

            const serverMatch = state.servers.find((server) =>
              server.categories.some((category) => category.channels.some((channel) => channel.id === id))
            );
            if (!serverMatch) return {};

            const isMember = serverMatch.members.some((member) => member.userId === state.currentUser.id);
            if (!isMember) return {};

            return { activeServerId: serverMatch.id, activeChannelId: id, lastNavigationAt: now };
          }),
        setActiveThread: (threadId) => set({ activeThreadId: threadId }),

        updateCurrentUser: (updates) => set((state) => {
          const nextCurrentUser: User = { ...state.currentUser, ...updates };
          const nextUsers = state.users.map((u) => (u.id === nextCurrentUser.id ? nextCurrentUser : u));
          saveUsersToStorage(nextUsers);
          return { currentUser: nextCurrentUser, users: nextUsers };
        }),

        addMessage: (channelId, message) => set((state) => {
          const safeMessage = sanitizeMessageForRuntime(message);
          const channelMessages = state.messages[channelId] || [];
          const exists = channelMessages.some((m) => m.id === safeMessage.id);
          if (exists) return {};
          const nextChannelMessages = [...channelMessages, safeMessage].slice(-MAX_RUNTIME_MESSAGES_PER_CHANNEL);
          const nextState = {
            messages: {
              ...state.messages,
              [channelId]: nextChannelMessages
            }
          };

          const isDmConversation = state.dmGroups.some((g) => g.id === channelId);
          const dmContent = typeof safeMessage.content === 'string' ? safeMessage.content.trim() : '';
          const dmAttachments = Array.isArray(safeMessage.attachments) ? safeMessage.attachments : [];
          if (
            isDmConversation &&
            isBackendEnabled &&
            state.backendToken &&
            (dmContent.length > 0 || dmAttachments.length > 0) &&
            safeMessage.authorId === state.currentUser.id
          ) {
            const token = state.backendToken;
            void dataProvider
              .sendDmMessage(token, channelId, {
                content: dmContent,
                attachments: dmAttachments,
              })
              .catch(() => { });
          }

          if (
            !isDmConversation &&
            isBackendEnabled &&
            state.backendToken &&
            safeMessage.authorId === state.currentUser.id
          ) {
            const outboundAttachments = Array.isArray(safeMessage.attachments)
              ? safeMessage.attachments
                .filter((att) => Boolean(att && typeof att.url === 'string' && !att.url.startsWith('data:')))
                .map((att) => ({
                  id: String(att.id),
                  url: String(att.url),
                  filename: String(att.filename || 'file'),
                  contentType: String(att.contentType || 'application/octet-stream'),
                  size: Number(att.size) || 0,
                }))
              : undefined;
            const outboundMessage = {
              ...safeMessage,
              attachments: outboundAttachments && outboundAttachments.length > 0 ? outboundAttachments : undefined,
            };
            const socket = getSocket(state.backendToken);
            try {
              socket?.connect();
              socket?.emit('channel:message', { channelId, message: outboundMessage });
            } catch { }
          }

          return nextState;
        }),

        updateMessage: (channelId, messageId, updates) => set((state) => ({
          messages: {
            ...state.messages,
            [channelId]: (state.messages[channelId] || []).map(m =>
              m.id === messageId
                ? sanitizeMessageForRuntime({
                  ...m,
                  ...updates,
                  editedAt:
                    (updates as any)?.editedAt ||
                    ((updates as any)?.content !== undefined ? new Date().toISOString() : m.editedAt),
                })
                : m
            )
          }
        })),

        deleteMessage: (channelId, messageId) => {
          if (isDemoMode) return;
          set((state) => ({
            messages: {
              ...state.messages,
              [channelId]: (state.messages[channelId] || []).filter(m => m.id !== messageId)
            }
          }));
        },

        toggleReaction: (channelId, messageId, emoji, userId) => set((state) => {
          const list = state.messages[channelId] || [];
          const next = list.map((m) => {
            if (m.id !== messageId) return m;
            const reactions = m.reactions ? [...m.reactions] : [];
            const idx = reactions.findIndex((r) => r.emoji === emoji);
            if (idx === -1) {
              reactions.push({ emoji, userIds: [userId] });
            } else {
              const setIds = new Set(reactions[idx].userIds);
              if (setIds.has(userId)) setIds.delete(userId);
              else setIds.add(userId);
              const userIds = Array.from(setIds);
              if (userIds.length === 0) reactions.splice(idx, 1);
              else reactions[idx] = { ...reactions[idx], userIds };
            }
            return { ...m, reactions };
          });
          return { messages: { ...state.messages, [channelId]: next } };
        }),

        togglePinMessage: (channelId, messageId) => set((state) => ({
          messages: {
            ...state.messages,
            [channelId]: (state.messages[channelId] || []).map(m =>
              m.id === messageId ? { ...m, isPinned: !m.isPinned } : m
            )
          }
        })),

        createThread: ({ channelId, parentMessageId, name }) => {
          const id = `th-${uuidv4()}`;
          set((state) => {
            const parent = (state.messages[channelId] || []).find((m) => m.id === parentMessageId);
            const threadName = name?.trim() || `Thread: ${(parent?.content || 'message').slice(0, 24)}`.trim();
            return {
              threads: {
                ...state.threads,
                [id]: {
                  id,
                  channelId,
                  parentMessageId,
                  name: threadName,
                  createdBy: state.currentUser.id,
                  createdAt: new Date().toISOString(),
                },
              },
              threadMessages: {
                ...state.threadMessages,
                [id]: state.threadMessages[id] || [],
              },
              messages: {
                ...state.messages,
                [channelId]: (state.messages[channelId] || []).map((m) =>
                  m.id === parentMessageId ? { ...m, threadId: id } : m
                ),
              },
              activeThreadId: id,
            };
          });
          return id;
        },

        addThreadMessage: (threadId, message) => {
          const safeMessage = sanitizeMessageForRuntime(message);
          set((state) => ({
            threadMessages: {
              ...state.threadMessages,
              [threadId]: [...(state.threadMessages[threadId] || []), safeMessage].slice(-MAX_RUNTIME_THREAD_MESSAGES),
            },
          }));
        },

        setPresence: (userId, presence) =>
          set((state) => {
            const nextPresences = { ...state.presences, [userId]: presence };
            const nextUsers = state.users.map((u) =>
              u.id === userId ? { ...u, status: presence.status } : u
            );
            const nextCurrentUser =
              state.currentUser.id === userId
                ? { ...state.currentUser, status: presence.status }
                : state.currentUser;
            saveUsersToStorage(nextUsers);
            return {
              presences: nextPresences,
              users: nextUsers,
              currentUser: nextCurrentUser,
            };
          }),

        setTyping: (channelId, userId, isTyping) => set((state) => {
          const channelTyping = new Set(state.typingUsers[channelId] || []);
          if (isTyping) channelTyping.add(userId);
          else channelTyping.delete(userId);
          return {
            typingUsers: { ...state.typingUsers, [channelId]: channelTyping }
          };
        }),

        insertChannel: (serverId, categoryId, channel, broadcast = false) => {
          set((state) => ({
            servers: state.servers.map((s) => {
              if (s.id !== serverId) return s;
              return {
                ...s,
                categories: s.categories.map((c) => {
                  if (c.id !== categoryId) return c;
                  const already = c.channels.some((ch) => ch.id === channel.id);
                  if (already) return c;
                  return { ...c, channels: [...c.channels, channel] };
                }),
              };
            }),
          }));
          if (broadcast) {
            eventBus.emit('CHANNEL_CREATED', { serverId, categoryId, channel });
          }
        },

        createChannel: (serverId, categoryId, channelInput) => {
          if (isDemoMode) return '';
          const id = `chan-${uuidv4()}`;
          const normalizedUserLimit =
            channelInput.type === 'voice' && typeof channelInput.userLimit === 'number'
              ? Math.max(0, Math.min(99, Math.floor(channelInput.userLimit)))
              : 0;
          const newChannel: Channel = {
            id,
            name: channelInput.name,
            type: channelInput.type,
            topic: channelInput.topic,
            ...(channelInput.type === 'voice'
              ? { userLimit: normalizedUserLimit > 0 ? normalizedUserLimit : null }
              : {}),
          };
          // Insert and broadcast
          useStore.getState().insertChannel(serverId, categoryId, newChannel, true);
          const state = useStore.getState();
          if (isBackendEnabled && state.backendToken) {
            const socket = getSocket(state.backendToken);
            try {
              socket?.connect();
              socket?.emit('channel:create', { serverId, categoryId, channel: newChannel });
            } catch { }
          }
          return id;
        },

        updateChannel: (serverId, channelId, updates) => {
          if (isDemoMode) return;
          const normalizedName =
            typeof updates.name === 'string' ? updates.name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '') : undefined;
          const normalizedTopic = updates.topic !== undefined ? (updates.topic?.trim() || undefined) : undefined;
          const normalizedUserLimit =
            updates.userLimit !== undefined
              ? Math.max(0, Math.min(99, Math.floor(Number(updates.userLimit) || 0)))
              : undefined;

          let changed = false;
          let channelType: Channel['type'] | null = null;

          set((state) => ({
            servers: state.servers.map((server) => {
              if (server.id !== serverId) return server;
              return {
                ...server,
                categories: server.categories.map((category) => ({
                  ...category,
                  channels: category.channels.map((channel) => {
                    if (channel.id !== channelId) return channel;
                    channelType = channel.type;
                    const next: Channel = {
                      ...channel,
                      ...(normalizedName !== undefined && normalizedName.length >= 2 ? { name: normalizedName } : {}),
                      ...(normalizedTopic !== undefined ? { topic: normalizedTopic } : {}),
                      ...(normalizedUserLimit !== undefined && channel.type === 'voice'
                        ? { userLimit: normalizedUserLimit > 0 ? normalizedUserLimit : null }
                        : {}),
                    };
                    changed =
                      changed ||
                      next.name !== channel.name ||
                      next.topic !== channel.topic ||
                      next.userLimit !== channel.userLimit;
                    return next;
                  }),
                })),
              };
            }),
          }));

          if (!changed) return;

          eventBus.emit('CHANNEL_UPDATED', {
            serverId,
            channelId,
            updates: {
              ...(normalizedName !== undefined && normalizedName.length >= 2 ? { name: normalizedName } : {}),
              ...(normalizedTopic !== undefined ? { topic: normalizedTopic } : {}),
              ...(normalizedUserLimit !== undefined && channelType === 'voice'
                ? { userLimit: normalizedUserLimit > 0 ? normalizedUserLimit : null }
                : {}),
            },
          });

          const state = useStore.getState();
          if (isBackendEnabled && state.backendToken) {
            const socket = getSocket(state.backendToken);
            try {
              socket?.connect();
              socket?.emit('channel:update', {
                serverId,
                channelId,
                updates: {
                  ...(normalizedName !== undefined && normalizedName.length >= 2 ? { name: normalizedName } : {}),
                  ...(normalizedTopic !== undefined ? { topic: normalizedTopic } : {}),
                  ...(normalizedUserLimit !== undefined && channelType === 'voice'
                    ? { userLimit: normalizedUserLimit > 0 ? normalizedUserLimit : null }
                    : {}),
                },
              });
            } catch { }
          }
        },

        createServer: (input) => {
          if (isDemoMode) return '';
          const id = `srv-${uuidv4()}`;
          const categoryId = `cat-${uuidv4()}`;
          const channelId = `chan-${uuidv4()}`;
          const ownerId = useStore.getState().currentUser.id;
          const normalizedTag = (input.tag || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
          const baseServer: Server = {
            id,
            name: input.name,
            description: input.description?.trim() || undefined,
            tag: normalizedTag || undefined,
            accentColor: input.accentColor?.trim() || '#7A1027',
            icon: input.icon,
            ownerId,
            roles: [],
            categories: [
              {
                id: categoryId,
                name: 'General',
                channels: [
                  { id: channelId, name: 'general', type: 'text' }
                ]
              }
            ],
            members: [
              { userId: ownerId, serverId: id, roleIds: [], joinedAt: new Date().toISOString() }
            ],
            invites: []
          };
          const newServer = ensureOwnerHasAdminRole(baseServer);
          set((state) => {
            const nextServers = [...state.servers, newServer];
            const nextCurrentUser: User = {
              ...state.currentUser,
              serverIds: state.currentUser.serverIds?.includes(id)
                ? state.currentUser.serverIds
                : [...(state.currentUser.serverIds || []), id],
            };
            const nextUsers = state.users.map((u) => (u.id === nextCurrentUser.id ? nextCurrentUser : u));
            saveUsersToStorage(nextUsers);
            return {
              servers: nextServers,
              currentUser: nextCurrentUser,
              users: nextUsers,
              activeServerId: id,
              activeChannelId: channelId,
            };
          });
          eventBus.emit('SERVER_UPDATE', { action: 'created', server: newServer }, useStore.getState().currentUser.id);
          return id;
        },

        createServerInviteLink: (serverId, options) => {
          if (isDemoMode) return null;
          const state = useStore.getState();
          const server = state.servers.find((s) => s.id === serverId);
          if (!server) return null;

          const syncWorkspaceNow = () => {
            const latest: any = useStore.getState();
            pushWorkspaceStateToBackend(latest);
          };

          const usedCodes = new Set(
            state.servers.flatMap((s) => (s.invites || []).map((invite) => invite.code.toLowerCase()))
          );
          let code = '';
          do {
            code = uuidv4().replace(/-/g, '').slice(0, 10).toLowerCase();
          } while (usedCodes.has(code));

          const maxUses = typeof options?.maxUses === 'number' && options.maxUses > 0 ? Math.floor(options.maxUses) : null;
          const expiresAt =
            typeof options?.expiresInHours === 'number' && options.expiresInHours > 0
              ? new Date(Date.now() + options.expiresInHours * 60 * 60 * 1000).toISOString()
              : null;

          const invite: ServerInvite = {
            code,
            createdBy: state.currentUser.id,
            createdAt: new Date().toISOString(),
            uses: 0,
            maxUses,
            expiresAt,
            revoked: false,
            revokedAt: null,
          };

          set((prev) => ({
            servers: prev.servers.map((s) => {
              if (s.id !== serverId) return s;
              const normalized = (s.invites || []).map((entry) => normalizeInvite(entry));
              return { ...s, invites: [invite, ...normalized].slice(0, 50) };
            }),
          }));
          syncWorkspaceNow();

          return buildInviteLink(code);
        },

        revokeServerInvite: (serverId, inviteCode) => {
          if (isDemoMode) return false;
          const normalizedCode = inviteCode.trim().toLowerCase();
          if (!normalizedCode) return false;
          let changed = false;
          set((state) => ({
            servers: state.servers.map((s) => {
              if (s.id !== serverId) return s;
              const nextInvites = (s.invites || []).map((entry) => {
                const normalized = normalizeInvite(entry);
                if (normalized.code.toLowerCase() !== normalizedCode) return normalized;
                if (normalized.revoked) return normalized;
                changed = true;
                return {
                  ...normalized,
                  revoked: true,
                  revokedAt: new Date().toISOString(),
                };
              });
              return { ...s, invites: nextInvites };
            }),
          }));
          const latest: any = useStore.getState();
          if (changed) pushWorkspaceStateToBackend(latest);
          return changed;
        },

        joinServerByInvite: (inviteInput) => {
          if (isDemoMode) return { ok: false, reason: 'invalid' } as JoinServerByInviteResult;
          // Accept invite as link/code or legacy server id/name.
          const state = useStore.getState();
          const rawInvite = inviteInput.trim();
          if (!rawInvite) return { ok: false, reason: 'invalid' };

          const inviteCode = extractInviteCode(rawInvite);
          const inviteMatch = inviteCode
            ? state.servers
              .map((server) => ({
                server,
                invite: (server.invites || [])
                  .map((entry) => normalizeInvite(entry))
                  .find((entry) => entry.code.toLowerCase() === inviteCode.toLowerCase()),
              }))
              .find((entry) => Boolean(entry.invite))
            : undefined;

          const directServerMatch = state.servers.find(
            (s) => s.id === rawInvite || s.name.toLowerCase() === rawInvite.toLowerCase()
          );
          if (inviteCode && !inviteMatch?.invite && !directServerMatch) return { ok: false, reason: 'not_found' };

          if (inviteMatch?.invite) {
            const selectedInvite = inviteMatch.invite;
            if (selectedInvite.revoked) return { ok: false, reason: 'revoked' };
            if (isInviteExpired(selectedInvite)) return { ok: false, reason: 'expired' };
            if (isInviteMaxed(selectedInvite)) return { ok: false, reason: 'maxed' };
          }

          const server = inviteMatch?.server || directServerMatch;
          if (!server) return { ok: false, reason: 'not_found' };

          const userId = state.currentUser.id;
          const banned = (state.serverBans[server.id] || []).some((entry) => entry.userId === userId);
          if (banned) return { ok: false, reason: 'banned' };

          const member = { userId, serverId: server.id, roleIds: [], joinedAt: new Date().toISOString() };
          const matchedInviteCode = inviteMatch?.invite?.code?.toLowerCase() ?? null;
          const alreadyMember = server.members.some((m) => m.userId === userId);

          set((st) => ({
            servers: st.servers.map((s) => {
              if (s.id !== server.id) return s;
              const nextMembers = alreadyMember ? s.members : [...s.members, member];
              const nextInvites =
                matchedInviteCode && !alreadyMember
                  ? (s.invites || []).map((entry) => {
                    const normalized = normalizeInvite(entry);
                    return normalized.code.toLowerCase() === matchedInviteCode
                      ? { ...normalized, uses: normalized.uses + 1 }
                      : normalized;
                  })
                  : (s.invites || []).map((entry) => normalizeInvite(entry));
              return { ...s, members: nextMembers, invites: nextInvites };
            }),
          }));

          set((st) => {
            const nextCurrentUser: User = {
              ...st.currentUser,
              serverIds: st.currentUser.serverIds?.includes(server.id)
                ? st.currentUser.serverIds
                : [...(st.currentUser.serverIds || []), server.id],
            };
            const nextUsers = st.users.map((u) => (u.id === nextCurrentUser.id ? nextCurrentUser : u));
            saveUsersToStorage(nextUsers);
            return {
              currentUser: nextCurrentUser,
              users: nextUsers,
              activeServerId: server.id,
              activeChannelId: server.categories[0]?.channels[0]?.id ?? null,
            };
          });

          if (!alreadyMember) {
            eventBus.emit('SERVER_UPDATE', { action: 'joined', serverId: server.id, userId }, userId);
          }
          return { ok: true, serverId: server.id, alreadyMember };
        },

        createDM: (memberIds) => {
          const id = `dm-${uuidv4()}`;
          const newDM: DMGroup = {
            id,
            memberIds,
          };
          set((state) => ({
            dmGroups: [...state.dmGroups, newDM]
          }));
          return id;
        },

        togglePinnedDM: (dmId: string) => {
          set((state) => {
            const exists = state.dmGroups.some((group) => group.id === dmId);
            if (!exists) return {};
            const setIds = new Set(state.pinnedDmIds || []);
            if (setIds.has(dmId)) setIds.delete(dmId);
            else setIds.add(dmId);
            return { pinnedDmIds: Array.from(setIds) };
          });
        },

        sendDMRequest: (toUserId: string) => {
          const state = useStore.getState();
          const fromUserId = state.currentUser.id;
          if (toUserId === fromUserId) return { ok: false, reason: 'self' };

          // If DM already exists, just open it
          const existing = state.dmGroups.find((g) => {
            if (g.memberIds.length !== 2) return false;
            const set = new Set(g.memberIds);
            return set.has(fromUserId) && set.has(toUserId);
          });
          if (existing) {
            set({ activeServerId: null, activeChannelId: existing.id });
            return { ok: true };
          }

          const reversePending = state.dmRequestsIncoming.find(
            (r) => r.fromUserId === toUserId && r.toUserId === fromUserId
          );
          if (reversePending) {
            state.acceptDMRequest(reversePending.id);
            return { ok: true };
          }

          const alreadyPending = state.dmRequestsOutgoing.some((r) => r.toUserId === toUserId && r.fromUserId === fromUserId);
          if (alreadyPending) return { ok: false, reason: 'pending' };

          const req = {
            id: `dmreq-${uuidv4()}`,
            fromUserId,
            toUserId,
            createdAt: new Date().toISOString(),
          };

          set((st) => ({ dmRequestsOutgoing: [req, ...st.dmRequestsOutgoing] }));
          eventBus.emit('DM_REQUEST_SENT', req);

          if (isBackendEnabled && state.backendToken) {
            void dataProvider
              .createDmRequest(state.backendToken, toUserId)
              .then(async (res) => {
                const data = await res.json().catch(() => ({} as any));
                if (!res.ok) {
                  // Roll back optimistic pending request when backend rejects it.
                  useStore.setState((st: any) => ({
                    dmRequestsOutgoing: (st.dmRequestsOutgoing || []).filter((r: any) => r.id !== req.id),
                  }));
                  if (res.status === 401 || res.status === 403) {
                    try { localStorage.removeItem('diavlocord-backend-token'); } catch { }
                    useStore.setState({ backendToken: null });
                  }
                  return;
                }
                const conversationId = (data as any).conversationId as string | undefined;
                const requestId = (data as any).request?.id as string | undefined;
                if (conversationId) {
                  useStore.setState((st: any) => {
                    const exists = (st.dmGroups || []).some((g: any) => g.id === conversationId);
                    const nextGroups = exists
                      ? st.dmGroups
                      : [...st.dmGroups, { id: conversationId, memberIds: [fromUserId, toUserId] }];
                    return {
                      dmGroups: nextGroups,
                      activeServerId: null,
                      activeChannelId: conversationId,
                      dmRequestsOutgoing: (st.dmRequestsOutgoing || []).filter((r: any) => r.toUserId !== toUserId),
                    };
                  });
                } else if (requestId) {
                  useStore.setState((st: any) => ({
                    dmRequestsOutgoing: (st.dmRequestsOutgoing || []).map((r: any) =>
                      r.id === req.id ? { ...r, id: requestId } : r
                    ),
                  }));
                }
              })
              .catch(() => {
                useStore.setState((st: any) => ({
                  dmRequestsOutgoing: (st.dmRequestsOutgoing || []).filter((r: any) => r.id !== req.id),
                }));
              });
          }
          return { ok: true };
        },

        receiveDMRequest: (req) => {
          set((st) => {
            const exists = st.dmRequestsIncoming.some((r) => r.id === req.id);
            if (exists) return {};
            return { dmRequestsIncoming: [req, ...st.dmRequestsIncoming] };
          });
        },

        acceptDMRequest: (requestId: string) => {
          const state = useStore.getState();
          const req = state.dmRequestsIncoming.find((r) => r.id === requestId);
          if (!req) return;
          const a = req.fromUserId;
          const b = req.toUserId;

          const existing = state.dmGroups.find((g) => {
            if (g.memberIds.length !== 2) return false;
            const set = new Set(g.memberIds);
            return set.has(a) && set.has(b);
          });

          const dmId = existing
            ? existing.id
            : isBackendEnabled && state.backendToken
              ? null
              : useStore.getState().createDM([a, b]);
          set((st) => ({
            activeServerId: dmId ? null : st.activeServerId,
            activeChannelId: dmId ?? st.activeChannelId,
            dmRequestsIncoming: st.dmRequestsIncoming.filter((r) => r.id !== requestId),
          }));
          eventBus.emit('DM_REQUEST_ACCEPTED', { requestId, fromUserId: req.fromUserId, toUserId: req.toUserId, dmId });

          if (isBackendEnabled && state.backendToken) {
            void dataProvider
              .acceptDmRequest(state.backendToken, requestId)
              .then(async (res) => {
                const data = await res.json().catch(() => ({} as any));
                if (!res.ok) return;
                const conversationId = (data as any).conversationId as string | undefined;
                if (!conversationId) return;
                useStore.setState((st: any) => {
                  const already = (st.dmGroups || []).some((g: any) => g.id === conversationId);
                  const nextGroups = already
                    ? st.dmGroups
                    : [...st.dmGroups, { id: conversationId, memberIds: [a, b] }];
                  return { dmGroups: nextGroups, activeServerId: null, activeChannelId: conversationId };
                });
              })
              .catch(() => { });
          }
        },

        rejectDMRequest: (requestId: string) => {
          const state = useStore.getState();
          const req = state.dmRequestsIncoming.find((r) => r.id === requestId);
          set((st) => ({
            dmRequestsIncoming: st.dmRequestsIncoming.filter((r) => r.id !== requestId),
          }));
          if (req) {
            eventBus.emit('DM_REQUEST_REJECTED', { requestId, fromUserId: req.fromUserId, toUserId: req.toUserId });

            if (isBackendEnabled && state.backendToken) {
              void dataProvider.rejectDmRequest(state.backendToken, requestId).catch(() => { });
            }
          }
        },

        cancelDMRequest: (requestId: string) => {
          const state = useStore.getState();
          const req = state.dmRequestsOutgoing.find((r) => r.id === requestId);
          if (!req) return;

          set((st) => ({
            dmRequestsOutgoing: st.dmRequestsOutgoing.filter((r) => r.id !== requestId),
          }));
          eventBus.emit('DM_REQUEST_REJECTED', {
            requestId,
            fromUserId: req.fromUserId,
            toUserId: req.toUserId,
          });

          if (isBackendEnabled && state.backendToken) {
            void dataProvider.cancelDmRequest(state.backendToken, requestId).catch(() => { });
          }
        },

        removeDM: (dmId: string) => {
          set((state) => {
            const { [dmId]: _removed, ...restMessages } = state.messages;
            const nextActiveChannelId = state.activeChannelId === dmId ? null : state.activeChannelId;
            return {
              dmGroups: state.dmGroups.filter((g) => g.id !== dmId),
              pinnedDmIds: (state.pinnedDmIds || []).filter((id) => id !== dmId),
              messages: restMessages,
              activeChannelId: nextActiveChannelId,
              selectedUserId: state.activeChannelId === dmId ? null : state.selectedUserId,
            };
          });
        },

        voiceJoin: (channelId, userId, broadcast = true) => set((state) => {
          const targetServer = state.servers.find((server) =>
            server.categories.some((category) => category.channels.some((channel) => channel.id === channelId))
          );
          const targetChannel = state.servers
            .flatMap((server) => server.categories)
            .flatMap((category) => category.channels)
            .find((channel) => channel.id === channelId);
          if (targetServer && targetChannel && !hasPermission(targetServer, targetChannel, userId, 'VIEW_CHANNEL')) {
            return {};
          }
          const channelUserLimit =
            targetChannel?.type === 'voice' && typeof targetChannel.userLimit === 'number' && targetChannel.userLimit > 0
              ? targetChannel.userLimit
              : null;
          const currentlyConnected = Array.from(new Set(state.voice[channelId]?.connectedUserIds || []));
          const alreadyConnected = currentlyConnected.includes(userId);
          if (channelUserLimit && !alreadyConnected && currentlyConnected.length >= channelUserLimit) {
            return {};
          }

          const nextVoice: Record<string, VoiceChannelState> = { ...state.voice };
          const leftChannelIds: string[] = [];

          for (const [existingChannelId, voiceState] of Object.entries(nextVoice)) {
            if (existingChannelId === channelId) continue;
            if (!voiceState.connectedUserIds.includes(userId)) continue;
            const trimmed: VoiceChannelState = {
              ...voiceState,
              connectedUserIds: voiceState.connectedUserIds.filter((id) => id !== userId),
              speakingUserIds: voiceState.speakingUserIds.filter((id) => id !== userId),
            };
            nextVoice[existingChannelId] = trimmed;
            leftChannelIds.push(existingChannelId);
          }

          const prev = nextVoice[channelId] || { channelId, connectedUserIds: [], speakingUserIds: [] };
          if (prev.connectedUserIds.includes(userId) && leftChannelIds.length === 0) return {};
          const next: VoiceChannelState = {
            ...prev,
            connectedUserIds: [...prev.connectedUserIds, userId],
          };
          nextVoice[channelId] = next;

          if (broadcast) {
            for (const existingChannelId of leftChannelIds) {
              eventBus.emit('VOICE_LEAVE', { channelId: existingChannelId, userId });
            }
            eventBus.emit('VOICE_JOIN', { channelId, userId });
            if (isBackendEnabled && state.backendToken && userId === state.currentUser.id) {
              const socket = getSocket(state.backendToken);
              try {
                socket?.connect();
                for (const existingChannelId of leftChannelIds) {
                  socket?.emit('voice:leave', { channelId: existingChannelId, userId });
                }
                socket?.emit('voice:join', { channelId, userId });
              } catch { }
            }
          }
          return { voice: nextVoice };
        }),

        voiceLeave: (channelId, userId, broadcast = true) => set((state) => {
          const prev = state.voice[channelId];
          if (!prev) return {};
          const next: VoiceChannelState = {
            ...prev,
            connectedUserIds: prev.connectedUserIds.filter((id) => id !== userId),
            speakingUserIds: prev.speakingUserIds.filter((id) => id !== userId),
          };
          if (broadcast) {
            eventBus.emit('VOICE_LEAVE', { channelId, userId });
            if (isBackendEnabled && state.backendToken && userId === state.currentUser.id) {
              const socket = getSocket(state.backendToken);
              try {
                socket?.connect();
                socket?.emit('voice:leave', { channelId, userId });
              } catch { }
            }
          }
          return { voice: { ...state.voice, [channelId]: next } };
        }),

        setVoiceMemberState: (userId, updates, broadcast = true) => set((state) => {
          const prev = state.voiceMember[userId] || { muted: false, deafened: false };
          const next = { ...prev, ...updates };
          if (broadcast) {
            eventBus.emit('VOICE_UPDATE', { userId, updates: next });
            if (isBackendEnabled && state.backendToken && userId === state.currentUser.id) {
              const socket = getSocket(state.backendToken);
              try {
                socket?.connect();
                socket?.emit('voice:update', { userId, updates: next });
              } catch { }
            }
          }
          return { voiceMember: { ...state.voiceMember, [userId]: next } };
        }),

        setSpeaking: (channelId, userId, speaking, broadcast = true) => set((state) => {
          const prev = state.voice[channelId] || { channelId, connectedUserIds: [], speakingUserIds: [] };
          const setIds = new Set(prev.speakingUserIds);
          const wasSpeaking = setIds.has(userId);
          if (wasSpeaking === speaking) return {};
          if (speaking) setIds.add(userId);
          else setIds.delete(userId);
          const next: VoiceChannelState = { ...prev, speakingUserIds: Array.from(setIds) };
          if (broadcast) {
            eventBus.emit('VOICE_SPEAKING', { channelId, userId, speaking });
            if (isBackendEnabled && state.backendToken && userId === state.currentUser.id) {
              const socket = getSocket(state.backendToken);
              try {
                socket?.connect();
                socket?.emit('voice:speaking', { channelId, userId, speaking });
              } catch { }
            }
          }
          return { voice: { ...state.voice, [channelId]: next } };
        }),

        resetData: () => {
          const seededServers = ensureOwnersHaveAdminRole(seedData.servers);
          const filteredServers = seededServers.filter(server =>
            server.members.some(member => member.userId === seedData.currentUser.id)
          );
          set({
            currentUser: seedData.currentUser,
            backendToken: null,
            servers: filteredServers,
            messages: seedData.messages,
            presences: seedData.presences,
            activeServerId: filteredServers.length > 0 ? filteredServers[0].id : null,
            activeChannelId: filteredServers.length > 0 ? filteredServers[0].categories[0].channels[0].id : null,
            typingUsers: {},
            voice: {},
            voiceMember: {},
            dmGroups: [],
            pinnedDmIds: [],
            rightSidebarOpen: true,
            rightSidebarView: 'members',
            selectedUserId: null,
          });
        },
        upsertUsers: (incomingUsers) => {
          if (!incomingUsers || incomingUsers.length === 0) return;
          set((state) => {
            const byId = new Map<string, User>();
            for (const u of state.users) byId.set(u.id, u);
            for (const u of incomingUsers) {
              const prev = byId.get(u.id);
              byId.set(u.id, prev ? { ...prev, ...u } : u);
            }
            const nextUsers = Array.from(byId.values());
            saveUsersToStorage(nextUsers);
            return { users: nextUsers };
          });
        },
        registerUser: (input) => {
          const id = `u-${uuidv4()}`;
          const discriminator = Math.floor(1000 + Math.random() * 9000).toString();
          const deviceId = getBrowserDeviceId();
          const newUser: User = {
            id,
            username: input.username,
            discriminator,
            avatar: input.avatar,
            status: 'online',
            serverIds: []
          };
          set((state) => {
            const nextUsers = [...state.users, newUser];
            const nextDeviceSessionsByUser = upsertDeviceSessionMap(
              state.deviceSessionsByUser,
              newUser.id,
              deviceId
            );
            saveUsersToStorage(nextUsers);
            return {
              users: nextUsers,
              currentUser: newUser,
              dmGroups: [],
              pinnedDmIds: [],
              dmRequestsIncoming: [],
              dmRequestsOutgoing: [],
              activeDeviceId: deviceId,
              deviceSessionsByUser: nextDeviceSessionsByUser,
            };
          });
          // persist session
          try { localStorage.setItem('diavlocord-session', id); } catch { };
          return id;
        },

        loginUser: (userId) => {
          const state = useStore.getState();
          const deviceId = state.activeDeviceId || getBrowserDeviceId();
          const user = state.users.find(u => u.id === userId);
          if (!user) return false;
          const nextActive = computeActiveForUser(state.servers, user.id, state.activeServerId);
          set({
            currentUser: user,
            ...nextActive,
            dmGroups: [],
            pinnedDmIds: [],
            dmRequestsIncoming: [],
            dmRequestsOutgoing: [],
            selectedUserId: null,
            rightSidebarOpen: true,
            rightSidebarView: 'members',
            activeDeviceId: deviceId,
            deviceSessionsByUser: upsertDeviceSessionMap(state.deviceSessionsByUser, user.id, deviceId),
          });
          try { localStorage.setItem('diavlocord-session', userId); } catch { }
          return true;
        },

        logout: () => {
          const fallback = seedData.currentUser;
          const state = useStore.getState();
          const deviceId = state.activeDeviceId || getBrowserDeviceId();
          const nextActive = computeActiveForUser(state.servers, fallback.id, null);
          set({
            currentUser: fallback,
            backendToken: null,
            ...nextActive,
            dmGroups: [],
            pinnedDmIds: [],
            dmRequestsIncoming: [],
            dmRequestsOutgoing: [],
            selectedUserId: null,
            rightSidebarOpen: true,
            rightSidebarView: 'members',
            activeDeviceId: deviceId,
            deviceSessionsByUser: upsertDeviceSessionMap(state.deviceSessionsByUser, fallback.id, deviceId),
          });
          try { localStorage.removeItem('diavlocord-session'); } catch { }
          try { localStorage.removeItem('diavlocord-backend-token'); } catch { }
        },

        logoutUser: (userId) => {
          const state = useStore.getState();
          const newUsers = state.users.filter(u => u.id !== userId);
          saveUsersToStorage(newUsers);
          const nextDeviceSessionsByUser = { ...state.deviceSessionsByUser };
          delete nextDeviceSessionsByUser[userId];
          set({ users: newUsers, deviceSessionsByUser: nextDeviceSessionsByUser });
          // If removing current user, revert to fallback
          if (state.currentUser.id === userId) {
            const deviceId = state.activeDeviceId || getBrowserDeviceId();
            set({
              currentUser: seedData.currentUser,
              backendToken: null,
              dmGroups: [],
              pinnedDmIds: [],
              dmRequestsIncoming: [],
              dmRequestsOutgoing: [],
              selectedUserId: null,
              rightSidebarOpen: true,
              rightSidebarView: 'members',
              activeDeviceId: deviceId,
              deviceSessionsByUser: upsertDeviceSessionMap(
                nextDeviceSessionsByUser,
                seedData.currentUser.id,
                deviceId
              ),
            });
            try { localStorage.removeItem('diavlocord-session'); } catch { }
            try { localStorage.removeItem('diavlocord-backend-token'); } catch { }
          }
        },

        registerUserWithPassword: (input: { username: string; password: string; avatar?: string }) => {
          const id = `u-${uuidv4()}`;
          const discriminator = Math.floor(1000 + Math.random() * 9000).toString();
          const deviceId = getBrowserDeviceId();
          const recoveryCode = Math.random().toString(36).substring(2, 15).toUpperCase() + '-' +
            Math.random().toString(36).substring(2, 15).toUpperCase();

          const newUser: User = {
            id,
            username: input.username,
            discriminator,
            avatar: input.avatar,
            status: 'online',
            password: input.password,
            recoveryCode,
            serverIds: []
          };
          set((state) => {
            const nextUsers = [...state.users, newUser];
            const nextDeviceSessionsByUser = upsertDeviceSessionMap(
              state.deviceSessionsByUser,
              newUser.id,
              deviceId
            );
            saveUsersToStorage(nextUsers);
            return {
              users: nextUsers,
              currentUser: newUser,
              dmGroups: [],
              pinnedDmIds: [],
              dmRequestsIncoming: [],
              dmRequestsOutgoing: [],
              activeDeviceId: deviceId,
              deviceSessionsByUser: nextDeviceSessionsByUser,
            };
          });
          try { localStorage.setItem('diavlocord-session', id); } catch { };
          return { id, recoveryCode };
        },

        loginUserWithPassword: (username: string, password: string) => {
          const state = useStore.getState();
          const deviceId = state.activeDeviceId || getBrowserDeviceId();
          const uname = username.trim().toLowerCase();
          const user = state.users.find(u => u.username.trim().toLowerCase() === uname && u.password === password);
          if (!user) return false;
          const nextActive = computeActiveForUser(state.servers, user.id, state.activeServerId);
          set({
            currentUser: user,
            ...nextActive,
            dmGroups: [],
            pinnedDmIds: [],
            dmRequestsIncoming: [],
            dmRequestsOutgoing: [],
            selectedUserId: null,
            activeDeviceId: deviceId,
            deviceSessionsByUser: upsertDeviceSessionMap(state.deviceSessionsByUser, user.id, deviceId),
          });
          try { localStorage.setItem('diavlocord-session', user.id); } catch { }
          return true;
        },

        recoverPasswordWithCode: (username: string, recoveryCode: string, newPassword: string) => {
          const state = useStore.getState();
          const uname = username.trim().toLowerCase();
          const code = recoveryCode.trim();
          const user = state.users.find(u => u.username.trim().toLowerCase() === uname && u.recoveryCode === code);
          if (!user) return false;

          set((state) => {
            const nextUsers = state.users.map(u =>
              u.id === user.id ? { ...u, password: newPassword } : u
            );
            saveUsersToStorage(nextUsers);
            return { users: nextUsers };
          });
          return true;
        },

        ensureCurrentDeviceSession: () => {
          set((state) => {
            const deviceId = state.activeDeviceId || getBrowserDeviceId();
            return {
              activeDeviceId: deviceId,
              deviceSessionsByUser: upsertDeviceSessionMap(
                state.deviceSessionsByUser,
                state.currentUser.id,
                deviceId
              ),
            };
          });
        },

        logoutDeviceSession: (sessionId) => {
          set((state) => {
            const list = state.deviceSessionsByUser[state.currentUser.id] || [];
            const nextList = list.filter((session) => session.id !== sessionId);
            return {
              deviceSessionsByUser: {
                ...state.deviceSessionsByUser,
                [state.currentUser.id]: nextList,
              },
            };
          });
        },

        joinServer: (serverId: string) => {
          set((state) => {
            const userId = state.currentUser.id;
            const server = state.servers.find((s) => s.id === serverId);
            if (!server) return {};
            const banned = (state.serverBans[serverId] || []).some((entry) => entry.userId === userId);
            if (banned) return {};

            const alreadyMember = server.members.some((m) => m.userId === userId);
            const nextServers = alreadyMember
              ? state.servers
              : state.servers.map((s) =>
                s.id === serverId
                  ? {
                    ...s,
                    members: [
                      ...s.members,
                      { userId, serverId, roleIds: [], joinedAt: new Date().toISOString() },
                    ],
                  }
                  : s
              );

            const nextCurrentUser: User = {
              ...state.currentUser,
              serverIds: state.currentUser.serverIds?.includes(serverId)
                ? state.currentUser.serverIds
                : [...(state.currentUser.serverIds || []), serverId],
            };

            const nextActive = computeActiveForUser(nextServers, userId, state.activeServerId);
            return {
              servers: nextServers,
              currentUser: nextCurrentUser,
              activeServerId: nextActive.activeServerId,
              activeChannelId: nextActive.activeChannelId,
            };
          });
        },

        leaveServer: (serverId: string) => {
          if (isDemoMode) return;
          set((state) => {
            const userId = state.currentUser.id;
            const targetServer = state.servers.find((s) => s.id === serverId);
            if (!targetServer) return {};
            if (targetServer.ownerId === userId) return {};

            const nextServers = state.servers.map((s) => {
              if (s.id !== serverId) return s;
              return {
                ...s,
                members: s.members.filter((m) => m.userId !== userId),
              };
            });

            const nextCurrentUser: User = {
              ...state.currentUser,
              serverIds: (state.currentUser.serverIds || []).filter((id) => id !== serverId),
            };

            const nextActive = computeActiveForUser(nextServers, userId, state.activeServerId);

            return {
              currentUser: nextCurrentUser,
              servers: nextServers,
              activeServerId: nextActive.activeServerId,
              activeChannelId: nextActive.activeChannelId,
              selectedUserId: null,
            };
          });
        },

        deleteServer: (serverId: string) => {
          if (isDemoMode) return false;
          const state = useStore.getState();
          const server = state.servers.find((s) => s.id === serverId);
          if (!server) return false;
          if (server.ownerId !== state.currentUser.id) return false;

          set((st) => {
            const nextServers = st.servers.filter((s) => s.id !== serverId);

            const nextCurrentUser: User = {
              ...st.currentUser,
              serverIds: (st.currentUser.serverIds || []).filter((id) => id !== serverId),
            };

            let nextActiveServerId = st.activeServerId;
            let nextActiveChannelId = st.activeChannelId;
            if (st.activeServerId === serverId) {
              const nextActiveServer = nextServers[0] || null;
              nextActiveServerId = nextActiveServer?.id ?? null;
              nextActiveChannelId = nextActiveServer
                ? nextActiveServer.categories[0]?.channels[0]?.id ?? null
                : null;
            }

            return {
              servers: nextServers,
              currentUser: nextCurrentUser,
              activeServerId: nextActiveServerId,
              activeChannelId: nextActiveChannelId,
              selectedUserId: null,
            };
          });
          return true;
        },

        updateServer: (serverId: string, updates) => {
          set((state) => ({
            servers: state.servers.map((s) => (s.id === serverId ? { ...s, ...updates } : s)),
            auditLog: {
              ...state.auditLog,
              [serverId]: [
                {
                  id: `audit-${uuidv4()}`,
                  serverId,
                  action: 'server_update',
                  actorUserId: state.currentUser.id,
                  createdAt: new Date().toISOString(),
                } as AuditEntry,
                ...(state.auditLog[serverId] || []),
              ].slice(0, 300),
            },
          }));
          const latest = useStore.getState() as any;
          pushWorkspaceStateToBackend(latest);
        },

        createRole: (serverId, input) => {
          if (isDemoMode) return null;
          const roleId = `role-${uuidv4()}`;
          const trimmedName = input?.name?.trim();
          const roleName = trimmedName && trimmedName.length > 0 ? trimmedName : 'Nuevo rol';
          const roleColor = normalizeRoleColor(input?.color || '#B5BAC1');
          const rolePermissions = Array.from(
            new Set((input?.permissions && input.permissions.length > 0 ? input.permissions : ['READ_MESSAGES', 'SEND_MESSAGES']) as Permission[])
          );
          let created = false;

          set((state) => {
            const nextServers = state.servers.map((server) => {
              if (server.id !== serverId) return server;
              const permissionContextChannel = server.categories?.[0]?.channels?.[0];
              const canManageRoles =
                server.ownerId === state.currentUser.id ||
                hasPermission(server, permissionContextChannel, state.currentUser.id, 'MANAGE_ROLES') ||
                hasPermission(server, permissionContextChannel, state.currentUser.id, 'ADMINISTRATOR');
              if (!canManageRoles) return server;
              const nextPosition =
                server.roles.length > 0 ? Math.max(...server.roles.map((r) => r.position || 0)) + 1 : 0;
              const newRole: Role = {
                id: roleId,
                name: roleName,
                color: roleColor,
                nameEffect: input?.nameEffect || 'none',
                permissions: rolePermissions,
                position: nextPosition,
                hoist: input?.hoist ?? true,
                mentionable: input?.mentionable ?? true,
              };
              created = true;
              return { ...server, roles: [...server.roles, newRole] };
            });

            const nextAuditLog = created
              ? {
                ...state.auditLog,
                [serverId]: [
                  {
                    id: `audit-${uuidv4()}`,
                    serverId,
                    action: 'role_create',
                    actorUserId: state.currentUser.id,
                    roleId,
                    createdAt: new Date().toISOString(),
                  } as AuditEntry,
                  ...(state.auditLog[serverId] || []),
                ].slice(0, 300),
              }
              : state.auditLog;

            return {
              servers: nextServers,
              auditLog: nextAuditLog,
            };
          });

          if (created) {
            const latest = useStore.getState() as any;
            pushWorkspaceStateToBackend(latest);
          }
          return created ? roleId : null;
        },

        updateRole: (serverId, roleId, updates) => {
          if (isDemoMode) return;
          let updated = false;
          set((state) => {
            const nextServers = state.servers.map((server) => {
              if (server.id !== serverId) return server;
              const permissionContextChannel = server.categories?.[0]?.channels?.[0];
              const canManageRoles =
                server.ownerId === state.currentUser.id ||
                hasPermission(server, permissionContextChannel, state.currentUser.id, 'MANAGE_ROLES') ||
                hasPermission(server, permissionContextChannel, state.currentUser.id, 'ADMINISTRATOR');
              if (!canManageRoles) return server;
              return {
                ...server,
                roles: server.roles.map((role) => {
                  if (role.id !== roleId) return role;
                  updated = true;
                  const nextPermissions =
                    updates.permissions !== undefined
                      ? (Array.from(new Set(updates.permissions)) as Permission[])
                      : role.permissions;
                  const nextColor =
                    updates.color !== undefined
                      ? normalizeRoleColor(updates.color)
                      : role.color;
                  return {
                    ...role,
                    ...updates,
                    color: nextColor,
                    permissions: nextPermissions,
                  };
                }),
              };
            });

            const nextAuditLog = updated
              ? {
                ...state.auditLog,
                [serverId]: [
                  {
                    id: `audit-${uuidv4()}`,
                    serverId,
                    action: 'role_update',
                    actorUserId: state.currentUser.id,
                    roleId,
                    createdAt: new Date().toISOString(),
                  } as AuditEntry,
                  ...(state.auditLog[serverId] || []),
                ].slice(0, 300),
              }
              : state.auditLog;

            return {
              servers: nextServers,
              auditLog: nextAuditLog,
            };
          });
          if (updated) {
            const latest = useStore.getState() as any;
            pushWorkspaceStateToBackend(latest);
          }
        },

        deleteRole: (serverId, roleId) => {
          if (isDemoMode) return;
          let deleted = false;
          set((state) => {
            const nextServers = state.servers.map((server) => {
              if (server.id !== serverId) return server;
              const permissionContextChannel = server.categories?.[0]?.channels?.[0];
              const canManageRoles =
                server.ownerId === state.currentUser.id ||
                hasPermission(server, permissionContextChannel, state.currentUser.id, 'MANAGE_ROLES') ||
                hasPermission(server, permissionContextChannel, state.currentUser.id, 'ADMINISTRATOR');
              if (!canManageRoles) return server;
              const hadRole = server.roles.some((role) => role.id === roleId);
              deleted = deleted || hadRole;
              return {
                ...server,
                roles: server.roles.filter((role) => role.id !== roleId),
                members: server.members.map((member) => ({
                  ...member,
                  roleIds: member.roleIds.filter((id) => id !== roleId),
                })),
                categories: server.categories.map((category) => ({
                  ...category,
                  channels: category.channels.map((channel) => ({
                    ...channel,
                    permissionOverwrites: (channel.permissionOverwrites || []).filter(
                      (ow) => !(ow.type === 'role' && ow.id === roleId)
                    ),
                  })),
                })),
              };
            });

            const nextAuditLog = deleted
              ? {
                ...state.auditLog,
                [serverId]: [
                  {
                    id: `audit-${uuidv4()}`,
                    serverId,
                    action: 'role_delete',
                    actorUserId: state.currentUser.id,
                    roleId,
                    createdAt: new Date().toISOString(),
                  } as AuditEntry,
                  ...(state.auditLog[serverId] || []),
                ].slice(0, 300),
              }
              : state.auditLog;

            return {
              servers: nextServers,
              auditLog: nextAuditLog,
            };
          });
          if (deleted) {
            const latest = useStore.getState() as any;
            pushWorkspaceStateToBackend(latest);
          }
        },

        setMemberRole: (serverId, userId, roleId, enabled) => {
          if (isDemoMode) return;
          let changed = false;
          set((state) => {
            const nextServers = state.servers.map((server) => {
              if (server.id !== serverId) return server;
              const permissionContextChannel = server.categories?.[0]?.channels?.[0];
              const canManageRoles =
                server.ownerId === state.currentUser.id ||
                hasPermission(server, permissionContextChannel, state.currentUser.id, 'MANAGE_ROLES') ||
                hasPermission(server, permissionContextChannel, state.currentUser.id, 'ADMINISTRATOR');
              if (!canManageRoles) return server;
              if (userId === server.ownerId && state.currentUser.id !== server.ownerId) return server;
              return {
                ...server,
                members: server.members.map((member) => {
                  if (member.userId !== userId) return member;
                  const roleSet = new Set(member.roleIds || []);
                  const hadRole = roleSet.has(roleId);
                  if (enabled) roleSet.add(roleId);
                  else roleSet.delete(roleId);
                  changed = changed || hadRole !== enabled;
                  return {
                    ...member,
                    roleIds: Array.from(roleSet),
                  };
                }),
              };
            });

            const nextAuditLog = changed
              ? {
                ...state.auditLog,
                [serverId]: [
                  {
                    id: `audit-${uuidv4()}`,
                    serverId,
                    action: 'member_role_update',
                    actorUserId: state.currentUser.id,
                    targetUserId: userId,
                    roleId,
                    reason: enabled ? 'add' : 'remove',
                    createdAt: new Date().toISOString(),
                  } as AuditEntry,
                  ...(state.auditLog[serverId] || []),
                ].slice(0, 300),
              }
              : state.auditLog;

            return {
              servers: nextServers,
              auditLog: nextAuditLog,
            };
          });
          if (changed) {
            const latest = useStore.getState() as any;
            pushWorkspaceStateToBackend(latest);
          }
        },

        timeoutMember: (serverId, userId, minutes, reason) => {
          if (isDemoMode) return;
          const until = new Date(Date.now() + Math.max(1, minutes) * 60_000).toISOString();
          set((state) => ({
            memberTimeouts: { ...state.memberTimeouts, [`${serverId}:${userId}`]: until },
            auditLog: {
              ...state.auditLog,
              [serverId]: [
                {
                  id: `audit-${uuidv4()}`,
                  serverId,
                  action: 'member_timeout',
                  actorUserId: state.currentUser.id,
                  targetUserId: userId,
                  reason: reason?.trim() ? `${minutes}m // ${reason.trim()}` : `${minutes}m`,
                  createdAt: new Date().toISOString(),
                } as AuditEntry,
                ...(state.auditLog[serverId] || []),
              ].slice(0, 300),
            },
          }));
        },

        clearMemberTimeout: (serverId, userId) => {
          if (isDemoMode) return;
          set((state) => {
            const key = `${serverId}:${userId}`;
            const next = { ...state.memberTimeouts };
            delete next[key];
            return { memberTimeouts: next };
          });
          set((state) => ({
            auditLog: {
              ...state.auditLog,
              [serverId]: [
                {
                  id: `audit-${uuidv4()}`,
                  serverId,
                  action: 'member_untimeout',
                  actorUserId: state.currentUser.id,
                  targetUserId: userId,
                  createdAt: new Date().toISOString(),
                } as AuditEntry,
                ...(state.auditLog[serverId] || []),
              ].slice(0, 300),
            },
          }));
        },

        kickMember: (serverId, userId, reason) => {
          if (isDemoMode) return;
          set((state) => {
            const nextServers = state.servers.map((s) =>
              s.id === serverId
                ? { ...s, members: s.members.filter((m) => m.userId !== userId) }
                : s
            );
            const nextUsers = state.users.map((u) =>
              u.id === userId
                ? { ...u, serverIds: (u.serverIds || []).filter((id) => id !== serverId) }
                : u
            );
            saveUsersToStorage(nextUsers);

            const timeoutKey = `${serverId}:${userId}`;
            const nextTimeouts = { ...state.memberTimeouts };
            delete nextTimeouts[timeoutKey];

            const kickedCurrent = state.currentUser.id === userId;
            const nextActive = kickedCurrent
              ? computeActiveForUser(nextServers, state.currentUser.id, state.activeServerId)
              : { activeServerId: state.activeServerId, activeChannelId: state.activeChannelId };

            const currentUser = kickedCurrent
              ? {
                ...state.currentUser,
                serverIds: (state.currentUser.serverIds || []).filter((id) => id !== serverId),
              }
              : state.currentUser;

            return {
              servers: nextServers,
              users: nextUsers,
              currentUser,
              memberTimeouts: nextTimeouts,
              auditLog: {
                ...state.auditLog,
                [serverId]: [
                  {
                    id: `audit-${uuidv4()}`,
                    serverId,
                    action: 'member_kick',
                    actorUserId: state.currentUser.id,
                    targetUserId: userId,
                    reason: reason?.trim() || undefined,
                    createdAt: new Date().toISOString(),
                  } as AuditEntry,
                  ...(state.auditLog[serverId] || []),
                ].slice(0, 300),
              },
              activeServerId: nextActive.activeServerId,
              activeChannelId: nextActive.activeChannelId,
            };
          });
        },

        banMember: (serverId, userId, reason) => {
          if (isDemoMode) return;
          set((state) => {
            const exists = (state.serverBans[serverId] || []).some((b) => b.userId === userId);
            const nextBans = exists
              ? state.serverBans
              : {
                ...state.serverBans,
                [serverId]: [
                  ...(state.serverBans[serverId] || []),
                  {
                    userId,
                    reason,
                    bannedAt: new Date().toISOString(),
                    bannedBy: state.currentUser.id,
                  },
                ],
              };

            const nextServers = state.servers.map((s) =>
              s.id === serverId
                ? { ...s, members: s.members.filter((m) => m.userId !== userId) }
                : s
            );
            const nextUsers = state.users.map((u) =>
              u.id === userId
                ? { ...u, serverIds: (u.serverIds || []).filter((id) => id !== serverId) }
                : u
            );
            saveUsersToStorage(nextUsers);

            const timeoutKey = `${serverId}:${userId}`;
            const nextTimeouts = { ...state.memberTimeouts };
            delete nextTimeouts[timeoutKey];

            const bannedCurrent = state.currentUser.id === userId;
            const nextActive = bannedCurrent
              ? computeActiveForUser(nextServers, state.currentUser.id, state.activeServerId)
              : { activeServerId: state.activeServerId, activeChannelId: state.activeChannelId };

            const currentUser = bannedCurrent
              ? {
                ...state.currentUser,
                serverIds: (state.currentUser.serverIds || []).filter((id) => id !== serverId),
              }
              : state.currentUser;

            return {
              servers: nextServers,
              users: nextUsers,
              currentUser,
              serverBans: nextBans,
              memberTimeouts: nextTimeouts,
              auditLog: {
                ...state.auditLog,
                [serverId]: [
                  {
                    id: `audit-${uuidv4()}`,
                    serverId,
                    action: 'member_ban',
                    actorUserId: state.currentUser.id,
                    targetUserId: userId,
                    reason,
                    createdAt: new Date().toISOString(),
                  } as AuditEntry,
                  ...(state.auditLog[serverId] || []),
                ].slice(0, 300),
              },
              activeServerId: nextActive.activeServerId,
              activeChannelId: nextActive.activeChannelId,
            };
          });
        },

        unbanMember: (serverId, userId) => {
          if (isDemoMode) return;
          set((state) => ({
            serverBans: {
              ...state.serverBans,
              [serverId]: (state.serverBans[serverId] || []).filter((b) => b.userId !== userId),
            },
            auditLog: {
              ...state.auditLog,
              [serverId]: [
                {
                  id: `audit-${uuidv4()}`,
                  serverId,
                  action: 'member_unban',
                  actorUserId: state.currentUser.id,
                  targetUserId: userId,
                  createdAt: new Date().toISOString(),
                } as AuditEntry,
                ...(state.auditLog[serverId] || []),
              ].slice(0, 300),
            },
          }));
        },

        updateChannelRolePermission: (serverId, channelId, roleId, permission, allowed) => {
          if (isDemoMode) return;
          let nextPermissionOverwrites: Channel['permissionOverwrites'] | null = null;
          set((state) => {
            let mutated = false;
            const nextServers = state.servers.map((server) => {
              if (server.id !== serverId) return server;
              const permissionContextChannel =
                server.categories.flatMap((cat) => cat.channels).find((channel) => channel.id === channelId) ||
                server.categories?.[0]?.channels?.[0];
              const canManageOverwrites =
                server.ownerId === state.currentUser.id ||
                hasPermission(server, permissionContextChannel, state.currentUser.id, 'MANAGE_ROLES') ||
                hasPermission(server, permissionContextChannel, state.currentUser.id, 'MANAGE_CHANNELS') ||
                hasPermission(server, permissionContextChannel, state.currentUser.id, 'ADMINISTRATOR');
              if (!canManageOverwrites) return server;
              return {
                ...server,
                categories: server.categories.map((cat) => ({
                  ...cat,
                  channels: cat.channels.map((channel) => {
                    if (channel.id !== channelId) return channel;
                    const current = channel.permissionOverwrites || [];
                    const idx = current.findIndex((ow) => ow.type === 'role' && ow.id === roleId);
                    const next = current.slice();
                    if (idx === -1) {
                      next.push({
                        id: roleId,
                        type: 'role',
                        allow: allowed ? [permission] : [],
                        deny: allowed ? [] : [permission],
                      });
                    } else {
                      const ow = next[idx];
                      const allowSet = new Set(ow.allow);
                      const denySet = new Set(ow.deny);
                      if (allowed) {
                        allowSet.add(permission);
                        denySet.delete(permission);
                      } else {
                        denySet.add(permission);
                        allowSet.delete(permission);
                      }
                      next[idx] = {
                        ...ow,
                        allow: Array.from(allowSet),
                        deny: Array.from(denySet),
                      };
                    }
                    mutated = true;
                    nextPermissionOverwrites = next;
                    return { ...channel, permissionOverwrites: next };
                  }),
                })),
              };
            });
            return {
              servers: nextServers,
              auditLog: mutated
                ? {
                  ...state.auditLog,
                  [serverId]: [
                    {
                      id: `audit-${uuidv4()}`,
                      serverId,
                      action: 'channel_permission_update',
                      actorUserId: state.currentUser.id,
                      channelId,
                      roleId,
                      permission,
                      allowed,
                      createdAt: new Date().toISOString(),
                    } as AuditEntry,
                    ...(state.auditLog[serverId] || []),
                  ].slice(0, 300),
                }
                : state.auditLog,
            };
          });
          if (!nextPermissionOverwrites) return;
          eventBus.emit('CHANNEL_UPDATED', {
            serverId,
            channelId,
            updates: { permissionOverwrites: nextPermissionOverwrites },
          });
          const state = useStore.getState();
          if (isBackendEnabled && state.backendToken) {
            const socket = getSocket(state.backendToken);
            try {
              socket?.connect();
              socket?.emit('channel:update', {
                serverId,
                channelId,
                updates: { permissionOverwrites: nextPermissionOverwrites },
              });
            } catch { }
          }
        },

        updateChannelMemberPermission: (serverId, channelId, userId, permission, allowed) => {
          if (isDemoMode) return;
          let nextPermissionOverwrites: Channel['permissionOverwrites'] | null = null;
          set((state) => {
            let mutated = false;
            const nextServers = state.servers.map((server) => {
              if (server.id !== serverId) return server;
              const permissionContextChannel =
                server.categories.flatMap((cat) => cat.channels).find((channel) => channel.id === channelId) ||
                server.categories?.[0]?.channels?.[0];
              const canManageOverwrites =
                server.ownerId === state.currentUser.id ||
                hasPermission(server, permissionContextChannel, state.currentUser.id, 'MANAGE_ROLES') ||
                hasPermission(server, permissionContextChannel, state.currentUser.id, 'MANAGE_CHANNELS') ||
                hasPermission(server, permissionContextChannel, state.currentUser.id, 'ADMINISTRATOR');
              if (!canManageOverwrites) return server;
              return {
                ...server,
                categories: server.categories.map((cat) => ({
                  ...cat,
                  channels: cat.channels.map((channel) => {
                    if (channel.id !== channelId) return channel;
                    const current = channel.permissionOverwrites || [];
                    const idx = current.findIndex((ow) => ow.type === 'member' && ow.id === userId);
                    const next = current.slice();
                    if (idx === -1) {
                      next.push({
                        id: userId,
                        type: 'member',
                        allow: allowed ? [permission] : [],
                        deny: allowed ? [] : [permission],
                      });
                    } else {
                      const ow = next[idx];
                      const allowSet = new Set(ow.allow);
                      const denySet = new Set(ow.deny);
                      if (allowed) {
                        allowSet.add(permission);
                        denySet.delete(permission);
                      } else {
                        denySet.add(permission);
                        allowSet.delete(permission);
                      }
                      next[idx] = {
                        ...ow,
                        allow: Array.from(allowSet),
                        deny: Array.from(denySet),
                      };
                    }
                    mutated = true;
                    nextPermissionOverwrites = next;
                    return { ...channel, permissionOverwrites: next };
                  }),
                })),
              };
            });
            return {
              servers: nextServers,
              auditLog: mutated
                ? {
                  ...state.auditLog,
                  [serverId]: [
                    {
                      id: `audit-${uuidv4()}`,
                      serverId,
                      action: 'channel_permission_update',
                      actorUserId: state.currentUser.id,
                      targetUserId: userId,
                      channelId,
                      permission,
                      allowed,
                      createdAt: new Date().toISOString(),
                    } as AuditEntry,
                    ...(state.auditLog[serverId] || []),
                  ].slice(0, 300),
                }
                : state.auditLog,
            };
          });
          if (!nextPermissionOverwrites) return;
          eventBus.emit('CHANNEL_UPDATED', {
            serverId,
            channelId,
            updates: { permissionOverwrites: nextPermissionOverwrites },
          });
          const state = useStore.getState();
          if (isBackendEnabled && state.backendToken) {
            const socket = getSocket(state.backendToken);
            try {
              socket?.connect();
              socket?.emit('channel:update', {
                serverId,
                channelId,
                updates: { permissionOverwrites: nextPermissionOverwrites },
              });
            } catch { }
          }
        },
      };
    },
    {
      name: 'diavlocord-storage',
      storage: createJSONStorage(() => createSafeZustandStorage()),
      version: 2,
      migrate: (persistedState: any) => {
        if (!persistedState || typeof persistedState !== 'object') return persistedState;
        const state = { ...persistedState } as any;
        state.currentUser = state.currentUser
          ? sanitizeUserForPersist(state.currentUser as User)
          : seedData.currentUser;
        state.servers = sanitizeServersForPersist(Array.isArray(state.servers) ? state.servers : []);
        state.messages = sanitizeMessagesMapForPersist(
          state.messages && typeof state.messages === 'object' ? state.messages : {}
        );
        state.threadMessages = sanitizeThreadMessagesMapForPersist(
          state.threadMessages && typeof state.threadMessages === 'object' ? state.threadMessages : {}
        );
        state.auditLog = sanitizeAuditLogForPersist(
          state.auditLog && typeof state.auditLog === 'object' ? state.auditLog : {}
        );
        state.dmGroups = sanitizeDmGroupsForPersist(Array.isArray(state.dmGroups) ? state.dmGroups : []);
        const validDmIds = new Set(state.dmGroups.map((group: DMGroup) => group.id));
        state.pinnedDmIds = Array.isArray(state.pinnedDmIds)
          ? state.pinnedDmIds.filter((id: string) => validDmIds.has(id)).slice(0, MAX_PERSISTED_PINNED_DM_IDS)
          : [];
        state.dmRequestsIncoming = sanitizeDmRequestsForPersist(Array.isArray(state.dmRequestsIncoming) ? state.dmRequestsIncoming : []);
        state.dmRequestsOutgoing = sanitizeDmRequestsForPersist(Array.isArray(state.dmRequestsOutgoing) ? state.dmRequestsOutgoing : []);
        return state;
      },
      partialize: (state) => {
        const backendSessionActive = Boolean(isBackendEnabled && state.backendToken);
        const persistWorkspaceSnapshot = !backendSessionActive;
        const persistDmSnapshot = !backendSessionActive;
        const safeDmGroups = persistDmSnapshot ? sanitizeDmGroupsForPersist(state.dmGroups) : [];
        const safeDmIdSet = new Set(safeDmGroups.map((group) => group.id));
        return {
          currentUser: backendSessionActive
            ? sanitizeUserForEmergencyPersist(state.currentUser)
            : sanitizeUserForPersist(state.currentUser),
          backendToken: state.backendToken,
          language: state.language,
          developerMode: state.developerMode,
          notificationSettings: state.notificationSettings,
          contentSocial: state.contentSocial,
          privacy: state.privacy,
          mediaSettings: state.mediaSettings,
          servers: persistWorkspaceSnapshot ? sanitizeServersForPersist(state.servers) : [],
          messages: persistWorkspaceSnapshot ? sanitizeMessagesMapForPersist(state.messages) : {},
          presences: {},
          activeServerId: persistWorkspaceSnapshot ? state.activeServerId : null,
          activeChannelId: persistWorkspaceSnapshot ? state.activeChannelId : null,
          memberTimeouts: persistWorkspaceSnapshot ? state.memberTimeouts : {},
          serverBans: persistWorkspaceSnapshot ? state.serverBans : {},
          auditLog: persistWorkspaceSnapshot ? sanitizeAuditLogForPersist(state.auditLog) : {},
          threads: persistWorkspaceSnapshot ? state.threads : {},
          threadMessages: persistWorkspaceSnapshot ? sanitizeThreadMessagesMapForPersist(state.threadMessages) : {},
          activeThreadId: persistWorkspaceSnapshot ? state.activeThreadId : null,
          dmGroups: safeDmGroups,
          pinnedDmIds: persistDmSnapshot
            ? state.pinnedDmIds.filter((id) => safeDmIdSet.has(id)).slice(0, MAX_PERSISTED_PINNED_DM_IDS)
            : [],
          dmRequestsIncoming: persistDmSnapshot
            ? sanitizeDmRequestsForPersist(state.dmRequestsIncoming)
            : [],
          dmRequestsOutgoing: persistDmSnapshot
            ? sanitizeDmRequestsForPersist(state.dmRequestsOutgoing)
            : [],
          rightSidebarOpen: state.rightSidebarOpen,
          rightSidebarView: state.rightSidebarView,
          activeDeviceId: state.activeDeviceId,
          deviceSessionsByUser: sanitizeDeviceSessionsForPersist(state.deviceSessionsByUser, state.currentUser.id)
        };
      },
      onRehydrateStorage: () => {
        return (state) => {
          if (state) {
            state.servers = ensureOwnersHaveAdminRole(Array.isArray(state.servers) ? state.servers : []);
            if (state.activeServerId === null) {
              const persistedDmId =
                typeof state.activeChannelId === 'string' &&
                  Array.isArray(state.dmGroups) &&
                  state.dmGroups.some((group: any) => group?.id === state.activeChannelId)
                  ? state.activeChannelId
                  : null;
              state.activeChannelId = persistedDmId;
            } else {
              const nextActive = computeActiveForUser(state.servers, state.currentUser.id, state.activeServerId);
              state.activeServerId = nextActive.activeServerId;
              state.activeChannelId = nextActive.activeChannelId;
            }
            state.rightSidebarOpen =
              typeof state.rightSidebarOpen === 'boolean' ? state.rightSidebarOpen : true;
            state.rightSidebarView =
              state.rightSidebarView === 'details' || state.rightSidebarView === 'members'
                ? state.rightSidebarView
                : 'members';
            const deviceId = state.activeDeviceId || getBrowserDeviceId();
            state.activeDeviceId = deviceId;
            state.deviceSessionsByUser = upsertDeviceSessionMap(
              state.deviceSessionsByUser || {},
              state.currentUser.id,
              deviceId
            );
            const persistedMedia = state.mediaSettings || ({} as Partial<MediaSettings>);
            state.mediaSettings = {
              inputDeviceId: persistedMedia.inputDeviceId ?? null,
              outputDeviceId: persistedMedia.outputDeviceId ?? null,
              cameraDeviceId: persistedMedia.cameraDeviceId ?? null,
              microphoneVolume:
                typeof persistedMedia.microphoneVolume === 'number' ? persistedMedia.microphoneVolume : 1,
              speakerVolume:
                typeof persistedMedia.speakerVolume === 'number' ? persistedMedia.speakerVolume : 0.6,
              alwaysPreviewVideo: Boolean(persistedMedia.alwaysPreviewVideo),
              voiceQuality:
                persistedMedia.voiceQuality === 'balanced' ||
                  persistedMedia.voiceQuality === 'clarity' ||
                  persistedMedia.voiceQuality === 'extreme'
                  ? persistedMedia.voiceQuality
                  : 'clarity',
            };
            // Backend is source of truth for DM/pending requests.
            // Avoid carrying stale per-account data across persisted sessions.
            if (isBackendEnabled) {
              state.dmGroups = [];
              state.pinnedDmIds = [];
              state.dmRequestsIncoming = [];
              state.dmRequestsOutgoing = [];
            } else {
              // In demo mode, ensure demo DM conversations are always present
              if (isDemoMode) {
                const currentIds = new Set((state.dmGroups || []).map((g: any) => g?.id));
                for (const demoGroup of demoData.dmGroups) {
                  if (!currentIds.has(demoGroup.id)) {
                    state.dmGroups = [...(state.dmGroups || []), demoGroup];
                  }
                }
                // Merge demo DM messages that are missing
                for (const [convId, msgs] of Object.entries(demoData.dmMessages)) {
                  if (!state.messages[convId] || state.messages[convId].length === 0) {
                    state.messages[convId] = msgs as any;
                  }
                }
              }
              const validDmIds = new Set((state.dmGroups || []).map((group: any) => group?.id));
              state.pinnedDmIds = Array.isArray((state as any).pinnedDmIds)
                ? (state.pinnedDmIds || []).filter((id) => validDmIds.has(id))
                : [];
            }
          }
        };
      }
    }
  )
);
