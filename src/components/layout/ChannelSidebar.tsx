import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../lib/store';
import { ChevronDown, Hash, Volume2, Settings, Mic, Headphones, Plus, Users, Sparkles, Command, Zap, X, Search, UserPlus, Copy, Check, Pin, CheckCheck, ChevronsUpDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { CreateChannelModal } from '../modals/CreateChannelModal';
import { ProfilePreviewModal } from '../modals/ProfilePreviewModal';
import { ServerOptionsModal } from '../modals/ServerOptionsModal';
import { ChannelSettingsModal } from '../modals/ChannelSettingsModal';
import { createPortal } from 'react-dom';
import { NitroModal } from '../modals/NitroModal';
import { NitroEmblems } from '../ui/NitroEmblems';
import { CrewBadge } from '../ui/CrewBadge';
import { t } from '../../lib/i18n';
import { User, UserStatus } from '../../lib/types';
import { isBackendEnabled } from '../../lib/env';
import { mapBackendUser } from '../../lib/backend-user';
import { dataProvider } from '../../lib/providers/data-provider';
import { eventBus } from '../../lib/event-bus';
import { getSocket } from '../../services/socket-client';

const normalizeSearchText = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

const compactSearchText = (value: string) => normalizeSearchText(value).replace(/[^a-z0-9#]/g, '');

const isSubsequence = (needle: string, haystack: string): boolean => {
  if (!needle) return true;
  let i = 0;
  for (let j = 0; j < haystack.length; j += 1) {
    if (haystack[j] === needle[i]) i += 1;
    if (i === needle.length) return true;
  }
  return false;
};

const levenshteinDistance = (a: string, b: string): number => {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, idx) => idx);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const temp = prev[j];
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diagonal + substitutionCost);
      diagonal = temp;
    }
  }
  return prev[b.length];
};

const scoreCandidate = (query: string, candidateRaw: string): number => {
  const candidate = compactSearchText(candidateRaw);
  if (!query || !candidate) return 0;
  if (candidate === query) return 130;
  if (candidate.startsWith(query)) return 112;

  const at = candidate.indexOf(query);
  if (at >= 0) return 96 - Math.min(30, at);

  if (isSubsequence(query, candidate)) {
    return 72 - Math.min(20, candidate.length - query.length);
  }

  if (query.length >= 4) {
    const nearest = candidate.slice(0, Math.max(query.length + 2, 6));
    const dist = levenshteinDistance(query, nearest);
    if (dist <= 2) return 54 - dist * 12;
  }

  return 0;
};

const scoreUserSearch = (user: User, query: string): number => {
  const username = user.username || '';
  const displayName = user.displayName || '';
  const discriminator = String(user.discriminator || '');
  const fullTag = `${username}#${discriminator}`;
  const compactTag = `${username}${discriminator}`;
  const id = user.id || '';

  return Math.max(
    scoreCandidate(query, username) + 18,
    scoreCandidate(query, displayName) + 10,
    scoreCandidate(query, fullTag) + 14,
    scoreCandidate(query, compactTag) + 12,
    scoreCandidate(query, id)
  );
};

const LEGACY_DEMO_USER_SIGNATURES = new Set([
  '1:andri:0001',
  '2:nelly:1337',
  '3:cyborgbot:9999',
  '4:ghosty:6666',
]);

const isLegacyDemoUser = (user: User): boolean => {
  const key = `${String(user.id)}:${String(user.username || '').toLowerCase()}:${String(user.discriminator || '')}`;
  return LEGACY_DEMO_USER_SIGNATURES.has(key);
};

const getEffectiveBackendToken = (storeToken: string | null | undefined): string | null => {
  if (storeToken) return storeToken;
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem('diavlocord-backend-token');
  } catch {
    return null;
  }
};

const CHANNEL_READ_TRACKER_KEY = 'diavlocord-read-tracker-v2';
const CATEGORY_COLLAPSE_STORAGE_KEY = 'diavlocord-category-collapse-v1';
const DIRECTORY_USERS_CACHE_TTL_MS = 90_000;
const DIRECTORY_SEARCH_CACHE_TTL_MS = 30_000;

const toTimestamp = (value: unknown): number => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value !== 'string') return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

const loadReadTracker = (): Record<string, number> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(CHANNEL_READ_TRACKER_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const safe: Record<string, number> = {};
    for (const [channelId, ts] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof channelId !== 'string' || !channelId) continue;
      const numeric = typeof ts === 'number' ? ts : Number(ts);
      if (!Number.isFinite(numeric) || numeric <= 0) continue;
      safe[channelId] = numeric;
    }
    return safe;
  } catch {
    return {};
  }
};

const getCategoryCollapseKey = (serverId: string | null, categoryId: string): string =>
  `${serverId || 'no-server'}:${categoryId}`;

const loadCategoryCollapseState = (): Record<string, boolean> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(CATEGORY_COLLAPSE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const safe: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!key || typeof key !== 'string') continue;
      if (typeof value !== 'boolean') continue;
      safe[key] = value;
    }
    return safe;
  } catch {
    return {};
  }
};

export const ChannelSidebar = ({ onOpenSettings }: { onOpenSettings: (tab: 'profile' | 'server') => void }) => {
  const { servers, activeServerId, activeChannelId, setActiveChannel, setActiveServer, currentUser, createChannel, dmGroups, pinnedDmIds, togglePinnedDM, createDM, removeDM, messages, users, presences, voice, voiceMember, setPresence, updateCurrentUser, dmRequestsIncoming, dmRequestsOutgoing, acceptDMRequest, rejectDMRequest, cancelDMRequest, sendDMRequest, language, developerMode, backendToken, upsertUsers } = useStore();
  const [isCategoryCollapsed, setCategoryCollapsed] = useState<Record<string, boolean>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [createCategoryId, setCreateCategoryId] = useState<string | null>(null);
  const [profilePreviewOpen, setProfilePreviewOpen] = useState(false);
  const [serverOptionsOpen, setServerOptionsOpen] = useState(false);
  const [nitroOpen, setNitroOpen] = useState(false);
  const [nitroActive, setNitroActive] = useState(false);
  const [addDmOpen, setAddDmOpen] = useState(false);
  const [addDmQuery, setAddDmQuery] = useState('');
  const [addDmError, setAddDmError] = useState('');
  const [showUserList, setShowUserList] = useState(false);
  const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const [offerDismissed, setOfferDismissed] = useState(false);
  const [toast, setToast] = useState<string>('');
  const [copiedUserId, setCopiedUserId] = useState<string | null>(null);
  const [channelContextMenu, setChannelContextMenu] = useState<{ channelId: string; x: number; y: number } | null>(null);
  const [copiedChannelId, setCopiedChannelId] = useState<string | null>(null);
  const [channelSettingsOpen, setChannelSettingsOpen] = useState(false);
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
  const [incomingPopupId, setIncomingPopupId] = useState<string | null>(null);
  const [domReady, setDomReady] = useState(false);
  const [searchIndicator, setSearchIndicator] = useState<'searching' | 'success' | 'empty' | null>(null);
  const [searchKeyboardIndex, setSearchKeyboardIndex] = useState(0);
  const [friendFilter, setFriendFilter] = useState<'all' | 'pinned' | 'online' | 'idle' | 'dnd' | 'offline'>('all');
  const [friendSearchQuery, setFriendSearchQuery] = useState('');
  const [friendsPopupOpen, setFriendsPopupOpen] = useState(false);
  const [friendsKeyboardIndex, setFriendsKeyboardIndex] = useState(0);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [channelReadTracker, setChannelReadTracker] = useState<Record<string, number>>({});
  const readTrackerPersistRef = useRef<{ timer: number | null; lastSerialized: string }>({
    timer: null,
    lastSerialized: '',
  });
  const collapsePersistRef = useRef<{ timer: number | null; lastSerialized: string }>({
    timer: null,
    lastSerialized: '',
  });
  const directoryUsersRef = useRef<{
    token: string | null;
    fetchedAt: number;
    cachedUsers: User[];
    inFlight: Promise<User[]> | null;
  }>({
    token: null,
    fetchedAt: 0,
    cachedUsers: [],
    inFlight: null,
  });
  const directorySearchCacheRef = useRef<Map<string, { at: number; users: User[] }>>(new Map());
  const channelButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [focusedChannelNavId, setFocusedChannelNavId] = useState<string | null>(null);

  const activeServer = servers.find(s => s.id === activeServerId);
  const dmHomeLabel = language === 'es' ? 'Inicio DM' : 'DM Home';
  const visibleChannelIds = useMemo(() => {
    if (!activeServer) return [];
    return activeServer.categories.flatMap((category) => {
      const categoryCollapseKey = getCategoryCollapseKey(activeServer.id, category.id);
      if (isCategoryCollapsed[categoryCollapseKey]) return [];
      return category.channels.map((channel) => channel.id);
    });
  }, [activeServer, isCategoryCollapsed]);

  useEffect(() => {
    if (activeChannelId && visibleChannelIds.includes(activeChannelId)) {
      setFocusedChannelNavId(activeChannelId);
      return;
    }
    if (!focusedChannelNavId || !visibleChannelIds.includes(focusedChannelNavId)) {
      setFocusedChannelNavId(visibleChannelIds[0] || null);
    }
  }, [activeChannelId, visibleChannelIds, focusedChannelNavId]);

  const focusChannelByIndex = (index: number) => {
    if (visibleChannelIds.length === 0) return;
    const bounded = Math.max(0, Math.min(visibleChannelIds.length - 1, index));
    const nextId = visibleChannelIds[bounded];
    if (!nextId) return;
    channelButtonRefs.current[nextId]?.focus();
    setFocusedChannelNavId(nextId);
  };

  const handleChannelNavKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, channelId: string) => {
    const currentIndex = visibleChannelIds.indexOf(channelId);
    if (currentIndex < 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusChannelByIndex(currentIndex + 1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusChannelByIndex(currentIndex - 1);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      focusChannelByIndex(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      focusChannelByIndex(visibleChannelIds.length - 1);
    }
  };

  const getUserLabel = (user: User | undefined | null, fallback: string) => {
    const display = user?.displayName?.trim();
    if (display) return display;
    const username = user?.username?.trim();
    if (username) return username;
    return fallback;
  };

  const preloadDirectoryUsers = useCallback(
    async (token: string, force = false): Promise<User[]> => {
      if (!token) return [];
      const cache = directoryUsersRef.current;
      const now = Date.now();

      if (!force && cache.token === token && now - cache.fetchedAt < DIRECTORY_USERS_CACHE_TTL_MS) {
        return cache.cachedUsers;
      }

      if (cache.inFlight && cache.token === token) {
        return cache.inFlight;
      }

      cache.token = token;
      const request = (async () => {
        try {
          const res = await dataProvider.bootstrap(token, {
            includeUsers: true,
            includeMessages: false,
          });
          if (!res.ok) return [];
          const data = await res.json().catch(() => ({}));
          const fetchedUsers = Array.isArray((data as any).users)
            ? ((data as any).users as any[]).map((u) => mapBackendUser(u))
            : [];
          if (fetchedUsers.length > 0) {
            upsertUsers(fetchedUsers);
          }
          cache.cachedUsers = fetchedUsers;
          cache.fetchedAt = Date.now();
          return fetchedUsers;
        } catch {
          return [];
        }
      })();

      cache.inFlight = request;
      const usersResult = await request;
      if (cache.inFlight === request) {
        cache.inFlight = null;
      }
      return usersResult;
    },
    [upsertUsers]
  );

  const getDmPeer = (group: { memberIds: string[] }) => {
    const currentUserId = String(currentUser.id);
    const peerId =
      group.memberIds.find((id) => String(id) !== currentUserId) ||
      group.memberIds[0] ||
      null;
    if (!peerId) return null;
    const normalizedPeerId = String(peerId);
    return users.find((u) => String(u.id) === normalizedPeerId) || null;
  };

  const getDmLabel = (group: { id: string; name?: string; memberIds: string[] }) => {
    const peer = getDmPeer(group);
    if (peer) return getUserLabel(peer, peer.id);
    const named = group.name?.trim();
    if (named) return named;
    return `Uplink-${group.id.slice(-4)}`;
  };

  const getResolvedStatus = (userId: string, fallback?: UserStatus): UserStatus => {
    const directPresence = presences[userId]?.status;
    if (directPresence) return directPresence;
    const user = users.find((u) => u.id === userId);
    return (user?.status || fallback || 'offline') as UserStatus;
  };

  const getVoiceChannelParticipants = (channelId: string) => {
    const connectedIds = Array.from(new Set(voice[channelId]?.connectedUserIds || []));
    return connectedIds
      .map((userId) => {
        const user = userId === currentUser.id ? currentUser : users.find((entry) => entry.id === userId);
        if (!user) return null;
        const memberState = voiceMember[userId] || { muted: false, deafened: false };
        return {
          user,
          status: getResolvedStatus(userId, user.status || 'offline'),
          muted: memberState.muted,
          deafened: memberState.deafened,
        };
      })
      .filter((entry): entry is { user: User; status: UserStatus; muted: boolean; deafened: boolean } => Boolean(entry))
      .sort((a, b) => getUserLabel(a.user, a.user.id).localeCompare(getUserLabel(b.user, b.user.id)));
  };

  const statusInfo: Record<UserStatus, { label: string; dot: string }> = {
    online: { label: t(language, 'status_online'), dot: 'bg-neon-green' },
    idle: { label: t(language, 'status_idle'), dot: 'bg-neon-blue' },
    dnd: { label: t(language, 'status_dnd'), dot: 'bg-neon-pink' },
    offline: { label: t(language, 'status_offline'), dot: 'bg-[#4E5058]' },
  };

  const statusOrder: Record<UserStatus, number> = { online: 0, idle: 1, dnd: 2, offline: 3 };
  const myStatus = getResolvedStatus(currentUser.id, currentUser.status || 'online');

  const pinnedDmSet = useMemo(() => new Set(pinnedDmIds), [pinnedDmIds]);

  const friendEntries = dmGroups
    .map((group) => {
      const peer = getDmPeer(group);
      if (!peer) return null;
      const lastMessage = (messages[group.id] || []).at(-1);
      const lastActivityTs = lastMessage ? new Date(lastMessage.timestamp).getTime() : 0;
      return {
        dmId: group.id,
        user: peer,
        status: getResolvedStatus(peer.id, peer.status || 'offline'),
        isPinned: pinnedDmSet.has(group.id),
        lastActivityTs: Number.isFinite(lastActivityTs) ? lastActivityTs : 0,
      };
    })
    .filter((entry): entry is { dmId: string; user: User; status: UserStatus; isPinned: boolean; lastActivityTs: number } => Boolean(entry))
    .sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      return (b.lastActivityTs || 0) - (a.lastActivityTs || 0);
    });

  const friendById = new Map<string, { dmId: string; user: User; status: UserStatus; isPinned: boolean; lastActivityTs: number }>();
  for (const entry of friendEntries) {
    if (!friendById.has(entry.user.id)) {
      friendById.set(entry.user.id, entry);
    }
  }

  const normalizedFriendQuery = normalizeSearchText(friendSearchQuery);
  const filteredFriends = Array.from(friendById.values())
    .filter((entry) => {
      if (friendFilter === 'all') return true;
      if (friendFilter === 'pinned') return entry.isPinned;
      return entry.status === friendFilter;
    })
    .filter((entry) => {
      if (!normalizedFriendQuery) return true;
      const haystack = normalizeSearchText(
        `${getUserLabel(entry.user, entry.user.id)} ${entry.user.username || ''} ${entry.user.discriminator || ''}`
      );
      return haystack.includes(normalizedFriendQuery);
    })
    .sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      const byStatus = statusOrder[a.status] - statusOrder[b.status];
      if (byStatus !== 0) return byStatus;
      const byRecent = (b.lastActivityTs || 0) - (a.lastActivityTs || 0);
      if (byRecent !== 0) return byRecent;
      return getUserLabel(a.user, a.user.id).localeCompare(getUserLabel(b.user, b.user.id));
    });

  const unreadByChannel = useMemo(() => {
    const mentionTokens = [
      `@${(currentUser.username || '').toLowerCase()}`,
      `<@${String(currentUser.id).toLowerCase()}>`,
    ];
    const counters = new Map<string, { unread: number; mentions: number }>();
    for (const [channelId, channelMessages] of Object.entries(messages || {})) {
      if (!Array.isArray(channelMessages) || channelMessages.length === 0) continue;
      const readTs = channelReadTracker[channelId] || 0;
      let unread = 0;
      let mentions = 0;
      for (const message of channelMessages) {
        if (!message || message.authorId === currentUser.id) continue;
        const messageTs = toTimestamp(message.timestamp);
        if (messageTs <= readTs) continue;
        unread += 1;
        const content = String(message.content || '').toLowerCase();
        if (content && mentionTokens.some((token) => token && content.includes(token))) {
          mentions += 1;
        }
      }
      if (unread > 0) {
        counters.set(channelId, { unread, mentions });
      }
    }
    return counters;
  }, [messages, channelReadTracker, currentUser.id, currentUser.username]);

  const totalUnreadCount = useMemo(
    () =>
      Array.from(unreadByChannel.values()).reduce((sum, item) => {
        return sum + item.unread;
      }, 0),
    [unreadByChannel]
  );

  const topUnreadChannelId = useMemo(() => {
    let bestId: string | null = null;
    let bestScore = 0;
    for (const [channelId, stat] of Array.from(unreadByChannel.entries())) {
      const score = stat.unread + stat.mentions * 5;
      if (score > bestScore) {
        bestScore = score;
        bestId = channelId;
      }
    }
    return bestId;
  }, [unreadByChannel]);

  const topUnreadServerChannel = useMemo(() => {
    if (!activeServer) return { channelId: null as string | null, total: 0 };
    const serverChannelIds = new Set(
      activeServer.categories.flatMap((category) => category.channels.map((channel) => channel.id))
    );
    let bestId: string | null = null;
    let bestScore = 0;
    let total = 0;
    for (const [channelId, stat] of Array.from(unreadByChannel.entries())) {
      if (!serverChannelIds.has(channelId)) continue;
      total += stat.unread;
      const score = stat.unread + stat.mentions * 5;
      if (score > bestScore) {
        bestScore = score;
        bestId = channelId;
      }
    }
    return { channelId: bestId, total };
  }, [activeServer, unreadByChannel]);

  const categoryUnreadStats = useMemo(() => {
    const stats: Record<string, { unread: number; mentions: number }> = {};
    if (!activeServer) return stats;
    for (const category of activeServer.categories) {
      let unread = 0;
      let mentions = 0;
      for (const channel of category.channels) {
        const channelUnread = unreadByChannel.get(channel.id);
        if (!channelUnread) continue;
        unread += channelUnread.unread;
        mentions += channelUnread.mentions;
      }
      stats[category.id] = { unread, mentions };
    }
    return stats;
  }, [activeServer, unreadByChannel]);

  const toggleAllCategoryCollapse = useCallback(() => {
    if (!activeServer) return;
    const categoryKeys = activeServer.categories.map((category) =>
      getCategoryCollapseKey(activeServer.id, category.id)
    );
    if (categoryKeys.length === 0) return;
    const shouldCollapse = categoryKeys.some((key) => !isCategoryCollapsed[key]);
    setCategoryCollapsed((prev) => {
      const next = { ...prev };
      for (const key of categoryKeys) {
        next[key] = shouldCollapse;
      }
      return next;
    });
    setToast(
      shouldCollapse
        ? language === 'es'
          ? 'Categorias colapsadas'
          : 'Categories collapsed'
        : language === 'es'
          ? 'Categorias expandidas'
          : 'Categories expanded'
    );
  }, [activeServer, isCategoryCollapsed, language]);

  const markActiveServerAsRead = useCallback(() => {
    if (!activeServer) return;
    const updates: Record<string, number> = {};
    let touched = 0;
    for (const category of activeServer.categories) {
      for (const channel of category.channels) {
        const channelMessages = messages[channel.id];
        if (!Array.isArray(channelMessages) || channelMessages.length === 0) continue;
        const latestTs = toTimestamp(channelMessages[channelMessages.length - 1]?.timestamp);
        if (!latestTs) continue;
        const currentTs = channelReadTracker[channel.id] || 0;
        if (latestTs <= currentTs) continue;
        updates[channel.id] = latestTs;
        touched += 1;
      }
    }
    if (touched === 0) {
      setToast(language === 'es' ? 'Nada que marcar como leido' : 'Nothing to mark as read');
      return;
    }
    setChannelReadTracker((prev) => ({ ...prev, ...updates }));
    setToast(
      language === 'es'
        ? `Marcado como leido (${touched})`
        : `Marked as read (${touched})`
    );
  }, [activeServer, channelReadTracker, language, messages]);

  const dmGroupsSorted = useMemo(
    () =>
      [...(dmGroups || [])].sort((a, b) => {
        const aPinned = pinnedDmSet.has(a.id);
        const bPinned = pinnedDmSet.has(b.id);
        if (aPinned !== bPinned) return aPinned ? -1 : 1;
        const aLast = (messages[a.id] || []).at(-1);
        const bLast = (messages[b.id] || []).at(-1);
        const aTs = aLast ? new Date(aLast.timestamp).getTime() : 0;
        const bTs = bLast ? new Date(bLast.timestamp).getTime() : 0;
        return (bTs || 0) - (aTs || 0);
      }),
    [dmGroups, messages, pinnedDmSet]
  );

  useEffect(() => {
    const nextReadTracker = loadReadTracker();
    const nextCategoryCollapseState = loadCategoryCollapseState();
    setChannelReadTracker(nextReadTracker);
    setCategoryCollapsed(nextCategoryCollapseState);
    readTrackerPersistRef.current.lastSerialized = JSON.stringify(nextReadTracker);
    collapsePersistRef.current.lastSerialized = JSON.stringify(nextCategoryCollapseState);
    setDomReady(true);
  }, []);

  useEffect(() => {
    directoryUsersRef.current = {
      token: null,
      fetchedAt: 0,
      cachedUsers: [],
      inFlight: null,
    };
    directorySearchCacheRef.current.clear();
  }, [backendToken, currentUser.id]);

  useEffect(() => {
    if (!incomingPopupId && dmRequestsIncoming.length > 0) {
      setIncomingPopupId(dmRequestsIncoming[0].id);
    }
  }, [dmRequestsIncoming, incomingPopupId]);

  useEffect(() => {
    if (!incomingPopupId) return;
    if (dmRequestsIncoming.some((r) => r.id === incomingPopupId)) return;
    setIncomingPopupId(null);
  }, [incomingPopupId, dmRequestsIncoming]);

  useEffect(() => {
    setPresence(currentUser.id, { userId: currentUser.id, status: myStatus });
  }, [currentUser.id, myStatus, setPresence]);

  useEffect(() => {
    if (!isBackendEnabled || !backendToken) return;
    const socket = getSocket(backendToken);
    try {
      socket?.connect();
      socket?.emit('presence:update', { status: myStatus });
    } catch { }
  }, [backendToken, myStatus]);

  useEffect(() => {
    if (!statusMenuOpen) return;
    const close = () => setStatusMenuOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [statusMenuOpen]);

  useEffect(() => {
    if (!friendsPopupOpen) return;
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown' && filteredFriends.length > 0) {
        event.preventDefault();
        setFriendsKeyboardIndex((prev) => (prev + 1) % filteredFriends.length);
        return;
      }
      if (event.key === 'ArrowUp' && filteredFriends.length > 0) {
        event.preventDefault();
        setFriendsKeyboardIndex((prev) => (prev - 1 + filteredFriends.length) % filteredFriends.length);
        return;
      }
      if (event.key === 'Enter' && filteredFriends.length > 0) {
        event.preventDefault();
        const entry = filteredFriends[friendsKeyboardIndex] || filteredFriends[0];
        if (!entry) return;
        setActiveServer(null);
        setActiveChannel(entry.dmId);
        setFriendsPopupOpen(false);
        setFriendSearchQuery('');
        return;
      }
      if (event.key === 'Escape') {
        setFriendsPopupOpen(false);
        setFriendSearchQuery('');
      }
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [friendsPopupOpen, filteredFriends, friendsKeyboardIndex, setActiveServer, setActiveChannel]);

  useEffect(() => {
    if (!friendsPopupOpen) {
      setFriendsKeyboardIndex(0);
      return;
    }
    setFriendsKeyboardIndex((prev) => Math.min(prev, Math.max(0, filteredFriends.length - 1)));
  }, [friendsPopupOpen, filteredFriends.length]);

  useEffect(() => {
    if (!activeChannelId) return;
    const activeChannelMessages = messages[activeChannelId];
    if (!Array.isArray(activeChannelMessages) || activeChannelMessages.length === 0) return;
    const latestTs = toTimestamp(activeChannelMessages[activeChannelMessages.length - 1]?.timestamp);
    if (!latestTs) return;
    setChannelReadTracker((prev) => {
      const currentTs = prev[activeChannelId] || 0;
      if (latestTs <= currentTs) return prev;
      return { ...prev, [activeChannelId]: latestTs };
    });
  }, [activeChannelId, messages, setChannelReadTracker]);

  useEffect(() => {
    if (typeof window === 'undefined' || !domReady) return;
    const serialized = JSON.stringify(channelReadTracker);
    if (serialized === readTrackerPersistRef.current.lastSerialized) return;

    if (readTrackerPersistRef.current.timer !== null) {
      window.clearTimeout(readTrackerPersistRef.current.timer);
    }

    readTrackerPersistRef.current.timer = window.setTimeout(() => {
      try {
        localStorage.setItem(CHANNEL_READ_TRACKER_KEY, serialized);
        readTrackerPersistRef.current.lastSerialized = serialized;
      } catch { }
      readTrackerPersistRef.current.timer = null;
    }, 140);
  }, [channelReadTracker, domReady]);

  useEffect(() => {
    if (typeof window === 'undefined' || !domReady) return;
    const serialized = JSON.stringify(isCategoryCollapsed);
    if (serialized === collapsePersistRef.current.lastSerialized) return;

    if (collapsePersistRef.current.timer !== null) {
      window.clearTimeout(collapsePersistRef.current.timer);
    }

    collapsePersistRef.current.timer = window.setTimeout(() => {
      try {
        localStorage.setItem(CATEGORY_COLLAPSE_STORAGE_KEY, serialized);
        collapsePersistRef.current.lastSerialized = serialized;
      } catch { }
      collapsePersistRef.current.timer = null;
    }, 140);
  }, [isCategoryCollapsed, domReady]);

  useEffect(() => {
    return () => {
      if (readTrackerPersistRef.current.timer !== null) {
        window.clearTimeout(readTrackerPersistRef.current.timer);
      }
      if (collapsePersistRef.current.timer !== null) {
        window.clearTimeout(collapsePersistRef.current.timer);
      }
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const activeElement = document.activeElement as HTMLElement | null;
      const editable =
        activeElement &&
        (activeElement.tagName === 'INPUT' ||
          activeElement.tagName === 'TEXTAREA' ||
          activeElement.getAttribute('contenteditable') === 'true');
      if (editable) return;

      if (event.altKey && event.shiftKey && event.code === 'KeyA') {
        event.preventDefault();
        setAddDmError('');
        setAddDmQuery('');
        setSearchKeyboardIndex(0);
        setAddDmOpen(true);
        return;
      }

      if (event.altKey && event.shiftKey && event.code === 'KeyF') {
        event.preventDefault();
        setFriendSearchQuery('');
        setFriendsKeyboardIndex(0);
        setFriendsPopupOpen(true);
        return;
      }

      const shortcutUnreadTarget = activeServerId ? topUnreadServerChannel.channelId : topUnreadChannelId;
      if (event.altKey && event.shiftKey && event.code === 'KeyU' && shortcutUnreadTarget) {
        event.preventDefault();
        setActiveChannel(shortcutUnreadTarget);
        setToast(language === 'es' ? 'Canal no leido abierto' : 'Unread channel opened');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeServerId, language, setActiveChannel, topUnreadChannelId, topUnreadServerChannel.channelId]);

  useEffect(() => {
    if ((!addDmOpen && !friendsPopupOpen) || !isBackendEnabled) return;
    const token = getEffectiveBackendToken(backendToken);
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        await preloadDirectoryUsers(token);
        if (cancelled) return;
      } catch { }
    })();
    return () => {
      cancelled = true;
    };
  }, [addDmOpen, friendsPopupOpen, backendToken, preloadDirectoryUsers]);

  useEffect(() => {
    if (!isBackendEnabled || dmGroups.length === 0) return;
    const currentUserId = String(currentUser.id);
    const hasUnknownDmPeer = dmGroups.some((group) => {
      const peerId =
        group.memberIds.find((memberId) => String(memberId) !== currentUserId) ||
        group.memberIds[0] ||
        null;
      if (!peerId) return false;
      const normalizedPeerId = String(peerId);
      return !users.some((user) => String(user.id) === normalizedPeerId);
    });
    if (!hasUnknownDmPeer) return;
    const token = getEffectiveBackendToken(backendToken);
    if (!token) return;
    void preloadDirectoryUsers(token);
  }, [dmGroups, users, currentUser.id, backendToken, preloadDirectoryUsers]);

  // User search effect
  useEffect(() => {
    const rawQuery = addDmQuery.trim();
    if (!rawQuery) {
      setFilteredUsers([]);
      setShowUserList(false);
      return;
    }

    const backendQuery = normalizeSearchText(rawQuery.replace(/^@+/, ''));
    const query = compactSearchText(backendQuery);
    if (!query) {
      setFilteredUsers([]);
      setShowUserList(false);
      return;
    }

    setSearching(true);
    let cancelled = false;
    const controller = new AbortController();

    const timeoutId = setTimeout(async () => {
      const token = getEffectiveBackendToken(backendToken);
      if (isBackendEnabled && !token) {
        if (!cancelled) {
          setFilteredUsers([]);
          setShowUserList(false);
          setSearching(false);
          setAddDmError(language === 'es' ? 'Sesion expirada. Vuelve a iniciar sesion.' : 'Session expired. Please sign in again.');
        }
        return;
      }

      const useBackendSearch = isBackendEnabled && Boolean(token);
      let searchSourceUsers: User[] = [];
      let backendAuthFailed = false;

      if (useBackendSearch) {
        const searchCacheKey = `${token as string}::${query}`;
        const cachedSearch = directorySearchCacheRef.current.get(searchCacheKey);
        if (
          cachedSearch &&
          Date.now() - cachedSearch.at < DIRECTORY_SEARCH_CACHE_TTL_MS &&
          cachedSearch.users.length > 0
        ) {
          searchSourceUsers = cachedSearch.users;
        } else {
          try {
            const res = await dataProvider.searchUsers(
              token as string,
              backendQuery,
              controller.signal
            );
            if (res.status === 401 || res.status === 403) {
              backendAuthFailed = true;
            } else {
              const data = await res.json().catch(() => ({}));
              if (res.ok && Array.isArray((data as any).users)) {
                searchSourceUsers = ((data as any).users as any[]).map((u) => mapBackendUser(u));
                if (searchSourceUsers.length > 0) {
                  upsertUsers(searchSourceUsers);
                  directorySearchCacheRef.current.set(searchCacheKey, { at: Date.now(), users: searchSourceUsers });
                  if (directorySearchCacheRef.current.size > 36) {
                    const firstKey = directorySearchCacheRef.current.keys().next().value;
                    if (typeof firstKey === 'string') directorySearchCacheRef.current.delete(firstKey);
                  }
                }
              }
            }
          } catch { }
        }

        if (!backendAuthFailed && searchSourceUsers.length === 0) {
          try {
            const bootstrapUsers = await preloadDirectoryUsers(token as string);
            if (bootstrapUsers.length > 0) {
              searchSourceUsers = bootstrapUsers;
            }
          } catch { }
        }
      }

      const merged = (useBackendSearch ? searchSourceUsers : users).filter((u) => !isLegacyDemoUser(u));
      const byId = new Map<string, User>();
      for (const user of merged) {
        if (user.id === currentUser.id) continue;
        const prev = byId.get(user.id);
        byId.set(user.id, prev ? { ...prev, ...user } : user);
      }
      const ranked = Array.from(byId.values())
        .map((user) => ({ user, score: scoreUserSearch(user, query) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || a.user.username.localeCompare(b.user.username));

      // Keep only one visible result per username to avoid repeated entries
      // when multiple accounts share the same username with different tags.
      const uniqueByUsername = new Map<string, User>();
      for (const item of ranked) {
        const key = (item.user.username || '').trim().toLowerCase();
        if (!key || uniqueByUsername.has(key)) continue;
        uniqueByUsername.set(key, item.user);
        if (uniqueByUsername.size >= 40) break;
      }
      const filtered = Array.from(uniqueByUsername.values());

      if (!cancelled) {
        if (backendAuthFailed) {
          setAddDmError(language === 'es' ? 'Sesion expirada. Vuelve a iniciar sesion.' : 'Session expired. Please sign in again.');
        }
        setFilteredUsers(filtered);
        setShowUserList(filtered.length > 0);
        setSearching(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, [addDmQuery, users, currentUser.id, backendToken, upsertUsers, preloadDirectoryUsers]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 1400);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    const query = addDmQuery.trim();
    if (!query) {
      setSearchIndicator(null);
      return;
    }
    if (searching) {
      setSearchIndicator('searching');
      return;
    }
    setSearchIndicator(filteredUsers.length > 0 ? 'success' : 'empty');
  }, [addDmQuery, searching, filteredUsers.length]);

  useEffect(() => {
    if (!addDmOpen || filteredUsers.length === 0) {
      setSearchKeyboardIndex(0);
      return;
    }
    setSearchKeyboardIndex((prev) => Math.min(prev, filteredUsers.length - 1));
  }, [addDmOpen, filteredUsers.length]);

  useEffect(() => {
    if (!channelContextMenu) return;
    const close = () => setChannelContextMenu(null);
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    window.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
      window.removeEventListener('keydown', onEsc);
    };
  }, [channelContextMenu]);

  useEffect(() => {
    try {
      const rawExpiry = localStorage.getItem('diavlocord-nitro-expiry');
      if (!rawExpiry) {
        setNitroActive(false);
        return;
      }
      const expiryMs = Number(rawExpiry) || new Date(rawExpiry).getTime();
      setNitroActive(!Number.isNaN(expiryMs) && expiryMs > Date.now());
    } catch {
      setNitroActive(false);
    }
  }, [nitroOpen]);

  useEffect(() => {
    try {
      setOfferDismissed(localStorage.getItem('diavlocord-offer-dismissed') === '1');
    } catch {
      setOfferDismissed(false);
    }
  }, []);

  const dismissOffer = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOfferDismissed(true);
    try {
      localStorage.setItem('diavlocord-offer-dismissed', '1');
    } catch { }
  };

  const handleSetStatus = (status: UserStatus) => {
    updateCurrentUser({ status });
    const presence = { userId: currentUser.id, status };
    setPresence(currentUser.id, presence);
    eventBus.emit('PRESENCE_UPDATE', { userId: currentUser.id, presence });

    if (isBackendEnabled && backendToken) {
      const socket = getSocket(backendToken);
      try {
        socket?.connect();
        socket?.emit('presence:update', { status });
      } catch { }
    }
    setStatusMenuOpen(false);
  };

  const copyUserId = async (userId: string) => {
    try {
      await navigator.clipboard.writeText(userId);
      setCopiedUserId(userId);
      setTimeout(() => setCopiedUserId(null), 1400);
    } catch {
      setAddDmError('No se pudo copiar el ID');
    }
  };

  const copyChannelId = async (channelId: string) => {
    try {
      await navigator.clipboard.writeText(channelId);
      setCopiedChannelId(channelId);
      setTimeout(() => setCopiedChannelId(null), 1400);
      setChannelContextMenu(null);
    } catch {
      setAddDmError('No se pudo copiar el ID del canal');
    }
  };

  const closeAddDmPanel = () => {
    setAddDmOpen(false);
    setShowUserList(false);
    setAddDmQuery('');
    setAddDmError('');
    setSearchKeyboardIndex(0);
  };

  const closeFriendsPopup = () => {
    setFriendsPopupOpen(false);
    setFriendSearchQuery('');
  };

  const sendDmRequestFromPanel = (userId: string) => {
    const res = sendDMRequest(userId);
    if (!res.ok) {
      if (res.reason === 'pending') {
        setAddDmError(t(language, 'pending_requests'));
      } else if (res.reason === 'self') {
        setAddDmError(t(language, 'cannot_add_self'));
      } else {
        setAddDmError(t(language, 'user_not_found'));
      }
      return;
    }
    setToast(t(language, 'request_sent'));
    setAddDmQuery('');
    setShowUserList(false);
    setTimeout(() => closeAddDmPanel(), 1000);
  };

  // Shared User Bar Component for consistency
  const UserBar = () => (
    <div className="bg-[#0A0A0B]/80 glass-ruby-strip backdrop-blur-xl border-t border-white/[0.03] p-4 flex items-center justify-between group">
      <div
        onClick={() => setProfilePreviewOpen(true)}
        className="flex items-center gap-3 cursor-pointer min-w-0 flex-1"
      >
        <div className="relative flex-shrink-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-neon-blue to-neon-purple p-[1px]">
            <div className="w-full h-full rounded-[inherit] bg-[#0A0A0B] overflow-hidden">
              {currentUser.avatar ? (
                <img src={currentUser.avatar} alt={currentUser.username} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs font-black text-white">
                  {currentUser.username[0]}
                </div>
              )}
            </div>
          </div>
          <div className={cn(
            "absolute -bottom-1 -right-1 w-4 h-4 rounded-lg border-[3px] border-[#0A0A0B]",
            statusInfo[myStatus].dot
          )} />
        </div>
        <div className="overflow-hidden">
          <div className="text-white text-sm font-black truncate tracking-tight group-hover:text-neon-blue transition-colors flex items-center gap-2">
            <span>{currentUser.username}</span>
            {nitroActive ? (
              <NitroEmblems size={12} compact />
            ) : null}
            <CrewBadge userId={currentUser.id} size="xs" />
          </div>
          <div className="text-[#4E5058] text-[9px] font-black uppercase tracking-widest leading-none mt-1">
            #{currentUser.discriminator}
          </div>
          {currentUser.customStatus ? (
            <div className="mt-1 max-w-[132px] inline-flex items-center gap-1.5 rounded-full bg-white/[0.03] border border-white/[0.07] px-2 py-0.5 text-[9px] font-black text-[#CFD4DA] tracking-wide">
              <span className={cn("w-1.5 h-1.5 rounded-full", statusInfo[myStatus].dot)} />
              <span className="truncate">{currentUser.customStatus}</span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-1 opacity-40 group-hover:opacity-100 transition-opacity">
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setStatusMenuOpen((prev) => !prev);
            }}
            className="w-8 h-8 rounded-lg hover:bg-white/5 text-[#B5BAC1] hover:text-white transition-all inline-flex items-center justify-center"
            title={t(language, 'set_status')}
          >
            <span className={cn("w-2.5 h-2.5 rounded-full", statusInfo[myStatus].dot)} />
          </button>
          {statusMenuOpen ? (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute bottom-10 right-0 w-40 rounded-2xl border border-white/[0.08] bg-[#0A0A0B]/95 backdrop-blur-xl shadow-2xl p-1.5 z-[260]"
            >
              {(['online', 'idle', 'dnd', 'offline'] as UserStatus[]).map((status) => (
                <button
                  key={status}
                  onClick={() => handleSetStatus(status)}
                  className="w-full px-3 py-2 rounded-xl text-left text-xs text-white/85 hover:bg-white/[0.06] transition-all flex items-center gap-2"
                >
                  <span className={cn("w-2.5 h-2.5 rounded-full", statusInfo[status].dot)} />
                  <span className="font-black uppercase tracking-widest">{statusInfo[status].label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <button
          onClick={() => onOpenSettings('profile')}
          className="p-2 rounded-lg hover:bg-white/5 text-[#B5BAC1] hover:text-white transition-all"
        >
          <Settings size={16} />
        </button>
      </div>
    </div>
  );

  if (!activeServer) return (
    <div className="w-[260px] max-sm:w-[calc(100vw-74px)] bg-[#0A0A0B] glass-ruby-shell flex flex-col h-full overflow-hidden border-r border-white/[0.03]">
      <div className="h-16 px-4 border-b border-white/[0.03] flex items-center justify-between bg-white/[0.01] glass-ruby-strip">
        <div className="flex items-center gap-2">
          <h2 className="text-[10px] font-black text-white uppercase tracking-[0.2em]">{t(language, 'communications')}</h2>
        </div>
        <button
          onClick={() => {
            setAddDmError('');
            setAddDmQuery('');
            setSearchKeyboardIndex(0);
            setAddDmOpen(true);
          }}
          title="Agregar amigo (Alt+Shift+A)"
          className="w-8 h-8 rounded-lg bg-white/[0.03] flex items-center justify-center text-[#B5BAC1] hover:bg-neon-blue hover:text-black transition-all apple-glass-surface apple-smooth"
        >
          <Plus size={16} />
        </button>
      </div>

      {addDmOpen && domReady
        ? createPortal(
          <div className="fixed inset-0 z-[320]">
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={closeAddDmPanel}
            />
            <div className="absolute inset-0 flex items-start justify-center pt-20 px-6">
              <div className="w-full max-w-lg rounded-3xl bg-[#0A0A0B]/90 backdrop-blur-xl border border-white/10 shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-4 duration-300 mac-scale-enter">
                {/* Header */}
                <div className="p-6 pb-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-white font-black text-xl tracking-tight flex items-center gap-3">
                        <Search size={20} className="text-neon-blue" />
                        {t(language, 'add_friend')}
                      </div>
                      <div className="text-[#949BA4] text-xs font-bold uppercase tracking-widest mt-2">
                        Busca por nombre de usuario
                      </div>
                    </div>
                    <button
                      onClick={closeAddDmPanel}
                      className="w-10 h-10 rounded-2xl bg-white/[0.03] border border-white/[0.06] text-white/70 hover:text-white hover:bg-white/[0.06] transition-all flex items-center justify-center"
                    >
                      <X size={18} />
                    </button>
                  </div>

                  {/* Search Input */}
                  <div className="mt-6 relative">
                    <div className="relative">
                      <Search
                        size={18}
                        className="absolute left-4 top-1/2 -translate-y-1/2 text-[#4E5058] pointer-events-none"
                      />
                      <input
                        value={addDmQuery}
                        onChange={(e) => {
                          setAddDmQuery(e.target.value);
                          setAddDmError('');
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            e.preventDefault();
                            closeAddDmPanel();
                            return;
                          }
                          if (filteredUsers.length === 0) return;
                          if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            setSearchKeyboardIndex((prev) => (prev + 1) % filteredUsers.length);
                            return;
                          }
                          if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            setSearchKeyboardIndex((prev) => (prev - 1 + filteredUsers.length) % filteredUsers.length);
                            return;
                          }
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const candidate = filteredUsers[searchKeyboardIndex] || filteredUsers[0];
                            if (candidate) sendDmRequestFromPanel(candidate.id);
                          }
                        }}
                        placeholder="Escribe un nombre de usuario..."
                        className="w-full bg-white/[0.02] border border-white/[0.06] rounded-2xl pl-12 pr-4 py-4 text-white font-bold outline-none focus:border-white/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20 focus-visible:shadow-none placeholder-[#4E5058] transition-all"
                        autoFocus
                      />
                      {searchIndicator ? (
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 animate-in fade-in zoom-in-75 slide-in-from-right-2 duration-300">
                          {searchIndicator === 'searching' ? (
                            <div className="w-8 h-8 rounded-xl border border-neon-blue/30 bg-white/[0.04] backdrop-blur-xl flex items-center justify-center shadow-[0_0_22px_rgba(56,189,248,0.18)]">
                              <div className="w-4 h-4 border-2 border-neon-blue border-t-transparent rounded-full animate-spin" />
                            </div>
                          ) : searchIndicator === 'success' ? (
                            <div className="w-8 h-8 rounded-xl border border-neon-green/45 bg-neon-green/12 backdrop-blur-xl flex items-center justify-center text-neon-green shadow-[0_0_0_1px_rgba(34,197,94,0.28),0_0_24px_rgba(34,197,94,0.24)]">
                              <Check size={14} className="drop-shadow-[0_0_8px_rgba(34,197,94,0.65)]" />
                            </div>
                          ) : (
                            <div className="w-8 h-8 rounded-xl border border-neon-pink/45 bg-neon-pink/12 backdrop-blur-xl flex items-center justify-center text-neon-pink shadow-[0_0_0_1px_rgba(244,63,94,0.26),0_0_24px_rgba(244,63,94,0.24)]">
                              <X size={14} className="drop-shadow-[0_0_8px_rgba(244,63,94,0.6)]" />
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="px-6 pb-3 text-[10px] font-black uppercase tracking-[0.2em] text-[#6f7781] flex items-center justify-between">
                  <span>Flechas para navegar</span>
                  <span>Enter para enviar</span>
                </div>

                {/* User List */}
                {showUserList && (
                  <div className="max-h-80 overflow-y-auto px-6 pb-6 space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                    {filteredUsers.map((user, index) => (
                      <div
                        key={`add-dm-user-${String(user.id || 'unknown')}-${String(user.username || 'user')}-${String(user.discriminator || '0000')}`}
                        onMouseEnter={() => setSearchKeyboardIndex(index)}
                        onClick={() => sendDmRequestFromPanel(user.id)}
                        className={cn(
                          "group relative bg-white/[0.02] border border-white/[0.06] rounded-2xl p-4 hover:bg-white/[0.04] hover:border-neon-blue/20 transition-all duration-200 cursor-pointer",
                          "animate-in fade-in slide-in-from-left-2 duration-300",
                          "hover:shadow-lg hover:shadow-neon-blue/10",
                          index === searchKeyboardIndex && "border-neon-blue/45 bg-neon-blue/10 shadow-[0_0_0_1px_rgba(56,189,248,0.3),0_0_24px_rgba(56,189,248,0.2)]"
                        )}
                        style={{ animationDelay: `${index * 50}ms` }}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            {/* User Avatar */}
                            <div className="relative flex-shrink-0">
                              <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-neon-blue to-neon-purple p-[1px]">
                                <div className="w-full h-full rounded-[inherit] bg-[#0A0A0B] overflow-hidden">
                                  {user.avatar ? (
                                    <img
                                      src={user.avatar}
                                      alt={user.username}
                                      className="w-full h-full object-cover"
                                    />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center text-sm font-black text-white">
                                      {user.username[0]?.toUpperCase()}
                                    </div>
                                  )}
                                </div>
                              </div>
                              {/* Status Indicator */}
                              <div className={cn(
                                "absolute -bottom-1 -right-1 w-4 h-4 rounded-lg border-[2px] border-[#0A0A0B]",
                                statusInfo[getResolvedStatus(user.id, user.status || 'offline')].dot,
                                "shadow-lg"
                              )} />
                            </div>

                            {/* User Info */}
                            <div className="min-w-0 flex-1">
                              <div className="text-white font-black text-sm truncate tracking-tight group-hover:text-neon-blue transition-colors">
                                {user.username}
                              </div>
                              <div className="text-[#4E5058] text-[10px] font-black uppercase tracking-widest">
                                @{user.username}
                              </div>
                              {developerMode ? (
                                <div className="text-[#6B7280] text-[9px] font-black uppercase tracking-widest mt-1">
                                  ID: {user.id.slice(0, 10)}...
                                </div>
                              ) : null}
                              {user.bio && (
                                <div className="text-[#949BA4] text-xs mt-1 line-clamp-1">
                                  {user.bio}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Actions */}
                          <div className="ml-3 flex items-center gap-2">
                            {developerMode ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void copyUserId(user.id);
                                }}
                                title={`${t(language, 'copy_id')}: ${user.id}`}
                                className="w-9 h-9 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white/70 hover:text-white hover:bg-white/[0.07] transition-all flex items-center justify-center"
                              >
                                {copiedUserId === user.id ? <Check size={14} className="text-neon-green" /> : <Copy size={14} />}
                              </button>
                            ) : null}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                sendDmRequestFromPanel(user.id);
                              }}
                              className={cn(
                                "px-4 py-2 rounded-xl font-black uppercase tracking-widest text-[10px] transition-all duration-200",
                                "text-white bg-neon-blue/15 border border-neon-blue/40 backdrop-blur-xl",
                                "shadow-[0_0_0_1px_rgba(194,24,60,0.18),0_0_18px_rgba(194,24,60,0.10)]",
                                "hover:bg-neon-blue/25 hover:border-neon-blue/60 hover:shadow-[0_0_0_1px_rgba(194,24,60,0.36),0_0_28px_rgba(194,24,60,0.20)] hover:scale-[1.03]",
                                "active:scale-[0.95]",
                                "flex items-center gap-2"
                              )}
                            >
                              <UserPlus size={14} />
                              {t(language, 'add_friend')}
                            </button>
                          </div>
                        </div>

                        {/* Hover Effect Overlay */}
                        <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-neon-blue/5 to-neon-purple/5 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none" />
                      </div>
                    ))}
                  </div>
                )}

                {/* Error Message */}
                {addDmError && (
                  <div className="px-6 pb-4">
                    <div className="px-4 py-3 rounded-2xl bg-neon-pink/10 border border-neon-pink/20">
                      <div className="text-neon-pink text-xs font-black uppercase tracking-widest flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-neon-pink animate-pulse" />
                        {addDmError}
                      </div>
                    </div>
                  </div>
                )}

                {/* No Results */}
                {addDmQuery && !searching && filteredUsers.length === 0 && !addDmError && (
                  <div className="px-6 pb-6">
                    <div className="text-center py-8">
                      <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-white/[0.02] border border-white/[0.06] flex items-center justify-center">
                        <Search size={24} className="text-[#4E5058]" />
                      </div>
                      <div className="text-[#4E5058] text-sm font-black">
                        No se encontraron usuarios
                      </div>
                      <div className="text-[#949BA4] text-xs mt-1">
                        Intenta con otro nombre de usuario
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body
        )
        : null}

      {friendsPopupOpen && domReady
        ? createPortal(
          <div className="fixed inset-0 z-[326]">
            <div className="absolute inset-0 bg-black/68 backdrop-blur-sm" onClick={closeFriendsPopup} />
            <div className="absolute inset-0 flex items-start justify-center pt-16 px-4">
              <div className="w-full max-w-[620px] rounded-3xl border border-white/12 shadow-2xl apple-glass-popover mac-scale-enter overflow-hidden">
                <div className="px-6 py-5 border-b border-white/[0.08]">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-white font-black text-xl tracking-tight inline-flex items-center gap-2">
                        <Search size={18} className="text-neon-blue" />
                        Buscar amigos
                      </div>
                      <div className="text-[#9aa2ad] text-[10px] font-black uppercase tracking-[0.16em] mt-1">
                        Selecciona una persona para abrir chat directo
                      </div>
                      <div className="text-[#6f7781] text-[9px] font-black uppercase tracking-[0.14em] mt-1.5">
                        Flechas para navegar  |  Enter para abrir
                      </div>
                    </div>
                    <button
                      onClick={closeFriendsPopup}
                      className="w-10 h-10 rounded-xl border border-white/[0.12] bg-white/[0.03] text-white/70 hover:text-white hover:bg-white/[0.08] transition-all apple-smooth"
                      title="Cerrar"
                    >
                      <X size={16} className="mx-auto" />
                    </button>
                  </div>

                  <div className="mt-4 relative">
                    <Search size={13} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#6B7280]" />
                    <input
                      value={friendSearchQuery}
                      onChange={(event) => setFriendSearchQuery(event.target.value)}
                      placeholder="Escribe un nombre..."
                      className="w-full h-11 rounded-xl bg-white/[0.03] border border-white/[0.12] pl-10 pr-9 text-sm text-white outline-none focus:border-neon-blue/45 transition-colors placeholder-[#6B7280] apple-glass-surface"
                      autoFocus
                    />
                    {friendSearchQuery ? (
                      <button
                        onClick={() => setFriendSearchQuery('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md border border-white/[0.12] bg-white/[0.03] text-white/70 hover:text-white hover:bg-white/[0.08] transition-colors inline-flex items-center justify-center"
                        title="Limpiar busqueda"
                      >
                        <X size={12} />
                      </button>
                    ) : null}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {(['all', 'pinned', 'online', 'idle', 'dnd', 'offline'] as const).map((filterKey) => {
                      const active = friendFilter === filterKey;
                      const label =
                        filterKey === 'all'
                          ? t(language, 'friends_all')
                          : filterKey === 'pinned'
                            ? 'Anclados'
                            : statusInfo[filterKey].label;
                      return (
                        <button
                          key={filterKey}
                          onClick={() => setFriendFilter(filterKey)}
                          className={cn(
                            "px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest border transition-all apple-smooth",
                            active
                              ? "bg-white/[0.06] border-white/[0.16] text-white apple-glass-surface"
                              : "bg-white/[0.02] border-white/[0.06] text-[#949BA4] hover:text-white hover:bg-white/[0.04]"
                          )}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="max-h-[58vh] overflow-y-auto p-3 space-y-1.5">
                  {filteredFriends.length === 0 ? (
                    <div className="px-4 py-3 rounded-xl bg-white/[0.02] border border-white/[0.05] text-[#6B7280] text-xs font-bold">
                      {friendSearchQuery.trim() ? 'Sin coincidencias para la busqueda actual.' : t(language, 'friends_empty')}
                    </div>
                  ) : (
                    filteredFriends.map((entry, idx) => {
                      const unread = unreadByChannel.get(entry.dmId);
                      return (
                        <button
                          key={`friend-dm-${entry.dmId}-${entry.user.id}`}
                          onMouseEnter={() => setFriendsKeyboardIndex(idx)}
                          onClick={() => {
                            setActiveServer(null);
                            setActiveChannel(entry.dmId);
                            closeFriendsPopup();
                          }}
                          className={cn(
                            "relative flex items-center gap-3 w-full px-4 py-3 rounded-xl transition-all border apple-smooth",
                            activeServerId === null && activeChannelId === entry.dmId
                              ? "bg-white/[0.05] border-white/[0.1] text-white shadow-xl apple-glass-surface"
                              : "bg-transparent border-transparent text-[#4E5058] hover:text-[#B5BAC1] hover:bg-white/[0.02]",
                            idx === friendsKeyboardIndex && "border-neon-blue/45 bg-neon-blue/10 text-white shadow-[0_0_0_1px_rgba(56,189,248,0.24)]"
                          )}
                        >
                          <div className="relative">
                            <div className="w-10 h-10 rounded-xl overflow-hidden bg-white/[0.03] flex items-center justify-center">
                              {entry.user.avatar ? (
                                <img src={entry.user.avatar} alt={entry.user.username} className="w-full h-full object-cover" />
                              ) : (
                                <span className="text-sm font-black">{entry.user.username[0]?.toUpperCase() || '?'}</span>
                              )}
                            </div>
                            <div className={cn("absolute -bottom-1 -right-1 w-3 h-3 border-2 border-[#0A0A0B] rounded-full", statusInfo[entry.status].dot)} />
                          </div>
                          <div className="min-w-0 text-left">
                            <div className="truncate font-black text-sm tracking-tight inline-flex items-center gap-1.5">
                              {getUserLabel(entry.user, entry.user.id)}
                              {entry.isPinned ? <Pin size={11} className="text-neon-purple flex-shrink-0" /> : null}
                            </div>
                            <div className="text-[9px] font-black uppercase tracking-widest text-[#6B7280]">{statusInfo[entry.status].label}</div>
                          </div>
                          {unread?.mentions ? (
                            <div className="h-5 px-1.5 rounded-md border border-neon-pink/45 bg-neon-pink/15 text-neon-pink text-[9px] font-black uppercase tracking-widest inline-flex items-center justify-center">
                              @{Math.min(unread.mentions, 99)}
                            </div>
                          ) : null}
                          {unread?.unread ? (
                            <div className="min-w-[20px] h-5 px-1.5 rounded-md border border-neon-blue/45 bg-neon-blue/15 text-neon-blue text-[9px] font-black uppercase tracking-widest inline-flex items-center justify-center">
                              {Math.min(unread.unread, 99)}
                            </div>
                          ) : null}
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              togglePinnedDM(entry.dmId);
                            }}
                            className={cn(
                              "ml-auto w-7 h-7 rounded-xl border transition-all inline-flex items-center justify-center apple-smooth",
                              entry.isPinned
                                ? "bg-neon-purple/15 border-neon-purple/35 text-neon-purple"
                                : "bg-white/[0.02] border-white/[0.08] text-white/55 hover:text-white hover:bg-white/[0.06]"
                            )}
                            title={entry.isPinned ? 'Desanclar DM' : 'Anclar DM'}
                          >
                            <Pin size={12} />
                          </button>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>,
          document.body
        )
        : null}

      {toast && (
        <div className="fixed bottom-8 left-[100px] z-[400]">
          <div className="px-4 py-3 rounded-2xl text-white font-black uppercase tracking-widest text-[10px] shadow-2xl apple-glass-popover mac-scale-enter">
            {toast}
          </div>
        </div>
      )}

      {incomingPopupId && (
        <div className="fixed top-6 right-6 z-[320] w-full max-w-sm px-4">
          {(() => {
            const req = dmRequestsIncoming.find((r) => r.id === incomingPopupId);
            if (!req) return null;
            const from = users.find((u) => u.id === req.fromUserId);
            const fromLabel = getUserLabel(from, req.fromUserId);
            return (
              <div className="relative rounded-3xl bg-[#0A0A0B]/95 glass-ruby-surface border border-white/10 shadow-2xl overflow-hidden room-enter">
                <div className="absolute inset-0 aurora-layer aurora-1 opacity-35" />
                <div className="absolute inset-0 aurora-layer aurora-2 opacity-30" />
                <div className="absolute inset-0 scanlines-soft opacity-30" />
                <div className="absolute inset-0 noise-soft opacity-20" />
                <div className="relative z-10">
                  <div className="p-5 flex items-start justify-between gap-4 border-b border-white/[0.06]">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="relative w-12 h-12 rounded-2xl overflow-hidden border border-white/20 bg-white/[0.03] flex-shrink-0 shadow-[0_0_22px_rgba(194,24,60,0.22)]">
                        {from?.avatar ? (
                          <img src={from.avatar} alt={fromLabel} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-white font-black text-sm">
                            {fromLabel[0]?.toUpperCase()}
                          </div>
                        )}
                        <div className={cn("absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#0A0A0B]", statusInfo[getResolvedStatus(req.fromUserId, 'online')].dot)} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-white font-black text-lg tracking-tight">{t(language, 'incoming_request_title')}</div>
                        <div className="text-[#B5BAC1] text-sm font-bold mt-1 truncate">{fromLabel}</div>
                      </div>
                    </div>
                    <button
                      onClick={() => setIncomingPopupId(null)}
                      className="w-9 h-9 rounded-2xl bg-white/[0.03] border border-white/[0.08] text-white/70 hover:text-white hover:bg-white/[0.08] transition-all flex items-center justify-center"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <div className="px-5 py-4 flex justify-end gap-3">
                    <button
                      onClick={() => {
                        rejectDMRequest(req.id);
                        setIncomingPopupId(null);
                      }}
                      className="px-5 py-3 rounded-2xl bg-white/[0.03] border border-white/[0.08] text-white font-black uppercase tracking-widest text-[10px] hover:bg-white/[0.08] transition-all"
                    >
                      {t(language, 'reject')}
                    </button>
                    <button
                      onClick={() => {
                        acceptDMRequest(req.id);
                        setIncomingPopupId(null);
                      }}
                      className="px-5 py-3 rounded-2xl text-neon-green bg-white/[0.04] border border-neon-green/40 backdrop-blur-xl shadow-[0_0_0_1px_rgba(0,255,148,0.22),0_0_28px_rgba(0,255,148,0.18)] font-black uppercase tracking-widest text-[10px] hover:bg-neon-green/10 hover:shadow-[0_0_0_1px_rgba(0,255,148,0.45),0_0_36px_rgba(0,255,148,0.28)] hover:scale-[1.03] active:scale-[0.98] transition-all"
                    >
                      {t(language, 'accept')}
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      <div className="flex-1 overflow-y-auto pt-6 px-3 space-y-6 no-scrollbar">
        {/* Special Offer Banner */}
        {!offerDismissed ? (
          <div className="px-1 mb-2">
            <div onClick={() => setNitroOpen(true)} className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-neon-purple/20 via-neon-pink/10 to-transparent border border-neon-purple/20 p-4 group cursor-pointer hover:border-neon-purple/40 transition-all">
              <button
                onClick={dismissOffer}
                className="absolute left-2 top-2 z-20 w-6 h-6 rounded-lg bg-black/35 border border-white/15 text-white/70 hover:text-white hover:bg-black/60 transition-all flex items-center justify-center"
                aria-label="Cerrar anuncio"
                title="Cerrar anuncio"
              >
                <X size={12} />
              </button>
              <div className="absolute top-0 right-0 w-24 h-24 bg-neon-purple/10 blur-2xl rounded-full -mr-8 -mt-8" />
              <div className="relative z-10">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles size={14} className="text-neon-purple animate-pulse" />
                  <span className="text-[10px] font-black text-white uppercase tracking-widest">Special Event</span>
                </div>
                <h4 className="text-xs font-black text-white mb-1 uppercase tracking-tight">Free Nitro Forever</h4>
                <p className="text-[9px] text-[#4E5058] font-black uppercase tracking-[0.2em] group-hover:text-neon-purple transition-colors">Claim Subscription Now //</p>
              </div>
            </div>
          </div>
        ) : null}

        <div className="space-y-3">
          <button
            onClick={() => {
              setActiveServer(null);
              setActiveChannel(null);
            }}
            className={cn(
              "flex items-center gap-3 w-full px-4 py-3 rounded-xl transition-all group border apple-smooth",
              activeServerId === null && activeChannelId === null
                ? "text-white bg-white/[0.05] border-white/[0.1] shadow-xl apple-glass-surface"
                : "text-[#B5BAC1] border-transparent hover:bg-white/[0.03] hover:text-white hover:border-white/[0.05]"
            )}
          >
            <div className="w-10 h-10 rounded-xl bg-white/[0.03] flex items-center justify-center group-hover:bg-neon-blue/10 group-hover:text-neon-blue transition-all">
              <Users size={20} />
            </div>
            <span className="font-black text-sm tracking-tight">{dmHomeLabel}</span>
          </button>

          {/* Filtros de amigos — una sola zona de filtrado */}
          <div className="px-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[9px] font-black text-[#4E5058] uppercase tracking-[0.2em]">
                {filteredFriends.length} {friendFilter !== 'all' ? `/ ${friendById.size}` : ''} contactos
              </span>
              {totalUnreadCount > 0 && (
                <span className="px-2 py-0.5 rounded-md border border-white/[0.12] bg-white/[0.03] text-[9px] font-black uppercase tracking-widest text-white/70">
                  {Math.min(totalUnreadCount, 999)} no leídos
                </span>
              )}
              {(dmRequestsIncoming.length + dmRequestsOutgoing.length) > 0 && (
                <span className="px-2 py-0.5 rounded-md border border-neon-pink/30 bg-neon-pink/10 text-[9px] font-black uppercase tracking-widest text-neon-pink">
                  {dmRequestsIncoming.length + dmRequestsOutgoing.length} pendientes
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(['all', 'pinned', 'online', 'idle', 'dnd', 'offline'] as const).map((filterKey) => {
                const active = friendFilter === filterKey;
                const label =
                  filterKey === 'all'
                    ? t(language, 'friends_all')
                    : filterKey === 'pinned'
                      ? 'Anclados'
                      : statusInfo[filterKey].label;
                return (
                  <button
                    key={filterKey}
                    onClick={() => setFriendFilter(filterKey)}
                    className={cn(
                      "px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all apple-smooth",
                      active
                        ? "bg-white/[0.06] border-white/[0.16] text-white apple-glass-surface"
                        : "bg-white/[0.02] border-white/[0.06] text-[#949BA4] hover:text-white hover:bg-white/[0.04]"
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {(dmRequestsIncoming.length > 0 || dmRequestsOutgoing.length > 0) && (
          <div className="space-y-2">
            <div className="px-4 text-[9px] font-black text-[#4E5058] uppercase tracking-[0.2em] mb-3">{t(language, 'pending_requests')}</div>

            {dmRequestsIncoming.map((req) => {
              const from = users.find((u) => u.id === req.fromUserId);
              const fromLabel = getUserLabel(from, req.fromUserId);
              return (
                <div key={`incoming-request-${req.id}-${req.fromUserId}-${req.toUserId}`} className="flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.02] border border-white/[0.05] apple-glass-surface mac-scale-enter">
                  <div className="min-w-0">
                    <div className="text-white font-black text-sm truncate">{fromLabel}</div>
                    <div className="text-[#4E5058] text-[9px] font-black uppercase tracking-widest">{t(language, 'incoming')}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        rejectDMRequest(req.id);
                        setIncomingPopupId(null);
                      }}
                      className="px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06] text-white font-black uppercase tracking-widest text-[9px] hover:bg-white/[0.06] transition-all"
                    >
                      {t(language, 'reject')}
                    </button>
                    <button
                      onClick={() => {
                        acceptDMRequest(req.id);
                        setIncomingPopupId(null);
                      }}
                      className="px-3 py-2 rounded-xl bg-neon-blue text-white font-black uppercase tracking-widest text-[9px] hover:scale-[1.02] active:scale-[0.98] transition-all"
                    >
                      {t(language, 'accept')}
                    </button>
                  </div>
                </div>
              );
            })}

            {dmRequestsOutgoing.map((req) => {
              const to = users.find((u) => u.id === req.toUserId);
              const toLabel = getUserLabel(to, req.toUserId);
              return (
                <div key={`outgoing-request-${req.id}-${req.fromUserId}-${req.toUserId}`} className="flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.02] border border-white/[0.05] apple-glass-surface mac-scale-enter">
                  <div className="min-w-0">
                    <div className="text-white font-black text-sm truncate">{toLabel}</div>
                    <div className="text-[#4E5058] text-[9px] font-black uppercase tracking-widest">{t(language, 'outgoing')}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-[#949BA4] text-[10px] font-black uppercase tracking-widest">Pending</div>
                    <button
                      onClick={() => cancelDMRequest(req.id)}
                      className="px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06] text-white font-black uppercase tracking-widest text-[9px] hover:bg-white/[0.06] transition-all"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="space-y-2">
          <div className="px-4 text-[9px] font-black text-[#4E5058] uppercase tracking-[0.2em] mb-4">{t(language, 'active_chats')}</div>

          {dmGroupsSorted.map((group) => {
            const dmPeer = getDmPeer(group);
            const dmLabel = getDmLabel(group);
            const avatarInitial = dmLabel[0]?.toUpperCase() || '?';
            const isPinned = pinnedDmSet.has(group.id);
            const unread = unreadByChannel.get(group.id);
            return (
              <button
                key={`dm-group-${group.id}-${dmPeer?.id || 'unknown'}`}
                onClick={() => {
                  setActiveServer(null);
                  setActiveChannel(group.id);
                }}
                className={cn(
                  "relative flex items-center gap-3 w-full px-4 py-3 rounded-xl transition-all border group apple-smooth",
                  activeServerId === null && activeChannelId === group.id
                    ? "bg-white/[0.05] border-white/[0.1] text-white shadow-xl apple-glass-surface"
                    : "bg-transparent border-transparent text-[#4E5058] hover:text-[#B5BAC1] hover:bg-white/[0.02]"
                )}
              >
                <div className="relative">
                  <div
                    className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center transition-all",
                      activeServerId === null && activeChannelId === group.id ? "bg-neon-purple/20 text-neon-purple shadow-[0_0_20px_rgba(90,16,35,0.2)]" : "bg-white/[0.03] text-[#4E5058]"
                    )}
                  >
                    {dmPeer?.avatar ? (
                      <img
                        src={dmPeer.avatar}
                        alt={dmLabel}
                        className="w-full h-full rounded-xl object-cover"
                      />
                    ) : (
                      <span className="text-sm font-black">{avatarInitial}</span>
                    )}
                  </div>
                  <div className={cn("absolute -bottom-1 -right-1 w-3 h-3 border-2 border-[#0A0A0B] rounded-full", statusInfo[getResolvedStatus(dmPeer?.id || '', dmPeer?.status || 'offline')].dot)} />
                </div>
                <span className="truncate font-black text-sm tracking-tight">{dmLabel}</span>

                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      togglePinnedDM(group.id);
                    }}
                    className={cn(
                      "w-7 h-7 rounded-xl flex items-center justify-center border transition-all apple-smooth",
                      isPinned
                        ? "bg-neon-purple/15 border-neon-purple/35 text-neon-purple"
                        : "bg-white/[0.02] border-white/[0.06] text-white/60 hover:text-white hover:bg-white/[0.06]"
                    )}
                    title={isPinned ? 'Desanclar chat' : 'Anclar chat'}
                  >
                    <Pin size={13} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeDM(group.id);
                    }}
                    className={cn(
                      "w-7 h-7 rounded-xl flex items-center justify-center transition-all apple-smooth",
                      "bg-white/[0.02] border border-white/[0.06] text-white/60 hover:text-neon-pink hover:border-neon-pink/40 hover:bg-neon-pink/10",
                      "hover:scale-110 active:scale-95"
                    )}
                    title="Eliminar chat"
                  >
                    <X size={14} />
                  </button>
                </div>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none group-hover:opacity-0 transition-opacity">
                  {unread?.mentions ? (
                    <div className="h-5 px-1.5 rounded-md border border-neon-pink/45 bg-neon-pink/15 text-neon-pink text-[9px] font-black uppercase tracking-widest inline-flex items-center justify-center">
                      @{Math.min(unread.mentions, 99)}
                    </div>
                  ) : null}
                  {unread?.unread ? (
                    <div className="min-w-[20px] h-5 px-1.5 rounded-md border border-neon-blue/45 bg-neon-blue/15 text-neon-blue text-[9px] font-black uppercase tracking-widest inline-flex items-center justify-center">
                      {Math.min(unread.unread, 99)}
                    </div>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <UserBar />

      <ProfilePreviewModal
        isOpen={profilePreviewOpen}
        onClose={() => setProfilePreviewOpen(false)}
        onSettings={() => onOpenSettings('profile')}
      />
    </div>
  );

  return (
    <div className="w-[260px] max-sm:w-[calc(100vw-74px)] bg-[#0A0A0B] glass-ruby-shell flex flex-col h-full overflow-hidden border-r border-white/[0.03]">
      <button
        onClick={() => setServerOptionsOpen(true)}
        className={cn(
          'relative px-6 border-b border-white/[0.03] flex items-center justify-between transition-all group bg-white/[0.01] overflow-hidden glass-ruby-strip apple-smooth',
          activeServer.banner ? 'h-24' : 'h-16',
          activeServer.banner ? 'hover:bg-white/[0.03]' : 'hover:bg-white/[0.02]'
        )}
        style={
          activeServer.accentColor
            ? { boxShadow: `inset 0 0 0 1px ${activeServer.accentColor}33` }
            : undefined
        }
      >
        {activeServer.banner ? (
          <div className="absolute inset-0 h-24 overflow-hidden">
            <img
              src={activeServer.banner}
              alt={`${activeServer.name} banner`}
              className="w-full h-full object-cover"
              loading="eager"
              decoding="sync"
              draggable={false}
            />
            <div className="absolute inset-0 bg-[#0A0A0B]/55" />
          </div>
        ) : null}
        <div className="relative z-10 flex items-center min-w-0">
          <div className="flex flex-col items-start min-w-0">
            <h2 className="text-white font-black text-sm truncate tracking-tight group-hover:text-neon-purple transition-colors">{activeServer.name}</h2>
            <div className="text-[9px] text-[#4E5058] font-black uppercase tracking-[0.2em] mt-0.5 flex items-center gap-1">
              <Sparkles size={8} className="text-neon-purple" />
              {activeServer.tag ? `Tag ${activeServer.tag}` : 'Verified Node'}
            </div>
            {activeServer.description ? (
              <div className="text-[9px] text-[#6b727b] font-bold mt-0.5 truncate max-w-[180px]">
                {activeServer.description}
              </div>
            ) : null}
          </div>
        </div>
        <ChevronDown size={16} className="relative z-10 text-[#4E5058] group-hover:text-white transition-all flex-shrink-0" />
      </button>

      <div className="flex-1 overflow-y-auto pt-6 px-3 space-y-8 no-scrollbar">
        {/* Special Offer Banner */}
        {!offerDismissed ? (
          <div className="px-1 mb-2">
            <div onClick={() => setNitroOpen(true)} className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-neon-blue/20 via-neon-purple/10 to-transparent border border-neon-blue/20 p-4 group cursor-pointer hover:border-neon-blue/40 transition-all">
              <button
                onClick={dismissOffer}
                className="absolute left-2 top-2 z-20 w-6 h-6 rounded-lg bg-black/35 border border-white/15 text-white/70 hover:text-white hover:bg-black/60 transition-all flex items-center justify-center"
                aria-label="Cerrar anuncio"
                title="Cerrar anuncio"
              >
                <X size={12} />
              </button>
              <div className="absolute top-0 right-0 w-24 h-24 bg-neon-blue/10 blur-2xl rounded-full -mr-8 -mt-8" />
              <div className="relative z-10">
                <div className="flex items-center gap-2 mb-2">
                  <Zap size={14} className="text-neon-blue animate-pulse" />
                  <span className="text-[10px] font-black text-white uppercase tracking-widest">Limited Offer</span>
                </div>
                <h4 className="text-xs font-black text-white mb-1 uppercase tracking-tight">Free Nitro Forever</h4>
                <p className="text-[9px] text-[#4E5058] font-black uppercase tracking-[0.2em] group-hover:text-neon-blue transition-colors">Access Protocol // 0.00$</p>
              </div>
            </div>
          </div>
        ) : null}

        {!domReady ? (
          <div className="mx-1 h-10 rounded-xl border border-white/[0.06] bg-white/[0.01]" aria-hidden="true" />
        ) : topUnreadServerChannel.total > 0 && topUnreadServerChannel.channelId ? (
          <button
            onClick={() => {
              setActiveChannel(topUnreadServerChannel.channelId);
              setToast(language === 'es' ? 'Saltaste a no leidos' : 'Jumped to unread');
            }}
            className="mx-1 h-10 px-4 rounded-xl border border-neon-blue/30 bg-neon-blue/10 text-neon-blue hover:bg-neon-blue/15 transition-all apple-glass-surface apple-smooth inline-flex items-center justify-between gap-3"
            title="Ir al canal con actividad (Alt+Shift+U)"
          >
            <span className="text-[10px] font-black uppercase tracking-widest">No leidos</span>
            <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest">
              {Math.min(topUnreadServerChannel.total, 999)}
              <span className="px-1.5 py-0.5 rounded-md border border-neon-blue/35 bg-black/30 text-[8px]">A+U</span>
            </span>
          </button>
        ) : null}

        <div className="mx-1 grid grid-cols-2 gap-2">
          <button
            onClick={toggleAllCategoryCollapse}
            className="h-9 px-3 rounded-xl border border-white/[0.12] bg-white/[0.03] text-white/85 hover:text-white hover:bg-white/[0.06] transition-all apple-glass-surface apple-smooth inline-flex items-center justify-center gap-2"
            title="Colapsar o expandir categorias"
          >
            <ChevronsUpDown size={12} className="text-neon-blue" />
            <span className="text-[9px] font-black uppercase tracking-widest">Categorias</span>
          </button>
          <button
            onClick={markActiveServerAsRead}
            className="h-9 px-3 rounded-xl border border-white/[0.14] bg-white/[0.03] text-white/80 hover:bg-white/[0.07] hover:text-white transition-all apple-glass-surface apple-smooth inline-flex items-center justify-center gap-2"
            title="Marcar servidor como leido"
          >
            <CheckCheck size={12} />
            <span className="text-[9px] font-black uppercase tracking-widest">Leido</span>
          </button>
        </div>

        {activeServer.categories.map((category) => {
          const categoryCollapseKey = getCategoryCollapseKey(activeServer.id, category.id);
          const categoryCollapsed = Boolean(isCategoryCollapsed[categoryCollapseKey]);
          const categoryStats = categoryUnreadStats[category.id] || { unread: 0, mentions: 0 };
          return (
            <div key={`category-${activeServer.id}-${category.id}`} className="space-y-1">
              <div className="flex items-center justify-between px-4 mb-2 group">
                <button
                  onClick={() =>
                    setCategoryCollapsed((prev) => ({
                      ...prev,
                      [categoryCollapseKey]: !prev[categoryCollapseKey],
                    }))
                  }
                  className="flex items-center text-[10px] font-black text-[#4E5058] hover:text-[#B5BAC1] uppercase tracking-[0.2em] transition-all"
                >
                  <ChevronDown size={10} className={cn("mr-2 transition-transform duration-300", categoryCollapsed && "-rotate-90")} />
                  {category.name}
                  {categoryStats.mentions > 0 ? (
                    <span className="ml-2 h-4 px-1 rounded-md border border-neon-pink/45 bg-neon-pink/15 text-neon-pink text-[8px] font-black tracking-widest inline-flex items-center justify-center">
                      @{Math.min(categoryStats.mentions, 99)}
                    </span>
                  ) : null}
                  {categoryStats.unread > 0 ? (
                    <span className="ml-1 h-4 px-1 rounded-md border border-neon-blue/45 bg-neon-blue/15 text-neon-blue text-[8px] font-black tracking-widest inline-flex items-center justify-center">
                      {Math.min(categoryStats.unread, 999)}
                    </span>
                  ) : null}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setCreateCategoryId(category.id);
                    setCreateOpen(true);
                  }}
                  className="w-5 h-5 rounded-md bg-white/[0.03] flex items-center justify-center text-[#4E5058] hover:bg-white/10 hover:text-white transition-all opacity-0 group-hover:opacity-100"
                >
                  <Plus size={12} />
                </button>
              </div>

              {!categoryCollapsed && category.channels.map((channel) => {
                const voiceParticipants = channel.type === 'voice' ? getVoiceChannelParticipants(channel.id) : [];
                const unread = unreadByChannel.get(channel.id);
                return (
                  <div key={`channel-${activeServer.id}-${category.id}-${channel.id}`} className="space-y-1">
                    <div
                      className={cn(
                        "group flex items-center w-full px-4 py-2.5 rounded-xl transition-all border apple-smooth",
                        activeChannelId === channel.id
                          ? "bg-white/[0.05] border-white/[0.1] text-white shadow-lg apple-glass-surface"
                          : "bg-transparent border-transparent text-[#4E5058] hover:text-[#B5BAC1] hover:bg-white/[0.02]"
                      )}
                    >
                      <button
                        type="button"
                        ref={(node) => {
                          channelButtonRefs.current[channel.id] = node;
                        }}
                        tabIndex={focusedChannelNavId === channel.id ? 0 : -1}
                        onClick={() => setActiveChannel(channel.id)}
                        onFocus={() => setFocusedChannelNavId(channel.id)}
                        onKeyDown={(event) => handleChannelNavKeyDown(event, channel.id)}
                        aria-current={activeChannelId === channel.id ? 'page' : undefined}
                        aria-label={`${channel.type === 'voice' ? 'Canal de voz' : 'Canal de texto'} ${channel.name}`}
                        onContextMenu={(e) => {
                          if (!developerMode) return;
                          e.preventDefault();
                          setChannelContextMenu({ channelId: channel.id, x: e.clientX, y: e.clientY });
                        }}
                        className="flex items-center flex-1 min-w-0 text-left"
                      >
                        <div className={cn(
                          "w-8 h-8 rounded-lg flex items-center justify-center mr-3 transition-all",
                          activeChannelId === channel.id ? "bg-white/[0.05] text-white" : "text-[#4E5058] group-hover:text-[#B5BAC1]"
                        )}>
                          {channel.type === 'voice' ? <Volume2 size={16} /> : <Hash size={16} />}
                        </div>
                        <span className="font-black text-sm tracking-tight truncate">{channel.name}</span>
                      </button>
                      <div className="ml-auto flex items-center gap-1.5">
                        {unread?.mentions ? (
                          <div className="h-5 px-1.5 rounded-md border border-neon-pink/45 bg-neon-pink/15 text-neon-pink text-[9px] font-black uppercase tracking-widest inline-flex items-center justify-center pointer-events-none group-hover:opacity-0 transition-opacity">
                            @{Math.min(unread.mentions, 99)}
                          </div>
                        ) : null}
                        {unread?.unread ? (
                          <div className="min-w-[20px] h-5 px-1.5 rounded-md border border-neon-blue/45 bg-neon-blue/15 text-neon-blue text-[9px] font-black uppercase tracking-widest inline-flex items-center justify-center pointer-events-none group-hover:opacity-0 transition-opacity">
                            {Math.min(unread.unread, 99)}
                          </div>
                        ) : null}
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              setEditingChannelId(channel.id);
                              setChannelSettingsOpen(true);
                            }}
                            className="w-6 h-6 rounded-md border border-white/[0.08] bg-white/[0.03] text-[#B5BAC1] hover:text-white hover:bg-white/[0.08] transition-all flex items-center justify-center apple-smooth apple-glass-surface"
                            title="Ajustes del canal"
                          >
                            <Settings size={11} />
                          </button>
                          <div className="opacity-40 hover:opacity-100 transition-opacity">
                            <Command size={12} />
                          </div>
                        </div>
                      </div>
                    </div>

                    {channel.type === 'voice' && voiceParticipants.length > 0 ? (
                      <div className="ml-12 mb-2 space-y-1.5">
                        {voiceParticipants.slice(0, 7).map(({ user, status, muted, deafened }) => (
                          <button
                            key={`${channel.id}-${user.id}`}
                            onClick={() => setActiveChannel(channel.id)}
                            className="w-full flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[#949BA4] hover:text-white hover:bg-white/[0.03] transition-all apple-smooth"
                            title={getUserLabel(user, user.id)}
                          >
                            <div className="relative w-5 h-5 rounded-md overflow-hidden bg-white/[0.04] flex-shrink-0">
                              {user.avatar ? (
                                <img src={user.avatar} alt={user.username} className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-[10px] font-black text-white">
                                  {user.username[0]?.toUpperCase() || '?'}
                                </div>
                              )}
                              <div className={cn("absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-[#0A0A0B]", statusInfo[status].dot)} />
                            </div>
                            <span className="truncate text-[11px] font-black tracking-tight">{getUserLabel(user, user.id)}</span>
                            {(muted || deafened) ? (
                              <div className="ml-auto flex items-center gap-1 opacity-80">
                                {muted ? <Mic size={11} className="text-neon-pink" /> : null}
                                {deafened ? <Headphones size={11} className="text-neon-pink" /> : null}
                              </div>
                            ) : null}
                          </button>
                        ))}
                        {voiceParticipants.length > 7 ? (
                          <div className="px-2 text-[9px] font-black uppercase tracking-widest text-[#4E5058]">
                            +{voiceParticipants.length - 7} conectados
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {developerMode && channelContextMenu ? (
        <div
          className="fixed z-[500] min-w-[190px] rounded-xl backdrop-blur-xl p-1.5 shadow-2xl apple-glass-popover mac-scale-enter"
          style={{ left: channelContextMenu.x, top: channelContextMenu.y }}
        >
          <button
            onClick={() => void copyChannelId(channelContextMenu.channelId)}
            className="w-full px-3 py-2 rounded-lg text-left text-sm text-white/85 hover:bg-white/[0.06] transition-colors flex items-center justify-between gap-3"
          >
            <span>{t(language, 'copy_id')}</span>
            {copiedChannelId === channelContextMenu.channelId ? <Check size={14} className="text-neon-green" /> : <Copy size={14} />}
          </button>
        </div>
      ) : null}

      <UserBar />

      <NitroModal open={nitroOpen} onClose={() => setNitroOpen(false)} />

      {domReady
        ? createPortal(
          <CreateChannelModal
            open={createOpen}
            serverName={activeServer.name}
            categoryName={activeServer.categories.find(c => c.id === createCategoryId)?.name || 'Category'}
            onClose={() => setCreateOpen(false)}
            onCreate={(input) => {
              if (!activeServerId || !createCategoryId) return;
              const newId = createChannel(activeServerId, createCategoryId, input);
              setActiveChannel(newId);
            }}
          />,
          document.body
        )
        : null}

      {domReady
        ? createPortal(
          <ChannelSettingsModal
            open={channelSettingsOpen}
            serverId={activeServerId}
            channelId={editingChannelId}
            onClose={() => {
              setChannelSettingsOpen(false);
              setEditingChannelId(null);
            }}
          />,
          document.body
        )
        : null}

      <ProfilePreviewModal
        isOpen={profilePreviewOpen}
        onClose={() => setProfilePreviewOpen(false)}
        onSettings={() => onOpenSettings('profile')}
      />

      <ServerOptionsModal
        isOpen={serverOptionsOpen}
        onClose={() => setServerOptionsOpen(false)}
        serverId={activeServerId}
        onOpenServerSettings={() => onOpenSettings('server')}
      />
    </div>
  );
};
