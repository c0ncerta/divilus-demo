import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Attachment, Message } from '../../lib/types';
import { useStore } from '../../lib/store';
import { format } from 'date-fns';
import {
  Smile,
  Reply,
  Edit,
  Trash2,
  Pin,
  Clock,
  Copy,
  Check,
  MessageSquare,
  Crown,
  Maximize2,
  Minimize2,
  Download,
  Loader2,
  X,
  Play,
  Pause,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { eventBus } from '../../lib/event-bus';
import { cn } from '../../lib/utils';
import { isBackendEnabled } from '../../lib/env';
import { getSocket } from '../../services/socket-client';
import { getPrimaryMemberRole, getRoleNamePresentation, getRoleSolidColor } from '../../lib/role-style';
import { hasPermission } from '../../lib/permissions';
import { CrewBadge } from '../ui/CrewBadge';

interface MessageItemProps {
  message: Message;
  isCompact?: boolean;
  onReply?: (msg: Message) => void;
  highlighted?: boolean;
  onOpenThread?: (msg: Message) => void;
  threadUnreadCount?: number;
  onMentionUser?: (userId: string) => void;
  entryFx?: boolean;
}


const QUICK_EMOJIS = [
  '\u{1F600}',
  '\u{1F602}',
  '\u{1F525}',
  '\u{1F480}',
  '\u{1F680}',
  '\u{1F44F}',
  '\u{2705}',
  '\u{1F440}',
];
const CUSTOM_EMOJIS_STORAGE_KEY = 'diavlocord-custom-emojis';

type CustomServerEmoji = {
  id: string;
  name: string;
  url: string;
  animated: boolean;
};

const isEmojiChar = (char: string): boolean => {
  const code = char.codePointAt(0);
  if (!code) return false;
  return (
    (code >= 0x1f300 && code <= 0x1faff) ||
    (code >= 0x2600 && code <= 0x27bf) ||
    (code >= 0xfe00 && code <= 0xfe0f)
  );
};

const renderAnimatedText = (text: string) => {
  return Array.from(text).map((char, idx) => {
    if (isEmojiChar(char)) {
      return (
        <span
          key={`${char}-${idx}`}
          className="inline-block animate-bounce [animation-duration:1.8s] [animation-delay:120ms]"
        >
          {char}
        </span>
      );
    }
    return <React.Fragment key={`${char}-${idx}`}>{char}</React.Fragment>;
  });
};

const formatAudioTimestamp = (rawSeconds: number) => {
  if (!Number.isFinite(rawSeconds) || rawSeconds <= 0) return '0:00';
  const totalSeconds = Math.max(0, Math.floor(rawSeconds));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const hasFilenameExtension = (filename: string, extensions: string[], urlHint?: string) => {
  const lower = (filename || '').toLowerCase();
  const fallback = (urlHint || '').split('?')[0].split('#')[0].toLowerCase();
  return extensions.some((ext) => lower.endsWith(ext) || fallback.endsWith(ext));
};

const resolveAttachmentKind = (attachment: Attachment) => {
  const contentType = (attachment.contentType || '').toLowerCase();
  const filename = attachment.filename || '';
  const urlHint = typeof attachment.url === 'string' ? attachment.url : '';
  const lowerFilename = filename.toLowerCase();
  const looksLikeAudioName =
    /(^|[_\-.])(voice|audio|record|rec|mic|memo|mensaje|nota)([_\-.]|$)/.test(lowerFilename) ||
    lowerFilename.includes('voice-note') ||
    lowerFilename.includes('voice_clip') ||
    lowerFilename.includes('mensaje-voz');
  const hasWebmExtension = hasFilenameExtension(filename, ['.webm'], urlHint);
  const looksLikeVoiceClip =
    (contentType.includes('webm') || hasWebmExtension) &&
    (/^voice[-_]/.test(lowerFilename) || looksLikeAudioName);
  const isGif =
    contentType === 'image/gif' ||
    hasFilenameExtension(filename, ['.gif'], urlHint);
  const isImage =
    contentType.startsWith('image/') ||
    hasFilenameExtension(filename, ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.svg', '.gif'], urlHint);
  const isAudioByExtension = hasFilenameExtension(filename, [
    '.mp3',
    '.wav',
    '.ogg',
    '.oga',
    '.m4a',
    '.aac',
    '.flac',
    '.opus',
  ], urlHint);
  const isLikelyAudioInVideoContainer =
    contentType.startsWith('video/') &&
    (isAudioByExtension || (hasWebmExtension && looksLikeAudioName) || looksLikeAudioName);
  const isAudio =
    contentType.startsWith('audio/') ||
    isAudioByExtension ||
    looksLikeVoiceClip ||
    isLikelyAudioInVideoContainer;
  const isVideo =
    (contentType.startsWith('video/') ||
      hasFilenameExtension(filename, ['.mp4', '.webm', '.mov', '.mkv', '.avi'], urlHint)) &&
    !isAudio;

  return { isGif, isImage, isVideo, isAudio };
};

type GlassAudioPlayerProps = {
  src: string;
  filename: string;
  compact?: boolean;
  autoPlay?: boolean;
};

const GlassAudioPlayer = ({ src, filename, compact = false, autoPlay = false }: GlassAudioPlayerProps) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  const waveformBars = useMemo(() => {
    const seedBase = `${filename}:${src}`;
    let seed = 0;
    for (let i = 0; i < seedBase.length; i += 1) {
      seed = (seed * 31 + seedBase.charCodeAt(i)) >>> 0;
    }
    const total = compact ? 44 : 64;
    return Array.from({ length: total }, (_, index) => {
      const n = (Math.sin((seed + index * 17) * 0.137) + 1) / 2;
      return 24 + n * 68;
    });
  }, [compact, filename, src]);

  const progress = duration > 0 ? Math.max(0, Math.min(1, currentTime / duration)) : 0;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onLoadedMetadata = () => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    };
    const onTimeUpdate = () => setCurrentTime(Number.isFinite(audio.currentTime) ? audio.currentTime : 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      setCurrentTime(0);
    };
    const onError = () => {
      setAudioError('No se pudo reproducir este audio en este dispositivo.');
      setPlaying(false);
    };
    const onCanPlay = () => setAudioError(null);

    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    audio.addEventListener('canplay', onCanPlay);

    return () => {
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('canplay', onCanPlay);
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setAudioError(null);
    audio.pause();
    audio.currentTime = 0;
    audio.load();
    if (autoPlay) {
      void audio.play().catch(() => {});
    }
  }, [autoPlay, src]);

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    try {
      if (audio.paused) await audio.play();
      else audio.pause();
    } catch {}
  };

  const onSeek = (event: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const percentage = Number(event.target.value);
    const nextTime = (Math.max(0, Math.min(100, percentage)) / 100) * duration;
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  const onVolumeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const next = Math.max(0, Math.min(1, Number(event.target.value)));
    audio.volume = next;
    setVolume(next);
    if (next > 0 && muted) {
      audio.muted = false;
      setMuted(false);
    }
  };

  const toggleMuted = () => {
    const audio = audioRef.current;
    if (!audio) return;
    const nextMuted = !audio.muted;
    audio.muted = nextMuted;
    setMuted(nextMuted);
  };

  return (
    <div
      className={cn(
        'rounded-2xl border border-white/12 bg-[linear-gradient(135deg,rgba(13,15,24,0.92),rgba(23,8,16,0.88))]',
        'shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_10px_30px_rgba(0,0,0,0.36)]',
        compact ? 'p-3' : 'p-4'
      )}
    >
      <audio ref={audioRef} src={src} preload="metadata" autoPlay={autoPlay} className="hidden" />
      <div className="flex items-center gap-3">
        <button
          onClick={togglePlayback}
          className={cn(
            'shrink-0 rounded-xl border border-white/20 bg-black/40 text-white hover:border-neon-pink/50 hover:text-neon-pink apple-smooth',
            compact ? 'w-10 h-10' : 'w-11 h-11',
            'inline-flex items-center justify-center'
          )}
          title={playing ? 'Pausar' : 'Reproducir'}
        >
          {playing ? <Pause size={compact ? 16 : 18} /> : <Play size={compact ? 16 : 18} className="translate-x-[1px]" />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] uppercase tracking-widest text-[#8A8F98] font-black">Mensaje de voz</div>
            <div className="text-[10px] text-white/70 font-semibold tabular-nums">
              {formatAudioTimestamp(currentTime)} / {formatAudioTimestamp(duration)}
            </div>
          </div>

          <div className="relative mt-2">
            <div className="h-12 rounded-xl border border-white/10 bg-black/35 px-2 overflow-hidden flex items-end gap-[2px]">
              {waveformBars.map((height, index) => {
                const barProgress = waveformBars.length <= 1 ? 0 : index / (waveformBars.length - 1);
                const active = barProgress <= progress;
                return (
                  <span
                    key={`${index}-${Math.round(height)}`}
                    className={cn(
                      'flex-1 rounded-full transition-all duration-300',
                      active
                        ? 'bg-[linear-gradient(180deg,#FF4C74,#C2183C)] shadow-[0_0_10px_rgba(194,24,60,0.35)]'
                        : 'bg-white/20',
                      playing && 'animate-pulse'
                    )}
                    style={{
                      height: `${height}%`,
                      animationDuration: `${1.05 + (index % 6) * 0.08}s`,
                    }}
                  />
                );
              })}
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={0.1}
              value={progress * 100}
              onChange={onSeek}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              aria-label="Progreso de audio"
            />
          </div>

          <div className="mt-2 flex items-center justify-between gap-3">
            <div className="min-w-0 text-[11px] text-[#A8AEB8] font-semibold truncate">{filename}</div>
            <div className="flex items-center gap-2">
              <button
                onClick={toggleMuted}
                className="w-7 h-7 rounded-lg border border-white/15 bg-white/[0.04] text-white/80 hover:text-neon-blue hover:border-neon-blue/45 apple-smooth inline-flex items-center justify-center"
                title={muted ? 'Activar sonido' : 'Silenciar'}
              >
                {muted || volume <= 0.01 ? <VolumeX size={14} /> : <Volume2 size={14} />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                onChange={onVolumeChange}
                className={cn('voice-glass-slider', compact ? 'w-12 sm:w-20' : 'w-24')}
                aria-label="Volumen"
              />
            </div>
          </div>
          {audioError ? (
            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="text-[10px] font-black uppercase tracking-[0.12em] text-[#FF9BB0] truncate">
                {audioError}
              </div>
              <a
                href={src}
                download={filename}
                className="shrink-0 px-2 py-1 rounded-md border border-white/15 bg-white/[0.03] text-[10px] font-black uppercase tracking-[0.12em] text-white/80 hover:text-white hover:bg-white/[0.07] transition-colors"
              >
                Descargar
              </a>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

const MessageItemComponent = ({
  message,
  isCompact,
  onReply,
  highlighted,
  onOpenThread,
  threadUnreadCount = 0,
  onMentionUser,
  entryFx = false,
}: MessageItemProps) => {
  const currentUser = useStore(s => s.currentUser);
  const users = useStore(s => s.users);
  const presences = useStore(s => s.presences);
  const servers = useStore(s => s.servers);
  const activeServerId = useStore(s => s.activeServerId);
  const activeChannelId = useStore(s => s.activeChannelId);
  const setSelectedUserId = useStore(s => s.setSelectedUserId);
  const setActiveChannel = useStore(s => s.setActiveChannel);
  const toggleReaction = useStore(s => s.toggleReaction);
  const togglePinMessage = useStore(s => s.togglePinMessage);
  const updateMessage = useStore(s => s.updateMessage);
  const deleteMessage = useStore(s => s.deleteMessage);
  const setRightSidebarView = useStore(s => s.setRightSidebarView);
  const sendDMRequest = useStore(s => s.sendDMRequest);
  const timeoutMember = useStore(s => s.timeoutMember);
  const clearMemberTimeout = useStore(s => s.clearMemberTimeout);
  const kickMember = useStore(s => s.kickMember);
  const banMember = useStore(s => s.banMember);
  const memberTimeouts = useStore(s => s.memberTimeouts);
  const developerMode = useStore(s => s.developerMode);
  const backendToken = useStore(s => s.backendToken);
  const messages = useStore(s => s.messages[message.channelId] || []);
  const [formattedTime, setFormattedTime] = useState('');
  const [mounted, setMounted] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [customEmojiById, setCustomEmojiById] = useState<Record<string, CustomServerEmoji>>({});
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    mode: 'message' | 'user';
    attachmentId?: string;
  } | null>(null);
  const [copiedTarget, setCopiedTarget] = useState<'message' | 'author' | null>(null);
  const [copiedText, setCopiedText] = useState(false);
  const [contextFeedback, setContextFeedback] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(message.content || '');
  const [reactionInspector, setReactionInspector] = useState<{ emoji: string; x: number; y: number } | null>(null);
  const [mediaViewerAttachment, setMediaViewerAttachment] = useState<Attachment | null>(null);
  const [mediaViewerFullscreen, setMediaViewerFullscreen] = useState(false);
  const [mediaViewerDownloadState, setMediaViewerDownloadState] = useState<'idle' | 'downloading' | 'done' | 'error'>('idle');
  const [expandedMessage, setExpandedMessage] = useState(false);
  const [failedAttachmentIds, setFailedAttachmentIds] = useState<Record<string, true>>({});
  const [isBubbleHovered, setIsBubbleHovered] = useState(false);
  const mediaViewerHostRef = useRef<HTMLDivElement | null>(null);
  const mediaViewerDownloadResetRef = useRef<number | null>(null);

  useEffect(() => {
    setMounted(true);
    setFormattedTime(format(new Date(message.timestamp), 'HH:mm'));
  }, [message.timestamp]);

  useEffect(() => {
    setExpandedMessage(false);
  }, [message.id, message.content]);

  useEffect(() => {
    setFailedAttachmentIds({});
  }, [message.id]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CUSTOM_EMOJIS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const byId: Record<string, CustomServerEmoji> = {};
      for (const item of parsed as CustomServerEmoji[]) {
        byId[item.id] = item;
      }
      setCustomEmojiById(byId);
    } catch {}
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
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
  }, [contextMenu]);

  useEffect(() => {
    if (!reactionInspector) return;
    const close = () => setReactionInspector(null);
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
  }, [reactionInspector]);

  useEffect(() => {
    if (!contextFeedback) return;
    const id = window.setTimeout(() => setContextFeedback(null), 1600);
    return () => window.clearTimeout(id);
  }, [contextFeedback]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setMediaViewerFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  useEffect(() => {
    return () => {
      if (mediaViewerDownloadResetRef.current) {
        window.clearTimeout(mediaViewerDownloadResetRef.current);
      }
    };
  }, []);

  const currentUserId = String(currentUser.id);
  const messageAuthorId = String(message.authorId);
  const isMe = messageAuthorId === currentUserId;
  const activeServer = servers.find((s) => s.id === activeServerId);
  const activeChannel = activeServer?.categories
    .flatMap((category) => category.channels)
    .find((channel) => channel.id === activeChannelId);
  const channelById = new Map((activeServer?.categories?.flatMap((c) => c.channels) || []).map((c) => [c.id, c]));
  const canManageMessages =
    !!activeServer &&
    (String(activeServer.ownerId) === currentUserId ||
      hasPermission(activeServer, activeChannel, currentUserId, 'MANAGE_MESSAGES'));
  const canTimeout = canManageMessages;
  const canKickBan =
    !!activeServer &&
    (String(activeServer.ownerId) === currentUserId ||
      hasPermission(activeServer, activeChannel, currentUserId, 'MANAGE_SERVER'));
  const canDeleteMessage = isMe || canManageMessages;
  const isTargetOwner = !!activeServer && String(activeServer.ownerId) === messageAuthorId;
  const isTargetSelf = messageAuthorId === currentUserId;
  const timeoutKey = activeServer ? `${activeServer.id}:${messageAuthorId}` : '';
  const isTargetTimedOut = Boolean(timeoutKey && memberTimeouts[timeoutKey] && new Date(memberTimeouts[timeoutKey]).getTime() > Date.now());

  const replyToMessage = useMemo(() => {
    if (!message.replyToId) return null;
    return messages.find(m => m.id === message.replyToId);
  }, [message.replyToId, messages]);

  const storeUserById = useMemo(() => {
    const map = new Map<string, any>();
    for (const u of users) map.set(String(u.id), u);
    map.set(String(currentUser.id), currentUser);
    return map;
  }, [users, currentUser]);

  const getUser = (userId: string | number) => {
    const normalizedUserId = String(userId);
    const base = storeUserById.get(normalizedUserId);
    if (!base) return { username: 'Unknown', avatar: null, color: '#FFFFFF', nameClassName: '', nameStyle: undefined };
    const primaryRole = getPrimaryMemberRole(activeServer, normalizedUserId);
    const rolePresentation = getRoleNamePresentation(primaryRole);
    return {
      ...base,
      color: getRoleSolidColor(primaryRole, base.color || '#FFFFFF'),
      nameClassName: rolePresentation.className,
      nameStyle: rolePresentation.style,
    };
  };

  const author = getUser(messageAuthorId);
  const replyAuthor = replyToMessage ? getUser(String(replyToMessage.authorId)) : null;
  const resolvePresenceStatus = (
    userId: string,
    fallback: 'online' | 'idle' | 'dnd' | 'offline' = 'offline'
  ) =>
    (presences[userId]?.status || storeUserById.get(userId)?.status || fallback) as
      | 'online'
      | 'idle'
      | 'dnd'
      | 'offline';
  const statusDotClass = (status: 'online' | 'idle' | 'dnd' | 'offline') =>
    status === 'online' ? 'bg-neon-green' : status === 'idle' ? 'bg-neon-blue' : status === 'dnd' ? 'bg-neon-pink' : 'bg-[#4E5058]';
  const authorPresenceStatus = resolvePresenceStatus(messageAuthorId, 'offline');
  const authorIsOwner = Boolean(activeServer && String(activeServer.ownerId) === messageAuthorId);
  const replyAuthorIsOwner = Boolean(activeServer && replyToMessage && String(activeServer.ownerId) === String(replyToMessage.authorId));
  const attachments = message.attachments || [];
  const contentRaw = message.content || '';
  const shouldCollapseContent = contentRaw.length > 560;
  const displayContent = shouldCollapseContent && !expandedMessage ? `${contentRaw.slice(0, 560)}...` : contentRaw;

  const openProfile = () => {
    setSelectedUserId(message.authorId);
    setRightSidebarView('members');
  };

  const openUserContextMenu = (x: number, y: number) => {
    setContextMenu({ x, y, mode: 'user' });
  };

  const openMessageContextMenu = (x: number, y: number, attachmentId?: string) => {
    setContextMenu({ x, y, mode: 'message', attachmentId });
  };

  const onDelete = () => {
    if (!canDeleteMessage) {
      setContextFeedback('No tienes permiso para eliminar este mensaje');
      setConfirmDeleteOpen(false);
      return;
    }
    deleteMessage(message.channelId, message.id);
    if (isBackendEnabled && backendToken) {
      const socket = getSocket(backendToken);
      try {
        socket?.connect();
        socket?.emit('channel:message:delete', { channelId: message.channelId, messageId: message.id });
      } catch {}
    } else {
      eventBus.emit('MESSAGE_DELETED', { channelId: message.channelId, messageId: message.id });
    }
    setConfirmDeleteOpen(false);
  };

  const startEdit = () => {
    if (!isMe) return;
    setEditValue(message.content || '');
    setEditing(true);
  };

  const saveEdit = () => {
    const next = editValue.trim();
    if (!next) return;
    const updates = { content: next, editedAt: new Date().toISOString() };
    updateMessage(message.channelId, message.id, updates);
    if (isBackendEnabled && backendToken) {
      const socket = getSocket(backendToken);
      try {
        socket?.connect();
        socket?.emit('channel:message:update', { channelId: message.channelId, messageId: message.id, updates });
      } catch {}
    } else {
      eventBus.emit('MESSAGE_UPDATED', { channelId: message.channelId, messageId: message.id, updates });
    }
    setEditing(false);
  };

  const reactionSummary = useMemo(() => {
    const reactions = message.reactions || [];
    return reactions
      .map((r) => ({ emoji: r.emoji, count: r.userIds.length, reacted: r.userIds.includes(currentUser.id), userIds: r.userIds }))
      .sort((a, b) => b.count - a.count);
  }, [message.reactions, currentUser.id]);

  const onReact = (emoji: string) => {
    toggleReaction(message.channelId, message.id, emoji, currentUser.id);
    if (isBackendEnabled && backendToken) {
      const nextMessage = (useStore.getState().messages[message.channelId] || []).find((m) => m.id === message.id);
      const socket = getSocket(backendToken);
      try {
        socket?.connect();
        socket?.emit('channel:message:reactions', {
          channelId: message.channelId,
          messageId: message.id,
          reactions: nextMessage?.reactions || [],
        });
      } catch {}
    } else {
      eventBus.emit('REACTION_TOGGLED', { channelId: message.channelId, messageId: message.id, emoji, userId: currentUser.id });
    }
    setPickerOpen(false);
  };

  const togglePinWithSync = () => {
    const nextPinned = !message.isPinned;
    togglePinMessage(message.channelId, message.id);
    if (isBackendEnabled && backendToken) {
      const socket = getSocket(backendToken);
      try {
        socket?.connect();
        socket?.emit('channel:message:pin', {
          channelId: message.channelId,
          messageId: message.id,
          isPinned: nextPinned,
        });
      } catch {}
    } else {
      eventBus.emit('MESSAGE_UPDATED', {
        channelId: message.channelId,
        messageId: message.id,
        updates: { isPinned: nextPinned },
      });
    }
  };

  const copyId = async (value: string, target: 'message' | 'author') => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedTarget(target);
      setTimeout(() => setCopiedTarget(null), 1400);
      setContextMenu(null);
    } catch {}
  };

  const copyMessageText = async () => {
    if (!message.content) return;
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedText(true);
      setTimeout(() => setCopiedText(false), 1400);
      setContextMenu(null);
    } catch {}
  };

  const openDirectMessage = () => {
    if (message.authorId === currentUser.id) {
      openProfile();
      setContextMenu(null);
      return;
    }
    const result = sendDMRequest(message.authorId);
    if (!result.ok) {
      if (result.reason === 'pending') setContextFeedback('Solicitud pendiente');
      else if (result.reason === 'self') setContextFeedback('No puedes enviarte solicitud');
      else setContextFeedback('No se pudo abrir DM');
    } else {
      setContextFeedback('DM actualizado');
    }
    setContextMenu(null);
  };

  const runModeration = (action: 'timeout' | 'untimeout' | 'kick' | 'ban') => {
    if (!activeServer) return;
    if (isTargetOwner || isTargetSelf) return;
    if (action === 'timeout' && canTimeout) {
      timeoutMember(activeServer.id, message.authorId, 5, 'Moderacion');
      setContextFeedback('Usuario aislado 5 minutos');
    } else if (action === 'untimeout' && canTimeout) {
      clearMemberTimeout(activeServer.id, message.authorId);
      setContextFeedback('Timeout eliminado');
    } else if (action === 'kick' && canKickBan) {
      kickMember(activeServer.id, message.authorId, 'Moderacion');
      setContextFeedback('Usuario expulsado');
    } else if (action === 'ban' && canKickBan) {
      banMember(activeServer.id, message.authorId, 'Moderacion');
      setContextFeedback('Usuario baneado');
    }
    setContextMenu(null);
  };

  const mentionUserFromContext = () => {
    if (onMentionUser) {
      onMentionUser(message.authorId);
    } else {
      setContextFeedback(`Mencionado: ${author.username}`);
    }
    setContextMenu(null);
  };

  const openMediaViewer = (attachment: Attachment) => {
    if (mediaViewerDownloadResetRef.current) {
      window.clearTimeout(mediaViewerDownloadResetRef.current);
      mediaViewerDownloadResetRef.current = null;
    }
    setMediaViewerDownloadState('idle');
    setMediaViewerAttachment(attachment);
  };

  const closeMediaViewer = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    }
    setMediaViewerAttachment(null);
  };

  const markAttachmentFailed = (attachmentId: string) => {
    setFailedAttachmentIds((prev) => {
      if (prev[attachmentId]) return prev;
      return { ...prev, [attachmentId]: true };
    });
  };

  const toggleMediaViewerFullscreen = async () => {
    const host = mediaViewerHostRef.current;
    if (!host) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await host.requestFullscreen();
    } catch {}
  };

  const selectedContextAttachment = useMemo(() => {
    if (!contextMenu || contextMenu.mode !== 'message') return null;
    if (contextMenu.attachmentId) {
      return attachments.find((att) => att.id === contextMenu.attachmentId) || null;
    }
    if (attachments.length === 1) return attachments[0];
    return null;
  }, [attachments, contextMenu]);

  useEffect(() => {
    if (!mediaViewerAttachment) return;
    const onEsc = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => {});
        return;
      }
      setMediaViewerAttachment(null);
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [mediaViewerAttachment]);

  const mediaViewerIsVideo = Boolean(
    mediaViewerAttachment && resolveAttachmentKind(mediaViewerAttachment).isVideo
  );
  const mediaViewerIsAudio = Boolean(
    mediaViewerAttachment && resolveAttachmentKind(mediaViewerAttachment).isAudio
  );

  const scheduleMediaViewerDownloadReset = (delayMs = 1400) => {
    if (mediaViewerDownloadResetRef.current) {
      window.clearTimeout(mediaViewerDownloadResetRef.current);
    }
    mediaViewerDownloadResetRef.current = window.setTimeout(() => {
      setMediaViewerDownloadState('idle');
      mediaViewerDownloadResetRef.current = null;
    }, delayMs);
  };

  const triggerAttachmentDownload = (href: string, filename: string, contentType?: string) => {
    const extensionByContentType: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif',
      'image/svg+xml': '.svg',
      'video/mp4': '.mp4',
      'video/webm': '.webm',
      'video/quicktime': '.mov',
      'audio/mpeg': '.mp3',
      'audio/mp4': '.m4a',
      'audio/wav': '.wav',
      'application/pdf': '.pdf',
      'text/plain': '.txt',
      'application/json': '.json',
    };
    const ensureDownloadName = (rawName: string, contentType?: string) => {
      const base = (rawName || 'archivo').replace(/[\\/:"*?<>|]+/g, '-').trim() || 'archivo';
      if (/\.[a-z0-9]{2,8}$/i.test(base)) return base;
      const mapped = contentType ? extensionByContentType[contentType.toLowerCase()] : undefined;
      return `${base}${mapped || ''}`;
    };

    const a = document.createElement('a');
    a.href = href;
    a.download = ensureDownloadName(filename, contentType);
    a.rel = 'noreferrer';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const downloadAttachment = async (attachment: Attachment) => {
    try {
      if (attachment.url.startsWith('data:')) {
        triggerAttachmentDownload(attachment.url, attachment.filename || 'archivo', attachment.contentType);
        setContextFeedback('Descarga iniciada');
        setContextMenu(null);
        return;
      }

      const response = await fetch(attachment.url);
      if (!response.ok) throw new Error('fetch_failed');
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      triggerAttachmentDownload(objectUrl, attachment.filename || 'archivo', attachment.contentType || blob.type);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
      setContextFeedback('Descarga iniciada');
      setContextMenu(null);
      return;
    } catch {
      const kind = resolveAttachmentKind(attachment);
      const isVisualMedia = kind.isImage || kind.isVideo || kind.isAudio;
      if (isVisualMedia) {
        setContextFeedback('No se pudo descargar el archivo');
        setContextMenu(null);
        return;
      }
      try {
        const a = document.createElement('a');
        a.href = attachment.url;
        a.target = '_blank';
        a.rel = 'noreferrer';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setContextFeedback('Abierto en nueva pestaña para guardar');
      } catch {
        setContextFeedback('No se pudo descargar el archivo');
      } finally {
        setContextMenu(null);
      }
    }
  };

  const downloadMediaViewerAttachment = async () => {
    if (!mediaViewerAttachment || mediaViewerDownloadState === 'downloading') return;
    setMediaViewerDownloadState('downloading');
    try {
      if (mediaViewerAttachment.url.startsWith('data:')) {
        triggerAttachmentDownload(
          mediaViewerAttachment.url,
          mediaViewerAttachment.filename || 'archivo',
          mediaViewerAttachment.contentType
        );
        setMediaViewerDownloadState('done');
        scheduleMediaViewerDownloadReset(1700);
        return;
      }

      const response = await fetch(mediaViewerAttachment.url);
      if (!response.ok) throw new Error('fetch_failed');
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      triggerAttachmentDownload(
        objectUrl,
        mediaViewerAttachment.filename || 'archivo',
        mediaViewerAttachment.contentType || blob.type
      );
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
      setMediaViewerDownloadState('done');
      scheduleMediaViewerDownloadReset(1700);
    } catch {
      setMediaViewerDownloadState('error');
      scheduleMediaViewerDownloadReset(2000);
    }
  };

  const addPrivateNote = () => {
    try {
      const key = `diavlocord-user-notes-${currentUser.id}`;
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) as Record<string, string> : {};
      const prev = parsed[message.authorId] || '';
      const next = window.prompt(`Nota privada para ${author.username}`, prev);
      if (next === null) return;
      const trimmed = next.trim();
      if (!trimmed) {
        delete parsed[message.authorId];
      } else {
        parsed[message.authorId] = trimmed.slice(0, 300);
      }
      localStorage.setItem(key, JSON.stringify(parsed));
      setContextFeedback(trimmed ? 'Nota guardada' : 'Nota eliminada');
    } catch {
      setContextFeedback('No se pudo guardar la nota');
    }
    setContextMenu(null);
  };

  const toCustomReactionToken = (emoji: CustomServerEmoji) =>
    `${emoji.animated ? '<a:' : '<:'}${emoji.name}:${emoji.id}>`;

  const parseCustomReactionToken = (value: string) => {
    const m = value.match(/^<a?:([a-zA-Z0-9_]+):([a-zA-Z0-9-]+)>$/);
    if (!m) return null;
    return { name: m[1], id: m[2], animated: value.startsWith('<a:') };
  };

  const renderReactionEmoji = (value: string) => {
    const token = parseCustomReactionToken(value);
    if (!token) return <span className="text-xs leading-none animate-bounce [animation-duration:2s]">{value}</span>;
    const custom = customEmojiById[token.id];
    if (!custom) return <span className="text-xs leading-none">{`:${token.name}:`}</span>;
    return <img src={custom.url} alt={custom.name} className="w-4 h-4 rounded-sm object-cover" />;
  };

  const renderTextWithLinks = (value: string, keyPrefix: string) => {
    const urlRe = /(https?:\/\/[^\s<]+)/gi;
    const nodes: React.ReactNode[] = [];
    let cursor = 0;
    let match: RegExpExecArray | null;
    let i = 0;
    while ((match = urlRe.exec(value)) !== null) {
      const full = match[0];
      const idx = match.index;
      const plain = value.slice(cursor, idx);
      if (plain) {
        nodes.push(<React.Fragment key={`${keyPrefix}-txt-${i++}`}>{renderAnimatedText(plain)}</React.Fragment>);
      }
      nodes.push(
        <a
          key={`${keyPrefix}-url-${i++}`}
          href={full}
          target="_blank"
          rel="noreferrer noopener"
          className="underline decoration-neon-blue/40 underline-offset-2 hover:decoration-neon-blue text-neon-blue/90 hover:text-neon-blue transition-colors break-all"
          onClick={(e) => e.stopPropagation()}
        >
          {full}
        </a>
      );
      cursor = idx + full.length;
    }
    const tail = value.slice(cursor);
    if (tail) {
      nodes.push(<React.Fragment key={`${keyPrefix}-tail-${i++}`}>{renderAnimatedText(tail)}</React.Fragment>);
    }
    return nodes;
  };

  const renderMessageContent = (text: string) => {
    const tokenRe = /<a?:([a-zA-Z0-9_]+):([a-zA-Z0-9-]+)>|<@([a-zA-Z0-9-]+)>|<#([a-zA-Z0-9-]+)>/g;
    const out: React.ReactNode[] = [];
    let cursor = 0;
    let match: RegExpExecArray | null;
    let k = 0;

    while ((match = tokenRe.exec(text)) !== null) {
      const full = match[0];
      const idx = match.index;
      const before = text.slice(cursor, idx);
      if (before) out.push(<React.Fragment key={`txt-${k++}`}>{renderTextWithLinks(before, `chunk-${k}`)}</React.Fragment>);

      const emojiId = match[2];
      const userId = match[3];
      const channelId = match[4];
      if (emojiId) {
        const custom = customEmojiById[emojiId];
        if (custom) {
          out.push(
            <span key={`ce-${k++}`} className={cn("inline-flex align-middle mx-0.5", custom.animated && "float-slow")}>
              <img src={custom.url} alt={custom.name} className="w-6 h-6 rounded-sm object-cover" />
            </span>
          );
        } else {
          out.push(<React.Fragment key={`raw-${k++}`}>{full}</React.Fragment>);
        }
      } else if (userId) {
        const u = getUser(userId);
        out.push(
          <button
            key={`um-${k++}`}
            onClick={() => {
              setSelectedUserId(userId);
              setRightSidebarView('members');
            }}
            className="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded-md bg-neon-blue/15 text-neon-blue hover:bg-neon-blue/25 transition-colors font-black text-[12px]"
          >
            @{u.username}
          </button>
        );
      } else if (channelId) {
        const ch = channelById.get(channelId);
        out.push(
          <button
            key={`cm-${k++}`}
            onClick={() => setActiveChannel(channelId)}
            className="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded-md bg-white/[0.08] text-white hover:bg-white/[0.14] transition-colors font-black text-[12px]"
          >
            #{ch?.name || 'canal'}
          </button>
        );
      } else {
        out.push(<React.Fragment key={`raw-${k++}`}>{full}</React.Fragment>);
      }

      cursor = idx + full.length;
    }

    const tail = text.slice(cursor);
    if (tail) out.push(<React.Fragment key={`tail-${k++}`}>{renderTextWithLinks(tail, `tail-${k}`)}</React.Fragment>);
    return out;
  };

  return (
    <div
      id={`message-${message.id}`}
      data-message-id={message.id}
      className={cn(
        'group relative flex flex-col px-2 md:px-6 transition-all duration-300 w-full mb-1',
        entryFx && 'chat-message-pop-in',
        isMe ? 'items-end' : 'items-start',
        message.isPinned && !isMe ? 'bg-neon-blue/[0.03] border-l-2 border-neon-blue shadow-[inset_10px_0_20px_-10px_rgba(194,24,60,0.1)]' : 'hover:bg-white/[0.01]',
        message.isPinned && isMe ? 'bg-neon-blue/[0.03] border-r-2 border-neon-blue shadow-[inset_-10px_0_20px_-10px_rgba(194,24,60,0.1)]' : '',
        highlighted ? 'ring-1 ring-neon-blue/60 bg-neon-blue/[0.07]' : ''
      )}
    >
      {confirmDeleteOpen ? (
        <div className="fixed inset-0 z-[300]">
          <div className="absolute inset-0 bg-black/60" onClick={() => setConfirmDeleteOpen(false)} />
          <div className="absolute inset-0 flex items-center justify-center px-6">
            <div className="w-full max-w-md rounded-3xl apple-glass-popover mac-scale-enter shadow-2xl overflow-hidden">
              <div className="p-6">
                <div className="text-white font-black text-lg tracking-tight">¿Seguro que quieres eliminar este mensaje?</div>
                <div className="mt-3 text-[#B5BAC1] text-sm font-medium break-words">{message.content || '[Adjunto]'}</div>
              </div>
              <div className="p-6 pt-0 flex gap-3 justify-end">
                <button onClick={() => setConfirmDeleteOpen(false)} className="px-5 py-3 rounded-2xl bg-white/[0.03] border border-white/[0.06] text-white font-black uppercase tracking-widest text-[10px] hover:bg-white/[0.06] transition-all">Me arrepiento</button>
                <button onClick={onDelete} className="px-5 py-3 rounded-2xl bg-neon-pink text-black font-black uppercase tracking-widest text-[10px] hover:scale-[1.02] active:scale-[0.98] transition-all">Eliminar</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {replyToMessage ? (
        <div
          className={cn(
            'flex items-center gap-2 md:gap-3 mb-1 mt-3 md:mt-4 opacity-50 hover:opacity-100 transition-opacity cursor-pointer max-w-full',
            isMe ? 'mr-1 md:mr-4 flex-row-reverse' : 'ml-8 md:ml-12'
          )}
        >
          <div className={cn('w-6 md:w-8 h-4 border-white/20 rounded-tl-xl -mb-2', isMe ? 'border-r border-t rounded-tr-xl rounded-tl-none' : 'border-l border-t')} />
          <div className="flex items-center gap-2 bg-white/[0.03] px-2.5 md:px-3 py-1 rounded-lg border border-white/[0.05] min-w-0">
            <span className={cn("text-[10px] font-black uppercase tracking-tighter", replyAuthor?.nameClassName)} style={replyAuthor?.nameStyle || { color: replyAuthor?.color }}>{replyAuthor?.username}</span>
            {replyAuthorIsOwner ? <Crown size={10} className="text-yellow-400" /> : null}
            {replyToMessage ? <CrewBadge userId={replyToMessage.authorId} size="xs" /> : null}
            <span className="text-[10px] md:text-[11px] text-[#B5BAC1] truncate max-w-[52vw] md:max-w-[300px] italic font-medium">{replyToMessage.content || '[Adjunto]'}</span>
          </div>
        </div>
      ) : null}

      <div className={cn('flex max-w-[96%] md:max-w-[85%] gap-2.5 md:gap-4', isMe ? 'flex-row-reverse' : 'flex-row', !replyToMessage && !isCompact && 'mt-5 md:mt-6', isCompact && 'mt-1')}>
        <div className="flex-shrink-0 w-8 md:w-12 flex justify-center mt-1">
          {!isCompact ? (
            <div
              className="relative group cursor-pointer inline-flex w-8 h-8 md:w-10 md:h-10"
              onClick={openProfile}
              onContextMenu={(e) => {
                e.preventDefault();
                openUserContextMenu(e.clientX, e.clientY);
              }}
            >
              <div className="w-full h-full rounded-xl md:rounded-2xl bg-[#1E1F22] p-[2px] transition-transform duration-300 group-hover:scale-105">
                <div className="w-full h-full rounded-[inherit] overflow-hidden bg-[#0A0A0B]">
                  {author.avatar ? (
                    <img
                      src={author.avatar}
                      alt={author.username}
                      className="w-full h-full object-cover opacity-90 group-hover:opacity-100"
                      draggable={false}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        openUserContextMenu(e.clientX, e.clientY);
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs font-black text-white" style={{ color: author.color }}>
                      {author.username[0]}
                    </div>
                  )}
                </div>
              </div>
              <div
                className={cn(
                  "absolute right-0 bottom-0 translate-x-[22%] translate-y-[22%] w-2.5 h-2.5 md:w-3 md:h-3 border-2 border-[#0A0A0B] rounded-full shadow-sm",
                  statusDotClass(authorPresenceStatus)
                )}
              />
            </div>
          ) : (
            <div className="w-full text-[9px] font-black text-[#4E5058] opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center h-6">{mounted ? formattedTime : ''}</div>
          )}
        </div>

        <div className={cn('flex flex-col min-w-0', isMe ? 'items-end' : 'items-start')}>
          {!isCompact ? (
            <div className={cn('flex items-center gap-3 mb-1.5', isMe && 'flex-row-reverse')}>
              <span
                onClick={openProfile}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openUserContextMenu(e.clientX, e.clientY);
                }}
                className={cn("font-black text-white text-[13px] tracking-tight hover:text-neon-blue cursor-pointer transition-colors", author.nameClassName)}
                style={author.nameStyle || { color: author.color }}
              >
                {author.username}
              </span>
              {isMe ? <span className="text-[8px] px-1.5 py-0.5 rounded-md border border-neon-blue/30 bg-neon-blue/10 text-neon-blue font-black tracking-[0.16em]">YOU</span> : null}
              {authorIsOwner ? <Crown size={12} className="text-yellow-400" /> : null}
              {author.isBot ? <span className="bg-neon-blue/10 border border-neon-blue/20 text-neon-blue text-[7px] px-1.5 py-0.5 rounded-md font-black tracking-[0.1em]">SYSTEM</span> : null}
              <CrewBadge userId={message.authorId} size="xs" />
              <span className="text-[9px] text-[#4E5058] font-black uppercase tracking-widest flex items-center gap-2"><Clock size={10} />{mounted ? formattedTime : ''}</span>
            </div>
          ) : null}

          <div
            className={cn(
              'relative group/bubble px-5 py-3 rounded-3xl transition-all duration-300 text-[14px] leading-relaxed break-words font-medium tracking-tight selection:bg-neon-blue selection:text-white shadow-xl',
              isMe ? 'bg-neon-blue/10 border border-neon-blue/20 text-white rounded-tr-sm hover:border-neon-blue/40' : 'bg-white/[0.03] border border-white/[0.05] text-[#DBDEE1] rounded-tl-sm hover:bg-white/[0.05] hover:border-white/10',
              message.isPinned && 'shadow-[0_0_20px_rgba(194,24,60,0.05)] border-neon-blue/40'
            )}
            onMouseEnter={() => setIsBubbleHovered(true)}
            onMouseLeave={() => setIsBubbleHovered(false)}
            onDoubleClick={() => onReply?.(message)}
            onContextMenu={(e) => {
              e.preventDefault();
              openMessageContextMenu(e.clientX, e.clientY);
            }}
          >
            {canDeleteMessage && isBubbleHovered ? (
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  setConfirmDeleteOpen(true);
                }}
                className={cn(
                  "absolute top-2 right-2 z-20 w-7 h-7 rounded-lg border border-white/20",
                  "bg-black/45 text-white/80 hover:text-neon-pink hover:border-neon-pink/45 hover:bg-neon-pink/10",
                  "transition-all duration-200",
                  "inline-flex items-center justify-center apple-smooth"
                )}
                title="Eliminar mensaje"
              >
                <Trash2 size={13} />
              </button>
            ) : null}

            {editing ? (
              <div className="space-y-2">
                <input
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveEdit();
                    if (e.key === 'Escape') setEditing(false);
                  }}
                  className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white outline-none focus:border-neon-blue/40"
                  autoFocus
                />
              <div className="flex items-center gap-2 justify-end">
                <button onClick={() => setEditing(false)} className="px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest bg-white/[0.05] hover:bg-white/[0.08] transition-colors">
                  Cancelar
                </button>
                  <button onClick={saveEdit} className="px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest bg-neon-blue text-white hover:brightness-110 transition-colors">
                    Guardar
                  </button>
                </div>
              </div>
            ) : contentRaw ? (
              <div className="space-y-2">
                <div className="whitespace-pre-wrap">{renderMessageContent(displayContent)}</div>
                {shouldCollapseContent ? (
                  <button
                    onClick={() => setExpandedMessage((prev) => !prev)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-white/12 bg-white/[0.04] text-[10px] font-black uppercase tracking-[0.14em] text-white/80 hover:text-white hover:bg-white/[0.08] transition-all"
                  >
                    {expandedMessage ? 'Mostrar menos' : 'Mostrar mas'}
                  </button>
                ) : null}
              </div>
            ) : null}

            {message.threadId ? (
              <button
                onClick={() => onOpenThread?.(message)}
                className="mt-2 inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border border-neon-blue/30 bg-neon-blue/10 text-neon-blue text-[10px] font-black uppercase tracking-widest hover:bg-neon-blue/15 transition-colors"
              >
                <MessageSquare size={12} />
                Ver hilo
                {threadUnreadCount > 0 ? (
                  <span className="ml-1 min-w-4 h-4 px-1 rounded-full bg-neon-pink text-black text-[9px] font-black inline-flex items-center justify-center">
                    {Math.min(threadUnreadCount, 99)}
                  </span>
                ) : null}
              </button>
            ) : null}

            {attachments.length > 0 ? (
              <div className={cn('mt-3 grid gap-2', attachments.length > 1 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1')}>
                {attachments.map((att) => {
                  const { isImage, isVideo, isAudio, isGif } = resolveAttachmentKind(att);
                  const failed = Boolean(failedAttachmentIds[att.id]);

                  return (
                    <div key={att.id} className={cn('group/att relative rounded-2xl overflow-hidden border border-white/10 bg-black/35', isGif ? 'ring-1 ring-neon-purple/40' : '')}>
                      {(isImage || isVideo || isAudio) ? (
                        <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5 opacity-0 group-hover/att:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void downloadAttachment(att);
                            }}
                            className="w-7 h-7 rounded-lg border border-white/20 bg-black/55 text-white/85 hover:text-white hover:bg-black/80 transition-colors inline-flex items-center justify-center"
                            title="Guardar archivo"
                          >
                            <Download size={13} />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openMediaViewer(att);
                            }}
                            className="w-7 h-7 rounded-lg border border-white/20 bg-black/55 text-white/85 hover:text-white hover:bg-black/80 transition-colors inline-flex items-center justify-center"
                            title="Abrir visor"
                          >
                            <Maximize2 size={13} />
                          </button>
                        </div>
                      ) : null}
                      {failed ? (
                        <a
                          href={att.url}
                          target="_blank"
                          rel="noreferrer"
                          className="block p-3 text-sm text-neon-blue hover:underline break-all"
                          onContextMenu={(e) => {
                            e.preventDefault();
                            openMessageContextMenu(e.clientX, e.clientY, att.id);
                          }}
                        >
                          {att.filename}
                        </a>
                      ) : isImage ? (
                        <img
                          src={att.url}
                          alt={att.filename}
                          loading="lazy"
                          decoding="async"
                          className={cn(
                            'w-full h-auto max-h-[320px] object-cover cursor-zoom-in transition-transform duration-300 hover:scale-[1.01]',
                            isGif && 'shadow-[0_0_20px_rgba(90,16,35,0.25)]'
                          )}
                          draggable={false}
                          onClick={() => openMediaViewer(att)}
                          onError={() => markAttachmentFailed(att.id)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            openMessageContextMenu(e.clientX, e.clientY, att.id);
                          }}
                        />
                      ) : isVideo ? (
                        <video
                          src={att.url}
                          controls
                          playsInline
                          preload="metadata"
                          className="w-full h-auto max-h-[360px] object-contain bg-black cursor-zoom-in"
                          onError={() => markAttachmentFailed(att.id)}
                          onClick={() => openMediaViewer(att)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            openMessageContextMenu(e.clientX, e.clientY, att.id);
                          }}
                        />
                      ) : isAudio ? (
                        <div
                          className="px-3 py-3 bg-[linear-gradient(135deg,rgba(12,14,21,0.9),rgba(15,19,26,0.88))] cursor-default"
                          onContextMenu={(e) => {
                            e.preventDefault();
                            openMessageContextMenu(e.clientX, e.clientY, att.id);
                          }}
                        >
                          <GlassAudioPlayer src={att.url} filename={att.filename} compact />
                        </div>
                      ) : (
                        <a
                          href={att.url}
                          target="_blank"
                          rel="noreferrer"
                          className="block p-3 text-sm text-neon-blue hover:underline break-all"
                          onContextMenu={(e) => {
                            e.preventDefault();
                            openMessageContextMenu(e.clientX, e.clientY, att.id);
                          }}
                        >
                          {att.filename}
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}

            {isCompact ? (
              <div className={cn('absolute bottom-2 text-[8px] font-black text-[#4E5058] opacity-0 group-hover/bubble:opacity-100 transition-opacity', isMe ? '-left-8' : '-right-8')}>
                {mounted ? formattedTime : ''}
              </div>
            ) : null}
          </div>

          {reactionSummary.length > 0 ? (
            <div className={cn('mt-2 flex flex-wrap gap-1.5', isMe && 'justify-end')}>
              {reactionSummary.map((r) => (
                <button
                  key={r.emoji}
                  onClick={() => onReact(r.emoji)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setReactionInspector({ emoji: r.emoji, x: e.clientX, y: e.clientY });
                  }}
                  title={r.userIds.map((id) => getUser(id).username).join(', ')}
                  className={cn('inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-xs transition-all duration-300', r.reacted ? 'bg-neon-blue/10 border-neon-blue text-white shadow-[0_0_10px_rgba(194,24,60,0.1)]' : 'bg-white/[0.02] border-white/[0.05] text-[#B5BAC1] hover:bg-white/[0.04]')}
                >
                  {renderReactionEmoji(r.emoji)}
                  <span className="font-black text-[9px] tracking-widest">{r.count}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

      </div>

      {contextMenu ? (
        <div
          className="fixed z-[500] min-w-[260px] rounded-xl backdrop-blur-xl p-1.5 shadow-2xl apple-glass-popover mac-scale-enter"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.mode === 'user' ? (
            <>
              <button
                onClick={() => {
                  openProfile();
                  setContextMenu(null);
                }}
                className="w-full px-3 py-2 rounded-lg text-left text-sm text-white/90 hover:bg-white/[0.08] transition-colors"
              >
                Perfil
              </button>
              <button
                onClick={mentionUserFromContext}
                className="w-full px-3 py-2 rounded-lg text-left text-sm text-white/90 hover:bg-white/[0.08] transition-colors"
              >
                Mencionar
              </button>
              <button
                onClick={openDirectMessage}
                className="w-full px-3 py-2 rounded-lg text-left text-sm text-white/90 hover:bg-white/[0.08] transition-colors"
              >
                Mensaje
              </button>
              <button
                onClick={() => {
                  openDirectMessage();
                  setContextFeedback('Llamadas en DM pronto');
                }}
                className="w-full px-3 py-2 rounded-lg text-left text-sm text-white/90 hover:bg-white/[0.08] transition-colors"
              >
                Llamar
              </button>
              <button
                onClick={addPrivateNote}
                className="w-full px-3 py-2 rounded-lg text-left text-sm text-white/90 hover:bg-white/[0.08] transition-colors"
              >
                Añadir nota
              </button>

              <div className="my-1 h-px bg-white/10" />

              <button
                onClick={() => {
                  const result = sendDMRequest(message.authorId);
                  if (result.ok) setContextFeedback('Solicitud enviada');
                  else if (result.reason === 'pending') setContextFeedback('Solicitud pendiente');
                  else if (result.reason === 'self') setContextFeedback('No puedes agregarte');
                  else setContextFeedback('No se pudo enviar');
                  setContextMenu(null);
                }}
                className="w-full px-3 py-2 rounded-lg text-left text-sm text-white/90 hover:bg-white/[0.08] transition-colors"
              >
                Añadir amigo
              </button>
              <button
                onClick={() => {
                  setContextFeedback('Usuario bloqueado localmente');
                  setContextMenu(null);
                }}
                className="w-full px-3 py-2 rounded-lg text-left text-sm text-[#F28B8B] hover:bg-[#F28B8B]/12 transition-colors"
              >
                Bloquear
              </button>

              {(!isTargetOwner && !isTargetSelf && (canTimeout || canKickBan)) ? <div className="my-1 h-px bg-white/10" /> : null}

              {!isTargetOwner && !isTargetSelf && canTimeout ? (
                <button
                  onClick={() => runModeration(isTargetTimedOut ? 'untimeout' : 'timeout')}
                  className="w-full px-3 py-2 rounded-lg text-left text-sm text-[#F28B8B] hover:bg-[#F28B8B]/12 transition-colors"
                >
                  {isTargetTimedOut ? `Quitar timeout a ${author.username}` : `Aislar temporalmente a ${author.username}`}
                </button>
              ) : null}
              {!isTargetOwner && !isTargetSelf && canKickBan ? (
                <button
                  onClick={() => runModeration('kick')}
                  className="w-full px-3 py-2 rounded-lg text-left text-sm text-[#F28B8B] hover:bg-[#F28B8B]/12 transition-colors"
                >
                  Expulsar a {author.username}
                </button>
              ) : null}
              {!isTargetOwner && !isTargetSelf && canKickBan ? (
                <button
                  onClick={() => runModeration('ban')}
                  className="w-full px-3 py-2 rounded-lg text-left text-sm text-[#F28B8B] hover:bg-[#F28B8B]/12 transition-colors"
                >
                  Banear a {author.username}
                </button>
              ) : null}

              <div className="my-1 h-px bg-white/10" />
              <button
                onClick={() => void copyId(message.authorId, 'author')}
                className="w-full px-3 py-2 rounded-lg text-left text-sm text-white/90 hover:bg-white/[0.08] transition-colors flex items-center justify-between gap-3"
              >
                <span>Copiar ID del usuario</span>
                {copiedTarget === 'author' ? <Check size={14} className="text-neon-green" /> : <Copy size={14} />}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  onReply?.(message);
                  setContextMenu(null);
                }}
                className="w-full px-3 py-2 rounded-lg text-left text-sm text-white/90 hover:bg-white/[0.08] transition-colors"
              >
                Responder
              </button>
              <button
                onClick={() => {
                  onOpenThread?.(message);
                  setContextMenu(null);
                }}
                className="w-full px-3 py-2 rounded-lg text-left text-sm text-white/90 hover:bg-white/[0.08] transition-colors"
              >
                {message.threadId ? 'Abrir hilo' : 'Crear hilo'}
              </button>
              <button
                onClick={() => {
                  togglePinWithSync();
                  setContextMenu(null);
                }}
                className="w-full px-3 py-2 rounded-lg text-left text-sm text-white/90 hover:bg-white/[0.08] transition-colors"
              >
                {message.isPinned ? 'Desfijar mensaje' : 'Fijar mensaje'}
              </button>
              <button
                onClick={() => {
                  openProfile();
                  setContextMenu(null);
                }}
                className="w-full px-3 py-2 rounded-lg text-left text-sm text-white/90 hover:bg-white/[0.08] transition-colors"
              >
                Ver perfil de {author.username}
              </button>
              <button
                onClick={mentionUserFromContext}
                className="w-full px-3 py-2 rounded-lg text-left text-sm text-white/90 hover:bg-white/[0.08] transition-colors"
              >
                Mencionar a {author.username}
              </button>
              {selectedContextAttachment ? (
                <button
                  onClick={() => void downloadAttachment(selectedContextAttachment)}
                  className="w-full px-3 py-2 rounded-lg text-left text-sm text-white/90 hover:bg-white/[0.08] transition-colors"
                >
                  {resolveAttachmentKind(selectedContextAttachment).isVideo
                    ? 'Guardar video como...'
                    : resolveAttachmentKind(selectedContextAttachment).isAudio
                      ? 'Guardar audio como...'
                    : resolveAttachmentKind(selectedContextAttachment).isImage
                      ? 'Guardar imagen como...'
                      : 'Guardar archivo como...'}
                </button>
              ) : null}
              {message.content ? (
                <button
                  onClick={() => void copyMessageText()}
                  className="w-full px-3 py-2 rounded-lg text-left text-sm text-white/90 hover:bg-white/[0.08] transition-colors flex items-center justify-between gap-3"
                >
                  <span>Copiar texto</span>
                  {copiedText ? <Check size={14} className="text-neon-green" /> : null}
                </button>
              ) : null}
              {isMe ? (
                <button
                  onClick={() => {
                    startEdit();
                    setContextMenu(null);
                  }}
                  className="w-full px-3 py-2 rounded-lg text-left text-sm text-white/90 hover:bg-white/[0.08] transition-colors"
                >
                  Editar mensaje
                </button>
              ) : null}
              {canDeleteMessage ? (
                <button
                  onClick={() => {
                    setConfirmDeleteOpen(true);
                    setContextMenu(null);
                  }}
                  className="w-full px-3 py-2 rounded-lg text-left text-sm text-[#F28B8B] hover:bg-[#F28B8B]/12 transition-colors"
                >
                  Eliminar mensaje
                </button>
              ) : null}

              <div className="my-1 h-px bg-white/10" />

              <button
                onClick={() => void copyId(message.authorId, 'author')}
                className="w-full px-3 py-2 rounded-lg text-left text-sm text-white/90 hover:bg-white/[0.08] transition-colors flex items-center justify-between gap-3"
              >
                <span>Copiar ID del usuario</span>
                {copiedTarget === 'author' ? <Check size={14} className="text-neon-green" /> : <Copy size={14} />}
              </button>
              {developerMode ? (
                <button
                  onClick={() => void copyId(message.id, 'message')}
                  className="w-full px-3 py-2 rounded-lg text-left text-sm text-white/90 hover:bg-white/[0.08] transition-colors flex items-center justify-between gap-3"
                >
                  <span>Copiar Message ID</span>
                  {copiedTarget === 'message' ? <Check size={14} className="text-neon-green" /> : <Copy size={14} />}
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {mediaViewerAttachment ? (
        <div
          className="fixed inset-0 z-[540] animate-in fade-in-0 duration-200"
          onClick={closeMediaViewer}
        >
          <div className="absolute inset-0 bg-black/75 backdrop-blur-md" />
          <button
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              closeMediaViewer();
            }}
            className="fixed top-2 right-2 sm:top-3 sm:right-3 z-[550] w-10 h-10 rounded-xl border border-white/20 bg-black/45 backdrop-blur-xl text-white/90 hover:bg-[#7A1027]/45 hover:border-[#7A1027]/60 hover:text-white transition-all flex items-center justify-center"
            title="Cerrar"
            aria-label="Cerrar visor multimedia"
          >
            <X size={18} />
          </button>
          <div className="relative z-10 w-full h-full flex items-center justify-center p-2 sm:p-4 md:p-6">
            <div
              ref={mediaViewerHostRef}
              className={cn(
                "w-[min(96vw,1400px)] max-h-[96dvh] md:max-h-[92vh] flex flex-col rounded-[26px] border border-white/15",
                "bg-[linear-gradient(180deg,rgba(20,23,31,0.9),rgba(9,10,14,0.92))] backdrop-blur-2xl apple-glass-surface",
                "shadow-[0_24px_60px_rgba(0,0,0,0.62),0_0_0_1px_rgba(255,255,255,0.08),inset_0_1px_0_rgba(255,255,255,0.12)]",
                "p-3 md:p-4 animate-in zoom-in-95 slide-in-from-bottom-2 duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] mac-scale-enter"
              )}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-3 flex-shrink-0 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-white font-black text-sm truncate">{mediaViewerAttachment.filename || 'Archivo'}</div>
                  <div className="text-[10px] uppercase tracking-widest text-[#8A8F98] font-black mt-0.5">
                    {mediaViewerAttachment.contentType}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void downloadMediaViewerAttachment();
                    }}
                    disabled={mediaViewerDownloadState === 'downloading'}
                    className={cn(
                      "relative w-9 h-9 rounded-xl border border-white/15 bg-white/[0.04] text-white/85 transition-all flex items-center justify-center overflow-hidden",
                      mediaViewerDownloadState === 'idle' && "hover:bg-white/[0.1] hover:text-white",
                      mediaViewerDownloadState === 'downloading' && "border-cyan-300/45 bg-cyan-300/10 text-cyan-100 shadow-[0_0_22px_rgba(103,232,249,0.24)]",
                      mediaViewerDownloadState === 'done' && "border-[#33D17A]/50 bg-[#33D17A]/14 text-[#62F2A1] shadow-[0_0_20px_rgba(51,209,122,0.25)]",
                      mediaViewerDownloadState === 'error' && "border-[#F28B8B]/50 bg-[#F28B8B]/16 text-[#FFC4C4] shadow-[0_0_16px_rgba(242,139,139,0.2)]"
                    )}
                    title={
                      mediaViewerDownloadState === 'downloading'
                        ? 'Descargando...'
                        : mediaViewerDownloadState === 'done'
                          ? 'Descargado'
                          : mediaViewerDownloadState === 'error'
                            ? 'Error al descargar'
                            : 'Descargar archivo'
                    }
                  >
                    {mediaViewerDownloadState === 'downloading' ? (
                      <>
                        <span className="absolute inset-0 rounded-xl border border-cyan-200/35 animate-ping" />
                        <Loader2 size={16} className="animate-spin" />
                      </>
                    ) : mediaViewerDownloadState === 'done' ? (
                      <Check size={16} className="animate-in zoom-in-90 duration-200" />
                    ) : mediaViewerDownloadState === 'error' ? (
                      <X size={16} className="animate-in zoom-in-90 duration-200" />
                    ) : (
                      <Download size={16} />
                    )}
                  </button>
                  <button
                    onClick={() => void toggleMediaViewerFullscreen()}
                    className="w-9 h-9 rounded-xl border border-white/15 bg-white/[0.04] text-white/85 hover:bg-white/[0.1] hover:text-white transition-all flex items-center justify-center"
                    title={mediaViewerFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
                  >
                    {mediaViewerFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                  </button>
                  <button
                    onClick={closeMediaViewer}
                    className="w-9 h-9 rounded-xl border border-white/15 bg-white/[0.04] text-white/85 hover:bg-[#7A1027]/35 hover:border-[#7A1027]/60 hover:text-white transition-all flex items-center justify-center"
                    title="Cerrar"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>

              <div className="relative flex-1 min-h-0 overflow-auto rounded-2xl border border-white/10 bg-black/75 flex items-center justify-center min-h-[180px] md:min-h-[220px]">
                {mediaViewerIsVideo ? (
                  <video
                    src={mediaViewerAttachment.url}
                    controls
                    autoPlay
                    className="w-full max-h-[calc(96dvh-10.5rem)] md:max-h-[80vh] object-contain bg-black"
                    onClick={(event) => event.stopPropagation()}
                  />
                ) : mediaViewerIsAudio ? (
                  <div className="w-full max-w-[760px] px-3 md:px-6 py-5 md:py-10">
                    <GlassAudioPlayer
                      src={mediaViewerAttachment.url}
                      filename={mediaViewerAttachment.filename || 'audio'}
                      autoPlay
                    />
                  </div>
                ) : (
                  <img
                    src={mediaViewerAttachment.url}
                    alt={mediaViewerAttachment.filename}
                    className="w-full max-h-[calc(96dvh-10.5rem)] md:max-h-[80vh] object-contain"
                    draggable={false}
                    onClick={(event) => event.stopPropagation()}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {contextFeedback ? (
        <div className="fixed bottom-8 right-8 z-[520] px-4 py-2 rounded-xl text-white font-black uppercase tracking-widest text-[10px] shadow-2xl apple-glass-popover mac-scale-enter">
          {contextFeedback}
        </div>
      ) : null}

      {reactionInspector ? (
        <div
          className="fixed z-[510] min-w-[220px] rounded-xl backdrop-blur-xl p-2 shadow-2xl apple-glass-popover mac-scale-enter"
          style={{ left: reactionInspector.x, top: reactionInspector.y }}
        >
          <div className="px-2 py-1.5 text-[10px] font-black uppercase tracking-widest text-[#949BA4]">Reacciones</div>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {(message.reactions || [])
              .find((r) => r.emoji === reactionInspector.emoji)
              ?.userIds.map((uid) => {
                const user = getUser(uid);
                return (
                  <div key={uid} className="px-2 py-1.5 rounded-lg text-sm text-white/85 bg-white/[0.03] border border-white/[0.06] flex items-center justify-between gap-2">
                    <span className="truncate">{user.username}</span>
                    {uid === currentUser.id ? <span className="text-[9px] font-black uppercase tracking-widest text-neon-blue">Tú</span> : null}
                  </div>
                );
              })}
          </div>
          {(message.reactions || []).some((r) => r.emoji === reactionInspector.emoji && r.userIds.includes(currentUser.id)) ? (
            <button
              onClick={() => onReact(reactionInspector.emoji)}
              className="mt-2 w-full px-2 py-2 rounded-lg text-sm text-neon-pink bg-neon-pink/10 border border-neon-pink/30 hover:bg-neon-pink/15 transition-colors"
            >
              Quitar mi reacción
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="h-px w-full bg-gradient-to-r from-transparent via-white/[0.02] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
    </div>
  );
};

const areMessageItemPropsEqual = (prev: MessageItemProps, next: MessageItemProps) => {
  return (
    prev.message === next.message &&
    prev.isCompact === next.isCompact &&
    prev.highlighted === next.highlighted &&
    prev.threadUnreadCount === next.threadUnreadCount &&
    prev.entryFx === next.entryFx &&
    prev.onReply === next.onReply &&
    prev.onOpenThread === next.onOpenThread &&
    prev.onMentionUser === next.onMentionUser
  );
};

export const MessageItem = React.memo(MessageItemComponent, areMessageItemPropsEqual);
MessageItem.displayName = 'MessageItem';
