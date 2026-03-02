import type { User } from './types';

const asString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const versionStamp = (updatedAt?: string): string | undefined => {
  if (!updatedAt) return undefined;
  const ts = Date.parse(updatedAt);
  return Number.isFinite(ts) ? String(ts) : updatedAt;
};

const withAssetVersion = (value: unknown, updatedAt?: string): string | undefined => {
  const asset = asString(value);
  if (!asset) return undefined;
  if (asset.startsWith('data:') || asset.startsWith('blob:')) return asset;

  const stamp = versionStamp(updatedAt);
  if (!stamp) return asset;

  const [withoutHash, hash = ''] = asset.split('#', 2);
  const [path, query = ''] = withoutHash.split('?', 2);
  const params = new URLSearchParams(query);
  params.set('v', stamp);

  const nextQuery = params.toString();
  const withQuery = nextQuery ? `${path}?${nextQuery}` : path;
  return hash ? `${withQuery}#${hash}` : withQuery;
};

export const mapBackendUser = (input: any): User => {
  const updatedAt = asString(input?.updatedAt);
  const rawStatus = String(input?.status || '').toLowerCase();
  const status: User['status'] =
    rawStatus === 'idle' || rawStatus === 'dnd' || rawStatus === 'offline' || rawStatus === 'online'
      ? rawStatus
      : 'online';
  return {
    id: String(input?.id || ''),
    username: String(input?.username || ''),
    discriminator: String(input?.discriminator || ''),
    avatar: withAssetVersion(input?.avatar, updatedAt),
    banner: withAssetVersion(input?.banner, updatedAt),
    bannerColor: asString(input?.bannerColor),
    bio: asString(input?.bio),
    displayName: asString(input?.displayName),
    pronouns: asString(input?.pronouns),
    customStatus: asString(input?.customStatus),
    createdAt: asString(input?.createdAt),
    updatedAt,
    status,
    serverIds: [],
  };
};
