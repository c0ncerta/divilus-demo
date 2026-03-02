export type CrewAura = 'none' | 'pulse' | 'scan' | 'neon';

export type CrewEmblemPreset = {
  id: string;
  label: string;
  glyph: string;
  accent: string;
  glow: string;
};

export type CrewIdentity = {
  enabled: boolean;
  emblemId: string;
  customEmblemUrl?: string;
  crewName: string;
  crewTag: string;
  color: string;
  aura: CrewAura;
  updatedAt: string;
};

const CREW_STORAGE_KEY = 'diavlocord-crew-emblem-v1';
export const CREW_CUSTOM_EMBLEM_ID = 'custom';
export const CREW_MAX_CUSTOM_EMBLEM_FILE_BYTES = 350 * 1024;
export const CREW_MAX_CUSTOM_EMBLEM_URL_LENGTH = 220000;

export const CREW_EMBLEM_OPTIONS: CrewEmblemPreset[] = [
  { id: 'nova', label: 'Nova Sigil', glyph: '\u2739', accent: '#FF4F8B', glow: 'rgba(255,79,139,0.38)' },
  { id: 'vortex', label: 'Vortex Core', glyph: '\u25C9', accent: '#7E5BFF', glow: 'rgba(126,91,255,0.35)' },
  { id: 'radar', label: 'Radar Node', glyph: '\u25CE', accent: '#00D4FF', glow: 'rgba(0,212,255,0.35)' },
  { id: 'forge', label: 'Forge Mark', glyph: '\u2692', accent: '#FF8B3D', glow: 'rgba(255,139,61,0.35)' },
  { id: 'glyph', label: 'Glyph Ring', glyph: '\u273A', accent: '#9DFF57', glow: 'rgba(157,255,87,0.34)' },
  { id: 'crown', label: 'Crown Crest', glyph: '\u265B', accent: '#F7CA45', glow: 'rgba(247,202,69,0.35)' },
  { id: 'shard', label: 'Shard Hex', glyph: '\u25C7', accent: '#FF6AD5', glow: 'rgba(255,106,213,0.35)' },
  { id: 'anchor', label: 'Anchor Flux', glyph: '\u269B', accent: '#51F0B8', glow: 'rgba(81,240,184,0.35)' },
];

export const CREW_AURA_OPTIONS: Array<{ id: CrewAura; label: string }> = [
  { id: 'none', label: 'Static' },
  { id: 'pulse', label: 'Pulse' },
  { id: 'scan', label: 'Scanline' },
  { id: 'neon', label: 'Neon' },
];

const normalizeColor = (value?: string) => {
  if (!value) return '#7A1027';
  const trimmed = value.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(trimmed)) return '#7A1027';
  return trimmed.toUpperCase();
};

export const normalizeCrewCustomEmblemUrl = (value?: string) => {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > CREW_MAX_CUSTOM_EMBLEM_URL_LENGTH) return '';
  if (/^data:image\/gif;base64,[a-zA-Z0-9+/=]+$/.test(trimmed)) return trimmed;
  if (/^https?:\/\/\S+$/i.test(trimmed)) return trimmed;
  return '';
};

export const isCrewCustomEmblemGif = (value?: string) => {
  const normalized = normalizeCrewCustomEmblemUrl(value);
  if (!normalized) return false;
  if (normalized.startsWith('data:image/gif;base64,')) return true;
  return /\.gif(?:$|[?#])/i.test(normalized);
};

export const normalizeCrewTag = (value: string) =>
  value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 5);

export const normalizeCrewName = (value: string) =>
  value
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);

export const createDefaultCrewIdentity = (): CrewIdentity => ({
  enabled: false,
  emblemId: CREW_EMBLEM_OPTIONS[0]?.id || 'nova',
  customEmblemUrl: '',
  crewName: 'Shadow Grid',
  crewTag: 'GRID',
  color: '#7A1027',
  aura: 'pulse',
  updatedAt: new Date().toISOString(),
});

const resolveEmblemId = (id?: string, customUrl?: string) => {
  if (id === CREW_CUSTOM_EMBLEM_ID && isCrewCustomEmblemGif(customUrl)) {
    return CREW_CUSTOM_EMBLEM_ID;
  }
  return CREW_EMBLEM_OPTIONS.some((option) => option.id === id) ? String(id) : createDefaultCrewIdentity().emblemId;
};

const normalizeAura = (aura?: string): CrewAura =>
  (CREW_AURA_OPTIONS.some((entry) => entry.id === aura) ? aura : 'pulse') as CrewAura;

export const getCrewStorageKey = (userId: string) => `${CREW_STORAGE_KEY}:${userId}`;

export const readCrewIdentity = (userId: string): CrewIdentity | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(getCrewStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CrewIdentity>;
    const crewName = normalizeCrewName(parsed.crewName || '');
    const crewTag = normalizeCrewTag(parsed.crewTag || '');
    const customEmblemUrl = isCrewCustomEmblemGif(parsed.customEmblemUrl)
      ? normalizeCrewCustomEmblemUrl(parsed.customEmblemUrl)
      : '';
    if (!crewName || !crewTag) return null;
    return {
      enabled: Boolean(parsed.enabled),
      emblemId: resolveEmblemId(parsed.emblemId, customEmblemUrl),
      customEmblemUrl,
      crewName,
      crewTag,
      color: normalizeColor(parsed.color),
      aura: normalizeAura(parsed.aura),
      updatedAt: parsed.updatedAt || new Date().toISOString(),
    };
  } catch {
    return null;
  }
};

export const writeCrewIdentity = (userId: string, payload: CrewIdentity) => {
  if (typeof window === 'undefined') return;
  try {
    const normalizedCustomEmblemUrl = isCrewCustomEmblemGif(payload.customEmblemUrl)
      ? normalizeCrewCustomEmblemUrl(payload.customEmblemUrl)
      : '';
    const emblemId = resolveEmblemId(payload.emblemId, normalizedCustomEmblemUrl);
    const next: CrewIdentity = {
      enabled: Boolean(payload.enabled),
      emblemId,
      customEmblemUrl: emblemId === CREW_CUSTOM_EMBLEM_ID ? normalizedCustomEmblemUrl : '',
      crewName: normalizeCrewName(payload.crewName) || createDefaultCrewIdentity().crewName,
      crewTag: normalizeCrewTag(payload.crewTag) || createDefaultCrewIdentity().crewTag,
      color: normalizeColor(payload.color),
      aura: normalizeAura(payload.aura),
      updatedAt: payload.updatedAt || new Date().toISOString(),
    };
    localStorage.setItem(getCrewStorageKey(userId), JSON.stringify(next));
    try {
      window.dispatchEvent(new CustomEvent('diavlocord:crew-updated', { detail: { userId } }));
    } catch {}
  } catch {}
};

export const getCrewPreset = (emblemId?: string) =>
  CREW_EMBLEM_OPTIONS.find((option) => option.id === emblemId) || CREW_EMBLEM_OPTIONS[0];
