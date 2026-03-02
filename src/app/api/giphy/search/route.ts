import { NextRequest, NextResponse } from 'next/server';

type GiphyImageSet = Record<string, { url?: string } | undefined>;

type GiphyItem = {
  id?: string;
  title?: string;
  slug?: string;
  images?: GiphyImageSet;
};

type GiphyResponse = {
  data?: GiphyItem[];
  pagination?: {
    offset?: number;
    count?: number;
    total_count?: number;
  };
};

type TenorMediaMap = Record<string, { url?: string } | undefined>;

type TenorItem = {
  id?: string;
  title?: string;
  content_description?: string;
  media?: TenorMediaMap[];
};

type TenorResponse = {
  results?: TenorItem[];
  next?: string;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const safeFilename = (input: string, fallback: string): string => {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${cleaned || fallback}.gif`;
};

const pickBestUrl = (images: GiphyImageSet | undefined): string | null => {
  if (!images) return null;
  const priority = ['fixed_height', 'fixed_width', 'downsized_medium', 'downsized', 'original'];
  for (const key of priority) {
    const url = images[key]?.url;
    if (url) return url;
  }
  return null;
};

const toTags = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 12);

const mapResultItem = (item: { id: string; url: string; filename: string; title: string; tags: string[] }) => item;

const isDemoMode = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.NEXT_PUBLIC_DEMO || '').trim().toLowerCase()
);

const pickTenorUrl = (media: TenorMediaMap[] | undefined): string | null => {
  if (!Array.isArray(media) || media.length === 0) return null;
  const first = media[0] || {};
  const priority = ['gif', 'mediumgif', 'tinygif', 'mp4', 'webm'];
  for (const key of priority) {
    const url = first[key]?.url;
    if (url) return url;
  }
  return null;
};

const fetchFromGiphy = async (
  tab: 'gif' | 'sticker',
  q: string,
  pos: number,
  limit: number,
  key: string
) => {
  const useSearch = q.length > 0;
  const endpoint = useSearch
    ? `https://api.giphy.com/v1/${tab === 'sticker' ? 'stickers' : 'gifs'}/search`
    : `https://api.giphy.com/v1/${tab === 'sticker' ? 'stickers' : 'gifs'}/trending`;

  const params = new URLSearchParams({
    api_key: key,
    limit: String(limit),
    offset: String(pos),
    rating: 'pg-13',
    lang: 'es',
  });
  if (useSearch) params.set('q', q);

  const response = await fetch(`${endpoint}?${params.toString()}`, { cache: 'no-store' });
  if (!response.ok) {
    return { ok: false as const, results: [] as ReturnType<typeof mapResultItem>[], next: null as string | null };
  }

  const payload = (await response.json()) as GiphyResponse;
  const mapped = (payload.data || [])
    .map((item, idx) => {
      const url = pickBestUrl(item.images);
      if (!url) return null;
      const label = (item.title || item.slug || `${tab}-${idx + 1}`).trim();
      return mapResultItem({
        id: item.id || `${tab}-${idx + 1}`,
        url,
        filename: safeFilename(label, `${tab}-${idx + 1}`),
        title: label,
        tags: toTags(label),
      });
    })
    .filter((item): item is ReturnType<typeof mapResultItem> => item !== null);

  const pagination = payload.pagination || {};
  const nextOffset = (pagination.offset || 0) + (pagination.count || mapped.length);
  const hasMore = typeof pagination.total_count === 'number' ? nextOffset < pagination.total_count : mapped.length >= limit;
  return {
    ok: true as const,
    results: mapped,
    next: hasMore ? String(nextOffset) : null,
  };
};

const fetchFromTenor = async (q: string, pos: number, limit: number) => {
  const endpoint = q.length > 0 ? 'search' : 'trending';
  const params = new URLSearchParams({
    key: 'LIVDSRZULELA',
    limit: String(limit),
    pos: String(pos),
    media_filter: 'gif,tinygif,mediumgif,mp4',
    contentfilter: 'medium',
  });
  if (q.length > 0) params.set('q', q);

  const response = await fetch(`https://g.tenor.com/v1/${endpoint}?${params.toString()}`, { cache: 'no-store' });
  if (!response.ok) {
    return { ok: false as const, results: [] as ReturnType<typeof mapResultItem>[], next: null as string | null };
  }

  const payload = (await response.json()) as TenorResponse;
  const mapped = (payload.results || [])
    .map((item, idx) => {
      const url = pickTenorUrl(item.media);
      if (!url) return null;
      const label = (item.title || item.content_description || `tenor-${idx + 1}`).trim();
      return mapResultItem({
        id: item.id || `tenor-${idx + 1}`,
        url,
        filename: safeFilename(label, `tenor-${idx + 1}`),
        title: label,
        tags: toTags(label),
      });
    })
    .filter((item): item is ReturnType<typeof mapResultItem> => item !== null);

  return {
    ok: true as const,
    results: mapped,
    next: payload.next || null,
  };
};

export async function GET(request: NextRequest) {
  if (isDemoMode) {
    return NextResponse.json({
      enabled: false,
      provider: 'demo',
      results: [],
      next: null,
      error: 'disabled_in_demo_mode',
    });
  }

  const search = request.nextUrl.searchParams;
  const tab = search.get('type') === 'sticker' ? 'sticker' : 'gif';
  const q = (search.get('q') || '').trim();
  const pos = clamp(Number.parseInt(search.get('pos') || '0', 10) || 0, 0, 5000);
  const limit = clamp(Number.parseInt(search.get('limit') || '24', 10) || 24, 1, 60);

  const configuredGiphyKey = (process.env.GIPHY_API_KEY || process.env.NEXT_PUBLIC_GIPHY_API_KEY || '').trim();

  try {
    if (configuredGiphyKey) {
      const giphy = await fetchFromGiphy(tab, q, pos, limit, configuredGiphyKey);
      if (giphy.ok && giphy.results.length > 0) {
        return NextResponse.json({
          enabled: true,
          provider: 'giphy',
          results: giphy.results,
          next: giphy.next,
        });
      }
    }

    const tenor = await fetchFromTenor(q, pos, limit);
    if (tenor.ok) {
      return NextResponse.json({
        enabled: true,
        provider: 'tenor',
        results: tenor.results,
        next: tenor.next,
      });
    }

    return NextResponse.json({
      enabled: false,
      provider: 'fallback',
      results: [],
      next: null,
    });
  } catch {
    return NextResponse.json({
      enabled: false,
      provider: 'fallback',
      results: [],
      next: null,
      error: 'network_error',
    });
  }
}
