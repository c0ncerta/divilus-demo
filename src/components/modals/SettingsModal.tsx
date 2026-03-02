import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useStore } from '../../lib/store';
import { X, Upload, Trash2, Plus, LogOut, Camera, Palette, Puzzle, Shield, Bell, Link2, Laptop, Users, Key, CreditCard, Sparkles, Search, Copy, Star, Mic, RefreshCw, Play, ChevronDown, MoreVertical, UserMinus, Ban, Clock3, ArrowUpDown, Menu } from 'lucide-react';
import { cn } from '../../lib/utils';
import { t } from '../../lib/i18n';
import type { Permission, RoleNameEffect, ServerSticker, UserStatus } from '../../lib/types';
import { hasPermission } from '../../lib/permissions';
import { ImageCropModal } from './ImageCropModal';
import { NitroEmblems } from '../ui/NitroEmblems';
import { ModalBase } from '../ui/ModalBase';
import { isBackendEnabled } from '../../lib/env';
import { mapBackendUser } from '../../lib/backend-user';
import { authProvider } from '../../lib/providers/auth-provider';
import { SERVER_COMMANDS } from '../../lib/server-commands';
import {
  CREW_AURA_OPTIONS,
  CREW_CUSTOM_EMBLEM_ID,
  CREW_EMBLEM_OPTIONS,
  CREW_MAX_CUSTOM_EMBLEM_FILE_BYTES,
  createDefaultCrewIdentity,
  getCrewPreset,
  isCrewCustomEmblemGif,
  normalizeCrewCustomEmblemUrl,
  normalizeCrewName,
  normalizeCrewTag,
  readCrewIdentity,
  writeCrewIdentity,
  type CrewAura,
} from '../../lib/crew-emblems';
import { uploadFileToBackend } from '../../lib/media-upload';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?:
    | 'profile'
    | 'server'
    | 'servers'
    | 'plugins'
    | 'languages'
    | 'content_social'
    | 'privacy'
    | 'devices'
    | 'developer'
    | 'notifications'
    | 'voice_video';
}

type CustomServerEmoji = {
  id: string;
  name: string;
  url: string;
  animated: boolean;
};

type PendingCrop = {
  target: 'profile_avatar' | 'profile_banner' | 'server_icon' | 'server_banner';
  src: string;
  title: string;
  aspect: number;
  shape: 'circle' | 'rounded';
  outputWidth: number;
  outputHeight: number;
};

type ServerInteractionSettings = {
  systemWelcomeRandom: boolean;
  systemStickerReply: boolean;
  systemBoostNotice: boolean;
  systemTips: boolean;
  activitiesVisible: boolean;
  defaultNotificationMode: 'all' | 'mentions';
  systemChannelId: string;
  idleChannelId: string;
  idleTimeoutMinutes: number;
  widgetEnabled: boolean;
};

type SecurityVerificationLevel = 'low' | 'medium' | 'high' | 'very_high';

type ServerSecurityPanel = 'overview' | 'anti_raid' | 'dm_spam' | 'automod' | 'permissions';

type AutoModRuleEditor = 'none' | 'profile_names' | 'suspected_spam' | 'frequent_words' | 'custom_words';

type ServerSecuritySettings = {
  antiRaid: {
    activityAlerts: boolean;
    captchaSuspicious: boolean;
    captchaAttackMode: boolean;
  };
  dmSpam: {
    verificationLevel: SecurityVerificationLevel;
    hideSuspiciousDMs: boolean;
    filterUnknownDMs: boolean;
    warnExternalLinks: boolean;
    autoDeleteSpam: boolean;
  };
  automod: {
    blockProfileWords: boolean;
    blockMentionSpam: boolean;
    blockSuspectedSpam: boolean;
    blockFrequentWords: boolean;
    blockCustomWords: boolean;
    sensitiveMediaFilter: 'all' | 'members' | 'off';

    profileRuleEnabled: boolean;
    profileRuleTerms: string;
    profileRuleRegex: boolean;
    profileRuleAllowList: string;
    profileRuleBlockInteractions: boolean;
    profileRuleSendAlert: boolean;
    profileRuleAllowRoles: string;

    suspectedRuleEnabled: boolean;
    suspectedRuleBlockMessage: boolean;
    suspectedRuleSendAlert: boolean;
    suspectedRuleAllowBypass: string;

    frequentRuleEnabled: boolean;
    frequentRuleProfanity: boolean;
    frequentRuleInsults: boolean;
    frequentRuleSexual: boolean;
    frequentRuleAllowList: string;
    frequentRuleBlockMessage: boolean;
    frequentRuleSendAlert: boolean;
    frequentRuleAllowBypass: string;

    customRuleEnabled: boolean;
    customRuleTerms: string;
    customRuleAllowList: string;
    customRuleBlockMessage: boolean;
    customRuleSendAlert: boolean;
    customRuleTempMute: boolean;
    customRuleAllowBypass: string;
  };
  permissions: {
    require2FA: boolean;
    disableRiskyEveryone: boolean;
  };
};

const CUSTOM_EMOJIS_STORAGE_KEY = 'diavlocord-custom-emojis';
const DATA_REQUEST_STORAGE_KEY = 'diavlocord-data-request-at';
const DATA_REQUEST_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const SERVER_TAG_PROFILE_STORAGE_KEY = 'diavlocord-server-tag-profile-v1';
const SERVER_INTERACTIONS_STORAGE_KEY = 'diavlocord-server-interactions-v1';
const SERVER_SECURITY_STORAGE_KEY = 'diavlocord-server-security-v1';
const MAX_PROFILE_ANIMATED_GIF_BYTES = 10 * 1024 * 1024;
const MAX_SERVER_ANIMATED_GIF_BYTES = 10 * 1024 * 1024;
const MAX_SERVER_STICKER_BYTES = 10 * 1024 * 1024;
const MAX_SERVER_STICKERS = 80;
const MAX_LOCAL_STICKER_DATA_BYTES = 4 * 1024 * 1024;

const isGifFile = (file: File) =>
  file.type.toLowerCase() === 'image/gif' || file.name.toLowerCase().endsWith('.gif');

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('read_failed'));
    reader.readAsDataURL(file);
  });

type ServerTagBadgeOption = {
  id: string;
  glyph: string;
  label: string;
  tier: 'core' | 'extra';
};

const SERVER_TAG_BADGE_OPTIONS: ServerTagBadgeOption[] = [
  { id: 'leaf', glyph: '\u{1F343}', label: 'Leaf', tier: 'core' },
  { id: 'swords', glyph: '\u2694\uFE0F', label: 'Swords', tier: 'core' },
  { id: 'heart', glyph: '\u{1F497}', label: 'Heart', tier: 'core' },
  { id: 'fire', glyph: '\u{1F525}', label: 'Flame', tier: 'core' },
  { id: 'water', glyph: '\u{1F4A7}', label: 'Water', tier: 'core' },
  { id: 'skull', glyph: '\u{1F480}', label: 'Skull', tier: 'core' },
  { id: 'moon', glyph: '\u{1F319}', label: 'Moon', tier: 'core' },
  { id: 'bolt', glyph: '\u26A1', label: 'Bolt', tier: 'core' },
  { id: 'spark', glyph: '\u2728', label: 'Spark', tier: 'core' },
  { id: 'mushroom', glyph: '\u{1F344}', label: 'Mushroom', tier: 'core' },
  { id: 'crown', glyph: '\u{1F451}', label: 'Crown', tier: 'extra' },
  { id: 'gem', glyph: '\u{1F48E}', label: 'Gem', tier: 'extra' },
  { id: 'shield', glyph: '\u{1F6E1}\uFE0F', label: 'Shield', tier: 'extra' },
  { id: 'star', glyph: '\u2B50', label: 'Star', tier: 'extra' },
  { id: 'rocket', glyph: '\u{1F680}', label: 'Rocket', tier: 'extra' },
];

const SERVER_TAG_COLOR_OPTIONS = [
  '#F38CC7',
  '#F3B46F',
  '#EACA54',
  '#89D39E',
  '#92D2E8',
  '#AE8FF7',
  '#B39AF3',
  '#D39AF3',
  '#F9A8A8',
  '#DDB683',
  '#C6C994',
  '#BFA4BE',
  '#D0D4DA',
  '#A0DA68',
  '#7A1027',
];

const normalizeServerTagLabel = (value: string) =>
  value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);

const toTimeMs = (value?: string | null) => {
  if (!value) return 0;
  const ts = new Date(value).getTime();
  return Number.isNaN(ts) ? 0 : ts;
};

const formatRelativeAgo = (value?: string | null) => {
  const ts = toTimeMs(value);
  if (!ts) return 'Desconocido';
  const diffMs = Date.now() - ts;
  const minutes = Math.floor(diffMs / (1000 * 60));
  if (minutes < 1) return 'Ahora';
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `Hace ${days} dia${days === 1 ? '' : 's'}`;
  const months = Math.floor(days / 30);
  if (months < 12) return `Hace ${months} mes${months === 1 ? '' : 'es'}`;
  const years = Math.floor(days / 365);
  return `Hace ${years} ano${years === 1 ? '' : 's'}`;
};

const createDefaultServerSecuritySettings = (): ServerSecuritySettings => ({
  antiRaid: {
    activityAlerts: true,
    captchaSuspicious: false,
    captchaAttackMode: false,
  },
  dmSpam: {
    verificationLevel: 'low',
    hideSuspiciousDMs: false,
    filterUnknownDMs: false,
    warnExternalLinks: false,
    autoDeleteSpam: false,
  },
  automod: {
    blockProfileWords: false,
    blockMentionSpam: true,
    blockSuspectedSpam: true,
    blockFrequentWords: false,
    blockCustomWords: false,
    sensitiveMediaFilter: 'members',

    profileRuleEnabled: false,
    profileRuleTerms: '',
    profileRuleRegex: false,
    profileRuleAllowList: '',
    profileRuleBlockInteractions: true,
    profileRuleSendAlert: false,
    profileRuleAllowRoles: '',

    suspectedRuleEnabled: true,
    suspectedRuleBlockMessage: true,
    suspectedRuleSendAlert: false,
    suspectedRuleAllowBypass: '',

    frequentRuleEnabled: false,
    frequentRuleProfanity: true,
    frequentRuleInsults: true,
    frequentRuleSexual: true,
    frequentRuleAllowList: '',
    frequentRuleBlockMessage: true,
    frequentRuleSendAlert: false,
    frequentRuleAllowBypass: '',

    customRuleEnabled: false,
    customRuleTerms: '',
    customRuleAllowList: '',
    customRuleBlockMessage: true,
    customRuleSendAlert: false,
    customRuleTempMute: false,
    customRuleAllowBypass: '',
  },
  permissions: {
    require2FA: false,
    disableRiskyEveryone: true,
  },
});

const SERVER_EMOJI_LIBRARY: Array<{ emoji: string; name: string; tone: 'hot' | 'cool' | 'fun' | 'hype' }> = [
  { emoji: '\u{1F525}', name: 'fire', tone: 'hot' },
  { emoji: '\u{26A1}', name: 'zap', tone: 'hype' },
  { emoji: '\u{1F680}', name: 'rocket', tone: 'hype' },
  { emoji: '\u{1F480}', name: 'skull', tone: 'fun' },
  { emoji: '\u{1F608}', name: 'devil', tone: 'fun' },
  { emoji: '\u{1F916}', name: 'bot', tone: 'cool' },
  { emoji: '\u{1F9E0}', name: 'brain', tone: 'cool' },
  { emoji: '\u{1F9EA}', name: 'lab', tone: 'cool' },
  { emoji: '\u{1F48E}', name: 'gem', tone: 'hype' },
  { emoji: '\u{1F3AF}', name: 'target', tone: 'hype' },
  { emoji: '\u{1F4AF}', name: 'hundred', tone: 'hot' },
  { emoji: '\u{1F60E}', name: 'cool', tone: 'fun' },
  { emoji: '\u{1F602}', name: 'laugh', tone: 'fun' },
  { emoji: '\u{1F976}', name: 'cold', tone: 'cool' },
  { emoji: '\u{2728}', name: 'sparkle', tone: 'hype' },
  { emoji: '\u{1FAE1}', name: 'salute', tone: 'hot' },
  { emoji: '\u{1F389}', name: 'party', tone: 'fun' },
  { emoji: '\u{1F973}', name: 'celebrate', tone: 'fun' },
  { emoji: '\u{1F44D}', name: 'thumbs_up', tone: 'hot' },
  { emoji: '\u{1F44E}', name: 'thumbs_down', tone: 'cool' },
  { emoji: '\u{1F91F}', name: 'love_sign', tone: 'hype' },
  { emoji: '\u{1FA77}', name: 'pink_heart', tone: 'hype' },
  { emoji: '\u{1F49A}', name: 'green_heart', tone: 'cool' },
  { emoji: '\u{1F499}', name: 'blue_heart', tone: 'cool' },
  { emoji: '\u{1F31F}', name: 'glowing_star', tone: 'hype' },
  { emoji: '\u{1F31A}', name: 'moon', tone: 'cool' },
  { emoji: '\u{1F30A}', name: 'ocean', tone: 'cool' },
  { emoji: '\u{1F4A5}', name: 'boom', tone: 'hot' },
  { emoji: '\u{1F44A}', name: 'punch', tone: 'hot' },
  { emoji: '\u{1F60F}', name: 'smirk', tone: 'fun' },
  { emoji: '\u{1F914}', name: 'thinking', tone: 'cool' },
  { emoji: '\u{1F62D}', name: 'cry', tone: 'fun' },
  { emoji: '\u{1F923}', name: 'rofl', tone: 'fun' },
  { emoji: '\u{1F47B}', name: 'ghost', tone: 'fun' },
  { emoji: '\u{1F63C}', name: 'cat_eyes', tone: 'fun' },
  { emoji: '\u{1F47E}', name: 'alien', tone: 'cool' },
  { emoji: '\u{1F4A1}', name: 'idea', tone: 'hype' },
  { emoji: '\u{1F4BB}', name: 'laptop', tone: 'cool' },
  { emoji: '\u{1F4F8}', name: 'camera', tone: 'cool' },
  { emoji: '\u{1F3A7}', name: 'headphones', tone: 'cool' },
  { emoji: '\u{1F3B6}', name: 'notes', tone: 'hype' },
  { emoji: '\u{1F3AE}', name: 'controller', tone: 'fun' },
  { emoji: '\u{1F3C6}', name: 'trophy', tone: 'hot' },
  { emoji: '\u{1F3C1}', name: 'finish', tone: 'hype' },
  { emoji: '\u{2705}', name: 'check', tone: 'hot' },
  { emoji: '\u{274C}', name: 'cross', tone: 'hot' },
  { emoji: '\u{1F6E1}', name: 'shield', tone: 'cool' },
  { emoji: '\u{1F512}', name: 'lock', tone: 'cool' },
  { emoji: '\u{1F601}', name: 'beaming', tone: 'fun' },
  { emoji: '\u{1F606}', name: 'squint_laugh', tone: 'fun' },
  { emoji: '\u{1F920}', name: 'cowboy', tone: 'fun' },
  { emoji: '\u{1F975}', name: 'hot_face', tone: 'hot' },
  { emoji: '\u{1F4AA}', name: 'muscle', tone: 'hot' },
  { emoji: '\u{1F919}', name: 'call_me', tone: 'fun' },
  { emoji: '\u{1F494}', name: 'broken_heart', tone: 'hot' },
  { emoji: '\u{1F9E1}', name: 'orange_heart', tone: 'hype' },
  { emoji: '\u{1F363}', name: 'sushi', tone: 'fun' },
  { emoji: '\u{1F366}', name: 'ice_cream', tone: 'cool' },
  { emoji: '\u{1F36B}', name: 'chocolate', tone: 'fun' },
  { emoji: '\u{1F338}', name: 'cherry_blossom', tone: 'hype' },
  { emoji: '\u{1F334}', name: 'palm_tree', tone: 'cool' },
  { emoji: '\u{1F427}', name: 'penguin', tone: 'cool' },
  { emoji: '\u{1F43C}', name: 'panda', tone: 'fun' },
  { emoji: '\u{1F988}', name: 'shark', tone: 'cool' },
  { emoji: '\u{1F3C0}', name: 'basketball', tone: 'hype' },
  { emoji: '\u{26BD}', name: 'soccer', tone: 'hype' },
  { emoji: '\u{1F37A}', name: 'beer', tone: 'fun' },
  { emoji: '\u{1F192}', name: 'cool_button', tone: 'hype' },
  { emoji: '\u{1F7E2}', name: 'green_circle', tone: 'cool' },
  { emoji: '\u{1F534}', name: 'red_circle', tone: 'hot' },
];

type GlassSelectOption = {
  value: string;
  label: string;
};

type GlassSelectProps = {
  value: string;
  options: GlassSelectOption[];
  placeholder: string;
  onChange: (nextValue: string) => void;
  emptyMessage?: string;
  disabled?: boolean;
};

const GlassSelect = ({
  value,
  options,
  placeholder,
  onChange,
  emptyMessage = 'Sin opciones disponibles',
  disabled = false,
}: GlassSelectProps) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value) || null;

  useEffect(() => {
    if (!open) return;
    const onDocDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!rootRef.current || !target) return;
      if (!rootRef.current.contains(target)) {
        setOpen(false);
      }
    };
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  useEffect(() => {
    if (disabled && open) {
      setOpen(false);
    }
  }, [disabled, open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => {
          if (disabled) return;
          setOpen((prev) => !prev);
        }}
        disabled={disabled}
        className={cn(
          "w-full h-11 rounded-xl px-3 py-2 text-left transition-all inline-flex items-center gap-2",
          "bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02))] border border-white/15 text-white",
          "shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_12px_24px_rgba(0,0,0,0.28)] backdrop-blur-xl",
          disabled
            ? "opacity-60 cursor-not-allowed"
            : "hover:bg-[linear-gradient(180deg,rgba(255,255,255,0.12),rgba(255,255,255,0.03))] hover:border-[#7A1027]/45 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_0_0_1px_rgba(122,16,39,0.25),0_16px_34px_rgba(0,0,0,0.34)] focus:outline-none focus-visible:border-[#7A1027]/65"
        )}
      >
        <span className={cn("truncate text-sm font-semibold", selected ? "text-white" : "text-[#949BA4]")}>
          {selected?.label || placeholder}
        </span>
        <ChevronDown
          size={17}
          className={cn(
            "ml-auto text-white/70 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
            open && "rotate-180"
          )}
        />
      </button>

      {open ? (
        <div
          className={cn(
            "absolute left-0 right-0 top-[calc(100%+8px)] z-[760] p-2 max-h-56 overflow-y-auto custom-scrollbar",
            "rounded-2xl border border-white/15 bg-[linear-gradient(180deg,rgba(22,24,31,0.9),rgba(10,11,16,0.92))]",
            "backdrop-blur-2xl shadow-[0_24px_56px_rgba(0,0,0,0.58),0_0_0_1px_rgba(255,255,255,0.06),inset_0_1px_0_rgba(255,255,255,0.12)]",
            "origin-top animate-in fade-in-0 zoom-in-95 slide-in-from-top-1 duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]"
          )}
        >
          {options.length === 0 ? (
            <div className="px-3 py-2.5 text-sm text-[#949BA4]">{emptyMessage}</div>
          ) : (
            options.map((option) => {
              const active = option.value === value;
              return (
                <button
                  key={`glass-select-${option.value || 'default'}`}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onChange(option.value);
                  }}
                  className={cn(
                    "w-full rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition-all duration-200",
                    active
                      ? "bg-[linear-gradient(135deg,rgba(122,16,39,0.46),rgba(194,24,60,0.28))] border border-[#7A1027]/60 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_8px_16px_rgba(0,0,0,0.25)]"
                      : "bg-transparent border border-transparent text-[#CFD4DA] hover:bg-white/[0.08] hover:border-white/15 hover:translate-x-[1px]"
                  )}
                >
                  {option.label}
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
};
export const SettingsModal = ({ isOpen, onClose, initialTab = 'profile' }: SettingsModalProps) => {
  const {
    currentUser,
    backendToken,
    setBackendToken,
    upsertUsers,
    updateCurrentUser,
    setPresence,
    logout,
    language,
    setLanguage,
    developerMode,
    setDeveloperMode,
    notificationSettings,
    setNotificationSettings,
    contentSocial,
    setContentSocial,
    privacy,
    setPrivacy,
    mediaSettings,
    setMediaSettings,
    servers,
    users,
    serverBans,
    auditLog,
    memberTimeouts,
    timeoutMember,
    clearMemberTimeout,
    kickMember,
    banMember,
    unbanMember,
    leaveServer,
    joinServer,
    activeServerId,
    activeChannelId,
    updateServer,
    createRole,
    updateRole,
    deleteRole,
    setMemberRole,
    updateChannelRolePermission,
    updateChannelMemberPermission,
    createServerInviteLink,
    revokeServerInvite,
    deviceSessionsByUser,
    activeDeviceId,
    ensureCurrentDeviceSession,
    logoutDeviceSession,
  } = useStore();
  const [activeTab, setActiveTab] = useState<
    | 'profile'
    | 'server'
    | 'servers'
    | 'plugins'
    | 'languages'
    | 'content_social'
    | 'privacy'
    | 'devices'
    | 'developer'
    | 'notifications'
    | 'voice_video'
  >(initialTab);
  const [menuQuery, setMenuQuery] = useState('');
  const [nitroActive, setNitroActive] = useState(false);
  const [mounted, setMounted] = useState(isOpen);
  const [visible, setVisible] = useState(false);
  const [modalViewportHeight, setModalViewportHeight] = useState<number | null>(null);
  const [mobileNavVisible, setMobileNavVisible] = useState(false);
  const [serverSection, setServerSection] = useState<
    | 'overview'
    | 'profile'
    | 'tag'
    | 'interactions'
    | 'boosts'
    | 'emojis'
    | 'stickers'
    | 'soundboard'
    | 'members'
    | 'roles'
    | 'invites'
    | 'access'
    | 'integrations'
    | 'app_directory'
    | 'security'
    | 'audit_log'
    | 'bans'
    | 'community_overview'
    | 'onboarding'
    | 'server_insights'
    | 'server_template'
    | 'delete_server'
  >('profile');
  
  const [username, setUsername] = useState(currentUser.username);
  const [displayName, setDisplayName] = useState(currentUser.displayName || '');
  const [pronouns, setPronouns] = useState(currentUser.pronouns || '');
  const [bio, setBio] = useState(currentUser.bio || '');
  const [statusDraft, setStatusDraft] = useState<UserStatus>(currentUser.status || 'online');
  const [customStatusDraft, setCustomStatusDraft] = useState(currentUser.customStatus || '');
  const [bannerColor, setBannerColor] = useState(currentUser.bannerColor || '#7A1027');
  const [avatar, setAvatar] = useState(currentUser.avatar || '');
  const [banner, setBanner] = useState(currentUser.banner || '');
  const [profileBannerPreviewError, setProfileBannerPreviewError] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [profileMediaToast, setProfileMediaToast] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [crewEnabled, setCrewEnabled] = useState(false);
  const [crewEmblemId, setCrewEmblemId] = useState(CREW_EMBLEM_OPTIONS[0]?.id || 'nova');
  const [crewCustomEmblemDraft, setCrewCustomEmblemDraft] = useState('');
  const [crewNameDraft, setCrewNameDraft] = useState(createDefaultCrewIdentity().crewName);
  const [crewTagDraft, setCrewTagDraft] = useState(createDefaultCrewIdentity().crewTag);
  const [crewColorDraft, setCrewColorDraft] = useState(createDefaultCrewIdentity().color);
  const [crewAuraDraft, setCrewAuraDraft] = useState<CrewAura>(createDefaultCrewIdentity().aura);
  const [crewToast, setCrewToast] = useState('');
  const [shakeButton, setShakeButton] = useState(false);
  const [serverName, setServerName] = useState('');
  const [serverIcon, setServerIcon] = useState('');
  const [serverBanner, setServerBanner] = useState('');
  const [serverMediaToast, setServerMediaToast] = useState('');
  const [serverDescription, setServerDescription] = useState('');
  const [serverTag, setServerTag] = useState('');
  const [serverAccentColor, setServerAccentColor] = useState('#7A1027');
  const [serverHasChanges, setServerHasChanges] = useState(false);
  const [serverTagFeatureEnabled, setServerTagFeatureEnabled] = useState(true);
  const [serverTagNameDraft, setServerTagNameDraft] = useState('');
  const [serverTagBadgeId, setServerTagBadgeId] = useState(SERVER_TAG_BADGE_OPTIONS[0]?.id || 'leaf');
  const [serverTagColor, setServerTagColor] = useState(SERVER_TAG_COLOR_OPTIONS[5]);
  const [serverTagAdopted, setServerTagAdopted] = useState(false);
  const [serverTagShowAllBadges, setServerTagShowAllBadges] = useState(false);
  const [serverTagToast, setServerTagToast] = useState('');
  const [interactionSettings, setInteractionSettings] = useState<ServerInteractionSettings>({
    systemWelcomeRandom: true,
    systemStickerReply: true,
    systemBoostNotice: true,
    systemTips: false,
    activitiesVisible: true,
    defaultNotificationMode: 'mentions',
    systemChannelId: '',
    idleChannelId: '',
    idleTimeoutMinutes: 5,
    widgetEnabled: false,
  });
  const [securitySettings, setSecuritySettings] = useState<ServerSecuritySettings>(() =>
    createDefaultServerSecuritySettings()
  );
  const [securityPanel, setSecurityPanel] = useState<ServerSecurityPanel>('overview');
  const [securityRuleEditor, setSecurityRuleEditor] = useState<AutoModRuleEditor>('none');
  const [securityVerificationPickerOpen, setSecurityVerificationPickerOpen] = useState(false);
  const [securityToast, setSecurityToast] = useState('');
  const [pendingCrop, setPendingCrop] = useState<PendingCrop | null>(null);
  const [accessChannelId, setAccessChannelId] = useState<string | null>(null);
  const [accessTargetType, setAccessTargetType] = useState<'role' | 'member'>('role');
  const [accessMemberId, setAccessMemberId] = useState<string | null>(null);
  const [emojiQuery, setEmojiQuery] = useState('');
  const [emojiAnimations, setEmojiAnimations] = useState(true);
  const [favoriteServerEmojis, setFavoriteServerEmojis] = useState<string[]>([
    '\u{1F525}',
    '\u{1F680}',
    '\u{1F480}',
    '\u{2728}',
  ]);
  const [emojiToast, setEmojiToast] = useState('');
  const [inviteExpiryHours, setInviteExpiryHours] = useState<number>(24);
  const [inviteMaxUses, setInviteMaxUses] = useState<number>(0);
  const [inviteCopiedCode, setInviteCopiedCode] = useState<string | null>(null);
  const [inviteToast, setInviteToast] = useState('');
  const [membersQuery, setMembersQuery] = useState('');
  const [membersSortBy, setMembersSortBy] = useState<'name' | 'server_joined' | 'discord_joined' | 'status'>('server_joined');
  const [membersSortDir, setMembersSortDir] = useState<'asc' | 'desc'>('desc');
  const [membersPage, setMembersPage] = useState(1);
  const [membersPageSize, setMembersPageSize] = useState(12);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [membersToast, setMembersToast] = useState('');
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [roleNameDraft, setRoleNameDraft] = useState('');
  const [roleColorDraft, setRoleColorDraft] = useState('#B5BAC1');
  const [roleEffectDraft, setRoleEffectDraft] = useState<RoleNameEffect>('none');
  const [roleToast, setRoleToast] = useState('');
  const [privacyToast, setPrivacyToast] = useState('');
  const [dataRequestAt, setDataRequestAt] = useState<string | null>(null);
  const [customServerEmojis, setCustomServerEmojis] = useState<CustomServerEmoji[]>([]);
  const [serverStickers, setServerStickers] = useState<ServerSticker[]>([]);
  const [stickerQuery, setStickerQuery] = useState('');
  const [stickerToast, setStickerToast] = useState('');
  const customEmojiInputRef = useRef<HTMLInputElement>(null);
  const serverStickerInputRef = useRef<HTMLInputElement>(null);
  const crewGifInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const serverIconInputRef = useRef<HTMLInputElement>(null);
  const serverBannerInputRef = useRef<HTMLInputElement>(null);

  const [desktopPermission, setDesktopPermission] = useState<'default' | 'denied' | 'granted' | 'unsupported'>('default');
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputDevices, setAudioOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoInputDevices, setVideoInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [mediaError, setMediaError] = useState('');
  const [mediaReady, setMediaReady] = useState(false);
  const [micTesting, setMicTesting] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [cameraTesting, setCameraTesting] = useState(false);
  const [cameraPreviewReady, setCameraPreviewReady] = useState(false);
  const [cameraError, setCameraError] = useState('');

  const cameraPreviewVideoRef = useRef<HTMLVideoElement>(null);
  const micTestStreamRef = useRef<MediaStream | null>(null);
  const micTestAudioContextRef = useRef<AudioContext | null>(null);
  const micTestRafRef = useRef<number | null>(null);
  const cameraPreviewStreamRef = useRef<MediaStream | null>(null);
  const cameraPreviewDeviceRef = useRef<string | null>(null);
  const wasOpenRef = useRef(isOpen);
  const prevActiveServerIdRef = useRef<string | null>(activeServerId);
  const profileStatusOptions: Array<{ value: UserStatus; label: string }> = [
    { value: 'online', label: 'En linea' },
    { value: 'idle', label: 'Ausente' },
    { value: 'dnd', label: 'No molestar' },
    { value: 'offline', label: 'Invisible' },
  ];
  const serverAccentPresets = [
    '#7A1027',
    '#8E1330',
    '#C2183C',
    '#5A1023',
    '#2563EB',
    '#0EA5A4',
    '#16A34A',
    '#D97706',
    '#9333EA',
    '#F23F43',
  ];
  const selectedCrewPreset = getCrewPreset(crewEmblemId);
  const normalizedCrewCustomEmblem = normalizeCrewCustomEmblemUrl(crewCustomEmblemDraft);
  const crewCustomEmblemIsGif = isCrewCustomEmblemGif(normalizedCrewCustomEmblem);
  const crewUsingCustomEmblem = crewEmblemId === CREW_CUSTOM_EMBLEM_ID;
  const crewPreviewEmblemUrl = crewUsingCustomEmblem && crewCustomEmblemIsGif ? normalizedCrewCustomEmblem : '';
  const computedCrewTag = normalizeCrewTag(crewTagDraft) || createDefaultCrewIdentity().crewTag;
  const computedCrewName = normalizeCrewName(crewNameDraft) || createDefaultCrewIdentity().crewName;

  const formatLastActive = (iso: string) => {
    const ts = new Date(iso).getTime();
    if (Number.isNaN(ts)) return 'Actividad reciente';
    return new Date(iso).toLocaleString();
  };

  const queueCropEditor = (file: File, config: Omit<PendingCrop, 'src'>) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const src = event.target?.result as string;
      if (!src) return;
      setPendingCrop({ ...config, src });
    };
    reader.readAsDataURL(file);
  };

  const stopMicTest = useCallback(() => {
    if (micTestRafRef.current != null) {
      cancelAnimationFrame(micTestRafRef.current);
      micTestRafRef.current = null;
    }
    if (micTestStreamRef.current) {
      micTestStreamRef.current.getTracks().forEach((track) => track.stop());
      micTestStreamRef.current = null;
    }
    if (micTestAudioContextRef.current && micTestAudioContextRef.current.state !== 'closed') {
      void micTestAudioContextRef.current.close();
    }
    micTestAudioContextRef.current = null;
    setMicTesting(false);
    setMicLevel(0);
  }, []);

  const stopCameraPreview = useCallback(() => {
    if (cameraPreviewStreamRef.current) {
      cameraPreviewStreamRef.current.getTracks().forEach((track) => track.stop());
      cameraPreviewStreamRef.current = null;
    }
    const video = cameraPreviewVideoRef.current;
    if (video) {
      video.pause();
      (video as any).srcObject = null;
    }
    cameraPreviewDeviceRef.current = null;
    setCameraPreviewReady(false);
    setCameraTesting(false);
  }, []);

  const applyOutputToMediaElements = useCallback(() => {
    if (typeof document === 'undefined') return;
    const mediaElements = Array.from(document.querySelectorAll('audio, video')) as HTMLMediaElement[];
    for (const mediaElement of mediaElements) {
      mediaElement.volume = Math.max(0, Math.min(1, mediaSettings.speakerVolume));
      const sinkCapable = mediaElement as HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };
      if (mediaSettings.outputDeviceId && typeof sinkCapable.setSinkId === 'function') {
        void sinkCapable.setSinkId(mediaSettings.outputDeviceId).catch(() => {});
      }
    }
  }, [mediaSettings.outputDeviceId, mediaSettings.speakerVolume]);

  const enumerateMediaDevices = useCallback(
    async (requestPermission = false) => {
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== 'function') return;
      try {
        setMediaError('');
        let probeStream: MediaStream | null = null;
        if (requestPermission && typeof navigator.mediaDevices.getUserMedia === 'function') {
          probeStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        }

        const allDevices = await navigator.mediaDevices.enumerateDevices();
        probeStream?.getTracks().forEach((track) => track.stop());

        const nextAudioInputs = allDevices.filter((device) => device.kind === 'audioinput');
        const nextAudioOutputs = allDevices.filter((device) => device.kind === 'audiooutput');
        const nextVideoInputs = allDevices.filter((device) => device.kind === 'videoinput');

        setAudioInputDevices(nextAudioInputs);
        setAudioOutputDevices(nextAudioOutputs);
        setVideoInputDevices(nextVideoInputs);
        setMediaReady(allDevices.length > 0);

        const updates: Partial<typeof mediaSettings> = {};
        if (
          nextAudioInputs.length > 0 &&
          !nextAudioInputs.some((device) => device.deviceId === mediaSettings.inputDeviceId)
        ) {
          updates.inputDeviceId = nextAudioInputs[0].deviceId;
        }
        if (
          nextAudioOutputs.length > 0 &&
          !nextAudioOutputs.some((device) => device.deviceId === mediaSettings.outputDeviceId)
        ) {
          updates.outputDeviceId = nextAudioOutputs[0].deviceId;
        }
        if (
          nextVideoInputs.length > 0 &&
          !nextVideoInputs.some((device) => device.deviceId === mediaSettings.cameraDeviceId)
        ) {
          updates.cameraDeviceId = nextVideoInputs[0].deviceId;
        }
        if (Object.keys(updates).length > 0) {
          setMediaSettings(updates);
        }
      } catch {
        setMediaError('No se pudieron cargar los dispositivos de voz/video.');
      }
    },
    [
      mediaSettings.cameraDeviceId,
      mediaSettings.inputDeviceId,
      mediaSettings.outputDeviceId,
      setMediaSettings,
    ]
  );

  const startMicTest = useCallback(async () => {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      setMediaError('Tu navegador no soporta prueba de microfono.');
      return;
    }
    stopMicTest();
    setMediaError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: mediaSettings.inputDeviceId ? { deviceId: { exact: mediaSettings.inputDeviceId } } : true,
      });
      micTestStreamRef.current = stream;

      const audioContext = new AudioContext();
      micTestAudioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      const sample = new Uint8Array(analyser.fftSize);

      const measure = () => {
        analyser.getByteTimeDomainData(sample);
        let sum = 0;
        for (let i = 0; i < sample.length; i += 1) {
          const normalized = (sample[i] - 128) / 128;
          sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / sample.length);
        setMicLevel(Math.max(0, Math.min(1, rms * 4)));
        micTestRafRef.current = requestAnimationFrame(measure);
      };

      setMicTesting(true);
      measure();
    } catch {
      setMediaError('No se pudo abrir el microfono seleccionado.');
      stopMicTest();
    }
  }, [mediaSettings.inputDeviceId, stopMicTest]);

  const openCameraPreviewStream = useCallback(async (deviceId: string | null) => {
    const candidates: Array<MediaTrackConstraints | boolean> = [];
    if (deviceId) {
      candidates.push(
        {
          deviceId: { exact: deviceId },
          width: { ideal: 1920, max: 1920 },
          height: { ideal: 1080, max: 1080 },
          frameRate: { ideal: 30, max: 60 },
        },
        {
          deviceId: { exact: deviceId },
          width: { ideal: 1280, max: 1280 },
          height: { ideal: 720, max: 720 },
        },
        { deviceId: { ideal: deviceId } }
      );
    }
    candidates.push(
      {
        width: { ideal: 1280, max: 1920 },
        height: { ideal: 720, max: 1080 },
        frameRate: { ideal: 30, max: 60 },
      },
      true
    );
    let lastError: unknown = null;
    for (const video of candidates) {
      try {
        return await navigator.mediaDevices.getUserMedia({ audio: false, video });
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? new Error('camera_unavailable');
  }, []);

  const startCameraPreview = useCallback(async () => {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      setCameraError('Tu navegador no soporta prueba de camara.');
      return;
    }
    stopCameraPreview();
    setCameraError('');
    setCameraPreviewReady(false);
    try {
      const stream = await openCameraPreviewStream(mediaSettings.cameraDeviceId);
      cameraPreviewStreamRef.current = stream;
      const video = cameraPreviewVideoRef.current;
      if (video) {
        (video as any).srcObject = null;
        (video as any).srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        video.autoplay = true;
        await new Promise<void>((resolve) => {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            cleanup();
            resolve();
          };
          const cleanup = () => {
            video.removeEventListener('loadedmetadata', finish);
            video.removeEventListener('loadeddata', finish);
          };
          video.addEventListener('loadedmetadata', finish);
          video.addEventListener('loadeddata', finish);
          window.setTimeout(finish, 1200);
        });
        await video.play().catch(() => {});
        if (video.readyState >= 2 || video.videoWidth > 0) {
          setCameraPreviewReady(true);
        }
      }
      const [track] = stream.getVideoTracks();
      if (track) {
        track.addEventListener('mute', () => setCameraPreviewReady(false));
        track.addEventListener('unmute', () => setCameraPreviewReady(true));
        track.addEventListener('ended', () => stopCameraPreview());
      }
      cameraPreviewDeviceRef.current = mediaSettings.cameraDeviceId;
      setCameraTesting(true);
    } catch (error) {
      const name = (error as any)?.name;
      if (name === 'NotAllowedError') {
        setCameraError('Permiso de camara denegado.');
      } else if (name === 'NotFoundError') {
        setCameraError('No se encontro una camara disponible.');
      } else if (name === 'NotReadableError') {
        setCameraError('La camara esta siendo usada por otra app.');
      } else {
        setCameraError('No se pudo abrir la camara seleccionada.');
      }
      stopCameraPreview();
    }
  }, [mediaSettings.cameraDeviceId, openCameraPreviewStream, stopCameraPreview]);

  const playSpeakerTestTone = useCallback(async () => {
    try {
      const ctx = new AudioContext();
      const destination = ctx.createMediaStreamDestination();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = 880;
      gain.gain.value = Math.max(0.02, mediaSettings.speakerVolume);

      oscillator.connect(gain);
      gain.connect(destination);

      const audio = new Audio();
      (audio as any).srcObject = destination.stream;
      audio.volume = Math.max(0, Math.min(1, mediaSettings.speakerVolume));
      const sinkCapable = audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
      if (mediaSettings.outputDeviceId && typeof sinkCapable.setSinkId === 'function') {
        await sinkCapable.setSinkId(mediaSettings.outputDeviceId);
      }

      oscillator.start();
      await audio.play();

      setTimeout(() => {
        try {
          oscillator.stop();
        } catch {}
        destination.stream.getTracks().forEach((track) => track.stop());
        audio.pause();
        void ctx.close();
      }, 350);
    } catch {
      setMediaError('No se pudo reproducir el tono de prueba.');
    }
  }, [mediaSettings.outputDeviceId, mediaSettings.speakerVolume]);

  useEffect(() => {
    applyOutputToMediaElements();
  }, [applyOutputToMediaElements]);

  useEffect(() => {
    if (!isOpen || activeTab !== 'voice_video') return;
    void enumerateMediaDevices(false);
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices || typeof mediaDevices.addEventListener !== 'function') return;
    const onDeviceChange = () => {
      void enumerateMediaDevices(false);
    };
    mediaDevices.addEventListener('devicechange', onDeviceChange);
    return () => {
      mediaDevices.removeEventListener('devicechange', onDeviceChange);
    };
  }, [activeTab, enumerateMediaDevices, isOpen]);

  useEffect(() => {
    if (!isOpen || activeTab !== 'voice_video') {
      stopMicTest();
      stopCameraPreview();
    }
  }, [activeTab, isOpen, stopCameraPreview, stopMicTest]);

  useEffect(() => {
    if (!isOpen || activeTab !== 'voice_video' || !cameraTesting) return;
    if (cameraPreviewDeviceRef.current === mediaSettings.cameraDeviceId) return;
    void startCameraPreview();
  }, [activeTab, cameraTesting, isOpen, mediaSettings.cameraDeviceId, startCameraPreview]);

  useEffect(() => {
    return () => {
      stopMicTest();
      stopCameraPreview();
    };
  }, [stopCameraPreview, stopMicTest]);

  // Sincronizar estados cuando el modal se abre
  useEffect(() => {
    let rafId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const wasOpen = wasOpenRef.current;
    const justOpened = isOpen && !wasOpen;
    const serverChangedWhileOpen = isOpen && prevActiveServerIdRef.current !== activeServerId;

    if (isOpen) {
      if (justOpened) {
        setMounted(true);
        rafId = requestAnimationFrame(() => setVisible(true));

        setUsername(currentUser.username);
        setDisplayName(currentUser.displayName || '');
        setPronouns(currentUser.pronouns || '');
        setBio(currentUser.bio || '');
        setStatusDraft(currentUser.status || 'online');
        setCustomStatusDraft(currentUser.customStatus || '');
        setBannerColor(currentUser.bannerColor || '#7A1027');
        setAvatar(currentUser.avatar || '');
        setBanner(currentUser.banner || '');
        setProfileMediaToast('');
        const storedCrew = readCrewIdentity(currentUser.id);
        const fallbackCrew = createDefaultCrewIdentity();
        const nextCrew = storedCrew || fallbackCrew;
        setCrewEnabled(nextCrew.enabled);
        setCrewEmblemId(nextCrew.emblemId);
        setCrewCustomEmblemDraft(nextCrew.customEmblemUrl || '');
        setCrewNameDraft(nextCrew.crewName);
        setCrewTagDraft(nextCrew.crewTag);
        setCrewColorDraft(nextCrew.color);
        setCrewAuraDraft(nextCrew.aura);
        setCrewToast('');
      }

      if (justOpened || serverChangedWhileOpen) {
        const s = activeServerId ? servers.find((x) => x.id === activeServerId) : undefined;
        setServerName(s?.name || '');
        setServerIcon(s?.icon || '');
        setServerBanner(s?.banner || '');
        setServerDescription(s?.description || '');
        setServerTag((s?.tag || '').toUpperCase());
        setServerAccentColor(s?.accentColor || '#7A1027');
        setServerStickers(Array.isArray(s?.stickers) ? s.stickers : []);
        setServerHasChanges(false);
        setServerMediaToast('');
        const firstChannelId = s?.categories[0]?.channels[0]?.id || null;
        setAccessChannelId(activeChannelId || firstChannelId);
        setAccessTargetType('role');
        setAccessMemberId(s?.members.find((m) => m.userId !== currentUser.id)?.userId || s?.members[0]?.userId || null);
      }

      if (justOpened && initialTab === 'server') {
        setServerSection('profile');
      }
    } else {
      if (wasOpen) {
        setVisible(false);
        setPendingCrop(null);
        timeoutId = setTimeout(() => setMounted(false), 260);
      }
    }

    wasOpenRef.current = isOpen;
    prevActiveServerIdRef.current = activeServerId;

    return () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      if (timeoutId != null) clearTimeout(timeoutId);
    };
  }, [isOpen, currentUser, servers, activeServerId, activeChannelId, initialTab]);

  useEffect(() => {
    if (!isOpen) {
      setMobileNavVisible(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isOpen) {
      setModalViewportHeight(null);
      return;
    }

    const viewport = window.visualViewport;
    if (!viewport) {
      setModalViewportHeight(null);
      return;
    }

    const updateViewportHeight = () => {
      setModalViewportHeight(Math.max(320, Math.round(viewport.height)));
    };

    updateViewportHeight();
    viewport.addEventListener('resize', updateViewportHeight);
    viewport.addEventListener('scroll', updateViewportHeight);
    window.addEventListener('orientationchange', updateViewportHeight);

    return () => {
      viewport.removeEventListener('resize', updateViewportHeight);
      viewport.removeEventListener('scroll', updateViewportHeight);
      window.removeEventListener('orientationchange', updateViewportHeight);
    };
  }, [isOpen]);

  useEffect(() => {
    setActiveTab(initialTab || 'profile');
    if (initialTab === 'server') {
      setServerSection('profile');
    }
  }, [initialTab]);

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
  }, []);

  useEffect(() => {
    if (!emojiToast) return;
    const id = setTimeout(() => setEmojiToast(''), 1200);
    return () => clearTimeout(id);
  }, [emojiToast]);

  useEffect(() => {
    if (!inviteToast) return;
    const id = setTimeout(() => setInviteToast(''), 1600);
    return () => clearTimeout(id);
  }, [inviteToast]);

  useEffect(() => {
    if (!inviteCopiedCode) return;
    const id = setTimeout(() => setInviteCopiedCode(null), 1600);
    return () => clearTimeout(id);
  }, [inviteCopiedCode]);

  useEffect(() => {
    if (!membersToast) return;
    const id = setTimeout(() => setMembersToast(''), 1800);
    return () => clearTimeout(id);
  }, [membersToast]);

  useEffect(() => {
    if (!roleToast) return;
    const id = setTimeout(() => setRoleToast(''), 1800);
    return () => clearTimeout(id);
  }, [roleToast]);

  useEffect(() => {
    if (!privacyToast) return;
    const id = setTimeout(() => setPrivacyToast(''), 1800);
    return () => clearTimeout(id);
  }, [privacyToast]);

  useEffect(() => {
    if (!crewToast) return;
    const id = setTimeout(() => setCrewToast(''), 1800);
    return () => clearTimeout(id);
  }, [crewToast]);

  useEffect(() => {
    if (!profileMediaToast) return;
    const id = setTimeout(() => setProfileMediaToast(''), 2400);
    return () => clearTimeout(id);
  }, [profileMediaToast]);

  useEffect(() => {
    setProfileBannerPreviewError(false);
  }, [banner, isOpen]);

  useEffect(() => {
    if (!serverMediaToast) return;
    const id = setTimeout(() => setServerMediaToast(''), 2400);
    return () => clearTimeout(id);
  }, [serverMediaToast]);

  useEffect(() => {
    if (!stickerToast) return;
    const id = setTimeout(() => setStickerToast(''), 2200);
    return () => clearTimeout(id);
  }, [stickerToast]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CUSTOM_EMOJIS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) setCustomServerEmojis(parsed as CustomServerEmoji[]);
    } catch {}
  }, [isOpen]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setDesktopPermission('unsupported');
      return;
    }
    setDesktopPermission(Notification.permission as 'default' | 'denied' | 'granted');
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    ensureCurrentDeviceSession();
  }, [isOpen, currentUser.id, ensureCurrentDeviceSession]);

  useEffect(() => {
    if (!isOpen) return;
    try {
      const raw = localStorage.getItem(DATA_REQUEST_STORAGE_KEY);
      setDataRequestAt(raw || null);
    } catch {
      setDataRequestAt(null);
    }
  }, [isOpen]);

  const saveCustomEmojis = (next: CustomServerEmoji[]) => {
    setCustomServerEmojis(next);
    try {
      localStorage.setItem(CUSTOM_EMOJIS_STORAGE_KEY, JSON.stringify(next));
    } catch {}
  };

  const handleCustomEmojiUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const baseName = file.name.split('.')[0] || 'emoji';
    const safeName = baseName.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 24) || 'emoji';
    const isAnimated = file.type === 'image/gif';

    const reader = new FileReader();
    reader.onload = () => {
      const next: CustomServerEmoji[] = [
        ...customServerEmojis,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: safeName,
          url: String(reader.result || ''),
          animated: isAnimated,
        },
      ].slice(-80);

      saveCustomEmojis(next);
      setEmojiToast(`Emoji ${safeName} anadido`);
    };
    reader.readAsDataURL(file);
    e.currentTarget.value = '';
  };

  // Verificar cambios cuando cualquier campo cambia
  useEffect(() => {
    if (!isOpen) return;
    
    const changed = 
      username !== currentUser.username ||
      displayName !== (currentUser.displayName || '') ||
      pronouns !== (currentUser.pronouns || '') ||
      bio !== (currentUser.bio || '') ||
      statusDraft !== (currentUser.status || 'online') ||
      customStatusDraft !== (currentUser.customStatus || '') ||
      bannerColor !== (currentUser.bannerColor || '#7A1027') ||
      avatar !== (currentUser.avatar || '') ||
      banner !== (currentUser.banner || '');
    
    setHasChanges(changed);
  }, [username, displayName, pronouns, bio, statusDraft, customStatusDraft, bannerColor, avatar, banner, isOpen, currentUser]);

  const emojiSearch = emojiQuery.trim().toLowerCase();
  const filteredServerEmojis = emojiSearch
    ? SERVER_EMOJI_LIBRARY.filter((item) => item.name.includes(emojiSearch) || item.emoji.includes(emojiSearch))
    : SERVER_EMOJI_LIBRARY;
  const normalizedStickerQuery = stickerQuery.trim().toLowerCase();
  const filteredServerStickers = useMemo(() => {
    if (!normalizedStickerQuery) return serverStickers;
    return serverStickers.filter((item) =>
      `${item.name} ${item.contentType} ${item.animated ? 'animated gif' : 'static'}`.toLowerCase().includes(normalizedStickerQuery)
    );
  }, [normalizedStickerQuery, serverStickers]);

  const applyPendingCrop = (dataUrl: string) => {
    if (!pendingCrop) return;
    if (pendingCrop.target === 'profile_avatar') {
      setAvatar(dataUrl);
    } else if (pendingCrop.target === 'profile_banner') {
      setBanner(dataUrl);
    } else if (pendingCrop.target === 'server_icon') {
      setServerIcon(dataUrl);
      setServerHasChanges(true);
    } else if (pendingCrop.target === 'server_banner') {
      setServerBanner(dataUrl);
      setServerHasChanges(true);
    }
    setPendingCrop(null);
  };

  const formatLimitMB = (bytes: number) => `${Math.round(bytes / (1024 * 1024))}MB`;

  const withAssetVersion = (rawUrl: string): string => {
    const value = rawUrl.trim();
    if (!value || value.startsWith('data:')) return value;
    const version = String(Date.now());
    try {
      const base =
        typeof window !== 'undefined' && window.location?.origin
          ? window.location.origin
          : 'https://diavlocord.app';
      const parsed = new URL(value, base);
      parsed.searchParams.set('assetv', version);
      return parsed.toString();
    } catch {
      return `${value}${value.includes('?') ? '&' : '?'}assetv=${version}`;
    }
  };

  const uploadMediaAsset = async (file: File, purpose: string) => {
    if (!isBackendEnabled || !backendToken) return null;
    try {
      const uploaded = await uploadFileToBackend({
        file,
        token: backendToken,
        purpose,
      });
      return uploaded;
    } catch {
      return null;
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = e.target.files?.[0];
    if (!file) return;
    if (isGifFile(file)) {
      if (file.size > MAX_PROFILE_ANIMATED_GIF_BYTES) {
        setProfileMediaToast(`GIF muy pesado. Maximo ${formatLimitMB(MAX_PROFILE_ANIMATED_GIF_BYTES)}.`);
        input.value = '';
        return;
      }
      try {
        const uploaded = await uploadMediaAsset(file, 'profile-avatar');
        if (uploaded?.url) {
          setAvatar(withAssetVersion(uploaded.url));
          setProfileMediaToast('Avatar GIF animado aplicado.');
          input.value = '';
          return;
        }
        const dataUrl = await readFileAsDataUrl(file);
        if (!dataUrl.startsWith('data:image/gif')) throw new Error('invalid_gif');
        setAvatar(dataUrl);
        setProfileMediaToast('Avatar GIF animado aplicado (local).');
      } catch {
        setProfileMediaToast('No se pudo leer el GIF.');
      }
      input.value = '';
      return;
    }
    queueCropEditor(file, {
      target: 'profile_avatar',
      title: 'Adjust profile avatar',
      aspect: 1,
      shape: 'circle',
      outputWidth: 512,
      outputHeight: 512,
    });
    input.value = '';
  };

  const handleBannerUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = e.target.files?.[0];
    if (!file) return;
    if (isGifFile(file)) {
      if (file.size > MAX_PROFILE_ANIMATED_GIF_BYTES) {
        setProfileMediaToast(`GIF muy pesado. Maximo ${formatLimitMB(MAX_PROFILE_ANIMATED_GIF_BYTES)}.`);
        input.value = '';
        return;
      }
      try {
        const uploaded = await uploadMediaAsset(file, 'profile-banner');
        if (uploaded?.url) {
          setBanner(withAssetVersion(uploaded.url));
          setProfileMediaToast('Banner GIF animado aplicado.');
          input.value = '';
          return;
        }
        const dataUrl = await readFileAsDataUrl(file);
        if (!dataUrl.startsWith('data:image/gif')) throw new Error('invalid_gif');
        setBanner(dataUrl);
        setProfileMediaToast('Banner GIF animado aplicado (local).');
      } catch {
        setProfileMediaToast('No se pudo leer el GIF.');
      }
      input.value = '';
      return;
    }
    queueCropEditor(file, {
      target: 'profile_banner',
      title: 'Adjust profile banner',
      aspect: 3,
      shape: 'rounded',
      outputWidth: 1440,
      outputHeight: 480,
    });
    input.value = '';
  };

  const handleSaveProfile = async () => {
    if (profileSaving) return;
    setProfileSaving(true);

    try {
      const normalizedUsername = username.trim();
      const normalizedDisplayName = displayName.trim();
      const normalizedPronouns = pronouns.trim();
      const normalizedBio = bio.trim();
      const normalizedCustomStatus = customStatusDraft.trim();
      const normalizedAvatar = avatar.trim();
      const normalizedBanner = banner.trim();

      if (normalizedUsername.length < 2 || normalizedUsername.length > 32) {
        setProfileMediaToast('Nombre de usuario invalido (2-32 caracteres).');
        return;
      }

      const localPayload = {
        username: normalizedUsername,
        displayName: normalizedDisplayName || undefined,
        pronouns: normalizedPronouns || undefined,
        bio: normalizedBio || undefined,
        status: statusDraft,
        customStatus: normalizedCustomStatus || undefined,
        bannerColor,
        avatar: normalizedAvatar || undefined,
        banner: normalizedBanner || undefined,
      };

      const fallbackCrew = createDefaultCrewIdentity();
      const normalizedCustomEmblem = isCrewCustomEmblemGif(crewCustomEmblemDraft)
        ? normalizeCrewCustomEmblemUrl(crewCustomEmblemDraft)
        : '';
      const safeEmblemId =
        crewEmblemId === CREW_CUSTOM_EMBLEM_ID
          ? normalizedCustomEmblem
            ? CREW_CUSTOM_EMBLEM_ID
            : fallbackCrew.emblemId
          : CREW_EMBLEM_OPTIONS.some((item) => item.id === crewEmblemId)
            ? crewEmblemId
            : fallbackCrew.emblemId;

      // Crew identity should never block profile save.
      try {
        writeCrewIdentity(currentUser.id, {
          enabled: crewEnabled,
          emblemId: safeEmblemId,
          customEmblemUrl: safeEmblemId === CREW_CUSTOM_EMBLEM_ID ? normalizedCustomEmblem : '',
          crewName: computedCrewName,
          crewTag: computedCrewTag,
          color: /^#[0-9a-fA-F]{6}$/.test(crewColorDraft) ? crewColorDraft.toUpperCase() : fallbackCrew.color,
          aura: crewAuraDraft,
          updatedAt: new Date().toISOString(),
        });
      } catch {}

      updateCurrentUser(localPayload);
      setPresence(currentUser.id, { userId: currentUser.id, status: statusDraft });

      // Keep form state normalized so hasChanges reflects real persisted state.
      setUsername(normalizedUsername);
      setDisplayName(normalizedDisplayName);
      setPronouns(normalizedPronouns);
      setBio(normalizedBio);
      setCustomStatusDraft(normalizedCustomStatus);
      setAvatar(normalizedAvatar);
      setBanner(normalizedBanner);
      setHasChanges(false);

      if (!isBackendEnabled || !backendToken) {
        setProfileMediaToast('Cambios guardados localmente.');
        return;
      }

      const res = await authProvider.updateProfile(backendToken, {
        username: normalizedUsername,
        displayName: normalizedDisplayName || null,
        pronouns: normalizedPronouns || null,
        bio: normalizedBio || null,
        avatar: normalizedAvatar || null,
        banner: normalizedBanner || null,
        bannerColor: bannerColor || null,
      });
      const data = await res.json().catch(() => ({} as any));
      if (res.status === 401 || res.status === 403) {
        try { localStorage.removeItem('diavlocord-backend-token'); } catch {}
        setBackendToken(null);
        setProfileMediaToast('Sesion expirada. Inicia sesion otra vez.');
        return;
      }
      if (!res.ok || !(data as any).user) {
        const backendError =
          typeof (data as any)?.error === 'string' ? String((data as any).error) : 'unknown_error';
        setProfileMediaToast(`Guardado local aplicado, pero backend rechazo los cambios (${backendError}).`);
        return;
      }
      const mapped = mapBackendUser((data as any).user);
      upsertUsers([mapped]);
      if (mapped.id === currentUser.id) {
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

      // Sync form with backend-mapped assets (includes cache-busting query params).
      setUsername(mapped.username || normalizedUsername);
      setDisplayName(mapped.displayName || '');
      setPronouns(mapped.pronouns || '');
      setBio(mapped.bio || '');
      setAvatar(mapped.avatar || '');
      setBanner(mapped.banner || '');
      setBannerColor(mapped.bannerColor || bannerColor || '#7A1027');
      setProfileBannerPreviewError(false);
      setHasChanges(false);
      setProfileMediaToast('Cambios guardados correctamente.');
    } catch {
      setProfileMediaToast('No se pudo guardar el perfil. Intentalo otra vez.');
    } finally {
      setProfileSaving(false);
    }
  };

  const handleSaveCrewIdentity = () => {
    const fallback = createDefaultCrewIdentity();
    const safeColor = /^#[0-9a-fA-F]{6}$/.test(crewColorDraft)
      ? crewColorDraft.toUpperCase()
      : fallback.color;
    const safeCustomEmblem = isCrewCustomEmblemGif(crewCustomEmblemDraft)
      ? normalizeCrewCustomEmblemUrl(crewCustomEmblemDraft)
      : '';
    const safeEmblemId =
      crewEmblemId === CREW_CUSTOM_EMBLEM_ID
        ? safeCustomEmblem
          ? CREW_CUSTOM_EMBLEM_ID
          : fallback.emblemId
        : CREW_EMBLEM_OPTIONS.some((item) => item.id === crewEmblemId)
          ? crewEmblemId
          : fallback.emblemId;
    const safeCrewTag = normalizeCrewTag(crewTagDraft) || fallback.crewTag;
    const safeCrewName = normalizeCrewName(crewNameDraft) || fallback.crewName;
    const safeAura = CREW_AURA_OPTIONS.some((item) => item.id === crewAuraDraft) ? crewAuraDraft : fallback.aura;

    writeCrewIdentity(currentUser.id, {
      enabled: crewEnabled,
      emblemId: safeEmblemId,
      customEmblemUrl: safeEmblemId === CREW_CUSTOM_EMBLEM_ID ? safeCustomEmblem : '',
      crewName: safeCrewName,
      crewTag: safeCrewTag,
      color: safeColor,
      aura: safeAura,
      updatedAt: new Date().toISOString(),
    });

    setCrewEmblemId(safeEmblemId);
    setCrewTagDraft(safeCrewTag);
    setCrewNameDraft(safeCrewName);
    setCrewColorDraft(safeColor);
    setCrewAuraDraft(safeAura);
    setCrewCustomEmblemDraft(safeEmblemId === CREW_CUSTOM_EMBLEM_ID ? safeCustomEmblem : '');
    if (crewEnabled && crewEmblemId === CREW_CUSTOM_EMBLEM_ID && !safeCustomEmblem) {
      setCrewToast('Tu GIF no es valido. Se aplico un emblema preset.');
      return;
    }
    setCrewToast(crewEnabled ? `Crew ${safeCrewTag} sincronizado` : 'Crew oculto en tu perfil');
  };

  const handleCrewGifUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;

    const lowerName = file.name.toLowerCase();
    const isGifMime = file.type.toLowerCase() === 'image/gif';
    const isGifByName = lowerName.endsWith('.gif');
    if (!isGifMime && !isGifByName) {
      setCrewToast('Solo se aceptan GIF para emblemas personalizados.');
      return;
    }

    if (file.size > CREW_MAX_CUSTOM_EMBLEM_FILE_BYTES) {
      setCrewToast(`GIF demasiado pesado. Maximo ${Math.floor(CREW_MAX_CUSTOM_EMBLEM_FILE_BYTES / 1024)}KB.`);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const nextUrl = normalizeCrewCustomEmblemUrl(typeof reader.result === 'string' ? reader.result : '');
      if (!nextUrl || !isCrewCustomEmblemGif(nextUrl)) {
        setCrewToast('No se pudo leer el GIF. Prueba otro archivo.');
        return;
      }
      setCrewEmblemId(CREW_CUSTOM_EMBLEM_ID);
      setCrewCustomEmblemDraft(nextUrl);
      setCrewToast('GIF cargado. Guarda la crew para aplicarlo.');
    };
    reader.onerror = () => {
      setCrewToast('No se pudo leer el archivo GIF.');
    };
    reader.readAsDataURL(file);
  };

  const handleDiscard = () => {
    setUsername(currentUser.username);
    setDisplayName(currentUser.displayName || '');
    setPronouns(currentUser.pronouns || '');
    setBio(currentUser.bio || '');
    setStatusDraft(currentUser.status || 'online');
    setCustomStatusDraft(currentUser.customStatus || '');
    setBannerColor(currentUser.bannerColor || '#7A1027');
    setAvatar(currentUser.avatar || '');
    setBanner(currentUser.banner || '');
    setHasChanges(false);
  };

  const handleTryClose = () => {
    if (hasChanges) {
      setShakeButton(true);
      setTimeout(() => setShakeButton(false), 400);
    } else {
      onClose();
    }
  };

  const activeServer = activeServerId ? servers.find((s) => s.id === activeServerId) : null;
  const canEditServer = !!activeServer && activeServer.ownerId === currentUser.id;
  const serverPermissionContextChannel = activeServer?.categories?.[0]?.channels?.[0];
  const canManageRoles = !!activeServer && (
    activeServer.ownerId === currentUser.id ||
    hasPermission(activeServer, serverPermissionContextChannel, currentUser.id, 'MANAGE_ROLES') ||
    hasPermission(activeServer, serverPermissionContextChannel, currentUser.id, 'ADMINISTRATOR')
  );
  const canTimeoutMembers = !!activeServer && (
    activeServer.ownerId === currentUser.id ||
    hasPermission(activeServer, serverPermissionContextChannel, currentUser.id, 'MANAGE_MESSAGES') ||
    hasPermission(activeServer, serverPermissionContextChannel, currentUser.id, 'ADMINISTRATOR')
  );
  const canKickBanMembers = !!activeServer && (
    activeServer.ownerId === currentUser.id ||
    hasPermission(activeServer, serverPermissionContextChannel, currentUser.id, 'MANAGE_SERVER') ||
    hasPermission(activeServer, serverPermissionContextChannel, currentUser.id, 'ADMINISTRATOR')
  );
  const canViewAuditLog = !!activeServer && (
    activeServer.ownerId === currentUser.id ||
    hasPermission(activeServer, undefined, currentUser.id, 'VIEW_AUDIT_LOG')
  );
  const serverChannels = activeServer?.categories?.flatMap((c) => c.channels) || [];
  const serverChannelSignature = serverChannels.map((c) => c.id).join('|');
  const defaultSystemChannelId = serverChannels[0]?.id || '';
  const resolvedAccessChannelId = accessChannelId || serverChannels[0]?.id || null;
  const accessChannel = serverChannels.find((c) => c.id === resolvedAccessChannelId) || null;
  const rolePermissionRows: Array<{ key: Permission; label: string }> = [
    { key: 'ADMINISTRATOR', label: 'Administrador' },
    { key: 'MANAGE_SERVER', label: 'Gestionar servidor' },
    { key: 'MANAGE_CHANNELS', label: 'Gestionar canales' },
    { key: 'MANAGE_ROLES', label: 'Gestionar roles' },
    { key: 'VIEW_AUDIT_LOG', label: 'Ver auditoria' },
    { key: 'MANAGE_MESSAGES', label: 'Gestionar mensajes' },
    { key: 'VIEW_CHANNEL', label: 'Ver canal' },
    { key: 'READ_MESSAGES', label: 'Leer mensajes' },
    { key: 'SEND_MESSAGES', label: 'Enviar mensajes' },
    { key: 'ATTACH_FILES', label: 'Adjuntar archivos' },
    { key: 'CREATE_INSTANT_INVITE', label: 'Crear invitaciones' },
  ];
  const roleEffectOptions: Array<{ key: RoleNameEffect; label: string }> = [
    { key: 'none', label: 'Sin animacion' },
    { key: 'pulse', label: 'Pulse RGB' },
    { key: 'neon', label: 'Neon' },
    { key: 'rainbow', label: 'Rainbow' },
    { key: 'shimmer', label: 'Shimmer' },
    { key: 'glitch', label: 'Glitch' },
  ];
  const roleColorPresets: Array<{ label: string; value: string }> = [
    { label: 'Rojo RGB', value: 'rgb(255, 70, 100)' },
    { label: 'Verde RGB', value: 'rgb(57, 255, 20)' },
    { label: 'Cian RGB', value: 'rgb(0, 224, 255)' },
    { label: 'Morado RGB', value: 'rgb(176, 88, 255)' },
    { label: 'Sunset', value: 'linear-gradient(90deg, rgb(255, 80, 80), rgb(255, 180, 70))' },
    { label: 'Aurora', value: 'linear-gradient(90deg, rgb(0, 240, 255), rgb(80, 120, 255), rgb(190, 90, 255))' },
  ];
  const accessPermissions: Array<{ key: Permission; label: string }> = [
    { key: 'VIEW_CHANNEL', label: 'Ver canal' },
    { key: 'READ_MESSAGES', label: 'Leer mensajes' },
    { key: 'SEND_MESSAGES', label: 'Enviar mensajes' },
    { key: 'ATTACH_FILES', label: 'Adjuntar archivos' },
  ];
  const sortedServerRoles = [...(activeServer?.roles || [])].sort((a, b) => (b.position || 0) - (a.position || 0));
  const selectedRole = sortedServerRoles.find((role) => role.id === selectedRoleId) || null;
  const accessMembers = (activeServer?.members || [])
    .map((m) => users.find((u) => u.id === m.userId))
    .filter((u): u is NonNullable<typeof u> => !!u);
  const activeServerBans = activeServerId ? (serverBans[activeServerId] || []) : [];
  const activeAuditLog = activeServerId
    ? (auditLog[activeServerId] || []).filter((entry) => entry.serverId === activeServerId)
    : [];
  const activeServerInvites = [...(activeServer?.invites || [])]
    .map((invite) => ({
      ...invite,
      maxUses: typeof invite.maxUses === 'number' ? invite.maxUses : null,
      expiresAt: invite.expiresAt ?? null,
      revoked: Boolean(invite.revoked),
      revokedAt: invite.revokedAt ?? null,
    }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const securityVerificationOptions: Array<{
    value: SecurityVerificationLevel;
    label: string;
    description: string;
  }> = [
    { value: 'low', label: 'Bajo', description: 'Debe tener correo verificado para escribir.' },
    { value: 'medium', label: 'Medio', description: 'Cuenta con al menos 5 minutos desde el registro.' },
    { value: 'high', label: 'Alto', description: 'Debe llevar 10 minutos dentro del servidor.' },
    { value: 'very_high', label: 'Muy alto', description: 'Requiere telefono verificado en la cuenta.' },
  ];
  const verificationLabel =
    securityVerificationOptions.find((item) => item.value === securitySettings.dmSpam.verificationLevel)?.label || 'Bajo';
  const securityEnabledCounters = useMemo(() => {
    const antiRaidCount = [
      securitySettings.antiRaid.activityAlerts,
      securitySettings.antiRaid.captchaSuspicious,
      securitySettings.antiRaid.captchaAttackMode,
    ].filter(Boolean).length;
    const dmSpamCount = [
      securitySettings.dmSpam.verificationLevel !== 'low',
      securitySettings.dmSpam.hideSuspiciousDMs,
      securitySettings.dmSpam.filterUnknownDMs,
      securitySettings.dmSpam.warnExternalLinks,
      securitySettings.dmSpam.autoDeleteSpam,
    ].filter(Boolean).length;
    const automodCount = [
      securitySettings.automod.blockProfileWords,
      securitySettings.automod.blockMentionSpam,
      securitySettings.automod.blockSuspectedSpam,
      securitySettings.automod.blockFrequentWords,
      securitySettings.automod.blockCustomWords,
    ].filter(Boolean).length;
    const permissionsCount = [
      securitySettings.permissions.require2FA,
      securitySettings.permissions.disableRiskyEveryone,
    ].filter(Boolean).length;
    return {
      antiRaidCount,
      dmSpamCount,
      automodCount,
      permissionsCount,
    };
  }, [securitySettings]);
  const securityAutoModActionTags = {
    profile:
      [
        securitySettings.automod.profileRuleBlockInteractions ? 'bloquear interacciones' : null,
        securitySettings.automod.profileRuleSendAlert ? 'enviar alerta' : null,
      ].filter((value): value is string => Boolean(value)),
    suspected:
      [
        securitySettings.automod.suspectedRuleBlockMessage ? 'bloquear mensaje' : null,
        securitySettings.automod.suspectedRuleSendAlert ? 'enviar alerta' : null,
      ].filter((value): value is string => Boolean(value)),
    frequent:
      [
        securitySettings.automod.frequentRuleBlockMessage ? 'bloquear mensaje' : null,
        securitySettings.automod.frequentRuleSendAlert ? 'enviar alerta' : null,
      ].filter((value): value is string => Boolean(value)),
    custom:
      [
        securitySettings.automod.customRuleBlockMessage ? 'bloquear mensaje' : null,
        securitySettings.automod.customRuleSendAlert ? 'enviar alerta' : null,
        securitySettings.automod.customRuleTempMute ? 'aislar temporalmente' : null,
      ].filter((value): value is string => Boolean(value)),
  };
  const moderationChannelTag = `#${serverChannels.find((channel) => channel.id === interactionSettings.systemChannelId)?.name || 'moderator-only'}`;
  const membersRows = useMemo(() => {
    if (!activeServer) return [];
    return activeServer.members
      .map((member) => {
        const user = users.find((u) => u.id === member.userId);
        if (!user) return null;
        const roleObjects = (member.roleIds || [])
          .map((roleId) => activeServer.roles.find((role) => role.id === roleId))
          .filter((role): role is NonNullable<typeof role> => !!role)
          .sort((a, b) => (b.position || 0) - (a.position || 0));
        const joinedServerAt = toTimeMs(member.joinedAt);
        const joinedDiscordAt = toTimeMs(user.createdAt || null);
        return {
          member,
          user,
          roleObjects,
          joinedServerAt,
          joinedDiscordAt,
          displayName: user.displayName || user.username,
          searchText: `${user.username} ${user.displayName || ''} ${user.id} ${roleObjects.map((r) => r.name).join(' ')}`.toLowerCase(),
        };
      })
      .filter((row): row is NonNullable<typeof row> => !!row);
  }, [activeServer, users]);

  const filteredMembersRows = useMemo(() => {
    const query = membersQuery.trim().toLowerCase();
    const filtered = query
      ? membersRows.filter((row) => row.searchText.includes(query))
      : membersRows.slice();
    const statusOrder: Record<UserStatus, number> = { online: 0, idle: 1, dnd: 2, offline: 3 };
    filtered.sort((a, b) => {
      let result = 0;
      if (membersSortBy === 'name') {
        result = a.displayName.localeCompare(b.displayName, 'es', { sensitivity: 'base' });
      } else if (membersSortBy === 'discord_joined') {
        result = a.joinedDiscordAt - b.joinedDiscordAt;
      } else if (membersSortBy === 'status') {
        result = (statusOrder[a.user.status] ?? 99) - (statusOrder[b.user.status] ?? 99);
      } else {
        result = a.joinedServerAt - b.joinedServerAt;
      }
      return membersSortDir === 'asc' ? result : -result;
    });
    return filtered;
  }, [membersQuery, membersRows, membersSortBy, membersSortDir]);

  const membersTotalPages = Math.max(1, Math.ceil(filteredMembersRows.length / membersPageSize));
  const normalizedMembersPage = Math.min(membersPage, membersTotalPages);
  const pagedMembersRows = filteredMembersRows.slice(
    (normalizedMembersPage - 1) * membersPageSize,
    normalizedMembersPage * membersPageSize
  );
  const pagedMemberIds = pagedMembersRows.map((row) => row.member.userId);
  const allPagedMembersSelected = pagedMemberIds.length > 0 && pagedMemberIds.every((id) => selectedMemberIds.includes(id));
  const selectedMembersCount = filteredMembersRows.filter((row) => selectedMemberIds.includes(row.member.userId)).length;
  const membersVisiblePages = useMemo(() => {
    const maxVisible = 5;
    if (membersTotalPages <= maxVisible) {
      return Array.from({ length: membersTotalPages }, (_, i) => i + 1);
    }
    let start = Math.max(1, normalizedMembersPage - 2);
    let end = Math.min(membersTotalPages, start + maxVisible - 1);
    if (end - start < maxVisible - 1) {
      start = Math.max(1, end - maxVisible + 1);
    }
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }, [membersTotalPages, normalizedMembersPage]);

  useEffect(() => {
    if (membersPage > membersTotalPages) {
      setMembersPage(membersTotalPages);
    }
  }, [membersPage, membersTotalPages]);

  useEffect(() => {
    setMembersPage(1);
  }, [membersQuery, membersSortBy, membersSortDir, membersPageSize, activeServerId]);

  useEffect(() => {
    const validIds = new Set((activeServer?.members || []).map((m) => m.userId));
    setSelectedMemberIds((prev) => prev.filter((id) => validIds.has(id)));
  }, [activeServer]);

  const serverTagStorageScope = activeServerId
    ? `${SERVER_TAG_PROFILE_STORAGE_KEY}:${currentUser.id}:${activeServerId}`
    : null;
  const selectedServerTagBadge =
    SERVER_TAG_BADGE_OPTIONS.find((badge) => badge.id === serverTagBadgeId) || SERVER_TAG_BADGE_OPTIONS[0];
  const visibleServerTagBadges = serverTagShowAllBadges
    ? SERVER_TAG_BADGE_OPTIONS
    : SERVER_TAG_BADGE_OPTIONS.filter((badge) => badge.tier === 'core');
  const computedServerTagName = normalizeServerTagLabel(
    serverTagNameDraft ||
      activeServer?.tag ||
      activeServer?.name?.slice(0, 4) ||
      'NODE'
  );
  const serverTagCanAdopt = serverTagFeatureEnabled && computedServerTagName.length > 0;

  useEffect(() => {
    if (!isOpen || activeTab !== 'server' || !activeServerId) return;
    const validChannelIds = new Set(serverChannels.map((channel) => channel.id));
    const fallbackChannel = defaultSystemChannelId;
    try {
      const raw = localStorage.getItem(`${SERVER_INTERACTIONS_STORAGE_KEY}:${activeServerId}`);
      if (!raw) {
        setInteractionSettings((prev) => ({
          ...prev,
          systemChannelId: fallbackChannel,
          idleChannelId: '',
        }));
        return;
      }
      const parsed = JSON.parse(raw) as Partial<ServerInteractionSettings>;
      const idleMinutesCandidates = new Set([5, 10, 15, 30, 60, 120]);
      const nextSystemChannelId =
        typeof parsed.systemChannelId === 'string' && validChannelIds.has(parsed.systemChannelId)
          ? parsed.systemChannelId
          : fallbackChannel;
      const nextIdleChannelId =
        typeof parsed.idleChannelId === 'string' && parsed.idleChannelId && validChannelIds.has(parsed.idleChannelId)
          ? parsed.idleChannelId
          : '';
      setInteractionSettings({
        systemWelcomeRandom: parsed.systemWelcomeRandom ?? true,
        systemStickerReply: parsed.systemStickerReply ?? true,
        systemBoostNotice: parsed.systemBoostNotice ?? true,
        systemTips: parsed.systemTips ?? false,
        activitiesVisible: parsed.activitiesVisible ?? true,
        defaultNotificationMode: parsed.defaultNotificationMode === 'all' ? 'all' : 'mentions',
        systemChannelId: nextSystemChannelId,
        idleChannelId: nextIdleChannelId,
        idleTimeoutMinutes:
          typeof parsed.idleTimeoutMinutes === 'number' && idleMinutesCandidates.has(parsed.idleTimeoutMinutes)
            ? parsed.idleTimeoutMinutes
            : 5,
        widgetEnabled: parsed.widgetEnabled ?? false,
      });
    } catch {
      setInteractionSettings((prev) => ({
        ...prev,
        systemChannelId: fallbackChannel,
        idleChannelId: '',
      }));
    }
  }, [activeServerId, activeTab, defaultSystemChannelId, isOpen, serverChannelSignature]);

  useEffect(() => {
    if (!activeServerId) return;
    try {
      localStorage.setItem(
        `${SERVER_INTERACTIONS_STORAGE_KEY}:${activeServerId}`,
        JSON.stringify(interactionSettings)
      );
    } catch {}
  }, [activeServerId, interactionSettings]);

  useEffect(() => {
    if (!isOpen || activeTab !== 'server' || !activeServerId) return;
    const defaults = createDefaultServerSecuritySettings();
    try {
      const raw = localStorage.getItem(`${SERVER_SECURITY_STORAGE_KEY}:${activeServerId}`);
      if (!raw) {
        setSecuritySettings(defaults);
        return;
      }
      const parsed = JSON.parse(raw) as Partial<ServerSecuritySettings>;
      const verification =
        parsed.dmSpam?.verificationLevel === 'medium' ||
        parsed.dmSpam?.verificationLevel === 'high' ||
        parsed.dmSpam?.verificationLevel === 'very_high'
          ? parsed.dmSpam.verificationLevel
          : 'low';
      const sensitiveMediaFilter =
        parsed.automod?.sensitiveMediaFilter === 'all' ||
        parsed.automod?.sensitiveMediaFilter === 'off'
          ? parsed.automod.sensitiveMediaFilter
          : 'members';
      setSecuritySettings({
        antiRaid: {
          activityAlerts: parsed.antiRaid?.activityAlerts ?? defaults.antiRaid.activityAlerts,
          captchaSuspicious: parsed.antiRaid?.captchaSuspicious ?? defaults.antiRaid.captchaSuspicious,
          captchaAttackMode: parsed.antiRaid?.captchaAttackMode ?? defaults.antiRaid.captchaAttackMode,
        },
        dmSpam: {
          verificationLevel: verification,
          hideSuspiciousDMs: parsed.dmSpam?.hideSuspiciousDMs ?? defaults.dmSpam.hideSuspiciousDMs,
          filterUnknownDMs: parsed.dmSpam?.filterUnknownDMs ?? defaults.dmSpam.filterUnknownDMs,
          warnExternalLinks: parsed.dmSpam?.warnExternalLinks ?? defaults.dmSpam.warnExternalLinks,
          autoDeleteSpam: parsed.dmSpam?.autoDeleteSpam ?? defaults.dmSpam.autoDeleteSpam,
        },
        automod: {
          blockProfileWords: parsed.automod?.blockProfileWords ?? defaults.automod.blockProfileWords,
          blockMentionSpam: parsed.automod?.blockMentionSpam ?? defaults.automod.blockMentionSpam,
          blockSuspectedSpam: parsed.automod?.blockSuspectedSpam ?? defaults.automod.blockSuspectedSpam,
          blockFrequentWords: parsed.automod?.blockFrequentWords ?? defaults.automod.blockFrequentWords,
          blockCustomWords: parsed.automod?.blockCustomWords ?? defaults.automod.blockCustomWords,
          sensitiveMediaFilter,

          profileRuleEnabled: parsed.automod?.profileRuleEnabled ?? defaults.automod.profileRuleEnabled,
          profileRuleTerms: parsed.automod?.profileRuleTerms || defaults.automod.profileRuleTerms,
          profileRuleRegex: parsed.automod?.profileRuleRegex ?? defaults.automod.profileRuleRegex,
          profileRuleAllowList: parsed.automod?.profileRuleAllowList || defaults.automod.profileRuleAllowList,
          profileRuleBlockInteractions:
            parsed.automod?.profileRuleBlockInteractions ?? defaults.automod.profileRuleBlockInteractions,
          profileRuleSendAlert: parsed.automod?.profileRuleSendAlert ?? defaults.automod.profileRuleSendAlert,
          profileRuleAllowRoles: parsed.automod?.profileRuleAllowRoles || defaults.automod.profileRuleAllowRoles,

          suspectedRuleEnabled: parsed.automod?.suspectedRuleEnabled ?? defaults.automod.suspectedRuleEnabled,
          suspectedRuleBlockMessage:
            parsed.automod?.suspectedRuleBlockMessage ?? defaults.automod.suspectedRuleBlockMessage,
          suspectedRuleSendAlert: parsed.automod?.suspectedRuleSendAlert ?? defaults.automod.suspectedRuleSendAlert,
          suspectedRuleAllowBypass: parsed.automod?.suspectedRuleAllowBypass || defaults.automod.suspectedRuleAllowBypass,

          frequentRuleEnabled: parsed.automod?.frequentRuleEnabled ?? defaults.automod.frequentRuleEnabled,
          frequentRuleProfanity: parsed.automod?.frequentRuleProfanity ?? defaults.automod.frequentRuleProfanity,
          frequentRuleInsults: parsed.automod?.frequentRuleInsults ?? defaults.automod.frequentRuleInsults,
          frequentRuleSexual: parsed.automod?.frequentRuleSexual ?? defaults.automod.frequentRuleSexual,
          frequentRuleAllowList: parsed.automod?.frequentRuleAllowList || defaults.automod.frequentRuleAllowList,
          frequentRuleBlockMessage:
            parsed.automod?.frequentRuleBlockMessage ?? defaults.automod.frequentRuleBlockMessage,
          frequentRuleSendAlert: parsed.automod?.frequentRuleSendAlert ?? defaults.automod.frequentRuleSendAlert,
          frequentRuleAllowBypass: parsed.automod?.frequentRuleAllowBypass || defaults.automod.frequentRuleAllowBypass,

          customRuleEnabled: parsed.automod?.customRuleEnabled ?? defaults.automod.customRuleEnabled,
          customRuleTerms: parsed.automod?.customRuleTerms || defaults.automod.customRuleTerms,
          customRuleAllowList: parsed.automod?.customRuleAllowList || defaults.automod.customRuleAllowList,
          customRuleBlockMessage: parsed.automod?.customRuleBlockMessage ?? defaults.automod.customRuleBlockMessage,
          customRuleSendAlert: parsed.automod?.customRuleSendAlert ?? defaults.automod.customRuleSendAlert,
          customRuleTempMute: parsed.automod?.customRuleTempMute ?? defaults.automod.customRuleTempMute,
          customRuleAllowBypass: parsed.automod?.customRuleAllowBypass || defaults.automod.customRuleAllowBypass,
        },
        permissions: {
          require2FA: parsed.permissions?.require2FA ?? defaults.permissions.require2FA,
          disableRiskyEveryone:
            parsed.permissions?.disableRiskyEveryone ?? defaults.permissions.disableRiskyEveryone,
        },
      });
    } catch {
      setSecuritySettings(defaults);
    }
  }, [activeServerId, activeTab, isOpen]);

  useEffect(() => {
    if (!activeServerId) return;
    try {
      localStorage.setItem(
        `${SERVER_SECURITY_STORAGE_KEY}:${activeServerId}`,
        JSON.stringify(securitySettings)
      );
    } catch {}
  }, [activeServerId, securitySettings]);

  useEffect(() => {
    if (!securityToast) return;
    const id = setTimeout(() => setSecurityToast(''), 1500);
    return () => clearTimeout(id);
  }, [securityToast]);

  useEffect(() => {
    if (serverSection !== 'security') {
      setSecurityPanel('overview');
      setSecurityRuleEditor('none');
      setSecurityVerificationPickerOpen(false);
    }
  }, [serverSection]);

  useEffect(() => {
    if (!serverTagToast) return;
    const id = setTimeout(() => setServerTagToast(''), 1600);
    return () => clearTimeout(id);
  }, [serverTagToast]);

  useEffect(() => {
    if (!isOpen || activeTab !== 'server' || !activeServer || !serverTagStorageScope) return;
    const fallbackTag = normalizeServerTagLabel(activeServer.tag || activeServer.name?.slice(0, 4) || 'NODE');
    try {
      const raw = localStorage.getItem(serverTagStorageScope);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<{
          enabled: boolean;
          name: string;
          badgeId: string;
          color: string;
          adopted: boolean;
        }>;
        setServerTagFeatureEnabled(parsed.enabled ?? true);
        setServerTagNameDraft(normalizeServerTagLabel(parsed.name || fallbackTag));
        setServerTagBadgeId(
          SERVER_TAG_BADGE_OPTIONS.some((badge) => badge.id === parsed.badgeId)
            ? (parsed.badgeId as string)
            : SERVER_TAG_BADGE_OPTIONS[0]?.id || 'leaf'
        );
        setServerTagColor(
          parsed.color && /^#[0-9a-fA-F]{6}$/.test(parsed.color)
            ? parsed.color.toUpperCase()
            : SERVER_TAG_COLOR_OPTIONS[5]
        );
        setServerTagAdopted(Boolean(parsed.adopted));
        return;
      }
    } catch {}
    setServerTagFeatureEnabled(true);
    setServerTagNameDraft(fallbackTag);
    setServerTagBadgeId(SERVER_TAG_BADGE_OPTIONS[0]?.id || 'leaf');
    setServerTagColor(SERVER_TAG_COLOR_OPTIONS[5]);
    setServerTagAdopted(false);
    setServerTagShowAllBadges(false);
  }, [activeServer, activeTab, isOpen, serverTagStorageScope]);

  useEffect(() => {
    if (!serverTagStorageScope || !serverTagAdopted) return;
    const safeName = normalizeServerTagLabel(computedServerTagName || 'NODE');
    const safeBadgeId = SERVER_TAG_BADGE_OPTIONS.some((badge) => badge.id === serverTagBadgeId)
      ? serverTagBadgeId
      : SERVER_TAG_BADGE_OPTIONS[0]?.id || 'leaf';
    const safeColor = /^#[0-9a-fA-F]{6}$/.test(serverTagColor)
      ? serverTagColor.toUpperCase()
      : SERVER_TAG_COLOR_OPTIONS[5];
    try {
      localStorage.setItem(
        serverTagStorageScope,
        JSON.stringify({
          enabled: serverTagFeatureEnabled,
          name: safeName,
          badgeId: safeBadgeId,
          color: safeColor,
          adopted: true,
        })
      );
    } catch {}
  }, [
    computedServerTagName,
    serverTagAdopted,
    serverTagBadgeId,
    serverTagColor,
    serverTagFeatureEnabled,
    serverTagStorageScope,
  ]);

  useEffect(() => {
    if (!isOpen || activeTab !== 'server') return;
    if (serverSection === 'audit_log' && !canViewAuditLog) {
      setServerSection('profile');
    }
  }, [activeTab, canViewAuditLog, isOpen, serverSection]);

  const getInviteLink = (code: string) =>
    typeof window !== 'undefined' && window.location?.origin
      ? `${window.location.origin}/invite/${code}`
      : `diavlocord://invite/${code}`;
  const isInviteExpired = (expiresAt?: string | null) => {
    if (!expiresAt) return false;
    const expiresAtMs = new Date(expiresAt).getTime();
    if (Number.isNaN(expiresAtMs)) return false;
    return expiresAtMs <= Date.now();
  };
  const isInviteMaxed = (uses: number, maxUses?: number | null) => {
    if (!maxUses || maxUses <= 0) return false;
    return uses >= maxUses;
  };

  useEffect(() => {
    if (!activeServer || serverSection !== 'roles') return;
    if (selectedRoleId && activeServer.roles.some((role) => role.id === selectedRoleId)) return;
    const fallback = [...activeServer.roles].sort((a, b) => (b.position || 0) - (a.position || 0))[0]?.id || null;
    setSelectedRoleId(fallback);
  }, [activeServer, selectedRoleId, serverSection]);

  useEffect(() => {
    if (!selectedRole) return;
    setRoleNameDraft(selectedRole.name || '');
    setRoleColorDraft(selectedRole.color || '#B5BAC1');
    setRoleEffectDraft(selectedRole.nameEffect || 'none');
  }, [selectedRole?.id]);

  const handleCreateRole = () => {
    if (!activeServerId || !canManageRoles) return;
    const roleId = createRole(activeServerId, {
      name: 'Nuevo rol',
      color: '#B5BAC1',
      nameEffect: 'none',
      permissions: ['READ_MESSAGES', 'SEND_MESSAGES'],
      hoist: true,
      mentionable: true,
    });
    if (!roleId) return;
    setSelectedRoleId(roleId);
    setRoleToast('Rol creado');
  };

  const handleSaveRoleDraft = () => {
    if (!activeServerId || !selectedRole || !canManageRoles) return;
    const trimmedName = roleNameDraft.trim();
    updateRole(activeServerId, selectedRole.id, {
      name: trimmedName || selectedRole.name,
      color: roleColorDraft.trim() || selectedRole.color,
      nameEffect: roleEffectDraft,
    });
    setRoleToast('Rol actualizado');
  };

  const handleToggleRolePermission = (permission: Permission, enabled: boolean) => {
    if (!activeServerId || !selectedRole || !canManageRoles) return;
    const next = new Set(selectedRole.permissions || []);
    if (enabled) next.add(permission);
    else next.delete(permission);
    updateRole(activeServerId, selectedRole.id, { permissions: Array.from(next) });
  };

  const handleDeleteSelectedRole = () => {
    if (!activeServerId || !selectedRole || !canManageRoles) return;
    deleteRole(activeServerId, selectedRole.id);
    setRoleToast('Rol eliminado');
  };

  const handleCreateServerInvite = async () => {
    if (!activeServerId || !canEditServer) return;
    const inviteLink = createServerInviteLink(activeServerId, {
      maxUses: inviteMaxUses > 0 ? inviteMaxUses : null,
      expiresInHours: inviteExpiryHours > 0 ? inviteExpiryHours : null,
    });
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
    } catch {}
    const code = inviteLink.split('/').pop() || '';
    setInviteCopiedCode(code);
    setInviteToast(t(language, 'invite_created_and_copied'));
  };

  const handleCopyInvite = async (code: string) => {
    try {
      await navigator.clipboard.writeText(getInviteLink(code));
      setInviteCopiedCode(code);
    } catch {}
  };

  const handleRevokeInvite = (code: string) => {
    if (!activeServerId || !canEditServer) return;
    const ok = revokeServerInvite(activeServerId, code);
    if (ok) setInviteToast(t(language, 'invite_revoked_done'));
  };

  const toggleMembersSort = (field: 'name' | 'server_joined' | 'discord_joined' | 'status') => {
    if (membersSortBy === field) {
      setMembersSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setMembersSortBy(field);
    setMembersSortDir(field === 'name' ? 'asc' : 'desc');
  };

  const toggleSelectMember = (userId: string) => {
    setSelectedMemberIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const toggleSelectCurrentPageMembers = () => {
    if (pagedMemberIds.length === 0) return;
    setSelectedMemberIds((prev) => {
      if (allPagedMembersSelected) {
        return prev.filter((id) => !pagedMemberIds.includes(id));
      }
      const next = new Set(prev);
      pagedMemberIds.forEach((id) => next.add(id));
      return Array.from(next);
    });
  };

  const copyMemberId = async (userId: string) => {
    try {
      await navigator.clipboard.writeText(userId);
      setMembersToast('ID copiado');
    } catch {
      setMembersToast('No se pudo copiar el ID');
    }
  };

  const toggleMemberTimeout = (userId: string, timedOut: boolean) => {
    if (!activeServerId || !canTimeoutMembers || !activeServer) return;
    if (userId === currentUser.id || userId === activeServer.ownerId) return;
    if (timedOut) {
      clearMemberTimeout(activeServerId, userId);
      setMembersToast('Aislamiento eliminado');
    } else {
      timeoutMember(activeServerId, userId, 5, 'Moderacion');
      setMembersToast('Aislado 5 minutos');
    }
  };

  const kickServerMember = (userId: string) => {
    if (!activeServerId || !canKickBanMembers || !activeServer) return;
    if (userId === currentUser.id || userId === activeServer.ownerId) return;
    kickMember(activeServerId, userId, 'Moderacion');
    setMembersToast('Miembro expulsado');
  };

  const banServerMember = (userId: string) => {
    if (!activeServerId || !canKickBanMembers || !activeServer) return;
    if (userId === currentUser.id || userId === activeServer.ownerId) return;
    banMember(activeServerId, userId, 'Moderacion');
    setMembersToast('Miembro baneado');
  };

  const handleServerIconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = e.target.files?.[0];
    if (!file) return;
    if (isGifFile(file)) {
      if (file.size > MAX_SERVER_ANIMATED_GIF_BYTES) {
        setServerMediaToast(`GIF muy pesado. Maximo ${formatLimitMB(MAX_SERVER_ANIMATED_GIF_BYTES)}.`);
        input.value = '';
        return;
      }
      try {
        const uploaded = await uploadMediaAsset(file, 'server-icon');
        if (uploaded?.url) {
          setServerIcon(withAssetVersion(uploaded.url));
          setServerHasChanges(true);
          setServerMediaToast('Icono GIF animado aplicado.');
          input.value = '';
          return;
        }
        const dataUrl = await readFileAsDataUrl(file);
        if (!dataUrl.startsWith('data:image/gif')) throw new Error('invalid_gif');
        setServerIcon(dataUrl);
        setServerHasChanges(true);
        setServerMediaToast('Icono GIF animado aplicado (local).');
      } catch {
        setServerMediaToast('No se pudo leer el GIF.');
      }
      input.value = '';
      return;
    }
    queueCropEditor(file, {
      target: 'server_icon',
      title: 'Adjust server icon',
      aspect: 1,
      shape: 'circle',
      outputWidth: 512,
      outputHeight: 512,
    });
    input.value = '';
  };

  const handleServerBannerUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = e.target.files?.[0];
    if (!file) return;
    if (isGifFile(file)) {
      if (file.size > MAX_SERVER_ANIMATED_GIF_BYTES) {
        setServerMediaToast(`GIF muy pesado. Maximo ${formatLimitMB(MAX_SERVER_ANIMATED_GIF_BYTES)}.`);
        input.value = '';
        return;
      }
      try {
        const uploaded = await uploadMediaAsset(file, 'server-banner');
        if (uploaded?.url) {
          setServerBanner(withAssetVersion(uploaded.url));
          setServerHasChanges(true);
          setServerMediaToast('Banner GIF animado aplicado.');
          input.value = '';
          return;
        }
        const dataUrl = await readFileAsDataUrl(file);
        if (!dataUrl.startsWith('data:image/gif')) throw new Error('invalid_gif');
        setServerBanner(dataUrl);
        setServerHasChanges(true);
        setServerMediaToast('Banner GIF animado aplicado (local).');
      } catch {
        setServerMediaToast('No se pudo leer el GIF.');
      }
      input.value = '';
      return;
    }
    queueCropEditor(file, {
      target: 'server_banner',
      title: 'Adjust server banner',
      aspect: 3,
      shape: 'rounded',
      outputWidth: 1800,
      outputHeight: 600,
    });
    input.value = '';
  };

  const saveServerStickers = (next: ServerSticker[]) => {
    if (!activeServerId) return;
    const clipped = next.slice(0, MAX_SERVER_STICKERS);
    setServerStickers(clipped);
    updateServer(activeServerId, { stickers: clipped });
  };

  const handleServerStickerUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (!file || !activeServerId) {
      input.value = '';
      return;
    }
    if (serverStickers.length >= MAX_SERVER_STICKERS) {
      setStickerToast(`Limite alcanzado (${MAX_SERVER_STICKERS}).`);
      input.value = '';
      return;
    }
    if (file.size > MAX_SERVER_STICKER_BYTES) {
      setStickerToast(`Archivo demasiado pesado. Maximo ${formatLimitMB(MAX_SERVER_STICKER_BYTES)}.`);
      input.value = '';
      return;
    }

    const baseName = file.name.split('.')[0] || 'sticker';
    const safeName = baseName.trim().toLowerCase().replace(/[^a-z0-9_ -]/g, '').replace(/\s+/g, '-').slice(0, 42) || 'sticker';
    const isAnimated = isGifFile(file);
    let stickerUrl = '';

    const uploaded = await uploadMediaAsset(file, 'server-sticker');
    if (uploaded?.url) {
      stickerUrl = uploaded.url;
    } else {
      if (file.size > MAX_LOCAL_STICKER_DATA_BYTES) {
        setStickerToast('No se pudo subir al backend. Para sticker grande, revisa backend y reintenta.');
        input.value = '';
        return;
      }
      try {
        stickerUrl = await readFileAsDataUrl(file);
      } catch {
        setStickerToast('No se pudo leer el sticker.');
        input.value = '';
        return;
      }
    }

    const nextSticker: ServerSticker = {
      id: `stk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: safeName,
      url: stickerUrl,
      contentType: file.type || (isAnimated ? 'image/gif' : 'image/webp'),
      size: file.size,
      animated: isAnimated,
      createdAt: new Date().toISOString(),
      createdBy: currentUser.id,
    };

    saveServerStickers([...serverStickers, nextSticker]);
    setStickerToast(`Sticker ${safeName} anadido.`);
    input.value = '';
  };

  const removeServerSticker = (stickerId: string) => {
    saveServerStickers(serverStickers.filter((item) => item.id !== stickerId));
    setStickerToast('Sticker eliminado.');
  };

  const handleSaveServer = () => {
    if (!activeServerId || !activeServer) return;
    if (!canEditServer) return;
    const normalizedTag = serverTag.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    const normalizedAccent = (() => {
      const value = serverAccentColor.trim();
      if (!value) return '#7A1027';
      if (/^#?[0-9a-fA-F]{6}$/.test(value)) return value.startsWith('#') ? value.toUpperCase() : `#${value.toUpperCase()}`;
      return activeServer.accentColor || '#7A1027';
    })();
    updateServer(activeServerId, {
      name: serverName.trim() || activeServer.name,
      icon: serverIcon || undefined,
      banner: serverBanner || undefined,
      description: serverDescription.trim() || undefined,
      tag: normalizedTag || undefined,
      accentColor: normalizedAccent,
    });
    setServerTag(normalizedTag);
    setServerAccentColor(normalizedAccent);
    setServerHasChanges(false);
  };

  const handleAdoptServerTag = () => {
    if (!activeServer || !serverTagStorageScope) return;
    const safeName = normalizeServerTagLabel(serverTagNameDraft || activeServer.tag || activeServer.name?.slice(0, 4) || 'NODE');
    const safeBadgeId = SERVER_TAG_BADGE_OPTIONS.some((badge) => badge.id === serverTagBadgeId)
      ? serverTagBadgeId
      : SERVER_TAG_BADGE_OPTIONS[0]?.id || 'leaf';
    const safeColor = /^#[0-9a-fA-F]{6}$/.test(serverTagColor)
      ? serverTagColor.toUpperCase()
      : SERVER_TAG_COLOR_OPTIONS[5];

    const payload = {
      enabled: serverTagFeatureEnabled,
      name: safeName,
      badgeId: safeBadgeId,
      color: safeColor,
      adopted: true,
    };
    try {
      localStorage.setItem(serverTagStorageScope, JSON.stringify(payload));
    } catch {}
    setServerTagNameDraft(safeName);
    setServerTagBadgeId(safeBadgeId);
    setServerTagColor(safeColor);
    setServerTagAdopted(true);
    setServerTagToast(language === 'es' ? 'Etiqueta adoptada' : 'Tag adopted');
  };

  const handleRequestDataExport = () => {
    if (!canRequestData) return;
    const nowIso = new Date().toISOString();
    setDataRequestAt(nowIso);
    setPrivacyToast(t(language, 'request_sent_demo'));
    try {
      localStorage.setItem(DATA_REQUEST_STORAGE_KEY, nowIso);
    } catch {}
  };

  const userServers = servers.filter(s => s.members.some(m => m.userId === currentUser.id));
  const availableServers: typeof servers = [];
  const dataRequestTs = dataRequestAt ? new Date(dataRequestAt).getTime() : NaN;
  const dataRequestCooldownEndsAt =
    Number.isNaN(dataRequestTs) ? null : dataRequestTs + DATA_REQUEST_COOLDOWN_MS;
  const dataRequestRemainingMs =
    dataRequestCooldownEndsAt && dataRequestCooldownEndsAt > Date.now()
      ? dataRequestCooldownEndsAt - Date.now()
      : 0;
  const canRequestData = dataRequestRemainingMs <= 0;
  const requestCooldownLabel = (() => {
    if (canRequestData || !dataRequestCooldownEndsAt) return '';
    const totalMinutes = Math.ceil(dataRequestRemainingMs / 60000);
    if (totalMinutes < 60) {
      return language === 'es'
        ? `Disponible en ${totalMinutes} min`
        : `Available in ${totalMinutes} min`;
    }
    const hours = Math.ceil(totalMinutes / 60);
    return language === 'es'
      ? `Disponible en ${hours} h`
      : `Available in ${hours} h`;
  })();

  const showUnsavedBar = activeTab === 'profile' && hasChanges;
  const settingsMotionKey = activeTab === 'server'
    ? `server-${activeServerId || 'none'}-${serverSection}`
    : `user-${activeTab}`;
  const selectMainTab = useCallback((tab: 'profile' | 'server' | 'servers' | 'plugins' | 'languages' | 'content_social' | 'privacy' | 'devices' | 'developer' | 'notifications' | 'voice_video') => {
    setActiveTab(tab);
    setMobileNavVisible(false);
  }, []);
  const selectServerSettingsTab = useCallback((section: typeof serverSection) => {
    setServerSection(section);
    setMobileNavVisible(false);
  }, []);
  const devices = [...(deviceSessionsByUser[currentUser.id] || [])].sort(
    (a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime()
  );
  const currentDevice = devices.find((d) => d.deviceId === activeDeviceId) || devices[0] || null;
  const otherDevices = currentDevice ? devices.filter((d) => d.id !== currentDevice.id) : devices;

  if (!mounted) return null;

  const menuSections: Array<{ label: string; items: Array<{ key: string; label: string; icon: React.ReactNode; enabled: boolean; onClick?: () => void }> }> = [
    {
      label: t(language, 'user_settings'),
      items: [
        {
          key: 'profile',
          label: t(language, 'my_account'),
          icon: <Palette size={18} className="mr-3" />,
          enabled: true,
          onClick: () => selectMainTab('profile'),
        },
        {
          key: 'content',
          label: t(language, 'content_social'),
          icon: <Users size={18} className="mr-3" />,
          enabled: true,
          onClick: () => selectMainTab('content_social'),
        },
        {
          key: 'privacy',
          label: t(language, 'data_privacy'),
          icon: <Shield size={18} className="mr-3" />,
          enabled: true,
          onClick: () => selectMainTab('privacy'),
        },
        
        {
          key: 'devices',
          label: t(language, 'devices'),
          icon: <Laptop size={18} className="mr-3" />,
          enabled: true,
          onClick: () => selectMainTab('devices'),
        },
        {
          key: 'voice_video',
          label: 'Voz y video',
          icon: <Mic size={18} className="mr-3" />,
          enabled: true,
          onClick: () => selectMainTab('voice_video'),
        },
        {
          key: 'connections',
          label: t(language, 'connections'),
          icon: <Link2 size={18} className="mr-3" />,
          enabled: false,
        },
        {
          key: 'notifications',
          label: t(language, 'notifications'),
          icon: <Bell size={18} className="mr-3" />,
          enabled: true,
          onClick: () => selectMainTab('notifications'),
        },
      ],
    },
    {
      label: t(language, 'app'),
      items: [
        {
          key: 'languages',
          label: t(language, 'languages'),
          icon: <Sparkles size={18} className="mr-3" />,
          enabled: true,
          onClick: () => selectMainTab('languages'),
        },
        {
          key: 'developer',
          label: t(language, 'developer_options'),
          icon: <Key size={18} className="mr-3" />,
          enabled: true,
          onClick: () => selectMainTab('developer'),
        },
      ],
    },
    {
      label: t(language, 'workspace'),
      items: [
        {
          key: 'servers',
          label: t(language, 'servers'),
          icon: <Plus size={18} className="mr-3" />,
          enabled: true,
          onClick: () => selectMainTab('servers'),
        },
        {
          key: 'plugins',
          label: 'Plugins',
          icon: <Puzzle size={18} className="mr-3" />,
          enabled: true,
          onClick: () => selectMainTab('plugins'),
        },
        {
          key: 'themes',
          label: t(language, 'themes'),
          icon: <Sparkles size={18} className="mr-3" />,
          enabled: false,
        },
      ],
    },
    {
      label: t(language, 'billing_settings'),
      items: [
        {
          key: 'nitro',
          label: 'Nitro',
          icon: <CreditCard size={18} className="mr-3" />,
          enabled: false,
        },
      ],
    },
  ];

  const q = menuQuery.trim().toLowerCase();
  const filteredSections = menuSections
    .map((s) => ({
      ...s,
      items: s.items.filter((it) => (q ? it.label.toLowerCase().includes(q) : true)),
    }))
    .filter((s) => s.items.length > 0);

  const serverSidebarSections: Array<{ label: string; items: Array<{ key: typeof serverSection; label: string; group?: string; danger?: boolean }> }> = [
    {
      label: activeServer?.name ? activeServer.name.toUpperCase() : t(language, 'servers').toUpperCase(),
      items: [
        { key: 'profile', label: t(language, 'server_profile') },
        { key: 'tag', label: t(language, 'server_tag') },
        { key: 'interactions', label: t(language, 'interactions') },
        { key: 'boosts', label: t(language, 'boost_perks') },
      ],
    },
    {
      label: t(language, 'expression').toUpperCase(),
      items: [
        { key: 'emojis', label: t(language, 'emojis') },
        { key: 'stickers', label: t(language, 'stickers') },
        { key: 'soundboard', label: t(language, 'soundboard') },
      ],
    },
    {
      label: t(language, 'people').toUpperCase(),
      items: [
        { key: 'members', label: t(language, 'members') },
        { key: 'roles', label: t(language, 'roles') },
        { key: 'invites', label: t(language, 'invites') },
        { key: 'access', label: t(language, 'access') },
      ],
    },
    {
      label: t(language, 'applications').toUpperCase(),
      items: [
        { key: 'integrations', label: t(language, 'integrations') },
        { key: 'app_directory', label: t(language, 'app_directory') },
      ],
    },
    {
      label: t(language, 'moderation').toUpperCase(),
      items: [
        { key: 'security', label: t(language, 'security_config') },
        ...(canViewAuditLog ? [{ key: 'audit_log' as const, label: t(language, 'audit_log') }] : []),
        { key: 'bans', label: t(language, 'bans') },
      ],
    },
    {
      label: t(language, 'community').toUpperCase(),
      items: [
        { key: 'community_overview', label: t(language, 'community_overview') },
        { key: 'onboarding', label: t(language, 'onboarding') },
        { key: 'server_insights', label: t(language, 'server_insights') },
      ],
    },
    {
      label: ' ',
      items: [
        { key: 'server_template', label: t(language, 'server_template') },
        { key: 'delete_server', label: t(language, 'delete_server'), danger: true },
      ],
    },
  ];

  return (
    <div
      className={cn(
        "fixed inset-x-0 top-0 z-[200] flex overflow-hidden transition-[opacity,transform] duration-300 ease-out",
        visible ? "opacity-100 scale-100" : "opacity-0 scale-[0.985]"
      )}
      style={{ height: modalViewportHeight ? `${modalViewportHeight}px` : '100dvh' }}
      aria-hidden={!visible}
    >
      <div
        className={cn(
          "absolute inset-0 bg-black/70 backdrop-blur-md transition-opacity duration-300",
          visible ? "opacity-100" : "opacity-0"
        )}
      />

      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="aurora-layer aurora-1" />
        <div className="aurora-layer aurora-2" />
        <div className="scanlines" />
        <div className="noise" />
      </div>

      <div
        className={cn(
          "relative w-full h-full flex flex-col lg:flex-row transition-all duration-300 ease-out",
          visible ? "scale-100" : "scale-[0.985]"
        )}
      >
      <div className="absolute inset-0 pointer-events-none hidden lg:block">
        <div className="absolute left-6 top-6 w-10 h-10 border-l border-t border-[#7A1027]/35 drop-shadow-[0_0_12px_rgba(122,16,39,0.22)] flicker-soft" />
        <div className="absolute right-6 top-6 w-10 h-10 border-r border-t border-neon-pink/20 drop-shadow-[0_0_12px_rgba(142,19,48,0.14)] flicker-soft" />
        <div className="absolute left-6 bottom-6 w-10 h-10 border-l border-b border-neon-blue/20 drop-shadow-[0_0_12px_rgba(194,24,60,0.14)] flicker-soft" />
        <div className="absolute right-6 bottom-6 w-10 h-10 border-r border-b border-[#7A1027]/30 drop-shadow-[0_0_12px_rgba(122,16,39,0.18)] flicker-soft" />
      </div>

      <div className={cn(
        "settings-nav-panel settings-scroll-root w-full lg:w-[280px] max-h-[42vh] lg:max-h-none bg-[#0B0C10]/70 glass-ruby-shell backdrop-blur-xl flex flex-col pt-[max(0.75rem,env(safe-area-inset-top))] lg:pt-14 px-3 pb-3 lg:pb-4 overflow-y-auto overscroll-contain no-scrollbar border-b lg:border-b-0 border-r-0 lg:border-r border-white/10",
        mobileNavVisible ? "flex" : "hidden lg:flex"
      )}>
        <div className="lg:hidden px-2 mb-3 flex items-center justify-between">
          <div className="text-[10px] font-black uppercase tracking-[0.16em] text-[#CFD4DA]">
            {language === 'es' ? 'Secciones' : 'Sections'}
          </div>
          <button
            onClick={() => setMobileNavVisible(false)}
            className="w-9 h-9 rounded-xl border border-white/15 bg-white/[0.03] text-white/80 hover:text-white hover:bg-white/[0.08] transition-all flex items-center justify-center"
            aria-label={language === 'es' ? 'Cerrar secciones' : 'Close sections'}
          >
            <X size={17} />
          </button>
        </div>
        {activeTab !== 'server' ? (
          <>
            <div className="px-2 mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-white/[0.06] border border-white/10 overflow-hidden flex items-center justify-center text-white font-black">
                  {currentUser.avatar ? (
                    <img src={currentUser.avatar} alt={currentUser.username} className="w-full h-full object-cover" />
                  ) : (
                    currentUser.username[0]
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-white font-semibold truncate flex items-center">
                    {currentUser.username}
                    {nitroActive ? <NitroEmblems className="ml-2" size={11} compact /> : null}
                  </div>
                  <div className="text-[11px] text-white/60 font-medium truncate">{t(language, 'user_settings')}</div>
                </div>
              </div>
            </div>

            <div className="px-2 mb-3">
              <div className="relative">
                <input
                  value={menuQuery}
                  onChange={(e) => setMenuQuery(e.target.value)}
                  placeholder={t(language, 'search')}
                  className="w-full bg-white/[0.04] border border-white/10 text-[#DBDEE1] px-3 py-2 rounded-md outline-none focus:border-[#7A1027]/60 focus:bg-white/[0.06] text-sm"
                />
              </div>
            </div>

            <div className="space-y-4">
              {filteredSections.map((section) => (
                <div key={section.label}>
                  <div className="px-2 mb-1.5 text-[11px] font-semibold text-[#949BA4] uppercase tracking-wider">
                    {section.label}
                  </div>
                  <div className="space-y-0.5">
                    {section.items.map((item) => {
                      const isActive = item.key === activeTab;
                      return (
                        <button
                          key={item.key}
                          onClick={item.enabled ? item.onClick : undefined}
                          disabled={!item.enabled}
                          className={cn(
                            "w-full flex items-center px-3 py-1.5 rounded-md text-[14px] transition-colors duration-100 group",
                            item.enabled ? "text-white/70 hover:bg-white/[0.06] hover:text-white" : "text-white/30 opacity-60 cursor-not-allowed",
                            isActive && "bg-white/[0.08] text-white"
                          )}
                        >
                          {item.icon}
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-auto pt-3 border-t border-black/20">
              <button
                onClick={() => {
                  const logout = useStore.getState().logout;
                  logout();
                  onClose();
                  window.location.reload();
                }}
                className="w-full flex items-center px-3 py-2 rounded-md text-[#F23F43] hover:bg-[#F23F43]/10 transition-colors"
              >
                <LogOut size={18} className="mr-3" />
                {t(language, 'log_out')}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="px-2 mb-4">
              <div className="text-[11px] font-black text-[#949BA4] uppercase tracking-widest">{t(language, 'server_settings').toUpperCase()}</div>
              <div className="text-white font-black truncate mt-1">{activeServer?.name || t(language, 'servers')}</div>
            </div>

            <div className="space-y-5">
              {serverSidebarSections.map((section, idx) => (
                <div key={`${section.label}-${idx}`}>
                  <div className="px-2 mb-2 text-[11px] font-black text-[#949BA4] uppercase tracking-wider">
                    {section.label}
                  </div>
                  <div className="space-y-0.5">
                    {section.items.map((item) => {
                      const isActive = item.key === serverSection;
                      return (
                        <button
                          key={item.key}
                          onClick={() => selectServerSettingsTab(item.key)}
                          className={cn(
                            'w-full flex items-center px-3 py-2 rounded-md text-[14px] transition-all duration-150',
                            item.danger
                              ? 'text-red-400 hover:bg-red-500/10'
                              : 'text-[#B5BAC1] hover:bg-[#35373C] hover:text-white',
                            isActive && 'bg-[#3F4147] text-white'
                          )}
                        >
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-auto pt-4 border-t border-white/5">
              <button
                onClick={() => selectMainTab('profile')}
                className="w-full flex items-center px-3 py-2 rounded-md text-[#B5BAC1] hover:bg-[#35373C] hover:text-white transition-all"
              >
                <Key size={18} className="mr-3" />
                {t(language, 'back_to_user_settings')}
              </button>
            </div>
          </>
        )}

      </div>

      <div className={cn(
        "settings-content-panel settings-scroll-root flex-1 bg-[#0B0C10]/55 glass-ruby-shell backdrop-blur-xl relative overflow-y-auto overscroll-contain px-4 sm:px-6 lg:px-10 pt-[max(0.65rem,env(safe-area-inset-top))] lg:pt-16 pb-[calc(7.2rem+env(safe-area-inset-bottom))] lg:pb-20 scroll-smooth custom-scrollbar",
        mobileNavVisible ? "hidden lg:block" : "block"
      )}>
        <div className="sticky top-0 z-[260] -mx-4 sm:-mx-6 px-4 sm:px-6 py-2.5 mb-2 bg-[linear-gradient(180deg,rgba(11,12,16,0.92),rgba(11,12,16,0.66),transparent)] backdrop-blur-xl lg:hidden grid grid-cols-[auto,1fr,auto] items-center gap-2">
          <button
            onClick={() => setMobileNavVisible(true)}
            className="w-9 h-9 rounded-xl border border-white/15 bg-white/[0.03] text-white/80 hover:text-white hover:bg-white/[0.08] transition-all flex items-center justify-center"
            aria-label={language === 'es' ? 'Abrir secciones' : 'Open sections'}
          >
            <Menu size={17} />
          </button>
          <div className="text-[10px] font-black uppercase tracking-[0.16em] text-[#CFD4DA] text-center truncate px-1">
            {activeTab === 'server' ? t(language, 'server_settings') : t(language, 'user_settings')}
          </div>
          <button
            onClick={handleTryClose}
            disabled={hasChanges}
            className={cn(
              "w-9 h-9 rounded-xl border flex items-center justify-center transition-all",
              hasChanges
                ? "border-neon-pink/45 text-neon-pink opacity-80"
                : "border-white/15 bg-white/[0.03] text-white/80 hover:text-white hover:bg-white/[0.08]"
            )}
            aria-label="Cerrar ajustes"
            title={hasChanges ? t(language, 'changes') : 'Cerrar'}
          >
            <X size={17} />
          </button>
        </div>
        <div key={settingsMotionKey} className="settings-section-enter max-w-full lg:max-w-[760px] mx-auto">
          
          {activeTab === 'profile' && (
            <div className="space-y-8 animate-in slide-in-from-right-4 duration-300">
              <div>
                <h1 className="text-xl font-semibold text-white">{t(language, 'my_account')}</h1>
                <div className="text-sm text-[#B5BAC1] mt-1">{t(language, 'manage_profile')}</div>
              </div>
              
              {/* Preview Card */}
              <div className="rounded-xl overflow-hidden bg-white/[0.03] border border-white/10">
                {/* Banner */}
                <div 
                  className="h-28 w-full transition-all duration-300 relative group cursor-pointer overflow-hidden"
                  style={{ 
                    backgroundColor: !(banner && !profileBannerPreviewError) ? bannerColor : undefined,
                  }}
                >
                  {banner && !profileBannerPreviewError ? (
                    <img
                      src={banner}
                      alt=""
                      aria-hidden="true"
                      className="absolute inset-0 w-full h-full object-cover"
                      loading="eager"
                      decoding="sync"
                      draggable={false}
                      onLoad={() => setProfileBannerPreviewError(false)}
                      onError={() => setProfileBannerPreviewError(true)}
                    />
                  ) : null}
                  <div className="absolute inset-0 bg-black/35 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <button 
                      onClick={() => bannerInputRef.current?.click()}
                      className="flex items-center gap-2 px-4 py-2 bg-black/40 hover:bg-black/60 rounded-md text-white font-semibold"
                    >
                      <Upload size={18} />
                      {t(language, 'change_banner')}
                    </button>
                  </div>
                  <input 
                    ref={bannerInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleBannerUpload}
                    className="hidden"
                  />
                </div>

                {/* Profile Info */}
                <div className="px-6 pb-6 relative pt-16">
                  {/* Avatar */}
                  <div className="absolute -top-10 left-6">
                    <div className="relative group">
                      <div className="w-24 h-24 rounded-full border-[6px] border-[#0B0C10] bg-[#7A1027] overflow-hidden shadow-[0_10px_40px_rgba(0,0,0,0.45)]">
                        {avatar ? (
                          <img src={avatar} alt={username} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-5xl font-bold text-white">
                            {username[0]}
                          </div>
                        )}
                      </div>
                      <button 
                        onClick={() => avatarInputRef.current?.click()}
                        className="absolute inset-0 rounded-full bg-black/35 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                      >
                        <Camera size={28} className="text-white" />
                      </button>
                      <input 
                        ref={avatarInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleAvatarUpload}
                        className="hidden"
                      />
                    </div>
                  </div>
                  
                  {/* Name and Bio */}
                  <div className="mt-14 space-y-4">
                    <div className="p-4 rounded-lg bg-white/[0.03] border border-white/10 w-full">
                      <div className="flex items-baseline gap-2 flex-wrap w-full">
                        <div className="text-xl font-semibold text-white">
                          {displayName || username}
                        </div>
                        <span className="text-[#B5BAC1] font-normal text-sm">#{currentUser.discriminator}</span>
                        {pronouns ? (
                          <span className="text-[#B5BAC1] font-normal text-sm">- {pronouns}</span>
                        ) : null}
                      </div>
                      <div className="text-sm text-[#DBDEE1] mt-3">
                        {bio || t(language, 'no_bio')}
                      </div>
                      {customStatusDraft ? (
                        <div className="mt-3 inline-flex max-w-full items-center gap-2 rounded-full bg-white/[0.04] border border-white/10 px-3 py-1 text-xs text-[#CFD4DA]">
                          <span className="w-2 h-2 rounded-full bg-neon-green" />
                          <span className="truncate">{customStatusDraft}</span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>

              {profileMediaToast ? (
                <div className="text-xs text-neon-green font-black uppercase tracking-widest">
                  {profileMediaToast}
                </div>
              ) : null}

              {/* Edit Form */}
              <div className="space-y-6 pt-6 border-t border-white/5">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-[#949BA4] uppercase tracking-wider">{t(language, 'display_name')}</label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full bg-white/[0.04] border border-white/10 text-[#DBDEE1] p-3 rounded-lg outline-none focus:ring-2 focus:ring-[#7A1027] transition-all focus:bg-white/[0.06]"
                    placeholder={username}
                  />
                  <div className="text-xs text-[#949BA4]">{t(language, 'display_name_hint')}</div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-[#949BA4] uppercase tracking-wider">{t(language, 'pronouns')}</label>
                  <input
                    type="text"
                    value={pronouns}
                    onChange={(e) => setPronouns(e.target.value)}
                    className="w-full bg-white/[0.04] border border-white/10 text-[#DBDEE1] p-3 rounded-lg outline-none focus:ring-2 focus:ring-[#7A1027] transition-all focus:bg-white/[0.06]"
                    placeholder={t(language, 'pronouns_placeholder')}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-[#949BA4] uppercase tracking-wider">{t(language, 'username_label')}</label>
                  <input 
                    type="text" 
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full bg-white/[0.04] border border-white/10 text-[#DBDEE1] p-3 rounded-lg outline-none focus:ring-2 focus:ring-[#7A1027] transition-all focus:bg-white/[0.06]"
                  />
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-bold text-[#949BA4] uppercase tracking-wider">Estado</p>
                  <div className="grid grid-cols-2 gap-2">
                    {profileStatusOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setStatusDraft(option.value)}
                        className={cn(
                          "h-10 rounded-xl border text-xs font-black uppercase tracking-widest transition-all",
                          statusDraft === option.value
                            ? "bg-[#7A1027]/35 border-[#7A1027]/60 text-white"
                            : "bg-white/[0.03] border-white/10 text-[#CFD4DA] hover:bg-white/[0.06]"
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label htmlFor="settings-custom-status" className="text-xs font-bold text-[#949BA4] uppercase tracking-wider">
                    Estado personalizado
                  </label>
                  <input
                    id="settings-custom-status"
                    type="text"
                    value={customStatusDraft}
                    onChange={(e) => setCustomStatusDraft(e.target.value.slice(0, 80))}
                    className="w-full bg-white/[0.04] border border-white/10 text-[#DBDEE1] p-3 rounded-lg outline-none focus:ring-2 focus:ring-[#7A1027] transition-all focus:bg-white/[0.06]"
                    placeholder="Ej: En ranked / Editando clips / Estudiando"
                  />
                  <div className="text-xs text-[#7b838a]">{customStatusDraft.length}/80</div>
                </div>

                <div className="space-y-4 p-4 rounded-2xl bg-white/[0.03] border border-white/10 glass-ruby-surface">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-white font-black text-sm uppercase tracking-widest">Crew Emblem Lab</div>
                      <div className="text-xs text-[#9BA1AA] mt-1">Disena tu emblema personal estilo DiavloCord.</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCrewEnabled((prev) => !prev)}
                      className={cn(
                        "w-12 h-7 rounded-full border transition-all relative",
                        crewEnabled ? "bg-[#7A1027]/75 border-[#D73A5D]" : "bg-white/[0.08] border-white/20"
                      )}
                      aria-pressed={crewEnabled}
                    >
                      <span
                        className={cn(
                          "absolute top-[3px] left-[3px] w-5 h-5 rounded-full bg-white transition-transform",
                          crewEnabled && "translate-x-5"
                        )}
                      />
                    </button>
                  </div>

                  <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                    {CREW_EMBLEM_OPTIONS.map((option) => {
                      const active = crewEmblemId === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => setCrewEmblemId(option.id)}
                          className={cn(
                            "h-11 rounded-xl border text-lg font-black transition-all inline-flex items-center justify-center",
                            active
                              ? "border-[#D73A5D] bg-[#7A1027]/35 shadow-[0_0_0_1px_rgba(215,58,93,0.45)]"
                              : "border-white/10 bg-black/25 hover:bg-white/[0.07]"
                          )}
                          title={option.label}
                        >
                          {option.glyph}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => setCrewEmblemId(CREW_CUSTOM_EMBLEM_ID)}
                      className={cn(
                        "h-11 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all inline-flex items-center justify-center",
                        crewUsingCustomEmblem
                          ? "border-[#D73A5D] bg-[#7A1027]/35 shadow-[0_0_0_1px_rgba(215,58,93,0.45)] text-white"
                          : "border-white/10 bg-black/25 text-[#CFD4DA] hover:bg-white/[0.07]"
                      )}
                      title="Custom GIF emblem"
                    >
                      GIF
                    </button>
                  </div>

                  {crewUsingCustomEmblem ? (
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3 space-y-2.5">
                      <label htmlFor="settings-crew-gif-url" className="text-[10px] font-black text-[#949BA4] uppercase tracking-widest">
                        GIF URL
                      </label>
                      <input
                        id="settings-crew-gif-url"
                        type="text"
                        value={crewCustomEmblemDraft}
                        onChange={(e) => setCrewCustomEmblemDraft(e.target.value)}
                        className="w-full bg-black/35 border border-white/10 text-[#DBDEE1] px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-[#7A1027] transition-all"
                        placeholder="https://.../emblem.gif"
                      />
                      {crewCustomEmblemDraft && !crewCustomEmblemIsGif ? (
                        <div className="text-[10px] text-[#F9B872]">
                          La URL personalizada debe apuntar a un GIF valido.
                        </div>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => crewGifInputRef.current?.click()}
                          className="px-2.5 py-1.5 rounded-lg border border-[#D73A5D]/55 bg-[#7A1027]/30 text-white text-[10px] font-black uppercase tracking-widest hover:brightness-110 transition-all"
                        >
                          Subir GIF
                        </button>
                        <input
                          ref={crewGifInputRef}
                          type="file"
                          accept="image/gif"
                          onChange={handleCrewGifUpload}
                          className="hidden"
                        />
                        <button
                          type="button"
                          onClick={() => setCrewCustomEmblemDraft('')}
                          className="px-2.5 py-1.5 rounded-lg border border-white/15 text-[#CFD4DA] text-[10px] font-black uppercase tracking-widest hover:bg-white/[0.06] transition-all"
                        >
                          Limpiar
                        </button>
                      </div>
                      <div className="text-[10px] text-[#8D95A0]">
                        GIF recomendado de menos de {Math.floor(CREW_MAX_CUSTOM_EMBLEM_FILE_BYTES / 1024)}KB para evitar errores de almacenamiento.
                      </div>
                    </div>
                  ) : null}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label htmlFor="settings-crew-name" className="text-[10px] font-black text-[#949BA4] uppercase tracking-widest">
                        Crew Name
                      </label>
                      <input
                        id="settings-crew-name"
                        type="text"
                        value={crewNameDraft}
                        onChange={(e) => setCrewNameDraft(e.target.value.slice(0, 24))}
                        className="w-full bg-black/30 border border-white/10 text-[#DBDEE1] px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-[#7A1027] transition-all"
                        placeholder="Shadow Grid"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="settings-crew-tag" className="text-[10px] font-black text-[#949BA4] uppercase tracking-widest">
                        Crew Tag
                      </label>
                      <input
                        id="settings-crew-tag"
                        type="text"
                        value={crewTagDraft}
                        onChange={(e) => setCrewTagDraft(normalizeCrewTag(e.target.value))}
                        maxLength={5}
                        className="w-full bg-black/30 border border-white/10 text-[#DBDEE1] px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-[#7A1027] transition-all font-black uppercase tracking-widest"
                        placeholder="GRID"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-[10px] font-black text-[#949BA4] uppercase tracking-widest">Aura Theme</p>
                    <div className="flex flex-wrap gap-2">
                      {CREW_AURA_OPTIONS.map((aura) => (
                        <button
                          key={aura.id}
                          type="button"
                          onClick={() => setCrewAuraDraft(aura.id)}
                          className={cn(
                            "px-2.5 py-1.5 rounded-lg border text-[10px] font-black uppercase tracking-widest transition-all",
                            crewAuraDraft === aura.id
                              ? "bg-[#7A1027]/35 border-[#D73A5D]/65 text-white"
                              : "bg-black/20 border-white/10 text-[#CFD4DA] hover:bg-white/[0.06]"
                          )}
                        >
                          {aura.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-[10px] font-black text-[#949BA4] uppercase tracking-widest">Crew Accent</p>
                    <div className="flex flex-wrap gap-2">
                      {serverAccentPresets.slice(0, 8).map((color) => (
                        <button
                          key={`crew-color-${color}`}
                          type="button"
                          onClick={() => setCrewColorDraft(color)}
                          className={cn(
                            "w-7 h-7 rounded-full border transition-all",
                            crewColorDraft.toUpperCase() === color.toUpperCase() ? "border-white/90 scale-105" : "border-white/20"
                          )}
                          style={{ backgroundColor: color }}
                          title={color}
                        />
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          const random = serverAccentPresets[Math.floor(Math.random() * serverAccentPresets.length)];
                          setCrewColorDraft(random);
                        }}
                        className="px-2.5 py-1 rounded-lg border border-white/15 text-[10px] font-black uppercase tracking-widest text-[#CFD4DA] hover:bg-white/[0.06] transition-all"
                      >
                        Random
                      </button>
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[10px] font-black uppercase tracking-widest text-[#8F97A0]">Live Preview</div>
                      <div className="mt-1 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-widest crew-badge-shell"
                        style={{
                          color: crewColorDraft,
                          borderColor: `${crewColorDraft}77`,
                          background: `linear-gradient(120deg, ${crewColorDraft}1F 0%, rgba(255,255,255,0.02) 50%, ${(crewUsingCustomEmblem ? crewColorDraft : selectedCrewPreset.accent)}14 100%)`,
                        }}
                      >
                        {crewPreviewEmblemUrl ? (
                          <span className="crew-badge-glyph crew-badge-glyph-media">
                            <img
                              src={crewPreviewEmblemUrl}
                              alt={`${computedCrewTag} emblem`}
                              className="crew-badge-glyph-image"
                              loading="lazy"
                              decoding="async"
                            />
                          </span>
                        ) : (
                          <span>{crewUsingCustomEmblem ? 'GIF' : selectedCrewPreset.glyph}</span>
                        )}
                        <span>{computedCrewTag}</span>
                        <span className="text-white/70 normal-case tracking-normal font-semibold">{computedCrewName}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleSaveCrewIdentity}
                      className="px-3 py-2 rounded-lg border border-[#D73A5D]/60 bg-[#7A1027]/35 text-white text-[10px] font-black uppercase tracking-widest hover:brightness-110 transition-all"
                    >
                      Guardar crew
                    </button>
                  </div>
                  {crewToast ? <div className="text-xs text-neon-green font-black uppercase tracking-widest">{crewToast}</div> : null}
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-[#949BA4] uppercase tracking-wider">{t(language, 'bio')}</label>
                  <textarea 
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    rows={3}
                    maxLength={190}
                    className="w-full bg-white/[0.04] border border-white/10 text-[#DBDEE1] p-3 rounded-lg outline-none focus:ring-2 focus:ring-neon-pink transition-all resize-none focus:bg-white/[0.06]"
                    placeholder={t(language, 'bio_placeholder')}
                  />
                  <div className="text-xs text-[#7b838a]">{bio.length}/190</div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-[#949BA4] uppercase tracking-wider">{t(language, 'banner_color')}</label>
                  <div className="flex gap-3 flex-wrap">
                    {['#7A1027', '#8E1330', '#C2183C', '#5A1023', '#8E1330', '#39ff14', '#F0B232', '#F23F43'].map(color => (
                      <button 
                        key={color}
                        onClick={() => setBannerColor(color)}
                        className="w-10 h-10 rounded-full border-2 transition-all transform hover:scale-110"
                        style={{ 
                          backgroundColor: color,
                          borderColor: bannerColor === color ? 'white' : 'transparent',
                          boxShadow: bannerColor === color ? `0 0 10px ${color}` : ''
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'server' && (
            <div className="space-y-8 animate-in slide-in-from-right-4 duration-300">
              {serverSection === 'profile' ? (
                <>
                  <h1 className="text-2xl font-bold text-white">{t(language, 'server_profile')}</h1>

                  {!activeServer ? (
                    <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-md shadow-sm text-[#B5BAC1] transition-shadow hover:shadow-[0_0_0_1px_rgba(122,16,39,0.22),0_0_34px_rgba(122,16,39,0.10)]">
                      {t(language, 'no_active_server')}
                    </div>
                  ) : (
                    <div className="space-y-6">
                      <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-md shadow-sm transition-all duration-200 hover:bg-white/[0.04] hover:-translate-y-[1px] hover:border-[#7A1027]/30 hover:shadow-[0_0_0_1px_rgba(122,16,39,0.22),0_0_40px_rgba(122,16,39,0.14)]">
                        <div className="fle5 rounded-xl overflow-hidden border border-white/10 bg-white/[0.03]">
                          <div
                            className="h-28 w-full relative overflow-hidden"
                            style={{
                              backgroundColor: serverAccentColor || activeServer.accentColor || '#0B0C10',
                            }}
                          >
                            {(serverBanner || activeServer.banner) ? (
                              <img
                                src={serverBanner || activeServer.banner || ''}
                                alt={`${serverName || activeServer.name} banner`}
                                className="absolute inset-0 w-full h-full object-cover"
                                loading="eager"
                                decoding="sync"
                                draggable={false}
                              />
                            ) : null}
                            <div className="absolute inset-0 bg-black/35" />
                            <div className="absolute left-4 bottom-3 flex items-center gap-3">
                              <div className="w-10 h-10 rounded-xl bg-black/40 border border-white/10 overflow-hidden flex items-center justify-center text-white font-black">
                                {serverIcon ? (
                                  <img src={serverIcon} alt={serverName || activeServer.name} className="w-full h-full object-cover" />
                                ) : activeServer.icon ? (
                                  <img src={activeServer.icon} alt={activeServer.name} className="w-full h-full object-cover" />
                                ) : (
                                  (serverName || activeServer.name)[0]
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className="text-white font-black text-sm truncate max-w-[240px]">{serverName || activeServer.name}</div>
                                {(serverTag || activeServer.tag) ? (
                                  <div className="mt-1 inline-flex items-center rounded-full bg-black/45 border border-white/15 px-2 py-0.5 text-[9px] text-white/90 font-black uppercase tracking-[0.2em]">
                                    {(serverTag || activeServer.tag || '').slice(0, 4)}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="mt-x items-center justify-between gap-6">
                          <div>
                            <div className="text-white font-black text-lg">{t(language, 'server_profile')}</div>
                            <div className="text-[#949BA4] text-sm font-medium mt-1">{t(language, 'customize_server')}</div>
                          </div>
                          <div className="w-24 h-24 rounded-2xl bg-white/5 border border-white/10 overflow-hidden flex items-center justify-center text-white font-black">
                            {serverIcon ? (
                              <img src={serverIcon} alt={serverName || activeServer.name} className="w-full h-full object-cover" />
                            ) : activeServer.icon ? (
                              <img src={activeServer.icon} alt={activeServer.name} className="w-full h-full object-cover" />
                            ) : (
                              (serverName || activeServer.name)[0]
                            )}
                          </div>
                        </div>

                        <div className="mt-6 space-y-4">
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-[#949BA4] uppercase tracking-wider">{t(language, 'name')}</label>
                            <input
                              value={serverName}
                              onChange={(e) => {
                                setServerName(e.target.value);
                                setServerHasChanges(true);
                              }}
                              disabled={!canEditServer}
                              className={cn(
                                'w-full bg-black/40 border border-white/10 text-[#DBDEE1] p-3 rounded-lg outline-none focus:ring-2 transition-all focus:bg-black/50',
                                canEditServer ? 'focus:ring-neon-blue' : 'opacity-60 cursor-not-allowed'
                              )}
                            />
                            {!canEditServer ? (
                              <div className="text-xs text-[#949BA4]">{t(language, 'owner_only')}</div>
                            ) : null}
                          </div>

                          <div className="space-y-2">
                            <label className="text-xs font-bold text-[#949BA4] uppercase tracking-wider">{t(language, 'icon')}</label>
                            <div className="flex items-center gap-3 flex-wrap">
                              <button
                                onClick={() => serverIconInputRef.current?.click()}
                                disabled={!canEditServer}
                                className={cn(
                                  'px-4 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06] text-white font-black hover:bg-white/[0.06] transition-all',
                                  !canEditServer && 'opacity-60 cursor-not-allowed'
                                )}
                              >
                                {t(language, 'change_server_icon')}
                              </button>
                              <input
                                ref={serverIconInputRef}
                                type="file"
                                accept="image/*"
                                onChange={handleServerIconUpload}
                                className="hidden"
                              />
                              <button
                                onClick={() => {
                                  if (!canEditServer) return;
                                  setServerIcon('');
                                  setServerHasChanges(true);
                                }}
                                disabled={!canEditServer}
                                className={cn(
                                  'px-4 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06] text-white/80 font-black hover:bg-white/[0.06] transition-all',
                                  !canEditServer && 'opacity-60 cursor-not-allowed'
                                )}
                              >
                                {t(language, 'remove_icon')}
                              </button>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <label className="text-xs font-bold text-[#949BA4] uppercase tracking-wider">{t(language, 'banner')}</label>
                            <div className="flex items-center gap-3 flex-wrap">
                              <button
                                onClick={() => serverBannerInputRef.current?.click()}
                                disabled={!canEditServer}
                                className={cn(
                                  'px-4 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06] text-white font-black hover:bg-white/[0.06] transition-all',
                                  !canEditServer && 'opacity-60 cursor-not-allowed'
                                )}
                              >
                                {t(language, 'change_server_banner')}
                              </button>
                              <input
                                ref={serverBannerInputRef}
                                type="file"
                                accept="image/*,image/gif"
                                onChange={handleServerBannerUpload}
                                className="hidden"
                              />
                              <button
                                onClick={() => {
                                  if (!canEditServer) return;
                                  setServerBanner('');
                                  setServerHasChanges(true);
                                }}
                                disabled={!canEditServer}
                                className={cn(
                                  'px-4 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06] text-white/80 font-black hover:bg-white/[0.06] transition-all',
                                  !canEditServer && 'opacity-60 cursor-not-allowed'
                                )}
                              >
                                {t(language, 'remove_banner')}
                              </button>
                              <div className="text-xs text-[#949BA4] font-bold uppercase tracking-widest">PNG/JPG/GIF</div>
                            </div>
                          </div>

                          {serverMediaToast ? (
                            <div className="text-xs text-neon-green font-black uppercase tracking-widest">
                              {serverMediaToast}
                            </div>
                          ) : null}

                          <div className="space-y-2">
                            <label htmlFor="settings-server-description" className="text-xs font-bold text-[#949BA4] uppercase tracking-wider">
                              Descripcion del servidor
                            </label>
                            <textarea
                              id="settings-server-description"
                              value={serverDescription}
                              onChange={(e) => {
                                setServerDescription(e.target.value.slice(0, 240));
                                setServerHasChanges(true);
                              }}
                              disabled={!canEditServer}
                              rows={3}
                              className={cn(
                                'w-full bg-black/40 border border-white/10 text-[#DBDEE1] p-3 rounded-lg outline-none resize-none focus:ring-2 transition-all focus:bg-black/50',
                                canEditServer ? 'focus:ring-neon-blue' : 'opacity-60 cursor-not-allowed'
                              )}
                              placeholder="Describe el objetivo, normas o vibe del servidor"
                            />
                            <div className="text-xs text-[#7b838a]">{serverDescription.length}/240</div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div className="space-y-2">
                              <label htmlFor="settings-server-tag" className="text-xs font-bold text-[#949BA4] uppercase tracking-wider">
                                Tag (max 4)
                              </label>
                              <input
                                id="settings-server-tag"
                                value={serverTag}
                                onChange={(e) => {
                                  const nextTag = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
                                  setServerTag(nextTag);
                                  setServerHasChanges(true);
                                }}
                                disabled={!canEditServer}
                                className={cn(
                                  'w-full bg-black/40 border border-white/10 text-[#DBDEE1] p-3 rounded-lg outline-none focus:ring-2 transition-all focus:bg-black/50 font-black tracking-widest uppercase',
                                  canEditServer ? 'focus:ring-neon-blue' : 'opacity-60 cursor-not-allowed'
                                )}
                                placeholder="ALFA"
                              />
                            </div>

                            <div className="space-y-2">
                              <label htmlFor="settings-server-accent" className="text-xs font-bold text-[#949BA4] uppercase tracking-wider">
                                Color de acento
                              </label>
                              <input
                                id="settings-server-accent"
                                value={serverAccentColor}
                                onChange={(e) => {
                                  setServerAccentColor(e.target.value);
                                  setServerHasChanges(true);
                                }}
                                disabled={!canEditServer}
                                className={cn(
                                  'w-full bg-black/40 border border-white/10 text-[#DBDEE1] p-3 rounded-lg outline-none focus:ring-2 transition-all focus:bg-black/50 font-black uppercase',
                                  canEditServer ? 'focus:ring-neon-blue' : 'opacity-60 cursor-not-allowed'
                                )}
                                placeholder="#7A1027"
                              />
                            </div>
                          </div>

                          <div className="space-y-2">
                            <div className="text-xs font-bold text-[#949BA4] uppercase tracking-wider">Paleta rapida</div>
                            <div className="flex flex-wrap gap-2">
                              {serverAccentPresets.map((color) => (
                                <button
                                  key={color}
                                  type="button"
                                  onClick={() => {
                                    if (!canEditServer) return;
                                    setServerAccentColor(color);
                                    setServerHasChanges(true);
                                  }}
                                  disabled={!canEditServer}
                                  className={cn(
                                    'w-8 h-8 rounded-full border-2 transition-all',
                                    !canEditServer && 'opacity-60 cursor-not-allowed'
                                  )}
                                  style={{
                                    backgroundColor: color,
                                    borderColor: serverAccentColor.toUpperCase() === color.toUpperCase() ? '#ffffff' : 'transparent',
                                    boxShadow:
                                      serverAccentColor.toUpperCase() === color.toUpperCase()
                                        ? `0 0 0 1px rgba(255,255,255,0.35), 0 0 12px ${color}`
                                        : 'none',
                                  }}
                                />
                              ))}
                            </div>
                          </div>

                          <div className="pt-2 flex gap-4">
                            <button
                              onClick={handleSaveServer}
                              disabled={!canEditServer || !serverHasChanges}
                              className={cn(
                                'px-8 py-2 font-bold rounded-lg transition-all duration-200',
                                canEditServer && serverHasChanges
                                  ? 'bg-neon-blue text-white hover:bg-neon-blue/90'
                                  : 'bg-neon-blue/35 text-white/70 cursor-not-allowed'
                              )}
                            >
                              {t(language, 'save')}
                            </button>
                            <button
                              onClick={() => {
                                if (!activeServer) return;
                                setServerName(activeServer.name);
                                setServerIcon(activeServer.icon || '');
                                setServerBanner(activeServer.banner || '');
                                setServerDescription(activeServer.description || '');
                                setServerTag((activeServer.tag || '').toUpperCase());
                                setServerAccentColor(activeServer.accentColor || '#7A1027');
                                setServerHasChanges(false);
                              }}
                              disabled={!serverHasChanges}
                              className={cn(
                                'px-4 py-2 font-bold transition-all',
                                serverHasChanges ? 'text-[#B5BAC1] hover:underline' : 'text-[#7b838a] cursor-not-allowed'
                              )}
                            >
                              {t(language, 'discard')}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              ) : serverSection === 'tag' ? (
                <div className="space-y-6">
                  <h1 className="text-2xl font-bold text-white">{t(language, 'server_tag')}</h1>

                  {!activeServer ? (
                    <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-md text-[#B5BAC1]">
                      {t(language, 'no_active_server')}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-5">
                      <div className="space-y-4">
                        <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-md">
                          <div className="text-white font-black text-lg">{t(language, 'server_tag')}</div>
                          <p className="text-sm text-[#B5BAC1] mt-2 max-w-[760px] leading-relaxed">
                            Crea una etiqueta para que los miembros de tu servidor puedan mostrarla junto a su nombre.
                            Cualquier persona fuera del servidor puede verla en el perfil del servidor o cuando alguien la use en chat.
                          </p>
                          <div className="mt-4 rounded-xl border border-neon-blue/35 bg-neon-blue/10 px-3 py-2.5 text-xs text-[#D9EAFF]">
                            Tu perfil de servidor es privado por defecto. Solo se mostrara si el usuario adopta la etiqueta.
                          </div>

                          <div className="mt-4 flex items-center justify-between rounded-xl border border-white/10 bg-black/25 px-4 py-3">
                            <div>
                              <div className="text-white font-black">Habilitar etiqueta del servidor</div>
                              <div className="text-xs text-[#949BA4] mt-1">
                                Activa o desactiva la etiqueta para este servidor.
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => setServerTagFeatureEnabled((prev) => !prev)}
                              className={cn(
                                "w-12 h-7 rounded-full border transition-all relative",
                                serverTagFeatureEnabled
                                  ? "bg-[#5865F2] border-[#8A92FF]"
                                  : "bg-white/[0.08] border-white/20"
                              )}
                              aria-pressed={serverTagFeatureEnabled}
                            >
                              <span
                                className={cn(
                                  "absolute top-[3px] left-[3px] w-5 h-5 rounded-full bg-white transition-transform",
                                  serverTagFeatureEnabled && "translate-x-5"
                                )}
                              />
                            </button>
                          </div>
                        </div>

                        <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-md space-y-3">
                          <div className="text-white font-black">Elige un nombre</div>
                          <div className="flex flex-col md:flex-row md:items-center gap-3">
                            <div className="w-full md:w-[240px] h-16 rounded-xl border border-white/10 bg-black/35 px-3 inline-flex items-center gap-3">
                              <div
                                className="w-9 h-9 rounded-lg border border-white/20 text-xl inline-flex items-center justify-center"
                                style={{ backgroundColor: `${serverTagColor}22`, color: serverTagColor }}
                              >
                                {selectedServerTagBadge?.glyph || '\u{1F343}'}
                              </div>
                              <input
                                value={serverTagNameDraft}
                                onChange={(e) => setServerTagNameDraft(normalizeServerTagLabel(e.target.value))}
                                maxLength={4}
                                className="w-full bg-transparent text-white text-[32px] leading-none font-black uppercase tracking-widest outline-none"
                                placeholder="TAG"
                              />
                            </div>
                            <div className="text-sm text-[#949BA4] max-w-[380px]">
                              Puedes usar hasta 4 caracteres, solo letras y numeros.
                            </div>
                          </div>
                          <div className="text-xs text-[#7b838a]">
                            {computedServerTagName.length}/4
                          </div>
                        </div>

                        <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-md space-y-3">
                          <div className="text-white font-black">Elige una insignia</div>
                          <div className="grid grid-cols-5 sm:grid-cols-6 gap-2">
                            {visibleServerTagBadges.map((badge) => {
                              const active = serverTagBadgeId === badge.id;
                              return (
                                <button
                                  key={badge.id}
                                  type="button"
                                  onClick={() => setServerTagBadgeId(badge.id)}
                                  className={cn(
                                    "h-12 rounded-xl border inline-flex items-center justify-center text-xl transition-all",
                                    active
                                      ? "bg-neon-blue/20 border-neon-blue/55 shadow-[0_0_0_1px_rgba(88,101,242,0.45)]"
                                      : "bg-black/25 border-white/10 hover:bg-white/[0.06]"
                                  )}
                                  title={badge.label}
                                >
                                  <span>{badge.glyph}</span>
                                </button>
                              );
                            })}
                          </div>
                          <button
                            type="button"
                            onClick={() => setServerTagShowAllBadges((prev) => !prev)}
                            className="inline-flex items-center gap-2 text-sm font-semibold text-[#CFD4DA] hover:text-white transition-colors"
                          >
                            {serverTagShowAllBadges ? 'Ver menos insignias' : 'Mostrar todas las insignias'}
                            <ChevronDown size={15} className={cn("transition-transform", serverTagShowAllBadges && "rotate-180")} />
                          </button>
                        </div>

                        <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-md space-y-3">
                          <div className="text-white font-black">Elige un color</div>
                          <div className="grid grid-cols-5 sm:grid-cols-6 gap-2">
                            {SERVER_TAG_COLOR_OPTIONS.map((color) => {
                              const active = serverTagColor.toUpperCase() === color.toUpperCase();
                              return (
                                <button
                                  key={color}
                                  type="button"
                                  onClick={() => setServerTagColor(color)}
                                  className={cn(
                                    "h-12 rounded-xl border transition-all relative",
                                    active
                                      ? "border-white/80 shadow-[0_0_0_1px_rgba(255,255,255,0.45)]"
                                      : "border-white/10 hover:border-white/30"
                                  )}
                                  style={{ backgroundColor: color }}
                                  title={color}
                                >
                                  {active ? <span className="absolute inset-0 m-auto w-2 h-2 rounded-full bg-white" /> : null}
                                </button>
                              );
                            })}
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              const random = SERVER_TAG_COLOR_OPTIONS[Math.floor(Math.random() * SERVER_TAG_COLOR_OPTIONS.length)];
                              setServerTagColor(random);
                            }}
                            className="px-3 py-2 rounded-lg border border-white/20 bg-white/[0.04] text-xs font-black uppercase tracking-widest text-white hover:bg-white/[0.08] transition-all"
                          >
                            Color aleatorio
                          </button>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="rounded-2xl border border-white/10 bg-[#12131A]/85 backdrop-blur-md p-4">
                          <div className="space-y-3">
                            {[
                              { name: 'Roka', text: '\u00BFalguien se apunta a un ARAM?', dim: true },
                              { name: 'hongo', text: 'me apunto', dim: true },
                              { name: currentUser.displayName || currentUser.username, text: '\u00A1echa un vistazo a mi etiqueta!', dim: false },
                              { name: 'sharon', text: '\u00BFcomo has conseguido eso?', dim: true },
                            ].map((row, idx) => (
                              <div key={`tag-preview-row-${idx}`} className="flex items-start gap-2.5">
                                <div className="w-9 h-9 rounded-full bg-white/[0.08] border border-white/10 flex items-center justify-center text-xs font-black text-white/85">
                                  {row.name[0]?.toUpperCase() || 'U'}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className={cn("text-sm font-black", row.dim ? "text-white/40" : "text-white")}>
                                      {row.name}
                                    </span>
                                    {!row.dim && serverTagFeatureEnabled ? (
                                      <span
                                        className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide"
                                        style={{
                                          color: serverTagColor,
                                          borderColor: `${serverTagColor}88`,
                                          backgroundColor: `${serverTagColor}22`,
                                        }}
                                      >
                                        <span>{selectedServerTagBadge?.glyph || '\u{1F343}'}</span>
                                        <span>{computedServerTagName || 'TAG'}</span>
                                      </span>
                                    ) : null}
                                  </div>
                                  <div className={cn("text-sm", row.dim ? "text-white/32" : "text-white/90")}>{row.text}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="rounded-2xl border border-white/10 bg-[#12131A]/85 backdrop-blur-md p-4 space-y-3">
                          <div className="text-sm text-[#B5BAC1]">
                            {serverTagAdopted
                              ? 'Ya tienes esta etiqueta en tu perfil del servidor. Puedes cambiarla cuando quieras.'
                              : 'Aun no tienes esta etiqueta del servidor en tu perfil. \u00BFQuieres adoptarla?'}
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-10 h-10 rounded-full bg-white/[0.08] border border-white/10 flex items-center justify-center text-sm font-black text-white">
                              {(currentUser.displayName || currentUser.username || 'U')[0]?.toUpperCase() || 'U'}
                            </div>
                            <div className="min-w-0">
                              <div className="text-white font-black text-sm truncate">{currentUser.displayName || currentUser.username}</div>
                              <div className="mt-1">
                                {serverTagFeatureEnabled ? (
                                  <span
                                    className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide"
                                    style={{
                                      color: serverTagColor,
                                      borderColor: `${serverTagColor}88`,
                                      backgroundColor: `${serverTagColor}22`,
                                    }}
                                  >
                                    <span>{selectedServerTagBadge?.glyph || '\u{1F343}'}</span>
                                    <span>{computedServerTagName || 'TAG'}</span>
                                  </span>
                                ) : (
                                  <span className="text-xs text-[#7b838a]">Etiqueta desactivada</span>
                                )}
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={!serverTagCanAdopt}
                            onClick={handleAdoptServerTag}
                            className={cn(
                              "w-full h-11 rounded-xl border text-sm font-black transition-all",
                              serverTagCanAdopt
                                ? "bg-[#5865F2] border-[#7682FF] text-white hover:bg-[#6270FF]"
                                : "bg-white/[0.03] border-white/10 text-[#7b838a] cursor-not-allowed"
                            )}
                          >
                            {serverTagAdopted ? 'Actualizar etiqueta' : 'Adoptar etiqueta'}
                          </button>
                          {serverTagToast ? (
                            <div className="text-xs text-neon-green font-black uppercase tracking-widest">{serverTagToast}</div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : serverSection === 'interactions' ? (
                <div className="space-y-6">
                  <h1 className="text-2xl font-bold text-white">{t(language, 'interactions')}</h1>

                  {!activeServer ? (
                    <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-md text-[#B5BAC1]">
                      {t(language, 'no_active_server')}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="p-5 rounded-2xl border border-white/10 bg-[linear-gradient(135deg,rgba(122,16,39,0.12),rgba(37,8,18,0.4),rgba(15,17,27,0.65))] backdrop-blur-xl shadow-[0_14px_40px_rgba(0,0,0,0.35)]">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="text-white font-black text-lg">Control de pulsos del servidor</div>
                            <div className="text-sm text-[#B5BAC1] mt-1">
                              Ajusta como DiavloCord notifica, activa y mueve a la comunidad.
                            </div>
                          </div>
                          <div className="px-3 py-1.5 rounded-lg border border-neon-blue/35 bg-neon-blue/10 text-neon-blue text-[10px] font-black uppercase tracking-widest">
                            LIVE NODE
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] gap-4">
                        <div className="p-5 rounded-2xl bg-[#11131A]/88 glass-ruby-surface border border-white/10 backdrop-blur-xl shadow-[0_12px_30px_rgba(0,0,0,0.35)] space-y-4">
                          <div className="text-[11px] font-black uppercase tracking-[0.2em] text-[#949BA4]">Mensaje del sistema</div>

                          {[
                            {
                              key: 'systemWelcomeRandom',
                              title: 'Bienvenida aleatoria',
                              desc: 'Lanza un mensaje de entrada con variacion de estilo cada vez que llega alguien.',
                            },
                            {
                              key: 'systemStickerReply',
                              title: 'Sticker de respuesta',
                              desc: 'Pide reaccion rapida con sticker para romper el hielo en primeras horas.',
                            },
                            {
                              key: 'systemBoostNotice',
                              title: 'Aviso de mejora',
                              desc: 'Dispara un highlight cuando alguien impulsa el servidor.',
                            },
                            {
                              key: 'systemTips',
                              title: 'Tips de configuracion',
                              desc: 'Muestra sugerencias inteligentes para pulir canales y permisos.',
                            },
                          ].map((entry) => {
                            const enabled = interactionSettings[entry.key as keyof ServerInteractionSettings] as boolean;
                            return (
                              <button
                                key={entry.key}
                                type="button"
                                onClick={() =>
                                  setInteractionSettings((prev) => ({
                                    ...prev,
                                    [entry.key]: !enabled,
                                  }))
                                }
                                className={cn(
                                  "w-full rounded-xl border p-3 text-left transition-all",
                                  enabled
                                    ? "border-neon-blue/45 bg-neon-blue/10 shadow-[0_0_0_1px_rgba(194,24,60,0.18)]"
                                    : "border-white/10 bg-black/20 hover:bg-white/[0.05]"
                                )}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="text-white font-black text-sm">{entry.title}</div>
                                    <div className="text-xs text-[#9AA0A8] mt-1 leading-relaxed">{entry.desc}</div>
                                  </div>
                                  <span
                                    className={cn(
                                      "mt-0.5 inline-flex h-6 w-11 rounded-full border transition-all relative flex-shrink-0",
                                      enabled ? "border-neon-blue/55 bg-neon-blue/30" : "border-white/20 bg-white/[0.06]"
                                    )}
                                  >
                                    <span
                                      className={cn(
                                        "absolute top-[2px] left-[2px] h-5 w-5 rounded-full bg-white transition-transform",
                                        enabled && "translate-x-[20px]"
                                      )}
                                    />
                                  </span>
                                </div>
                              </button>
                            );
                          })}

                          <div className="pt-1">
                            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#949BA4] mb-1.5">Canal de mensajes del sistema</div>
                            <GlassSelect
                              value={interactionSettings.systemChannelId}
                              placeholder="Selecciona un canal"
                              onChange={(next) => setInteractionSettings((prev) => ({ ...prev, systemChannelId: next }))}
                              options={serverChannels.map((channel) => ({
                                value: channel.id,
                                label: `# ${channel.name}`,
                              }))}
                            />
                          </div>
                        </div>

                        <div className="space-y-4">
                          <div className="p-5 rounded-2xl bg-[#11131A]/88 glass-ruby-surface border border-white/10 backdrop-blur-xl shadow-[0_12px_30px_rgba(0,0,0,0.35)] space-y-4">
                            <div className="text-[11px] font-black uppercase tracking-[0.2em] text-[#949BA4]">Actividad y notificaciones</div>

                            <button
                              type="button"
                              onClick={() =>
                                setInteractionSettings((prev) => ({
                                  ...prev,
                                  activitiesVisible: !prev.activitiesVisible,
                                }))
                              }
                              className={cn(
                                "w-full rounded-xl border p-3 text-left transition-all",
                                interactionSettings.activitiesVisible
                                  ? "border-neon-green/45 bg-neon-green/10"
                                  : "border-white/10 bg-black/20 hover:bg-white/[0.05]"
                              )}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <div className="text-sm font-black text-white">Mostrar seccion de actividades</div>
                                  <div className="text-xs text-[#9AA0A8] mt-1">Panel vivo de juegos y apps conectadas a este nodo.</div>
                                </div>
                                <div className={cn(
                                  "px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border",
                                  interactionSettings.activitiesVisible
                                    ? "border-neon-green/50 bg-neon-green/15 text-neon-green"
                                    : "border-white/20 bg-white/[0.04] text-[#9AA0A8]"
                                )}>
                                  {interactionSettings.activitiesVisible ? 'Activo' : 'Off'}
                                </div>
                              </div>
                            </button>

                            <div>
                              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#949BA4] mb-2">Notificaciones predeterminadas</div>
                              <div className="grid grid-cols-2 gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setInteractionSettings((prev) => ({ ...prev, defaultNotificationMode: 'all' }))
                                  }
                                  className={cn(
                                    "h-10 rounded-xl border text-xs font-black uppercase tracking-widest transition-all",
                                    interactionSettings.defaultNotificationMode === 'all'
                                      ? "border-neon-blue/45 bg-neon-blue/12 text-neon-blue"
                                      : "border-white/10 bg-black/20 text-[#B5BAC1] hover:bg-white/[0.05]"
                                  )}
                                >
                                  Todo
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setInteractionSettings((prev) => ({ ...prev, defaultNotificationMode: 'mentions' }))
                                  }
                                  className={cn(
                                    "h-10 rounded-xl border text-xs font-black uppercase tracking-widest transition-all",
                                    interactionSettings.defaultNotificationMode === 'mentions'
                                      ? "border-neon-blue/45 bg-neon-blue/12 text-neon-blue"
                                      : "border-white/10 bg-black/20 text-[#B5BAC1] hover:bg-white/[0.05]"
                                  )}
                                >
                                  Solo @mentions
                                </button>
                              </div>
                            </div>
                          </div>

                          <div className="p-5 rounded-2xl bg-[#11131A]/88 glass-ruby-surface border border-white/10 backdrop-blur-xl shadow-[0_12px_30px_rgba(0,0,0,0.35)] space-y-4">
                            <div className="text-[11px] font-black uppercase tracking-[0.2em] text-[#949BA4]">Inactividad y widget</div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#949BA4] mb-1.5">Canal de inactividad</div>
                                <GlassSelect
                                  value={interactionSettings.idleChannelId || '__none'}
                                  placeholder="Sin canal de inactividad"
                                  onChange={(next) =>
                                    setInteractionSettings((prev) => ({
                                      ...prev,
                                      idleChannelId: next === '__none' ? '' : next,
                                    }))
                                  }
                                  options={[
                                    { value: '__none', label: 'Sin canal de inactividad' },
                                    ...serverChannels.map((channel) => ({
                                      value: channel.id,
                                      label: `# ${channel.name}`,
                                    })),
                                  ]}
                                />
                              </div>
                              <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#949BA4] mb-1.5">Limite de inactividad</div>
                                <GlassSelect
                                  value={String(interactionSettings.idleTimeoutMinutes)}
                                  placeholder="5 minutos"
                                  onChange={(next) =>
                                    setInteractionSettings((prev) => ({
                                      ...prev,
                                      idleTimeoutMinutes: Number(next) || 5,
                                    }))
                                  }
                                  options={[
                                    { value: '5', label: '5 minutos' },
                                    { value: '10', label: '10 minutos' },
                                    { value: '15', label: '15 minutos' },
                                    { value: '30', label: '30 minutos' },
                                    { value: '60', label: '1 hora' },
                                    { value: '120', label: '2 horas' },
                                  ]}
                                />
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() =>
                                setInteractionSettings((prev) => ({
                                  ...prev,
                                  widgetEnabled: !prev.widgetEnabled,
                                }))
                              }
                              className={cn(
                                "w-full rounded-xl border p-3 text-left transition-all",
                                interactionSettings.widgetEnabled
                                  ? "border-neon-purple/45 bg-neon-purple/10"
                                  : "border-white/10 bg-black/20 hover:bg-white/[0.05]"
                              )}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <div className="text-sm font-black text-white">Widget publico del servidor</div>
                                  <div className="text-xs text-[#9AA0A8] mt-1">Expone presencia, voz e invitacion en una mini tarjeta web.</div>
                                </div>
                                <div className={cn(
                                  "px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border",
                                  interactionSettings.widgetEnabled
                                    ? "border-neon-purple/50 bg-neon-purple/15 text-neon-purple"
                                    : "border-white/20 bg-white/[0.04] text-[#9AA0A8]"
                                )}>
                                  {interactionSettings.widgetEnabled ? 'Visible' : 'Privado'}
                                </div>
                              </div>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : serverSection === 'members' ? (
                <div className="space-y-6">
                  <div className="flex items-center justify-between gap-3">
                    <h1 className="text-2xl font-bold text-white">{t(language, 'members')}</h1>
                    <div className="text-xs font-black uppercase tracking-widest text-[#7b838a]">
                      Total: {filteredMembersRows.length}
                    </div>
                  </div>

                  {!activeServer ? (
                    <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-md text-[#B5BAC1]">
                      {t(language, 'no_active_server')}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="p-4 rounded-2xl bg-[#11131A]/88 glass-ruby-surface border border-white/10 backdrop-blur-xl shadow-[0_12px_30px_rgba(0,0,0,0.35)]">
                        <div className="flex flex-col xl:flex-row xl:items-center gap-3">
                          <div className="relative flex-1 min-w-[240px]">
                            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#7b838a]" />
                            <input
                              value={membersQuery}
                              onChange={(e) => setMembersQuery(e.target.value)}
                              placeholder="Busca por nombre de usuario o ID"
                              className="w-full h-11 rounded-xl bg-black/25 border border-white/10 text-white pl-9 pr-3 outline-none focus:border-neon-blue/40 transition-all"
                            />
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              onClick={() => toggleMembersSort('name')}
                              className={cn(
                                "h-11 px-3 rounded-xl border text-xs font-black uppercase tracking-widest transition-all inline-flex items-center gap-1.5",
                                membersSortBy === 'name'
                                  ? "bg-neon-blue/16 border-neon-blue/45 text-neon-blue"
                                  : "bg-white/[0.03] border-white/10 text-[#B5BAC1] hover:bg-white/[0.06]"
                              )}
                            >
                              Nombre
                              <ArrowUpDown size={13} />
                            </button>
                            <button
                              onClick={() => toggleMembersSort('server_joined')}
                              className={cn(
                                "h-11 px-3 rounded-xl border text-xs font-black uppercase tracking-widest transition-all inline-flex items-center gap-1.5",
                                membersSortBy === 'server_joined'
                                  ? "bg-neon-blue/16 border-neon-blue/45 text-neon-blue"
                                  : "bg-white/[0.03] border-white/10 text-[#B5BAC1] hover:bg-white/[0.06]"
                              )}
                            >
                              Miembro desde
                              <ArrowUpDown size={13} />
                            </button>
                            <button
                              onClick={() => {
                                setMembersSortBy('server_joined');
                                setMembersSortDir('desc');
                                setMembersQuery('');
                                setSelectedMemberIds([]);
                              }}
                              className="h-11 px-3 rounded-xl border border-white/10 bg-white/[0.03] text-[#B5BAC1] text-xs font-black uppercase tracking-widest hover:bg-white/[0.06] transition-all"
                            >
                              Limpiar
                            </button>
                            <select
                              value={String(membersPageSize)}
                              onChange={(e) => setMembersPageSize(Number(e.target.value))}
                              className="h-11 px-3 rounded-xl border border-white/10 bg-black/25 text-white text-sm outline-none focus:border-neon-blue/40"
                            >
                              <option value="12">12 / pag</option>
                              <option value="24">24 / pag</option>
                              <option value="48">48 / pag</option>
                            </select>
                          </div>
                        </div>

                        {selectedMembersCount > 0 ? (
                          <div className="mt-3 text-[11px] font-black uppercase tracking-widest text-neon-blue">
                            Seleccionados: {selectedMembersCount}
                          </div>
                        ) : null}
                      </div>

                      <div className="rounded-2xl bg-[#11131A]/88 glass-ruby-surface border border-white/10 backdrop-blur-xl shadow-[0_12px_30px_rgba(0,0,0,0.35)] overflow-hidden">
                        <div className="md:hidden">
                          {pagedMembersRows.length === 0 ? (
                            <div className="px-5 py-8 text-[#949BA4] text-sm">No hay miembros para mostrar con este filtro.</div>
                          ) : (
                            <div className="divide-y divide-white/10">
                              {pagedMembersRows.map((row) => {
                                const statusLabel =
                                  row.user.status === 'online'
                                    ? 'En linea'
                                    : row.user.status === 'idle'
                                      ? 'Ausente'
                                      : row.user.status === 'dnd'
                                        ? 'No molestar'
                                        : 'Invisible';
                                const statusColor =
                                  row.user.status === 'online'
                                    ? '#39FF14'
                                    : row.user.status === 'idle'
                                      ? '#F1C40F'
                                      : row.user.status === 'dnd'
                                        ? '#ED4245'
                                        : '#747F8D';
                                const topRoles = row.roleObjects.slice(0, 2);
                                const extraRoles = Math.max(0, row.roleObjects.length - topRoles.length);
                                const timeoutUntil = memberTimeouts[`${activeServer.id}:${row.member.userId}`];
                                const isTimedOut = Boolean(timeoutUntil && toTimeMs(timeoutUntil) > Date.now());
                                const isOwnerMember = row.member.userId === activeServer.ownerId;
                                const isSelfMember = row.member.userId === currentUser.id;
                                const canModerateRow = !isOwnerMember && !isSelfMember;

                                return (
                                  <div key={`member-mobile-${row.member.userId}`} className="p-3 space-y-3">
                                    <div className="flex items-start gap-3">
                                      <button
                                        type="button"
                                        onClick={() => toggleSelectMember(row.member.userId)}
                                        className={cn(
                                          "w-5 h-5 rounded border transition-all mt-1 flex-shrink-0",
                                          selectedMemberIds.includes(row.member.userId)
                                            ? "bg-neon-blue/25 border-neon-blue/55 shadow-[0_0_0_1px_rgba(53,149,255,0.35)]"
                                            : "bg-white/[0.03] border-white/20 hover:border-white/40"
                                        )}
                                        title="Seleccionar miembro"
                                      />
                                      <div className="w-10 h-10 rounded-xl overflow-hidden bg-black/35 border border-white/10 flex items-center justify-center text-xs font-black text-white flex-shrink-0">
                                        {row.user.avatar ? (
                                          <img src={row.user.avatar} alt={row.user.username} className="w-full h-full object-cover" />
                                        ) : (
                                          row.user.username[0]?.toUpperCase() || '?'
                                        )}
                                      </div>
                                      <div className="min-w-0 flex-1">
                                        <div className="text-white font-black text-sm truncate inline-flex items-center gap-1.5">
                                          <span className="truncate">{row.displayName}</span>
                                          {isOwnerMember ? <span className="text-[11px]">OWNER</span> : null}
                                        </div>
                                        <div className="text-[11px] text-[#7b838a] truncate">
                                          {row.user.username} #{row.user.discriminator}
                                        </div>
                                        <div className="mt-1 inline-flex items-center gap-1 rounded-md border border-white/12 bg-black/25 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-[#D7DBDF]">
                                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: statusColor }} />
                                          {statusLabel}
                                        </div>
                                      </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                                      <div className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-2">
                                        <div className="text-[#7b838a] uppercase tracking-widest text-[9px] font-black">Miembro desde</div>
                                        <div className="text-[#DBDEE1] mt-1">{formatRelativeAgo(row.member.joinedAt)}</div>
                                      </div>
                                      <div className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-2">
                                        <div className="text-[#7b838a] uppercase tracking-widest text-[9px] font-black">Discord desde</div>
                                        <div className="text-[#DBDEE1] mt-1">{formatRelativeAgo(row.user.createdAt || null)}</div>
                                      </div>
                                    </div>

                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      {topRoles.map((role) => (
                                        <span
                                          key={`member-mobile-role-${row.member.userId}-${role.id}`}
                                          className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide"
                                          style={{
                                            color: /gradient\(/i.test(role.color || '') ? '#D7DBDF' : (role.color || '#D7DBDF'),
                                            borderColor: /gradient\(/i.test(role.color || '') ? 'rgba(255,255,255,0.2)' : `${role.color || '#D7DBDF'}66`,
                                            backgroundColor: /gradient\(/i.test(role.color || '') ? 'rgba(255,255,255,0.06)' : `${role.color || '#D7DBDF'}22`,
                                          }}
                                        >
                                          {role.name}
                                        </span>
                                      ))}
                                      {extraRoles > 0 ? (
                                        <span className="text-xs text-[#949BA4] font-black">+{extraRoles}</span>
                                      ) : null}
                                      {row.roleObjects.length === 0 ? (
                                        <span className="text-xs text-[#7b838a]">Sin roles</span>
                                      ) : null}
                                      {isTimedOut ? (
                                        <span className="inline-flex items-center gap-1 rounded-md border border-[#F1C40F]/45 bg-[#F1C40F]/15 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-[#F8DF8F]">
                                          Aislado
                                        </span>
                                      ) : null}
                                    </div>

                                    <div className="flex items-center gap-1.5">
                                      <button
                                        onClick={() => void copyMemberId(row.member.userId)}
                                        className="flex-1 h-8 rounded-lg border border-white/10 bg-black/25 text-[#CFD4DA] hover:bg-white/[0.08] transition-all text-[11px] font-black uppercase tracking-widest inline-flex items-center justify-center gap-1.5"
                                        title="Copiar ID"
                                      >
                                        <Copy size={12} />
                                        ID
                                      </button>
                                      <button
                                        disabled={!canTimeoutMembers || !canModerateRow}
                                        onClick={() => toggleMemberTimeout(row.member.userId, isTimedOut)}
                                        className={cn(
                                          "w-8 h-8 rounded-lg border transition-all flex items-center justify-center",
                                          isTimedOut
                                            ? "border-[#F1C40F]/45 bg-[#F1C40F]/15 text-[#F8DF8F]"
                                            : "border-white/10 bg-black/25 text-[#CFD4DA] hover:bg-white/[0.08]",
                                          (!canTimeoutMembers || !canModerateRow) && "opacity-45 cursor-not-allowed"
                                        )}
                                        title={isTimedOut ? 'Quitar aislamiento' : 'Aislar 5 min'}
                                      >
                                        <Clock3 size={13} />
                                      </button>
                                      <button
                                        disabled={!canKickBanMembers || !canModerateRow}
                                        onClick={() => kickServerMember(row.member.userId)}
                                        className={cn(
                                          "w-8 h-8 rounded-lg border transition-all flex items-center justify-center",
                                          "border-white/10 bg-black/25 text-[#CFD4DA] hover:bg-white/[0.08]",
                                          (!canKickBanMembers || !canModerateRow) && "opacity-45 cursor-not-allowed"
                                        )}
                                        title="Expulsar miembro"
                                      >
                                        <UserMinus size={13} />
                                      </button>
                                      <button
                                        disabled={!canKickBanMembers || !canModerateRow}
                                        onClick={() => banServerMember(row.member.userId)}
                                        className={cn(
                                          "w-8 h-8 rounded-lg border transition-all flex items-center justify-center",
                                          "border-[#F23F43]/35 bg-[#F23F43]/14 text-[#F28B8B] hover:bg-[#F23F43]/24",
                                          (!canKickBanMembers || !canModerateRow) && "opacity-45 cursor-not-allowed"
                                        )}
                                        title="Banear miembro"
                                      >
                                        <Ban size={13} />
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        <div className="hidden md:block overflow-x-auto">
                          <div className="min-w-[1120px]">
                            <div className="grid grid-cols-[34px_minmax(220px,1.4fr)_150px_150px_170px_minmax(210px,1fr)_220px] gap-3 px-4 py-3 border-b border-white/10 text-[10px] font-black uppercase tracking-[0.18em] text-[#7b838a]">
                              <button
                                type="button"
                                onClick={toggleSelectCurrentPageMembers}
                                className={cn(
                                  "w-5 h-5 rounded border transition-all",
                                  allPagedMembersSelected
                                    ? "bg-neon-blue/25 border-neon-blue/55 shadow-[0_0_0_1px_rgba(53,149,255,0.35)]"
                                    : "bg-white/[0.03] border-white/20 hover:border-white/40"
                                )}
                                title="Seleccionar pagina"
                              />
                              <button onClick={() => toggleMembersSort('name')} className="text-left inline-flex items-center gap-1.5">
                                Nombre <ArrowUpDown size={12} />
                              </button>
                              <button onClick={() => toggleMembersSort('server_joined')} className="text-left inline-flex items-center gap-1.5">
                                Miembro desde <ArrowUpDown size={12} />
                              </button>
                              <button onClick={() => toggleMembersSort('discord_joined')} className="text-left inline-flex items-center gap-1.5">
                                Se unio a Discord <ArrowUpDown size={12} />
                              </button>
                              <div className="text-left">Join method</div>
                              <div className="text-left">Roles</div>
                              <button onClick={() => toggleMembersSort('status')} className="text-left inline-flex items-center gap-1.5">
                                Senales <ArrowUpDown size={12} />
                              </button>
                            </div>

                            {pagedMembersRows.length === 0 ? (
                              <div className="px-5 py-8 text-[#949BA4] text-sm">No hay miembros para mostrar con este filtro.</div>
                            ) : (
                              pagedMembersRows.map((row) => {
                                const statusLabel =
                                  row.user.status === 'online'
                                    ? 'En linea'
                                    : row.user.status === 'idle'
                                      ? 'Ausente'
                                      : row.user.status === 'dnd'
                                        ? 'No molestar'
                                        : 'Invisible';
                                const statusColor =
                                  row.user.status === 'online'
                                    ? '#39FF14'
                                    : row.user.status === 'idle'
                                      ? '#F1C40F'
                                      : row.user.status === 'dnd'
                                        ? '#ED4245'
                                        : '#747F8D';
                                const topRoles = row.roleObjects.slice(0, 2);
                                const extraRoles = Math.max(0, row.roleObjects.length - topRoles.length);
                                const timeoutUntil = memberTimeouts[`${activeServer.id}:${row.member.userId}`];
                                const isTimedOut = Boolean(timeoutUntil && toTimeMs(timeoutUntil) > Date.now());
                                const isOwnerMember = row.member.userId === activeServer.ownerId;
                                const isSelfMember = row.member.userId === currentUser.id;
                                const canModerateRow = !isOwnerMember && !isSelfMember;
                                return (
                                  <div
                                    key={row.member.userId}
                                    className="grid grid-cols-[34px_minmax(220px,1.4fr)_150px_150px_170px_minmax(210px,1fr)_220px] gap-3 px-4 py-3 border-b border-white/5 hover:bg-white/[0.03] transition-colors"
                                  >
                                    <button
                                      type="button"
                                      onClick={() => toggleSelectMember(row.member.userId)}
                                      className={cn(
                                        "w-5 h-5 rounded border transition-all mt-1",
                                        selectedMemberIds.includes(row.member.userId)
                                          ? "bg-neon-blue/25 border-neon-blue/55 shadow-[0_0_0_1px_rgba(53,149,255,0.35)]"
                                          : "bg-white/[0.03] border-white/20 hover:border-white/40"
                                      )}
                                      title="Seleccionar miembro"
                                    />

                                    <div className="flex items-center gap-2 min-w-0">
                                      <div className="w-9 h-9 rounded-lg overflow-hidden bg-black/35 border border-white/10 flex items-center justify-center text-xs font-black text-white flex-shrink-0">
                                        {row.user.avatar ? (
                                          <img src={row.user.avatar} alt={row.user.username} className="w-full h-full object-cover" />
                                        ) : (
                                          row.user.username[0]?.toUpperCase() || '?'
                                        )}
                                      </div>
                                      <div className="min-w-0">
                                        <div className="text-white font-black text-sm truncate inline-flex items-center gap-1.5">
                                          <span className="truncate">{row.displayName}</span>
                                          {isOwnerMember ? <span className="text-[11px]">👑</span> : null}
                                        </div>
                                        <div className="text-[11px] text-[#7b838a] truncate">
                                          {row.user.username} #{row.user.discriminator}
                                        </div>
                                      </div>
                                    </div>

                                    <div className="text-sm text-[#DBDEE1] self-center">{formatRelativeAgo(row.member.joinedAt)}</div>
                                    <div className="text-sm text-[#B5BAC1] self-center">{formatRelativeAgo(row.user.createdAt || null)}</div>

                                    <div className="self-center">
                                      <span className="inline-flex items-center gap-1 rounded-md border border-white/12 bg-black/25 px-2 py-1 text-xs text-[#CFD4DA]">
                                        <Link2 size={12} />
                                        {row.member.userId.slice(0, 8)}
                                      </span>
                                    </div>

                                    <div className="flex items-center gap-1.5 flex-wrap self-center">
                                      {topRoles.map((role) => (
                                        <span
                                          key={`${row.member.userId}-${role.id}`}
                                          className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide"
                                          style={{
                                            color: /gradient\(/i.test(role.color || '') ? '#D7DBDF' : (role.color || '#D7DBDF'),
                                            borderColor: /gradient\(/i.test(role.color || '') ? 'rgba(255,255,255,0.2)' : `${role.color || '#D7DBDF'}66`,
                                            backgroundColor: /gradient\(/i.test(role.color || '') ? 'rgba(255,255,255,0.06)' : `${role.color || '#D7DBDF'}22`,
                                          }}
                                        >
                                          {role.name}
                                        </span>
                                      ))}
                                      {extraRoles > 0 ? (
                                        <span className="text-xs text-[#949BA4] font-black">+{extraRoles}</span>
                                      ) : null}
                                      {row.roleObjects.length === 0 ? (
                                        <span className="text-xs text-[#7b838a]">Sin roles</span>
                                      ) : null}
                                    </div>

                                    <div className="flex items-center justify-between gap-2 self-center">
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className="inline-flex items-center gap-1 rounded-md border border-white/12 bg-black/25 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-[#D7DBDF]">
                                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: statusColor }} />
                                          {statusLabel}
                                        </span>
                                        {isTimedOut ? (
                                          <span className="inline-flex items-center gap-1 rounded-md border border-[#F1C40F]/45 bg-[#F1C40F]/15 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-[#F8DF8F]">
                                            Aislado
                                          </span>
                                        ) : null}
                                      </div>

                                      <div className="flex items-center gap-1">
                                        <button
                                          onClick={() => void copyMemberId(row.member.userId)}
                                          className="w-7 h-7 rounded-lg border border-white/10 bg-black/25 text-[#CFD4DA] hover:bg-white/[0.08] transition-all flex items-center justify-center"
                                          title="Copiar ID"
                                        >
                                          <Copy size={13} />
                                        </button>
                                        <button
                                          disabled={!canTimeoutMembers || !canModerateRow}
                                          onClick={() => toggleMemberTimeout(row.member.userId, isTimedOut)}
                                          className={cn(
                                            "w-7 h-7 rounded-lg border transition-all flex items-center justify-center",
                                            isTimedOut
                                              ? "border-[#F1C40F]/45 bg-[#F1C40F]/15 text-[#F8DF8F]"
                                              : "border-white/10 bg-black/25 text-[#CFD4DA] hover:bg-white/[0.08]",
                                            (!canTimeoutMembers || !canModerateRow) && "opacity-45 cursor-not-allowed"
                                          )}
                                          title={isTimedOut ? 'Quitar aislamiento' : 'Aislar 5 min'}
                                        >
                                          <Clock3 size={13} />
                                        </button>
                                        <button
                                          disabled={!canKickBanMembers || !canModerateRow}
                                          onClick={() => kickServerMember(row.member.userId)}
                                          className={cn(
                                            "w-7 h-7 rounded-lg border transition-all flex items-center justify-center",
                                            "border-white/10 bg-black/25 text-[#CFD4DA] hover:bg-white/[0.08]",
                                            (!canKickBanMembers || !canModerateRow) && "opacity-45 cursor-not-allowed"
                                          )}
                                          title="Expulsar miembro"
                                        >
                                          <UserMinus size={13} />
                                        </button>
                                        <button
                                          disabled={!canKickBanMembers || !canModerateRow}
                                          onClick={() => banServerMember(row.member.userId)}
                                          className={cn(
                                            "w-7 h-7 rounded-lg border transition-all flex items-center justify-center",
                                            "border-[#F23F43]/35 bg-[#F23F43]/14 text-[#F28B8B] hover:bg-[#F23F43]/24",
                                            (!canKickBanMembers || !canModerateRow) && "opacity-45 cursor-not-allowed"
                                          )}
                                          title="Banear miembro"
                                        >
                                          <Ban size={13} />
                                        </button>
                                        <button
                                          className="w-7 h-7 rounded-lg border border-white/10 bg-black/25 text-[#CFD4DA] hover:bg-white/[0.08] transition-all flex items-center justify-center"
                                          title="Mas acciones"
                                        >
                                          <MoreVertical size={13} />
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-white/10">
                          <div className="text-sm text-[#B5BAC1]">
                            Mostrando {pagedMembersRows.length} miembros de {filteredMembersRows.length}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              disabled={normalizedMembersPage <= 1}
                              onClick={() => setMembersPage((p) => Math.max(1, p - 1))}
                              className={cn(
                                "px-2.5 py-1.5 rounded-lg border text-xs font-black uppercase tracking-widest transition-all",
                                normalizedMembersPage <= 1
                                  ? "border-white/10 bg-white/[0.02] text-[#6f747a] cursor-not-allowed"
                                  : "border-white/10 bg-black/20 text-[#CFD4DA] hover:bg-white/[0.08]"
                              )}
                            >
                              Atras
                            </button>
                            {membersVisiblePages.map((page) => (
                              <button
                                key={`members-page-${page}`}
                                onClick={() => setMembersPage(page)}
                                className={cn(
                                  "w-8 h-8 rounded-lg border text-xs font-black transition-all",
                                  page === normalizedMembersPage
                                    ? "border-neon-blue/50 bg-neon-blue/18 text-neon-blue"
                                    : "border-white/10 bg-black/20 text-[#CFD4DA] hover:bg-white/[0.08]"
                                )}
                              >
                                {page}
                              </button>
                            ))}
                            <button
                              disabled={normalizedMembersPage >= membersTotalPages}
                              onClick={() => setMembersPage((p) => Math.min(membersTotalPages, p + 1))}
                              className={cn(
                                "px-2.5 py-1.5 rounded-lg border text-xs font-black uppercase tracking-widest transition-all",
                                normalizedMembersPage >= membersTotalPages
                                  ? "border-white/10 bg-white/[0.02] text-[#6f747a] cursor-not-allowed"
                                  : "border-white/10 bg-black/20 text-[#CFD4DA] hover:bg-white/[0.08]"
                              )}
                            >
                              Siguiente
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {membersToast ? (
                    <div className="fixed bottom-8 right-10 z-[260] px-4 py-2 rounded-xl bg-[#0B0C10]/90 border border-neon-blue/30 text-neon-blue font-black uppercase tracking-widest text-[10px] shadow-[0_0_22px_rgba(194,24,60,0.18)]">
                      {membersToast}
                    </div>
                  ) : null}
                </div>
              ) : serverSection === 'roles' ? (
                <div className="space-y-6">
                  <h1 className="text-2xl font-bold text-white">{t(language, 'roles')}</h1>

                  {!activeServer ? (
                    <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-md text-[#B5BAC1]">
                      {t(language, 'no_active_server')}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-4">
                        <div className="p-5 rounded-2xl bg-[#11131A]/88 glass-ruby-surface border border-white/10 backdrop-blur-xl shadow-[0_12px_30px_rgba(0,0,0,0.35)] space-y-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-[11px] font-black uppercase tracking-[0.2em] text-[#949BA4]">Roles del servidor</div>
                            <button
                              onClick={handleCreateRole}
                              disabled={!canManageRoles}
                              className={cn(
                                "px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all",
                                canManageRoles
                                  ? "bg-neon-green/15 border-neon-green/40 text-neon-green hover:bg-neon-green/25"
                                  : "bg-white/[0.03] border-white/10 text-[#7b838a] cursor-not-allowed"
                              )}
                            >
                              Crear rol
                            </button>
                          </div>

                          {sortedServerRoles.length === 0 ? (
                            <div className="text-sm text-[#949BA4]">No hay roles creados.</div>
                          ) : (
                            <div className="space-y-1.5 max-h-[500px] overflow-y-auto pr-1 custom-scrollbar">
                              {sortedServerRoles.map((role) => {
                                const isActive = selectedRole?.id === role.id;
                                return (
                                  <button
                                    key={role.id}
                                    onClick={() => setSelectedRoleId(role.id)}
                                    className={cn(
                                      "w-full px-3 py-2 rounded-xl border text-left transition-all",
                                      isActive
                                        ? "border-neon-blue/45 bg-neon-blue/12"
                                        : "border-white/10 bg-black/20 hover:bg-white/[0.05]"
                                    )}
                                  >
                                    <div className="flex items-center justify-between gap-3">
                                      <div className="flex items-center gap-2 min-w-0">
                                        <span
                                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                          style={{
                                            backgroundColor: /gradient\(/i.test(role.color || '') ? undefined : (role.color || '#B5BAC1'),
                                            backgroundImage: /gradient\(/i.test(role.color || '') ? role.color : undefined,
                                          }}
                                        />
                                        <span
                                          className={cn(
                                            "text-sm font-black truncate",
                                            role.nameEffect === 'pulse' && 'role-name-pulse',
                                            role.nameEffect === 'neon' && 'role-name-neon',
                                            role.nameEffect === 'rainbow' && 'role-name-rainbow',
                                            role.nameEffect === 'glitch' && 'role-name-glitch',
                                            role.nameEffect === 'shimmer' && 'role-name-shimmer'
                                          )}
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
                                      </div>
                                      <span className="text-[10px] font-black uppercase tracking-widest text-[#7b838a]">
                                        {role.permissions.length} perms
                                      </span>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        <div className="p-5 rounded-2xl bg-[#11131A]/88 glass-ruby-surface border border-white/10 backdrop-blur-xl shadow-[0_12px_30px_rgba(0,0,0,0.35)]">
                          {!selectedRole ? (
                            <div className="text-sm text-[#949BA4]">Selecciona un rol para editarlo.</div>
                          ) : (
                            <div className="space-y-5 max-h-[700px] overflow-y-auto pr-1 custom-scrollbar">
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <div className="text-white font-black text-lg">Editor de rol</div>
                                  <div className="text-[#949BA4] text-sm mt-1">Nombre, color, permisos y miembros.</div>
                                </div>
                                <button
                                  onClick={handleDeleteSelectedRole}
                                  disabled={!canManageRoles}
                                  className={cn(
                                    "px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all",
                                    canManageRoles
                                      ? "bg-neon-pink/12 border-neon-pink/40 text-neon-pink hover:bg-neon-pink/20"
                                      : "bg-white/[0.03] border-white/10 text-[#7b838a] cursor-not-allowed"
                                  )}
                                >
                                  Eliminar rol
                                </button>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_140px] gap-3">
                                <div>
                                  <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#949BA4] mb-1.5">Nombre del rol</div>
                                  <input
                                    value={roleNameDraft}
                                    onChange={(e) => setRoleNameDraft(e.target.value)}
                                    disabled={!canManageRoles}
                                    className={cn(
                                      "w-full bg-black/30 border border-white/10 text-white rounded-xl px-3 py-2.5 outline-none transition-all",
                                      canManageRoles ? "focus:border-neon-blue/40" : "opacity-60 cursor-not-allowed"
                                    )}
                                  />
                                </div>
                                <div>
                                  <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#949BA4] mb-1.5">Color base</div>
                                  <input
                                    type="color"
                                    value={roleColorDraft.startsWith('#') ? roleColorDraft : '#B5BAC1'}
                                    onChange={(e) => setRoleColorDraft(e.target.value)}
                                    disabled={!canManageRoles}
                                    className={cn(
                                      "w-full h-[42px] rounded-xl border border-white/10 bg-black/30 px-1.5",
                                      !canManageRoles && "opacity-60 cursor-not-allowed"
                                    )}
                                  />
                                </div>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_220px] gap-3">
                                <div>
                                  <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#949BA4] mb-1.5">Color avanzado (HEX/RGB/gradiente)</div>
                                  <input
                                    value={roleColorDraft}
                                    onChange={(e) => setRoleColorDraft(e.target.value)}
                                    placeholder="#FF4D8D o rgb(255,0,120) o linear-gradient(...)"
                                    disabled={!canManageRoles}
                                    className={cn(
                                      "w-full bg-black/30 border border-white/10 text-white rounded-xl px-3 py-2.5 outline-none transition-all",
                                      canManageRoles ? "focus:border-neon-blue/40" : "opacity-60 cursor-not-allowed"
                                    )}
                                  />
                                  <div className="mt-2 flex flex-wrap gap-1.5">
                                    {roleColorPresets.map((preset) => (
                                      <button
                                        key={preset.label}
                                        type="button"
                                        onClick={() => setRoleColorDraft(preset.value)}
                                        disabled={!canManageRoles}
                                        className={cn(
                                          "px-2.5 py-1.5 rounded-lg border text-[9px] font-black uppercase tracking-widest transition-all",
                                          canManageRoles
                                            ? "bg-white/[0.03] border-white/10 text-[#DBDEE1] hover:border-neon-blue/35 hover:bg-white/[0.06]"
                                            : "bg-white/[0.02] border-white/10 text-[#7b838a] cursor-not-allowed"
                                        )}
                                      >
                                        {preset.label}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#949BA4] mb-1.5">Animacion del nombre</div>
                                  <GlassSelect
                                    value={roleEffectDraft}
                                    placeholder="Sin animacion"
                                    onChange={(nextValue) => setRoleEffectDraft(nextValue as RoleNameEffect)}
                                    disabled={!canManageRoles}
                                    options={roleEffectOptions.map((option) => ({
                                      value: option.key,
                                      label: option.label,
                                    }))}
                                  />
                                </div>
                              </div>

                              <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
                                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#949BA4] mb-1">Preview</div>
                                <div className={cn("text-sm font-black tracking-tight", roleEffectDraft === 'pulse' && 'role-name-pulse', roleEffectDraft === 'neon' && 'role-name-neon', roleEffectDraft === 'rainbow' && 'role-name-rainbow', roleEffectDraft === 'glitch' && 'role-name-glitch', roleEffectDraft === 'shimmer' && 'role-name-shimmer')} style={{
                                  color: /gradient\(/i.test(roleColorDraft) ? undefined : roleColorDraft,
                                  backgroundImage: /gradient\(/i.test(roleColorDraft) ? roleColorDraft : undefined,
                                  WebkitBackgroundClip: /gradient\(/i.test(roleColorDraft) ? 'text' : undefined,
                                  backgroundClip: /gradient\(/i.test(roleColorDraft) ? 'text' : undefined,
                                  WebkitTextFillColor: /gradient\(/i.test(roleColorDraft) ? 'transparent' : undefined,
                                }}>
                                  {roleNameDraft || 'Nombre de rol'}
                                </div>
                              </div>

                              <div className="flex justify-end">
                                <button
                                  onClick={handleSaveRoleDraft}
                                  disabled={!canManageRoles}
                                  className={cn(
                                    "px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all",
                                    canManageRoles
                                      ? "bg-neon-blue/15 border-neon-blue/40 text-neon-blue hover:bg-neon-blue/25"
                                      : "bg-white/[0.03] border-white/10 text-[#7b838a] cursor-not-allowed"
                                  )}
                                >
                                  Guardar rol
                                </button>
                              </div>

                              <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#949BA4] mb-2">Permisos del rol</div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                  {rolePermissionRows.map((perm) => {
                                    const enabled = selectedRole.permissions.includes(perm.key);
                                    return (
                                      <button
                                        key={perm.key}
                                        onClick={() => handleToggleRolePermission(perm.key, !enabled)}
                                        disabled={!canManageRoles}
                                        className={cn(
                                          "px-3 py-2 rounded-xl border text-left transition-all",
                                          enabled
                                            ? "border-neon-green/40 bg-neon-green/10 text-neon-green"
                                            : "border-white/10 bg-black/20 text-[#B5BAC1]",
                                          canManageRoles
                                            ? "hover:bg-white/[0.07]"
                                            : "opacity-60 cursor-not-allowed"
                                        )}
                                      >
                                        <div className="text-xs font-black uppercase tracking-widest">{perm.label}</div>
                                        <div className="text-[10px] mt-0.5 opacity-70">{perm.key}</div>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>

                              <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#949BA4] mb-2">Miembros con este rol</div>
                                <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1 custom-scrollbar">
                                  {activeServer.members.map((member) => {
                                    const memberUser = users.find((u) => u.id === member.userId);
                                    if (!memberUser) return null;
                                    const assigned = member.roleIds.includes(selectedRole.id);
                                    return (
                                      <button
                                        key={member.userId}
                                        onClick={() => setMemberRole(activeServer.id, member.userId, selectedRole.id, !assigned)}
                                        disabled={!canManageRoles}
                                        className={cn(
                                          "w-full px-3 py-2 rounded-xl border flex items-center justify-between gap-3 transition-all",
                                          assigned
                                            ? "border-neon-blue/40 bg-neon-blue/12"
                                            : "border-white/10 bg-black/20",
                                          canManageRoles
                                            ? "hover:bg-white/[0.06]"
                                            : "opacity-60 cursor-not-allowed"
                                        )}
                                      >
                                        <div className="flex items-center gap-2 min-w-0">
                                          <div className="w-7 h-7 rounded-lg overflow-hidden bg-black/35 border border-white/10 flex items-center justify-center text-[11px] font-black text-white">
                                            {memberUser.avatar ? (
                                              <img src={memberUser.avatar} alt={memberUser.username} className="w-full h-full object-cover" />
                                            ) : (
                                              memberUser.username[0]?.toUpperCase() || '?'
                                            )}
                                          </div>
                                          <div className="min-w-0 text-left">
                                            <div className="text-sm font-black text-white truncate">{memberUser.username}</div>
                                            <div className="text-[10px] uppercase tracking-widest text-[#7b838a] truncate">{memberUser.id}</div>
                                          </div>
                                        </div>
                                        <span className={cn("text-[10px] font-black uppercase tracking-widest", assigned ? "text-neon-blue" : "text-[#7b838a]")}>
                                          {assigned ? 'Asignado' : 'Sin rol'}
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="p-5 rounded-2xl bg-[#11131A]/88 glass-ruby-surface border border-white/10 backdrop-blur-xl shadow-[0_12px_30px_rgba(0,0,0,0.35)]">
                        <div className="text-[11px] font-black uppercase tracking-[0.2em] text-[#949BA4] mb-3">
                          Comandos de administracion y permisos
                        </div>
                        <div className="space-y-2">
                          {SERVER_COMMANDS.map((cmd) => {
                            const requiredLabel = cmd.requiredPermission
                              ? (rolePermissionRows.find((row) => row.key === cmd.requiredPermission)?.label || cmd.requiredPermission)
                              : 'Sin permiso especial';
                            const activeForRole = selectedRole
                              ? !cmd.requiredPermission || selectedRole.permissions.includes(cmd.requiredPermission)
                              : false;
                            return (
                              <div key={cmd.name} className="rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-white font-black text-sm truncate">{cmd.usage}</div>
                                  <div className="text-[11px] text-[#B5BAC1] mt-0.5 truncate">{cmd.description}</div>
                                </div>
                                <div className="text-right flex-shrink-0">
                                  <div className="text-[10px] uppercase tracking-widest text-[#7b838a]">{requiredLabel}</div>
                                  {selectedRole ? (
                                    <div className={cn("text-[10px] font-black uppercase tracking-widest mt-0.5", activeForRole ? "text-neon-green" : "text-neon-pink")}>
                                      {activeForRole ? 'Permitido' : 'Bloqueado'}
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}

                  {roleToast ? (
                    <div className="fixed bottom-8 right-10 z-[260] px-4 py-2 rounded-xl bg-[#0B0C10]/90 border border-neon-blue/30 text-neon-blue font-black uppercase tracking-widest text-[10px] shadow-[0_0_22px_rgba(194,24,60,0.18)]">
                      {roleToast}
                    </div>
                  ) : null}
                </div>
              ) : serverSection === 'emojis' ? (
                <div className="space-y-6">
                  <div className="flex items-center justify-between gap-4">
                    <h1 className="text-2xl font-bold text-white">{t(language, 'emojis')}</h1>
                    <button
                      onClick={() => setEmojiAnimations((v) => !v)}
                      className={cn(
                        "px-4 py-2 rounded-xl border font-black uppercase tracking-widest text-[10px] transition-all",
                        emojiAnimations
                          ? "text-neon-green border-neon-green/40 bg-neon-green/10 shadow-[0_0_16px_rgba(0,255,148,0.15)]"
                          : "text-[#B5BAC1] border-white/10 bg-white/[0.03]"
                      )}
                    >
                      {emojiAnimations ? 'Animacion ON' : 'Animacion OFF'}
                    </button>
                  </div>

                  <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-md">
                    <div className="relative">
                      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#7b838a]" />
                      <input
                        value={emojiQuery}
                        onChange={(e) => setEmojiQuery(e.target.value)}
                        placeholder="Buscar emoji por nombre..."
                        className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-white outline-none focus:border-neon-blue/30 transition-all"
                      />
                    </div>
                  </div>

                  <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-md">
                    <div className="text-[11px] font-black text-[#949BA4] uppercase tracking-[0.2em] mb-3">Favoritos</div>
                    {favoriteServerEmojis.length === 0 ? (
                      <div className="text-sm text-[#949BA4]">No tienes favoritos todavia.</div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {favoriteServerEmojis.map((emoji, idx) => (
                          <button
                            key={`fav-${emoji}-${idx}`}
                            onClick={() => {
                              navigator.clipboard.writeText(emoji).catch(() => {});
                              setEmojiToast(`Copiado ${emoji}`);
                            }}
                            className="w-12 h-12 rounded-xl border border-white/10 bg-black/30 hover:border-neon-blue/30 hover:bg-white/[0.06] transition-all flex items-center justify-center"
                          >
                            <span
                              className={cn("text-2xl", emojiAnimations && "float-slow")}
                              style={emojiAnimations ? { animationDelay: `${idx * 90}ms` } : undefined}
                            >
                              {emoji}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-md">
                    <div className="text-[11px] font-black text-[#949BA4] uppercase tracking-[0.2em] mb-3">Biblioteca</div>
                    <div className="grid grid-cols-4 md:grid-cols-6 gap-2">
                      {filteredServerEmojis.map((item, idx) => {
                        const isFavorite = favoriteServerEmojis.includes(item.emoji);
                        return (
                          <div
                            key={`${item.emoji}-${item.name}`}
                            className="group relative rounded-xl border border-white/10 bg-black/25 hover:border-neon-blue/30 hover:bg-white/[0.05] transition-all p-2"
                          >
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(item.emoji).catch(() => {});
                                setEmojiToast(`Copiado ${item.emoji}`);
                              }}
                              className="w-full h-12 flex items-center justify-center"
                            >
                              <span
                                className={cn("text-3xl", emojiAnimations && "float-slow")}
                                style={emojiAnimations ? { animationDelay: `${idx * 70}ms` } : undefined}
                              >
                                {item.emoji}
                              </span>
                            </button>
                            <div className="text-center text-[10px] font-black text-[#7b838a] uppercase tracking-widest truncate">{item.name}</div>
                            <div className="mt-1 flex items-center justify-between">
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(item.emoji).catch(() => {});
                                  setEmojiToast(`Copiado ${item.emoji}`);
                                }}
                                className="w-7 h-7 rounded-lg bg-white/[0.03] border border-white/10 text-[#B5BAC1] hover:text-white hover:bg-white/[0.08] transition-all flex items-center justify-center"
                                title="Copiar emoji"
                              >
                                <Copy size={12} />
                              </button>
                              <button
                                onClick={() => {
                                  setFavoriteServerEmojis((prev) =>
                                    prev.includes(item.emoji)
                                      ? prev.filter((e) => e !== item.emoji)
                                      : [...prev, item.emoji].slice(0, 12)
                                  );
                                }}
                                className={cn(
                                  "w-7 h-7 rounded-lg border transition-all flex items-center justify-center",
                                  isFavorite
                                    ? "bg-neon-blue/20 border-neon-blue/40 text-neon-blue"
                                    : "bg-white/[0.03] border-white/10 text-[#B5BAC1] hover:text-white hover:bg-white/[0.08]"
                                )}
                                title="Favorito"
                              >
                                <Star size={12} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-md">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div className="text-[11px] font-black text-[#949BA4] uppercase tracking-[0.2em]">Custom Emojis</div>
                      <button
                        onClick={() => customEmojiInputRef.current?.click()}
                        className="px-3 py-2 rounded-xl bg-white/[0.04] border border-neon-blue/30 text-neon-blue font-black uppercase tracking-widest text-[10px] hover:bg-neon-blue/10 transition-all"
                      >
                        Subir emoji
                      </button>
                      <input
                        ref={customEmojiInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        onChange={handleCustomEmojiUpload}
                        className="hidden"
                      />
                    </div>

                    {customServerEmojis.length === 0 ? (
                      <div className="text-sm text-[#949BA4]">Sube PNG/JPG/WEBP/GIF y apareceran en el picker del chat.</div>
                    ) : (
                      <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
                        {customServerEmojis.map((item, idx) => (
                          <div key={item.id} className="group relative rounded-xl border border-white/10 bg-black/25 p-2">
                            <div className="w-full aspect-square rounded-lg overflow-hidden border border-white/10 bg-black/30 flex items-center justify-center">
                              <img
                                src={item.url}
                                alt={item.name}
                                className={cn("w-full h-full object-cover", item.animated && emojiAnimations && "float-slow")}
                                style={item.animated && emojiAnimations ? { animationDelay: `${idx * 60}ms` } : undefined}
                              />
                            </div>
                            <div className="mt-1 text-[10px] font-black text-[#B5BAC1] uppercase tracking-widest truncate">{item.name}</div>
                            <button
                              onClick={() => {
                                const next = customServerEmojis.filter((e) => e.id !== item.id);
                                saveCustomEmojis(next);
                                setEmojiToast(`Emoji ${item.name} eliminado`);
                              }}
                              className="absolute top-2 right-2 w-6 h-6 rounded-lg bg-black/70 border border-white/20 text-white/80 hover:text-neon-pink hover:border-neon-pink/40 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100"
                              title="Eliminar emoji"
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {emojiToast ? (
                    <div className="fixed bottom-8 right-10 z-[260] px-4 py-2 rounded-xl bg-[#0B0C10]/90 border border-neon-blue/30 text-neon-blue font-black uppercase tracking-widest text-[10px] shadow-[0_0_22px_rgba(194,24,60,0.18)]">
                      {emojiToast}
                    </div>
                  ) : null}
                </div>
              ) : serverSection === 'stickers' ? (
                <div className="space-y-6">
                  <div className="flex items-center justify-between gap-4">
                    <h1 className="text-2xl font-bold text-white">{t(language, 'stickers')}</h1>
                    <button
                      onClick={() => serverStickerInputRef.current?.click()}
                      disabled={!canEditServer}
                      className={cn(
                        'px-4 py-2 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all',
                        canEditServer
                          ? 'border-neon-blue/40 bg-neon-blue/10 text-neon-blue hover:bg-neon-blue/18'
                          : 'border-white/10 bg-white/[0.03] text-[#7f8790] cursor-not-allowed'
                      )}
                    >
                      Subir sticker
                    </button>
                  </div>

                  <input
                    ref={serverStickerInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={handleServerStickerUpload}
                    className="hidden"
                  />

                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-md p-4">
                    <div className="relative">
                      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#7b838a]" />
                      <input
                        value={stickerQuery}
                        onChange={(e) => setStickerQuery(e.target.value)}
                        placeholder="Buscar sticker por nombre..."
                        className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-white outline-none focus:border-neon-blue/35 transition-all"
                      />
                    </div>
                    <div className="mt-3 text-[10px] font-black uppercase tracking-[0.2em] text-[#8f97a1]">
                      {serverStickers.length}/{MAX_SERVER_STICKERS} stickers personalizados
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-md p-5">
                    {filteredServerStickers.length === 0 ? (
                      <div className="text-sm text-[#949BA4]">
                        {serverStickers.length === 0
                          ? 'No hay stickers todavia. Sube PNG/JPG/WEBP/GIF para usarlos en el chat del servidor.'
                          : 'No hay resultados para esa busqueda.'}
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                        {filteredServerStickers.map((item, idx) => (
                          <div
                            key={item.id}
                            className="group relative rounded-2xl border border-white/10 bg-black/30 overflow-hidden"
                          >
                            <div className="aspect-square bg-black/45 flex items-center justify-center">
                              <img
                                src={item.url}
                                alt={item.name}
                                className={cn(
                                  'w-full h-full object-cover',
                                  item.animated && 'float-slow'
                                )}
                                style={item.animated ? { animationDelay: `${idx * 60}ms` } : undefined}
                              />
                            </div>
                            <div className="px-2.5 py-2">
                              <div className="text-xs font-black text-white truncate">{item.name}</div>
                              <div className="mt-1 text-[10px] uppercase tracking-widest text-[#8f97a1]">
                                {item.animated ? 'GIF' : item.contentType.replace('image/', '').toUpperCase()}
                              </div>
                            </div>
                            {canEditServer ? (
                              <button
                                onClick={() => removeServerSticker(item.id)}
                                className="absolute top-2 right-2 w-7 h-7 rounded-lg border border-white/20 bg-black/60 text-white/80 hover:text-neon-pink hover:border-neon-pink/40 transition-all opacity-0 group-hover:opacity-100 flex items-center justify-center"
                                title="Eliminar sticker"
                              >
                                <Trash2 size={12} />
                              </button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-[#B5BAC1]">
                    Los stickers se guardan a nivel de servidor y aparecen en el picker del chat para todos los miembros.
                  </div>

                  {stickerToast ? (
                    <div className="fixed bottom-8 right-10 z-[260] px-4 py-2 rounded-xl bg-[#0B0C10]/90 border border-neon-blue/30 text-neon-blue font-black uppercase tracking-widest text-[10px] shadow-[0_0_22px_rgba(194,24,60,0.18)]">
                      {stickerToast}
                    </div>
                  ) : null}
                </div>
              ) : serverSection === 'invites' ? (
                <div className="space-y-6">
                  <h1 className="text-2xl font-bold text-white">{t(language, 'invites')}</h1>

                  {!activeServer ? (
                    <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-md text-[#B5BAC1]">
                      {t(language, 'no_active_server')}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-md space-y-4">
                        <div>
                          <div className="text-white font-black text-lg">{t(language, 'invite_manager')}</div>
                          <div className="text-[#949BA4] text-sm mt-1">Crea enlaces con caducidad y limite de usos.</div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#949BA4] mb-1.5">
                              {t(language, 'invite_expires')}
                            </div>
                            <select
                              value={inviteExpiryHours}
                              onChange={(e) => setInviteExpiryHours(Number(e.target.value))}
                              disabled={!canEditServer}
                              className={cn(
                                "w-full bg-black/30 border border-white/10 text-white rounded-xl px-3 py-2.5 outline-none transition-all",
                                canEditServer ? "focus:border-neon-blue/40" : "opacity-60 cursor-not-allowed"
                              )}
                            >
                              <option value={0}>{t(language, 'invite_unlimited')}</option>
                              <option value={1}>1 hora</option>
                              <option value={6}>6 horas</option>
                              <option value={12}>12 horas</option>
                              <option value={24}>24 horas</option>
                              <option value={72}>3 dias</option>
                              <option value={168}>7 dias</option>
                              <option value={720}>30 dias</option>
                            </select>
                          </div>

                          <div>
                            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#949BA4] mb-1.5">
                              {t(language, 'invite_max_uses')}
                            </div>
                            <select
                              value={inviteMaxUses}
                              onChange={(e) => setInviteMaxUses(Number(e.target.value))}
                              disabled={!canEditServer}
                              className={cn(
                                "w-full bg-black/30 border border-white/10 text-white rounded-xl px-3 py-2.5 outline-none transition-all",
                                canEditServer ? "focus:border-neon-blue/40" : "opacity-60 cursor-not-allowed"
                              )}
                            >
                              <option value={0}>{t(language, 'invite_unlimited')}</option>
                              <option value={1}>1</option>
                              <option value={5}>5</option>
                              <option value={10}>10</option>
                              <option value={25}>25</option>
                              <option value={50}>50</option>
                              <option value={100}>100</option>
                            </select>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-3">
                          {!canEditServer ? (
                            <div className="text-xs text-[#949BA4]">{t(language, 'owner_only')}</div>
                          ) : (
                            <div className="text-xs text-[#949BA4]">Se copia automaticamente al crear.</div>
                          )}
                          <button
                            onClick={() => void handleCreateServerInvite()}
                            disabled={!canEditServer}
                            className={cn(
                              "px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all",
                              canEditServer
                                ? "bg-neon-green/15 border-neon-green/40 text-neon-green hover:bg-neon-green/25"
                                : "bg-white/[0.03] border-white/10 text-[#7b838a] cursor-not-allowed"
                            )}
                          >
                            {t(language, 'create_invite')}
                          </button>
                        </div>
                      </div>

                      <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-md">
                        <div className="text-[11px] font-black uppercase tracking-[0.2em] text-[#949BA4] mb-3">
                          {t(language, 'invites')}
                        </div>

                        {activeServerInvites.length === 0 ? (
                          <div className="text-sm text-[#949BA4]">{t(language, 'no_invites_yet')}</div>
                        ) : (
                          <div className="space-y-2 max-h-[440px] overflow-y-auto pr-1">
                            {activeServerInvites.map((invite) => {
                              const expired = isInviteExpired(invite.expiresAt);
                              const maxed = isInviteMaxed(invite.uses, invite.maxUses);
                              const revoked = Boolean(invite.revoked);
                              const status = revoked
                                ? t(language, 'invite_revoked')
                                : expired
                                  ? t(language, 'invite_expired')
                                  : maxed
                                    ? t(language, 'invite_maxed')
                                    : t(language, 'invite_active');

                              return (
                                <div key={invite.code} className="rounded-xl border border-white/10 bg-black/25 px-3 py-2.5">
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="text-white font-black text-sm truncate">{`/invite/${invite.code}`}</div>
                                      <div className="text-[10px] font-black uppercase tracking-widest text-[#7b838a] mt-1">
                                        {status}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                      <button
                                        onClick={() => void handleCopyInvite(invite.code)}
                                        className="w-8 h-8 rounded-lg bg-white/[0.03] border border-white/10 text-[#B5BAC1] hover:text-white hover:bg-white/[0.08] transition-all flex items-center justify-center"
                                        title={t(language, 'copy_id')}
                                      >
                                        <Copy size={13} />
                                      </button>
                                      <button
                                        onClick={() => handleRevokeInvite(invite.code)}
                                        disabled={!canEditServer || revoked}
                                        className={cn(
                                          "px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-all",
                                          canEditServer && !revoked
                                            ? "bg-neon-pink/12 border-neon-pink/40 text-neon-pink hover:bg-neon-pink/20"
                                            : "bg-white/[0.03] border-white/10 text-[#7b838a] cursor-not-allowed"
                                        )}
                                      >
                                        {t(language, 'invite_revoke')}
                                      </button>
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
                                    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-2 py-1.5">
                                      <div className="text-[9px] text-[#7b838a] font-black uppercase tracking-widest">Creado</div>
                                      <div className="text-[11px] text-[#DBDEE1] font-bold mt-0.5">
                                        {new Date(invite.createdAt).toLocaleString()}
                                      </div>
                                    </div>
                                    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-2 py-1.5">
                                      <div className="text-[9px] text-[#7b838a] font-black uppercase tracking-widest">
                                        {t(language, 'invite_expires')}
                                      </div>
                                      <div className="text-[11px] text-[#DBDEE1] font-bold mt-0.5">
                                        {invite.expiresAt ? new Date(invite.expiresAt).toLocaleString() : t(language, 'invite_unlimited')}
                                      </div>
                                    </div>
                                    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-2 py-1.5">
                                      <div className="text-[9px] text-[#7b838a] font-black uppercase tracking-widest">
                                        {t(language, 'invite_max_uses')}
                                      </div>
                                      <div className="text-[11px] text-[#DBDEE1] font-bold mt-0.5">
                                        {invite.maxUses && invite.maxUses > 0 ? invite.maxUses : t(language, 'invite_unlimited')}
                                      </div>
                                    </div>
                                    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-2 py-1.5">
                                      <div className="text-[9px] text-[#7b838a] font-black uppercase tracking-widest">
                                        {t(language, 'invite_used')}
                                      </div>
                                      <div className="text-[11px] text-[#DBDEE1] font-bold mt-0.5">
                                        {invite.uses}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {(inviteToast || inviteCopiedCode) ? (
                    <div className="fixed bottom-8 right-10 z-[260] px-4 py-2 rounded-xl bg-[#0B0C10]/90 border border-neon-blue/30 text-neon-blue font-black uppercase tracking-widest text-[10px] shadow-[0_0_22px_rgba(194,24,60,0.18)]">
                      {inviteToast || t(language, 'invite_link_copied')}
                    </div>
                  ) : null}
                </div>
              ) : serverSection === 'security' ? (
                <div className="space-y-6">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h1 className="text-2xl font-bold text-white">{t(language, 'security_config')}</h1>
                      <p className="text-sm text-[#A3AAB4] mt-1 max-w-[760px]">
                        Endurece anti raids, antispam, AutoMod y permisos de moderacion sin perder el look DiavloCord.
                      </p>
                    </div>
                    {securityPanel !== 'overview' ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSecurityPanel('overview');
                          setSecurityRuleEditor('none');
                          setSecurityVerificationPickerOpen(false);
                        }}
                        className="px-3 py-2 rounded-xl border border-white/10 bg-white/[0.03] text-[#CFD4DA] text-xs font-black uppercase tracking-widest hover:bg-white/[0.08] transition-all"
                      >
                        Atras
                      </button>
                    ) : null}
                  </div>

                  {!activeServer ? (
                    <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-md text-[#B5BAC1]">
                      {t(language, 'no_active_server')}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {!canEditServer ? (
                        <div className="rounded-2xl border border-neon-pink/35 bg-neon-pink/10 text-[#FFD5DD] px-4 py-3 text-sm">
                          Solo el propietario del servidor puede aplicar cambios en seguridad.
                        </div>
                      ) : null}

                      {securityPanel === 'overview' ? (
                        <div className="space-y-3">
                          {[
                            {
                              key: 'anti_raid' as const,
                              title: 'Proteccion contra ataques y CAPTCHA',
                              subtitle: 'Alertas de actividad, CAPTCHA selectivo y modo de ataque.',
                              enabled: securityEnabledCounters.antiRaidCount,
                              total: 3,
                              iconClass: 'bg-[#FFB32A]/18 border-[#FFB32A]/45 text-[#FFD36D]',
                              icon: <Shield size={18} />,
                            },
                            {
                              key: 'dm_spam' as const,
                              title: 'Proteccion de MD y spam',
                              subtitle: 'Nivel de verificacion, filtros de DM y enlaces externos.',
                              enabled: securityEnabledCounters.dmSpamCount,
                              total: 5,
                              iconClass: 'bg-[#40D6C4]/18 border-[#40D6C4]/45 text-[#78F5E6]',
                              icon: <Bell size={18} />,
                            },
                            {
                              key: 'automod' as const,
                              title: 'AutoMod',
                              subtitle: 'Reglas vivas para nombres, menciones y contenido sensible.',
                              enabled: securityEnabledCounters.automodCount,
                              total: 5,
                              iconClass: 'bg-[#8B84FF]/18 border-[#8B84FF]/45 text-[#B8B3FF]',
                              icon: <Sparkles size={18} />,
                            },
                            {
                              key: 'permissions' as const,
                              title: 'Permisos',
                              subtitle: '2FA para moderadores y blindaje de permisos arriesgados.',
                              enabled: securityEnabledCounters.permissionsCount,
                              total: 2,
                              iconClass: 'bg-[#FF6E9E]/18 border-[#FF6E9E]/45 text-[#FFA5C2]',
                              icon: <Key size={18} />,
                            },
                          ].map((item) => (
                            <div
                              key={item.key}
                              className="rounded-2xl border border-white/10 bg-[linear-gradient(130deg,rgba(122,16,39,0.16),rgba(19,15,28,0.88),rgba(10,12,20,0.94))] backdrop-blur-xl px-4 py-3.5 shadow-[0_10px_30px_rgba(0,0,0,0.35)]"
                            >
                              <div className="flex items-center gap-3">
                                <div className={cn('w-10 h-10 rounded-full border inline-flex items-center justify-center', item.iconClass)}>
                                  {item.icon}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-white font-black text-lg leading-tight">{item.title}</div>
                                  <div className="text-sm text-[#A0A8B0] mt-0.5">{item.subtitle}</div>
                                  <div className="text-[11px] text-[#C8CFD6] mt-1.5 font-black uppercase tracking-widest">
                                    {item.enabled} de {item.total} habilitado(s)
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSecurityPanel(item.key);
                                    setSecurityRuleEditor('none');
                                    setSecurityVerificationPickerOpen(false);
                                  }}
                                  className={cn(
                                    'px-4 py-2 rounded-xl border text-sm font-black transition-all',
                                    canEditServer
                                      ? 'bg-white/[0.04] border-white/15 text-white hover:bg-neon-blue/18 hover:border-neon-blue/35'
                                      : 'bg-white/[0.03] border-white/10 text-[#7b838a] cursor-not-allowed'
                                  )}
                                  disabled={!canEditServer}
                                >
                                  Configurar
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : securityPanel === 'anti_raid' ? (
                        <div className="space-y-4">
                          <div className="rounded-2xl border border-white/10 bg-[#10131D]/88 px-5 py-4 backdrop-blur-xl">
                            <div className="text-xl text-white font-black">Proteccion contra ataques y CAPTCHA</div>
                            <div className="text-sm text-[#9FA7B1] mt-1">
                              Ajusta como responde el servidor ante picos de actividad y cuentas sospechosas.
                            </div>
                          </div>

                          <div className="space-y-3">
                            {[
                              {
                                title: 'Alertas de actividad',
                                desc: 'Recibe notificaciones cuando la actividad de uniones o mensajes supera el patron habitual.',
                                chip: moderationChannelTag,
                                enabled: securitySettings.antiRaid.activityAlerts,
                                onToggle: () =>
                                  setSecuritySettings((prev) => ({
                                    ...prev,
                                    antiRaid: { ...prev.antiRaid, activityAlerts: !prev.antiRaid.activityAlerts },
                                  })),
                              },
                              {
                                title: 'CAPTCHA para cuentas sospechosas antes de unirse',
                                desc: 'Pide validacion extra a cuentas detectadas como riesgo moderado.',
                                enabled: securitySettings.antiRaid.captchaSuspicious,
                                onToggle: () =>
                                  setSecuritySettings((prev) => ({
                                    ...prev,
                                    antiRaid: { ...prev.antiRaid, captchaSuspicious: !prev.antiRaid.captchaSuspicious },
                                  })),
                              },
                              {
                                title: 'CAPTCHA global cuando se detecta ataque',
                                desc: 'Activa CAPTCHA para todas las nuevas uniones durante un incidente.',
                                enabled: securitySettings.antiRaid.captchaAttackMode,
                                onToggle: () =>
                                  setSecuritySettings((prev) => ({
                                    ...prev,
                                    antiRaid: { ...prev.antiRaid, captchaAttackMode: !prev.antiRaid.captchaAttackMode },
                                  })),
                              },
                            ].map((rule) => (
                              <button
                                key={rule.title}
                                type="button"
                                onClick={rule.onToggle}
                                disabled={!canEditServer}
                                className={cn(
                                  'w-full rounded-2xl border px-4 py-3 text-left transition-all',
                                  rule.enabled
                                    ? 'border-neon-blue/45 bg-neon-blue/10 shadow-[0_0_0_1px_rgba(194,24,60,0.2)]'
                                    : 'border-white/10 bg-black/20 hover:bg-white/[0.05]',
                                  !canEditServer && 'opacity-65 cursor-not-allowed'
                                )}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="text-white font-black">{rule.title}</div>
                                    <div className="text-sm text-[#9FA7B1] mt-1 leading-relaxed">{rule.desc}</div>
                                    {'chip' in rule && rule.chip ? (
                                      <div className="mt-2 inline-flex items-center rounded-lg border border-white/15 bg-white/[0.04] px-2 py-0.5 text-[11px] text-[#BFC6CF]">
                                        {rule.chip}
                                      </div>
                                    ) : null}
                                  </div>
                                  <span
                                    className={cn(
                                      'mt-0.5 inline-flex h-6 w-11 rounded-full border relative transition-all flex-shrink-0',
                                      rule.enabled ? 'border-neon-blue/55 bg-neon-blue/30' : 'border-white/20 bg-white/[0.07]'
                                    )}
                                  >
                                    <span
                                      className={cn(
                                        'absolute top-[2px] left-[2px] h-5 w-5 rounded-full bg-white transition-transform',
                                        rule.enabled && 'translate-x-[20px]'
                                      )}
                                    />
                                  </span>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : securityPanel === 'dm_spam' ? (
                        <div className="space-y-4">
                          <div className="rounded-2xl border border-white/10 bg-[#10131D]/88 px-5 py-4 backdrop-blur-xl">
                            <div className="text-xl text-white font-black">Proteccion de MD y spam</div>
                            <div className="text-sm text-[#9FA7B1] mt-1">
                              Ajusta el filtro de mensajes directos y endurece requisitos para enviar mensajes.
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => setSecurityVerificationPickerOpen(true)}
                            className="w-full rounded-2xl border border-white/10 bg-black/20 hover:bg-white/[0.05] px-4 py-3 text-left transition-all"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <div className="text-white font-black">Nivel de verificacion</div>
                                <div className="text-sm text-[#9FA7B1] mt-1">
                                  Los miembros deben cumplir este requisito antes de enviar mensajes.
                                </div>
                              </div>
                              <div className="inline-flex items-center gap-2">
                                <span className="px-2.5 py-1 rounded-lg border border-neon-blue/35 bg-neon-blue/12 text-neon-blue text-xs font-black uppercase tracking-widest">
                                  {verificationLabel}
                                </span>
                                <ChevronDown size={15} className="text-[#B8BFC7]" />
                              </div>
                            </div>
                          </button>

                          <div className="space-y-3">
                            {[
                              {
                                title: 'Ocultar mensajes directos de usuarios sospechosos',
                                desc: 'Mueve mensajes sospechosos a una bandeja separada para revisarlos con calma.',
                                enabled: securitySettings.dmSpam.hideSuspiciousDMs,
                                onToggle: () =>
                                  setSecuritySettings((prev) => ({
                                    ...prev,
                                    dmSpam: { ...prev.dmSpam, hideSuspiciousDMs: !prev.dmSpam.hideSuspiciousDMs },
                                  })),
                              },
                              {
                                title: 'Filtrar mensajes directos de usuarios desconocidos',
                                desc: 'Pide aprobacion previa antes de permitir respuesta a un DM nuevo.',
                                enabled: securitySettings.dmSpam.filterUnknownDMs,
                                onToggle: () =>
                                  setSecuritySettings((prev) => ({
                                    ...prev,
                                    dmSpam: { ...prev.dmSpam, filterUnknownDMs: !prev.dmSpam.filterUnknownDMs },
                                  })),
                              },
                              {
                                title: 'Advertir antes de abrir enlaces externos',
                                desc: 'Muestra una advertencia si el enlace apunta fuera de dominios confiables.',
                                enabled: securitySettings.dmSpam.warnExternalLinks,
                                onToggle: () =>
                                  setSecuritySettings((prev) => ({
                                    ...prev,
                                    dmSpam: { ...prev.dmSpam, warnExternalLinks: !prev.dmSpam.warnExternalLinks },
                                  })),
                              },
                              {
                                title: 'Ocultar y limpiar mensajes con patron de spam',
                                desc: 'Borra automaticamente mensajes con señales fuertes de spam repetitivo.',
                                enabled: securitySettings.dmSpam.autoDeleteSpam,
                                onToggle: () =>
                                  setSecuritySettings((prev) => ({
                                    ...prev,
                                    dmSpam: { ...prev.dmSpam, autoDeleteSpam: !prev.dmSpam.autoDeleteSpam },
                                  })),
                              },
                            ].map((entry) => (
                              <button
                                key={entry.title}
                                type="button"
                                onClick={entry.onToggle}
                                disabled={!canEditServer}
                                className={cn(
                                  'w-full rounded-2xl border px-4 py-3 text-left transition-all',
                                  entry.enabled
                                    ? 'border-neon-blue/45 bg-neon-blue/10 shadow-[0_0_0_1px_rgba(194,24,60,0.2)]'
                                    : 'border-white/10 bg-black/20 hover:bg-white/[0.05]',
                                  !canEditServer && 'opacity-65 cursor-not-allowed'
                                )}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <div className="text-white font-black">{entry.title}</div>
                                    <div className="text-sm text-[#9FA7B1] mt-1">{entry.desc}</div>
                                  </div>
                                  <span
                                    className={cn(
                                      'mt-0.5 inline-flex h-6 w-11 rounded-full border relative transition-all flex-shrink-0',
                                      entry.enabled ? 'border-neon-blue/55 bg-neon-blue/30' : 'border-white/20 bg-white/[0.07]'
                                    )}
                                  >
                                    <span
                                      className={cn(
                                        'absolute top-[2px] left-[2px] h-5 w-5 rounded-full bg-white transition-transform',
                                        entry.enabled && 'translate-x-[20px]'
                                      )}
                                    />
                                  </span>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : securityPanel === 'automod' ? (
                        <div className="space-y-4">
                          <div className="rounded-2xl border border-white/10 bg-[#10131D]/88 px-5 py-4 backdrop-blur-xl">
                            <div className="text-xl text-white font-black">AutoMod</div>
                            <div className="text-sm text-[#9FA7B1] mt-1">
                              Crea reglas automatizadas para nombres, menciones y contenido delicado.
                            </div>
                          </div>

                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                            {[
                              { label: 'Nombres', value: securitySettings.automod.blockProfileWords },
                              { label: 'Menciones', value: securitySettings.automod.blockMentionSpam },
                              { label: 'Spam', value: securitySettings.automod.blockSuspectedSpam },
                              { label: 'Custom', value: securitySettings.automod.blockCustomWords },
                            ].map((chip) => (
                              <div
                                key={chip.label}
                                className={cn(
                                  'rounded-xl border px-3 py-2 text-center text-xs font-black uppercase tracking-widest',
                                  chip.value
                                    ? 'border-neon-green/40 bg-neon-green/12 text-neon-green'
                                    : 'border-white/10 bg-white/[0.02] text-[#8f97a1]'
                                )}
                              >
                                {chip.label}
                              </div>
                            ))}
                          </div>

                          <div className="space-y-3">
                            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <div className="text-white font-black">Bloquear palabras en nombres de perfil</div>
                                  <div className="text-sm text-[#9FA7B1] mt-1">
                                    Evita nicks con terminos bloqueados y opcionalmente envia alerta.
                                  </div>
                                  <div className="flex flex-wrap gap-1.5 mt-2">
                                    {securityAutoModActionTags.profile.length > 0 ? securityAutoModActionTags.profile.map((tag) => (
                                      <span key={`profile-tag-${tag}`} className="px-2 py-0.5 rounded-lg border border-white/15 bg-white/[0.04] text-[10px] uppercase tracking-widest text-[#CFD4DA]">
                                        {tag}
                                      </span>
                                    )) : (
                                      <span className="text-xs text-[#7f8791]">Sin acciones adicionales</span>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSecurityRuleEditor('profile_names');
                                      setSecuritySettings((prev) => ({
                                        ...prev,
                                        automod: { ...prev.automod, blockProfileWords: true },
                                      }));
                                    }}
                                    disabled={!canEditServer}
                                    className={cn(
                                      'px-3 py-2 rounded-xl border text-xs font-black uppercase tracking-widest transition-all',
                                      canEditServer
                                        ? 'border-neon-blue/40 bg-neon-blue/12 text-neon-blue hover:bg-neon-blue/20'
                                        : 'border-white/10 bg-white/[0.03] text-[#7b838a] cursor-not-allowed'
                                    )}
                                  >
                                    Configurar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setSecuritySettings((prev) => ({
                                        ...prev,
                                        automod: { ...prev.automod, blockProfileWords: !prev.automod.blockProfileWords },
                                      }))
                                    }
                                    disabled={!canEditServer}
                                    className={cn(
                                      'w-11 h-6 rounded-full border relative transition-all',
                                      securitySettings.automod.blockProfileWords
                                        ? 'border-neon-blue/55 bg-neon-blue/30'
                                        : 'border-white/20 bg-white/[0.07]',
                                      !canEditServer && 'opacity-60 cursor-not-allowed'
                                    )}
                                  >
                                    <span
                                      className={cn(
                                        'absolute top-[2px] left-[2px] h-5 w-5 rounded-full bg-white transition-transform',
                                        securitySettings.automod.blockProfileWords && 'translate-x-[20px]'
                                      )}
                                    />
                                  </button>
                                </div>
                              </div>
                            </div>

                            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <div className="text-white font-black">Block Mention Spam</div>
                                  <div className="text-sm text-[#9FA7B1] mt-1">
                                    Limita mensajes con volumen de menciones masivo.
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setSecuritySettings((prev) => ({
                                      ...prev,
                                      automod: { ...prev.automod, blockMentionSpam: !prev.automod.blockMentionSpam },
                                    }))
                                  }
                                  disabled={!canEditServer}
                                  className={cn(
                                    'w-11 h-6 rounded-full border relative transition-all',
                                    securitySettings.automod.blockMentionSpam
                                      ? 'border-neon-blue/55 bg-neon-blue/30'
                                      : 'border-white/20 bg-white/[0.07]',
                                    !canEditServer && 'opacity-60 cursor-not-allowed'
                                  )}
                                >
                                  <span
                                    className={cn(
                                      'absolute top-[2px] left-[2px] h-5 w-5 rounded-full bg-white transition-transform',
                                      securitySettings.automod.blockMentionSpam && 'translate-x-[20px]'
                                    )}
                                  />
                                </button>
                              </div>
                            </div>

                            {[
                              {
                                key: 'suspected_spam' as const,
                                title: 'Bloquear contenido sospechoso de spam',
                                desc: 'Regla heuristica para links repetidos, flooding y patrones bot.',
                                enabled: securitySettings.automod.blockSuspectedSpam,
                                tags: securityAutoModActionTags.suspected,
                                quickToggle: () =>
                                  setSecuritySettings((prev) => ({
                                    ...prev,
                                    automod: { ...prev.automod, blockSuspectedSpam: !prev.automod.blockSuspectedSpam },
                                  })),
                              },
                              {
                                key: 'frequent_words' as const,
                                title: 'Bloquear palabras marcadas frecuentemente',
                                desc: 'Filtra lenguaje muy soez, insultos y terminos sexuales.',
                                enabled: securitySettings.automod.blockFrequentWords,
                                tags: securityAutoModActionTags.frequent,
                                quickToggle: () =>
                                  setSecuritySettings((prev) => ({
                                    ...prev,
                                    automod: { ...prev.automod, blockFrequentWords: !prev.automod.blockFrequentWords },
                                  })),
                              },
                              {
                                key: 'custom_words' as const,
                                title: 'Bloquear palabras personalizadas',
                                desc: 'Crea tu propia lista de terminos y respuesta automatica.',
                                enabled: securitySettings.automod.blockCustomWords,
                                tags: securityAutoModActionTags.custom,
                                quickToggle: () =>
                                  setSecuritySettings((prev) => ({
                                    ...prev,
                                    automod: { ...prev.automod, blockCustomWords: !prev.automod.blockCustomWords },
                                  })),
                              },
                            ].map((rule) => (
                              <div key={rule.title} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="text-white font-black">{rule.title}</div>
                                    <div className="text-sm text-[#9FA7B1] mt-1">{rule.desc}</div>
                                    <div className="flex flex-wrap gap-1.5 mt-2">
                                      {rule.tags.length > 0 ? rule.tags.map((tag) => (
                                        <span key={`${rule.key}-${tag}`} className="px-2 py-0.5 rounded-lg border border-white/15 bg-white/[0.04] text-[10px] uppercase tracking-widest text-[#CFD4DA]">
                                          {tag}
                                        </span>
                                      )) : (
                                        <span className="text-xs text-[#7f8791]">Sin acciones adicionales</span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => setSecurityRuleEditor(rule.key)}
                                      disabled={!canEditServer}
                                      className={cn(
                                        'px-3 py-2 rounded-xl border text-xs font-black uppercase tracking-widest transition-all',
                                        canEditServer
                                          ? 'border-neon-blue/40 bg-neon-blue/12 text-neon-blue hover:bg-neon-blue/20'
                                          : 'border-white/10 bg-white/[0.03] text-[#7b838a] cursor-not-allowed'
                                      )}
                                    >
                                      {rule.key === 'custom_words' ? 'Crear' : 'Configurar'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={rule.quickToggle}
                                      disabled={!canEditServer}
                                      className={cn(
                                        'w-11 h-6 rounded-full border relative transition-all',
                                        rule.enabled ? 'border-neon-blue/55 bg-neon-blue/30' : 'border-white/20 bg-white/[0.07]',
                                        !canEditServer && 'opacity-60 cursor-not-allowed'
                                      )}
                                    >
                                      <span
                                        className={cn(
                                          'absolute top-[2px] left-[2px] h-5 w-5 rounded-full bg-white transition-transform',
                                          rule.enabled && 'translate-x-[20px]'
                                        )}
                                      />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>

                          <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                            <div className="text-white font-black">Filtro de contenido sensible</div>
                            <div className="text-sm text-[#9FA7B1] mt-1">
                              Decide para quien aplicar filtro multimedia por IA.
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-3">
                              {[
                                { key: 'all' as const, label: 'Todos los miembros' },
                                { key: 'members' as const, label: 'Solo miembros nuevos' },
                                { key: 'off' as const, label: 'Desactivado' },
                              ].map((opt) => (
                                <button
                                  key={opt.key}
                                  type="button"
                                  onClick={() =>
                                    setSecuritySettings((prev) => ({
                                      ...prev,
                                      automod: { ...prev.automod, sensitiveMediaFilter: opt.key },
                                    }))
                                  }
                                  disabled={!canEditServer}
                                  className={cn(
                                    'h-10 rounded-xl border text-xs font-black uppercase tracking-widest transition-all',
                                    securitySettings.automod.sensitiveMediaFilter === opt.key
                                      ? 'border-neon-blue/45 bg-neon-blue/12 text-neon-blue'
                                      : 'border-white/10 bg-white/[0.03] text-[#B5BAC1] hover:bg-white/[0.06]',
                                    !canEditServer && 'opacity-60 cursor-not-allowed'
                                  )}
                                >
                                  {opt.label}
                                </button>
                              ))}
                            </div>
                          </div>

                          {securityRuleEditor !== 'none' ? (
                            <div className="rounded-2xl border border-neon-blue/30 bg-[linear-gradient(145deg,rgba(88,101,242,0.12),rgba(14,17,28,0.95))] backdrop-blur-xl px-4 py-4 space-y-4">
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-white font-black text-lg">
                                  {securityRuleEditor === 'profile_names'
                                    ? 'Regla: nombres de perfil'
                                    : securityRuleEditor === 'suspected_spam'
                                      ? 'Regla: spam sospechoso'
                                      : securityRuleEditor === 'frequent_words'
                                        ? 'Regla: palabras frecuentes'
                                        : 'Regla: palabras personalizadas'}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setSecurityRuleEditor('none')}
                                  className="px-3 py-1.5 rounded-lg border border-white/15 bg-white/[0.04] text-xs font-black uppercase tracking-widest text-[#CFD4DA] hover:bg-white/[0.08] transition-all"
                                >
                                  Cerrar
                                </button>
                              </div>

                              {securityRuleEditor === 'profile_names' ? (
                                <div className="space-y-3">
                                  <textarea
                                    value={securitySettings.automod.profileRuleTerms}
                                    onChange={(e) =>
                                      setSecuritySettings((prev) => ({
                                        ...prev,
                                        automod: { ...prev.automod, profileRuleTerms: e.target.value.slice(0, 1000) },
                                      }))
                                    }
                                    disabled={!canEditServer}
                                    rows={4}
                                    placeholder="Palabras bloqueadas para nombres"
                                    className={cn(
                                      'w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-neon-blue/40',
                                      !canEditServer && 'opacity-60 cursor-not-allowed'
                                    )}
                                  />
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setSecuritySettings((prev) => ({
                                          ...prev,
                                          automod: { ...prev.automod, profileRuleBlockInteractions: !prev.automod.profileRuleBlockInteractions },
                                        }))
                                      }
                                      disabled={!canEditServer}
                                      className={cn(
                                        'h-10 rounded-xl border text-xs font-black uppercase tracking-widest transition-all',
                                        securitySettings.automod.profileRuleBlockInteractions
                                          ? 'border-neon-blue/45 bg-neon-blue/12 text-neon-blue'
                                          : 'border-white/10 bg-white/[0.03] text-[#B5BAC1] hover:bg-white/[0.06]',
                                        !canEditServer && 'opacity-60 cursor-not-allowed'
                                      )}
                                    >
                                      Bloquear interacciones
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setSecuritySettings((prev) => ({
                                          ...prev,
                                          automod: { ...prev.automod, profileRuleSendAlert: !prev.automod.profileRuleSendAlert },
                                        }))
                                      }
                                      disabled={!canEditServer}
                                      className={cn(
                                        'h-10 rounded-xl border text-xs font-black uppercase tracking-widest transition-all',
                                        securitySettings.automod.profileRuleSendAlert
                                          ? 'border-neon-blue/45 bg-neon-blue/12 text-neon-blue'
                                          : 'border-white/10 bg-white/[0.03] text-[#B5BAC1] hover:bg-white/[0.06]',
                                        !canEditServer && 'opacity-60 cursor-not-allowed'
                                      )}
                                    >
                                      Enviar alerta
                                    </button>
                                  </div>
                                </div>
                              ) : securityRuleEditor === 'suspected_spam' ? (
                                <div className="space-y-3">
                                  <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-[#CFD4DA]">
                                    Bloquea contenido sospechoso y opcionalmente alerta al canal de moderacion.
                                  </div>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setSecuritySettings((prev) => ({
                                          ...prev,
                                          automod: { ...prev.automod, suspectedRuleBlockMessage: !prev.automod.suspectedRuleBlockMessage },
                                        }))
                                      }
                                      disabled={!canEditServer}
                                      className={cn(
                                        'h-10 rounded-xl border text-xs font-black uppercase tracking-widest transition-all',
                                        securitySettings.automod.suspectedRuleBlockMessage
                                          ? 'border-neon-blue/45 bg-neon-blue/12 text-neon-blue'
                                          : 'border-white/10 bg-white/[0.03] text-[#B5BAC1] hover:bg-white/[0.06]',
                                        !canEditServer && 'opacity-60 cursor-not-allowed'
                                      )}
                                    >
                                      Bloquear mensaje
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setSecuritySettings((prev) => ({
                                          ...prev,
                                          automod: { ...prev.automod, suspectedRuleSendAlert: !prev.automod.suspectedRuleSendAlert },
                                        }))
                                      }
                                      disabled={!canEditServer}
                                      className={cn(
                                        'h-10 rounded-xl border text-xs font-black uppercase tracking-widest transition-all',
                                        securitySettings.automod.suspectedRuleSendAlert
                                          ? 'border-neon-blue/45 bg-neon-blue/12 text-neon-blue'
                                          : 'border-white/10 bg-white/[0.03] text-[#B5BAC1] hover:bg-white/[0.06]',
                                        !canEditServer && 'opacity-60 cursor-not-allowed'
                                      )}
                                    >
                                      Enviar alerta
                                    </button>
                                  </div>
                                </div>
                              ) : securityRuleEditor === 'frequent_words' ? (
                                <div className="space-y-3">
                                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                    {[
                                      { key: 'frequentRuleProfanity' as const, label: 'Lenguaje muy soez' },
                                      { key: 'frequentRuleInsults' as const, label: 'Insultos y ofensas' },
                                      { key: 'frequentRuleSexual' as const, label: 'Contenido sexual' },
                                    ].map((item) => {
                                      const enabled = securitySettings.automod[item.key];
                                      return (
                                        <button
                                          key={item.key}
                                          type="button"
                                          onClick={() =>
                                            setSecuritySettings((prev) => ({
                                              ...prev,
                                              automod: { ...prev.automod, [item.key]: !enabled },
                                            }))
                                          }
                                          disabled={!canEditServer}
                                          className={cn(
                                            'h-10 rounded-xl border text-xs font-black uppercase tracking-widest transition-all',
                                            enabled
                                              ? 'border-neon-blue/45 bg-neon-blue/12 text-neon-blue'
                                              : 'border-white/10 bg-white/[0.03] text-[#B5BAC1] hover:bg-white/[0.06]',
                                            !canEditServer && 'opacity-60 cursor-not-allowed'
                                          )}
                                        >
                                          {item.label}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              ) : (
                                <div className="space-y-3">
                                  <textarea
                                    value={securitySettings.automod.customRuleTerms}
                                    onChange={(e) =>
                                      setSecuritySettings((prev) => ({
                                        ...prev,
                                        automod: { ...prev.automod, customRuleTerms: e.target.value.slice(0, 1000) },
                                      }))
                                    }
                                    disabled={!canEditServer}
                                    rows={4}
                                    placeholder="Palabras personalizadas separadas por coma o linea"
                                    className={cn(
                                      'w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-neon-blue/40',
                                      !canEditServer && 'opacity-60 cursor-not-allowed'
                                    )}
                                  />
                                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                    {[
                                      { key: 'customRuleBlockMessage' as const, label: 'Bloquear mensaje' },
                                      { key: 'customRuleSendAlert' as const, label: 'Enviar alerta' },
                                      { key: 'customRuleTempMute' as const, label: 'Aislar temporalmente' },
                                    ].map((item) => {
                                      const enabled = securitySettings.automod[item.key];
                                      return (
                                        <button
                                          key={item.key}
                                          type="button"
                                          onClick={() =>
                                            setSecuritySettings((prev) => ({
                                              ...prev,
                                              automod: { ...prev.automod, [item.key]: !enabled },
                                            }))
                                          }
                                          disabled={!canEditServer}
                                          className={cn(
                                            'h-10 rounded-xl border text-xs font-black uppercase tracking-widest transition-all',
                                            enabled
                                              ? 'border-neon-blue/45 bg-neon-blue/12 text-neon-blue'
                                              : 'border-white/10 bg-white/[0.03] text-[#B5BAC1] hover:bg-white/[0.06]',
                                            !canEditServer && 'opacity-60 cursor-not-allowed'
                                          )}
                                        >
                                          {item.label}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}

                              <div className="flex justify-end gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={() => setSecurityRuleEditor('none')}
                                  className="px-3 py-2 rounded-xl border border-white/15 bg-white/[0.04] text-xs font-black uppercase tracking-widest text-[#CFD4DA] hover:bg-white/[0.08] transition-all"
                                >
                                  Cancelar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSecurityToast('Regla guardada');
                                    setSecurityRuleEditor('none');
                                  }}
                                  className="px-3 py-2 rounded-xl border border-neon-green/40 bg-neon-green/14 text-neon-green text-xs font-black uppercase tracking-widest hover:bg-neon-green/22 transition-all"
                                >
                                  Guardar cambios
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div className="rounded-2xl border border-white/10 bg-[#10131D]/88 px-5 py-4 backdrop-blur-xl">
                            <div className="text-xl text-white font-black">Permisos</div>
                            <div className="text-sm text-[#9FA7B1] mt-1">
                              Protege acciones criticas de moderacion y reduce superficie de riesgo.
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              setSecuritySettings((prev) => ({
                                ...prev,
                                permissions: { ...prev.permissions, require2FA: !prev.permissions.require2FA },
                              }))
                            }
                            disabled={!canEditServer}
                            className={cn(
                              'w-full rounded-2xl border px-4 py-3 text-left transition-all',
                              securitySettings.permissions.require2FA
                                ? 'border-neon-blue/45 bg-neon-blue/10 shadow-[0_0_0_1px_rgba(194,24,60,0.2)]'
                                : 'border-white/10 bg-black/20 hover:bg-white/[0.05]',
                              !canEditServer && 'opacity-65 cursor-not-allowed'
                            )}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-white font-black">Requerir 2FA para acciones de moderacion</div>
                                <div className="text-sm text-[#9FA7B1] mt-1">
                                  Ban, kick, timeout y borrado masivo solo para moderadores con 2FA activa.
                                </div>
                              </div>
                              <span
                                className={cn(
                                  'mt-0.5 inline-flex h-6 w-11 rounded-full border relative transition-all flex-shrink-0',
                                  securitySettings.permissions.require2FA
                                    ? 'border-neon-blue/55 bg-neon-blue/30'
                                    : 'border-white/20 bg-white/[0.07]'
                                )}
                              >
                                <span
                                  className={cn(
                                    'absolute top-[2px] left-[2px] h-5 w-5 rounded-full bg-white transition-transform',
                                    securitySettings.permissions.require2FA && 'translate-x-[20px]'
                                  )}
                                />
                              </span>
                            </div>
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              setSecuritySettings((prev) => ({
                                ...prev,
                                permissions: {
                                  ...prev.permissions,
                                  disableRiskyEveryone: !prev.permissions.disableRiskyEveryone,
                                },
                              }))
                            }
                            disabled={!canEditServer}
                            className={cn(
                              'w-full rounded-2xl border px-4 py-3 text-left transition-all',
                              securitySettings.permissions.disableRiskyEveryone
                                ? 'border-neon-green/45 bg-neon-green/10 shadow-[0_0_0_1px_rgba(57,255,20,0.16)]'
                                : 'border-white/10 bg-black/20 hover:bg-white/[0.05]',
                              !canEditServer && 'opacity-65 cursor-not-allowed'
                            )}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-white font-black">Deshabilitar permisos arriesgados de @everyone</div>
                                <div className="text-sm text-[#9FA7B1] mt-1">
                                  Revoca permisos sensibles de la base del servidor para evitar escaladas accidentales.
                                </div>
                              </div>
                              <span
                                className={cn(
                                  'mt-0.5 inline-flex h-6 w-11 rounded-full border relative transition-all flex-shrink-0',
                                  securitySettings.permissions.disableRiskyEveryone
                                    ? 'border-neon-green/55 bg-neon-green/30'
                                    : 'border-white/20 bg-white/[0.07]'
                                )}
                              >
                                <span
                                  className={cn(
                                    'absolute top-[2px] left-[2px] h-5 w-5 rounded-full bg-white transition-transform',
                                    securitySettings.permissions.disableRiskyEveryone && 'translate-x-[20px]'
                                  )}
                                />
                              </span>
                            </div>
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  <ModalBase
                    open={securityVerificationPickerOpen && securityPanel === 'dm_spam'}
                    onClose={() => setSecurityVerificationPickerOpen(false)}
                    ariaLabelledBy="security-verification-title"
                    ariaDescribedBy="security-verification-description"
                    rootClassName="z-[270]"
                    overlayClassName="bg-black/75 backdrop-blur-sm"
                    panelClassName="w-full max-w-[560px] rounded-2xl border border-white/15 bg-[#111621]/95 backdrop-blur-xl shadow-[0_25px_80px_rgba(0,0,0,0.45)] p-5 space-y-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div id="security-verification-title" className="text-white font-black text-2xl leading-tight">
                          Nivel de verificacion
                        </div>
                        <div id="security-verification-description" className="text-sm text-[#A6ADB7] mt-1">
                          Elige el umbral minimo para escribir en canales de texto.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSecurityVerificationPickerOpen(false)}
                        className="w-9 h-9 rounded-full border border-white/20 bg-white/[0.03] text-[#CFD4DA] hover:bg-white/[0.08] transition-all inline-flex items-center justify-center"
                      >
                        <X size={16} />
                      </button>
                    </div>

                    <div className="space-y-2">
                      {securityVerificationOptions.map((option) => {
                        const selected = securitySettings.dmSpam.verificationLevel === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() =>
                              setSecuritySettings((prev) => ({
                                ...prev,
                                dmSpam: { ...prev.dmSpam, verificationLevel: option.value },
                              }))
                            }
                            disabled={!canEditServer}
                            className={cn(
                              'w-full rounded-xl border px-3 py-2.5 text-left transition-all',
                              selected
                                ? 'border-neon-blue/45 bg-neon-blue/12 shadow-[0_0_0_1px_rgba(194,24,60,0.2)]'
                                : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05]',
                              !canEditServer && 'opacity-65 cursor-not-allowed'
                            )}
                          >
                            <div className="flex items-start gap-3">
                              <span
                                className={cn(
                                  'mt-0.5 w-5 h-5 rounded-full border inline-flex items-center justify-center flex-shrink-0',
                                  selected ? 'border-neon-blue bg-neon-blue/20' : 'border-white/30'
                                )}
                              >
                                {selected ? <span className="w-2 h-2 rounded-full bg-neon-blue" /> : null}
                              </span>
                              <div>
                                <div className="text-white font-black">{option.label}</div>
                                <div className="text-sm text-[#9FA7B1] mt-0.5">{option.description}</div>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setSecurityVerificationPickerOpen(false)}
                        className="px-3 py-2 rounded-xl border border-white/15 bg-white/[0.04] text-xs font-black uppercase tracking-widest text-[#CFD4DA] hover:bg-white/[0.08] transition-all"
                      >
                        Cerrar
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSecurityToast('Nivel actualizado');
                          setSecurityVerificationPickerOpen(false);
                        }}
                        className="px-3 py-2 rounded-xl border border-neon-blue/40 bg-neon-blue/15 text-neon-blue text-xs font-black uppercase tracking-widest hover:bg-neon-blue/25 transition-all"
                      >
                        Guardar
                      </button>
                    </div>
                  </ModalBase>

                  {securityToast ? (
                    <div className="fixed bottom-8 right-10 z-[275] px-4 py-2 rounded-xl bg-[#0B0C10]/90 border border-neon-blue/30 text-neon-blue font-black uppercase tracking-widest text-[10px] shadow-[0_0_22px_rgba(194,24,60,0.18)]">
                      {securityToast}
                    </div>
                  ) : null}
                </div>
              ) : serverSection === 'audit_log' ? (
                canViewAuditLog ? (
                <div className="space-y-6">
                  <h1 className="text-2xl font-bold text-white">{t(language, 'audit_log')}</h1>
                  <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-md">
                    {activeAuditLog.length === 0 ? (
                      <div className="text-sm text-[#949BA4]">No hay eventos de auditoria todavia.</div>
                    ) : (
                      <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
                        {activeAuditLog.map((entry) => {
                          const actor = users.find((u) => u.id === entry.actorUserId)?.username || entry.actorUserId;
                          const target = entry.targetUserId ? (users.find((u) => u.id === entry.targetUserId)?.username || entry.targetUserId) : null;
                          const role = entry.roleId ? (activeServer?.roles.find((r) => r.id === entry.roleId)?.name || entry.roleId) : null;
                          const actionLabel = entry.action === 'server_update'
                            ? 'Servidor actualizado'
                            : entry.action === 'role_create'
                              ? 'Rol creado'
                              : entry.action === 'role_update'
                                ? 'Rol actualizado'
                                : entry.action === 'role_delete'
                                  ? 'Rol eliminado'
                                  : entry.action === 'member_role_update'
                                    ? 'Roles de miembro'
                                    : entry.action === 'member_timeout'
                                      ? 'Timeout'
                                      : entry.action === 'member_untimeout'
                                        ? 'Quitar timeout'
                                        : entry.action === 'member_kick'
                                          ? 'Kick'
                                          : entry.action === 'member_ban'
                                            ? 'Ban'
                                            : entry.action === 'member_unban'
                                              ? 'Unban'
                                              : 'Permisos de canal';
                          return (
                            <div key={entry.id} className="rounded-xl border border-white/10 bg-black/25 px-3 py-2.5">
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-white font-black text-sm">{actionLabel}</div>
                                <div className="text-[10px] font-black uppercase tracking-widest text-[#7b838a]">
                                  {new Date(entry.createdAt).toLocaleString()}
                                </div>
                              </div>
                              <div className="text-[11px] text-[#B5BAC1] font-medium mt-1">
                                {actor}
                                {target ? ` -> ${target}` : ''}
                                {entry.channelId ? ` // ${entry.channelId}` : ''}
                                {role ? ` // ${role}` : ''}
                                {entry.permission ? ` // ${entry.permission}` : ''}
                                {typeof entry.allowed === 'boolean' ? ` // ${entry.allowed ? 'ALLOW' : 'DENY'}` : ''}
                                {entry.reason ? ` // ${entry.reason}` : ''}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
                ) : (
                  <div className="space-y-4">
                    <h1 className="text-2xl font-bold text-white">{t(language, 'audit_log')}</h1>
                    <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-md">
                      <div className="text-sm text-[#949BA4]">No tienes permiso para ver la auditoria de este servidor.</div>
                    </div>
                  </div>
                )
              ) : serverSection === 'bans' ? (
                <div className="space-y-6">
                  <h1 className="text-2xl font-bold text-white">{t(language, 'bans')}</h1>
                  <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-md">
                    {activeServerBans.length === 0 ? (
                      <div className="text-sm text-[#949BA4]">No hay usuarios baneados en este servidor.</div>
                    ) : (
                      <div className="space-y-2">
                        {activeServerBans.map((ban) => {
                          const u = users.find((x) => x.id === ban.userId);
                          const label = u ? `${u.username}` : ban.userId;
                          return (
                            <div key={ban.userId} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/25 px-3 py-2.5">
                              <div className="min-w-0">
                                <div className="text-white font-black truncate">{label}</div>
                                <div className="text-[10px] font-black uppercase tracking-widest text-[#7b838a] truncate">
                                  {ban.reason || 'Sin motivo'} // {new Date(ban.bannedAt).toLocaleString()}
                                </div>
                              </div>
                              <button
                                disabled={!canEditServer || !activeServerId}
                                onClick={() => {
                                  if (!activeServerId) return;
                                  unbanMember(activeServerId, ban.userId);
                                }}
                                className={cn(
                                  "px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-all",
                                  canEditServer
                                    ? "bg-neon-green/15 border-neon-green/40 text-neon-green hover:bg-neon-green/25"
                                    : "bg-white/[0.03] border-white/10 text-[#7b838a] cursor-not-allowed"
                                )}
                              >
                                Unban
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ) : serverSection === 'access' ? (
                <div className="space-y-6">
                  <h1 className="text-2xl font-bold text-white">{t(language, 'access')}</h1>

                  {!activeServer ? (
                    <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-md text-[#B5BAC1]">
                      {t(language, 'no_active_server')}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-md">
                        <div className="text-white font-black mb-2">Canal</div>
                        <select
                          value={resolvedAccessChannelId || ''}
                          onChange={(e) => setAccessChannelId(e.target.value)}
                          className="w-full bg-black/30 border border-white/10 text-white rounded-xl px-3 py-2.5 outline-none focus:border-neon-blue/40 transition-all"
                        >
                          {serverChannels.map((ch) => (
                            <option key={ch.id} value={ch.id}>{`#${ch.name}`}</option>
                          ))}
                        </select>
                        {!canEditServer ? (
                          <div className="text-xs text-[#949BA4] mt-2">{t(language, 'owner_only')}</div>
                        ) : null}
                      </div>

                      {accessChannel ? (
                        <div className="space-y-3">
                          <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-md space-y-3">
                            <div className="text-white font-black">Objetivo</div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => setAccessTargetType('role')}
                                className={cn(
                                  "px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-all",
                                  accessTargetType === 'role'
                                    ? "bg-neon-blue/20 border-neon-blue/40 text-neon-blue"
                                    : "bg-white/[0.03] border-white/10 text-[#B5BAC1]"
                                )}
                              >
                                Role
                              </button>
                              <button
                                onClick={() => setAccessTargetType('member')}
                                className={cn(
                                  "px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-all",
                                  accessTargetType === 'member'
                                    ? "bg-neon-blue/20 border-neon-blue/40 text-neon-blue"
                                    : "bg-white/[0.03] border-white/10 text-[#B5BAC1]"
                                )}
                              >
                                Member
                              </button>
                            </div>
                            {accessTargetType === 'member' ? (
                              <select
                                value={accessMemberId || ''}
                                onChange={(e) => setAccessMemberId(e.target.value)}
                                className="w-full bg-black/30 border border-white/10 text-white rounded-xl px-3 py-2.5 outline-none focus:border-neon-blue/40 transition-all"
                              >
                                {accessMembers.map((memberUser) => (
                                  <option key={memberUser.id} value={memberUser.id}>
                                    {memberUser.username}
                                  </option>
                                ))}
                              </select>
                            ) : null}
                          </div>

                          {accessTargetType === 'role'
                            ? activeServer.roles.map((role) => {
                                const overwrite = accessChannel.permissionOverwrites?.find((ow) => ow.type === 'role' && ow.id === role.id);
                                return (
                                  <div key={role.id} className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-md">
                                    <div className="flex items-center justify-between mb-3">
                                      <div className="font-black" style={{ color: role.color || '#fff' }}>{role.name}</div>
                                      <div className="text-[10px] font-black uppercase tracking-widest text-[#7b838a]">Role</div>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                      {accessPermissions.map((perm) => {
                                        const allowed = overwrite?.allow?.includes(perm.key) || false;
                                        const denied = overwrite?.deny?.includes(perm.key) || false;
                                        return (
                                          <div key={perm.key} className="flex items-center justify-between rounded-xl border border-white/10 bg-black/25 px-3 py-2">
                                            <div>
                                              <div className="text-sm text-white font-black">{perm.label}</div>
                                              <div className="text-[10px] font-black uppercase tracking-widest text-[#7b838a]">
                                                {allowed ? 'Allow' : denied ? 'Deny' : 'Inherit'}
                                              </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                              <button
                                                disabled={!canEditServer}
                                                onClick={() => {
                                                  if (!activeServerId || !accessChannel?.id) return;
                                                  updateChannelRolePermission(activeServerId, accessChannel.id, role.id, perm.key, true);
                                                }}
                                                className={cn(
                                                  "px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-all",
                                                  allowed ? "bg-neon-green/20 border-neon-green/40 text-neon-green" : "bg-white/[0.03] border-white/10 text-[#B5BAC1] hover:bg-white/[0.08]",
                                                  !canEditServer && "opacity-50 cursor-not-allowed"
                                                )}
                                              >
                                                Allow
                                              </button>
                                              <button
                                                disabled={!canEditServer}
                                                onClick={() => {
                                                  if (!activeServerId || !accessChannel?.id) return;
                                                  updateChannelRolePermission(activeServerId, accessChannel.id, role.id, perm.key, false);
                                                }}
                                                className={cn(
                                                  "px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-all",
                                                  denied ? "bg-neon-pink/20 border-neon-pink/40 text-neon-pink" : "bg-white/[0.03] border-white/10 text-[#B5BAC1] hover:bg-white/[0.08]",
                                                  !canEditServer && "opacity-50 cursor-not-allowed"
                                                )}
                                              >
                                                Deny
                                              </button>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              })
                            : accessMemberId
                              ? (() => {
                                  const overwrite = accessChannel.permissionOverwrites?.find((ow) => ow.type === 'member' && ow.id === accessMemberId);
                                  const selectedUser = users.find((u) => u.id === accessMemberId);
                                  return (
                                    <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-md">
                                      <div className="flex items-center justify-between mb-3">
                                        <div className="font-black text-white">{selectedUser?.username || accessMemberId}</div>
                                        <div className="text-[10px] font-black uppercase tracking-widest text-[#7b838a]">Member</div>
                                      </div>
                                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                        {accessPermissions.map((perm) => {
                                          const allowed = overwrite?.allow?.includes(perm.key) || false;
                                          const denied = overwrite?.deny?.includes(perm.key) || false;
                                          return (
                                            <div key={perm.key} className="flex items-center justify-between rounded-xl border border-white/10 bg-black/25 px-3 py-2">
                                              <div>
                                                <div className="text-sm text-white font-black">{perm.label}</div>
                                                <div className="text-[10px] font-black uppercase tracking-widest text-[#7b838a]">
                                                  {allowed ? 'Allow' : denied ? 'Deny' : 'Inherit'}
                                                </div>
                                              </div>
                                              <div className="flex items-center gap-2">
                                                <button
                                                  disabled={!canEditServer}
                                                  onClick={() => {
                                                    if (!activeServerId || !accessChannel?.id) return;
                                                    updateChannelMemberPermission(activeServerId, accessChannel.id, accessMemberId, perm.key, true);
                                                  }}
                                                  className={cn(
                                                    "px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-all",
                                                    allowed ? "bg-neon-green/20 border-neon-green/40 text-neon-green" : "bg-white/[0.03] border-white/10 text-[#B5BAC1] hover:bg-white/[0.08]",
                                                    !canEditServer && "opacity-50 cursor-not-allowed"
                                                  )}
                                                >
                                                  Allow
                                                </button>
                                                <button
                                                  disabled={!canEditServer}
                                                  onClick={() => {
                                                    if (!activeServerId || !accessChannel?.id) return;
                                                    updateChannelMemberPermission(activeServerId, accessChannel.id, accessMemberId, perm.key, false);
                                                  }}
                                                  className={cn(
                                                    "px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-all",
                                                    denied ? "bg-neon-pink/20 border-neon-pink/40 text-neon-pink" : "bg-white/[0.03] border-white/10 text-[#B5BAC1] hover:bg-white/[0.08]",
                                                    !canEditServer && "opacity-50 cursor-not-allowed"
                                                  )}
                                                >
                                                  Deny
                                                </button>
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  );
                                })()
                              : null}
                        </div>
                      ) : (
                        <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/10 text-[#B5BAC1]">
                          No hay canales disponibles para configurar permisos.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <h1 className="text-2xl font-bold text-white">{serverSidebarSections.flatMap((s) => s.items).find((i) => i.key === serverSection)?.label || t(language, 'server_settings')}</h1>
                  <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-md shadow-sm transition-shadow hover:shadow-[0_0_0_1px_rgba(122,16,39,0.18),0_0_26px_rgba(122,16,39,0.10)]">
                    <div className="text-white font-black">{t(language, 'coming_soon')}</div>
                    <div className="text-[#949BA4] text-sm font-medium mt-2">
                      {t(language, 'coming_soon_desc')}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'servers' && (
            <div className="space-y-8 animate-in slide-in-from-right-4 duration-300">
              <h1 className="text-2xl font-bold text-white">{t(language, 'your_servers')}</h1>
              
              {/* Tus Servidores */}
              <div className="space-y-4">
                <h2 className="text-lg font-bold text-white">{t(language, 'connected_servers')}</h2>
                {userServers.length > 0 ? (
                  <div className="space-y-3">
                    {userServers.map(server => (
                      <div key={server.id} className="flex items-center justify-between p-4 bg-white/[0.03] rounded-lg border border-white/10 backdrop-blur-md shadow-sm transition-all duration-200 hover:bg-white/[0.04] hover:-translate-y-[1px] hover:border-[#7A1027]/25 hover:shadow-[0_0_0_1px_rgba(122,16,39,0.16),0_0_26px_rgba(122,16,39,0.10)]">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-lg bg-white/5 flex items-center justify-center text-white font-bold">
                            {server.icon ? (
                              <img src={server.icon} alt={server.name} className="w-full h-full object-cover rounded-lg" />
                            ) : (
                              server.name[0]
                            )}
                          </div>
                          <div>
                            <div className="font-bold text-white">{server.name}</div>
                            <div className="text-xs text-[#7b838a]">{server.categories[0]?.channels.length || 0} {t(language, 'channels')}</div>
                          </div>
                        </div>
                        <button 
                          onClick={() => leaveServer(server.id)}
                          className="p-2 text-neon-pink hover:bg-neon-pink/10 rounded-lg transition-all"
                          title="Salir del servidor"
                        >
                          <LogOut size={20} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 text-center text-[#7b838a]">
                    {t(language, 'no_servers')}
                  </div>
                )}
              </div>

              {/* Servidores Disponibles */}
              {availableServers.length > 0 && (
                <div className="space-y-4 pt-8 border-t border-white/5">
                  <h2 className="text-lg font-bold text-white">{t(language, 'available_servers')}</h2>
                  <div className="space-y-3">
                    {availableServers.map(server => (
                      <div key={server.id} className="flex items-center justify-between p-4 bg-white/[0.03] rounded-lg border border-white/10 backdrop-blur-md shadow-sm transition-all duration-200 hover:bg-white/[0.04] hover:-translate-y-[1px] hover:border-neon-green/30 hover:shadow-[0_0_0_1px_rgba(57,255,20,0.12),0_0_26px_rgba(57,255,20,0.08)]">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-lg bg-white/5 flex items-center justify-center text-white font-bold">
                            {server.icon ? (
                              <img src={server.icon} alt={server.name} className="w-full h-full object-cover rounded-lg" />
                            ) : (
                              server.name[0]
                            )}
                          </div>
                          <div>
                            <div className="font-bold text-white">{server.name}</div>
                            <div className="text-xs text-[#7b838a]">{server.members.length} {t(language, 'members')}</div>
                          </div>
                        </div>
                        <button 
                          onClick={() => joinServer(server.id)}
                          className="px-4 py-2 bg-neon-green text-black font-bold rounded-lg hover:bg-neon-green/90 transition-all"
                        >
                          {t(language, 'join')}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'plugins' && (
            <div className="space-y-8 animate-in slide-in-from-right-4 duration-300">
              <h1 className="text-2xl font-bold text-white">{t(language, 'plugins')}</h1>

              <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-md shadow-sm transition-all duration-200 hover:bg-white/[0.04] hover:-translate-y-[1px] hover:border-[#7A1027]/25 hover:shadow-[0_0_0_1px_rgba(122,16,39,0.16),0_0_30px_rgba(122,16,39,0.10)]">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-white/[0.03] border border-white/[0.05] flex items-center justify-center text-neon-blue">
                    <Puzzle size={20} />
                  </div>
                  <div>
                    <div className="text-white font-black">{t(language, 'plugin_manager')}</div>
                    <div className="text-[#949BA4] text-sm font-medium">{t(language, 'plugin_manager_desc')}</div>
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-1 gap-3">
                  <div className="flex items-center justify-between p-4 rounded-xl bg-white/[0.04] border border-white/10 transition-colors hover:bg-white/[0.06]">
                    <div>
                      <div className="text-white font-black">Message Tools</div>
                      <div className="text-[#949BA4] text-xs font-bold uppercase tracking-widest">Placeholder</div>
                    </div>
                    <button className="px-4 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06] text-white font-black uppercase tracking-widest text-[10px] hover:bg-white/[0.06] transition-all">
                      {t(language, 'disabled')}
                    </button>
                  </div>

                  <div className="flex items-center justify-between p-4 rounded-xl bg-white/[0.04] border border-white/10 transition-colors hover:bg-white/[0.06]">
                    <div>
                      <div className="text-white font-black">Theme Injector</div>
                      <div className="text-[#949BA4] text-xs font-bold uppercase tracking-widest">Placeholder</div>
                    </div>
                    <button className="px-4 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06] text-white font-black uppercase tracking-widest text-[10px] hover:bg-white/[0.06] transition-all">
                      {t(language, 'disabled')}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'languages' && (
            <div className="space-y-8 animate-in slide-in-from-right-4 duration-300">
              <h1 className="text-2xl font-bold text-white">{t(language, 'languages')}</h1>

              <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-md shadow-sm transition-all duration-200 hover:bg-white/[0.04] hover:-translate-y-[1px] hover:border-[#7A1027]/25 hover:shadow-[0_0_0_1px_rgba(122,16,39,0.16),0_0_30px_rgba(122,16,39,0.10)]">
                <div className="text-white font-black mb-4">{t(language, 'language_label')}</div>
                <div className="flex gap-3">
                  <button
                    onClick={() => setLanguage('es')}
                    className={cn(
                      "px-5 py-3 rounded-2xl border font-black uppercase tracking-widest text-[10px] transition-all",
                      language === 'es'
                        ? "bg-neon-blue text-white border-neon-blue/30"
                        : "bg-white/[0.03] text-white border-white/[0.06] hover:bg-white/[0.06]"
                    )}
                  >
                    Espanol
                  </button>
                  <button
                    onClick={() => setLanguage('en')}
                    className={cn(
                      "px-5 py-3 rounded-2xl border font-black uppercase tracking-widest text-[10px] transition-all",
                      language === 'en'
                        ? "bg-neon-blue text-white border-neon-blue/30"
                        : "bg-white/[0.03] text-white border-white/[0.06] hover:bg-white/[0.06]"
                    )}
                  >
                    English
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'notifications' && (
            <div className="space-y-8 animate-in slide-in-from-right-4 duration-300">
              <h1 className="text-2xl font-bold text-white">{t(language, 'notifications')}</h1>

              <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-md shadow-sm space-y-5 transition-all duration-200 hover:bg-white/[0.04] hover:-translate-y-[1px] hover:border-[#7A1027]/25 hover:shadow-[0_0_0_1px_rgba(122,16,39,0.16),0_0_30px_rgba(122,16,39,0.10)]">
                <div className="text-white font-black">In-app</div>
                {([
                  {
                    key: 'enableMentions',
                    label: 'Menciones',
                    sub: 'Mostrar toast cuando te mencionan',
                    value: notificationSettings.enableMentions,
                  },
                  {
                    key: 'enableThreadReplies',
                    label: 'Respuestas en hilo',
                    sub: 'Mostrar toast cuando responden en tus hilos',
                    value: notificationSettings.enableThreadReplies,
                  },
                  {
                    key: 'enableSoundMentions',
                    label: 'Sonido de menciones',
                    sub: 'Reproducir sonido para menciones',
                    value: notificationSettings.enableSoundMentions,
                  },
                  {
                    key: 'enableSoundThreadReplies',
                    label: 'Sonido de hilos',
                    sub: 'Reproducir sonido para respuestas en hilo',
                    value: notificationSettings.enableSoundThreadReplies,
                  },
                ] as const).map((row) => (
                  <div key={row.key} className="flex items-center justify-between gap-4 p-4 rounded-xl bg-white/[0.02] border border-white/10">
                    <div className="min-w-0">
                      <div className="text-white font-black">{row.label}</div>
                      <div className="text-[#949BA4] text-sm mt-1">{row.sub}</div>
                    </div>
                    <button
                      onClick={() => setNotificationSettings({ [row.key]: !row.value } as any)}
                      className={cn(
                        "w-12 h-7 rounded-full border transition-all relative flex-shrink-0",
                        row.value ? "bg-neon-blue border-neon-blue/30" : "bg-white/[0.04] border-white/10"
                      )}
                    >
                      <div className={cn(
                        "absolute top-1 w-5 h-5 rounded-full bg-white transition-all",
                        row.value ? "left-6" : "left-1"
                      )} />
                    </button>
                  </div>
                ))}
              </div>

              <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-md shadow-sm space-y-5 transition-all duration-200 hover:bg-white/[0.04] hover:-translate-y-[1px] hover:border-neon-green/25 hover:shadow-[0_0_0_1px_rgba(57,255,20,0.12),0_0_30px_rgba(57,255,20,0.10)]">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-white font-black">Notificaciones de escritorio</div>
                    <div className="text-[#949BA4] text-sm mt-1">
                      Estado navegador: <span className="font-black text-white/80 uppercase">{desktopPermission}</span>
                    </div>
                  </div>
                  <button
                    onClick={async () => {
                      if (typeof window === 'undefined' || !('Notification' in window)) {
                        setDesktopPermission('unsupported');
                        return;
                      }
                      const perm = await Notification.requestPermission();
                      setDesktopPermission(perm as 'default' | 'denied' | 'granted');
                    }}
                    className="px-4 py-2 rounded-xl bg-neon-green/80 text-black font-black uppercase tracking-widest text-[10px] hover:bg-neon-green transition-colors"
                  >
                    Pedir permiso
                  </button>
                </div>

                {([
                  {
                    key: 'desktopMentions',
                    label: 'Push para menciones',
                    sub: 'Enviar notificacion del sistema cuando te mencionan',
                    value: notificationSettings.desktopMentions,
                  },
                  {
                    key: 'desktopThreadReplies',
                    label: 'Push para hilos',
                    sub: 'Enviar notificacion del sistema para respuestas de hilo',
                    value: notificationSettings.desktopThreadReplies,
                  },
                ] as const).map((row) => (
                  <div key={row.key} className="flex items-center justify-between gap-4 p-4 rounded-xl bg-white/[0.02] border border-white/10">
                    <div className="min-w-0">
                      <div className="text-white font-black">{row.label}</div>
                      <div className="text-[#949BA4] text-sm mt-1">{row.sub}</div>
                    </div>
                    <button
                      disabled={desktopPermission !== 'granted'}
                      onClick={() => setNotificationSettings({ [row.key]: !row.value } as any)}
                      className={cn(
                        "w-12 h-7 rounded-full border transition-all relative flex-shrink-0",
                        row.value ? "bg-neon-green border-neon-green/30" : "bg-white/[0.04] border-white/10",
                        desktopPermission !== 'granted' && "opacity-40 cursor-not-allowed"
                      )}
                    >
                      <div className={cn(
                        "absolute top-1 w-5 h-5 rounded-full bg-white transition-all",
                        row.value ? "left-6" : "left-1"
                      )} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'developer' && (
            <div className="space-y-8 animate-in slide-in-from-right-4 duration-300">
              <h1 className="text-2xl font-bold text-white">{t(language, 'developer_options')}</h1>

              <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-md shadow-sm transition-all duration-200 hover:bg-white/[0.04] hover:-translate-y-[1px] hover:border-[#7A1027]/25 hover:shadow-[0_0_0_1px_rgba(122,16,39,0.16),0_0_30px_rgba(122,16,39,0.10)]">
                <div className="text-white font-black">{t(language, 'developer_mode')}</div>
                <div className="text-[#949BA4] text-sm mt-1">{t(language, 'developer_mode_desc')}</div>

                <div className="mt-5 p-4 rounded-xl bg-white/[0.04] border border-white/10 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-white font-black">{t(language, 'expose_ids')}</div>
                    <div className="text-[#B5BAC1] text-sm mt-1">{t(language, 'expose_ids_desc')}</div>
                  </div>
                  <button
                    onClick={() => setDeveloperMode(!developerMode)}
                    className={cn(
                      "mt-1 w-12 h-7 rounded-full border transition-all relative flex-shrink-0",
                      developerMode ? "bg-neon-blue border-neon-blue/30" : "bg-white/[0.04] border-white/10"
                    )}
                  >
                    <div className={cn(
                      "absolute top-1 w-5 h-5 rounded-full bg-white transition-all",
                      developerMode ? "left-6" : "left-1"
                    )} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'content_social' && (
            <div className="space-y-10 animate-in slide-in-from-right-4 duration-300">
              <h1 className="text-2xl font-bold text-white">{t(language, 'content_social')}</h1>

              <div className="space-y-4">
                <h2 className="text-lg font-black text-white">{t(language, 'content')}</h2>
                <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-md shadow-sm space-y-5 transition-all duration-200 hover:bg-white/[0.04] hover:-translate-y-[1px] hover:border-[#7A1027]/25 hover:shadow-[0_0_0_1px_rgba(122,16,39,0.14),0_0_30px_rgba(122,16,39,0.10)]">
                  <div>
                    <div className="text-white font-black">{t(language, 'sensitive_filters')}</div>
                    <div className="text-[#949BA4] text-sm font-medium mt-1">
                      {t(language, 'sensitive_filters_desc')}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-white font-black text-sm">{t(language, 'friend_dms')}</div>
                      </div>
                      <select
                        value={contentSocial.sensitiveMedia.friendDMs}
                        onChange={(e) => setContentSocial({ sensitiveMedia: { ...contentSocial.sensitiveMedia, friendDMs: e.target.value as any } })}
                        className="bg-white/[0.04] border border-white/10 text-white font-black text-xs uppercase tracking-widest px-3 py-2 rounded-xl outline-none focus:border-[#7A1027]/60 focus:bg-white/[0.06] transition-colors"
                      >
                        <option value="show">{t(language, 'show')}</option>
                        <option value="block">{t(language, 'block')}</option>
                      </select>
                    </div>

                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-white font-black text-sm">{t(language, 'other_dms')}</div>
                      </div>
                      <select
                        value={contentSocial.sensitiveMedia.otherDMs}
                        onChange={(e) => setContentSocial({ sensitiveMedia: { ...contentSocial.sensitiveMedia, otherDMs: e.target.value as any } })}
                        className="bg-white/[0.04] border border-white/10 text-white font-black text-xs uppercase tracking-widest px-3 py-2 rounded-xl outline-none focus:border-[#7A1027]/60 focus:bg-white/[0.06] transition-colors"
                      >
                        <option value="show">{t(language, 'show')}</option>
                        <option value="block">{t(language, 'block')}</option>
                      </select>
                    </div>

                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-white font-black text-sm">{t(language, 'server_channels')}</div>
                      </div>
                      <select
                        value={contentSocial.sensitiveMedia.serverChannels}
                        onChange={(e) => setContentSocial({ sensitiveMedia: { ...contentSocial.sensitiveMedia, serverChannels: e.target.value as any } })}
                        className="bg-white/[0.04] border border-white/10 text-white font-black text-xs uppercase tracking-widest px-3 py-2 rounded-xl outline-none focus:border-[#7A1027]/60 focus:bg-white/[0.06] transition-colors"
                      >
                        <option value="show">{t(language, 'show')}</option>
                        <option value="block">{t(language, 'block')}</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h2 className="text-lg font-black text-white">{t(language, 'dm_spam')}</h2>
                <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-md shadow-sm space-y-4 transition-all duration-200 hover:bg-white/[0.04] hover:-translate-y-[1px] hover:border-[#7A1027]/20 hover:shadow-[0_0_0_1px_rgba(122,16,39,0.12),0_0_26px_rgba(122,16,39,0.08)]">
                  <div className="text-[#949BA4] text-sm font-medium">{t(language, 'dm_spam_desc')}</div>

                  {([
                    { key: 'all', label: t(language, 'filter_all'), sub: t(language, 'filter_all_sub') },
                    { key: 'non_friends', label: t(language, 'filter_non_friends'), sub: t(language, 'filter_non_friends_sub') },
                    { key: 'none', label: t(language, 'filter_none'), sub: t(language, 'filter_none_sub') },
                  ] as const).map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => setContentSocial({ dmSpamFilter: opt.key })}
                      className={cn(
                        "w-full flex items-start gap-3 p-4 rounded-2xl border transition-all text-left",
                        contentSocial.dmSpamFilter === opt.key ? "bg-white/[0.04] border-[#7A1027]/40" : "bg-white/[0.02] border-white/10 hover:border-white/20 hover:bg-white/[0.03]"
                      )}
                    >
                      <div className={cn(
                        "mt-1 w-4 h-4 rounded-full border-2",
                        contentSocial.dmSpamFilter === opt.key ? "border-neon-blue bg-neon-blue" : "border-white/20"
                      )} />
                      <div className="min-w-0">
                        <div className="text-white font-black text-sm">{opt.label}</div>
                        <div className="text-[#949BA4] text-xs font-bold uppercase tracking-wider mt-1">{opt.sub}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <h2 className="text-lg font-black text-white">{t(language, 'interaction_permissions')}</h2>
                <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-md shadow-sm space-y-5 transition-all duration-200 hover:bg-white/[0.04] hover:-translate-y-[1px] hover:border-[#7A1027]/20 hover:shadow-[0_0_0_1px_rgba(122,16,39,0.12),0_0_26px_rgba(122,16,39,0.08)]">
                  {([
                    {
                      key: 'allowDMs',
                      label: t(language, 'direct_messages'),
                      sub: t(language, 'allow_dms_sub'),
                      value: contentSocial.allowDMs,
                      onToggle: () => setContentSocial({ allowDMs: !contentSocial.allowDMs }),
                    },
                    {
                      key: 'messageRequests',
                      label: t(language, 'message_requests'),
                      sub: t(language, 'message_requests_sub'),
                      value: contentSocial.messageRequests,
                      onToggle: () => setContentSocial({ messageRequests: !contentSocial.messageRequests }),
                    },
                  ] as const).map((row) => (
                    <div key={row.key} className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-white font-black">{row.label}</div>
                        <div className="text-[#949BA4] text-sm font-medium mt-1">{row.sub}</div>
                      </div>
                      <button
                        onClick={row.onToggle}
                        className={cn(
                          "w-12 h-7 rounded-full border transition-all relative flex-shrink-0",
                          row.value ? "bg-[#7A1027] border-[#7A1027]/60" : "bg-white/[0.04] border-white/10"
                        )}
                      >
                        <div className={cn(
                          "absolute top-1 w-5 h-5 rounded-full bg-white transition-all",
                          row.value ? "left-6" : "left-1"
                        )} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <h2 className="text-lg font-black text-white">{t(language, 'friend_requests')}</h2>
                <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-md shadow-sm space-y-5 transition-all duration-200 hover:bg-white/[0.04] hover:-translate-y-[1px] hover:border-[#7A1027]/20 hover:shadow-[0_0_0_1px_rgba(122,16,39,0.12),0_0_26px_rgba(122,16,39,0.08)]">
                  {([
                    {
                      key: 'everyone',
                      label: t(language, 'everyone'),
                      value: contentSocial.friendRequests.everyone,
                    },
                    {
                      key: 'friendsOfFriends',
                      label: t(language, 'friends_of_friends'),
                      value: contentSocial.friendRequests.friendsOfFriends,
                    },
                    {
                      key: 'serverMembers',
                      label: t(language, 'server_members'),
                      value: contentSocial.friendRequests.serverMembers,
                    },
                  ] as const).map((row) => (
                    <div key={row.key} className="flex items-center justify-between gap-4">
                      <div className="text-white font-black">{row.label}</div>
                      <button
                        onClick={() => setContentSocial({ friendRequests: { ...contentSocial.friendRequests, [row.key]: !row.value } as any })}
                        className={cn(
                          "w-12 h-7 rounded-full border transition-all relative flex-shrink-0",
                          row.value ? "bg-neon-blue border-neon-blue/30" : "bg-white/[0.04] border-white/10"
                        )}
                      >
                        <div className={cn(
                          "absolute top-1 w-5 h-5 rounded-full bg-white transition-all",
                          row.value ? "left-6" : "left-1"
                        )} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'voice_video' && (
            <div className="space-y-8 animate-in slide-in-from-right-4 duration-300">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-bold text-white">Voz y video</h1>
                  <div className="text-sm text-[#949BA4] mt-1">
                    Configura microfono, altavoces, camara y pruebas en tiempo real.
                  </div>
                </div>
                <button
                  onClick={() => void enumerateMediaDevices(true)}
                  className="px-4 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-white font-black text-xs uppercase tracking-widest hover:bg-white/[0.08] transition-all inline-flex items-center gap-2"
                >
                  <RefreshCw size={14} />
                  Actualizar
                </button>
              </div>

              {!mediaReady ? (
                <div className="p-4 rounded-xl bg-[#F23F43]/10 border border-[#F23F43]/30 text-[#F5B8BA] text-sm font-semibold">
                  No se detectaron dispositivos. Pulsa "Actualizar" para conceder permisos.
                </div>
              ) : null}
              {mediaError ? (
                <div className="p-4 rounded-xl bg-[#F23F43]/10 border border-[#F23F43]/30 text-[#F5B8BA] text-sm font-semibold">
                  {mediaError}
                </div>
              ) : null}
              {cameraError ? (
                <div className="p-4 rounded-xl bg-[#F23F43]/10 border border-[#F23F43]/30 text-[#F5B8BA] text-sm font-semibold">
                  {cameraError}
                </div>
              ) : null}

              <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-md shadow-sm space-y-6 transition-all duration-200 hover:bg-white/[0.04] hover:-translate-y-[1px] hover:border-[#7A1027]/20 hover:shadow-[0_0_0_1px_rgba(122,16,39,0.12),0_0_26px_rgba(122,16,39,0.08)]">
                <h2 className="text-lg font-black text-white">Voz</h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="text-sm font-black text-white">Microfono</div>
                    <GlassSelect
                      value={mediaSettings.inputDeviceId || ''}
                      placeholder="Dispositivo predeterminado"
                      onChange={(nextValue) => {
                        stopMicTest();
                        setMediaSettings({ inputDeviceId: nextValue || null });
                      }}
                      options={[
                        { value: '', label: 'Dispositivo predeterminado' },
                        ...audioInputDevices.map((device, index) => ({
                          value: device.deviceId,
                          label: device.label || `Microfono ${index + 1}`,
                        })),
                      ]}
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm font-black text-white">Altavoces</div>
                    <GlassSelect
                      value={mediaSettings.outputDeviceId || ''}
                      placeholder="Dispositivo predeterminado"
                      onChange={(nextValue) => setMediaSettings({ outputDeviceId: nextValue || null })}
                      options={[
                        { value: '', label: 'Dispositivo predeterminado' },
                        ...audioOutputDevices.map((device, index) => ({
                          value: device.deviceId,
                          label: device.label || `Altavoz ${index + 1}`,
                        })),
                      ]}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-black text-white">Calidad de voz</div>
                  <GlassSelect
                    value={mediaSettings.voiceQuality}
                    placeholder="Selecciona perfil"
                    onChange={(nextValue) =>
                      setMediaSettings({
                        voiceQuality:
                          nextValue === 'balanced' || nextValue === 'clarity' || nextValue === 'extreme'
                            ? nextValue
                            : 'clarity',
                      })
                    }
                    options={[
                      { value: 'balanced', label: 'Balanceado (estable)' },
                      { value: 'clarity', label: 'Nitidez (recomendado)' },
                      { value: 'extreme', label: 'Extremo (maxima fidelidad)' },
                    ]}
                  />
                  <div className="text-[11px] text-[#7b838a] font-semibold uppercase tracking-widest">
                    Balanceado reduce ruido. Nitidez mejora detalle. Extremo requiere mejor micro y auriculares.
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <div className="text-sm font-black text-white">Volumen del microfono: {Math.round(mediaSettings.microphoneVolume * 100)}%</div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(mediaSettings.microphoneVolume * 100)}
                      onChange={(e) => setMediaSettings({ microphoneVolume: Number(e.target.value) / 100 })}
                      className="voice-glass-slider"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm font-black text-white">Volumen de altavoces: {Math.round(mediaSettings.speakerVolume * 100)}%</div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(mediaSettings.speakerVolume * 100)}
                      onChange={(e) => setMediaSettings({ speakerVolume: Number(e.target.value) / 100 })}
                      className="voice-glass-slider"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => {
                      if (micTesting) {
                        stopMicTest();
                        return;
                      }
                      void startMicTest();
                    }}
                    className={cn(
                      "px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all border",
                      micTesting
                        ? "bg-[#F23F43]/15 border-[#F23F43]/40 text-[#F23F43]"
                        : "bg-neon-blue/20 border-neon-blue/40 text-neon-blue hover:bg-neon-blue/25"
                    )}
                  >
                    {micTesting ? 'Detener microfono' : 'Prueba de microfono'}
                  </button>
                  <button
                    onClick={() => void playSpeakerTestTone()}
                    className="px-5 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-white font-black text-xs uppercase tracking-widest hover:bg-white/[0.08] transition-all inline-flex items-center gap-2"
                  >
                    <Play size={13} />
                    Probar altavoces
                  </button>
                </div>

                <div className="w-full h-9 rounded-xl bg-black/30 border border-white/10 px-3 flex items-center gap-1">
                  {Array.from({ length: 52 }).map((_, idx) => {
                    const threshold = (idx + 1) / 52;
                    const active = micLevel >= threshold;
                    return (
                      <span
                        key={`mic-bar-${idx}`}
                        className={cn(
                          "h-5 w-[5px] rounded-full transition-all",
                          active
                            ? "bg-gradient-to-t from-neon-green via-[#58ffbf] to-[#dbfff1] shadow-[0_0_12px_rgba(0,255,148,0.55)]"
                            : "bg-white/10"
                        )}
                      />
                    );
                  })}
                </div>
              </div>

              <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-md shadow-sm space-y-6 transition-all duration-200 hover:bg-white/[0.04] hover:-translate-y-[1px] hover:border-[#7A1027]/20 hover:shadow-[0_0_0_1px_rgba(122,16,39,0.12),0_0_26px_rgba(122,16,39,0.08)]">
                <h2 className="text-lg font-black text-white">Camara</h2>

                <div className="space-y-2">
                  <div className="text-sm font-black text-white">Dispositivo de camara</div>
                  <GlassSelect
                    value={mediaSettings.cameraDeviceId || ''}
                    placeholder="Camara predeterminada"
                    onChange={(nextValue) => setMediaSettings({ cameraDeviceId: nextValue || null })}
                    options={[
                      { value: '', label: 'Camara predeterminada' },
                      ...videoInputDevices.map((device, index) => ({
                        value: device.deviceId,
                        label: device.label || `Camara ${index + 1}`,
                      })),
                    ]}
                  />
                </div>

                <div className="relative w-full aspect-video rounded-2xl border border-white/10 bg-black/40 overflow-hidden">
                  {cameraTesting ? (
                    <video
                      ref={cameraPreviewVideoRef}
                      className="w-full h-full object-cover"
                      autoPlay
                      playsInline
                      muted
                      onLoadedData={() => setCameraPreviewReady(true)}
                      onPlaying={() => setCameraPreviewReady(true)}
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <button
                        onClick={() => void startCameraPreview()}
                        className="px-6 py-3 rounded-xl bg-neon-blue/20 border border-neon-blue/40 text-neon-blue font-black uppercase tracking-widest text-xs hover:bg-neon-blue/30 transition-all"
                      >
                        Prueba de video
                      </button>
                    </div>
                  )}
                  {cameraTesting && !cameraPreviewReady ? (
                    <div className="absolute inset-0 bg-black/45 backdrop-blur-[1px] flex items-center justify-center">
                      <div className="px-4 py-2 rounded-xl bg-white/[0.05] border border-white/15 text-white/85 text-xs font-black uppercase tracking-widest">
                        Conectando camara...
                      </div>
                    </div>
                  ) : null}

                  {cameraTesting ? (
                    <button
                      onClick={() => stopCameraPreview()}
                      className="absolute top-3 right-3 px-4 py-2 rounded-xl bg-black/45 border border-white/20 text-white font-black uppercase tracking-widest text-[10px] hover:bg-black/60 transition-all"
                    >
                      Detener
                    </button>
                  ) : null}
                </div>

                <div className="flex items-center justify-between gap-4 p-4 rounded-xl bg-white/[0.02] border border-white/10">
                  <div>
                    <div className="text-white font-black">Previsualizar siempre el video</div>
                    <div className="text-[#949BA4] text-sm mt-1">
                      Mostrar vista previa de la camara al activar video.
                    </div>
                  </div>
                  <button
                    onClick={() => setMediaSettings({ alwaysPreviewVideo: !mediaSettings.alwaysPreviewVideo })}
                    className={cn(
                      "w-12 h-7 rounded-full border transition-all relative flex-shrink-0",
                      mediaSettings.alwaysPreviewVideo ? "bg-neon-blue border-neon-blue/30" : "bg-white/[0.04] border-white/10"
                    )}
                  >
                    <div
                      className={cn(
                        "absolute top-1 w-5 h-5 rounded-full bg-white transition-all",
                        mediaSettings.alwaysPreviewVideo ? "left-6" : "left-1"
                      )}
                    />
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'devices' && (
            <div className="space-y-8 animate-in slide-in-from-right-4 duration-300">
              <h1 className="text-2xl font-bold text-white">{t(language, 'devices')}</h1>

              <div className="space-y-6">
                <h2 className="text-lg font-bold text-white">{t(language, 'current_device')}</h2>
                <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-md shadow-sm transition-all duration-200 hover:bg-white/[0.04] hover:-translate-y-[1px] hover:border-[#7A1027]/25 hover:shadow-[0_0_0_1px_rgba(122,16,39,0.14),0_0_30px_rgba(122,16,39,0.10)]">
                  {currentDevice ? (
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-white font-black">{currentDevice.client}</div>
                        <div className="text-[#949BA4] text-sm mt-1">{currentDevice.location}</div>
                        <div className="text-[#7b838a] text-xs mt-3 font-bold uppercase tracking-widest">Sesion activa en este dispositivo</div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-[#949BA4] text-sm">No device session found.</div>
                  )}
                </div>

                <h2 className="text-lg font-bold text-white">{t(language, 'other_devices')}</h2>
                <div className="space-y-3">
                  {otherDevices.map(dev => (
                    <div key={dev.id} className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-md shadow-sm flex items-start justify-between gap-4 transition-all duration-200 hover:bg-white/[0.04] hover:-translate-y-[1px] hover:border-[#7A1027]/20 hover:shadow-[0_0_0_1px_rgba(122,16,39,0.12),0_0_26px_rgba(122,16,39,0.08)]">
                      <div className="min-w-0">
                        <div className="text-white font-black truncate">{dev.client}</div>
                        <div className="text-[#949BA4] text-sm mt-1 truncate">{dev.location}</div>
                        <div className="text-[#7b838a] text-xs mt-2 uppercase tracking-wider">
                          Ultima actividad: {formatLastActive(dev.lastActiveAt)}
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-2 flex-shrink-0">
                        <button
                          onClick={() => logoutDeviceSession(dev.id)}
                          className="px-3 py-2 rounded-lg bg-[#F23F43]/15 text-[#F23F43] font-bold hover:bg-[#F23F43]/20 transition-colors"
                        >
                          {t(language, 'log_out_device')}
                        </button>
                      </div>
                    </div>
                  ))}
                  {otherDevices.length === 0 ? (
                    <div className="text-[#949BA4] text-sm">No other devices.</div>
                  ) : null}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'privacy' && (
            <div className="space-y-10 animate-in slide-in-from-right-4 duration-300">
              <div>
                <h1 className="text-xl font-semibold text-white">{t(language, 'data_privacy')}</h1>
                <div className="text-sm text-[#B5BAC1] mt-1">{t(language, 'privacy_desc')}</div>
              </div>

              <div className="space-y-4">
                <h2 className="text-sm font-semibold text-white uppercase tracking-wider">{t(language, 'how_uses_data')}</h2>
                <div className="rounded-lg bg-white/[0.03] border border-white/10 backdrop-blur-md shadow-sm overflow-hidden transition-all duration-200 hover:bg-white/[0.04] hover:border-[#7A1027]/20 hover:shadow-[0_0_0_1px_rgba(122,16,39,0.12),0_0_26px_rgba(122,16,39,0.08)]">
                  {([
                    {
                      key: 'useDataToImprove',
                      title: t(language, 'use_data_improve'),
                      desc: t(language, 'use_data_improve_desc'),
                    },
                    {
                      key: 'useDataToPersonalize',
                      title: t(language, 'use_data_personalize'),
                      desc: t(language, 'use_data_personalize_desc'),
                    },
                    {
                      key: 'useThirdPartyDataToPersonalize',
                      title: t(language, 'use_third_party_data'),
                      desc: t(language, 'use_third_party_data_desc'),
                    },
                    {
                      key: 'useDataToPersonalizeExperience',
                      title: t(language, 'use_data_personalize_exp'),
                      desc: t(language, 'use_data_personalize_exp_desc'),
                    },
                    {
                      key: 'allowVoiceRecordingClips',
                      title: t(language, 'allow_voice_clips'),
                      desc: t(language, 'allow_voice_clips_desc'),
                    },
                  ] as const).map((row) => {
                    const value = (privacy as any)[row.key] as boolean;
                    return (
                      <div key={row.key} className="flex items-start justify-between gap-4 px-5 py-4 border-b border-white/5 last:border-b-0">
                        <div className="min-w-0">
                          <div className="text-white font-semibold">{row.title}</div>
                          <div className="text-[#B5BAC1] text-sm mt-1 leading-relaxed">{row.desc}</div>
                        </div>
                        <button
                          onClick={() => setPrivacy({ [row.key]: !value } as any)}
                          className={cn(
                            "mt-1 w-11 h-6 rounded-full border transition-colors relative flex-shrink-0",
                            value ? "bg-[#7A1027] border-[#7A1027]" : "bg-white/[0.04] border-white/10"
                          )}
                        >
                          <div className={cn(
                            "absolute top-[3px] w-5 h-5 rounded-full bg-white transition-all",
                            value ? "left-6" : "left-1"
                          )} />
                        </button>
                      </div>
                    );
                  })}

                  <div className="px-5 py-4 text-[#B5BAC1] text-sm border-t border-white/5">
                    {t(language, 'data_basic_use')}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h2 className="text-sm font-semibold text-white uppercase tracking-wider">{t(language, 'request_data')}</h2>
                <div className="p-5 rounded-lg bg-white/[0.03] border border-white/10 backdrop-blur-md shadow-sm transition-all duration-200 hover:bg-white/[0.04] hover:-translate-y-[1px] hover:border-[#7A1027]/20 hover:shadow-[0_0_0_1px_rgba(122,16,39,0.12),0_0_26px_rgba(122,16,39,0.08)]">
                  <div className="text-white font-semibold">{t(language, 'request_all_data')}</div>
                  <div className="text-[#B5BAC1] text-sm mt-1 leading-relaxed">
                    {t(language, 'request_data_desc')}
                  </div>
                  <button
                    onClick={handleRequestDataExport}
                    disabled={!canRequestData}
                    className={cn(
                      "mt-4 px-4 py-2 rounded-md font-semibold transition-colors",
                      canRequestData
                        ? "bg-[#7A1027] text-white hover:bg-[#5B0C1C]"
                        : "bg-white/[0.04] text-white/45 cursor-not-allowed"
                    )}
                  >
                    {t(language, 'request_data_btn')}
                  </button>
                  <div className="mt-2 text-xs text-[#949BA4]">
                    {canRequestData
                      ? (language === 'es' ? 'Puedes solicitar una exportacion cada 24 horas.' : 'You can request one export every 24 hours.')
                      : requestCooldownLabel}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h2 className="text-sm font-semibold text-white uppercase tracking-wider">{t(language, 'voice_security')}</h2>
                <div className="p-5 rounded-lg bg-white/[0.03] border border-white/10 backdrop-blur-md shadow-sm space-y-5 transition-all duration-200 hover:bg-white/[0.04] hover:-translate-y-[1px] hover:border-[#7A1027]/20 hover:shadow-[0_0_0_1px_rgba(122,16,39,0.12),0_0_26px_rgba(122,16,39,0.08)]">
                  <div className="text-[#B5BAC1] text-sm leading-relaxed">
                    {t(language, 'voice_security_desc')}
                  </div>

                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-white font-semibold">{t(language, 'persistent_verification')}</div>
                      <div className="text-[#B5BAC1] text-sm mt-1 leading-relaxed">
                        {t(language, 'persistent_verification_desc')}
                      </div>
                    </div>
                    <button
                      onClick={() => setPrivacy({ persistentVerificationCodes: !privacy.persistentVerificationCodes })}
                      className={cn(
                        "mt-1 w-11 h-6 rounded-full border transition-colors relative flex-shrink-0",
                        privacy.persistentVerificationCodes ? "bg-[#7A1027] border-[#7A1027]" : "bg-white/[0.04] border-white/10"
                      )}
                    >
                      <div className={cn(
                        "absolute top-[3px] w-5 h-5 rounded-full bg-white transition-all",
                        privacy.persistentVerificationCodes ? "left-6" : "left-1"
                      )} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {privacyToast ? (
          <div className="fixed bottom-8 right-10 z-[260] px-4 py-2 rounded-xl bg-[#0B0C10]/90 border border-neon-blue/30 text-neon-blue font-black uppercase tracking-widest text-[10px] shadow-[0_0_22px_rgba(194,24,60,0.18)]">
            {privacyToast}
          </div>
        ) : null}

        {showUnsavedBar ? (
          <div className="sticky bottom-4 z-[260] mx-auto mt-6 w-[min(720px,calc(100vw-2.5rem))] animate-in fade-in slide-in-from-bottom-2 duration-200">
            <div className="rounded-[22px] border border-[#D1425A]/30 bg-[radial-gradient(120%_120%_at_12%_0%,rgba(168,26,52,0.25),rgba(9,10,14,0.88)_55%)] backdrop-blur-2xl shadow-[0_20px_70px_rgba(0,0,0,0.55),0_0_40px_rgba(194,24,60,0.15)]">
              <div className="px-5 py-4 flex items-center justify-between gap-4">
                <div className="text-sm text-[#F2F4F7] font-semibold">{t(language, 'unsaved_changes')}</div>
                <div className="flex items-center gap-3">
                <button
                  onClick={handleDiscard}
                  disabled={profileSaving}
                  className="px-4 py-2 rounded-xl border border-white/10 bg-white/[0.04] text-[#DBDEE1] font-semibold hover:bg-white/[0.08] transition-all"
                >
                  {t(language, 'reset')}
                </button>
                <button
                  onClick={handleSaveProfile}
                  disabled={profileSaving}
                  className={cn(
                    "px-5 py-2 rounded-xl border border-[#B83A50]/50 bg-gradient-to-b from-[#B3183B] to-[#7A1027] text-white font-bold shadow-[0_0_24px_rgba(194,24,60,0.3)] transition-all",
                    profileSaving
                      ? "opacity-70 cursor-not-allowed"
                      : "hover:from-[#C21E43] hover:to-[#8A1430]"
                  )}
                >
                  {profileSaving ? 'Guardando...' : t(language, 'save_changes')}
                </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <ImageCropModal
          isOpen={!!pendingCrop}
          imageSrc={pendingCrop?.src || ''}
          title={pendingCrop?.title || 'Adjust image'}
          aspect={pendingCrop?.aspect || 1}
          shape={pendingCrop?.shape || 'rounded'}
          outputWidth={pendingCrop?.outputWidth}
          outputHeight={pendingCrop?.outputHeight}
          onCancel={() => setPendingCrop(null)}
          onConfirm={applyPendingCrop}
        />

        {/* Close Button */}
        <div className={cn("hidden lg:block fixed top-16 right-16 animate-in fade-in duration-500", shakeButton && "shake")}>
          <button 
            onClick={handleTryClose}
            disabled={hasChanges}
            className={cn(
              "flex flex-col items-center group transition-all",
              hasChanges && "opacity-50 cursor-not-allowed"
            )}
          >
            <div className={cn(
              "w-10 h-10 rounded-full border-2 flex items-center justify-center transition-all",
              hasChanges 
                ? "border-neon-pink text-neon-pink" 
                : "border-[#B5BAC1] group-hover:border-neon-pink group-hover:text-neon-pink"
            )}>
              <X size={24} />
            </div>
            <span className={cn(
              "text-xs font-bold mt-2 transition-all",
              hasChanges 
                ? "text-neon-pink" 
                : "text-[#B5BAC1] group-hover:text-neon-pink"
            )}>{hasChanges ? t(language, 'changes') : 'ESC'}</span>
          </button>
        </div>
      </div>
      </div>
    </div>
  );
};
