const stripWrappingQuotes = (value: string) => value.replace(/^['"]+|['"]+$/g, '');

const normalizeHost = (hostname: string) =>
  hostname
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('.')
    .toLowerCase();

const normalizeEndpoint = (raw: string, fallbackProtocol: 'https:' | 'wss:' | 'http:' | 'ws:') => {
  const value = stripWrappingQuotes(String(raw || '').trim());
  if (!value) return '';

  const withProtocol = (() => {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
    if (value.startsWith('//')) return `${fallbackProtocol}${value}`;
    return `${fallbackProtocol}//${value}`;
  })();

  const cleanedBase = withProtocol
    .replace(/^(https?|wss?):\/(?!\/)/i, '$1://')
    .replace(/\/+$/, '')
    .trim();

  const parseCandidate = (candidate: string): URL | null => {
    try {
      return new URL(candidate);
    } catch {
      return null;
    }
  };

  let parsed = parseCandidate(cleanedBase);
  if (!parsed) {
    parsed = parseCandidate(cleanedBase.replace(/\.{2,}/g, '.'));
  }
  if (!parsed) return '';

  const safeHost = normalizeHost(parsed.hostname);
  if (!safeHost) return '';
  parsed.hostname = safeHost;

  if (!parsed.pathname || parsed.pathname === '/') {
    parsed.pathname = '';
  } else {
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  }

  return parsed.toString().replace(/\/$/, '');
};

// This repo is distributed as a public demo, so auth/login is permanently disabled.
export const isDemoMode = true;

const apiUrl = isDemoMode
  ? ''
  : normalizeEndpoint(process.env.NEXT_PUBLIC_API_URL || '', 'https:');

const wsInput = isDemoMode
  ? ''
  : process.env.NEXT_PUBLIC_WS_URL || process.env.NEXT_PUBLIC_API_URL || '';

const wsUrl = normalizeEndpoint(wsInput, wsInput.startsWith('http://') ? 'ws:' : 'wss:');

const realAppUrl = normalizeEndpoint(
  process.env.NEXT_PUBLIC_REAL_APP_URL || 'https://diavlo-cord.vercel.app',
  'https:'
);

export const env = {
  apiUrl,
  wsUrl,
  realAppUrl,
};

export const isBackendEnabled = Boolean(env.apiUrl) && !isDemoMode;
