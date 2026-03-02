const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://diavlo-cord.vercel.app',
  'https://diavlocord.vercel.app',
];

const VERCEL_PREVIEW_RE = /^https:\/\/[a-z0-9-]+\.vercel\.app$/i;
const RENDER_APP_RE = /^https:\/\/[a-z0-9-]+\.onrender\.com$/i;
const NETLIFY_APP_RE = /^https:\/\/[a-z0-9-]+\.netlify\.app$/i;
const LOCALHOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

const normalizeOrigin = (value: string): string => value.trim().replace(/^['"]|['"]$/g, '').replace(/\/+$/, '');

const parseConfiguredOrigins = (raw: string): string[] =>
  raw
    .split(/[,;\n]+/g)
    .map((value) => normalizeOrigin(value))
    .filter(Boolean);

const wildcardToRegex = (pattern: string): RegExp | null => {
  if (!pattern.includes('*')) return null;
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  try {
    return new RegExp(`^${escaped}$`, 'i');
  } catch {
    return null;
  }
};

export const getAllowedCorsOrigins = (): string[] => {
  const configured = parseConfiguredOrigins(process.env.CORS_ORIGIN || '');
  const merged = new Set<string>([...DEFAULT_ALLOWED_ORIGINS.map(normalizeOrigin), ...configured]);
  return Array.from(merged);
};

export const isOriginAllowed = (origin: string | undefined, allowed: string[]): boolean => {
  if (!origin) return true;
  const normalizedOrigin = normalizeOrigin(origin);
  if (allowed.includes('*')) return true;
  if (allowed.includes(normalizedOrigin)) return true;
  if (LOCALHOST_RE.test(normalizedOrigin)) return true;
  if (VERCEL_PREVIEW_RE.test(normalizedOrigin)) return true;
  if (RENDER_APP_RE.test(normalizedOrigin)) return true;
  if (NETLIFY_APP_RE.test(normalizedOrigin)) return true;
  const wildcardPatterns = allowed
    .filter((item) => item.includes('*'))
    .map((item) => wildcardToRegex(item))
    .filter((item): item is RegExp => Boolean(item));
  if (wildcardPatterns.some((re) => re.test(normalizedOrigin))) return true;
  return false;
};

export const createCorsOriginValidator =
  (allowed: string[]) =>
  (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
    if (isOriginAllowed(origin, allowed)) {
      callback(null, true);
      return;
    }
    // Do not crash request processing for unknown origins; just deny CORS.
    callback(null, false);
  };
