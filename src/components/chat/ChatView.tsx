import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../../lib/store';
import { Attachment, Message, ServerSticker } from '../../lib/types';
import {
  Hash,
  Bell,
  Pin,
  Users,
  Search,
  Inbox,
  PlusCircle,
  Gift,
  Sticker,
  Smile,
  X,
  Send,
  Cpu,
  Terminal,
  Copy,
  Check,
  MessageSquare,
  ChevronsDown,
  Loader2,
  UserPlus,
  Mic,
  Square,
  Command,
  CornerDownLeft,
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { MessageItem } from './MessageItem';
import { eventBus } from '../../lib/event-bus';
import { VoiceChannelView } from './VoiceChannelView';
import { cn } from '../../lib/utils';
import { t } from '../../lib/i18n';
import { hasPermission } from '../../lib/permissions';
import { SERVER_COMMANDS, resolveServerCommand } from '../../lib/server-commands';
import { isBackendEnabled } from '../../lib/env';
import { inferMimeTypeFromFilename, uploadFileToBackend } from '../../lib/media-upload';
import { announce } from '../../lib/a11y/announcer';

const QUICK_EMOJIS = [
  '\u{1F600}',
  '\u{1F602}',
  '\u{1F923}',
  '\u{1F525}',
  '\u{1F480}',
  '\u{1F4AF}',
  '\u{1FAE1}',
  '\u{1F91D}',
  '\u{1F680}',
  '\u{1F3AF}',
  '\u{1F9E0}',
  '\u{1F440}',
  '\u{26A1}',
  '\u{1F60E}',
  '\u{1F973}',
  '\u{1F3AE}',
  '\u{1F3B5}',
  '\u{1F44F}',
  '\u{1F44D}',
  '\u{1F451}',
  '\u{2764}',
  '\u{1F4A5}',
  '\u{1F62D}',
  '\u{1F63C}',
  '\u{1F601}',
  '\u{1F606}',
  '\u{1F920}',
  '\u{1F975}',
  '\u{1F919}',
  '\u{1F4AA}',
  '\u{1F494}',
  '\u{1F9E1}',
  '\u{1F3C0}',
  '\u{1F3B3}',
  '\u{1F37A}',
  '\u{1F43C}',
];
const CUSTOM_EMOJIS_STORAGE_KEY = 'diavlocord-custom-emojis';
type PickerTab = 'gif' | 'sticker' | 'emoji';

type CustomServerEmoji = {
  id: string;
  name: string;
  url: string;
  animated: boolean;
};

type MediaAsset = {
  id: string;
  url: string;
  filename: string;
  title: string;
  tags: string[];
  contentType?: string;
  serverId?: string;
  serverName?: string;
  serverIcon?: string;
};

type GifCategoryPreset = {
  id: string;
  label: string;
  query: string;
  preview: string;
};

type EmojiAsset = {
  emoji: string;
  title: string;
  tags: string[];
  category?: 'faces' | 'gestures' | 'hearts' | 'gaming' | 'tech' | 'nature' | 'food' | 'animals' | 'symbols';
};

type LiveToast = {
  id: string;
  kind: 'mention' | 'thread';
  title: string;
  body: string;
  channelId: string;
  messageId: string;
  threadId?: string;
};

type ModerationAction = 'kick' | 'ban' | 'timeout' | 'unban' | 'untimeout';

type ModerationDialogState = {
  open: boolean;
  action: ModerationAction;
  query: string;
  selectedUserId: string | null;
  durationMinutes: number;
  reason: string;
};

type AttachmentPipelineState = {
  active: boolean;
  stage: string;
  done: number;
  total: number;
};

type QuickSwitchEntry = {
  id: string;
  kind: 'channel' | 'dm';
  label: string;
  subtitle: string;
  searchText: string;
  serverId: string | null;
  channelId: string;
  badge: string;
  lastActivityTs: number;
};

const MAX_DM_DATA_URL_CHARS = 220_000_000;
const MAX_DM_ATTACHMENT_BYTES = 200 * 1024 * 1024;
const MAX_DM_TOTAL_BYTES = 200 * 1024 * 1024;
const MAX_CHANNEL_ATTACHMENT_BYTES = 200 * 1024 * 1024;
const MAX_CHANNEL_TOTAL_BYTES = 200 * 1024 * 1024;
const MAX_CHANNEL_SOCKET_PAYLOAD_BYTES = 26 * 1024 * 1024;
const MAX_LOCAL_FALLBACK_ATTACHMENT_BYTES = 24 * 1024 * 1024;
const MAX_IMAGE_EDGE = 1920;
const IMAGE_WEBP_QUALITY = 0.82;
const SCROLL_BOTTOM_THRESHOLD = 96;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_VOICE_CLIP_DURATION_MS = 5 * 60 * 1000;
const TIMELINE_WINDOW_BASE = 260;
const TIMELINE_WINDOW_STEP = 220;
const TIMELINE_WINDOW_MOBILE_BASE = 180;
const QUICK_SWITCHER_HISTORY_KEY = 'diavlocord-quick-switch-history-v1';
const QUICK_SWITCHER_HISTORY_LIMIT = 80;
const FRIENDS_VIEW_PREFS_KEY = 'diavlocord-friends-view-prefs-v1';

const normalizeQuickText = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

const compactQuickText = (value: string): string =>
  normalizeQuickText(value).replace(/[^a-z0-9#@ -]/g, '');

const isQuickSubsequence = (needle: string, haystack: string): boolean => {
  if (!needle) return true;
  let i = 0;
  for (let j = 0; j < haystack.length; j += 1) {
    if (haystack[j] === needle[i]) i += 1;
    if (i === needle.length) return true;
  }
  return false;
};

const loadQuickSwitcherHistory = (): string[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(QUICK_SWITCHER_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const uniq: string[] = [];
    const seen = new Set<string>();
    for (const entry of parsed) {
      if (typeof entry !== 'string' || !entry) continue;
      if (seen.has(entry)) continue;
      seen.add(entry);
      uniq.push(entry);
      if (uniq.length >= QUICK_SWITCHER_HISTORY_LIMIT) break;
    }
    return uniq;
  } catch {
    return [];
  }
};

const loadFriendsViewPrefs = (): {
  tab: 'online' | 'all' | 'pinned' | 'pending';
  sort: 'status' | 'name' | 'recent';
} => {
  const fallback = { tab: 'online' as const, sort: 'status' as const };
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(FRIENDS_VIEW_PREFS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<{ tab: string; sort: string }>;
    const tab =
      parsed?.tab === 'online' || parsed?.tab === 'all' || parsed?.tab === 'pinned' || parsed?.tab === 'pending'
        ? parsed.tab
        : fallback.tab;
    const sort =
      parsed?.sort === 'status' || parsed?.sort === 'name' || parsed?.sort === 'recent'
        ? parsed.sort
        : fallback.sort;
    return { tab, sort };
  } catch {
    return fallback;
  }
};

const getNormalizedMatchRange = (text: string, rawQuery: string): [number, number] | null => {
  const query = normalizeQuickText(rawQuery);
  if (!query) return null;

  const normalizedChars: string[] = [];
  const sourceIndexByNormalizedPos: number[] = [];
  for (let idx = 0; idx < text.length; idx += 1) {
    const normalized = normalizeQuickText(text[idx]);
    if (!normalized) continue;
    for (const ch of normalized) {
      normalizedChars.push(ch);
      sourceIndexByNormalizedPos.push(idx);
    }
  }

  if (normalizedChars.length === 0) return null;
  const normalizedText = normalizedChars.join('');
  const startNorm = normalizedText.indexOf(query);
  if (startNorm < 0) return null;
  const endNorm = startNorm + query.length - 1;

  const start = sourceIndexByNormalizedPos[startNorm];
  const end = sourceIndexByNormalizedPos[Math.min(endNorm, sourceIndexByNormalizedPos.length - 1)] + 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return [start, end];
};

const GIF_LIBRARY: MediaAsset[] = [
  { id: 'gif-1', url: 'https://media.giphy.com/media/ICOgUNjpvO0PC/giphy.gif', filename: 'reactor.gif', title: 'Popular 1', tags: ['popular', 'hype', 'funny'] },
  { id: 'gif-2', url: 'https://media.giphy.com/media/l0HlQ7LRalQqdWfao/giphy.gif', filename: 'hype.gif', title: 'Popular 2', tags: ['party', 'yes', 'hype'] },
  { id: 'gif-3', url: 'https://media.giphy.com/media/3o7aD2saalBwwftBIY/giphy.gif', filename: 'matrix.gif', title: 'Matrix', tags: ['matrix', 'cool', 'cyber'] },
  { id: 'gif-4', url: 'https://media.giphy.com/media/26u4nJPf0JtQPdStq/giphy.gif', filename: 'typing.gif', title: 'Typing', tags: ['typing', 'chat', 'work'] },
  { id: 'gif-5', url: 'https://media.giphy.com/media/26BRuo6sLetdllPAQ/giphy.gif', filename: 'laugh.gif', title: 'Laugh', tags: ['laugh', 'lol', 'meme'] },
  { id: 'gif-6', url: 'https://media.giphy.com/media/13CoXDiaCcCoyk/giphy.gif', filename: 'fire.gif', title: 'Fire', tags: ['fire', 'wow', 'energy'] },
];

const STICKER_LIBRARY: MediaAsset[] = [
  { id: 'st-1', url: 'https://media.giphy.com/media/3oriO0OEd9QIDdllqo/giphy.gif', filename: 'sticker-1.gif', title: 'Sticker 1', tags: ['meme', 'face', 'reaction'] },
  { id: 'st-2', url: 'https://media.giphy.com/media/xT9IgzoKnwFNmISR8I/giphy.gif', filename: 'sticker-2.gif', title: 'Sticker 2', tags: ['cat', 'dark', 'reaction'] },
  { id: 'st-3', url: 'https://media.giphy.com/media/xT9DPPqwOCoxi3ASWc/giphy.gif', filename: 'sticker-3.gif', title: 'Sticker 3', tags: ['smile', 'funny', 'reaction'] },
  { id: 'st-4', url: 'https://media.giphy.com/media/5GoVLqeAOo6PK/giphy.gif', filename: 'sticker-4.gif', title: 'Sticker 4', tags: ['hype', 'dance', 'reaction'] },
  { id: 'st-5', url: 'https://media.giphy.com/media/LmNwrBhejkK9EFP504/giphy.gif', filename: 'sticker-5.gif', title: 'Sticker 5', tags: ['cute', 'meme', 'reaction'] },
  { id: 'st-6', url: 'https://media.giphy.com/media/11sBLVxNs7v6WA/giphy.gif', filename: 'sticker-6.gif', title: 'Sticker 6', tags: ['what', 'reaction', 'mood'] },
];

const GIF_CATEGORY_PRESETS: GifCategoryPreset[] = [
  { id: 'gif-cat-favs', label: 'Favoritos', query: 'favorite', preview: 'https://media.giphy.com/media/l0HlQ7LRalQqdWfao/giphy.gif' },
  { id: 'gif-cat-pop', label: 'GIFs populares', query: 'popular', preview: 'https://media.giphy.com/media/ICOgUNjpvO0PC/giphy.gif' },
  { id: 'gif-cat-risa', label: 'Risa', query: 'laugh', preview: 'https://media.giphy.com/media/26BRuo6sLetdllPAQ/giphy.gif' },
  { id: 'gif-cat-wow', label: 'Asombrado', query: 'wow reaction', preview: 'https://media.giphy.com/media/13CoXDiaCcCoyk/giphy.gif' },
  { id: 'gif-cat-aplausos', label: 'Aplausos', query: 'applause', preview: 'https://media.giphy.com/media/3ohhweiVB36rAlqVCE/giphy.gif' },
  { id: 'gif-cat-fiesta', label: 'Fiesta', query: 'party celebration', preview: 'https://media.giphy.com/media/3KC2jD2QcBOSc/giphy.gif' },
  { id: 'gif-cat-triste', label: 'Triste', query: 'sad', preview: 'https://media.giphy.com/media/9Y5BbDSkSTiY8/giphy.gif' },
  { id: 'gif-cat-enfado', label: 'Enfado', query: 'angry', preview: 'https://media.giphy.com/media/l4FGuhL4U2WyjdkaY/giphy.gif' },
  { id: 'gif-cat-amor', label: 'Amor', query: 'love', preview: 'https://media.giphy.com/media/3oriO6qJiXajN0TyDu/giphy.gif' },
  { id: 'gif-cat-cyber', label: 'Cyber', query: 'cyberpunk', preview: 'https://media.giphy.com/media/3o7aD2saalBwwftBIY/giphy.gif' },
  { id: 'gif-cat-anime', label: 'Anime', query: 'anime reaction', preview: 'https://media.giphy.com/media/xT9IgzoKnwFNmISR8I/giphy.gif' },
  { id: 'gif-cat-mascotas', label: 'Mascotas', query: 'cute animals', preview: 'https://media.giphy.com/media/mlvseq9yvZhba/giphy.gif' },
  { id: 'gif-cat-gaming', label: 'Gaming', query: 'gaming', preview: 'https://media.giphy.com/media/l4FGpP4lxGGgK5CBW/giphy.gif' },
  { id: 'gif-cat-musica', label: 'Musica', query: 'music vibe', preview: 'https://media.giphy.com/media/GeimqsH0TLDt4tScGw/giphy.gif' },
  { id: 'gif-cat-work', label: 'Trabajo', query: 'typing work', preview: 'https://media.giphy.com/media/26u4nJPf0JtQPdStq/giphy.gif' },
  { id: 'gif-cat-hype', label: 'Hype', query: 'hype', preview: 'https://media.giphy.com/media/5GoVLqeAOo6PK/giphy.gif' },
  { id: 'gif-cat-coffee', label: 'Cafe', query: 'coffee', preview: 'https://media.giphy.com/media/3oriO04qxVReM5rJEA/giphy.gif' },
  { id: 'gif-cat-shrug', label: 'No se', query: 'shrug', preview: 'https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif' },
  { id: 'gif-cat-clap', label: 'Respeto', query: 'respect', preview: 'https://media.giphy.com/media/26gssIytJvy1b1THO/giphy.gif' },
  { id: 'gif-cat-saludo', label: 'Saludo', query: 'hello wave', preview: 'https://media.giphy.com/media/ASd0Ukj0y3qMM/giphy.gif' },
];

const EMOJI_LIBRARY: EmojiAsset[] = [
  { emoji: '\u{1F600}', title: 'grin', tags: ['smile', 'feliz', 'happy'] },
  { emoji: '\u{1F602}', title: 'laugh', tags: ['risa', 'lol', 'funny'] },
  { emoji: '\u{1F923}', title: 'rofl', tags: ['lol', 'risa', 'meme'] },
  { emoji: '\u{1F60D}', title: 'love', tags: ['amor', 'heart'] },
  { emoji: '\u{1F976}', title: 'cold', tags: ['frio', 'cool'] },
  { emoji: '\u{1F608}', title: 'devil', tags: ['diablo', 'dark'] },
  { emoji: '\u{1F480}', title: 'dead', tags: ['meme', 'skull'] },
  { emoji: '\u{1F525}', title: 'fire', tags: ['hype', 'lit'] },
  { emoji: '\u{2728}', title: 'sparkles', tags: ['shine', 'glow'] },
  { emoji: '\u{1F4AF}', title: 'hundred', tags: ['perfect', 'ok'] },
  { emoji: '\u{1FAE1}', title: 'salute', tags: ['respect', 'ok'] },
  { emoji: '\u{1F91D}', title: 'handshake', tags: ['trato', 'deal'] },
  { emoji: '\u{1F9E0}', title: 'brain', tags: ['smart', 'idea'] },
  { emoji: '\u{1F440}', title: 'eyes', tags: ['watch', 'mira'] },
  { emoji: '\u{1F3AF}', title: 'target', tags: ['goal', 'aim'] },
  { emoji: '\u{1F680}', title: 'rocket', tags: ['launch', 'ship'] },
  { emoji: '\u{1F3AE}', title: 'game', tags: ['gaming', 'play'] },
  { emoji: '\u{1F3B5}', title: 'music', tags: ['song', 'audio'] },
  { emoji: '\u{1F44F}', title: 'clap', tags: ['applause', 'well done'] },
  { emoji: '\u{2705}', title: 'check', tags: ['done', 'ok'] },
  { emoji: '\u{26A1}', title: 'lightning', tags: ['power', 'energia', 'zap'] },
  { emoji: '\u{1F389}', title: 'party', tags: ['celebrar', 'fiesta', 'hype'] },
  { emoji: '\u{1F973}', title: 'celebrate', tags: ['party', 'happy', 'brindis'] },
  { emoji: '\u{1F44D}', title: 'thumbs_up', tags: ['ok', 'like', 'bien'] },
  { emoji: '\u{1F44E}', title: 'thumbs_down', tags: ['bad', 'no', 'dislike'] },
  { emoji: '\u{1F64C}', title: 'raised_hands', tags: ['victoria', 'yes', 'hype'] },
  { emoji: '\u{1F4A5}', title: 'boom', tags: ['impact', 'wow', 'explosion'] },
  { emoji: '\u{1F44A}', title: 'punch', tags: ['fight', 'golpe', 'hit'] },
  { emoji: '\u{1F6E1}', title: 'shield', tags: ['security', 'defense', 'safe'] },
  { emoji: '\u{1F512}', title: 'lock', tags: ['secure', 'privacy', 'closed'] },
  { emoji: '\u{1F513}', title: 'unlock', tags: ['open', 'public', 'access'] },
  { emoji: '\u{1F451}', title: 'crown', tags: ['king', 'top', 'vip'] },
  { emoji: '\u{1F48E}', title: 'diamond', tags: ['premium', 'shine', 'nitro'] },
  { emoji: '\u{1FA77}', title: 'pink_heart', tags: ['heart', 'love', 'cute'] },
  { emoji: '\u{1F499}', title: 'blue_heart', tags: ['heart', 'friend', 'calm'] },
  { emoji: '\u{1F49A}', title: 'green_heart', tags: ['heart', 'nature', 'peace'] },
  { emoji: '\u{2764}', title: 'heart', tags: ['love', 'amor', 'fav'] },
  { emoji: '\u{1F49C}', title: 'purple_heart', tags: ['heart', 'vibe', 'cute'] },
  { emoji: '\u{1F49B}', title: 'yellow_heart', tags: ['heart', 'gold', 'friend'] },
  { emoji: '\u{1F31F}', title: 'star_glow', tags: ['shine', 'spark', 'bright'] },
  { emoji: '\u{1F31A}', title: 'moon', tags: ['night', 'dark', 'sleep'] },
  { emoji: '\u{1F30A}', title: 'wave', tags: ['sea', 'water', 'chill'] },
  { emoji: '\u{1F60E}', title: 'sunglasses', tags: ['cool', 'swag', 'chill'] },
  { emoji: '\u{1F60F}', title: 'smirk', tags: ['sus', 'mood', 'hmm'] },
  { emoji: '\u{1F914}', title: 'thinking', tags: ['hmm', 'idea', 'question'] },
  { emoji: '\u{1F62D}', title: 'cry', tags: ['sad', 'llorar', 'emocion'] },
  { emoji: '\u{1F97A}', title: 'teary', tags: ['cry', 'soft', 'emocion'] },
  { emoji: '\u{1F631}', title: 'scream', tags: ['shock', 'wow', 'panic'] },
  { emoji: '\u{1F92F}', title: 'mind_blown', tags: ['wow', 'omg', 'impact'] },
  { emoji: '\u{1F921}', title: 'clown', tags: ['meme', 'joke', 'troll'] },
  { emoji: '\u{1F63C}', title: 'cat_eyes', tags: ['cat', 'smile', 'cute'] },
  { emoji: '\u{1F47B}', title: 'ghost', tags: ['spooky', 'halloween', 'boo'] },
  { emoji: '\u{1F47E}', title: 'alien', tags: ['space', 'weird', 'retro'] },
  { emoji: '\u{1F916}', title: 'robot', tags: ['ai', 'bot', 'tech'] },
  { emoji: '\u{1F4BB}', title: 'laptop', tags: ['code', 'work', 'pc'] },
  { emoji: '\u{1F4F1}', title: 'phone', tags: ['mobile', 'call', 'chat'] },
  { emoji: '\u{1F50B}', title: 'battery', tags: ['power', 'charge', 'energy'] },
  { emoji: '\u{1F50C}', title: 'plug', tags: ['power', 'connect', 'electric'] },
  { emoji: '\u{1F3AE}', title: 'controller', tags: ['gaming', 'play', 'console'] },
  { emoji: '\u{1F579}', title: 'joystick', tags: ['retro', 'game', 'arcade'] },
  { emoji: '\u{1F3C6}', title: 'trophy', tags: ['win', 'top', 'rank'] },
  { emoji: '\u{1F947}', title: 'gold_medal', tags: ['champion', 'first', 'winner'] },
  { emoji: '\u{1F3C1}', title: 'finish_flag', tags: ['goal', 'done', 'race'] },
  { emoji: '\u{1F525}', title: 'fire_alt', tags: ['lit', 'caliente', 'hype'] },
  { emoji: '\u{1F30B}', title: 'volcano', tags: ['fire', 'hot', 'eruption'] },
  { emoji: '\u{1F9E8}', title: 'firecracker', tags: ['boom', 'party', 'festive'] },
  { emoji: '\u{1F3A7}', title: 'headphones', tags: ['audio', 'music', 'voice'] },
  { emoji: '\u{1F3B6}', title: 'notes', tags: ['music', 'song', 'rhythm'] },
  { emoji: '\u{1F399}', title: 'studio_mic', tags: ['podcast', 'voice', 'record'] },
  { emoji: '\u{1F4F8}', title: 'camera', tags: ['photo', 'video', 'selfie'] },
  { emoji: '\u{1F4FD}', title: 'film_projector', tags: ['video', 'stream', 'movie'] },
  { emoji: '\u{1F680}', title: 'rocket_alt', tags: ['launch', 'ship', 'fast'] },
  { emoji: '\u{1F6F8}', title: 'flying_saucer', tags: ['ufo', 'space', 'alien'] },
  { emoji: '\u{1F4A1}', title: 'light_bulb', tags: ['idea', 'smart', 'hint'] },
  { emoji: '\u{1F52C}', title: 'microscope', tags: ['study', 'science', 'lab'] },
  { emoji: '\u{1F4DA}', title: 'books', tags: ['learn', 'study', 'school'] },
  { emoji: '\u{1F4E2}', title: 'loudspeaker', tags: ['announce', 'news', 'alert'] },
  { emoji: '\u{1F514}', title: 'bell', tags: ['notification', 'ring', 'alert'] },
  { emoji: '\u{1F6A8}', title: 'siren', tags: ['alert', 'urgent', 'warning'] },
  { emoji: '\u{26A0}', title: 'warning', tags: ['cuidado', 'risk', 'danger'] },
  { emoji: '\u{1F198}', title: 'sos', tags: ['help', 'urgent', 'signal'] },
];

const EXTRA_EMOJI_LIBRARY: EmojiAsset[] = [
  { emoji: '\u{1F605}', title: 'sweat_smile', tags: ['smile', 'awkward', 'nervous'], category: 'faces' },
  { emoji: '\u{1F609}', title: 'wink', tags: ['flirt', 'ok', 'face'], category: 'faces' },
  { emoji: '\u{1F642}', title: 'slight_smile', tags: ['face', 'calm', 'soft'], category: 'faces' },
  { emoji: '\u{1F972}', title: 'happy_tear', tags: ['emocion', 'face', 'relief'], category: 'faces' },
  { emoji: '\u{1FAE0}', title: 'melting', tags: ['face', 'mood', 'heat'], category: 'faces' },
  { emoji: '\u{1F62A}', title: 'sleepy', tags: ['face', 'sleep', 'tired'], category: 'faces' },
  { emoji: '\u{1F621}', title: 'rage', tags: ['face', 'angry', 'mad'], category: 'faces' },
  { emoji: '\u{1F92C}', title: 'cursing', tags: ['face', 'angry', 'rage'], category: 'faces' },
  { emoji: '\u{1F922}', title: 'nausea', tags: ['face', 'sick', 'ugh'], category: 'faces' },
  { emoji: '\u{1F607}', title: 'angel', tags: ['face', 'halo', 'innocent'], category: 'faces' },

  { emoji: '\u{1F64F}', title: 'pray', tags: ['gracias', 'please', 'hands'], category: 'gestures' },
  { emoji: '\u{1F64C}', title: 'raised_hands_alt', tags: ['hands', 'hype', 'victoria'], category: 'gestures' },
  { emoji: '\u{1F918}', title: 'rock_hand', tags: ['music', 'hands', 'cool'], category: 'gestures' },
  { emoji: '\u{270C}\u{FE0F}', title: 'victory_hand', tags: ['peace', 'hands', 'ok'], category: 'gestures' },
  { emoji: '\u{1F44C}', title: 'ok_hand', tags: ['ok', 'hands', 'fine'], category: 'gestures' },
  { emoji: '\u{1FAF6}', title: 'heart_hands', tags: ['love', 'hands', 'cute'], category: 'gestures' },

  { emoji: '\u{1F496}', title: 'sparkling_heart', tags: ['heart', 'love', 'cute'], category: 'hearts' },
  { emoji: '\u{1F49E}', title: 'revolving_hearts', tags: ['heart', 'love', 'vibe'], category: 'hearts' },
  { emoji: '\u{1F90D}', title: 'white_heart', tags: ['heart', 'white', 'clean'], category: 'hearts' },
  { emoji: '\u{1F5A4}', title: 'black_heart', tags: ['heart', 'dark', 'emo'], category: 'hearts' },
  { emoji: '\u{1F90E}', title: 'brown_heart', tags: ['heart', 'earth', 'vibe'], category: 'hearts' },
  { emoji: '\u{1FA75}', title: 'light_blue_heart', tags: ['heart', 'blue', 'calm'], category: 'hearts' },

  { emoji: '\u{1F3B2}', title: 'dice', tags: ['game', 'luck', 'casino'], category: 'gaming' },
  { emoji: '\u{1F0CF}', title: 'joker', tags: ['cards', 'game', 'fun'], category: 'gaming' },
  { emoji: '\u{265F}\u{FE0F}', title: 'chess', tags: ['strategy', 'game', 'chess'], category: 'gaming' },
  { emoji: '\u{1F9E9}', title: 'puzzle', tags: ['game', 'brain', 'puzzle'], category: 'gaming' },

  { emoji: '\u{1F5A5}\u{FE0F}', title: 'desktop', tags: ['pc', 'tech', 'setup'], category: 'tech' },
  { emoji: '\u{1F4BE}', title: 'floppy', tags: ['save', 'tech', 'data'], category: 'tech' },
  { emoji: '\u{1F6F0}\u{FE0F}', title: 'satellite', tags: ['space', 'signal', 'tech'], category: 'tech' },
  { emoji: '\u{1F4E1}', title: 'satellite_antenna', tags: ['signal', 'network', 'tech'], category: 'tech' },
  { emoji: '\u{1F5B1}\u{FE0F}', title: 'mouse', tags: ['pc', 'tech', 'click'], category: 'tech' },
  { emoji: '\u{1F4E0}', title: 'fax', tags: ['retro', 'office', 'tech'], category: 'tech' },

  { emoji: '\u{1F308}', title: 'rainbow', tags: ['color', 'nature', 'happy'], category: 'nature' },
  { emoji: '\u{2600}\u{FE0F}', title: 'sun', tags: ['day', 'nature', 'bright'], category: 'nature' },
  { emoji: '\u{1F327}\u{FE0F}', title: 'rain', tags: ['weather', 'water', 'nature'], category: 'nature' },
  { emoji: '\u{2744}\u{FE0F}', title: 'snowflake', tags: ['cold', 'winter', 'nature'], category: 'nature' },
  { emoji: '\u{1F32A}\u{FE0F}', title: 'tornado', tags: ['storm', 'weather', 'nature'], category: 'nature' },

  { emoji: '\u{1F355}', title: 'pizza', tags: ['food', 'eat', 'party'], category: 'food' },
  { emoji: '\u{1F354}', title: 'burger', tags: ['food', 'eat', 'fast'], category: 'food' },
  { emoji: '\u{1F35F}', title: 'fries', tags: ['food', 'snack', 'fast'], category: 'food' },
  { emoji: '\u{1F32E}', title: 'taco', tags: ['food', 'mex', 'eat'], category: 'food' },
  { emoji: '\u{1F35C}', title: 'ramen', tags: ['food', 'soup', 'noodle'], category: 'food' },
  { emoji: '\u{2615}', title: 'coffee', tags: ['drink', 'morning', 'cafe'], category: 'food' },
  { emoji: '\u{1F369}', title: 'donut', tags: ['sweet', 'dessert', 'food'], category: 'food' },
  { emoji: '\u{1F37F}', title: 'popcorn', tags: ['movie', 'snack', 'food'], category: 'food' },

  { emoji: '\u{1F436}', title: 'dog', tags: ['animal', 'pet', 'cute'], category: 'animals' },
  { emoji: '\u{1F431}', title: 'cat', tags: ['animal', 'pet', 'cute'], category: 'animals' },
  { emoji: '\u{1F43A}', title: 'wolf', tags: ['animal', 'wild', 'alpha'], category: 'animals' },
  { emoji: '\u{1F98A}', title: 'fox', tags: ['animal', 'wild', 'smart'], category: 'animals' },
  { emoji: '\u{1F981}', title: 'lion', tags: ['animal', 'king', 'wild'], category: 'animals' },
  { emoji: '\u{1F438}', title: 'frog', tags: ['animal', 'meme', 'green'], category: 'animals' },
  { emoji: '\u{1F419}', title: 'octopus', tags: ['animal', 'sea', 'weird'], category: 'animals' },

  { emoji: '\u{1F60A}', title: 'blush', tags: ['face', 'happy', 'soft'], category: 'faces' },
  { emoji: '\u{1F929}', title: 'star_struck', tags: ['face', 'wow', 'hype'], category: 'faces' },
  { emoji: '\u{1F644}', title: 'eye_roll', tags: ['face', 'mood', 'meh'], category: 'faces' },
  { emoji: '\u{1F62C}', title: 'grimace', tags: ['face', 'awkward', 'stress'], category: 'faces' },
  { emoji: '\u{1F910}', title: 'zip_mouth', tags: ['face', 'secret', 'quiet'], category: 'faces' },
  { emoji: '\u{1F92B}', title: 'shush', tags: ['face', 'silencio', 'quiet'], category: 'faces' },
  { emoji: '\u{1F978}', title: 'disguised_face', tags: ['face', 'meme', 'sus'], category: 'faces' },
  { emoji: '\u{1F9D0}', title: 'monocle', tags: ['face', 'curious', 'hmm'], category: 'faces' },
  { emoji: '\u{1F913}', title: 'nerd', tags: ['face', 'smart', 'geek'], category: 'faces' },
  { emoji: '\u{1F970}', title: 'smiling_hearts', tags: ['face', 'love', 'cute'], category: 'faces' },

  { emoji: '\u{1F44B}', title: 'wave_hand', tags: ['hello', 'hands', 'saludo'], category: 'gestures' },
  { emoji: '\u{1F44C}', title: 'ok_hand_alt', tags: ['ok', 'hands', 'fine'], category: 'gestures' },
  { emoji: '\u{1F44A}', title: 'fist_bump', tags: ['hands', 'hit', 'saludo'], category: 'gestures' },
  { emoji: '\u{1F90F}', title: 'pinched_fingers', tags: ['hands', 'gesture', 'meme'], category: 'gestures' },
  { emoji: '\u{1FAF0}', title: 'handshake_light_dark', tags: ['hands', 'deal', 'respect'], category: 'gestures' },
  { emoji: '\u{1F91F}', title: 'love_you_hand', tags: ['hands', 'love', 'gesture'], category: 'gestures' },

  { emoji: '\u{1F497}', title: 'growing_heart', tags: ['heart', 'love', 'cute'], category: 'hearts' },
  { emoji: '\u{1F498}', title: 'heart_with_arrow', tags: ['heart', 'love', 'cupid'], category: 'hearts' },
  { emoji: '\u{1F493}', title: 'beating_heart', tags: ['heart', 'love', 'latido'], category: 'hearts' },
  { emoji: '\u{1F49D}', title: 'heart_ribbon', tags: ['heart', 'gift', 'love'], category: 'hearts' },
  { emoji: '\u{1F49F}', title: 'heart_decoration', tags: ['heart', 'cute', 'sparkle'], category: 'hearts' },

  { emoji: '\u{1F5FA}\u{FE0F}', title: 'map', tags: ['explore', 'adventure', 'gaming'], category: 'gaming' },
  { emoji: '\u{1F3C5}', title: 'sports_medal', tags: ['rank', 'winner', 'gaming'], category: 'gaming' },
  { emoji: '\u{1F579}\u{FE0F}', title: 'joystick_alt', tags: ['retro', 'arcade', 'gaming'], category: 'gaming' },
  { emoji: '\u{1F4A3}', title: 'bomb', tags: ['fps', 'boom', 'gaming'], category: 'gaming' },
  { emoji: '\u{1F6F9}', title: 'skateboard', tags: ['trick', 'sports', 'gaming'], category: 'gaming' },

  { emoji: '\u{2328}\u{FE0F}', title: 'keyboard', tags: ['tech', 'pc', 'type'], category: 'tech' },
  { emoji: '\u{1F9EE}', title: 'abacus', tags: ['tech', 'math', 'compute'], category: 'tech' },
  { emoji: '\u{1F4BD}', title: 'minidisc', tags: ['tech', 'storage', 'retro'], category: 'tech' },
  { emoji: '\u{1F5A8}\u{FE0F}', title: 'printer', tags: ['tech', 'office', 'hardware'], category: 'tech' },
  { emoji: '\u{1F52B}', title: 'raygun', tags: ['tech', 'future', 'space'], category: 'tech' },

  { emoji: '\u{1F33F}', title: 'herb', tags: ['nature', 'plant', 'green'], category: 'nature' },
  { emoji: '\u{1F332}', title: 'evergreen_tree', tags: ['nature', 'tree', 'forest'], category: 'nature' },
  { emoji: '\u{1F33B}', title: 'sunflower', tags: ['nature', 'flower', 'sun'], category: 'nature' },
  { emoji: '\u{1F98B}', title: 'butterfly', tags: ['nature', 'animal', 'color'], category: 'nature' },
  { emoji: '\u{1F41A}', title: 'shell', tags: ['nature', 'sea', 'beach'], category: 'nature' },

  { emoji: '\u{1F950}', title: 'croissant', tags: ['food', 'breakfast', 'bakery'], category: 'food' },
  { emoji: '\u{1F956}', title: 'baguette', tags: ['food', 'bread', 'bakery'], category: 'food' },
  { emoji: '\u{1F95E}', title: 'pancakes', tags: ['food', 'breakfast', 'sweet'], category: 'food' },
  { emoji: '\u{1F36A}', title: 'cookie', tags: ['food', 'sweet', 'dessert'], category: 'food' },
  { emoji: '\u{1F95B}', title: 'glass_milk', tags: ['drink', 'food', 'milk'], category: 'food' },

  { emoji: '\u{1F42F}', title: 'tiger', tags: ['animal', 'wild', 'beast'], category: 'animals' },
  { emoji: '\u{1F984}', title: 'unicorn', tags: ['animal', 'magic', 'cute'], category: 'animals' },
  { emoji: '\u{1F995}', title: 'dinosaur', tags: ['animal', 'jurassic', 'wild'], category: 'animals' },
  { emoji: '\u{1F997}', title: 'cricket', tags: ['animal', 'insect', 'nature'], category: 'animals' },
  { emoji: '\u{1F42C}', title: 'dolphin', tags: ['animal', 'sea', 'ocean'], category: 'animals' },

  { emoji: '\u{274C}', title: 'cross_mark', tags: ['symbol', 'error', 'no'], category: 'symbols' },
  { emoji: '\u{1F6AB}', title: 'prohibited', tags: ['symbol', 'no', 'ban'], category: 'symbols' },
  { emoji: '\u{1F6D1}', title: 'stop_sign', tags: ['symbol', 'stop', 'warning'], category: 'symbols' },
  { emoji: '\u{1F300}', title: 'cyclone', tags: ['symbol', 'vortex', 'spin'], category: 'symbols' },
  { emoji: '\u{267B}\u{FE0F}', title: 'recycle', tags: ['symbol', 'eco', 'green'], category: 'symbols' },
  { emoji: '\u{1F4A2}', title: 'anger_symbol', tags: ['symbol', 'rage', 'comic'], category: 'symbols' },
  { emoji: '\u{1F4A4}', title: 'zzz', tags: ['symbol', 'sleep', 'mood'], category: 'symbols' },

  { emoji: '\u{1F601}', title: 'beaming_face', tags: ['face', 'smile', 'happy'], category: 'faces' },
  { emoji: '\u{1F606}', title: 'grinning_squint', tags: ['face', 'laugh', 'happy'], category: 'faces' },
  { emoji: '\u{1F920}', title: 'cowboy', tags: ['face', 'fun', 'meme'], category: 'faces' },
  { emoji: '\u{1F912}', title: 'thermometer_face', tags: ['face', 'sick', 'ill'], category: 'faces' },
  { emoji: '\u{1F915}', title: 'head_bandage', tags: ['face', 'ouch', 'sick'], category: 'faces' },
  { emoji: '\u{1F975}', title: 'hot_face', tags: ['face', 'heat', 'mood'], category: 'faces' },
  { emoji: '\u{1F974}', title: 'woozy_face', tags: ['face', 'dizzy', 'mood'], category: 'faces' },
  { emoji: '\u{1F928}', title: 'raised_eyebrow', tags: ['face', 'skeptical', 'hmm'], category: 'faces' },

  { emoji: '\u{1F919}', title: 'call_me_hand', tags: ['gesture', 'hands', 'phone'], category: 'gestures' },
  { emoji: '\u{1F590}\u{FE0F}', title: 'raised_hand_fingers_splayed', tags: ['gesture', 'hands', 'hello'], category: 'gestures' },
  { emoji: '\u{1F91A}', title: 'raised_back_of_hand', tags: ['gesture', 'hands', 'saludo'], category: 'gestures' },
  { emoji: '\u{1F44B}', title: 'wave_hand_alt', tags: ['gesture', 'hello', 'bye'], category: 'gestures' },
  { emoji: '\u{1F4AA}', title: 'muscle', tags: ['gesture', 'strong', 'power'], category: 'gestures' },
  { emoji: '\u{1F595}', title: 'middle_finger', tags: ['gesture', 'meme', 'hands'], category: 'gestures' },

  { emoji: '\u{1F494}', title: 'broken_heart', tags: ['heart', 'sad', 'love'], category: 'hearts' },
  { emoji: '\u{2763}\u{FE0F}', title: 'heart_exclamation', tags: ['heart', 'love', 'symbol'], category: 'hearts' },
  { emoji: '\u{1F49B}', title: 'yellow_heart_alt', tags: ['heart', 'friendship', 'vibe'], category: 'hearts' },
  { emoji: '\u{1F49C}', title: 'purple_heart_alt', tags: ['heart', 'love', 'vibe'], category: 'hearts' },
  { emoji: '\u{1F9E1}', title: 'orange_heart', tags: ['heart', 'orange', 'warm'], category: 'hearts' },
  { emoji: '\u{1F48C}', title: 'love_letter', tags: ['heart', 'message', 'romance'], category: 'hearts' },

  { emoji: '\u{1F3C0}', title: 'basketball', tags: ['gaming', 'sport', 'ball'], category: 'gaming' },
  { emoji: '\u{26BD}', title: 'soccer', tags: ['gaming', 'sport', 'football'], category: 'gaming' },
  { emoji: '\u{1F3D0}', title: 'volleyball', tags: ['gaming', 'sport', 'ball'], category: 'gaming' },
  { emoji: '\u{1F3B3}', title: 'bowling', tags: ['gaming', 'sport', 'arcade'], category: 'gaming' },
  { emoji: '\u{2694}\u{FE0F}', title: 'crossed_swords', tags: ['gaming', 'fight', 'rpg'], category: 'gaming' },
  { emoji: '\u{1FA99}', title: 'coin', tags: ['gaming', 'loot', 'economy'], category: 'gaming' },

  { emoji: '\u{1F4BF}', title: 'optical_disc', tags: ['tech', 'media', 'storage'], category: 'tech' },
  { emoji: '\u{1F4FC}', title: 'videocassette', tags: ['tech', 'video', 'retro'], category: 'tech' },
  { emoji: '\u{231A}', title: 'watch', tags: ['tech', 'time', 'device'], category: 'tech' },
  { emoji: '\u{1F9EC}', title: 'dna', tags: ['tech', 'science', 'lab'], category: 'tech' },
  { emoji: '\u{1F9F2}', title: 'magnet', tags: ['tech', 'physics', 'science'], category: 'tech' },
  { emoji: '\u{1F52D}', title: 'telescope', tags: ['tech', 'space', 'science'], category: 'tech' },

  { emoji: '\u{1F338}', title: 'cherry_blossom', tags: ['nature', 'flower', 'spring'], category: 'nature' },
  { emoji: '\u{1F33A}', title: 'hibiscus', tags: ['nature', 'flower', 'pink'], category: 'nature' },
  { emoji: '\u{1F334}', title: 'palm_tree', tags: ['nature', 'beach', 'summer'], category: 'nature' },
  { emoji: '\u{1F335}', title: 'cactus', tags: ['nature', 'desert', 'plant'], category: 'nature' },
  { emoji: '\u{1F342}', title: 'fallen_leaf', tags: ['nature', 'autumn', 'leaf'], category: 'nature' },
  { emoji: '\u{1F341}', title: 'maple_leaf', tags: ['nature', 'autumn', 'leaf'], category: 'nature' },

  { emoji: '\u{1F363}', title: 'sushi', tags: ['food', 'japan', 'dinner'], category: 'food' },
  { emoji: '\u{1F366}', title: 'ice_cream', tags: ['food', 'dessert', 'sweet'], category: 'food' },
  { emoji: '\u{1F36B}', title: 'chocolate', tags: ['food', 'dessert', 'sweet'], category: 'food' },
  { emoji: '\u{1F353}', title: 'strawberry', tags: ['food', 'fruit', 'sweet'], category: 'food' },
  { emoji: '\u{1F964}', title: 'cup_with_straw', tags: ['food', 'drink', 'soda'], category: 'food' },
  { emoji: '\u{1F37A}', title: 'beer', tags: ['food', 'drink', 'party'], category: 'food' },

  { emoji: '\u{1F43C}', title: 'panda', tags: ['animal', 'cute', 'bear'], category: 'animals' },
  { emoji: '\u{1F428}', title: 'koala', tags: ['animal', 'cute', 'wild'], category: 'animals' },
  { emoji: '\u{1F989}', title: 'owl', tags: ['animal', 'bird', 'night'], category: 'animals' },
  { emoji: '\u{1F427}', title: 'penguin', tags: ['animal', 'bird', 'cold'], category: 'animals' },
  { emoji: '\u{1F988}', title: 'shark', tags: ['animal', 'sea', 'wild'], category: 'animals' },
  { emoji: '\u{1F984}', title: 'unicorn_alt', tags: ['animal', 'magic', 'myth'], category: 'animals' },

  { emoji: '\u{2611}\u{FE0F}', title: 'check_box', tags: ['symbol', 'check', 'done'], category: 'symbols' },
  { emoji: '\u{2757}', title: 'exclamation', tags: ['symbol', 'alert', 'warning'], category: 'symbols' },
  { emoji: '\u{2753}', title: 'question_mark', tags: ['symbol', 'question', 'help'], category: 'symbols' },
  { emoji: '\u{1F199}', title: 'up', tags: ['symbol', 'up', 'success'], category: 'symbols' },
  { emoji: '\u{1F192}', title: 'cool_button', tags: ['symbol', 'cool', 'badge'], category: 'symbols' },
  { emoji: '\u{1F197}', title: 'ok_button', tags: ['symbol', 'ok', 'badge'], category: 'symbols' },
  { emoji: '\u{1F7E2}', title: 'green_circle', tags: ['symbol', 'status', 'online'], category: 'symbols' },
  { emoji: '\u{1F534}', title: 'red_circle', tags: ['symbol', 'status', 'busy'], category: 'symbols' },
];

const EMOJI_CATEGORY_LABELS: Record<NonNullable<EmojiAsset['category']>, string> = {
  faces: 'Caras',
  gestures: 'Gestos',
  hearts: 'Corazones',
  gaming: 'Gaming',
  tech: 'Tech',
  nature: 'Naturaleza',
  food: 'Comida',
  animals: 'Animales',
  symbols: 'Simbolos',
};

const EMOJI_CATEGORY_ORDER: Array<NonNullable<EmojiAsset['category']>> = [
  'faces',
  'gestures',
  'hearts',
  'gaming',
  'tech',
  'nature',
  'food',
  'animals',
  'symbols',
];

const inferEmojiCategory = (item: EmojiAsset): NonNullable<EmojiAsset['category']> => {
  if (item.category) return item.category;
  const text = `${item.title} ${item.tags.join(' ')}`.toLowerCase();
  if (/(heart|amor|love|cute)/.test(text)) return 'hearts';
  if (/(game|gaming|controller|joystick|trophy|rank|champion|race|arcade|cards|chess|puzzle)/.test(text)) return 'gaming';
  if (/(tech|ai|bot|pc|code|mobile|phone|battery|plug|network|signal|laptop|camera|video|audio|music)/.test(text)) return 'tech';
  if (/(cat|dog|animal|ghost|alien|robot|skull|devil)/.test(text)) return 'animals';
  if (/(food|pizza|burger|ramen|drink|coffee|donut|popcorn|taco)/.test(text)) return 'food';
  if (/(sun|moon|wave|water|sea|nature|weather|rain|snow|storm|volcano|ocean|rainbow)/.test(text)) return 'nature';
  if (/(thumb|clap|hands|handshake|salute|punch|ok|gesture|pray)/.test(text)) return 'gestures';
  if (/(check|lock|unlock|shield|warning|sos|spark|fire|boom|target|rocket|star|lightning|hundred)/.test(text)) return 'symbols';
  return 'faces';
};

const attachmentFromRemote = (input: { url: string; filename: string; contentType: string }): Attachment => ({
  id: uuidv4(),
  url: input.url,
  filename: input.filename,
  contentType: input.contentType || inferMimeTypeFromFilename(input.filename),
  size: 0,
});

const fileToAttachment = (file: File): Promise<Attachment> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        id: uuidv4(),
        url: String(reader.result || ''),
        filename: file.name,
        contentType: file.type || inferMimeTypeFromFilename(file.name),
        size: file.size,
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const estimateDataUrlBytes = (value: string): number => {
  if (typeof value !== 'string' || !value.startsWith('data:')) return 0;
  const commaIndex = value.indexOf(',');
  if (commaIndex < 0) return 0;
  const header = value.slice(0, commaIndex).toLowerCase();
  const payload = value.slice(commaIndex + 1);
  if (!payload) return 0;
  if (header.includes(';base64')) return Math.floor((payload.length * 3) / 4);
  return payload.length;
};

const getAttachmentPayloadBytes = (attachment: Attachment): number => {
  if (!attachment.url.startsWith('data:')) return Math.max(attachment.size || 0, 0);
  const estimated = estimateDataUrlBytes(attachment.url);
  return estimated > 0 ? estimated : Math.max(attachment.size || 0, 0);
};

const getAttachmentTransportBytes = (attachment: Attachment): number => {
  const urlBytes = attachment.url ? attachment.url.length : 0;
  const filenameBytes = attachment.filename ? attachment.filename.length : 0;
  const contentTypeBytes = attachment.contentType ? attachment.contentType.length : 0;
  return urlBytes + filenameBytes + contentTypeBytes + 120;
};

const estimateMessageTransportBytes = (content: string, attachments: Attachment[]): number => {
  const contentBytes = typeof content === 'string' ? content.length : 0;
  const attachmentsBytes = attachments.reduce((sum, att) => sum + getAttachmentTransportBytes(att), 0);
  return contentBytes + attachmentsBytes + 600;
};

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(2)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
};

const formatDuration = (totalMs: number): string => {
  const totalSeconds = Math.max(0, Math.floor(totalMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const canOptimizeImage = (file: File) => {
  const mime = (file.type || '').toLowerCase();
  if (!mime.startsWith('image/')) return false;
  if (mime === 'image/gif' || mime === 'image/svg+xml') return false;
  return true;
};

const isAttachmentDataUrl = (attachment: Attachment): boolean =>
  typeof attachment.url === 'string' && attachment.url.startsWith('data:');

const optimizeImageAttachment = async (file: File): Promise<Attachment> => {
  const fallback = await fileToAttachment(file);
  if (!canOptimizeImage(file)) return fallback;

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = fallback.url;
    });

    const maxEdge = Math.max(image.width, image.height, 1);
    const scale = Math.min(1, MAX_IMAGE_EDGE / maxEdge);
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return fallback;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, width, height);

    const variants: Array<{ url: string; contentType: string }> = [];
    try {
      variants.push({
        url: canvas.toDataURL('image/webp', IMAGE_WEBP_QUALITY),
        contentType: 'image/webp',
      });
    } catch { }
    try {
      variants.push({
        url: canvas.toDataURL('image/jpeg', 0.86),
        contentType: 'image/jpeg',
      });
    } catch { }

    const best = variants
      .filter((entry) => entry.url.startsWith('data:image/'))
      .sort((a, b) => a.url.length - b.url.length)[0];

    if (!best || best.url.length >= fallback.url.length) return fallback;
    return {
      ...fallback,
      url: best.url,
      contentType: best.contentType,
      size: estimateDataUrlBytes(best.url) || fallback.size,
    };
  } catch {
    return fallback;
  }
};

export const ChatView = () => {
  const {
    servers,
    users,
    activeServerId,
    activeChannelId,
    setActiveServer,
    setActiveChannel,
    messages,
    threads,
    threadMessages,
    activeThreadId,
    createThread,
    setActiveThread,
    addThreadMessage,
    addMessage,
    deleteMessage,
    timeoutMember,
    clearMemberTimeout,
    kickMember,
    banMember,
    unbanMember,
    memberTimeouts,
    serverBans,
    currentUser,
    typingUsers,
    presences,
    setRightSidebarView,
    setRightSidebarOpen,
    setSelectedUserId,
    rightSidebarView,
    rightSidebarOpen,
    selectedUserId,
    language,
    developerMode,
    notificationSettings,
    dmGroups,
    pinnedDmIds,
    togglePinnedDM,
    dmRequestsIncoming,
    dmRequestsOutgoing,
    sendDMRequest,
    acceptDMRequest,
    rejectDMRequest,
    cancelDMRequest,
    backendToken,
  } = useStore();
  const [inputValue, setInputValue] = useState('');
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTab, setPickerTab] = useState<PickerTab>('emoji');
  const [pickerMotionSeed, setPickerMotionSeed] = useState(0);
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerStickerServerFilter, setPickerStickerServerFilter] = useState<string>('all');
  const [pickerPanelPos, setPickerPanelPos] = useState<{ left: number; top: number } | null>(null);
  const [pickerRemoteResults, setPickerRemoteResults] = useState<MediaAsset[] | null>(null);
  const [pickerRemoteTab, setPickerRemoteTab] = useState<'gif' | 'sticker' | null>(null);
  const [pickerRemoteQuery, setPickerRemoteQuery] = useState('');
  const [pickerRemoteLoading, setPickerRemoteLoading] = useState(false);
  const [pickerRemoteError, setPickerRemoteError] = useState<string | null>(null);
  const [giphyEnabled, setGiphyEnabled] = useState<boolean | null>(null);
  const [pickerRemoteProvider, setPickerRemoteProvider] = useState<'giphy' | 'tenor' | 'fallback' | null>(null);
  const [pickerRemoteNext, setPickerRemoteNext] = useState<string | null>(null);
  const [pickerRemoteContextKey, setPickerRemoteContextKey] = useState('');
  const [customServerEmojis, setCustomServerEmojis] = useState<CustomServerEmoji[]>([]);
  const [copiedChannelId, setCopiedChannelId] = useState<string | null>(null);
  const [copiedFriendId, setCopiedFriendId] = useState<string | null>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionKind, setMentionKind] = useState<'user' | 'channel' | null>(null);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionRange, setMentionRange] = useState<{ start: number; end: number } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [channelSearchQuery, setChannelSearchQuery] = useState('');
  const deferredChannelSearchQuery = useDeferredValue(channelSearchQuery);
  const [searchPanelOpen, setSearchPanelOpen] = useState(false);
  const [searchResultIndex, setSearchResultIndex] = useState(0);
  const [searchAuthorId, setSearchAuthorId] = useState<string>('all');
  const [searchPinnedOnly, setSearchPinnedOnly] = useState(false);
  const [searchWithFilesOnly, setSearchWithFilesOnly] = useState(false);
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);
  const [quickSwitcherQuery, setQuickSwitcherQuery] = useState('');
  const [quickSwitcherIndex, setQuickSwitcherIndex] = useState(0);
  const [quickSwitcherHistory, setQuickSwitcherHistory] = useState<string[]>(() => loadQuickSwitcherHistory());
  const [friendsViewTab, setFriendsViewTab] = useState<'online' | 'all' | 'pinned' | 'pending'>(() => loadFriendsViewPrefs().tab);
  const [friendsViewQuery, setFriendsViewQuery] = useState('');
  const [friendsViewSort, setFriendsViewSort] = useState<'status' | 'name' | 'recent'>(() => loadFriendsViewPrefs().sort);
  const [friendsSelectionIndex, setFriendsSelectionIndex] = useState(0);
  const [friendRequestQuery, setFriendRequestQuery] = useState('');
  const [friendRequestNotice, setFriendRequestNotice] = useState<string | null>(null);
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [seenMentionIds, setSeenMentionIds] = useState<string[]>([]);
  const [seenThreadMessageIds, setSeenThreadMessageIds] = useState<string[]>([]);
  const [liveToasts, setLiveToasts] = useState<LiveToast[]>([]);
  const [pendingJumpMessageId, setPendingJumpMessageId] = useState<string | null>(null);
  const [threadInput, setThreadInput] = useState('');
  const [moderationDialog, setModerationDialog] = useState<ModerationDialogState>({
    open: false,
    action: 'kick',
    query: '',
    selectedUserId: null,
    durationMinutes: 5,
    reason: '',
  });
  const [moderationError, setModerationError] = useState<string | null>(null);
  const [moderationSaving, setModerationSaving] = useState(false);
  const [attachmentPipeline, setAttachmentPipeline] = useState<AttachmentPipelineState>({
    active: false,
    stage: '',
    done: 0,
    total: 0,
  });
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [newMessagesWhileScrolled, setNewMessagesWhileScrolled] = useState(0);
  const [messageFxIds, setMessageFxIds] = useState<Record<string, true>>({});
  const [sendFx, setSendFx] = useState(false);
  const [dragOverlayActive, setDragOverlayActive] = useState(false);
  const [composerNotice, setComposerNotice] = useState<{ type: 'info' | 'error' | 'ok'; text: string } | null>(null);
  const [voiceClipState, setVoiceClipState] = useState<{
    mode: 'idle' | 'recording' | 'processing';
    durationMs: number;
  }>({ mode: 'idle', durationMs: 0 });
  const [isCompactViewport, setIsCompactViewport] = useState(false);
  const [timelineWindowSize, setTimelineWindowSize] = useState(TIMELINE_WINDOW_BASE);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputId = 'chat-file-upload';
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const gifButtonRef = useRef<HTMLButtonElement>(null);
  const stickerButtonRef = useRef<HTMLButtonElement>(null);
  const pickerPanelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mentionPanelRef = useRef<HTMLDivElement>(null);
  const channelSearchPanelRef = useRef<HTMLDivElement>(null);
  const channelSearchInputRef = useRef<HTMLInputElement>(null);
  const quickSwitcherInputRef = useRef<HTMLInputElement>(null);
  const friendsSearchInputRef = useRef<HTMLInputElement>(null);
  const friendRequestInputRef = useRef<HTMLInputElement>(null);
  const inboxPanelRef = useRef<HTMLDivElement>(null);
  const inboxButtonRef = useRef<HTMLButtonElement>(null);
  const knownThreadReplyIdsRef = useRef<Set<string>>(new Set());
  const seededThreadReplyIdsRef = useRef(false);
  const lastMessageIdRef = useRef<string | null>(null);
  const messageFxTimeoutsRef = useRef<Map<string, number>>(new Map());
  const sendFxTimeoutRef = useRef<number | null>(null);
  const composerNoticeTimeoutRef = useRef<number | null>(null);
  const dragDepthRef = useRef(0);
  const voiceRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const voiceStartedAtRef = useRef<number>(0);
  const voiceTickRef = useRef<number | null>(null);
  const voiceDiscardOnStopRef = useRef(false);
  const mentionStorageWriteRef = useRef<number | null>(null);
  const threadSeenStorageWriteRef = useRef<number | null>(null);
  const timelineMessageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const lastIncomingAnnouncementRef = useRef<{ channelId: string | null; messageId: string | null }>({
    channelId: null,
    messageId: null,
  });
  const typingStateRef = useRef<{ channelId: string | null; active: boolean; lastEmitAt: number }>({
    channelId: null,
    active: false,
    lastEmitAt: 0,
  });
  const typingStopTimerRef = useRef<number | null>(null);

  const toggleRightSidebarPanel = useCallback(
    (view: 'details' | 'members') => {
      setSelectedUserId(null);
      setInboxOpen(false);
      setSearchPanelOpen(false);
      if (rightSidebarOpen && rightSidebarView === view) {
        setRightSidebarOpen(false);
        return;
      }
      setRightSidebarOpen(true);
      setRightSidebarView(view);
    },
    [rightSidebarOpen, rightSidebarView, setRightSidebarOpen, setRightSidebarView, setSelectedUserId]
  );

  const activeServer = servers.find(s => s.id === activeServerId);
  const activeServerChannel = activeServer?.categories?.flatMap(c => c.channels).find(ch => ch.id === activeChannelId);
  const currentUserId = String(currentUser.id);
  const activeDmGroup = dmGroups.find((g) => g.id === activeChannelId) || null;
  const activeDmPeerId = activeDmGroup
    ? activeDmGroup.memberIds.find((id) => String(id) !== currentUserId) || activeDmGroup.memberIds[0] || null
    : null;
  const activeDmPeer = activeDmPeerId ? users.find((u) => String(u.id) === String(activeDmPeerId)) : undefined;
  const activeDmName =
    activeDmPeer?.displayName?.trim() ||
    activeDmPeer?.username?.trim() ||
    activeDmGroup?.name?.trim() ||
    (activeDmGroup ? `Uplink-${activeDmGroup.id.slice(-4)}` : null);
  const activeDmChannel = activeDmGroup
    ? {
      id: activeDmGroup.id,
      name: activeDmName || 'Direct Message',
      type: 'text' as const,
      topic: activeDmPeer?.username ? `Chat privado con @${activeDmPeer.username}` : 'Chat privado',
    }
    : null;
  const activeChannel = activeServerChannel || activeDmChannel;
  const isDmChannel = Boolean(activeDmGroup && activeChannel?.id === activeDmGroup.id);
  const activeThread = activeThreadId ? threads[activeThreadId] : null;
  const activeThreadList = activeThreadId ? (threadMessages[activeThreadId] || []) : [];
  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);

  const channelMessages = messages[activeChannelId || ''] || [];

  useEffect(() => {
    if (!activeChannelId || channelMessages.length === 0) return;
    const latest = channelMessages[channelMessages.length - 1];
    if (!latest) return;

    const previous = lastIncomingAnnouncementRef.current;
    if (previous.channelId === activeChannelId && previous.messageId === latest.id) return;
    lastIncomingAnnouncementRef.current = { channelId: activeChannelId, messageId: latest.id };

    if (String(latest.authorId) === String(currentUser.id)) return;
    const author = users.find((entry) => String(entry.id) === String(latest.authorId));
    const authorLabel = author?.displayName?.trim() || author?.username?.trim() || 'usuario';

    announce(`Nuevo mensaje de ${authorLabel}`, {
      priority: 'polite',
      dedupeKey: `incoming-message-${activeChannelId}-${authorLabel}`,
      minIntervalMs: 1200,
    });
  }, [activeChannelId, channelMessages, currentUser.id, users]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(max-width: 768px)');
    const updateViewport = () => setIsCompactViewport(media.matches);
    updateViewport();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', updateViewport);
      return () => media.removeEventListener('change', updateViewport);
    }
    media.addListener(updateViewport);
    return () => media.removeListener(updateViewport);
  }, []);

  useEffect(() => {
    setTimelineWindowSize(isCompactViewport ? TIMELINE_WINDOW_MOBILE_BASE : TIMELINE_WINDOW_BASE);
  }, [activeChannelId, isCompactViewport]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(
        FRIENDS_VIEW_PREFS_KEY,
        JSON.stringify({
          tab: friendsViewTab,
          sort: friendsViewSort,
        })
      );
    } catch { }
  }, [friendsViewSort, friendsViewTab]);

  const channelMetrics = useMemo(() => {
    const total = channelMessages.length;
    let pinned = 0;
    let media = 0;
    let links = 0;
    for (const msg of channelMessages) {
      if (msg.isPinned) pinned += 1;
      if (Array.isArray(msg.attachments) && msg.attachments.length > 0) media += msg.attachments.length;
      if (typeof msg.content === 'string' && /https?:\/\//i.test(msg.content)) links += 1;
    }
    return { total, pinned, media, links };
  }, [channelMessages]);
  const currentTyping = Array.from(typingUsers[activeChannelId || ''] || []).filter(uid => uid !== currentUser.id);
  const pendingAttachmentBytes = useMemo(
    () => pendingAttachments.reduce((sum, att) => sum + getAttachmentPayloadBytes(att), 0),
    [pendingAttachments]
  );
  const pendingAttachmentTransportBytes = useMemo(
    () => pendingAttachments.reduce((sum, att) => sum + getAttachmentTransportBytes(att), 0),
    [pendingAttachments]
  );
  const canSendPayload = inputValue.trim().length > 0 || pendingAttachments.length > 0;
  const canViewChannel = isDmChannel || hasPermission(activeServer, activeServerChannel, currentUser.id, 'READ_MESSAGES') || hasPermission(activeServer, activeServerChannel, currentUser.id, 'VIEW_CHANNEL');
  const canSendMessages = isDmChannel || hasPermission(activeServer, activeServerChannel, currentUser.id, 'SEND_MESSAGES');
  const canAttachFiles = isDmChannel || hasPermission(activeServer, activeServerChannel, currentUser.id, 'ATTACH_FILES') || canSendMessages;
  const voiceBusy = voiceClipState.mode !== 'idle';
  const canSend = canSendPayload && canSendMessages && !attachmentPipeline.active && !voiceBusy;
  const formatActivityTime = (iso?: string | null) => {
    if (!iso) return 'Sin actividad';
    const ts = new Date(iso).getTime();
    if (!Number.isFinite(ts)) return 'Sin actividad';
    const diff = Date.now() - ts;
    if (diff < 60_000) return 'Ahora';
    if (diff < 3_600_000) return `hace ${Math.max(1, Math.floor(diff / 60_000))} min`;
    if (diff < 86_400_000) return `hace ${Math.max(1, Math.floor(diff / 3_600_000))} h`;
    return `hace ${Math.max(1, Math.floor(diff / 86_400_000))} d`;
  };
  const resolvePresenceStatus = (userId: string, fallback: 'online' | 'idle' | 'dnd' | 'offline' = 'offline') =>
    (presences[userId]?.status || users.find((u) => u.id === userId)?.status || fallback) as
    | 'online'
    | 'idle'
    | 'dnd'
    | 'offline';
  const dmLastMessageById = useMemo(() => {
    const map = new Map<string, Message | null>();
    for (const group of dmGroups) {
      const list = messages[group.id] || [];
      map.set(group.id, list.length > 0 ? list[list.length - 1] : null);
    }
    return map;
  }, [dmGroups, messages]);
  const pinnedDmSet = useMemo(() => new Set(pinnedDmIds), [pinnedDmIds]);
  const communicationFriends = useMemo(() => {
    const unique = new Map<
      string,
      {
        dmId: string;
        user: (typeof users)[number];
        status: 'online' | 'idle' | 'dnd' | 'offline';
        lastMessage: Message | null;
        lastActivityTs: number;
        isPinned: boolean;
      }
    >();
    for (const group of dmGroups) {
      const peerId = group.memberIds.find((id) => String(id) !== currentUserId) || group.memberIds[0];
      if (!peerId) continue;
      const normalizedPeerId = String(peerId);
      if (unique.has(normalizedPeerId)) continue;
      const user = users.find((u) => String(u.id) === normalizedPeerId);
      if (!user) continue;
      const lastMessage = dmLastMessageById.get(group.id) || null;
      const lastActivityTs = lastMessage ? new Date(lastMessage.timestamp).getTime() : 0;
      unique.set(normalizedPeerId, {
        dmId: group.id,
        user,
        status: resolvePresenceStatus(normalizedPeerId, (user.status || 'offline') as 'online' | 'idle' | 'dnd' | 'offline'),
        lastMessage,
        lastActivityTs: Number.isFinite(lastActivityTs) ? lastActivityTs : 0,
        isPinned: pinnedDmSet.has(group.id),
      });
    }
    const list = Array.from(unique.values());
    return list.sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      const statusRank = { online: 0, idle: 1, dnd: 2, offline: 3 } as const;
      if (friendsViewSort === 'recent') {
        const byRecent = (b.lastActivityTs || 0) - (a.lastActivityTs || 0);
        if (byRecent !== 0) return byRecent;
      }
      if (friendsViewSort === 'status') {
        const byStatus = statusRank[a.status] - statusRank[b.status];
        if (byStatus !== 0) return byStatus;
      }
      const aLabel = a.user.displayName?.trim() || a.user.username || a.user.id;
      const bLabel = b.user.displayName?.trim() || b.user.username || b.user.id;
      return aLabel.localeCompare(bLabel);
    });
  }, [currentUser.id, dmGroups, dmLastMessageById, friendsViewSort, pinnedDmSet, presences, users]);
  const normalizedFriendsViewQuery = normalizeQuickText(friendsViewQuery);
  const visibleCommunicationFriends = useMemo(() => {
    const q = normalizedFriendsViewQuery;
    return communicationFriends.filter((entry) => {
      if (friendsViewTab === 'pending') return false;
      if (friendsViewTab === 'pinned' && !entry.isPinned) return false;
      if (friendsViewTab === 'online' && entry.status === 'offline') return false;
      if (!q) return true;
      const label = normalizeQuickText(
        `${entry.user.username || ''} ${entry.user.displayName || ''} ${entry.user.discriminator || ''} ${entry.lastMessage?.content || ''
        }`
      );
      return label.includes(q);
    });
  }, [communicationFriends, normalizedFriendsViewQuery, friendsViewTab]);
  const hasFriendsViewFilters =
    friendsViewTab !== 'online' || friendsViewSort !== 'status' || normalizedFriendsViewQuery.length > 0;
  const communicationStats = useMemo(() => {
    const total = communicationFriends.length;
    const online = communicationFriends.filter((entry) => entry.status !== 'offline').length;
    const idle = communicationFriends.filter((entry) => entry.status === 'idle').length;
    const busy = communicationFriends.filter((entry) => entry.status === 'dnd').length;
    return { total, online, idle, busy };
  }, [communicationFriends]);
  const pendingRequestTotal = dmRequestsIncoming.length + dmRequestsOutgoing.length;
  const pinnedFriendTotal = communicationFriends.filter((entry) => entry.isPinned).length;
  const activeNowFriends = useMemo(
    () => communicationFriends.filter((entry) => entry.status !== 'offline').slice(0, 10),
    [communicationFriends]
  );
  const quickSwitchEntries = useMemo(() => {
    const entries: QuickSwitchEntry[] = [];

    for (const server of servers) {
      for (const category of server.categories) {
        for (const channel of category.channels) {
          const lastMessage = (messages[channel.id] || []).at(-1);
          const lastActivityTs = lastMessage ? new Date(lastMessage.timestamp).getTime() : 0;
          entries.push({
            id: `ch:${channel.id}`,
            kind: 'channel',
            label: channel.name,
            subtitle: `${server.name} / ${category.name}`,
            searchText: `${channel.name} ${server.name} ${category.name} ${channel.topic || ''}`,
            serverId: server.id,
            channelId: channel.id,
            badge: channel.type === 'voice' ? 'VOICE' : 'TEXT',
            lastActivityTs: Number.isFinite(lastActivityTs) ? lastActivityTs : 0,
          });
        }
      }
    }

    for (const group of dmGroups) {
      const peerId = group.memberIds.find((id) => String(id) !== currentUserId) || group.memberIds[0];
      const peer = users.find((u) => String(u.id) === String(peerId));
      const label =
        peer?.displayName?.trim() ||
        peer?.username?.trim() ||
        group.name?.trim() ||
        `Uplink-${group.id.slice(-4)}`;
      const lastMessage = (messages[group.id] || []).at(-1);
      const lastActivityTs = lastMessage ? new Date(lastMessage.timestamp).getTime() : 0;
      entries.push({
        id: `dm:${group.id}`,
        kind: 'dm',
        label,
        subtitle: peer?.username ? `@${peer.username}` : 'Mensaje directo',
        searchText: `${label} ${peer?.username || ''} ${peer?.displayName || ''} ${peer?.discriminator || ''}`,
        serverId: null,
        channelId: group.id,
        badge: 'DM',
        lastActivityTs: Number.isFinite(lastActivityTs) ? lastActivityTs : 0,
      });
    }

    entries.sort((a, b) => {
      const aActive = a.channelId === activeChannelId ? 1 : 0;
      const bActive = b.channelId === activeChannelId ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      const byRecent = (b.lastActivityTs || 0) - (a.lastActivityTs || 0);
      if (byRecent !== 0) return byRecent;
      if (a.kind !== b.kind) return a.kind === 'channel' ? -1 : 1;
      return a.label.localeCompare(b.label);
    });

    return entries;
  }, [servers, dmGroups, users, messages, activeChannelId, currentUser.id]);

  const quickSwitcherResults = useMemo(() => {
    const query = compactQuickText(quickSwitcherQuery);
    if (!query) {
      const historyRank = new Map<string, number>();
      quickSwitcherHistory.forEach((id, idx) => historyRank.set(id, idx));
      return [...quickSwitchEntries]
        .sort((a, b) => {
          const aHist = historyRank.get(a.id);
          const bHist = historyRank.get(b.id);
          const aInHistory = typeof aHist === 'number';
          const bInHistory = typeof bHist === 'number';
          if (aInHistory && bInHistory) return (aHist as number) - (bHist as number);
          if (aInHistory !== bInHistory) return aInHistory ? -1 : 1;
          const aActive = a.channelId === activeChannelId ? 1 : 0;
          const bActive = b.channelId === activeChannelId ? 1 : 0;
          if (aActive !== bActive) return bActive - aActive;
          return (b.lastActivityTs || 0) - (a.lastActivityTs || 0) || a.label.localeCompare(b.label);
        })
        .slice(0, 80);
    }

    const scored = quickSwitchEntries
      .map((entry) => {
        const haystack = compactQuickText(entry.searchText);
        if (!haystack) return null;
        let score = 0;
        if (haystack === query) score = 130;
        else if (haystack.startsWith(query)) score = 112;
        else {
          const at = haystack.indexOf(query);
          if (at >= 0) score = 95 - Math.min(at, 28);
          else if (isQuickSubsequence(query, haystack)) score = 72;
        }
        if (score <= 0) return null;
        if (entry.channelId === activeChannelId) score += 10;
        return { entry, score };
      })
      .filter((item): item is { entry: QuickSwitchEntry; score: number } => Boolean(item))
      .sort((a, b) => b.score - a.score || b.entry.lastActivityTs - a.entry.lastActivityTs || a.entry.label.localeCompare(b.entry.label))
      .slice(0, 80)
      .map((item) => item.entry);

    return scored;
  }, [quickSwitchEntries, quickSwitcherQuery, activeChannelId, quickSwitcherHistory]);

  const quickSwitcherHistoryRank = useMemo(() => {
    const rank = new Map<string, number>();
    quickSwitcherHistory.forEach((id, index) => rank.set(id, index));
    return rank;
  }, [quickSwitcherHistory]);
  const communicationFriendIds = useMemo(
    () => new Set(communicationFriends.map((entry) => entry.user.id)),
    [communicationFriends]
  );
  const normalizedFriendRequestQuery = normalizeQuickText(friendRequestQuery);
  const friendRequestCandidates = useMemo(() => {
    const q = normalizedFriendRequestQuery;
    if (!q) return [] as Array<(typeof users)[number]>;
    return users
      .filter((u) => u.id !== currentUser.id)
      .filter((u) => !communicationFriendIds.has(u.id))
      .filter((u) => {
        const label = normalizeQuickText(`${u.username || ''} ${u.displayName || ''} ${u.discriminator || ''}`);
        return label.includes(q);
      })
      .sort((a, b) => {
        const aLabel = (a.displayName || a.username || a.id).toLowerCase();
        const bLabel = (b.displayName || b.username || b.id).toLowerCase();
        return aLabel.localeCompare(bLabel);
      })
      .slice(0, 6);
  }, [communicationFriendIds, currentUser.id, normalizedFriendRequestQuery, users]);
  const statusLabelByKey: Record<'online' | 'idle' | 'dnd' | 'offline', string> = {
    online: 'EN LINEA',
    idle: 'AUSENTE',
    dnd: 'OCUPADO',
    offline: 'DESCONECTADO',
  };
  const highlightFriendsViewText = useCallback(
    (text: string): React.ReactNode => {
      const range = getNormalizedMatchRange(text, friendsViewQuery);
      if (!range) return text;
      const [start, end] = range;
      return (
        <>
          {text.slice(0, start)}
          <mark className="rounded-sm bg-neon-blue/20 px-0.5 text-white">{text.slice(start, end)}</mark>
          {text.slice(end)}
        </>
      );
    },
    [friendsViewQuery]
  );
  const highlightFriendRequestText = useCallback(
    (text: string): React.ReactNode => {
      const range = getNormalizedMatchRange(text, friendRequestQuery);
      if (!range) return text;
      const [start, end] = range;
      return (
        <>
          {text.slice(0, start)}
          <mark className="rounded-sm bg-neon-green/25 px-0.5 text-white">{text.slice(start, end)}</mark>
          {text.slice(end)}
        </>
      );
    },
    [friendRequestQuery]
  );
  const resetFriendsViewFilters = useCallback(() => {
    setFriendsViewTab('online');
    setFriendsViewSort('status');
    setFriendsViewQuery('');
    setFriendsSelectionIndex(0);
  }, []);

  const moderationActionMeta: Record<ModerationAction, { title: string; subtitle: string; confirm: string }> = {
    kick: {
      title: 'Expulsar miembro',
      subtitle: 'Quita al usuario del servidor inmediatamente.',
      confirm: 'Expulsar',
    },
    ban: {
      title: 'Banear miembro',
      subtitle: 'Bloquea el acceso del usuario al servidor.',
      confirm: 'Banear',
    },
    timeout: {
      title: 'Aplicar timeout',
      subtitle: 'Restringe al usuario por el tiempo indicado.',
      confirm: 'Aplicar timeout',
    },
    unban: {
      title: 'Quitar ban',
      subtitle: 'Devuelve el acceso al usuario baneado.',
      confirm: 'Quitar ban',
    },
    untimeout: {
      title: 'Quitar timeout',
      subtitle: 'Levanta la restriccion temporal del usuario.',
      confirm: 'Quitar timeout',
    },
  };

  const memberIds = new Set(activeServer?.members.map((m) => m.userId) || []);
  const mentionableUsers = isDmChannel
    ? users.filter((u) => u.id === activeDmPeerId)
    : users.filter((u) => memberIds.has(u.id));
  const mentionableChannels = isDmChannel ? [] : activeServer?.categories?.flatMap((c) => c.channels) || [];
  const moderationCandidates = useMemo(() => {
    if (!activeServer) return [];

    if (moderationDialog.action === 'unban') {
      const banned = serverBans[activeServer.id] || [];
      return banned
        .map((entry) => {
          const user = users.find((u) => u.id === entry.userId);
          return {
            id: entry.userId,
            username: user?.username || entry.userId,
            displayName: user?.displayName || '',
            avatar: user?.avatar,
            status: user?.status || 'offline',
            subtitle: entry.reason || 'Sin motivo',
          };
        })
        .filter((item, idx, list) => list.findIndex((x) => x.id === item.id) === idx);
    }

    const members = activeServer.members
      .map((member) => users.find((u) => u.id === member.userId))
      .filter((u): u is NonNullable<typeof u> => !!u)
      .filter((u) => u.id !== currentUser.id)
      .filter((u) => u.id !== activeServer.ownerId);
    const timeoutFilteredMembers =
      moderationDialog.action === 'untimeout'
        ? members.filter((u) => Boolean(memberTimeouts[`${activeServer.id}:${u.id}`]))
        : members;

    return timeoutFilteredMembers.map((user) => ({
      id: user.id,
      username: user.username,
      displayName: user.displayName || '',
      avatar: user.avatar,
      status: user.status,
      subtitle: user.displayName ? `@${user.username}` : `#${user.discriminator}`,
    }));
  }, [activeServer, currentUser.id, memberTimeouts, moderationDialog.action, serverBans, users]);
  const moderationQuery = moderationDialog.query.trim().toLowerCase();
  const filteredModerationCandidates = useMemo(
    () =>
      moderationCandidates.filter((candidate) => {
        if (!moderationQuery) return true;
        return `${candidate.username} ${candidate.displayName} ${candidate.subtitle}`.toLowerCase().includes(moderationQuery);
      }),
    [moderationCandidates, moderationQuery]
  );
  const channelById = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const c of mentionableChannels) map.set(c.id, { id: c.id, name: c.name });
    return map;
  }, [mentionableChannels]);
  const messageAuthors = useMemo(() => {
    const ids = Array.from(new Set(channelMessages.map((m) => m.authorId)));
    return ids
      .map((id) => usersById.get(id))
      .filter((u): u is NonNullable<typeof u> => !!u);
  }, [channelMessages, usersById]);
  const timelineDateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('es-ES', {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      }),
    []
  );
  const messageTimeline = useMemo(() => {
    const out: Array<
      | { kind: 'date'; id: string; label: string }
      | { kind: 'message'; id: string; message: Message; index: number }
    > = [];
    let prevDayKey = '';
    channelMessages.forEach((msg, index) => {
      const date = new Date(msg.timestamp);
      const dayKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      if (dayKey !== prevDayKey) {
        prevDayKey = dayKey;
        const label = timelineDateFormatter.format(date);
        out.push({
          kind: 'date',
          id: `date-${dayKey}-${index}`,
          label: label.charAt(0).toUpperCase() + label.slice(1),
        });
      }
      out.push({ kind: 'message', id: msg.id, message: msg, index });
    });
    return out;
  }, [channelMessages, timelineDateFormatter]);

  const renderedTimeline = useMemo(() => {
    if (messageTimeline.length <= timelineWindowSize) return messageTimeline;

    let startIndex = Math.max(0, messageTimeline.length - timelineWindowSize);
    while (startIndex > 0 && messageTimeline[startIndex]?.kind !== 'date') {
      startIndex -= 1;
    }
    return messageTimeline.slice(startIndex);
  }, [messageTimeline, timelineWindowSize]);

  const hiddenTimelineMessageCount = useMemo(() => {
    const renderedMessages = renderedTimeline.reduce((count, entry) => count + (entry.kind === 'message' ? 1 : 0), 0);
    return Math.max(0, channelMessages.length - renderedMessages);
  }, [channelMessages.length, renderedTimeline]);
  const renderedMessageIds = useMemo(
    () => renderedTimeline.filter((entry) => entry.kind === 'message').map((entry) => entry.id),
    [renderedTimeline]
  );

  const focusTimelineMessageByIndex = useCallback(
    (index: number) => {
      if (renderedMessageIds.length === 0) return;
      const bounded = Math.max(0, Math.min(renderedMessageIds.length - 1, index));
      const targetId = renderedMessageIds[bounded];
      if (!targetId) return;
      timelineMessageRefs.current[targetId]?.focus();
    },
    [renderedMessageIds]
  );

  const handleTimelineMessageKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>, messageId: string) => {
      const currentIndex = renderedMessageIds.indexOf(messageId);
      if (currentIndex < 0) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        focusTimelineMessageByIndex(currentIndex + 1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        focusTimelineMessageByIndex(currentIndex - 1);
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        focusTimelineMessageByIndex(0);
        return;
      }
      if (event.key === 'End') {
        event.preventDefault();
        focusTimelineMessageByIndex(renderedMessageIds.length - 1);
      }
    },
    [focusTimelineMessageByIndex, renderedMessageIds]
  );

  const loadOlderTimelineItems = useCallback(() => {
    setTimelineWindowSize((prev) => prev + TIMELINE_WINDOW_STEP);
  }, []);

  const scrollToBottom = (behavior: ScrollBehavior = 'auto') => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior });
  };

  const triggerMessageFx = (messageId: string) => {
    setMessageFxIds((prev) => ({ ...prev, [messageId]: true }));
    const existing = messageFxTimeoutsRef.current.get(messageId);
    if (existing) window.clearTimeout(existing);
    const timeout = window.setTimeout(() => {
      setMessageFxIds((prev) => {
        if (!(messageId in prev)) return prev;
        const next = { ...prev };
        delete next[messageId];
        return next;
      });
      messageFxTimeoutsRef.current.delete(messageId);
    }, 720);
    messageFxTimeoutsRef.current.set(messageId, timeout);
  };

  useEffect(() => {
    return () => {
      messageFxTimeoutsRef.current.forEach((timeout) => window.clearTimeout(timeout));
      messageFxTimeoutsRef.current.clear();
      if (sendFxTimeoutRef.current) window.clearTimeout(sendFxTimeoutRef.current);
      if (composerNoticeTimeoutRef.current) window.clearTimeout(composerNoticeTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const onScroll = () => {
      const atBottom = node.scrollHeight - (node.scrollTop + node.clientHeight) <= SCROLL_BOTTOM_THRESHOLD;
      setIsAtBottom(atBottom);
      if (atBottom) setNewMessagesWhileScrolled(0);
    };
    onScroll();
    node.addEventListener('scroll', onScroll, { passive: true });
    return () => node.removeEventListener('scroll', onScroll);
  }, [activeChannelId]);

  useEffect(() => {
    const last = channelMessages[channelMessages.length - 1];
    lastMessageIdRef.current = last?.id ?? null;
    setNewMessagesWhileScrolled(0);
    setPendingAttachments([]);
    setReplyingTo(null);
    setAttachmentPipeline({ active: false, stage: '', done: 0, total: 0 });
    setComposerNotice(null);
    window.requestAnimationFrame(() => scrollToBottom('auto'));

    const draftKey =
      activeChannelId && currentUser.id
        ? `diavlocord-chat-draft:${currentUser.id}:${activeChannelId}`
        : null;
    if (!draftKey) {
      setInputValue('');
      return;
    }
    try {
      const raw = localStorage.getItem(draftKey);
      setInputValue(typeof raw === 'string' ? raw : '');
    } catch {
      setInputValue('');
    }
  }, [activeChannelId]);

  useEffect(() => {
    if (!activeChannelId || !currentUser.id) return;
    const draftKey = `diavlocord-chat-draft:${currentUser.id}:${activeChannelId}`;
    try {
      const next = inputValue.trim();
      if (next.length === 0) localStorage.removeItem(draftKey);
      else localStorage.setItem(draftKey, inputValue.slice(0, 1200));
    } catch { }
  }, [activeChannelId, currentUser.id, inputValue]);

  useEffect(() => {
    const last = channelMessages[channelMessages.length - 1];
    const nextLastId = last?.id ?? null;
    if (!nextLastId) {
      lastMessageIdRef.current = null;
      return;
    }
    const previousLastId = lastMessageIdRef.current;
    if (!previousLastId) {
      lastMessageIdRef.current = nextLastId;
      return;
    }
    if (previousLastId === nextLastId) return;

    lastMessageIdRef.current = nextLastId;
    triggerMessageFx(nextLastId);

    if (last?.authorId === currentUser.id || isAtBottom) {
      window.requestAnimationFrame(() => scrollToBottom('smooth'));
      return;
    }
    setNewMessagesWhileScrolled((prev) => Math.min(prev + 1, 99));
  }, [channelMessages, currentUser.id, isAtBottom]);

  useEffect(() => {
    const loadCustomEmojis = () => {
      try {
        const raw = localStorage.getItem(CUSTOM_EMOJIS_STORAGE_KEY);
        if (!raw) {
          setCustomServerEmojis([]);
          return;
        }
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setCustomServerEmojis(parsed as CustomServerEmoji[]);
      } catch {
        setCustomServerEmojis([]);
      }
    };

    loadCustomEmojis();
    const onStorage = () => loadCustomEmojis();
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const inPicker =
        pickerPanelRef.current?.contains(target) ||
        emojiButtonRef.current?.contains(target) ||
        gifButtonRef.current?.contains(target) ||
        stickerButtonRef.current?.contains(target);
      const inMention = mentionPanelRef.current?.contains(target) || inputRef.current?.contains(target);
      const inChannelSearch = channelSearchPanelRef.current?.contains(target) || channelSearchInputRef.current?.contains(target);
      const inInbox = inboxPanelRef.current?.contains(target) || inboxButtonRef.current?.contains(target);
      if (!inPicker && pickerOpen) setPickerOpen(false);
      if (!inMention && mentionOpen) closeMentions();
      if (!inChannelSearch && searchPanelOpen) setSearchPanelOpen(false);
      if (!inInbox && inboxOpen) setInboxOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [pickerOpen, mentionOpen, searchPanelOpen, inboxOpen]);

  useEffect(() => {
    if (!moderationDialog.open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeModerationDialog();
      }
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        applyModerationDialog();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [moderationDialog.open, moderationSaving, moderationDialog.selectedUserId, moderationDialog.durationMinutes, moderationDialog.reason]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`diavlocord-seen-mentions-${currentUser.id}`);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) setSeenMentionIds(parsed as string[]);
    } catch { }
  }, [currentUser.id]);

  useEffect(() => {
    if (mentionStorageWriteRef.current) {
      window.clearTimeout(mentionStorageWriteRef.current);
    }
    mentionStorageWriteRef.current = window.setTimeout(() => {
      try {
        localStorage.setItem(`diavlocord-seen-mentions-${currentUser.id}`, JSON.stringify(seenMentionIds.slice(-400)));
      } catch { }
      mentionStorageWriteRef.current = null;
    }, 260);

    return () => {
      if (mentionStorageWriteRef.current) {
        window.clearTimeout(mentionStorageWriteRef.current);
        mentionStorageWriteRef.current = null;
      }
    };
  }, [seenMentionIds, currentUser.id]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`diavlocord-seen-thread-replies-${currentUser.id}`);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) setSeenThreadMessageIds(parsed as string[]);
    } catch { }
  }, [currentUser.id]);

  useEffect(() => {
    if (threadSeenStorageWriteRef.current) {
      window.clearTimeout(threadSeenStorageWriteRef.current);
    }
    threadSeenStorageWriteRef.current = window.setTimeout(() => {
      try {
        localStorage.setItem(
          `diavlocord-seen-thread-replies-${currentUser.id}`,
          JSON.stringify(seenThreadMessageIds.slice(-600))
        );
      } catch { }
      threadSeenStorageWriteRef.current = null;
    }, 280);

    return () => {
      if (threadSeenStorageWriteRef.current) {
        window.clearTimeout(threadSeenStorageWriteRef.current);
        threadSeenStorageWriteRef.current = null;
      }
    };
  }, [seenThreadMessageIds, currentUser.id]);

  useEffect(() => {
    if (!activeThread) return;
    if (activeThread.channelId !== activeChannelId) {
      setActiveThread(null);
    }
  }, [activeThread, activeChannelId, setActiveThread]);

  useEffect(() => {
    if (!activeThreadId) return;
    const ids = (threadMessages[activeThreadId] || [])
      .filter((m) => m.authorId !== currentUser.id)
      .map((m) => m.id);
    if (ids.length === 0) return;
    setSeenThreadMessageIds((prev) => Array.from(new Set([...prev, ...ids])));
  }, [activeThreadId, threadMessages, currentUser.id]);

  const panelLeft = (rect: DOMRect, width: number) => {
    const ideal = rect.right - width;
    const max = Math.max(12, window.innerWidth - width - 12);
    return Math.min(Math.max(12, ideal), max);
  };

  const closePickers = () => {
    setPickerOpen(false);
    setPickerQuery('');
  };

  const switchPickerTab = (tab: PickerTab) => {
    if (pickerTab === tab) return;
    setPickerTab(tab);
    setPickerQuery('');
    setPickerRemoteResults(null);
    setPickerRemoteNext(null);
    setPickerRemoteTab(null);
    setPickerRemoteQuery('');
    setPickerRemoteContextKey('');
    setPickerRemoteError(null);
    if (tab !== 'sticker') {
      setPickerStickerServerFilter('all');
    }
  };

  const openPicker = (tab: PickerTab, button: React.RefObject<HTMLButtonElement | null>) => {
    if (!canSendMessages) return;
    if (pickerOpen && pickerTab === tab) {
      setPickerOpen(false);
      return;
    }
    const rect = button.current?.getBoundingClientRect();
    if (rect) {
      const width = typeof window !== 'undefined'
        ? Math.min(420, Math.max(280, window.innerWidth - 24))
        : 420;
      setPickerPanelPos({
        left: panelLeft(rect, width),
        top: Math.max(12, rect.top - 14),
      });
    }
    setPickerTab(tab);
    setPickerQuery('');
    if (tab !== 'sticker') {
      setPickerStickerServerFilter('all');
    }
    setPickerOpen(true);
  };

  const parseMentionAtCursor = (value: string, cursor: number) => {
    const left = value.slice(0, cursor);
    const match = left.match(/(^|\s)([@#])([a-zA-Z0-9_-]{0,32})$/);
    if (!match) return null;
    const trigger = match[2];
    const query = match[3] || '';
    const full = `${trigger}${query}`;
    const start = cursor - full.length;
    return {
      kind: trigger === '@' ? ('user' as const) : ('channel' as const),
      query,
      range: { start, end: cursor },
    };
  };

  const closeMentions = () => {
    setMentionOpen(false);
    setMentionKind(null);
    setMentionQuery('');
    setMentionRange(null);
    setMentionIndex(0);
  };

  const copyChannelId = async () => {
    if (!activeChannel) return;
    try {
      await navigator.clipboard.writeText(activeChannel.id);
      setCopiedChannelId(activeChannel.id);
      setTimeout(() => setCopiedChannelId(null), 1500);
    } catch { }
  };

  const copyFriendId = async (userId: string) => {
    try {
      await navigator.clipboard.writeText(userId);
      setCopiedFriendId(userId);
      window.setTimeout(() => {
        setCopiedFriendId((prev) => (prev === userId ? null : prev));
      }, 1500);
    } catch { }
  };

  const sendFriendRequest = (targetUserId: string) => {
    const result = sendDMRequest(targetUserId);
    if (!result.ok) {
      if (result.reason === 'pending') {
        setFriendRequestNotice('Ya tienes una solicitud pendiente con este usuario.');
      } else if (result.reason === 'self') {
        setFriendRequestNotice('No puedes abrir DM contigo mismo.');
      } else {
        setFriendRequestNotice('No se pudo enviar la solicitud.');
      }
      return;
    }
    setFriendRequestNotice('Solicitud enviada.');
    setFriendsViewTab('pending');
    setFriendRequestQuery('');
  };

  const emitTyping = (active: boolean) => {
    const now = Date.now();
    const prev = typingStateRef.current;
    const targetChannelId = activeChannelId || prev.channelId || null;
    if (!targetChannelId) return;

    if (typingStopTimerRef.current !== null) {
      window.clearTimeout(typingStopTimerRef.current);
      typingStopTimerRef.current = null;
    }

    const channelChanged = Boolean(prev.channelId && prev.channelId !== targetChannelId);
    if (channelChanged && prev.active && prev.channelId) {
      eventBus.emit('TYPING_STOP', { channelId: prev.channelId, userId: currentUser.id });
    }

    const cadenceMs = active ? 5000 : 1200;
    const shouldEmit =
      channelChanged || prev.active !== active || now - prev.lastEmitAt >= cadenceMs;
    const nextLastEmitAt = shouldEmit ? now : prev.lastEmitAt;

    if (shouldEmit) {
      eventBus.emit(active ? 'TYPING_START' : 'TYPING_STOP', { channelId: targetChannelId, userId: currentUser.id });
    }

    typingStateRef.current = {
      channelId: targetChannelId,
      active,
      lastEmitAt: nextLastEmitAt,
    };

    if (active) {
      typingStopTimerRef.current = window.setTimeout(() => {
        const state = typingStateRef.current;
        if (!state.active || !state.channelId) return;
        eventBus.emit('TYPING_STOP', { channelId: state.channelId, userId: currentUser.id });
        typingStateRef.current = {
          channelId: state.channelId,
          active: false,
          lastEmitAt: Date.now(),
        };
        typingStopTimerRef.current = null;
      }, 4600);
    }
  };

  useEffect(() => {
    const prev = typingStateRef.current;
    const nextChannelId = activeChannelId || null;
    if (prev.active && prev.channelId && prev.channelId !== nextChannelId) {
      eventBus.emit('TYPING_STOP', { channelId: prev.channelId, userId: currentUser.id });
      typingStateRef.current = {
        channelId: nextChannelId,
        active: false,
        lastEmitAt: Date.now(),
      };
      return;
    }
    typingStateRef.current = { ...prev, channelId: nextChannelId };
  }, [activeChannelId, currentUser.id]);

  useEffect(() => {
    return () => {
      if (typingStopTimerRef.current !== null) {
        window.clearTimeout(typingStopTimerRef.current);
        typingStopTimerRef.current = null;
      }
      const prev = typingStateRef.current;
      if (prev.active && prev.channelId) {
        eventBus.emit('TYPING_STOP', { channelId: prev.channelId, userId: currentUser.id });
      }
      typingStateRef.current = { channelId: null, active: false, lastEmitAt: 0 };
    };
  }, [currentUser.id]);

  const mentionOptions = useMemo(() => {
    if (!mentionOpen || !mentionKind) return [];
    const q = mentionQuery.trim().toLowerCase();
    if (mentionKind === 'user') {
      return mentionableUsers
        .filter((u) => u.id !== currentUser.id)
        .filter((u) => !q || u.username.toLowerCase().includes(q) || (u.displayName || '').toLowerCase().includes(q))
        .slice(0, 8)
        .map((u) => ({
          id: u.id,
          label: u.displayName ? `${u.displayName} (@${u.username})` : `@${u.username}`,
          token: `<@${u.id}>`,
        }));
    }
    return mentionableChannels
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .slice(0, 8)
      .map((c) => ({
        id: c.id,
        label: `#${c.name}`,
        token: `<#${c.id}>`,
      }));
  }, [mentionOpen, mentionKind, mentionQuery, mentionableUsers, mentionableChannels, currentUser.id]);

  const normalizedPickerQuery = pickerQuery.trim().toLowerCase();
  const filteredGifLibrary = useMemo(
    () =>
      GIF_LIBRARY.filter((item) =>
        normalizedPickerQuery.length === 0
          ? true
          : `${item.title} ${item.filename} ${item.tags.join(' ')}`.toLowerCase().includes(normalizedPickerQuery)
      ),
    [normalizedPickerQuery]
  );
  const visibleGifCategories = useMemo(
    () =>
      GIF_CATEGORY_PRESETS.filter((entry) =>
        normalizedPickerQuery.length === 0
          ? true
          : `${entry.label} ${entry.query}`.toLowerCase().includes(normalizedPickerQuery)
      ),
    [normalizedPickerQuery]
  );
  const stickerServerSources = useMemo(() => {
    const sources = servers
      .filter((server) => Array.isArray(server.stickers) && server.stickers.length > 0)
      .map((server) => ({
        id: server.id,
        name: server.name,
        icon: server.icon || null,
        count: (server.stickers || []).length,
      }));
    return sources.sort((a, b) => {
      if (a.id === activeServerId) return -1;
      if (b.id === activeServerId) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [servers, activeServerId]);
  const allServerStickerLibrary = useMemo(() => {
    const assets: MediaAsset[] = [];
    for (const server of servers) {
      const raw: ServerSticker[] = Array.isArray(server.stickers) ? server.stickers : [];
      for (const item of raw) {
        assets.push({
          id: `server-${server.id}-${item.id}`,
          url: item.url,
          filename: item.name || 'sticker',
          title: item.name || 'Sticker',
          tags: [item.animated ? 'animated' : 'static', 'server', 'custom', server.name.toLowerCase()],
          contentType: item.contentType || (item.animated ? 'image/gif' : 'image/webp'),
          serverId: server.id,
          serverName: server.name,
          serverIcon: server.icon || undefined,
        });
      }
    }
    return assets;
  }, [servers]);
  const mergedStickerLibrary = useMemo(() => {
    const merged = [...allServerStickerLibrary, ...STICKER_LIBRARY];
    const dedup = new Map<string, MediaAsset>();
    for (const sticker of merged) {
      const key = sticker.id || `${sticker.url}:${sticker.filename}`;
      if (dedup.has(key)) continue;
      dedup.set(key, sticker);
    }
    return Array.from(dedup.values());
  }, [allServerStickerLibrary]);
  const filteredStickerLibrary = useMemo(
    () =>
      mergedStickerLibrary.filter((item) =>
        (pickerStickerServerFilter === 'all' || item.serverId === pickerStickerServerFilter) &&
        (normalizedPickerQuery.length === 0
          ? true
          : `${item.title} ${item.filename} ${item.tags.join(' ')}`.toLowerCase().includes(normalizedPickerQuery))
      ),
    [mergedStickerLibrary, normalizedPickerQuery, pickerStickerServerFilter]
  );
  const pickerSelectedStickerServer = useMemo(
    () => stickerServerSources.find((server) => server.id === pickerStickerServerFilter) || null,
    [stickerServerSources, pickerStickerServerFilter]
  );
  useEffect(() => {
    if (pickerStickerServerFilter === 'all') return;
    if (stickerServerSources.some((server) => server.id === pickerStickerServerFilter)) return;
    setPickerStickerServerFilter('all');
  }, [pickerStickerServerFilter, stickerServerSources]);
  const fullEmojiLibrary = useMemo(() => {
    const byKey = new Map<string, EmojiAsset>();
    for (const item of [...EMOJI_LIBRARY, ...EXTRA_EMOJI_LIBRARY]) {
      const normalized: EmojiAsset = {
        ...item,
        category: inferEmojiCategory(item),
      };
      const key = `${normalized.emoji}:${normalized.title}`;
      if (!byKey.has(key)) byKey.set(key, normalized);
    }
    return Array.from(byKey.values());
  }, []);
  const filteredEmojiLibrary = useMemo(
    () =>
      fullEmojiLibrary.filter((item) =>
        normalizedPickerQuery.length === 0
          ? true
          : `${item.title} ${item.tags.join(' ')}`.toLowerCase().includes(normalizedPickerQuery)
      ),
    [fullEmojiLibrary, normalizedPickerQuery]
  );
  const filteredEmojiByCategory = useMemo(() => {
    const map = new Map<NonNullable<EmojiAsset['category']>, EmojiAsset[]>();
    for (const category of EMOJI_CATEGORY_ORDER) {
      map.set(category, []);
    }
    for (const item of filteredEmojiLibrary) {
      const category = inferEmojiCategory(item);
      map.get(category)?.push(item);
    }
    return EMOJI_CATEGORY_ORDER
      .map((category) => ({
        category,
        label: EMOJI_CATEGORY_LABELS[category],
        items: map.get(category) || [],
      }))
      .filter((entry) => entry.items.length > 0);
  }, [filteredEmojiLibrary]);
  const filteredCustomEmojis = useMemo(
    () =>
      customServerEmojis.filter((item) =>
        normalizedPickerQuery.length === 0
          ? true
          : `${item.name} ${item.animated ? 'animated gif' : 'static'}`.toLowerCase().includes(normalizedPickerQuery)
      ),
    [customServerEmojis, normalizedPickerQuery]
  );
  const pickerCurrentRemoteKey =
    pickerTab === 'gif' || pickerTab === 'sticker'
      ? `${pickerTab}::${normalizedPickerQuery}::${pickerTab === 'sticker' ? pickerStickerServerFilter : 'all'}`
      : '';
  const remoteMatchesCurrent =
    (pickerTab === 'gif' || pickerTab === 'sticker') &&
    pickerRemoteContextKey === pickerCurrentRemoteKey &&
    pickerRemoteTab === pickerTab &&
    pickerRemoteQuery === normalizedPickerQuery;
  const hasRemoteResults =
    remoteMatchesCurrent &&
    giphyEnabled !== false &&
    Array.isArray(pickerRemoteResults) &&
    pickerRemoteResults.length > 0;
  const visibleGifLibrary =
    hasRemoteResults && pickerRemoteResults ? pickerRemoteResults : filteredGifLibrary;
  const visibleStickerLibrary = useMemo(() => {
    const merged = [...filteredStickerLibrary];
    if (pickerStickerServerFilter === 'all' && hasRemoteResults && pickerRemoteResults) {
      merged.push(...pickerRemoteResults);
    }
    const seen = new Set<string>();
    return merged.filter((item) => {
      const key = item.id || `${item.url}:${item.filename}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [filteredStickerLibrary, hasRemoteResults, pickerRemoteResults, pickerStickerServerFilter]);

  useEffect(() => {
    if (!pickerOpen) return;
    if (pickerTab !== 'gif' && pickerTab !== 'sticker') return;
    if (pickerTab === 'sticker' && pickerStickerServerFilter !== 'all') {
      setPickerRemoteLoading(false);
      setPickerRemoteResults(null);
      setPickerRemoteNext(null);
      setPickerRemoteError(null);
      return;
    }

    const contextKey = `${pickerTab}::${normalizedPickerQuery}::${pickerTab === 'sticker' ? pickerStickerServerFilter : 'all'}`;
    const ctrl = new AbortController();
    const timer = window.setTimeout(async () => {
      setPickerRemoteLoading(true);
      setPickerRemoteError(null);
      try {
        const params = new URLSearchParams({
          type: pickerTab,
          q: normalizedPickerQuery,
          limit: '24',
          pos: '0',
        });
        const response = await fetch(`/api/giphy/search?${params.toString()}`, {
          signal: ctrl.signal,
          cache: 'no-store',
        });
        const data = await response.json() as {
          enabled?: boolean;
          provider?: 'giphy' | 'tenor' | 'fallback';
          results?: MediaAsset[];
          next?: string | null;
          error?: string;
        };
        if (typeof data.enabled === 'boolean') setGiphyEnabled(data.enabled);
        if (data.provider) setPickerRemoteProvider(data.provider);
        setPickerRemoteContextKey(contextKey);
        setPickerRemoteTab(pickerTab);
        setPickerRemoteQuery(normalizedPickerQuery);
        if (data.enabled === false) {
          setPickerRemoteResults(null);
          setPickerRemoteNext(null);
          setPickerRemoteLoading(false);
          return;
        }
        setPickerRemoteResults(Array.isArray(data.results) ? data.results : []);
        setPickerRemoteNext(data.next || null);
        if (data.error) setPickerRemoteError('Media remota no disponible temporalmente. Usando fallback local.');
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        setPickerRemoteResults(null);
        setPickerRemoteContextKey(contextKey);
        setPickerRemoteTab(pickerTab);
        setPickerRemoteQuery(normalizedPickerQuery);
        setPickerRemoteNext(null);
        setPickerRemoteError('Error de red en media remota. Usando fallback local.');
      } finally {
        setPickerRemoteLoading(false);
      }
    }, 220);

    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [pickerOpen, pickerTab, normalizedPickerQuery, pickerStickerServerFilter]);

  useEffect(() => {
    if (!pickerOpen) return;
    setPickerMotionSeed((prev) => prev + 1);
  }, [pickerOpen, pickerTab]);

  const loadMoreRemoteMedia = async () => {
    if (!pickerOpen || (pickerTab !== 'gif' && pickerTab !== 'sticker')) return;
    if (pickerTab === 'sticker' && pickerStickerServerFilter !== 'all') return;
    if (!remoteMatchesCurrent || !pickerRemoteNext || pickerRemoteLoading || giphyEnabled === false) return;

    setPickerRemoteLoading(true);
    setPickerRemoteError(null);
    try {
      const params = new URLSearchParams({
        type: pickerTab,
        q: normalizedPickerQuery,
        limit: '24',
        pos: pickerRemoteNext,
      });
      const response = await fetch(`/api/giphy/search?${params.toString()}`, {
        cache: 'no-store',
      });
      const data = await response.json() as {
        enabled?: boolean;
        provider?: 'giphy' | 'tenor' | 'fallback';
        results?: MediaAsset[];
        next?: string | null;
        error?: string;
      };
      if (typeof data.enabled === 'boolean') setGiphyEnabled(data.enabled);
      if (data.provider) setPickerRemoteProvider(data.provider);
      if (data.enabled === false) {
        setPickerRemoteNext(null);
        return;
      }
      const incoming = Array.isArray(data.results) ? data.results : [];
      setPickerRemoteResults((prev) => {
        const current = Array.isArray(prev) ? prev : [];
        const merged = [...current, ...incoming];
        const seen = new Set<string>();
        return merged.filter((item) => {
          if (seen.has(item.id)) return false;
          seen.add(item.id);
          return true;
        });
      });
      setPickerRemoteNext(data.next || null);
      if (data.error) setPickerRemoteError('Media remota no disponible temporalmente. Usando fallback local.');
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        setPickerRemoteError('Error de red en media remota. Reintenta.');
      }
    } finally {
      setPickerRemoteLoading(false);
    }
  };

  const usernameMentionPattern = useMemo(
    () => new RegExp(`(^|\\s)@${currentUser.username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\b|\\s|$)`, 'i'),
    [currentUser.username]
  );

  const pushToast = (toast: Omit<LiveToast, 'id'>) => {
    const id = uuidv4();
    setLiveToasts((prev) => [...prev, { ...toast, id }].slice(-4));
    window.setTimeout(() => {
      setLiveToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4600);
  };

  const pushComposerNotice = (text: string, type: 'info' | 'error' | 'ok' = 'info') => {
    setComposerNotice({ type, text });
    if (type === 'error') {
      announce(text, {
        priority: 'assertive',
        dedupeKey: `composer-error-${text}`,
        minIntervalMs: 1500,
      });
    }
    if (composerNoticeTimeoutRef.current) window.clearTimeout(composerNoticeTimeoutRef.current);
    composerNoticeTimeoutRef.current = window.setTimeout(() => {
      setComposerNotice((prev) => (prev?.text === text ? null : prev));
      composerNoticeTimeoutRef.current = null;
    }, 4200);
  };

  const validateAttachmentForTarget = (attachment: Attachment, targetIsDm: boolean): string | null => {
    const payloadBytes = getAttachmentPayloadBytes(attachment);
    const singleLimit = targetIsDm ? MAX_DM_ATTACHMENT_BYTES : MAX_CHANNEL_ATTACHMENT_BYTES;
    if (payloadBytes > singleLimit) {
      return targetIsDm
        ? `El archivo "${attachment.filename}" supera el maximo para DM (${formatBytes(singleLimit)}).`
        : `El archivo "${attachment.filename}" es demasiado pesado para enviarlo en tiempo real (${formatBytes(singleLimit)} max).`;
    }
    if (targetIsDm && attachment.url.startsWith('data:') && attachment.url.length > MAX_DM_DATA_URL_CHARS) {
      return `El archivo "${attachment.filename}" excede el limite de payload del backend para DM.`;
    }
    return null;
  };

  const validateAttachmentBatch = (attachments: Attachment[], targetIsDm: boolean): string | null => {
    const totalBytes = attachments.reduce((sum, att) => sum + getAttachmentPayloadBytes(att), 0);
    const totalLimit = targetIsDm ? MAX_DM_TOTAL_BYTES : MAX_CHANNEL_TOTAL_BYTES;
    if (totalBytes > totalLimit) {
      return targetIsDm
        ? `El lote de adjuntos supera el maximo para DM (${formatBytes(totalLimit)}).`
        : `Demasiados adjuntos para un envio. Maximo recomendado: ${formatBytes(totalLimit)}.`;
    }
    if (!targetIsDm) {
      const transportBytes = estimateMessageTransportBytes('', attachments);
      if (transportBytes > MAX_CHANNEL_SOCKET_PAYLOAD_BYTES) {
        return `El lote supera el limite de transporte en tiempo real (${formatBytes(MAX_CHANNEL_SOCKET_PAYLOAD_BYTES)}). Reduce peso o cantidad.`;
      }
    }
    for (const attachment of attachments) {
      const error = validateAttachmentForTarget(attachment, targetIsDm);
      if (error) return error;
    }
    return null;
  };

  const triggerSendFx = () => {
    setSendFx(true);
    if (sendFxTimeoutRef.current) window.clearTimeout(sendFxTimeoutRef.current);
    sendFxTimeoutRef.current = window.setTimeout(() => {
      setSendFx(false);
      sendFxTimeoutRef.current = null;
    }, 360);
  };

  const playNotifySound = (kind: 'mention' | 'thread') => {
    const enabled =
      kind === 'mention' ? notificationSettings.enableSoundMentions : notificationSettings.enableSoundThreadReplies;
    if (!enabled || typeof window === 'undefined') return;
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = kind === 'mention' ? 950 : 780;
      gain.gain.value = 0.0001;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const now = ctx.currentTime;
      gain.gain.exponentialRampToValueAtTime(0.06, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.22);
      window.setTimeout(() => void ctx.close(), 280);
    } catch { }
  };

  const pushDesktop = (kind: 'mention' | 'thread', title: string, body: string) => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    const enabled =
      kind === 'mention' ? notificationSettings.desktopMentions : notificationSettings.desktopThreadReplies;
    if (!enabled) return;
    if (Notification.permission !== 'granted') return;
    if (document.hasFocus()) return;
    try {
      new Notification(title, { body, tag: `diavlocord-${kind}` });
    } catch { }
  };

  useEffect(() => {
    if (!mentionOpen) return;
    if (mentionOptions.length === 0) {
      setMentionIndex(0);
      return;
    }
    setMentionIndex((prev) => Math.min(prev, mentionOptions.length - 1));
  }, [mentionOpen, mentionOptions]);

  const applyMention = (option: { token: string }) => {
    if (!mentionRange) return;
    const next = `${inputValue.slice(0, mentionRange.start)}${option.token} ${inputValue.slice(mentionRange.end)}`;
    setInputValue(next);
    closeMentions();
    emitTyping(next.trim().length > 0 || pendingAttachments.length > 0);
    requestAnimationFrame(() => {
      const caret = mentionRange.start + option.token.length + 1;
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(caret, caret);
    });
  };

  const postCommandFeedback = (text: string, kind: 'ok' | 'error' = 'ok') => {
    if (!activeChannelId) return;
    const message: Message = {
      id: uuidv4(),
      channelId: activeChannelId,
      authorId: currentUser.id,
      content: `${kind === 'error' ? '[ERROR]' : '[CMD]'} ${text}`,
      timestamp: new Date().toISOString(),
    };
    addMessage(activeChannelId, message);
    eventBus.emit('MESSAGE_CREATED', { channelId: activeChannelId, message });
  };

  const resolveTargetMemberUser = (rawTarget: string) => {
    if (!activeServer) return null;
    const memberIds = new Set(activeServer.members.map((m) => m.userId));
    const candidates = users.filter((u) => memberIds.has(u.id));
    const mentionMatch = rawTarget.match(/^<@([a-zA-Z0-9-]+)>$/);
    if (mentionMatch) {
      return candidates.find((u) => u.id === mentionMatch[1]) || null;
    }
    const normalized = rawTarget.replace(/^@/, '').trim().toLowerCase();
    if (!normalized) return null;
    return (
      candidates.find((u) => u.id === normalized) ||
      candidates.find((u) => u.username.toLowerCase() === normalized) ||
      candidates.find((u) => (u.displayName || '').toLowerCase() === normalized) ||
      candidates.find((u) => u.username.toLowerCase().includes(normalized)) ||
      null
    );
  };

  const resolveAnyUser = (rawTarget: string) => {
    const mentionMatch = rawTarget.match(/^<@([a-zA-Z0-9-]+)>$/);
    if (mentionMatch) return users.find((u) => u.id === mentionMatch[1]) || null;
    const normalized = rawTarget.replace(/^@/, '').trim().toLowerCase();
    if (!normalized) return null;
    return (
      users.find((u) => u.id === normalized) ||
      users.find((u) => u.username.toLowerCase() === normalized) ||
      users.find((u) => (u.displayName || '').toLowerCase() === normalized) ||
      users.find((u) => u.username.toLowerCase().includes(normalized)) ||
      null
    );
  };

  const openModerationDialog = (
    action: ModerationAction,
    prefill?: { targetToken?: string; durationMinutes?: number; reason?: string }
  ) => {
    if (!activeServer || isDmChannel) {
      postCommandFeedback('Este comando solo funciona dentro de un servidor.', 'error');
      return;
    }

    const resolver = action === 'unban' ? resolveAnyUser : resolveTargetMemberUser;
    const preselected = prefill?.targetToken ? resolver(prefill.targetToken) : null;
    const defaultDuration = Math.max(1, Math.min(10080, Math.floor(prefill?.durationMinutes || 5)));
    const nextReason = prefill?.reason?.trim() || '';
    setModerationError(null);
    setModerationDialog({
      open: true,
      action,
      query: prefill?.targetToken ? prefill.targetToken.replace(/^@/, '') : '',
      selectedUserId: preselected?.id || null,
      durationMinutes: defaultDuration,
      reason: nextReason,
    });
  };

  const closeModerationDialog = () => {
    if (moderationSaving) return;
    setModerationError(null);
    setModerationDialog((prev) => ({ ...prev, open: false }));
  };

  const applyModerationDialog = () => {
    if (!activeServer || moderationSaving) return;
    const targetId = moderationDialog.selectedUserId;
    if (!targetId) {
      setModerationError('Selecciona un usuario.');
      return;
    }

    const targetUser = users.find((u) => u.id === targetId);
    if (!targetUser) {
      setModerationError('Usuario no valido.');
      return;
    }
    if (targetId === currentUser.id) {
      setModerationError('No puedes aplicarte esta accion.');
      return;
    }
    if (
      (moderationDialog.action === 'kick' || moderationDialog.action === 'ban' || moderationDialog.action === 'timeout') &&
      activeServer.ownerId === targetId
    ) {
      setModerationError('No puedes ejecutar esta accion sobre el owner del servidor.');
      return;
    }

    setModerationSaving(true);
    setModerationError(null);
    const reason = moderationDialog.reason.trim();

    try {
      if (moderationDialog.action === 'kick') {
        kickMember(activeServer.id, targetId, reason || 'Sin motivo');
        postCommandFeedback(`${targetUser.username} fue expulsado del servidor.${reason ? ` Motivo: ${reason}.` : ''}`);
      } else if (moderationDialog.action === 'ban') {
        banMember(activeServer.id, targetId, reason || 'Sin motivo');
        postCommandFeedback(`${targetUser.username} fue baneado.${reason ? ` Motivo: ${reason}.` : ''}`);
      } else if (moderationDialog.action === 'timeout') {
        const minutes = Math.max(1, Math.min(10080, Math.floor(moderationDialog.durationMinutes || 5)));
        timeoutMember(activeServer.id, targetId, minutes, reason || undefined);
        postCommandFeedback(
          `${targetUser.username} en timeout por ${minutes} minuto(s).${reason ? ` Motivo: ${reason}.` : ''}`
        );
      } else if (moderationDialog.action === 'untimeout') {
        clearMemberTimeout(activeServer.id, targetId);
        postCommandFeedback(`Se quito el timeout de ${targetUser.username}.${reason ? ` Nota: ${reason}.` : ''}`);
      } else if (moderationDialog.action === 'unban') {
        unbanMember(activeServer.id, targetId);
        postCommandFeedback(`${targetUser.username} fue desbaneado.${reason ? ` Motivo: ${reason}.` : ''}`);
      }

      setModerationDialog((prev) => ({ ...prev, open: false }));
    } finally {
      setModerationSaving(false);
    }
  };

  const handleSlashCommand = (rawInput: string): boolean => {
    if (!activeChannelId) return false;
    const text = rawInput.trim();
    if (!text.startsWith('/')) return false;

    const body = text.slice(1).trim();
    if (!body) return true;
    const parts = body.split(/\s+/);
    const commandName = (parts.shift() || '').toLowerCase();
    const command = resolveServerCommand(commandName);
    if (!command) {
      postCommandFeedback(`Comando desconocido: /${commandName}. Usa /help`, 'error');
      return true;
    }

    if (command.name === 'help') {
      const lines = SERVER_COMMANDS.map((cmd) => {
        const perm = cmd.requiredPermission ? ` [perm: ${cmd.requiredPermission}]` : '';
        return `${cmd.usage}${perm} - ${cmd.description}`;
      });
      postCommandFeedback(`Comandos disponibles:\n${lines.join('\n')}`);
      return true;
    }

    if (!activeServer || isDmChannel) {
      postCommandFeedback('Este comando solo funciona dentro de un servidor.', 'error');
      return true;
    }

    if (
      command.requiredPermission &&
      !hasPermission(activeServer, activeServerChannel, currentUser.id, command.requiredPermission)
    ) {
      postCommandFeedback(`No tienes permiso (${command.requiredPermission}) para usar /${command.name}.`, 'error');
      return true;
    }

    if (command.name === 'clear') {
      const amountRaw = Number(parts[0] || 20);
      const amount = Number.isFinite(amountRaw) ? Math.max(1, Math.min(200, Math.floor(amountRaw))) : 20;
      const targets = [...channelMessages].slice(-amount);
      for (const msg of targets) {
        deleteMessage(activeChannelId, msg.id);
        eventBus.emit('MESSAGE_DELETED', { channelId: activeChannelId, messageId: msg.id });
      }
      postCommandFeedback(`Se limpiaron ${targets.length} mensaje(s) del canal.`);
      return true;
    }

    if (command.name === 'kick') {
      const targetToken = parts[0];
      const reason = parts.slice(1).join(' ').trim();
      openModerationDialog('kick', { targetToken, reason });
      return true;
    }

    if (command.name === 'ban') {
      const targetToken = parts[0];
      const reason = parts.slice(1).join(' ').trim();
      openModerationDialog('ban', { targetToken, reason });
      return true;
    }

    if (command.name === 'timeout') {
      const targetToken = parts[0];
      const maybeMinutes = Number(parts[1]);
      const hasMinutes = Number.isFinite(maybeMinutes);
      const minutes = hasMinutes ? Math.max(1, Math.min(10080, Math.floor(maybeMinutes))) : 5;
      const reason = hasMinutes ? parts.slice(2).join(' ').trim() : parts.slice(1).join(' ').trim();
      openModerationDialog('timeout', { targetToken, durationMinutes: minutes, reason });
      return true;
    }

    if (command.name === 'untimeout') {
      const targetToken = parts[0];
      const reason = parts.slice(1).join(' ').trim();
      openModerationDialog('untimeout', { targetToken, reason });
      return true;
    }

    if (command.name === 'unban') {
      const targetToken = parts[0];
      const reason = parts.slice(1).join(' ').trim();
      openModerationDialog('unban', { targetToken, reason });
      return true;
    }

    postCommandFeedback(`Comando no implementado: /${command.name}`, 'error');
    return true;
  };

  const handleSendMessage = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!activeChannelId || !canSend || !canSendMessages || voiceBusy) return;

    if (pendingAttachments.length === 0) {
      const maybeCommand = inputValue.trim();
      if (maybeCommand.startsWith('/')) {
        const handled = handleSlashCommand(maybeCommand);
        if (handled) {
          setInputValue('');
          setPendingAttachments([]);
          setReplyingTo(null);
          closePickers();
          closeMentions();
          emitTyping(false);
          return;
        }
      }
    }

    if (pendingAttachments.length > 0) {
      const error = validateAttachmentBatch(pendingAttachments, isDmChannel);
      if (error) {
        pushComposerNotice(error, 'error');
        return;
      }
      if (
        !isDmChannel &&
        isBackendEnabled &&
        backendToken &&
        pendingAttachments.some((attachment) => isAttachmentDataUrl(attachment))
      ) {
        pushComposerNotice(
          'Hay adjuntos locales sin subir. Reintenta la subida para que los demas puedan verlos.',
          'error'
        );
        return;
      }
    }

    const newMessage: Message = {
      id: uuidv4(),
      channelId: activeChannelId,
      authorId: currentUser.id,
      content: inputValue.trim(),
      timestamp: new Date().toISOString(),
      replyToId: replyingTo?.id,
      attachments: pendingAttachments.length > 0 ? pendingAttachments : undefined,
    };

    addMessage(activeChannelId, newMessage);
    eventBus.emit('MESSAGE_CREATED', { channelId: activeChannelId, message: newMessage });
    announce('Mensaje enviado.', {
      priority: 'polite',
      dedupeKey: `message-sent-${activeChannelId}`,
      minIntervalMs: 450,
    });

    setInputValue('');
    setPendingAttachments([]);
    setReplyingTo(null);
    closePickers();
    closeMentions();
    emitTyping(false);
    triggerSendFx();
    setComposerNotice(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (mentionOpen && mentionOptions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((prev) => (prev + 1) % mentionOptions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((prev) => (prev - 1 + mentionOptions.length) % mentionOptions.length);
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        applyMention(mentionOptions[mentionIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMentions();
        return;
      }
    }
    if (e.key === 'Escape' && replyingTo) {
      e.preventDefault();
      setReplyingTo(null);
      return;
    }
    if (e.key === 'Enter' && (!e.shiftKey || e.ctrlKey || e.metaKey)) handleSendMessage();
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const next = raw.length > MAX_MESSAGE_LENGTH ? raw.slice(0, MAX_MESSAGE_LENGTH) : raw;
    const cursor = Math.min(e.target.selectionStart ?? next.length, next.length);
    setInputValue(next);
    if (raw.length > MAX_MESSAGE_LENGTH) {
      pushComposerNotice(`Limite de ${MAX_MESSAGE_LENGTH} caracteres alcanzado.`, 'error');
    }
    const mention = parseMentionAtCursor(next, cursor);
    if (mention) {
      setMentionOpen(true);
      setMentionKind(mention.kind);
      setMentionQuery(mention.query);
      setMentionRange(mention.range);
      setMentionIndex(0);
    } else if (mentionOpen) {
      closeMentions();
    }
    emitTyping(next.length > 0 || pendingAttachments.length > 0);
  };

  const prepareAttachmentForChat = async (
    file: File,
    targetIsDm: boolean
  ): Promise<{ attachment: Attachment | null; warning?: string }> => {
    if (isBackendEnabled && backendToken) {
      try {
        const uploaded = await uploadFileToBackend({
          file,
          token: backendToken,
          purpose: targetIsDm ? 'dm-attachment' : 'channel-attachment',
        });
        const remoteAttachment: Attachment = {
          id: uuidv4(),
          url: uploaded.url,
          filename: uploaded.filename || file.name,
          contentType: uploaded.contentType || file.type || inferMimeTypeFromFilename(file.name),
          size: uploaded.size || file.size,
        };
        const warning = validateAttachmentForTarget(remoteAttachment, targetIsDm);
        if (warning) return { attachment: null, warning };
        return { attachment: remoteAttachment };
      } catch {
        return {
          attachment: null,
          warning:
            'No se pudo subir el archivo al backend. No se envio fallback local para evitar que solo tu lo veas.',
        };
      }
    }

    if (isBackendEnabled && !backendToken) {
      return {
        attachment: null,
        warning: 'Sin sesion backend activa. Inicia sesion de nuevo antes de adjuntar archivos.',
      };
    }

    if (isBackendEnabled) {
      return {
        attachment: null,
        warning: 'El backend de archivos no esta disponible. Reintenta en unos segundos.',
      };
    }

    const mime = (file.type || '').toLowerCase();
    const isVideo = mime.startsWith('video/');
    const isImage = mime.startsWith('image/');
    if (isImage && !isVideo) {
      const optimized = await optimizeImageAttachment(file);
      const warning = validateAttachmentForTarget(optimized, targetIsDm);
      if (warning) return { attachment: null, warning };
      return { attachment: optimized };
    }

    if (!isVideo && file.size > MAX_LOCAL_FALLBACK_ATTACHMENT_BYTES) {
      return {
        attachment: null,
        warning: `El archivo "${file.name}" es demasiado pesado para fallback local (${formatBytes(
          MAX_LOCAL_FALLBACK_ATTACHMENT_BYTES
        )} max).`,
      };
    }

    const fallback = await fileToAttachment(file);
    const warning = validateAttachmentForTarget(fallback, targetIsDm);
    if (warning) return { attachment: null, warning };
    return { attachment: fallback };
  };

  const processSelectedFiles = async (incoming: File[]) => {
    if (!canAttachFiles || !canSendMessages || voiceBusy) return;
    if (!incoming || incoming.length === 0) return;
    const selected = incoming.slice(0, 6);
    const accepted: Attachment[] = [];
    const warnings: string[] = [];
    setAttachmentPipeline({ active: true, stage: 'Preparando adjuntos...', done: 0, total: selected.length });

    for (let index = 0; index < selected.length; index += 1) {
      const file = selected[index];
      const mime = (file.type || '').toLowerCase();
      const stage = mime.startsWith('video/')
        ? `Procesando video ${index + 1}/${selected.length}...`
        : mime.startsWith('audio/')
          ? `Subiendo audio ${index + 1}/${selected.length}...`
          : `Optimizando ${index + 1}/${selected.length}...`;
      setAttachmentPipeline({ active: true, stage, done: index, total: selected.length });
      const result = await prepareAttachmentForChat(file, isDmChannel);
      if (result.attachment) accepted.push(result.attachment);
      if (result.warning) warnings.push(result.warning);
      setAttachmentPipeline({ active: true, stage, done: index + 1, total: selected.length });
    }

    setAttachmentPipeline({ active: false, stage: '', done: 0, total: 0 });

    if (accepted.length > 0) {
      const willTrim = pendingAttachments.length + accepted.length > 8;
      const merged = [...pendingAttachments, ...accepted].slice(0, 8);
      const mergedTransportBytes = estimateMessageTransportBytes('', merged);
      setPendingAttachments((prev) => {
        const merged = [...prev, ...accepted];
        return merged.slice(0, 8);
      });
      if (willTrim) pushComposerNotice('Limite maximo de 8 adjuntos por mensaje.', 'info');
      emitTyping(true);
      if (mergedTransportBytes > MAX_CHANNEL_SOCKET_PAYLOAD_BYTES * 0.92 && !isDmChannel) {
        pushComposerNotice(
          `Adjuntos casi al limite de transporte realtime (${formatBytes(mergedTransportBytes)}).`,
          'info'
        );
      } else {
        pushComposerNotice(
          `${accepted.length} adjunto${accepted.length > 1 ? 's' : ''} listo${accepted.length > 1 ? 's' : ''} (${formatBytes(
            accepted.reduce((sum, item) => sum + getAttachmentPayloadBytes(item), 0)
          )}).`,
          'ok'
        );
      }
    }

    if (warnings.length > 0) {
      const first = warnings[0];
      const suffix = warnings.length > 1 ? ` (+${warnings.length - 1} mas)` : '';
      pushComposerNotice(`${first}${suffix}`, 'error');
    }
  };

  const clearVoiceTicker = () => {
    if (voiceTickRef.current !== null) {
      window.clearInterval(voiceTickRef.current);
      voiceTickRef.current = null;
    }
  };

  const releaseVoiceStream = () => {
    if (voiceStreamRef.current) {
      for (const track of voiceStreamRef.current.getTracks()) {
        try {
          track.stop();
        } catch { }
      }
    }
    voiceStreamRef.current = null;
  };

  const stopVoiceRecording = (discard = false) => {
    voiceDiscardOnStopRef.current = discard;
    const recorder = voiceRecorderRef.current;
    if (!recorder) {
      clearVoiceTicker();
      releaseVoiceStream();
      setVoiceClipState({ mode: 'idle', durationMs: 0 });
      return;
    }
    if (recorder.state === 'inactive') {
      clearVoiceTicker();
      releaseVoiceStream();
      setVoiceClipState({ mode: 'idle', durationMs: 0 });
      return;
    }
    try {
      recorder.stop();
    } catch {
      clearVoiceTicker();
      releaseVoiceStream();
      setVoiceClipState({ mode: 'idle', durationMs: 0 });
    }
  };

  const startVoiceRecording = async () => {
    if (!canSendMessages || !canAttachFiles || voiceClipState.mode !== 'idle' || attachmentPipeline.active) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : '';
      const prefersAppleSafeAudio = /iphone|ipad|ipod/.test(userAgent);
      const preferredMimeTypes = prefersAppleSafeAudio
        ? ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg']
        : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/ogg'];
      const preferredMime = preferredMimeTypes.find((mime) => {
        try {
          return typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime);
        } catch {
          return false;
        }
      });

      const recorder = preferredMime ? new MediaRecorder(stream, { mimeType: preferredMime }) : new MediaRecorder(stream);
      voiceRecorderRef.current = recorder;
      voiceStreamRef.current = stream;
      voiceChunksRef.current = [];
      voiceDiscardOnStopRef.current = false;
      voiceStartedAtRef.current = Date.now();
      setVoiceClipState({ mode: 'recording', durationMs: 0 });
      pushComposerNotice('Grabando mensaje de voz...', 'info');

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          voiceChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        clearVoiceTicker();
        releaseVoiceStream();
        voiceRecorderRef.current = null;
        voiceChunksRef.current = [];
        setVoiceClipState({ mode: 'idle', durationMs: 0 });
        pushComposerNotice('No se pudo grabar audio. Revisa microfono/permisos.', 'error');
      };

      recorder.onstop = async () => {
        const shouldDiscard = voiceDiscardOnStopRef.current;
        voiceDiscardOnStopRef.current = false;
        const chunks = [...voiceChunksRef.current];
        voiceChunksRef.current = [];
        clearVoiceTicker();
        releaseVoiceStream();
        voiceRecorderRef.current = null;

        if (shouldDiscard) {
          setVoiceClipState({ mode: 'idle', durationMs: 0 });
          return;
        }

        setVoiceClipState((prev) => ({ mode: 'processing', durationMs: prev.durationMs }));
        const mime = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type: mime });
        if (blob.size <= 0) {
          setVoiceClipState({ mode: 'idle', durationMs: 0 });
          pushComposerNotice('No se detecto audio en la grabacion.', 'error');
          return;
        }
        const extension = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
        const file = new File([blob], `voice-${Date.now()}.${extension}`, { type: mime });
        await processSelectedFiles([file]);
        setVoiceClipState({ mode: 'idle', durationMs: 0 });
        pushComposerNotice('Mensaje de voz listo para enviar.', 'ok');
      };

      recorder.start(300);
      clearVoiceTicker();
      voiceTickRef.current = window.setInterval(() => {
        const elapsed = Date.now() - voiceStartedAtRef.current;
        if (elapsed >= MAX_VOICE_CLIP_DURATION_MS) {
          stopVoiceRecording(false);
          return;
        }
        setVoiceClipState((prev) => (prev.mode === 'recording' ? { ...prev, durationMs: elapsed } : prev));
      }, 200);
    } catch {
      setVoiceClipState({ mode: 'idle', durationMs: 0 });
      pushComposerNotice('No hay acceso al microfono.', 'error');
    }
  };

  const onPickFiles = async (files: FileList | null) => {
    if (voiceBusy) return;
    if (!files || files.length === 0) return;
    await processSelectedFiles(Array.from(files));
  };

  const handleComposerDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (!canAttachFiles || !canSendMessages || voiceBusy) return;
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setDragOverlayActive(true);
  };

  const handleComposerDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!canAttachFiles || !canSendMessages || voiceBusy) return;
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!dragOverlayActive) setDragOverlayActive(true);
  };

  const handleComposerDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!canAttachFiles || !canSendMessages || voiceBusy) return;
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragOverlayActive(false);
  };

  const handleComposerDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!canAttachFiles || !canSendMessages || voiceBusy) return;
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    dragDepthRef.current = 0;
    setDragOverlayActive(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length > 0) void processSelectedFiles(files);
  };

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (!canAttachFiles || !canSendMessages || voiceBusy) return;
      if (document.activeElement !== inputRef.current) return;
      const files = Array.from(event.clipboardData?.files || []);
      if (files.length === 0) return;
      event.preventDefault();
      void processSelectedFiles(files);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [canAttachFiles, canSendMessages, processSelectedFiles, voiceBusy]);

  useEffect(() => {
    return () => {
      voiceDiscardOnStopRef.current = true;
      stopVoiceRecording(true);
      clearVoiceTicker();
      releaseVoiceStream();
    };
  }, []);

  useEffect(() => {
    if (voiceClipState.mode !== 'recording') return;
    voiceDiscardOnStopRef.current = true;
    stopVoiceRecording(true);
    setVoiceClipState({ mode: 'idle', durationMs: 0 });
  }, [activeChannelId]);

  const removePendingAttachment = (id: string) => {
    setPendingAttachments(prev => {
      const next = prev.filter(a => a.id !== id);
      if (next.length === 0 && inputValue.trim().length === 0) emitTyping(false);
      return next;
    });
  };

  const appendEmoji = (emoji: string) => {
    setInputValue(prev => `${prev}${emoji}`);
    closePickers();
    emitTyping(true);
  };

  const appendCustomEmoji = (emoji: CustomServerEmoji) => {
    const token = `${emoji.animated ? '<a:' : '<:'}${emoji.name}:${emoji.id}>`;
    setInputValue(prev => `${prev}${token}`);
    closePickers();
    emitTyping(true);
  };

  const mentionUserFromContext = (userId: string) => {
    const token = `<@${userId}>`;
    setInputValue((prev) => {
      const spacer = prev.length === 0 || prev.endsWith(' ') ? '' : ' ';
      return `${prev}${spacer}${token} `;
    });
    closePickers();
    closeMentions();
    emitTyping(true);
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      const caret = input.value.length;
      input.setSelectionRange(caret, caret);
    });
  };

  const addGif = (gif: { url: string; filename: string }) => {
    const item = attachmentFromRemote({ url: gif.url, filename: gif.filename, contentType: 'image/gif' });
    setPendingAttachments((prev) => [...prev, item].slice(0, 8));
    closePickers();
    emitTyping(true);
    pushComposerNotice('GIF agregado al mensaje.', 'ok');
  };

  const addSticker = (sticker: { url: string; filename: string; contentType?: string }) => {
    const item = attachmentFromRemote({
      url: sticker.url,
      filename: sticker.filename,
      contentType: sticker.contentType || 'image/gif',
    });
    setPendingAttachments((prev) => [...prev, item].slice(0, 8));
    closePickers();
    emitTyping(true);
    pushComposerNotice('Sticker agregado al mensaje.', 'ok');
  };

  const pendingPreview = useMemo(
    () =>
      pendingAttachments.map((a) => {
        const isImage = a.contentType.startsWith('image/');
        const isVideo = a.contentType.startsWith('video/');
        return { ...a, isImage, isVideo, payloadBytes: getAttachmentPayloadBytes(a) };
      }),
    [pendingAttachments]
  );

  const mentionInbox = useMemo(() => {
    const channelIds = new Set(mentionableChannels.map((c) => c.id));
    const out: Array<{ message: Message; channelName: string; authorName: string }> = [];
    for (const [channelId, list] of Object.entries(messages)) {
      if (!channelIds.has(channelId)) continue;
      const channelName = channelById.get(channelId)?.name || channelId;
      for (const m of list) {
        if (m.authorId === currentUser.id) continue;
        const content = m.content || '';
        const mentionsMe = content.includes(`<@${currentUser.id}>`) || usernameMentionPattern.test(content);
        if (!mentionsMe) continue;
        const authorName = users.find((u) => u.id === m.authorId)?.username || m.authorId;
        out.push({ message: m, channelName, authorName });
      }
    }
    return out.sort((a, b) => new Date(b.message.timestamp).getTime() - new Date(a.message.timestamp).getTime()).slice(0, 120);
  }, [messages, mentionableChannels, channelById, currentUser.id, usernameMentionPattern, users]);

  const unseenMentionsCount = useMemo(
    () => mentionInbox.filter((entry) => !seenMentionIds.includes(entry.message.id)).length,
    [mentionInbox, seenMentionIds]
  );

  const threadUnreadByParentMessage = useMemo(() => {
    if (!activeChannelId) return {} as Record<string, number>;
    const out: Record<string, number> = {};
    for (const thread of Object.values(threads)) {
      if (thread.channelId !== activeChannelId) continue;
      const unread = (threadMessages[thread.id] || []).filter(
        (m) => m.authorId !== currentUser.id && !seenThreadMessageIds.includes(m.id)
      ).length;
      if (unread > 0) out[thread.parentMessageId] = unread;
    }
    return out;
  }, [activeChannelId, threads, threadMessages, currentUser.id, seenThreadMessageIds]);

  const threadInbox = useMemo(() => {
    const channelIds = new Set(mentionableChannels.map((c) => c.id));
    const out: Array<{
      threadId: string;
      parentMessageId: string;
      channelId: string;
      channelName: string;
      authorName: string;
      preview: string;
      unreadCount: number;
      lastTimestamp: string;
    }> = [];
    for (const thread of Object.values(threads)) {
      if (!channelIds.has(thread.channelId)) continue;
      const list = threadMessages[thread.id] || [];
      const unreadList = list.filter((m) => m.authorId !== currentUser.id && !seenThreadMessageIds.includes(m.id));
      if (unreadList.length === 0) continue;
      const last = unreadList[unreadList.length - 1];
      if (!last) continue;
      const channelName = channelById.get(thread.channelId)?.name || thread.channelId;
      const authorName = users.find((u) => u.id === last.authorId)?.username || last.authorId;
      out.push({
        threadId: thread.id,
        parentMessageId: thread.parentMessageId,
        channelId: thread.channelId,
        channelName,
        authorName,
        preview: last.content || '[Adjunto]',
        unreadCount: unreadList.length,
        lastTimestamp: last.timestamp,
      });
    }
    return out.sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime()).slice(0, 120);
  }, [threads, threadMessages, mentionableChannels, channelById, currentUser.id, seenThreadMessageIds, users]);

  const unseenThreadCount = useMemo(
    () => threadInbox.reduce((sum, item) => sum + item.unreadCount, 0),
    [threadInbox]
  );

  const inboxTotalCount = unseenMentionsCount + unseenThreadCount;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey && event.key === '1') {
        event.preventDefault();
        setSelectedUserId(null);
        setSearchPanelOpen(false);
        setInboxOpen((v) => !v);
        return;
      }
      if (event.altKey && event.key === '2') {
        event.preventDefault();
        toggleRightSidebarPanel('details');
        return;
      }
      if (event.altKey && event.key === '3') {
        event.preventDefault();
        toggleRightSidebarPanel('members');
        return;
      }
      if (event.altKey && event.key === '4') {
        event.preventDefault();
        setSelectedUserId(null);
        setInboxOpen(false);
        setSearchPanelOpen(false);
        setRightSidebarOpen(!rightSidebarOpen);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [rightSidebarOpen, setRightSidebarOpen, setSelectedUserId, toggleRightSidebarPanel]);

  useEffect(() => {
    if (!selectedUserId) return;
    if (rightSidebarOpen) return;
    setRightSidebarOpen(true);
  }, [selectedUserId, rightSidebarOpen, setRightSidebarOpen]);

  useEffect(() => {
    if (!inboxOpen) return;
    const ids = mentionInbox.map((x) => x.message.id);
    if (ids.length === 0) return;
    setSeenMentionIds((prev) => Array.from(new Set([...prev, ...ids])));
  }, [inboxOpen, mentionInbox]);

  useEffect(() => {
    const unsubscribe = eventBus.subscribe((payload) => {
      if (payload.type !== 'MESSAGE_CREATED') return;
      const incoming = payload.data?.message as Message | undefined;
      if (!incoming) return;
      if (incoming.authorId === currentUser.id) return;
      if (!channelById.has(incoming.channelId)) return;
      if (inboxOpen) return;

      const content = incoming.content || '';
      const mentioned = content.includes(`<@${currentUser.id}>`) || usernameMentionPattern.test(content);
      if (!mentioned) return;
      if (!notificationSettings.enableMentions) return;
      if (document.hasFocus() && incoming.channelId === activeChannelId) return;

      const author = users.find((u) => u.id === incoming.authorId)?.username || incoming.authorId;
      const channelName = channelById.get(incoming.channelId)?.name || incoming.channelId;
      const body = `${author}: ${content || '[Adjunto]'}`;
      pushToast({
        kind: 'mention',
        title: `Mencion en #${channelName}`,
        body,
        channelId: incoming.channelId,
        messageId: incoming.id,
      });
      playNotifySound('mention');
      pushDesktop('mention', `Mencion en #${channelName}`, body);
    });
    return () => unsubscribe();
  }, [
    activeChannelId,
    channelById,
    currentUser.id,
    inboxOpen,
    notificationSettings.enableMentions,
    notificationSettings.enableSoundMentions,
    notificationSettings.desktopMentions,
    usernameMentionPattern,
    users,
  ]);

  useEffect(() => {
    if (!seededThreadReplyIdsRef.current) {
      const seed = new Set<string>();
      for (const list of Object.values(threadMessages)) {
        for (const m of list) seed.add(m.id);
      }
      knownThreadReplyIdsRef.current = seed;
      seededThreadReplyIdsRef.current = true;
      return;
    }

    const known = knownThreadReplyIdsRef.current;
    for (const [threadId, list] of Object.entries(threadMessages)) {
      const threadMeta = threads[threadId];
      if (!threadMeta || !channelById.has(threadMeta.channelId)) continue;
      for (const msg of list) {
        if (known.has(msg.id)) continue;
        known.add(msg.id);
        if (msg.authorId === currentUser.id) continue;
        if (seenThreadMessageIds.includes(msg.id)) continue;
        if (activeThreadId === threadId && document.hasFocus()) continue;
        if (inboxOpen) continue;
        if (!notificationSettings.enableThreadReplies) continue;
        const author = users.find((u) => u.id === msg.authorId)?.username || msg.authorId;
        const channelName = channelById.get(threadMeta.channelId)?.name || threadMeta.channelId;
        const body = `${author}: ${msg.content || '[Adjunto]'}`;
        pushToast({
          kind: 'thread',
          title: `Nueva respuesta en hilo #${channelName}`,
          body,
          channelId: threadMeta.channelId,
          messageId: threadMeta.parentMessageId,
          threadId,
        });
        playNotifySound('thread');
        pushDesktop('thread', `Nueva respuesta en hilo #${channelName}`, body);
      }
    }
  }, [
    threadMessages,
    threads,
    channelById,
    currentUser.id,
    seenThreadMessageIds,
    activeThreadId,
    users,
    inboxOpen,
    notificationSettings.enableThreadReplies,
    notificationSettings.enableSoundThreadReplies,
    notificationSettings.desktopThreadReplies,
  ]);

  const searchResults = useMemo(() => {
    const q = deferredChannelSearchQuery.trim().toLowerCase();
    return [...channelMessages]
      .reverse()
      .filter((m) => (searchPinnedOnly ? !!m.isPinned : true))
      .filter((m) => (searchWithFilesOnly ? (m.attachments?.length || 0) > 0 : true))
      .filter((m) => (searchAuthorId !== 'all' ? m.authorId === searchAuthorId : true))
      .filter((m) => {
        if (!q) return true;
        const author = usersById.get(m.authorId);
        const haystack = `${m.content || ''} ${(author?.username || '')} ${(author?.displayName || '')}`.toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, 80);
  }, [channelMessages, deferredChannelSearchQuery, searchPinnedOnly, searchWithFilesOnly, searchAuthorId, usersById]);

  useEffect(() => {
    if (!searchPanelOpen) {
      setSearchResultIndex(0);
      return;
    }
    setSearchResultIndex((prev) => {
      if (searchResults.length === 0) return 0;
      return Math.min(prev, searchResults.length - 1);
    });
  }, [searchPanelOpen, searchResults.length]);

  useEffect(() => {
    if (!quickSwitcherOpen) {
      setQuickSwitcherIndex(0);
      return;
    }
    setQuickSwitcherIndex((prev) => Math.min(prev, Math.max(0, quickSwitcherResults.length - 1)));
  }, [quickSwitcherOpen, quickSwitcherResults.length]);

  useEffect(() => {
    if (!quickSwitcherOpen) return;
    const id = window.setTimeout(() => {
      quickSwitcherInputRef.current?.focus();
      quickSwitcherInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(id);
  }, [quickSwitcherOpen]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(QUICK_SWITCHER_HISTORY_KEY, JSON.stringify(quickSwitcherHistory.slice(0, QUICK_SWITCHER_HISTORY_LIMIT)));
    } catch { }
  }, [quickSwitcherHistory]);

  const pushQuickSwitcherHistory = useCallback((entryId: string) => {
    if (!entryId) return;
    setQuickSwitcherHistory((prev) => {
      const next = [entryId, ...prev.filter((id) => id !== entryId)];
      return next.slice(0, QUICK_SWITCHER_HISTORY_LIMIT);
    });
  }, []);

  const openQuickSwitcher = useCallback(() => {
    setQuickSwitcherQuery('');
    setQuickSwitcherIndex(0);
    setQuickSwitcherOpen(true);
  }, []);

  const applyQuickSwitcherSelection = useCallback((entry: QuickSwitchEntry) => {
    if (!entry) return;
    if (entry.kind === 'channel') {
      if (entry.serverId) setActiveServer(entry.serverId);
      setActiveChannel(entry.channelId);
    } else {
      setActiveServer(null);
      setActiveChannel(entry.channelId);
    }
    setSelectedUserId(null);
    setInboxOpen(false);
    setSearchPanelOpen(false);
    setQuickSwitcherOpen(false);
    setQuickSwitcherQuery('');
    setQuickSwitcherIndex(0);
    pushQuickSwitcherHistory(entry.id);
  }, [pushQuickSwitcherHistory, setActiveChannel, setActiveServer, setSelectedUserId]);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editable =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.getAttribute('contenteditable') === 'true');
      if (editable && !(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === 'k') {
        event.preventDefault();
        openQuickSwitcher();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === 'f') {
        event.preventDefault();
        setSearchPanelOpen(true);
        channelSearchInputRef.current?.focus();
        channelSearchInputRef.current?.select();
        return;
      }
      if (quickSwitcherOpen) {
        if (event.key === 'ArrowDown' && quickSwitcherResults.length > 0) {
          event.preventDefault();
          setQuickSwitcherIndex((prev) => (prev + 1) % quickSwitcherResults.length);
          return;
        }
        if (event.key === 'ArrowUp' && quickSwitcherResults.length > 0) {
          event.preventDefault();
          setQuickSwitcherIndex((prev) => (prev - 1 + quickSwitcherResults.length) % quickSwitcherResults.length);
          return;
        }
        if (event.key === 'Enter' && quickSwitcherResults.length > 0) {
          event.preventDefault();
          const selected = quickSwitcherResults[quickSwitcherIndex] || quickSwitcherResults[0];
          if (selected) applyQuickSwitcherSelection(selected);
          return;
        }
        if (event.key === 'PageDown' && quickSwitcherResults.length > 0) {
          event.preventDefault();
          setQuickSwitcherIndex((prev) => Math.min(prev + 8, quickSwitcherResults.length - 1));
          return;
        }
        if (event.key === 'PageUp' && quickSwitcherResults.length > 0) {
          event.preventDefault();
          setQuickSwitcherIndex((prev) => Math.max(prev - 8, 0));
          return;
        }
      }
      if (event.key === 'Escape' && quickSwitcherOpen) {
        event.preventDefault();
        setQuickSwitcherOpen(false);
        setQuickSwitcherQuery('');
        return;
      }
      if (event.key === 'Escape' && searchPanelOpen) {
        setSearchPanelOpen(false);
      }
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, [searchPanelOpen, quickSwitcherOpen, quickSwitcherResults, quickSwitcherIndex, openQuickSwitcher, applyQuickSwitcherSelection]);

  const handleSearchInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!searchPanelOpen) return;
    if (searchResults.length === 0) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setSearchPanelOpen(false);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSearchResultIndex((prev) => (prev + 1) % searchResults.length);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSearchResultIndex((prev) => (prev - 1 + searchResults.length) % searchResults.length);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const selected = searchResults[searchResultIndex];
      if (selected) jumpToMessage(selected.id);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setSearchPanelOpen(false);
    }
  };

  const jumpToMessage = (messageId: string) => {
    const el = document.getElementById(`message-${messageId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightMessageId(messageId);
    setTimeout(() => setHighlightMessageId(null), 1800);
    setSearchPanelOpen(false);
  };

  const jumpToLatest = () => {
    setNewMessagesWhileScrolled(0);
    scrollToBottom('smooth');
  };

  const openMessageTarget = (channelId: string, messageId: string) => {
    if (channelId !== activeChannelId) {
      setActiveChannel(channelId);
      setPendingJumpMessageId(messageId);
      return;
    }
    jumpToMessage(messageId);
  };

  const openThreadForMessage = (message: Message) => {
    if (!activeChannelId) return;
    if (message.threadId && threads[message.threadId]) {
      setActiveThread(message.threadId);
      return;
    }
    const threadId = createThread({
      channelId: activeChannelId,
      parentMessageId: message.id,
      name: `Thread: ${(message.content || 'mensaje').slice(0, 24)}`,
    });
    setActiveThread(threadId);
  };

  const sendThreadReply = () => {
    if (!activeThreadId || !threadInput.trim()) return;
    const msg: Message = {
      id: uuidv4(),
      channelId: activeThread?.channelId || activeChannelId || '',
      authorId: currentUser.id,
      content: threadInput.trim(),
      timestamp: new Date().toISOString(),
      threadId: activeThreadId,
    };
    addThreadMessage(activeThreadId, msg);
    setThreadInput('');
  };

  useEffect(() => {
    if (!pendingJumpMessageId) return;
    const el = document.getElementById(`message-${pendingJumpMessageId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightMessageId(pendingJumpMessageId);
    setTimeout(() => setHighlightMessageId(null), 1800);
    setPendingJumpMessageId(null);
  }, [pendingJumpMessageId, activeChannelId, channelMessages]);

  const openMentionFromInbox = (entry: { message: Message }) => {
    setInboxOpen(false);
    setSeenMentionIds((prev) => Array.from(new Set([...prev, entry.message.id])));
    openMessageTarget(entry.message.channelId, entry.message.id);
  };

  const openThreadFromInbox = (entry: { threadId: string; parentMessageId: string; channelId: string }) => {
    setInboxOpen(false);
    const ids = (threadMessages[entry.threadId] || [])
      .filter((m) => m.authorId !== currentUser.id)
      .map((m) => m.id);
    if (ids.length > 0) {
      setSeenThreadMessageIds((prev) => Array.from(new Set([...prev, ...ids])));
    }
    if (entry.channelId !== activeChannelId) {
      setActiveChannel(entry.channelId);
      setPendingJumpMessageId(entry.parentMessageId);
      setActiveThread(entry.threadId);
      return;
    }
    setActiveThread(entry.threadId);
    jumpToMessage(entry.parentMessageId);
  };

  const openToast = (toast: LiveToast) => {
    setLiveToasts((prev) => prev.filter((t) => t.id !== toast.id));
    if (toast.kind === 'mention') {
      setSeenMentionIds((prev) => Array.from(new Set([...prev, toast.messageId])));
      openMessageTarget(toast.channelId, toast.messageId);
      return;
    }
    if (!toast.threadId) return;
    openThreadFromInbox({
      threadId: toast.threadId,
      parentMessageId: toast.messageId,
      channelId: toast.channelId,
    });
  };

  useEffect(() => {
    if (activeServerId !== null) return;
    if (activeChannel) return;
    if (friendsViewTab === 'pending') return;

    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        friendsSearchInputRef.current?.focus();
        friendsSearchInputRef.current?.select();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        friendRequestInputRef.current?.focus();
        friendRequestInputRef.current?.select();
        return;
      }
      if (event.key === 'ArrowDown' && visibleCommunicationFriends.length > 0) {
        event.preventDefault();
        setFriendsSelectionIndex((prev) => (prev + 1) % visibleCommunicationFriends.length);
        return;
      }
      if (event.key === 'ArrowUp' && visibleCommunicationFriends.length > 0) {
        event.preventDefault();
        setFriendsSelectionIndex((prev) => (prev - 1 + visibleCommunicationFriends.length) % visibleCommunicationFriends.length);
        return;
      }
      if (event.key === 'Enter' && visibleCommunicationFriends.length > 0) {
        const next = visibleCommunicationFriends[friendsSelectionIndex] || visibleCommunicationFriends[0];
        if (!next) return;
        event.preventDefault();
        setActiveServer(null);
        setActiveChannel(next.dmId);
        return;
      }
      if (event.key === 'Escape' && document.activeElement === friendsSearchInputRef.current) {
        event.preventDefault();
        setFriendsViewQuery('');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeChannel, activeServerId, friendsSelectionIndex, friendsViewTab, setActiveChannel, setActiveServer, visibleCommunicationFriends]);

  useEffect(() => {
    if (friendsViewTab === 'pending') {
      setFriendsSelectionIndex(0);
      return;
    }
    setFriendsSelectionIndex((prev) => {
      if (visibleCommunicationFriends.length === 0) return 0;
      return Math.min(prev, visibleCommunicationFriends.length - 1);
    });
  }, [friendsViewTab, visibleCommunicationFriends.length]);

  useEffect(() => {
    if (!friendRequestNotice) return;
    const id = window.setTimeout(() => setFriendRequestNotice(null), 2200);
    return () => window.clearTimeout(id);
  }, [friendRequestNotice]);

  const quickSwitcherPortal =
    typeof document !== 'undefined' && quickSwitcherOpen
      ? createPortal(
        <div className="fixed inset-0 z-[360]">
          <button
            type="button"
            aria-label="Cerrar quick switcher"
            onClick={() => {
              setQuickSwitcherOpen(false);
              setQuickSwitcherQuery('');
            }}
            className="absolute inset-0 bg-black/68 backdrop-blur-sm"
          />
          <div className="absolute inset-0 flex items-start justify-center pt-[12vh] px-4">
            <div className="w-full max-w-2xl rounded-3xl border border-white/12 bg-[#0A0A0B]/92 glass-ruby-surface shadow-2xl backdrop-blur-xl overflow-hidden mac-scale-enter">
              <div className="px-5 py-4 border-b border-white/[0.08]">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="inline-flex items-center gap-2 text-white font-black text-base tracking-tight">
                    <Command size={16} className="text-neon-blue" />
                    Quick Switcher
                  </div>
                  <div className="inline-flex items-center gap-2">
                    <div className="text-[9px] font-black uppercase tracking-[0.16em] text-[#7f8790]">
                      Ctrl/Cmd + K
                    </div>
                    {quickSwitcherHistory.length > 0 ? (
                      <button
                        onClick={() => setQuickSwitcherHistory([])}
                        className="h-6 px-2 rounded-md border border-white/[0.12] bg-white/[0.03] text-[9px] font-black uppercase tracking-[0.14em] text-[#9aa1aa] hover:text-white hover:bg-white/[0.08] transition-all"
                        title="Limpiar recientes"
                      >
                        Limpiar
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280]" />
                  <input
                    ref={quickSwitcherInputRef}
                    value={quickSwitcherQuery}
                    onChange={(event) => setQuickSwitcherQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        setQuickSwitcherOpen(false);
                        setQuickSwitcherQuery('');
                      }
                    }}
                    placeholder="Buscar canales y mensajes directos..."
                    className="w-full h-11 rounded-xl bg-white/[0.03] border border-white/[0.12] pl-9 pr-4 text-sm text-white outline-none focus:border-neon-blue/45 transition-colors placeholder-[#6B7280]"
                  />
                </div>
              </div>
              <div className="max-h-[56vh] overflow-y-auto p-3 space-y-1.5">
                {quickSwitcherResults.length === 0 ? (
                  <div className="px-4 py-5 rounded-xl border border-white/[0.08] bg-white/[0.02] text-[#7f8790] text-xs font-bold">
                    No se encontraron resultados.
                  </div>
                ) : (
                  quickSwitcherResults.map((entry, idx) => {
                    const selected = idx === quickSwitcherIndex;
                    const recentRank = quickSwitcherHistoryRank.get(entry.id);
                    const isRecent = typeof recentRank === 'number';
                    return (
                      <button
                        key={entry.id}
                        onMouseEnter={() => setQuickSwitcherIndex(idx)}
                        onClick={() => applyQuickSwitcherSelection(entry)}
                        className={cn(
                          "w-full text-left px-4 py-3 rounded-xl border transition-all inline-flex items-center gap-3",
                          selected
                            ? "border-neon-blue/40 bg-neon-blue/10 text-white shadow-[0_0_0_1px_rgba(56,189,248,0.25)]"
                            : "border-white/[0.08] bg-white/[0.02] text-[#B5BAC1] hover:text-white hover:bg-white/[0.04]"
                        )}
                      >
                        <div
                          className={cn(
                            "w-8 h-8 rounded-lg border inline-flex items-center justify-center flex-shrink-0",
                            entry.kind === 'channel'
                              ? "border-neon-blue/35 bg-neon-blue/12 text-neon-blue"
                              : "border-neon-purple/35 bg-neon-purple/12 text-neon-purple"
                          )}
                        >
                          {entry.kind === 'channel' ? <Hash size={13} /> : <Users size={13} />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-black truncate">{entry.label}</div>
                          <div className="text-[10px] font-black uppercase tracking-[0.14em] text-[#7f8790] truncate">
                            {entry.subtitle}
                          </div>
                        </div>
                        <div className="inline-flex items-center gap-2">
                          {isRecent ? (
                            <span className="h-5 px-2 rounded-md border border-white/[0.12] bg-white/[0.04] text-[9px] font-black uppercase tracking-widest text-[#cfd4da] inline-flex items-center">
                              R{(recentRank as number) + 1}
                            </span>
                          ) : null}
                          <span
                            className={cn(
                              "h-5 px-2 rounded-md border text-[9px] font-black uppercase tracking-widest inline-flex items-center",
                              entry.kind === 'channel'
                                ? "border-neon-blue/30 bg-neon-blue/12 text-neon-blue"
                                : "border-neon-purple/30 bg-neon-purple/12 text-neon-purple"
                            )}
                          >
                            {entry.badge}
                          </span>
                          {selected ? <CornerDownLeft size={12} className="text-[#9aa1aa]" /> : null}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
              <div className="px-5 py-3 border-t border-white/[0.08] bg-white/[0.02] text-[9px] font-black uppercase tracking-[0.14em] text-[#7f8790] flex items-center justify-between">
                <span>Flechas para navegar</span>
                <span>PgUp/PgDn salta</span>
                <span>Enter para abrir</span>
                <span>Esc para cerrar</span>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )
      : null;

  if (!activeChannel) {
    if (activeServerId === null) {
      return (
        <>
          {quickSwitcherPortal}
          <div className="flex-1 flex bg-[#0A0A0B] glass-ruby-shell h-full overflow-hidden">
            <section className="flex-1 min-w-0 flex flex-col">
              <div className="h-16 px-8 border-b border-white/[0.05] flex items-center gap-4 bg-white/[0.01]">
                <div className="w-10 h-10 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center text-neon-blue">
                  <Users size={18} />
                </div>
                <div className="flex-1 flex items-center gap-3">
                  <h2 className="text-white font-black tracking-tight text-xl">{t(language, 'friends')}</h2>
                  <button
                    onClick={() => setFriendsViewTab('online')}
                    aria-pressed={friendsViewTab === 'online'}
                    className={cn(
                      "h-8 px-3 rounded-xl border text-[10px] font-black uppercase tracking-[0.16em] transition-all",
                      friendsViewTab === 'online'
                        ? "bg-neon-blue/15 border-neon-blue/35 text-neon-blue"
                        : "bg-white/[0.02] border-white/[0.08] text-[#9aa1aa] hover:text-white"
                    )}
                  >
                    En linea
                  </button>
                  <button
                    onClick={() => setFriendsViewTab('all')}
                    aria-pressed={friendsViewTab === 'all'}
                    className={cn(
                      "h-8 px-3 rounded-xl border text-[10px] font-black uppercase tracking-[0.16em] transition-all",
                      friendsViewTab === 'all'
                        ? "bg-neon-blue/15 border-neon-blue/35 text-neon-blue"
                        : "bg-white/[0.02] border-white/[0.08] text-[#9aa1aa] hover:text-white"
                    )}
                  >
                    Todos
                  </button>
                  <button
                    onClick={() => setFriendsViewTab('pinned')}
                    aria-pressed={friendsViewTab === 'pinned'}
                    className={cn(
                      "h-8 px-3 rounded-xl border text-[10px] font-black uppercase tracking-[0.16em] transition-all inline-flex items-center gap-2",
                      friendsViewTab === 'pinned'
                        ? "bg-neon-purple/15 border-neon-purple/35 text-neon-purple"
                        : "bg-white/[0.02] border-white/[0.08] text-[#9aa1aa] hover:text-white"
                    )}
                  >
                    <Pin size={11} />
                    Anclados
                  </button>
                  <button
                    onClick={() => setFriendsViewTab('pending')}
                    aria-pressed={friendsViewTab === 'pending'}
                    className={cn(
                      "h-8 px-3 rounded-xl border text-[10px] font-black uppercase tracking-[0.16em] transition-all inline-flex items-center gap-2",
                      friendsViewTab === 'pending'
                        ? "bg-neon-blue/15 border-neon-blue/35 text-neon-blue"
                        : "bg-white/[0.02] border-white/[0.08] text-[#9aa1aa] hover:text-white"
                    )}
                  >
                    Pendientes
                    {pendingRequestTotal > 0 ? (
                      <span className="min-w-4 h-4 px-1 rounded-full bg-neon-pink text-black text-[9px] font-black inline-flex items-center justify-center">
                        {Math.min(pendingRequestTotal, 99)}
                      </span>
                    ) : null}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setFriendsViewSort('status')}
                    aria-pressed={friendsViewSort === 'status'}
                    className={cn(
                      "h-8 px-3 rounded-xl border text-[10px] font-black uppercase tracking-[0.16em] transition-all",
                      friendsViewSort === 'status'
                        ? "bg-white/[0.07] border-white/[0.18] text-white"
                        : "bg-white/[0.02] border-white/[0.08] text-[#8a919a] hover:text-white"
                    )}
                  >
                    Estado
                  </button>
                  <button
                    onClick={() => setFriendsViewSort('name')}
                    aria-pressed={friendsViewSort === 'name'}
                    className={cn(
                      "h-8 px-3 rounded-xl border text-[10px] font-black uppercase tracking-[0.16em] transition-all",
                      friendsViewSort === 'name'
                        ? "bg-white/[0.07] border-white/[0.18] text-white"
                        : "bg-white/[0.02] border-white/[0.08] text-[#8a919a] hover:text-white"
                    )}
                  >
                    Nombre
                  </button>
                  <button
                    onClick={() => setFriendsViewSort('recent')}
                    aria-pressed={friendsViewSort === 'recent'}
                    className={cn(
                      "h-8 px-3 rounded-xl border text-[10px] font-black uppercase tracking-[0.16em] transition-all",
                      friendsViewSort === 'recent'
                        ? "bg-white/[0.07] border-white/[0.18] text-white"
                        : "bg-white/[0.02] border-white/[0.08] text-[#8a919a] hover:text-white"
                    )}
                  >
                    Reciente
                  </button>
                </div>
                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-[#7f8790] text-right">
                  {friendsViewTab === 'pending' ? pendingRequestTotal : visibleCommunicationFriends.length} visible(s)
                </div>
              </div>

              <div className="px-8 py-4 border-b border-white/[0.04]">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <div className="px-2.5 py-1 rounded-lg border border-white/[0.1] bg-white/[0.03] text-[10px] font-black uppercase tracking-[0.15em] text-white">
                    {communicationStats.total} total
                  </div>
                  <div className="px-2.5 py-1 rounded-lg border border-white/[0.08] bg-white/[0.02] text-[10px] font-black uppercase tracking-[0.15em] text-[#9aa2ad] inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-neon-green inline-block" />
                    {communicationStats.online}
                  </div>
                  <div className="px-2.5 py-1 rounded-lg border border-white/[0.08] bg-white/[0.02] text-[10px] font-black uppercase tracking-[0.15em] text-[#9aa2ad] inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-yellow-400/70 inline-block" />
                    {communicationStats.idle} idle
                  </div>
                  <div className="px-2.5 py-1 rounded-lg border border-white/[0.08] bg-white/[0.02] text-[10px] font-black uppercase tracking-[0.15em] text-[#9aa2ad] inline-flex items-center gap-1.5">
                    <Pin size={10} />
                    {pinnedFriendTotal} pin
                  </div>
                  {pendingRequestTotal > 0 ? (
                    <button
                      onClick={() => setFriendsViewTab('pending')}
                      className="px-2.5 py-1 rounded-lg border border-neon-pink/35 bg-neon-pink/10 text-[10px] font-black uppercase tracking-[0.15em] text-neon-pink inline-flex items-center gap-1.5 hover:bg-neon-pink/20 transition-colors"
                    >
                      <UserPlus size={10} />
                      {pendingRequestTotal} pend.
                    </button>
                  ) : null}
                  {hasFriendsViewFilters ? (
                    <button
                      onClick={resetFriendsViewFilters}
                      className="px-2.5 py-1 rounded-lg border border-white/[0.16] bg-white/[0.03] text-[10px] font-black uppercase tracking-[0.15em] text-white hover:bg-white/[0.08] transition-colors"
                    >
                      Limpiar filtros
                    </button>
                  ) : null}
                  <div className="ml-auto text-[10px] font-black uppercase tracking-[0.15em] text-[#7d858f]">
                    Atajo: Ctrl/Cmd + F
                  </div>
                </div>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#5c646d]" />
                  <input
                    ref={friendsSearchInputRef}
                    value={friendsViewQuery}
                    onChange={(e) => setFriendsViewQuery(e.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape' && friendsViewQuery) {
                        event.preventDefault();
                        setFriendsViewQuery('');
                      }
                    }}
                    placeholder="Buscar amigo por nombre o tag..."
                    className="w-full h-10 rounded-xl bg-black/35 border border-white/[0.08] pl-9 pr-9 text-sm text-white outline-none focus:border-neon-blue/35 transition-colors placeholder-[#636b75]"
                  />
                  {friendsViewQuery ? (
                    <button
                      onClick={() => setFriendsViewQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-lg border border-white/[0.12] bg-white/[0.03] text-white/70 hover:text-white hover:bg-white/[0.08] transition-colors inline-flex items-center justify-center"
                    >
                      <X size={12} />
                    </button>
                  ) : null}
                </div>
                {normalizedFriendsViewQuery ? (
                  <div className="mt-2 text-[10px] font-black uppercase tracking-[0.16em] text-[#8f97a1]">
                    Resultados: {visibleCommunicationFriends.length}
                  </div>
                ) : null}
                <div className="mt-3 rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2.5">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-6 h-6 rounded-lg border border-neon-green/35 bg-neon-green/10 text-neon-green inline-flex items-center justify-center">
                      <UserPlus size={12} />
                    </div>
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-[#c6ccd3]">
                      Iniciar DM rapido
                    </div>
                    <div className="ml-auto text-[9px] font-black uppercase tracking-[0.16em] text-[#7d858f]">
                      Ctrl/Cmd + N
                    </div>
                  </div>
                  <div className="relative">
                    <input
                      ref={friendRequestInputRef}
                      value={friendRequestQuery}
                      onChange={(e) => setFriendRequestQuery(e.target.value)}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter') return;
                        const first = friendRequestCandidates[0];
                        if (!first) return;
                        event.preventDefault();
                        sendFriendRequest(first.id);
                      }}
                      placeholder="Buscar usuario para enviar solicitud..."
                      className="w-full h-9 rounded-xl bg-black/35 border border-white/[0.08] px-3 pr-9 text-xs text-white outline-none focus:border-neon-green/35 transition-colors placeholder-[#636b75]"
                    />
                    {friendRequestQuery ? (
                      <button
                        onClick={() => setFriendRequestQuery('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-lg border border-white/[0.12] bg-white/[0.03] text-white/70 hover:text-white hover:bg-white/[0.08] transition-colors inline-flex items-center justify-center"
                      >
                        <X size={12} />
                      </button>
                    ) : null}
                  </div>
                  {friendRequestNotice ? (
                    <div className="mt-2 text-[10px] font-black uppercase tracking-[0.16em] text-neon-green">
                      {friendRequestNotice}
                    </div>
                  ) : null}
                  {friendRequestQuery.trim().length > 0 ? (
                    friendRequestCandidates.length === 0 ? (
                      <div className="mt-2 text-[10px] font-black uppercase tracking-[0.16em] text-[#7f8790]">
                        Sin coincidencias
                      </div>
                    ) : (
                      <div className="mt-2 space-y-1">
                        {friendRequestCandidates.map((candidate) => {
                          const label = candidate.displayName?.trim() || candidate.username || candidate.id;
                          const status = resolvePresenceStatus(
                            candidate.id,
                            (candidate.status || 'offline') as 'online' | 'idle' | 'dnd' | 'offline'
                          );
                          return (
                            <button
                              key={`friend-request-${candidate.id}`}
                              onClick={() => sendFriendRequest(candidate.id)}
                              className="w-full rounded-lg border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] px-2.5 py-2 transition-all text-left"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="text-white text-xs font-black truncate">{highlightFriendRequestText(label)}</div>
                                  <div className="text-[9px] font-black uppercase tracking-[0.16em] text-[#89919a] truncate">
                                    @{highlightFriendRequestText(candidate.username || candidate.id)}
                                  </div>
                                </div>
                                <div className="text-[9px] font-black uppercase tracking-[0.16em] text-[#7f8790]">
                                  {statusLabelByKey[status]}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )
                  ) : null}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2 custom-scrollbar">
                {friendsViewTab === 'pending' ? (
                  pendingRequestTotal === 0 ? (
                    <div className="h-full min-h-[220px] flex items-center justify-center">
                      <div className="text-center">
                        <div className="w-16 h-16 rounded-2xl mx-auto mb-4 bg-white/[0.02] border border-white/[0.08] flex items-center justify-center text-[#4E5058]">
                          <Users size={24} />
                        </div>
                        <div className="text-white font-black text-lg tracking-tight">No hay solicitudes pendientes</div>
                        <div className="text-[#7f8790] text-xs mt-2 font-bold uppercase tracking-[0.16em]">
                          Cuando lleguen, apareceran aqui
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {dmRequestsIncoming.map((req) => {
                        const from = users.find((u) => u.id === req.fromUserId);
                        const label = from?.displayName?.trim() || from?.username || req.fromUserId;
                        const status = resolvePresenceStatus(
                          req.fromUserId,
                          (from?.status || 'offline') as 'online' | 'idle' | 'dnd' | 'offline'
                        );
                        return (
                          <div key={req.id} className="w-full rounded-2xl border border-neon-green/25 bg-neon-green/8 px-4 py-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0 flex items-center gap-3">
                                <div className="relative w-9 h-9 rounded-xl overflow-hidden border border-white/[0.12] bg-white/[0.03] flex items-center justify-center text-white font-black text-sm">
                                  {from?.avatar ? (
                                    <img src={from.avatar} alt={label} className="w-full h-full object-cover" />
                                  ) : (
                                    (label[0] || '?').toUpperCase()
                                  )}
                                  <div
                                    className={cn(
                                      "absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-[#0A0A0B]",
                                      status === 'online'
                                        ? "bg-neon-green"
                                        : status === 'idle'
                                          ? "bg-neon-blue"
                                          : status === 'dnd'
                                            ? "bg-neon-pink"
                                            : "bg-[#4E5058]"
                                    )}
                                  />
                                </div>
                                <div className="min-w-0">
                                  <div className="text-white font-black text-sm truncate">{label}</div>
                                  <div className="text-[10px] font-black uppercase tracking-[0.16em] text-neon-green">Solicitud entrante</div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-[#9aa1aa]">
                                  {formatActivityTime(req.createdAt)}
                                </div>
                                <button
                                  onClick={() => rejectDMRequest(req.id)}
                                  className="h-8 px-3 rounded-xl border border-white/[0.12] bg-white/[0.03] text-[10px] font-black uppercase tracking-[0.16em] text-white hover:bg-white/[0.08] transition-all"
                                >
                                  Rechazar
                                </button>
                                <button
                                  onClick={() => acceptDMRequest(req.id)}
                                  className="h-8 px-3 rounded-xl border border-neon-green/45 bg-neon-green/12 text-[10px] font-black uppercase tracking-[0.16em] text-neon-green hover:bg-neon-green/20 transition-all"
                                >
                                  Aceptar
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      {dmRequestsOutgoing.map((req) => {
                        const to = users.find((u) => u.id === req.toUserId);
                        const label = to?.displayName?.trim() || to?.username || req.toUserId;
                        const status = resolvePresenceStatus(
                          req.toUserId,
                          (to?.status || 'offline') as 'online' | 'idle' | 'dnd' | 'offline'
                        );
                        return (
                          <div key={req.id} className="w-full rounded-2xl border border-neon-blue/25 bg-neon-blue/8 px-4 py-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0 flex items-center gap-3">
                                <div className="relative w-9 h-9 rounded-xl overflow-hidden border border-white/[0.12] bg-white/[0.03] flex items-center justify-center text-white font-black text-sm">
                                  {to?.avatar ? (
                                    <img src={to.avatar} alt={label} className="w-full h-full object-cover" />
                                  ) : (
                                    (label[0] || '?').toUpperCase()
                                  )}
                                  <div
                                    className={cn(
                                      "absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-[#0A0A0B]",
                                      status === 'online'
                                        ? "bg-neon-green"
                                        : status === 'idle'
                                          ? "bg-neon-blue"
                                          : status === 'dnd'
                                            ? "bg-neon-pink"
                                            : "bg-[#4E5058]"
                                    )}
                                  />
                                </div>
                                <div className="min-w-0">
                                  <div className="text-white font-black text-sm truncate">{label}</div>
                                  <div className="text-[10px] font-black uppercase tracking-[0.16em] text-neon-blue">Solicitud enviada</div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-[#9aa1aa]">
                                  {formatActivityTime(req.createdAt)}
                                </div>
                                <button
                                  onClick={() => cancelDMRequest(req.id)}
                                  className="h-8 px-3 rounded-xl border border-white/[0.12] bg-white/[0.03] text-[10px] font-black uppercase tracking-[0.16em] text-white hover:bg-white/[0.08] transition-all"
                                >
                                  Cancelar
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )
                ) : visibleCommunicationFriends.length === 0 ? (
                  <div className="h-full min-h-[220px] flex items-center justify-center">
                    <div className="text-center">
                      <div className="w-16 h-16 rounded-2xl mx-auto mb-4 bg-white/[0.02] border border-white/[0.08] flex items-center justify-center text-[#4E5058]">
                        <Users size={24} />
                      </div>
                      <div className="text-white font-black text-lg tracking-tight">Sin amigos en esta vista</div>
                      <div className="text-[#7f8790] text-xs mt-2 font-bold uppercase tracking-[0.16em]">
                        Ajusta filtro o abre un DM nuevo
                      </div>
                    </div>
                  </div>
                ) : (
                  visibleCommunicationFriends.map((entry, idx) => {
                    const label = entry.user.displayName?.trim() || entry.user.username || entry.user.id;
                    const subtitle = `${entry.user.username || 'user'}#${entry.user.discriminator || '0000'}`;
                    const preview =
                      entry.lastMessage?.content?.trim() ||
                      (entry.lastMessage?.attachments?.length ? '[Adjunto]' : 'Sin mensajes recientes');
                    return (
                      <button
                        key={entry.user.id}
                        onMouseEnter={() => setFriendsSelectionIndex(idx)}
                        onClick={() => {
                          setActiveServer(null);
                          setActiveChannel(entry.dmId);
                        }}
                        className={cn(
                          "w-full rounded-2xl border bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/[0.14] transition-all px-4 py-3 text-left",
                          idx === friendsSelectionIndex ? "border-neon-blue/35 shadow-[0_0_0_1px_rgba(56,189,248,0.25)]" : "border-white/[0.08]"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <div className="relative">
                            <div className="w-12 h-12 rounded-xl overflow-hidden bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-white font-black">
                              {entry.user.avatar ? (
                                <img src={entry.user.avatar} alt={label} className="w-full h-full object-cover" />
                              ) : (
                                (label[0] || '?').toUpperCase()
                              )}
                            </div>
                            <div
                              className={cn(
                                "absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-[#0A0A0B]",
                                entry.status === 'online'
                                  ? "bg-neon-green"
                                  : entry.status === 'idle'
                                    ? "bg-neon-blue"
                                    : entry.status === 'dnd'
                                      ? "bg-neon-pink"
                                      : "bg-[#4E5058]"
                              )}
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-white font-black text-sm truncate inline-flex items-center gap-1.5">
                                {highlightFriendsViewText(label)}
                                {entry.isPinned ? <Pin size={11} className="text-neon-purple flex-shrink-0" /> : null}
                              </div>
                              <div className="text-[10px] font-black uppercase tracking-[0.16em] text-[#8a919a]">
                                {formatActivityTime(entry.lastMessage?.timestamp || null)}
                              </div>
                            </div>
                            <div className="text-[#8a919a] text-[10px] font-black uppercase tracking-[0.16em] truncate">
                              {highlightFriendsViewText(subtitle)}
                            </div>
                            <div className="text-[#AEB4BD] text-xs font-medium truncate mt-1">{highlightFriendsViewText(preview)}</div>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                togglePinnedDM(entry.dmId);
                              }}
                              className={cn(
                                "w-7 h-7 rounded-lg border transition-colors inline-flex items-center justify-center",
                                entry.isPinned
                                  ? "border-neon-purple/45 bg-neon-purple/12 text-neon-purple"
                                  : "border-white/[0.12] bg-white/[0.03] text-white/65 hover:text-white hover:bg-white/[0.08]"
                              )}
                              title={entry.isPinned ? 'Desanclar DM' : 'Anclar DM'}
                            >
                              <Pin size={12} />
                            </button>
                            <span className="text-[#8a919a]">
                              <MessageSquare size={15} />
                            </span>
                            {developerMode ? (
                              <button
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  void copyFriendId(entry.user.id);
                                }}
                                className="w-7 h-7 rounded-lg border border-white/[0.12] bg-white/[0.03] text-white/75 hover:text-white hover:bg-white/[0.08] transition-colors inline-flex items-center justify-center"
                                title={`Copy ID: ${entry.user.id}`}
                              >
                                {copiedFriendId === entry.user.id ? <Check size={12} className="text-neon-green" /> : <Copy size={12} />}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </section>

            <aside className="hidden xl:flex w-[320px] border-l border-white/[0.05] bg-black/20 flex-col">
              <div className="px-5 py-4 border-b border-white/[0.05]">
                <div className="text-white font-black text-lg tracking-tight">Activo ahora</div>
                <div className="text-[#7f8790] text-[10px] font-black uppercase tracking-[0.16em] mt-1">
                  Amigos en linea
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                {activeNowFriends.length === 0 ? (
                  <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 text-center">
                    <div className="text-[#A2A8B0] text-sm font-bold">Nada por ahora</div>
                    <div className="text-[#6f7781] text-xs mt-1">Cuando haya actividad saldra aqui.</div>
                  </div>
                ) : (
                  activeNowFriends.map((entry) => {
                    const label = entry.user.displayName?.trim() || entry.user.username || entry.user.id;
                    const preview =
                      entry.lastMessage?.content?.trim() ||
                      (entry.lastMessage?.attachments?.length ? '[Adjunto]' : 'Sin actividad reciente');
                    return (
                      <button
                        key={`active-${entry.user.id}`}
                        onClick={() => {
                          setActiveServer(null);
                          setActiveChannel(entry.dmId);
                        }}
                        className="w-full rounded-2xl border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05] transition-all p-3 text-left"
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-9 h-9 rounded-lg overflow-hidden bg-white/[0.06] flex items-center justify-center text-xs font-black text-white">
                            {entry.user.avatar ? (
                              <img src={entry.user.avatar} alt={label} className="w-full h-full object-cover" />
                            ) : (
                              (label[0] || '?').toUpperCase()
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="text-white font-black text-sm truncate inline-flex items-center gap-1.5">
                              {label}
                              {entry.isPinned ? <Pin size={10} className="text-neon-purple flex-shrink-0" /> : null}
                            </div>
                            <div className="text-[#7f8790] text-[10px] font-black uppercase tracking-[0.16em]">{statusLabelByKey[entry.status]}</div>
                            <div className="text-[#B4BAC3] text-[11px] font-medium truncate mt-1">{preview}</div>
                            <div className="text-[#6f7781] text-[9px] font-black uppercase tracking-[0.16em] mt-1">
                              {formatActivityTime(entry.lastMessage?.timestamp || null)}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </aside>
          </div>
        </>
      );
    }

    return (
      <>
        {quickSwitcherPortal}
        <div className="flex-1 flex flex-col items-center justify-center bg-[#0A0A0B] glass-ruby-shell text-center p-10 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-tr from-neon-blue/5 via-transparent to-neon-purple/5 opacity-50" />
          <div className="relative z-10 animate-in zoom-in-95 duration-700">
            <div className="w-24 h-24 rounded-[32px] bg-white/[0.02] border border-white/5 flex items-center justify-center mb-8 mx-auto shadow-2xl">
              <Terminal size={40} className="text-[#4E5058] opacity-20" />
            </div>
            <h2 className="text-3xl font-black text-white tracking-tighter mb-4 uppercase">{t(language, 'system_standby')}</h2>
            <p className="text-[#4E5058] max-w-sm font-bold uppercase tracking-[0.2em] text-[10px] leading-loose">
              {t(language, 'awaiting_input')}
            </p>
          </div>
        </div>
      </>
    );
  }

  if (activeChannel.type === 'voice') {
    return (
      <>
        {quickSwitcherPortal}
        <VoiceChannelView key={activeChannel.id} channelId={activeChannel.id} channelName={activeChannel.name} />
      </>
    );
  }

  if (!canViewChannel) {
    return (
      <>
        {quickSwitcherPortal}
        <div className="flex-1 flex items-center justify-center bg-[#0A0A0B] glass-ruby-shell text-center p-10">
          <div>
            <h2 className="text-2xl font-black text-white uppercase tracking-tight">Access Denied</h2>
            <p className="text-[#4E5058] mt-3 font-bold uppercase tracking-[0.2em] text-[10px]">
              No tienes permiso para ver este canal.
            </p>
          </div>
        </div>
      </>
    );
  }

  const moderationMeta = moderationActionMeta[moderationDialog.action];
  const moderationSelectedUser = moderationDialog.selectedUserId
    ? users.find((u) => u.id === moderationDialog.selectedUserId) || null
    : null;
  const canSelectDuration = moderationDialog.action === 'timeout';
  const moderationDurationLabel =
    moderationDialog.action === 'ban'
      ? 'Duracion del ban'
      : moderationDialog.action === 'kick'
        ? 'Duracion'
        : moderationDialog.action === 'timeout'
          ? 'Duracion del timeout (min)'
          : 'Duracion';

  return (
    <>
      {quickSwitcherPortal}
      <div className="flex-1 flex flex-col bg-[#0A0A0B] glass-ruby-shell h-full relative overflow-hidden">
        {liveToasts.length > 0 ? (
          <div className="absolute top-16 md:top-20 right-2 md:right-6 z-[320] space-y-2 w-[calc(100%-1rem)] max-w-[360px] pointer-events-none">
            {liveToasts.map((toast) => (
              <button
                key={toast.id}
                onClick={() => openToast(toast)}
                className={cn(
                  "w-full text-left rounded-2xl border backdrop-blur-xl shadow-2xl px-3 py-2.5 pointer-events-auto animate-in slide-in-from-right-2 fade-in duration-300",
                  toast.kind === 'mention'
                    ? "bg-neon-blue/10 border-neon-blue/35 hover:bg-neon-blue/15"
                    : "bg-neon-green/10 border-neon-green/35 hover:bg-neon-green/15"
                )}
              >
                <div className="flex items-start gap-2">
                  <div
                    className={cn(
                      "mt-0.5 w-7 h-7 rounded-lg border flex items-center justify-center",
                      toast.kind === 'mention' ? "border-neon-blue/45 text-neon-blue" : "border-neon-green/45 text-neon-green"
                    )}
                  >
                    {toast.kind === 'mention' ? <Bell size={13} /> : <MessageSquare size={13} />}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] font-black uppercase tracking-widest text-white truncate">{toast.title}</div>
                    <div className="text-xs text-[#D0D4D8] truncate">{toast.body}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : null}

        <div className="h-14 md:h-16 flex items-center px-3 md:px-8 border-b border-white/[0.03] glass-ruby-strip bg-white/[0.01] backdrop-blur-2xl z-50 flex-shrink-0">
          <div className="flex items-center flex-1 gap-2 md:gap-4 min-w-0">
            <div className="w-8 h-8 md:w-10 md:h-10 rounded-lg md:rounded-xl bg-white/[0.03] flex items-center justify-center border border-white/[0.05] shrink-0">
              {activeChannel.type === 'announcement' ? <Bell size={16} className="text-neon-blue" /> : <Hash size={16} className="text-neon-blue" />}
            </div>
            <div className="min-w-0">
              <h3 className="text-white font-black text-sm md:text-lg tracking-tight leading-none uppercase truncate">{activeChannel.name}</h3>
              <div className="hidden md:flex items-center gap-2 mt-1">
                {activeChannel.topic ? <div className="text-[10px] text-[#4E5058] font-black uppercase tracking-widest truncate">{activeChannel.topic}</div> : null}
                {developerMode ? (
                  <button
                    onClick={() => void copyChannelId()}
                    title={`Copy ID: ${activeChannel.id}`}
                    className="h-5 px-2 rounded-md bg-white/[0.03] border border-white/[0.08] text-[9px] font-black uppercase tracking-widest text-white/70 hover:text-white hover:bg-white/[0.06] transition-colors inline-flex items-center gap-1.5"
                  >
                    {copiedChannelId === activeChannel.id ? <Check size={10} className="text-neon-green" /> : <Copy size={10} />}
                    ID
                  </button>
                ) : null}
                <div className="hidden xl:contents">
                  <div className="h-4 w-px bg-white/10 mx-0.5 shrink-0" />
                  <div className="h-5 px-2 rounded-md border border-white/[0.1] bg-white/[0.02] text-[9px] font-black uppercase tracking-[0.14em] text-[#aab1ba] inline-flex items-center shrink-0">
                    {channelMetrics.total} msg
                  </div>
                  <div className="h-5 px-2 rounded-md border border-white/[0.08] bg-white/[0.02] text-[9px] font-black uppercase tracking-[0.14em] text-[#7b838a] inline-flex items-center shrink-0">
                    {channelMetrics.pinned} pin
                  </div>
                  <div className="h-5 px-2 rounded-md border border-white/[0.08] bg-white/[0.02] text-[9px] font-black uppercase tracking-[0.14em] text-[#7b838a] inline-flex items-center shrink-0">
                    {channelMetrics.media} media
                  </div>
                  <div className="h-5 px-2 rounded-md border border-white/[0.08] bg-white/[0.02] text-[9px] font-black uppercase tracking-[0.14em] text-[#7b838a] inline-flex items-center shrink-0">
                    {channelMetrics.links} links
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 md:gap-6 text-[#4E5058] shrink-0">
            <button
              onClick={() => {
                setSelectedUserId(null);
                setSearchPanelOpen(false);
                setInboxOpen((v) => !v);
              }}
              title="Abrir bandeja de menciones (Alt+1)"
              aria-label="Bandeja de menciones"
              aria-expanded={inboxOpen}
              type="button"
              className={cn('relative hover:text-neon-blue transition-colors', inboxOpen && 'text-neon-blue')}
            >
              <Bell size={20} />
              {inboxTotalCount > 0 ? (
                <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 rounded-full bg-neon-pink text-black text-[9px] font-black flex items-center justify-center">
                  {Math.min(inboxTotalCount, 99)}
                </span>
              ) : null}
            </button>
            <button
              onClick={() => {
                setSelectedUserId(null);
                setInboxOpen(false);
                toggleRightSidebarPanel('details');
              }}
              title="Abrir detalles del canal (Alt+2, ocultar panel: Alt+4)"
              aria-label="Detalles del canal"
              type="button"
              className={cn(
                'hover:text-neon-blue transition-colors',
                rightSidebarOpen && rightSidebarView === 'details' && !selectedUserId && 'text-neon-blue'
              )}
            >
              <Pin size={20} />
            </button>
            <button
              onClick={() => {
                setSelectedUserId(null);
                setInboxOpen(false);
                toggleRightSidebarPanel('members');
              }}
              title="Abrir lista de miembros (Alt+3, ocultar panel: Alt+4)"
              aria-label="Lista de miembros"
              type="button"
              className={cn(
                'hover:text-neon-blue transition-colors',
                rightSidebarOpen && rightSidebarView === 'members' && !selectedUserId && 'text-neon-blue'
              )}
            >
              <Users size={20} />
            </button>
            <button
              onClick={openQuickSwitcher}
              title="Quick Switcher (Ctrl/Cmd + K)"
              aria-label="Quick Switcher"
              type="button"
              className={cn("hidden md:inline-flex hover:text-neon-blue transition-colors", quickSwitcherOpen && "text-neon-blue")}
            >
              <Command size={20} />
            </button>
            <div className="hidden md:block h-6 w-px bg-white/5 mx-2" />
            <div className="relative group hidden md:block">
              <input
                ref={channelSearchInputRef}
                type="text"
                value={channelSearchQuery}
                onChange={(e) => {
                  setChannelSearchQuery(e.target.value);
                  setSearchPanelOpen(true);
                  setSearchResultIndex(0);
                }}
                onFocus={() => setSearchPanelOpen(true)}
                onKeyDown={handleSearchInputKeyDown}
                placeholder="SEARCH IN CHANNEL"
                title="Atajo: Ctrl/Cmd + F (Quick Switcher: Ctrl/Cmd + K)"
                className="bg-white/[0.02] border border-white/[0.05] text-[10px] font-black py-2 px-4 rounded-xl w-40 lg:w-44 focus:w-64 lg:focus:w-72 focus:border-neon-blue/30 focus:bg-white/[0.04] transition-all outline-none text-white placeholder-[#4E5058] uppercase tracking-widest"
              />
              <Search size={14} className="absolute right-3 top-2.5 opacity-40 group-focus-within:text-neon-blue group-focus-within:opacity-100 transition-all" />
              {searchPanelOpen ? (
                <div
                  ref={channelSearchPanelRef}
                  className="absolute right-0 mt-2 w-[420px] rounded-2xl border border-white/10 bg-[#0A0A0B]/95 glass-ruby-surface backdrop-blur-xl shadow-2xl p-3 z-[220]"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <select
                      value={searchAuthorId}
                      onChange={(e) => setSearchAuthorId(e.target.value)}
                      className="bg-black/40 border border-white/10 text-white text-[10px] font-black uppercase tracking-widest rounded-lg px-2 py-1.5 outline-none"
                    >
                      <option value="all">Todos</option>
                      {messageAuthors.map((u) => (
                        <option key={u.id} value={u.id}>{u.username}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => setSearchPinnedOnly((v) => !v)}
                      className={cn(
                        "px-2 py-1.5 rounded-lg border text-[10px] font-black uppercase tracking-widest",
                        searchPinnedOnly ? "bg-neon-blue/20 border-neon-blue/40 text-neon-blue" : "bg-white/[0.03] border-white/10 text-[#B5BAC1]"
                      )}
                    >
                      Pinned
                    </button>
                    <button
                      onClick={() => setSearchWithFilesOnly((v) => !v)}
                      className={cn(
                        "px-2 py-1.5 rounded-lg border text-[10px] font-black uppercase tracking-widest",
                        searchWithFilesOnly ? "bg-neon-blue/20 border-neon-blue/40 text-neon-blue" : "bg-white/[0.03] border-white/10 text-[#B5BAC1]"
                      )}
                    >
                      Files
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-[10px] font-black uppercase tracking-widest text-[#7b838a] mb-2">
                    <span>{searchResults.length} resultados</span>
                    <span className="text-[9px] text-[#8f97a0]">
                      {searchResults.length > 0 ? `${searchResultIndex + 1}/${searchResults.length}` : '0/0'}  |  Enter
                    </span>
                  </div>
                  <div className="max-h-[320px] overflow-y-auto space-y-1">
                    {searchResults.length === 0 ? (
                      <div className="text-xs text-[#949BA4] px-2 py-3">No se encontraron mensajes.</div>
                    ) : (
                      searchResults.map((m, idx) => {
                        const author = users.find((u) => u.id === m.authorId);
                        return (
                          <button
                            key={m.id}
                            onClick={() => jumpToMessage(m.id)}
                            onMouseEnter={() => setSearchResultIndex(idx)}
                            className={cn(
                              "w-full text-left px-2.5 py-2 rounded-xl border transition-all",
                              idx === searchResultIndex
                                ? "border-neon-blue/35 bg-neon-blue/10"
                                : "border-transparent hover:border-white/10 hover:bg-white/[0.04]"
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-[11px] font-black text-white truncate">{author?.username || m.authorId}</div>
                              <div className="text-[9px] font-black uppercase tracking-widest text-[#7b838a]">
                                {new Date(m.timestamp).toLocaleTimeString()}
                              </div>
                            </div>
                            <div className="text-xs text-[#B5BAC1] truncate mt-0.5">{m.content || '[Adjunto]'}</div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="relative hidden md:block">
              <button
                ref={inboxButtonRef}
                onClick={() => setInboxOpen((v) => !v)}
                aria-label="Inbox de menciones y hilos"
                aria-expanded={inboxOpen}
                type="button"
                className={cn("hover:text-white transition-colors relative", inboxOpen && "text-neon-blue")}
              >
                <Inbox size={20} />
                {inboxTotalCount > 0 ? (
                  <span className="absolute -top-2 -right-2 min-w-4 h-4 px-1 rounded-full bg-neon-pink text-black text-[9px] font-black flex items-center justify-center">
                    {Math.min(inboxTotalCount, 99)}
                  </span>
                ) : null}
              </button>
              {inboxOpen ? (
                <div
                  ref={inboxPanelRef}
                  className="absolute right-0 mt-2 w-[380px] rounded-2xl border border-white/10 bg-[#0A0A0B]/95 glass-ruby-surface backdrop-blur-xl shadow-2xl p-3 z-[230]"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#949BA4]">Mentions Inbox</div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-neon-blue">
                      {unseenMentionsCount}M / {unseenThreadCount}H
                    </div>
                  </div>
                  <div className="max-h-[360px] overflow-y-auto space-y-1">
                    {mentionInbox.length === 0 ? (
                      <div className="text-xs text-[#949BA4] px-2 py-3">No tienes menciones recientes.</div>
                    ) : (
                      mentionInbox.map((entry) => (
                        <button
                          key={entry.message.id}
                          onClick={() => openMentionFromInbox(entry)}
                          className={cn(
                            "w-full text-left px-2.5 py-2 rounded-xl border transition-all",
                            seenMentionIds.includes(entry.message.id)
                              ? "border-transparent hover:border-white/10 hover:bg-white/[0.04]"
                              : "border-neon-blue/35 bg-neon-blue/10 hover:border-neon-blue/50"
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-[11px] font-black text-white truncate">
                              {entry.authorName} <span className="text-[#7b838a]">// #{entry.channelName}</span>
                            </div>
                            <div className="text-[9px] font-black uppercase tracking-widest text-[#7b838a]">
                              {new Date(entry.message.timestamp).toLocaleTimeString()}
                            </div>
                          </div>
                          <div className="text-xs text-[#B5BAC1] truncate mt-0.5">{entry.message.content || '[Adjunto]'}</div>
                        </button>
                      ))
                    )}
                    {threadInbox.length > 0 ? (
                      <div className="pt-2 mt-2 border-t border-white/10">
                        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#949BA4] mb-1 px-1">Threads</div>
                        {threadInbox.map((entry) => (
                          <button
                            key={`${entry.threadId}-${entry.parentMessageId}`}
                            onClick={() => openThreadFromInbox(entry)}
                            className="w-full text-left px-2.5 py-2 rounded-xl border border-neon-green/35 bg-neon-green/10 hover:border-neon-green/50 transition-all mb-1"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-[11px] font-black text-white truncate">
                                {entry.authorName} <span className="text-[#7b838a]">// #{entry.channelName}</span>
                              </div>
                              <div className="text-[9px] font-black uppercase tracking-widest text-neon-green">
                                +{entry.unreadCount}
                              </div>
                            </div>
                            <div className="text-xs text-[#B5BAC1] truncate mt-0.5">{entry.preview}</div>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden px-3 md:px-8 pt-4 md:pt-8 space-y-1 custom-scrollbar relative">
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none opacity-10" />

          <div className="flex flex-col justify-end min-h-full pb-8 md:pb-10">
            <div className="mb-8 md:mb-16 animate-in fade-in slide-in-from-top-4 duration-1000">
              <div className="w-14 h-14 md:w-20 md:h-20 rounded-2xl md:rounded-3xl bg-gradient-to-tr from-neon-blue/20 to-neon-purple/20 border border-white/5 flex items-center justify-center mb-4 md:mb-8 shadow-2xl">
                <Cpu size={26} className="md:hidden text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.5)]" />
                <Cpu size={36} className="hidden md:block text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.5)]" />
              </div>
              <h1 className="text-white text-2xl md:text-5xl font-black tracking-tighter mb-2 md:mb-4 leading-none uppercase break-words">
                Node Established: <span className="text-neon-blue">#{activeChannel.name}</span>
              </h1>
              <p className="text-[#4E5058] font-bold uppercase tracking-[0.18em] md:tracking-[0.3em] text-[9px] md:text-[11px] leading-relaxed md:leading-loose max-w-full md:max-w-lg">
                Encryption active. End-to-end synchronization verified. Beginning log stream for terminal #{activeChannel.id.slice(-4)}.
              </p>
              <div className="h-px w-full bg-gradient-to-r from-white/[0.05] via-white/[0.02] to-transparent mt-6 md:mt-10" />
            </div>

            <div className="space-y-1" role="list" aria-label="Mensajes del canal activo">
              {hiddenTimelineMessageCount > 0 ? (
                <div className="flex justify-center py-1">
                  <button
                    onClick={loadOlderTimelineItems}
                    className="px-3 py-1.5 rounded-xl border border-white/14 bg-white/[0.03] text-[10px] font-black uppercase tracking-[0.14em] text-white/80 hover:text-white hover:bg-white/[0.06] transition-all"
                  >
                    Cargar {Math.min(TIMELINE_WINDOW_STEP, hiddenTimelineMessageCount)} mensajes anteriores
                  </button>
                </div>
              ) : null}
              {renderedTimeline.map((item) =>
                item.kind === 'date' ? (
                  <div key={item.id} className="py-3 flex items-center gap-3">
                    <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/[0.08] to-white/[0.03]" />
                    <div className="px-3 py-1 rounded-full border border-white/[0.08] bg-white/[0.03] text-[9px] font-black uppercase tracking-[0.18em] text-[#9AA1A9]">
                      {item.label}
                    </div>
                    <div className="h-px flex-1 bg-gradient-to-l from-transparent via-white/[0.08] to-white/[0.03]" />
                  </div>
                ) : (
                  <div
                    key={item.id}
                    ref={(node) => {
                      timelineMessageRefs.current[item.id] = node;
                    }}
                    role="listitem"
                    tabIndex={0}
                    onKeyDown={(event) => handleTimelineMessageKeyDown(event, item.id)}
                    aria-label={`Mensaje de ${usersById.get(item.message.authorId)?.username || item.message.authorId}`}
                    className="rounded-lg focus-visible:ring-2 focus-visible:ring-neon-blue/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1E1F22]"
                  >
                    <MessageItem
                      message={item.message}
                      onReply={(m) => setReplyingTo(m)}
                      onOpenThread={openThreadForMessage}
                      onMentionUser={mentionUserFromContext}
                      highlighted={highlightMessageId === item.message.id}
                      threadUnreadCount={threadUnreadByParentMessage[item.message.id] || 0}
                      entryFx={Boolean(messageFxIds[item.message.id])}
                      isCompact={
                        item.index > 0 &&
                        channelMessages[item.index - 1].authorId === item.message.authorId &&
                        new Date(item.message.timestamp).getTime() - new Date(channelMessages[item.index - 1].timestamp).getTime() <
                        300000
                      }
                    />
                  </div>
                )
              )}
            </div>

            {!isAtBottom && newMessagesWhileScrolled > 0 ? (
              <div className="sticky bottom-6 z-20 flex justify-end pr-4 pointer-events-none">
                <button
                  onClick={jumpToLatest}
                  className="pointer-events-auto chat-jump-pill inline-flex items-center gap-2 px-3 py-2 rounded-2xl border border-neon-blue/35 bg-[#0A0A0B]/92 glass-ruby-shell text-white shadow-2xl hover:border-neon-blue/55 transition-all"
                >
                  <ChevronsDown size={14} className="text-neon-blue" />
                  <span className="text-[11px] font-black uppercase tracking-widest">
                    {newMessagesWhileScrolled} nuevo{newMessagesWhileScrolled > 1 ? 's' : ''}
                  </span>
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {activeThread ? (
          <div className="absolute inset-x-2 top-16 bottom-[calc(5.8rem+env(safe-area-inset-bottom))] md:inset-x-auto md:right-6 md:top-20 md:bottom-28 w-auto md:w-[340px] rounded-2xl border border-white/10 bg-[#0A0A0B]/95 glass-ruby-surface backdrop-blur-xl shadow-2xl z-[180] flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#949BA4]">Thread</div>
                <div className="text-white font-black text-sm truncate">{activeThread.name}</div>
              </div>
              <button
                onClick={() => setActiveThread(null)}
                className="w-8 h-8 rounded-lg bg-white/[0.03] border border-white/10 text-white/70 hover:text-white hover:bg-white/[0.07] transition-colors flex items-center justify-center"
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {activeThreadList.length === 0 ? (
                <div className="text-xs text-[#949BA4]">Este hilo esta vacio. Escribe la primera respuesta.</div>
              ) : (
                activeThreadList.map((tm) => {
                  const author = users.find((u) => u.id === tm.authorId);
                  return (
                    <div key={tm.id} className="rounded-xl border border-white/10 bg-black/25 p-2.5">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="text-[11px] font-black text-white truncate">{author?.username || tm.authorId}</div>
                        <div className="text-[9px] font-black uppercase tracking-widest text-[#7b838a]">{new Date(tm.timestamp).toLocaleTimeString()}</div>
                      </div>
                      <div className="text-xs text-[#DBDEE1] whitespace-pre-wrap break-words">{tm.content || '[Adjunto]'}</div>
                    </div>
                  );
                })
              )}
            </div>
            <div className="p-3 border-t border-white/10">
              <div className="flex items-center gap-2">
                <input
                  value={threadInput}
                  onChange={(e) => setThreadInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') sendThreadReply();
                  }}
                  placeholder="Responder en el hilo..."
                  className="flex-1 bg-black/35 border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-neon-blue/40 transition-colors"
                />
                <button
                  onClick={sendThreadReply}
                  disabled={!threadInput.trim()}
                  className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center transition-all",
                    threadInput.trim() ? "bg-neon-blue text-white hover:scale-105" : "bg-white/[0.03] text-[#4E5058]"
                  )}
                >
                  <Send size={16} />
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="px-3 md:px-10 pb-[max(0.7rem,env(safe-area-inset-bottom))] md:pb-10 pt-3 md:pt-4 flex-shrink-0 z-50">
          <input
            id={fileInputId}
            type="file"
            multiple
            accept="image/*,video/*,audio/*,.gif"
            disabled={!canAttachFiles || !canSendMessages || attachmentPipeline.active || voiceBusy}
            className="hidden"
            onChange={(e) => {
              void onPickFiles(e.target.files);
              e.currentTarget.value = '';
            }}
          />

          <div
            className={cn(
              'bg-[#0A0A0B] glass-ruby-surface border border-white/5 rounded-3xl overflow-visible transition-all duration-500 group focus-within:border-neon-blue/30 focus-within:shadow-[0_0_50px_rgba(194,24,60,0.05)] shadow-2xl relative',
              replyingTo && 'rounded-t-none',
              !canSendMessages && 'opacity-80',
              dragOverlayActive && 'border-neon-blue/55 shadow-[0_0_28px_rgba(194,24,60,0.2)]'
            )}
            onDragEnter={handleComposerDragEnter}
            onDragOver={handleComposerDragOver}
            onDragLeave={handleComposerDragLeave}
            onDrop={handleComposerDrop}
          >
            {dragOverlayActive ? (
              <div className="absolute inset-2 z-20 rounded-2xl border border-dashed border-neon-blue/55 bg-neon-blue/8 backdrop-blur-sm pointer-events-none flex items-center justify-center">
                <div className="px-4 py-2 rounded-xl border border-neon-blue/35 bg-black/55 text-[10px] font-black uppercase tracking-[0.2em] text-neon-blue">
                  Soltar archivos para adjuntar
                </div>
              </div>
            ) : null}
            {replyingTo ? (
              <div className="absolute top-0 left-0 right-0 -translate-y-full bg-white/[0.02] glass-ruby-strip backdrop-blur-xl border-x border-t border-white/5 px-3 md:px-6 py-2.5 md:py-3 flex items-center justify-between animate-in slide-in-from-bottom-2 duration-300 rounded-t-3xl">
                <div className="flex items-center gap-3">
                  <div className="w-1 h-4 bg-neon-blue rounded-full" />
                  <span className="text-[9px] md:text-[10px] font-black text-[#4E5058] uppercase tracking-widest">In Response To:</span>
                  <span className="text-[11px] md:text-xs text-white/60 font-medium italic truncate max-w-[62vw] md:max-w-md">{replyingTo.content}</span>
                </div>
                <button onClick={() => setReplyingTo(null)} className="w-6 h-6 rounded-lg bg-white/5 flex items-center justify-center hover:bg-neon-pink hover:text-white transition-all"><X size={12} /></button>
              </div>
            ) : null}

            {attachmentPipeline.active ? (
              <div className="px-3 md:px-6 pt-3 md:pt-4 pb-3 border-b border-white/[0.06] bg-white/[0.01]">
                <div className="flex items-center justify-between gap-3 text-[10px] font-black uppercase tracking-widest">
                  <div className="flex items-center gap-2 text-neon-blue">
                    <Loader2 size={12} className="animate-spin" />
                    <span>{attachmentPipeline.stage || 'Procesando adjuntos...'}</span>
                  </div>
                  <span className="text-[#A0A6AE]">
                    {attachmentPipeline.done}/{attachmentPipeline.total}
                  </span>
                </div>
                <div className="mt-2 h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,#8E1330,#C2183C,#00FF94)] chat-upload-progress-bar"
                    style={{
                      width:
                        attachmentPipeline.total > 0
                          ? `${Math.min(100, Math.max(6, (attachmentPipeline.done / attachmentPipeline.total) * 100))}%`
                          : '6%',
                    }}
                  />
                </div>
              </div>
            ) : null}

            {pendingPreview.length > 0 ? (
              <div className="px-3 md:px-6 pt-4 md:pt-5 pb-2 flex flex-wrap gap-2.5 md:gap-3 border-b border-white/[0.05] bg-white/[0.01]">
                {pendingPreview.map((att) => (
                  <div key={att.id} className="relative w-20 h-20 md:w-24 md:h-24 rounded-2xl overflow-hidden border border-white/10 bg-black/30">
                    {att.isImage ? (
                      <img src={att.url} alt={att.filename} className="w-full h-full object-cover" />
                    ) : att.isVideo ? (
                      <video src={att.url} className="w-full h-full object-cover" muted />
                    ) : (
                      <div className="w-full h-full p-2 text-[10px] text-white/70 font-bold break-all">{att.filename}</div>
                    )}
                    <button onClick={() => removePendingAttachment(att.id)} className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 border border-white/20 text-white/80 hover:text-white hover:bg-black/90 transition-colors flex items-center justify-center">
                      <X size={12} />
                    </button>
                    <div className="absolute bottom-1 left-1 right-1 rounded-md bg-black/70 border border-white/10 px-1.5 py-0.5 text-[9px] font-black text-[#D5D9DE] truncate">
                      {formatBytes(att.payloadBytes)}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="flex items-center px-3 md:px-6 py-3 md:py-4 gap-2 md:gap-4 relative">
              <label
                htmlFor={fileInputId}
                className={cn(
                  "w-9 h-9 md:w-10 md:h-10 rounded-xl bg-white/[0.03] border border-white/10 flex items-center justify-center text-[#4E5058] transition-all transform active:scale-90 shrink-0",
                  canAttachFiles && canSendMessages && !attachmentPipeline.active && !voiceBusy
                    ? "hover:bg-neon-blue hover:border-neon-blue hover:text-black cursor-pointer"
                    : "opacity-40 cursor-not-allowed"
                )}
              >
                <PlusCircle size={18} className="md:hidden" />
                <PlusCircle size={24} className="hidden md:block" />
              </label>

              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={onInputChange}
                onKeyDown={handleKeyDown}
                disabled={!canSendMessages}
                placeholder={
                  canSendMessages
                    ? isCompactViewport
                      ? `MENSAJE A #${activeChannel.name.toUpperCase()}`
                      : `COMMAND TRANSMISSION TO #${activeChannel.name.toUpperCase()}`
                    : isCompactViewport
                      ? 'SIN PERMISOS PARA ENVIAR'
                      : 'NO TIENES PERMISO PARA ENVIAR MENSAJES EN ESTE CANAL'
                }
                className="min-w-0 flex-1 bg-transparent text-white py-2 outline-none placeholder-[#4E5058] font-bold text-[12px] md:text-sm tracking-tight"
              />

              {mentionOpen && mentionOptions.length > 0 ? (
                <div
                  ref={mentionPanelRef}
                  className="absolute left-2 right-2 md:left-20 md:right-48 bottom-full mb-2 rounded-2xl border border-white/10 bg-[#0A0A0B]/95 backdrop-blur-xl shadow-2xl p-2 z-[520]"
                >
                  <div className="text-[9px] font-black uppercase tracking-[0.2em] text-[#949BA4] mb-2">
                    {mentionKind === 'user' ? 'Usuarios' : 'Canales'}
                  </div>
                  <div className="space-y-1 max-h-56 overflow-y-auto">
                    {mentionOptions.map((option, idx) => (
                      <button
                        key={option.id}
                        onClick={() => applyMention(option)}
                        className={cn(
                          "w-full px-3 py-2 rounded-xl text-left text-sm transition-colors",
                          idx === mentionIndex ? "bg-neon-blue/15 text-white border border-neon-blue/30" : "text-[#B5BAC1] hover:bg-white/[0.05]"
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="flex items-center gap-1 md:gap-2 text-[#4E5058] relative shrink-0">
                <button
                  ref={gifButtonRef}
                  disabled={!canSendMessages || attachmentPipeline.active || voiceBusy}
                  onClick={() => openPicker('gif', gifButtonRef)}
                  className={cn(
                    "p-1.5 md:p-2 rounded-xl transition-all",
                    canSendMessages && !attachmentPipeline.active && !voiceBusy ? "hover:text-neon-purple hover:bg-white/[0.05]" : "opacity-40 cursor-not-allowed",
                    pickerOpen && pickerTab === 'gif' && "text-neon-purple bg-neon-purple/10 border border-neon-purple/30"
                  )}
                >
                  <Gift size={16} className="md:hidden" />
                  <Gift size={20} className="hidden md:block" />
                </button>
                <button
                  ref={stickerButtonRef}
                  disabled={!canSendMessages || attachmentPipeline.active || voiceBusy}
                  onClick={() => openPicker('sticker', stickerButtonRef)}
                  className={cn(
                    "p-1.5 md:p-2 rounded-xl transition-all",
                    canSendMessages && !attachmentPipeline.active && !voiceBusy ? "hover:text-neon-pink hover:bg-white/[0.05]" : "opacity-40 cursor-not-allowed",
                    pickerOpen && pickerTab === 'sticker' && "text-neon-pink bg-neon-pink/10 border border-neon-pink/30"
                  )}
                >
                  <Sticker size={16} className="md:hidden" />
                  <Sticker size={20} className="hidden md:block" />
                </button>
                <button
                  ref={emojiButtonRef}
                  disabled={!canSendMessages || attachmentPipeline.active || voiceBusy}
                  onClick={() => openPicker('emoji', emojiButtonRef)}
                  className={cn(
                    "p-1.5 md:p-2 rounded-xl transition-all",
                    canSendMessages && !attachmentPipeline.active && !voiceBusy ? "hover:text-neon-green hover:bg-white/[0.05]" : "opacity-40 cursor-not-allowed",
                    pickerOpen && pickerTab === 'emoji' && "text-neon-green bg-neon-green/10 border border-neon-green/30"
                  )}
                >
                  <Smile size={16} className="md:hidden" />
                  <Smile size={20} className="hidden md:block" />
                </button>

                <button
                  type="button"
                  disabled={!canSendMessages || attachmentPipeline.active}
                  onClick={() => {
                    if (voiceClipState.mode === 'recording') {
                      stopVoiceRecording(false);
                      return;
                    }
                    if (voiceClipState.mode === 'processing') return;
                    void startVoiceRecording();
                  }}
                  className={cn(
                    "p-1.5 md:p-2 rounded-xl transition-all border",
                    voiceClipState.mode === 'recording'
                      ? "text-[#FF6B8A] border-[#FF6B8A]/50 bg-[#FF6B8A]/10 shadow-[0_0_16px_rgba(255,107,138,0.24)]"
                      : voiceClipState.mode === 'processing'
                        ? "text-neon-blue border-neon-blue/40 bg-neon-blue/10"
                        : "text-[#4E5058] border-transparent hover:text-neon-blue hover:bg-white/[0.05]"
                  )}
                  title={
                    voiceClipState.mode === 'recording'
                      ? 'Detener grabacion'
                      : voiceClipState.mode === 'processing'
                        ? 'Procesando clip'
                        : 'Grabar mensaje de voz'
                  }
                >
                  {voiceClipState.mode === 'recording' ? (
                    <>
                      <Square size={15} className="md:hidden" />
                      <Square size={18} className="hidden md:block" />
                    </>
                  ) : voiceClipState.mode === 'processing' ? (
                    <>
                      <Loader2 size={15} className="animate-spin md:hidden" />
                      <Loader2 size={18} className="hidden md:block animate-spin" />
                    </>
                  ) : (
                    <>
                      <Mic size={16} className="md:hidden" />
                      <Mic size={19} className="hidden md:block" />
                    </>
                  )}
                </button>

                <div className="hidden md:block w-px h-6 bg-white/5 mx-2" />
                <button
                  onClick={() => handleSendMessage()}
                  disabled={!canSend}
                  className={cn(
                    'w-9 h-9 md:w-10 md:h-10 rounded-xl flex items-center justify-center transition-all shrink-0',
                    sendFx && 'chat-send-burst',
                    canSend
                      ? 'bg-neon-blue text-white shadow-[0_0_20px_rgba(194,24,60,0.4)] hover:scale-105'
                      : 'bg-white/[0.02] text-[#4E5058]'
                  )}
                >
                  {attachmentPipeline.active ? (
                    <>
                      <Loader2 size={14} className="animate-spin md:hidden" />
                      <Loader2 size={16} className="hidden md:block animate-spin" />
                    </>
                  ) : (
                    <>
                      <Send size={15} className="md:hidden" />
                      <Send size={18} className="hidden md:block" />
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="min-h-[20px] mt-2 md:mt-3 px-2 md:px-6">
            {canSendMessages ? (
              <div className="mb-1.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-2 text-[8px] md:text-[9px] font-black uppercase tracking-[0.15em] md:tracking-[0.2em]">
                <span className="text-[#8F949B] truncate max-w-full sm:max-w-[62%] md:max-w-none">
                  {pendingAttachments.length > 0
                    ? `${pendingAttachments.length} adjunto${pendingAttachments.length > 1 ? 's' : ''} // ${formatBytes(
                      pendingAttachmentBytes
                    )} // wire ${formatBytes(pendingAttachmentTransportBytes)}`
                    : inputValue.trim().length > 0
                      ? 'Borrador local guardado'
                      : 'Canal listo'}
                </span>
                <div className="inline-flex items-center gap-2 shrink-0 self-end sm:self-auto">
                  <span
                    className={cn(
                      'text-[9px] font-black uppercase tracking-[0.2em]',
                      inputValue.length >= MAX_MESSAGE_LENGTH
                        ? 'text-[#F28B8B]'
                        : inputValue.length >= MAX_MESSAGE_LENGTH * 0.85
                          ? 'text-neon-blue'
                          : 'text-[#7f8790]'
                    )}
                  >
                    {inputValue.length}/{MAX_MESSAGE_LENGTH}
                  </span>
                  {attachmentPipeline.active ? (
                    <span className="inline-flex items-center gap-1 text-neon-blue">
                      <Loader2 size={10} className="animate-spin" />
                      PROCESSING
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}
            {composerNotice ? (
              <div
                className={cn(
                  'mb-1.5 text-[10px] font-black uppercase tracking-[0.18em]',
                  composerNotice.type === 'error'
                    ? 'text-[#F28B8B]'
                    : composerNotice.type === 'ok'
                      ? 'text-neon-green'
                      : 'text-[#B5BAC1]'
                )}
              >
                {composerNotice.text}
              </div>
            ) : null}
            {voiceClipState.mode !== 'idle' ? (
              <div
                className={cn(
                  'mb-1.5 text-[10px] font-black uppercase tracking-[0.18em]',
                  voiceClipState.mode === 'recording' ? 'text-[#FF9BB0]' : 'text-neon-blue'
                )}
              >
                {voiceClipState.mode === 'recording'
                  ? `GRABANDO VOZ ${formatDuration(voiceClipState.durationMs)} - PULSA MICRO PARA PARAR`
                  : 'PROCESANDO CLIP DE VOZ...'}
              </div>
            ) : null}
            {!canViewChannel ? (
              <div className="text-[9px] font-black text-neon-pink uppercase tracking-[0.2em]">Canal oculto por permisos</div>
            ) : null}
            {canViewChannel && !canSendMessages ? (
              <div className="text-[9px] font-black text-neon-pink uppercase tracking-[0.2em]">Solo lectura: no puedes escribir en este canal</div>
            ) : null}
            {canViewChannel && canSendMessages && !canAttachFiles ? (
              <div className="text-[9px] font-black text-[#B5BAC1] uppercase tracking-[0.2em]">No puedes adjuntar archivos en este canal</div>
            ) : null}
            {currentTyping.length > 0 ? (
              <div className="flex items-center gap-3">
                <div className="flex gap-1">
                  <div className="w-1 h-1 bg-neon-green rounded-full animate-bounce [animation-delay:-0.3s]" />
                  <div className="w-1 h-1 bg-neon-green rounded-full animate-bounce [animation-delay:-0.15s]" />
                  <div className="w-1 h-1 bg-neon-green rounded-full animate-bounce" />
                </div>
                <div className="text-[9px] font-black text-neon-green uppercase tracking-[0.2em]">
                  {currentTyping.length === 1 ? 'Incoming Data Stream...' : 'Multiple Data Streams Detected...'}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {pickerOpen && typeof document !== 'undefined'
          ? createPortal(
            <>
              {isCompactViewport ? (
                <button
                  type="button"
                  aria-label="Cerrar selector multimedia"
                  className="fixed inset-0 z-[555] bg-black/42 backdrop-blur-[2px]"
                  onClick={() => closePickers()}
                />
              ) : null}
              <div
                ref={pickerPanelRef}
                className={cn(
                  "fixed z-[560] w-[420px] max-w-[calc(100vw-24px)]",
                  isCompactViewport &&
                  "left-2 right-2 top-[max(0.65rem,env(safe-area-inset-top))] bottom-[calc(5.2rem+env(safe-area-inset-bottom))] w-auto max-w-none"
                )}
                style={
                  isCompactViewport
                    ? undefined
                    : {
                      left: pickerPanelPos?.left ?? 16,
                      top: pickerPanelPos?.top ?? 16,
                      transform: 'translateY(-100%)',
                    }
                }
              >
                <div
                  className={cn(
                    "rounded-2xl border border-white/10 bg-[#0A0A0B]/95 glass-ruby-shell backdrop-blur-2xl shadow-2xl overflow-hidden mac-picker-panel-enter",
                    isCompactViewport && "h-full flex flex-col"
                  )}
                >
                  <div className="px-3 pt-3 pb-2 border-b border-white/10 bg-white/[0.02]">
                    <div className="flex items-center gap-2 mb-2">
                      <button
                        onClick={() => switchPickerTab('gif')}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest transition-all",
                          pickerTab === 'gif'
                            ? "text-white bg-neon-purple/20 border border-neon-purple/35 mac-picker-chip-active"
                            : "text-[#949BA4] hover:text-white hover:bg-white/[0.04]"
                        )}
                      >
                        GIF
                      </button>
                      <button
                        onClick={() => switchPickerTab('sticker')}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest transition-all",
                          pickerTab === 'sticker'
                            ? "text-white bg-neon-pink/20 border border-neon-pink/35 mac-picker-chip-active"
                            : "text-[#949BA4] hover:text-white hover:bg-white/[0.04]"
                        )}
                      >
                        Stickers
                      </button>
                      <button
                        onClick={() => switchPickerTab('emoji')}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest transition-all",
                          pickerTab === 'emoji'
                            ? "text-white bg-neon-green/20 border border-neon-green/35 mac-picker-chip-active"
                            : "text-[#949BA4] hover:text-white hover:bg-white/[0.04]"
                        )}
                      >
                        Emojis
                      </button>
                      <button
                        onClick={() => closePickers()}
                        className="ml-auto w-9 h-9 md:w-8 md:h-8 rounded-lg bg-white/[0.03] border border-white/10 text-white/70 hover:text-white hover:bg-white/[0.08] transition-colors flex items-center justify-center"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <input
                      value={pickerQuery}
                      onChange={(e) => setPickerQuery(e.target.value)}
                      placeholder={
                        pickerTab === 'gif'
                          ? 'Buscar GIF...'
                          : pickerTab === 'sticker'
                            ? pickerStickerServerFilter === 'all'
                              ? 'Buscar sticker...'
                              : `Buscar en ${pickerSelectedStickerServer?.name || 'servidor'}...`
                            : 'Buscar emoji...'
                      }
                      className="w-full h-10 rounded-xl bg-black/35 border border-white/10 text-white placeholder-[#686f78] px-3 text-sm outline-none focus:border-neon-blue/35 transition-colors"
                    />
                  </div>

                  <div className={cn(
                    "p-3 overflow-y-auto custom-scrollbar",
                    isCompactViewport ? "flex-1 min-h-0" : "max-h-[360px]"
                  )}>
                    <div key={`${pickerTab}-${pickerMotionSeed}`} className="mac-picker-tab-enter">
                      {pickerTab !== 'emoji' ? (
                        <div className="mb-2 px-1 flex items-center justify-between gap-2">
                          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#949BA4]">
                            {pickerTab === 'sticker' && pickerStickerServerFilter !== 'all'
                              ? `Servidor: ${pickerSelectedStickerServer?.name || 'pack'}`
                              : pickerRemoteLoading
                                ? 'Buscando...'
                                : 'Media'}
                          </div>
                          <div
                            className={cn(
                              "text-[9px] font-black uppercase tracking-widest",
                              pickerRemoteError
                                ? "text-neon-pink"
                                : giphyEnabled === false || (pickerTab === 'sticker' && pickerStickerServerFilter !== 'all')
                                  ? "text-[#8a9097]"
                                  : "text-neon-green"
                            )}
                          >
                            {pickerTab === 'sticker' && pickerStickerServerFilter !== 'all'
                              ? 'Pack servidor'
                              : pickerRemoteError
                                ? 'Fallback local'
                                : giphyEnabled === false
                                  ? 'Local'
                                  : pickerRemoteProvider === 'tenor'
                                    ? 'TENOR Live'
                                    : 'GIPHY Live'}
                          </div>
                        </div>
                      ) : null}
                      {pickerTab === 'gif' ? (
                        <div className="space-y-2">
                          {normalizedPickerQuery.length === 0 ? (
                            <div className="rounded-xl border border-white/10 bg-black/20 p-2">
                              <div className="px-1 pb-2 text-[10px] font-black uppercase tracking-[0.2em] text-[#8f96a0]">
                                Categorias
                              </div>
                              {visibleGifCategories.length === 0 ? (
                                <div className="px-2 py-5 text-center text-xs text-[#7e8792]">Sin categorias disponibles.</div>
                              ) : (
                                <div className="max-h-[180px] overflow-y-auto pr-1 custom-scrollbar">
                                  <div className="grid grid-cols-2 gap-2">
                                    {visibleGifCategories.map((category) => (
                                      <button
                                        key={category.id}
                                        onClick={() => setPickerQuery(category.query)}
                                        className="group relative h-20 rounded-xl overflow-hidden border border-white/10 hover:border-neon-purple/40 transition-all text-left"
                                      >
                                        <img src={category.preview} alt={category.label} className="absolute inset-0 w-full h-full object-cover opacity-65 group-hover:scale-[1.04] transition-transform duration-300" />
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent" />
                                        <div className="absolute inset-x-2 bottom-2 text-white text-xs font-black uppercase tracking-wider truncate">
                                          {category.label}
                                        </div>
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : null}
                          {visibleGifLibrary.length === 0 ? (
                            <div className="text-xs text-[#949BA4] px-1 py-6 text-center">Sin resultados para GIF.</div>
                          ) : (
                            <div className="grid grid-cols-2 gap-2">
                              {visibleGifLibrary.map((gif) => (
                                <button
                                  key={gif.id}
                                  onClick={() => addGif(gif)}
                                  className="group rounded-xl overflow-hidden border border-white/10 hover:border-neon-purple/45 transition-all bg-black/20 text-left"
                                >
                                  <img src={gif.url} alt={gif.filename} className="w-full h-24 object-cover group-hover:scale-[1.03] transition-transform" />
                                  <div className="px-2 py-1.5 text-[10px] font-black uppercase tracking-widest text-[#CFD4DA] truncate">{gif.title}</div>
                                </button>
                              ))}
                            </div>
                          )}
                          {remoteMatchesCurrent && giphyEnabled !== false && pickerRemoteNext ? (
                            <button
                              onClick={() => void loadMoreRemoteMedia()}
                              disabled={pickerRemoteLoading}
                              className={cn(
                                "w-full h-9 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all",
                                pickerRemoteLoading
                                  ? "bg-white/[0.03] border-white/10 text-[#7f8790] cursor-not-allowed"
                                  : "bg-neon-purple/12 border-neon-purple/35 text-[#e7ddff] hover:bg-neon-purple/20"
                              )}
                            >
                              {pickerRemoteLoading ? 'Cargando...' : 'Cargar mas GIFs'}
                            </button>
                          ) : null}
                        </div>
                      ) : null}

                      {pickerTab === 'sticker' ? (
                        <div className="flex gap-2 min-h-[220px]">
                          <div className="w-12 flex-shrink-0 rounded-xl border border-white/10 bg-black/25 p-1.5 overflow-y-auto custom-scrollbar max-h-[calc(100dvh-22rem)] md:max-h-[278px] space-y-1.5">
                            <button
                              onClick={() => setPickerStickerServerFilter('all')}
                              title="Todos los stickers"
                              className={cn(
                                "w-9 h-9 rounded-lg border transition-all flex items-center justify-center",
                                pickerStickerServerFilter === 'all'
                                  ? "border-neon-pink/50 bg-neon-pink/16 text-white"
                                  : "border-white/10 bg-white/[0.03] text-[#aab1bb] hover:text-white hover:border-neon-pink/35"
                              )}
                            >
                              <Sticker size={14} />
                            </button>
                            {stickerServerSources.map((source) => (
                              <button
                                key={source.id}
                                onClick={() => setPickerStickerServerFilter(source.id)}
                                title={`${source.name} (${source.count})`}
                                className={cn(
                                  "w-9 h-9 rounded-lg border overflow-hidden transition-all",
                                  pickerStickerServerFilter === source.id
                                    ? "border-neon-pink/50 shadow-[0_0_18px_rgba(255,52,122,0.28)]"
                                    : "border-white/10 hover:border-neon-pink/35"
                                )}
                              >
                                {source.icon ? (
                                  <img src={source.icon} alt={source.name} className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full bg-white/[0.04] text-white/80 text-xs font-black uppercase flex items-center justify-center">
                                    {source.name.slice(0, 2)}
                                  </div>
                                )}
                              </button>
                            ))}
                          </div>
                          <div className="flex-1 min-w-0 space-y-2">
                            {visibleStickerLibrary.length === 0 ? (
                              <div className="text-xs text-[#949BA4] px-1 py-6 text-center">
                                {pickerStickerServerFilter === 'all'
                                  ? 'Sin resultados para stickers.'
                                  : `Sin stickers en ${pickerSelectedStickerServer?.name || 'este servidor'}.`}
                              </div>
                            ) : (
                              <div className="grid grid-cols-3 gap-2">
                                {visibleStickerLibrary.map((sticker) => (
                                  <button
                                    key={sticker.id}
                                    onClick={() => addSticker(sticker)}
                                    className="group aspect-square rounded-xl overflow-hidden border border-white/10 hover:border-neon-pink/45 transition-all bg-black/20"
                                  >
                                    <img src={sticker.url} alt={sticker.filename} className="w-full h-full object-cover group-hover:scale-[1.04] transition-transform" />
                                  </button>
                                ))}
                              </div>
                            )}
                            {pickerStickerServerFilter === 'all' && remoteMatchesCurrent && giphyEnabled !== false && pickerRemoteNext ? (
                              <button
                                onClick={() => void loadMoreRemoteMedia()}
                                disabled={pickerRemoteLoading}
                                className={cn(
                                  "w-full h-9 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all",
                                  pickerRemoteLoading
                                    ? "bg-white/[0.03] border-white/10 text-[#7f8790] cursor-not-allowed"
                                    : "bg-neon-pink/12 border-neon-pink/35 text-[#ffdfe8] hover:bg-neon-pink/20"
                                )}
                              >
                                {pickerRemoteLoading ? 'Cargando...' : 'Cargar mas stickers'}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ) : null}

                      {pickerTab === 'emoji' ? (
                        <>
                          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#949BA4] mb-2">Frecuentes</div>
                          <div className="grid grid-cols-6 sm:grid-cols-8 gap-1.5 mb-3">
                            {QUICK_EMOJIS.map((emoji) => (
                              <button
                                key={emoji}
                                onClick={() => appendEmoji(emoji)}
                                className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-white/[0.03] border border-white/10 hover:border-neon-green/50 hover:bg-neon-green/10 transition-all text-lg sm:text-xl flex items-center justify-center hover:scale-110"
                              >
                                <span className="inline-block float-slow">{emoji}</span>
                              </button>
                            ))}
                          </div>
                          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#949BA4] mb-2">Biblioteca</div>
                          {filteredEmojiLibrary.length === 0 ? (
                            <div className="text-xs text-[#949BA4] px-1 py-3">Sin resultados para emojis.</div>
                          ) : (
                            <div className="space-y-3 mb-3">
                              {filteredEmojiByCategory.map((section) => (
                                <div key={section.category}>
                                  <div className="text-[9px] font-black uppercase tracking-[0.22em] text-[#7f8790] mb-1.5">
                                    {section.label}
                                  </div>
                                  <div className="grid grid-cols-6 sm:grid-cols-8 gap-1.5">
                                    {section.items.map((item) => (
                                      <button
                                        key={`${item.emoji}-${item.title}`}
                                        onClick={() => appendEmoji(item.emoji)}
                                        title={item.title}
                                        className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-white/[0.03] border border-white/10 hover:border-neon-green/50 hover:bg-neon-green/10 transition-all text-lg sm:text-xl flex items-center justify-center hover:scale-110"
                                      >
                                        <span className="inline-block float-slow">{item.emoji}</span>
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          {filteredCustomEmojis.length > 0 ? (
                            <>
                              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#949BA4] mb-2">Servidor</div>
                              <div className="grid grid-cols-6 sm:grid-cols-8 gap-1.5">
                                {filteredCustomEmojis.slice(0, 40).map((emoji, idx) => (
                                  <button
                                    key={emoji.id}
                                    onClick={() => appendCustomEmoji(emoji)}
                                    className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-white/[0.03] border border-white/10 hover:border-neon-blue/45 transition-all overflow-hidden"
                                    title={`:${emoji.name}:`}
                                  >
                                    <img
                                      src={emoji.url}
                                      alt={emoji.name}
                                      className={cn("w-full h-full object-cover", emoji.animated && "float-slow")}
                                      style={emoji.animated ? { animationDelay: `${idx * 55}ms` } : undefined}
                                    />
                                  </button>
                                ))}
                              </div>
                            </>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </>,
            document.body
          )
          : null}

        {moderationDialog.open && typeof document !== 'undefined'
          ? createPortal(
            <div className="fixed inset-0 z-[620] flex items-center justify-center p-4 sm:p-8">
              <button
                type="button"
                onClick={closeModerationDialog}
                className="absolute inset-0 bg-black/70 backdrop-blur-md"
                aria-label="Cerrar moderacion"
              />
              <div className="relative w-full max-w-[560px] rounded-[28px] border border-neon-pink/25 bg-[#0A0A0B]/92 glass-ruby-shell backdrop-blur-2xl shadow-[0_24px_80px_rgba(0,0,0,0.55)] overflow-hidden">
                <div className="px-5 py-4 border-b border-white/10 bg-white/[0.02]">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl border border-neon-pink/35 bg-neon-pink/10 flex items-center justify-center text-neon-pink">
                      <Cpu size={17} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-black uppercase tracking-[0.24em] text-[#8b9198]">Moderacion</div>
                      <h3 className="text-white font-black text-xl tracking-tight">{moderationMeta.title}</h3>
                      <p className="text-[#a0a7af] text-sm mt-1">{moderationMeta.subtitle}</p>
                    </div>
                    <button
                      type="button"
                      onClick={closeModerationDialog}
                      className="w-9 h-9 rounded-lg border border-white/10 bg-white/[0.03] text-white/70 hover:text-white hover:bg-white/[0.08] transition-colors flex items-center justify-center"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>

                <div className="px-5 py-4 space-y-4">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#8b9198] mb-1.5">Buscar usuario</div>
                    <input
                      value={moderationDialog.query}
                      onChange={(e) => {
                        const value = e.target.value;
                        setModerationDialog((prev) => ({ ...prev, query: value }));
                        setModerationError(null);
                      }}
                      placeholder={
                        moderationDialog.action === 'unban'
                          ? 'Buscar en baneados...'
                          : 'Buscar por nombre o @usuario...'
                      }
                      className="w-full h-11 rounded-xl bg-black/35 border border-white/10 text-white placeholder-[#69717a] px-3 text-sm outline-none focus:border-neon-blue/35 transition-colors"
                    />
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-black/25 p-2.5 max-h-[220px] overflow-y-auto custom-scrollbar space-y-1.5">
                    {filteredModerationCandidates.length === 0 ? (
                      <div className="text-xs text-[#8b9198] text-center py-8">No se encontraron usuarios para esta accion.</div>
                    ) : (
                      filteredModerationCandidates.slice(0, 80).map((candidate) => {
                        const selected = candidate.id === moderationDialog.selectedUserId;
                        return (
                          <button
                            key={candidate.id}
                            type="button"
                            onClick={() =>
                              setModerationDialog((prev) => ({
                                ...prev,
                                selectedUserId: candidate.id,
                                query: candidate.username,
                              }))
                            }
                            className={cn(
                              "w-full flex items-center gap-3 px-2.5 py-2 rounded-xl border text-left transition-all",
                              selected
                                ? "border-neon-blue/40 bg-neon-blue/12"
                                : "border-white/10 bg-white/[0.02] hover:bg-white/[0.05]"
                            )}
                          >
                            <div className="relative">
                              <div className="w-9 h-9 rounded-lg bg-white/[0.04] border border-white/10 overflow-hidden">
                                {candidate.avatar ? (
                                  <img src={candidate.avatar} alt={candidate.username} className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-sm font-black text-white">
                                    {candidate.username[0]?.toUpperCase() || '?'}
                                  </div>
                                )}
                              </div>
                              <div
                                className={cn(
                                  "absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-[#0A0A0B]",
                                  candidate.status === 'online'
                                    ? 'bg-neon-green'
                                    : candidate.status === 'idle'
                                      ? 'bg-[#f5b75b]'
                                      : candidate.status === 'dnd'
                                        ? 'bg-neon-pink'
                                        : 'bg-[#5f6770]'
                                )}
                              />
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-black text-white truncate">{candidate.username}</div>
                              <div className="text-[10px] font-black uppercase tracking-widest text-[#8b9198] truncate">
                                {candidate.subtitle}
                              </div>
                            </div>
                            {selected ? <Check size={14} className="ml-auto text-neon-green" /> : null}
                          </button>
                        );
                      })
                    )}
                  </div>

                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#8b9198] mb-1.5">
                      {moderationDurationLabel}
                    </div>
                    {canSelectDuration ? (
                      <div className="space-y-2">
                        <div className="grid grid-cols-4 gap-2">
                          {[5, 15, 60, 1440].map((value) => (
                            <button
                              key={value}
                              type="button"
                              onClick={() => setModerationDialog((prev) => ({ ...prev, durationMinutes: value }))}
                              className={cn(
                                "h-9 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all",
                                moderationDialog.durationMinutes === value
                                  ? "bg-neon-blue/16 border-neon-blue/40 text-neon-blue"
                                  : "bg-white/[0.03] border-white/10 text-[#c9d0d8] hover:bg-white/[0.06]"
                              )}
                            >
                              {value >= 60 ? `${Math.round(value / 60)}h` : `${value}m`}
                            </button>
                          ))}
                        </div>
                        <input
                          type="number"
                          min={1}
                          max={10080}
                          value={moderationDialog.durationMinutes}
                          onChange={(e) =>
                            setModerationDialog((prev) => ({
                              ...prev,
                              durationMinutes: Math.max(1, Math.min(10080, Number(e.target.value) || 1)),
                            }))
                          }
                          className="w-full h-10 rounded-xl bg-black/35 border border-white/10 text-white placeholder-[#69717a] px-3 text-sm outline-none focus:border-neon-blue/35 transition-colors"
                        />
                      </div>
                    ) : (
                      <div className="h-10 rounded-xl border border-white/10 bg-white/[0.03] px-3 flex items-center text-xs font-black uppercase tracking-widest text-[#8b9198]">
                        {moderationDialog.action === 'kick'
                          ? 'Instantaneo'
                          : moderationDialog.action === 'ban'
                            ? 'Permanente'
                            : 'No aplica'}
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#8b9198] mb-1.5">Motivo</div>
                    <textarea
                      value={moderationDialog.reason}
                      onChange={(e) => setModerationDialog((prev) => ({ ...prev, reason: e.target.value }))}
                      rows={3}
                      placeholder="Escribe un motivo opcional..."
                      className="w-full rounded-xl bg-black/35 border border-white/10 text-white placeholder-[#69717a] px-3 py-2.5 text-sm outline-none focus:border-neon-blue/35 transition-colors resize-none"
                    />
                  </div>

                  {moderationSelectedUser ? (
                    <div className="text-[10px] font-black uppercase tracking-widest text-[#8b9198]">
                      Objetivo: <span className="text-white">{moderationSelectedUser.username}</span>
                    </div>
                  ) : null}
                  {moderationError ? (
                    <div className="text-[11px] font-black text-neon-pink uppercase tracking-widest">{moderationError}</div>
                  ) : null}
                </div>

                <div className="px-5 py-4 border-t border-white/10 bg-white/[0.02] flex justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={closeModerationDialog}
                    disabled={moderationSaving}
                    className="h-10 px-4 rounded-xl border border-white/10 bg-white/[0.03] text-[#d0d6dd] text-[11px] font-black uppercase tracking-widest hover:bg-white/[0.06] transition-all disabled:opacity-60"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={applyModerationDialog}
                    disabled={moderationSaving || !moderationDialog.selectedUserId}
                    className={cn(
                      "h-10 px-4 rounded-xl border text-[11px] font-black uppercase tracking-widest transition-all",
                      moderationDialog.action === 'unban' || moderationDialog.action === 'untimeout'
                        ? "bg-neon-green/15 border-neon-green/45 text-neon-green hover:bg-neon-green/24"
                        : "bg-neon-pink/15 border-neon-pink/45 text-neon-pink hover:bg-neon-pink/24",
                      (moderationSaving || !moderationDialog.selectedUserId) && "opacity-60 cursor-not-allowed"
                    )}
                  >
                    {moderationSaving ? 'Aplicando...' : moderationMeta.confirm}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
          : null}
      </div>
    </>
  );
};
