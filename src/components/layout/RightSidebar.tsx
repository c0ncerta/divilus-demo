import React, { useState, useMemo, useRef } from 'react';
import { useStore } from '../../lib/store';
import { cn } from '../../lib/utils';
import { hasPermission } from '../../lib/permissions';
import { getMemberRoles, getPrimaryMemberRole, getRoleNamePresentation, getRoleSolidColor } from '../../lib/role-style';
import { CrewBadge } from '../ui/CrewBadge';
import { 
  ShieldCheck, Zap, Bot, Circle, Info, Pin, Link as LinkIcon, 
  Image as ImageIcon, X, Mail, Calendar, Hash, ExternalLink, Copy, Check, Clock3, LogOut, Ban,
  ChevronRight, MessageSquare, UserPlus, Crown
} from 'lucide-react';

const URL_REGEX = /https?:\/\/[^\s<>"')]+/gi;
const IMAGE_EXT_REGEX = /\.(png|jpe?g|gif|webp|bmp|svg|avif)(\?.*)?$/i;
const SERVER_TAG_PROFILE_STORAGE_KEY = 'diavlocord-server-tag-profile-v1';
const SERVER_TAG_GLYPHS: Record<string, string> = {
  leaf: '\u{1F343}',
  swords: '\u2694\uFE0F',
  heart: '\u{1F497}',
  fire: '\u{1F525}',
  water: '\u{1F4A7}',
  skull: '\u{1F480}',
  moon: '\u{1F319}',
  bolt: '\u26A1',
  spark: '\u2728',
  mushroom: '\u{1F344}',
  crown: '\u{1F451}',
  gem: '\u{1F48E}',
  shield: '\u{1F6E1}\uFE0F',
  star: '\u2B50',
  rocket: '\u{1F680}',
};

type ServerTagProfile = {
  enabled: boolean;
  adopted: boolean;
  name: string;
  badgeId: string;
  color: string;
};

const normalizeServerTag = (value: string) =>
  value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);

const readServerTagProfile = (serverId: string, userId: string): ServerTagProfile | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`${SERVER_TAG_PROFILE_STORAGE_KEY}:${userId}:${serverId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ServerTagProfile>;
    const normalizedName = normalizeServerTag(parsed.name || '');
    if (!parsed.enabled || !parsed.adopted || normalizedName.length === 0) return null;
    const color = typeof parsed.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(parsed.color)
      ? parsed.color.toUpperCase()
      : '#AE8FF7';
    const badgeId = typeof parsed.badgeId === 'string' ? parsed.badgeId : 'leaf';
    return {
      enabled: true,
      adopted: true,
      name: normalizedName,
      badgeId,
      color,
    };
  } catch {
    return null;
  }
};

const extractTextUrls = (input: string): string[] => {
  if (!input) return [];
  const matches = input.match(URL_REGEX);
  return matches ? matches.map((entry) => entry.trim()) : [];
};

const isImageLikeAttachment = (contentType?: string, url?: string): boolean => {
  if (contentType && contentType.startsWith('image/')) return true;
  if (!url) return false;
  return IMAGE_EXT_REGEX.test(url);
};

const getCompactUrlLabel = (rawUrl: string): string => {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.replace(/^www\./i, '');
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    return `${host}${path}`.slice(0, 40);
  } catch {
    return rawUrl.slice(0, 40);
  }
};

export const RightSidebar = () => {
  const { servers, activeServerId, presences, selectedUserId, setSelectedUserId, activeChannelId, setActiveChannel, messages, rightSidebarView, setRightSidebarView, setRightSidebarOpen, users, currentUser, developerMode, memberTimeouts, timeoutMember, clearMemberTimeout, kickMember, banMember, dmGroups, sendDMRequest } = useStore();
  const [copiedUserId, setCopiedUserId] = useState<string | null>(null);
  const [userContextMenu, setUserContextMenu] = useState<{ userId: string; x: number; y: number } | null>(null);
  const [modToast, setModToast] = useState<string>('');
  const [tagCardOpen, setTagCardOpen] = useState(false);
  const tagCardRef = useRef<HTMLDivElement | null>(null);
  
  const activeServer = servers.find(s => s.id === activeServerId);
  const activeChannel = activeServer?.categories?.flatMap(c => c.channels).find(ch => ch.id === activeChannelId);
  const activeDmGroup = dmGroups.find((g) => g.id === activeChannelId) || null;
  const isDmChannel = Boolean(activeDmGroup);
  const activeDmPeerId = activeDmGroup
    ? activeDmGroup.memberIds.find((id) => id !== currentUser.id) || activeDmGroup.memberIds[0] || null
    : null;

  const pinnedMessages = useMemo(() => {
    return (messages[activeChannelId || ''] || []).filter(m => m.isPinned);
  }, [messages, activeChannelId]);

  const channelMessages = useMemo(() => messages[activeChannelId || ''] || [], [messages, activeChannelId]);

  const sharedLinks = useMemo(() => {
    const seen = new Set<string>();
    const links: Array<{ id: string; url: string; title: string; authorId: string }> = [];
    for (const msg of [...channelMessages].reverse()) {
      const textUrls = extractTextUrls(msg.content || '');
      for (const url of textUrls) {
        const key = url.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        links.push({
          id: `${msg.id}:${links.length}`,
          url,
          title: getCompactUrlLabel(url),
          authorId: msg.authorId,
        });
        if (links.length >= 24) return links;
      }

      for (const att of msg.attachments || []) {
        const url = att.url;
        if (!url) continue;
        const key = url.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        links.push({
          id: `${msg.id}:att:${att.id}`,
          url,
          title: att.filename || getCompactUrlLabel(url),
          authorId: msg.authorId,
        });
        if (links.length >= 24) return links;
      }
    }
    return links;
  }, [channelMessages]);

  const sharedMedia = useMemo(() => {
    const seen = new Set<string>();
    const media: Array<{ id: string; url: string; authorId: string }> = [];
    for (const msg of [...channelMessages].reverse()) {
      for (const att of msg.attachments || []) {
        if (!att?.url || !isImageLikeAttachment(att.contentType, att.url)) continue;
        const key = att.url.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        media.push({ id: `${msg.id}:att:${att.id}`, url: att.url, authorId: msg.authorId });
        if (media.length >= 18) return media;
      }

      const textUrls = extractTextUrls(msg.content || '');
      for (const url of textUrls) {
        if (!isImageLikeAttachment(undefined, url)) continue;
        const key = url.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        media.push({ id: `${msg.id}:url:${media.length}`, url, authorId: msg.authorId });
        if (media.length >= 18) return media;
      }
    }
    return media;
  }, [channelMessages]);

  const storeUserById = useMemo(() => {
    const map = new Map<string, any>();
    for (const u of users) map.set(u.id, u);
    map.set(currentUser.id, currentUser);
    return map;
  }, [users, currentUser]);

  const getUser = (userId: string, contextServer = activeServer || undefined) => {
    const u = storeUserById.get(userId);
    if (!u) return null;
    const memberRoles = getMemberRoles(contextServer, userId);
    const primaryRole = getPrimaryMemberRole(contextServer, userId);
    const namePresentation = getRoleNamePresentation(primaryRole);
    const joinedAtFromServer = contextServer?.members.find((m) => m.userId === userId)?.joinedAt;
    return {
      ...u,
      bio: u.bio ?? '',
      joinedAt: joinedAtFromServer ?? u.joinedAt ?? u.createdAt ?? '',
      bannerColor: u.bannerColor ?? u.color ?? '#0A0A0B',
      color: getRoleSolidColor(primaryRole, u.color || '#B5BAC1'),
      roleNames: memberRoles.map((r) => r.name),
      roleObjects: memberRoles,
      primaryRole,
      isOwner: Boolean(contextServer?.ownerId === userId),
      nameClassName: namePresentation.className,
      nameStyle: namePresentation.style,
    };
  };

  const selectedUser = selectedUserId ? getUser(selectedUserId, isDmChannel ? undefined : (activeServer || undefined)) : null;
  const dmPeerUser = activeDmPeerId ? getUser(activeDmPeerId, undefined) : null;
  const profileUser = selectedUser || (isDmChannel ? dmPeerUser : null);
  const resolvePresenceStatus = (userId?: string, fallback: 'online' | 'idle' | 'dnd' | 'offline' = 'offline') =>
    (userId ? (presences[userId]?.status || storeUserById.get(userId)?.status || fallback) : fallback) as
      | 'online'
      | 'idle'
      | 'dnd'
      | 'offline';
  const statusDotClass = (status: 'online' | 'idle' | 'dnd' | 'offline') =>
    status === 'online' ? 'bg-neon-green' : status === 'idle' ? 'bg-neon-blue' : status === 'dnd' ? 'bg-neon-pink' : 'bg-[#4E5058]';
  const profileStatus = resolvePresenceStatus(profileUser?.id, 'offline');
  const profileDmGroup = profileUser
    ? dmGroups.find((group) => {
        if (group.memberIds.length !== 2) return false;
        const ids = new Set(group.memberIds);
        return ids.has(currentUser.id) && ids.has(profileUser.id);
      }) || null
    : null;

  const memberTagProfiles = useMemo(() => {
    if (!activeServer || typeof window === 'undefined') return new Map<string, ServerTagProfile>();
    const map = new Map<string, ServerTagProfile>();
    for (const member of activeServer.members || []) {
      const profile = readServerTagProfile(activeServer.id, member.userId);
      if (profile) map.set(member.userId, profile);
    }
    return map;
  }, [activeServer?.id, activeServer?.members]);

  const profileTag = profileUser && activeServer && !isDmChannel
    ? memberTagProfiles.get(profileUser.id) || null
    : null;

  const copyUserId = async (userId: string) => {
    try {
      await navigator.clipboard.writeText(userId);
      setCopiedUserId(userId);
      setTimeout(() => setCopiedUserId(null), 1500);
      setUserContextMenu(null);
    } catch {}
  };

  React.useEffect(() => {
    if (!userContextMenu) return;
    const close = () => setUserContextMenu(null);
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
  }, [userContextMenu]);

  React.useEffect(() => {
    if (!modToast) return;
    const id = setTimeout(() => setModToast(''), 1400);
    return () => clearTimeout(id);
  }, [modToast]);

  React.useEffect(() => {
    if (!tagCardOpen) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!tagCardRef.current || !target) return;
      if (!tagCardRef.current.contains(target)) {
        setTagCardOpen(false);
      }
    };
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTagCardOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [tagCardOpen]);

  React.useEffect(() => {
    setTagCardOpen(false);
  }, [selectedUserId, activeServerId, activeChannelId]);

  if (!activeServer && !isDmChannel) return null;

  const roles = activeServer ? [...activeServer.roles].sort((a, b) => (b.position || 0) - (a.position || 0)) : [];
  const ungroupedMembers = roles.length > 0
    ? (activeServer?.members || []).filter(m => !roles.some(r => m.roleIds.includes(r.id)))
    : (activeServer?.members || []);
  const canTimeout = !!activeServer && (activeServer.ownerId === currentUser.id || hasPermission(activeServer, activeChannel, currentUser.id, 'MANAGE_MESSAGES'));
  const canKickBan = !!activeServer && (activeServer.ownerId === currentUser.id || hasPermission(activeServer, activeChannel, currentUser.id, 'MANAGE_SERVER'));

  const getTimeoutUntil = (userId: string) => (activeServer ? memberTimeouts[`${activeServer.id}:${userId}`] : undefined);
  const isTimedOut = (userId: string) => {
    const until = getTimeoutUntil(userId);
    return !!until && new Date(until).getTime() > Date.now();
  };

  const runModeration = (action: 'timeout' | 'untimeout' | 'kick' | 'ban', userId: string) => {
    if (!activeServer) return;
    const targetIsOwner = activeServer.ownerId === userId;
    const targetIsSelf = currentUser.id === userId;
    if (targetIsOwner || targetIsSelf) return;
    if (action === 'timeout' && canTimeout) {
      timeoutMember(activeServer.id, userId, 5);
      setModToast('Usuario silenciado 5 minutos');
    }
    if (action === 'untimeout' && canTimeout) {
      clearMemberTimeout(activeServer.id, userId);
      setModToast('Timeout eliminado');
    }
    if (action === 'kick' && canKickBan) {
      kickMember(activeServer.id, userId);
      setModToast('Usuario expulsado del servidor');
    }
    if (action === 'ban' && canKickBan) {
      banMember(activeServer.id, userId, 'Moderacion');
      setModToast('Usuario baneado del servidor');
    }
    setUserContextMenu(null);
  };

  const handleProfileDmAction = (openExistingOnly: boolean) => {
    if (!profileUser) return;
    if (profileUser.id === currentUser.id) {
      setModToast('No puedes abrir un DM contigo mismo');
      return;
    }

    if (profileDmGroup?.id) {
      setActiveChannel(profileDmGroup.id);
      if (!isDmChannel) setModToast('DM abierto');
      return;
    }

    if (openExistingOnly) {
      setModToast('Aun no tienes un DM activo con este usuario');
      return;
    }

    const result = sendDMRequest(profileUser.id);
    if (!result.ok) {
      if (result.reason === 'pending') {
        setModToast('Solicitud pendiente');
      } else if (result.reason === 'self') {
        setModToast('No puedes agregarte a ti mismo');
      } else {
        setModToast('No se pudo enviar la solicitud');
      }
      return;
    }
    setModToast('Solicitud de DM enviada');
  };

  return (
    <div className="w-[300px] bg-[#0A0A0B] glass-ruby-shell flex flex-col h-full overflow-hidden border-l border-white/[0.03] animate-in slide-in-from-right duration-300">
      {/* Header Tabs */}
      <div className="h-16 px-4 border-b border-white/[0.03] glass-ruby-strip flex items-center gap-2 bg-white/[0.01]">
        {isDmChannel ? (
          <div className="w-full flex items-center gap-2">
            <div className="flex-1 py-2 rounded-xl text-center text-[9px] font-black uppercase tracking-[0.2em] bg-white/[0.05] text-white">
              Direct Profile
            </div>
            <button
              onClick={() => setRightSidebarOpen(false)}
              className="w-8 h-8 rounded-lg border border-white/10 bg-white/[0.03] text-[#8b9198] hover:text-white hover:bg-white/[0.07] transition-colors flex items-center justify-center"
              title="Cerrar panel (Alt+4)"
              aria-label="Cerrar panel lateral"
              type="button"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <>
            <button 
              onClick={() => { setRightSidebarView('members'); setSelectedUserId(null); }}
              className={cn(
                "flex-1 py-2 rounded-xl text-[9px] font-black uppercase tracking-[0.2em] transition-all",
                rightSidebarView === 'members' && !selectedUserId ? "bg-white/[0.05] text-white" : "text-[#4E5058] hover:text-[#B5BAC1]"
              )}
            >
              Members
            </button>
            <button 
              onClick={() => { setRightSidebarView('details'); setSelectedUserId(null); }}
              className={cn(
                "flex-1 py-2 rounded-xl text-[9px] font-black uppercase tracking-[0.2em] transition-all",
                rightSidebarView === 'details' && !selectedUserId ? "bg-white/[0.05] text-white" : "text-[#4E5058] hover:text-[#B5BAC1]"
              )}
            >
              Node Info
            </button>
            <button
              onClick={() => setRightSidebarOpen(false)}
              className="w-8 h-8 rounded-lg border border-white/10 bg-white/[0.03] text-[#8b9198] hover:text-white hover:bg-white/[0.07] transition-colors flex items-center justify-center"
              title="Cerrar panel (Alt+4)"
              aria-label="Cerrar panel lateral"
              type="button"
            >
              <X size={14} />
            </button>
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar relative">
        {profileUser ? (
          /* User Profile View */
          <div className="animate-in slide-in-from-right duration-300 h-full flex flex-col">
            <div className="h-24 w-full relative" style={{ backgroundColor: profileUser.bannerColor }}>
              {profileUser.banner && (
                <img
                  src={profileUser.banner}
                  alt="banner"
                  className="absolute inset-0 w-full h-full object-cover"
                />
              )}
              {selectedUserId ? (
                <button 
                  onClick={() => setSelectedUserId(null)}
                  className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/20 backdrop-blur-md flex items-center justify-center text-white hover:bg-black/40 transition-all"
                >
                  <X size={16} />
                </button>
              ) : null}
            </div>
            
            <div className="px-4 -mt-12 mb-6">
                <div className="relative inline-block">
                <div className="w-24 h-24 rounded-[32px] border-[6px] border-[#0A0A0B] bg-[#0A0A0B] p-1">
                  <div className="w-full h-full rounded-[24px] overflow-hidden bg-white/5">
                    {profileUser.avatar ? (
                      <img src={profileUser.avatar} alt={profileUser.username} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-3xl font-black text-white" style={{ color: profileUser.color }}>
                        {profileUser.username[0]}
                      </div>
                    )}
                  </div>
                </div>
                <div className={cn("absolute bottom-2 right-2 w-6 h-6 rounded-lg border-[4px] border-[#0A0A0B]", statusDotClass(profileStatus))} />
              </div>

              <div className="mt-4 p-4 rounded-3xl bg-white/[0.02] glass-ruby-surface border border-white/[0.05]">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className={cn("text-xl font-black tracking-tight", profileUser.nameClassName)} style={profileUser.nameStyle}>
                    {profileUser.username}
                  </h3>
                  {profileUser.isOwner && <Crown size={14} className="text-yellow-400" />}
                  {profileUser.isBot && <span className="bg-neon-blue/10 text-neon-blue text-[8px] px-1.5 py-0.5 rounded font-black tracking-widest uppercase">System</span>}
                  <span className="text-[9px] font-black uppercase tracking-[0.16em] text-[#9aa1aa] inline-flex items-center gap-1.5">
                    <span className={cn("w-2 h-2 rounded-full", statusDotClass(profileStatus))} />
                    {profileStatus === 'online' ? 'EN LINEA' : profileStatus === 'idle' ? 'AUSENTE' : profileStatus === 'dnd' ? 'OCUPADO' : 'DESCONECTADO'}
                  </span>
                </div>
                <div className="mb-2">
                  <CrewBadge userId={profileUser.id} size="sm" showName />
                </div>
                {activeServer && profileTag ? (
                  <div className="mb-2 relative" ref={tagCardRef}>
                    <button
                      onClick={() => setTagCardOpen((v) => !v)}
                      className="inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[10px] font-black uppercase tracking-[0.16em] transition-all hover:brightness-110"
                      style={{
                        color: profileTag.color,
                        borderColor: `${profileTag.color}75`,
                        backgroundColor: `${profileTag.color}1F`,
                        boxShadow: `0 0 18px ${profileTag.color}22`,
                      }}
                      title="Ver tarjeta del servidor"
                    >
                      <span>{SERVER_TAG_GLYPHS[profileTag.badgeId] || SERVER_TAG_GLYPHS.leaf}</span>
                      <span>{profileTag.name}</span>
                    </button>

                    {tagCardOpen ? (
                      <div className="absolute left-0 top-[calc(100%+10px)] z-[120] w-[320px] rounded-2xl border border-white/15 bg-[linear-gradient(180deg,rgba(25,27,36,0.95),rgba(11,12,18,0.95))] backdrop-blur-2xl shadow-[0_24px_60px_rgba(0,0,0,0.52),0_0_0_1px_rgba(255,255,255,0.06)] overflow-hidden animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-200">
                        <div
                          className="h-28 relative overflow-hidden"
                          style={{
                            backgroundColor: activeServer.accentColor || '#7A1027',
                          }}
                        >
                          {activeServer.banner ? (
                            <img
                              src={activeServer.banner}
                              alt={`${activeServer.name} banner`}
                              className="absolute inset-0 w-full h-full object-cover"
                              loading="eager"
                              decoding="sync"
                              draggable={false}
                            />
                          ) : null}
                          <div className="absolute inset-0 bg-black/35" />
                          <div className="absolute bottom-2 left-3 right-3 flex items-end justify-between gap-3">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-10 h-10 rounded-xl overflow-hidden bg-black/40 border border-white/20 flex items-center justify-center text-white font-black">
                                {activeServer.icon ? (
                                  <img src={activeServer.icon} alt={activeServer.name} className="w-full h-full object-cover" />
                                ) : (
                                  activeServer.name[0]?.toUpperCase() || 'S'
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className="text-white font-black text-sm truncate">{activeServer.name}</div>
                                <div className="text-[10px] font-black uppercase tracking-widest text-white/70">{activeServer.tag ? `#${activeServer.tag}` : 'Node'}</div>
                              </div>
                            </div>
                            <span
                              className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide"
                              style={{
                                color: profileTag.color,
                                borderColor: `${profileTag.color}88`,
                                backgroundColor: `${profileTag.color}2A`,
                              }}
                            >
                              <span>{SERVER_TAG_GLYPHS[profileTag.badgeId] || SERVER_TAG_GLYPHS.leaf}</span>
                              <span>{profileTag.name}</span>
                            </span>
                          </div>
                        </div>
                        <div className="p-3 space-y-2">
                          <div className="flex items-center gap-3 text-[11px] font-black text-[#C9D0D8]">
                            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-neon-green" />{activeServer.members.filter((m) => presences[m.userId]?.status === 'online').length} en linea</span>
                            <span className="inline-flex items-center gap-1"><Circle size={9} className="text-[#7b838a]" />{activeServer.members.length} miembros</span>
                          </div>
                          <div className="text-xs text-[#CFD4DA] leading-relaxed">
                            {profileUser.bio || activeServer.description || 'Sin biografia de servidor todavia.'}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {developerMode ? (
                  <div className="flex items-center gap-2 text-[10px] text-[#4E5058] font-black uppercase tracking-[0.2em]">
                    <span>ID: {profileUser.id}</span>
                    <button
                      onClick={() => void copyUserId(profileUser.id)}
                      title={`Copy ID: ${profileUser.id}`}
                      className="w-5 h-5 rounded-md bg-white/[0.03] border border-white/[0.08] flex items-center justify-center text-white/70 hover:text-white hover:bg-white/[0.06] transition-colors"
                    >
                      {copiedUserId === profileUser.id ? <Check size={10} className="text-neon-green" /> : <Copy size={10} />}
                    </button>
                  </div>
                ) : null}
                
                <div className="h-px w-full bg-white/5 my-4" />
                
                <div className="space-y-4">
                  <div>
                    <h4 className="text-[9px] font-black text-[#B5BAC1] uppercase tracking-[0.2em] mb-2">About Me</h4>
                    <p className="text-xs text-[#DBDEE1] leading-relaxed font-medium">{profileUser.bio || 'Sin bio'}</p>
                  </div>

                  <div>
                    <h4 className="text-[9px] font-black text-[#B5BAC1] uppercase tracking-[0.2em] mb-2">Registry Member Since</h4>
                    <div className="flex items-center gap-2 text-[#4E5058]">
                      <Calendar size={12} />
                      <span className="text-[10px] font-bold">{profileUser.joinedAt || '--'}</span>
                    </div>
                  </div>

                  {activeServer && !isDmChannel && selectedUserId ? (
                    <div>
                      <h4 className="text-[9px] font-black text-[#B5BAC1] uppercase tracking-[0.2em] mb-2">Assigned Roles</h4>
                      <div className="flex flex-wrap gap-1.5">
                        {profileUser.roleObjects.length > 0 ? profileUser.roleObjects.map((role: any) => (
                          <span
                            key={role.id}
                            className="px-2 py-1 rounded-lg bg-white/[0.03] border border-white/5 text-[9px] font-black uppercase tracking-widest"
                            style={{
                              color: /gradient\(/i.test(role.color || '') ? undefined : (role.color || '#B5BAC1'),
                              backgroundImage: /gradient\(/i.test(role.color || '') ? role.color : undefined,
                              WebkitBackgroundClip: /gradient\(/i.test(role.color || '') ? 'text' : undefined,
                              backgroundClip: /gradient\(/i.test(role.color || '') ? 'text' : undefined,
                              WebkitTextFillColor: /gradient\(/i.test(role.color || '') ? 'transparent' : undefined,
                            }}
                          >
                            {role.name}
                          </span>
                        )) : (
                          <span className="px-2 py-1 rounded-lg bg-white/[0.03] border border-white/5 text-[9px] font-black text-[#7b838a] uppercase tracking-widest">
                            Sin roles
                          </span>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="mt-8 space-y-2">
                  <button
                    onClick={() => handleProfileDmAction(true)}
                    className="w-full py-3 rounded-2xl bg-neon-blue text-white font-black uppercase tracking-widest text-[10px] hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg shadow-neon-blue/20"
                  >
                    {profileDmGroup?.id ? 'Open Direct Message' : 'Open Direct Message'}
                  </button>
                  <button
                    onClick={() => handleProfileDmAction(false)}
                    disabled={profileUser.id === currentUser.id}
                    className={cn(
                      "w-full py-3 rounded-2xl border font-black uppercase tracking-widest text-[10px] transition-all",
                      profileUser.id === currentUser.id
                        ? "bg-white/[0.03] border-white/[0.05] text-white/40 cursor-not-allowed"
                        : "bg-white/[0.03] border-white/[0.05] text-white hover:bg-white/[0.06]"
                    )}
                  >
                    {profileDmGroup?.id ? 'DM Already Connected' : 'Add Sync Partner'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : rightSidebarView === 'members' ? (
          /* Members List View */
          <div className="p-3 pt-6 space-y-8 animate-in fade-in duration-300">
            {roles.length > 0 ? (
              roles.map(role => {
                const roleMembers = (activeServer?.members || []).filter(m => m.roleIds.includes(role.id));
                if (roleMembers.length === 0) return null;

                return (
                  <div key={role.id} className="space-y-3">
                    <div className="px-4 flex items-center justify-between">
                      <h3 className="text-[9px] font-black text-[#4E5058] uppercase tracking-[0.2em]">
                        {role.name} <span className="opacity-40 ml-1">// {roleMembers.length}</span>
                      </h3>
                    </div>

                    <div className="space-y-1">
                      {roleMembers.map(member => {
                        const presence = presences[member.userId];
                        const user = getUser(member.userId, activeServer || undefined) || { username: 'Unknown', nameClassName: '', nameStyle: undefined, primaryRole: null };

                        return (
                          <button
                            key={member.userId}
                            onClick={() => setSelectedUserId(member.userId)}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              setUserContextMenu({ userId: member.userId, x: e.clientX, y: e.clientY });
                            }}
                            className="flex items-center gap-3 w-full px-4 py-2 rounded-xl hover:bg-white/[0.03] transition-all group border border-transparent hover:border-white/[0.05]"
                          >
                            <div className="relative flex-shrink-0">
                              <div className={cn(
                                "w-9 h-9 rounded-[14px] bg-[#1E1F22] p-[1.5px] transition-transform duration-300 group-hover:scale-105",
                                presence?.status === 'online' ? "ring-1 ring-neon-green/20" : ""
                              )}>
                                <div className="w-full h-full rounded-[inherit] overflow-hidden bg-[#0A0A0B]">
                                  {user.avatar ? (
                                    <img src={user.avatar} alt={user.username} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center text-xs font-black text-white" style={{ color: getRoleSolidColor(user.primaryRole || role, '#B5BAC1') }}>
                                      {user.username[0]}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className={cn(
                                "absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-lg border-[3.5px] border-[#0A0A0B] shadow-sm",
                                presence?.status === 'online' ? "bg-neon-green" : presence?.status === 'dnd' ? "bg-neon-pink" : "bg-[#4E5058]"
                              )} />
                            </div>

                            <div className="min-w-0 text-left">
                              <div className="flex items-center gap-1.5">
                                <span className={cn("text-sm font-black truncate tracking-tight text-white/80 group-hover:text-white transition-colors", user.nameClassName)} style={user.nameStyle}>
                                  {user.username}
                                </span>
                                {user.isOwner && <Crown size={11} className="text-yellow-400" />}
                                {user.isBot && <Bot size={10} className="text-neon-blue" />}
                                {memberTagProfiles.get(member.userId) ? (
                                  <span
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[8px] font-black uppercase tracking-widest"
                                    style={{
                                      color: memberTagProfiles.get(member.userId)!.color,
                                      borderColor: `${memberTagProfiles.get(member.userId)!.color}70`,
                                      backgroundColor: `${memberTagProfiles.get(member.userId)!.color}1F`,
                                    }}
                                  >
                                    <span>{SERVER_TAG_GLYPHS[memberTagProfiles.get(member.userId)!.badgeId] || SERVER_TAG_GLYPHS.leaf}</span>
                                    <span>{memberTagProfiles.get(member.userId)!.name}</span>
                                  </span>
                                ) : null}
                              </div>
                              {presence?.activity && (
                                <div className="text-[9px] font-black uppercase tracking-widest text-[#4E5058] truncate group-hover:text-[#B5BAC1] transition-colors">
                                  {presence.activity.name}
                                </div>
                              )}
                              {isTimedOut(member.userId) ? (
                                <div className="text-[9px] font-black uppercase tracking-widest text-neon-pink">
                                  Timeout activo
                                </div>
                              ) : null}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            ) : null}

            {ungroupedMembers.length > 0 && (
              <div className="space-y-3">
                <div className="px-4 flex items-center justify-between">
                  <h3 className="text-[9px] font-black text-[#4E5058] uppercase tracking-[0.2em]">
                    Members <span className="opacity-40 ml-1">// {ungroupedMembers.length}</span>
                  </h3>
                </div>

                <div className="space-y-1">
                  {ungroupedMembers.map(member => {
                    const presence = presences[member.userId];
                    const user = getUser(member.userId, activeServer || undefined) || { username: 'Unknown', nameClassName: '', nameStyle: undefined, primaryRole: null };

                    return (
                      <button
                        key={member.userId}
                        onClick={() => setSelectedUserId(member.userId)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setUserContextMenu({ userId: member.userId, x: e.clientX, y: e.clientY });
                        }}
                        className="flex items-center gap-3 w-full px-4 py-2 rounded-xl hover:bg-white/[0.03] transition-all group border border-transparent hover:border-white/[0.05]"
                      >
                        <div className="relative flex-shrink-0">
                          <div className={cn(
                            "w-9 h-9 rounded-[14px] bg-[#1E1F22] p-[1.5px] transition-transform duration-300 group-hover:scale-105",
                            presence?.status === 'online' ? "ring-1 ring-neon-green/20" : ""
                          )}>
                            <div className="w-full h-full rounded-[inherit] overflow-hidden bg-[#0A0A0B]">
                              {user.avatar ? (
                                <img src={user.avatar} alt={user.username} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-xs font-black text-white" style={{ color: getRoleSolidColor(user.primaryRole, '#4E5058') }}>
                                  {user.username[0]}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className={cn(
                            "absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-lg border-[3.5px] border-[#0A0A0B] shadow-sm",
                            presence?.status === 'online' ? "bg-neon-green" : presence?.status === 'dnd' ? "bg-neon-pink" : "bg-[#4E5058]"
                          )} />
                        </div>

                        <div className="min-w-0 text-left">
                          <div className="flex items-center gap-1.5">
                            <span className={cn("text-sm font-black truncate tracking-tight text-white/80 group-hover:text-white transition-colors", user.nameClassName)} style={user.nameStyle}>
                              {user.username}
                            </span>
                            {user.isOwner && <Crown size={11} className="text-yellow-400" />}
                            {user.isBot && <Bot size={10} className="text-neon-blue" />}
                            {memberTagProfiles.get(member.userId) ? (
                              <span
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[8px] font-black uppercase tracking-widest"
                                style={{
                                  color: memberTagProfiles.get(member.userId)!.color,
                                  borderColor: `${memberTagProfiles.get(member.userId)!.color}70`,
                                  backgroundColor: `${memberTagProfiles.get(member.userId)!.color}1F`,
                                }}
                              >
                                <span>{SERVER_TAG_GLYPHS[memberTagProfiles.get(member.userId)!.badgeId] || SERVER_TAG_GLYPHS.leaf}</span>
                                <span>{memberTagProfiles.get(member.userId)!.name}</span>
                              </span>
                            ) : null}
                          </div>
                          {presence?.activity && (
                            <div className="text-[9px] font-black uppercase tracking-widest text-[#4E5058] truncate group-hover:text-[#B5BAC1] transition-colors">
                              {presence.activity.name}
                            </div>
                          )}
                          {isTimedOut(member.userId) ? (
                            <div className="text-[9px] font-black uppercase tracking-widest text-neon-pink">
                              Timeout activo
                            </div>
                          ) : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Node Info View (Pinned, Links, Media) */
          <div className="p-4 pt-6 space-y-8 animate-in fade-in duration-300">
            {/* Topic Section */}
            <div>
              <div className="flex items-center gap-2 mb-4 text-neon-blue">
                <Info size={14} />
                <h3 className="text-[10px] font-black uppercase tracking-[0.2em]">Node Protocol</h3>
              </div>
              <div className="p-4 rounded-3xl bg-white/[0.02] glass-ruby-surface border border-white/[0.05]">
                <h4 className="text-sm font-black text-white mb-2 uppercase tracking-tight">#{activeChannel?.name}</h4>
                <p className="text-[11px] text-[#4E5058] font-medium leading-relaxed uppercase tracking-wider">
                  {activeChannel?.topic || 'No uplink mission defined for this coordinate.'}
                </p>
              </div>
            </div>

            {/* Pinned Messages */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2 text-neon-purple">
                  <Pin size={14} />
                  <h3 className="text-[10px] font-black uppercase tracking-[0.2em]">Sticky Data</h3>
                </div>
                <span className="text-[10px] font-black text-[#4E5058]">{pinnedMessages.length}</span>
              </div>
              
              <div className="space-y-3">
                {pinnedMessages.length === 0 ? (
                  <div className="p-8 rounded-3xl border border-dashed border-white/5 text-center">
                    <Pin size={20} className="mx-auto mb-2 opacity-10" />
                    <p className="text-[9px] font-black text-[#4E5058] uppercase tracking-widest">No Fixed Data</p>
                  </div>
                ) : (
                  pinnedMessages.map(msg => (
                    <div key={msg.id} className="p-3 rounded-2xl bg-white/[0.02] border border-white/[0.05] hover:border-neon-purple/30 transition-all cursor-pointer group">
                      {(() => {
                        const messageAuthor = getUser(msg.authorId, activeServer || undefined) || { username: 'Unknown', nameClassName: '', nameStyle: undefined, primaryRole: null };
                        return (
                          <>
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-5 h-5 rounded-md bg-neon-purple/20 flex items-center justify-center text-[10px] font-black text-neon-purple uppercase">
                              {messageAuthor?.username?.[0]}
                        </div>
                            <span className={cn("text-[10px] font-black group-hover:text-white transition-colors uppercase", messageAuthor.nameClassName)} style={messageAuthor.nameStyle}>
                              {messageAuthor?.username}
                            </span>
                            {messageAuthor.isOwner ? <Crown size={10} className="text-yellow-400" /> : null}
                      </div>
                      <p className="text-[11px] text-[#B5BAC1] line-clamp-2 font-medium">{msg.content}</p>
                          </>
                        );
                      })()}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Media Files */}
            <div>
              <div className="flex items-center justify-between mb-4 text-neon-pink">
                <div className="flex items-center gap-2">
                  <ImageIcon size={14} />
                  <h3 className="text-[10px] font-black uppercase tracking-[0.2em]">Media Cache</h3>
                </div>
              </div>
              {sharedMedia.length === 0 ? (
                <div className="p-8 rounded-3xl border border-dashed border-white/5 text-center">
                  <ImageIcon size={20} className="mx-auto mb-2 opacity-10" />
                  <p className="text-[9px] font-black text-[#4E5058] uppercase tracking-widest">No shared media yet</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {sharedMedia.map((item) => {
                    const mediaAuthor = getUser(item.authorId, activeServer || undefined) || { username: 'Unknown' };
                    return (
                      <a
                        key={item.id}
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group relative aspect-square rounded-xl overflow-hidden bg-white/5 border border-white/5 hover:scale-105 transition-all"
                        title={`${item.url} // ${mediaAuthor.username}`}
                      >
                        <img src={item.url} alt={mediaAuthor.username} className="w-full h-full object-cover opacity-70 group-hover:opacity-100 transition-opacity" />
                        <div className="absolute inset-x-0 bottom-0 px-2 py-1 bg-black/55 backdrop-blur-[2px] text-[8px] font-black uppercase tracking-widest text-white/80 truncate opacity-0 group-hover:opacity-100 transition-opacity">
                          {mediaAuthor.username}
                        </div>
                      </a>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Links Section */}
            <div>
              <div className="flex items-center gap-2 mb-4 text-neon-green">
                <LinkIcon size={14} />
                <h3 className="text-[10px] font-black uppercase tracking-[0.2em]">Hyperlinks</h3>
              </div>
              {sharedLinks.length === 0 ? (
                <div className="p-8 rounded-3xl border border-dashed border-white/5 text-center">
                  <LinkIcon size={20} className="mx-auto mb-2 opacity-10" />
                  <p className="text-[9px] font-black text-[#4E5058] uppercase tracking-widest">No links shared in this channel</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {sharedLinks.map((link) => {
                    const linkAuthor = getUser(link.authorId, activeServer || undefined) || { username: 'Unknown' };
                    return (
                      <a 
                        key={link.id} 
                        href={link.url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 p-3 rounded-2xl bg-white/[0.02] border border-white/[0.05] hover:bg-white/[0.04] hover:border-neon-green/30 transition-all group"
                      >
                        <div className="w-8 h-8 rounded-lg bg-neon-green/10 flex items-center justify-center text-neon-green">
                          <ExternalLink size={14} />
                        </div>
                        <div className="min-w-0">
                          <div className="text-[11px] font-black text-white truncate uppercase tracking-tight group-hover:text-neon-green transition-colors">{link.title}</div>
                          <div className="text-[9px] text-[#4E5058] font-black truncate tracking-widest">{link.url.replace(/^https?:\/\//i, '')}</div>
                          <div className="text-[8px] text-[#687079] font-black uppercase tracking-widest mt-0.5">By {linkAuthor.username}</div>
                        </div>
                      </a>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {userContextMenu && activeServer ? (
        <div
          className="fixed z-[500] min-w-[220px] rounded-xl border border-white/10 bg-[#0A0A0B]/95 backdrop-blur-xl p-1.5 shadow-2xl"
          style={{ left: userContextMenu.x, top: userContextMenu.y }}
        >
          {!isTimedOut(userContextMenu.userId) && canTimeout && userContextMenu.userId !== currentUser.id && userContextMenu.userId !== activeServer.ownerId ? (
            <button
              onClick={() => runModeration('timeout', userContextMenu.userId)}
              className="w-full px-3 py-2 rounded-lg text-left text-sm text-white/85 hover:bg-white/[0.06] transition-colors flex items-center gap-2"
            >
              <Clock3 size={14} />
              Timeout 5 min
            </button>
          ) : null}
          {isTimedOut(userContextMenu.userId) && canTimeout && userContextMenu.userId !== currentUser.id && userContextMenu.userId !== activeServer.ownerId ? (
            <button
              onClick={() => runModeration('untimeout', userContextMenu.userId)}
              className="w-full px-3 py-2 rounded-lg text-left text-sm text-white/85 hover:bg-white/[0.06] transition-colors flex items-center gap-2"
            >
              <Clock3 size={14} />
              Quitar timeout
            </button>
          ) : null}
          {canKickBan && userContextMenu.userId !== currentUser.id && userContextMenu.userId !== activeServer.ownerId ? (
            <button
              onClick={() => runModeration('kick', userContextMenu.userId)}
              className="w-full px-3 py-2 rounded-lg text-left text-sm text-neon-pink hover:bg-neon-pink/10 transition-colors flex items-center gap-2"
            >
              <LogOut size={14} />
              Expulsar
            </button>
          ) : null}
          {canKickBan && userContextMenu.userId !== currentUser.id && userContextMenu.userId !== activeServer.ownerId ? (
            <button
              onClick={() => runModeration('ban', userContextMenu.userId)}
              className="w-full px-3 py-2 rounded-lg text-left text-sm text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-2"
            >
              <Ban size={14} />
              Banear
            </button>
          ) : null}
          {developerMode ? <div className="my-1 h-px bg-white/10" /> : null}
          {developerMode ? (
            <button
              onClick={() => void copyUserId(userContextMenu.userId)}
              className="w-full px-3 py-2 rounded-lg text-left text-sm text-white/85 hover:bg-white/[0.06] transition-colors flex items-center justify-between gap-3"
            >
              <span>Copiar User ID</span>
              {copiedUserId === userContextMenu.userId ? <Check size={14} className="text-neon-green" /> : <Copy size={14} />}
            </button>
          ) : null}
        </div>
      ) : null}

      {modToast ? (
        <div className="fixed bottom-8 right-8 z-[520] px-4 py-2 rounded-xl bg-[#0A0A0B]/95 border border-white/10 text-white font-black uppercase tracking-widest text-[10px] shadow-2xl">
          {modToast}
        </div>
      ) : null}

      {/* Footer System Info */}
      {!profileUser && (
        <div className="p-6 border-t border-white/[0.03] bg-white/[0.01]">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-neon-green animate-pulse" />
              <span className="text-[9px] font-black text-[#4E5058] uppercase tracking-[0.3em]">Uplink Status</span>
            </div>
            <span className="text-[9px] font-black text-neon-green uppercase tracking-widest">Optimized</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="p-3 rounded-2xl bg-white/[0.02] border border-white/[0.05]">
              <div className="text-[8px] font-black text-[#4E5058] uppercase tracking-widest mb-1">Enc Level</div>
              <div className="text-[10px] font-black text-white">X-99 // AES</div>
            </div>
            <div className="p-3 rounded-2xl bg-white/[0.02] border border-white/[0.05]">
              <div className="text-[8px] font-black text-[#4E5058] uppercase tracking-widest mb-1">Node Sync</div>
              <div className="text-[10px] font-black text-white">99.8%</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

