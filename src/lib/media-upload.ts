import { env } from './env';

export type UploadedMedia = {
  url: string;
  filename: string;
  contentType: string;
  size: number;
};

type UploadFileInput = {
  file: File;
  token: string;
  purpose?: string;
};

const EXTENSION_MIME_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
};

export const inferMimeTypeFromFilename = (filename: string | undefined, fallback = 'application/octet-stream') => {
  const raw = (filename || '').trim().toLowerCase();
  const dotIndex = raw.lastIndexOf('.');
  if (dotIndex < 0 || dotIndex === raw.length - 1) return fallback;
  const ext = raw.slice(dotIndex);
  return EXTENSION_MIME_MAP[ext] || fallback;
};

export const uploadFileToBackend = async ({ file, token, purpose = 'chat' }: UploadFileInput): Promise<UploadedMedia> => {
  if (!env.apiUrl) {
    throw new Error('backend_disabled');
  }

  const params = new URLSearchParams({
    filename: file.name || 'file',
    purpose,
  });

  const response = await fetch(`${env.apiUrl}/media/upload?${params.toString()}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': file.type || inferMimeTypeFromFilename(file.name),
    },
    body: file,
  });

  if (!response.ok) {
    throw new Error(`upload_failed_${response.status}`);
  }

  const payload = (await response.json()) as Partial<UploadedMedia>;
  if (!payload.url || typeof payload.url !== 'string') {
    throw new Error('upload_invalid_response');
  }

  let resolvedUrl = payload.url;
  if (env.apiUrl && typeof resolvedUrl === 'string') {
    try {
      const backendBase = new URL(env.apiUrl);
      if (/^\/[^/]/.test(resolvedUrl)) {
        resolvedUrl = new URL(resolvedUrl, backendBase.origin).toString();
      } else if (/^https?:\/\//i.test(resolvedUrl)) {
        const parsed = new URL(resolvedUrl);
        if (parsed.pathname.startsWith('/media/chat/')) {
          resolvedUrl = new URL(`${parsed.pathname}${parsed.search}`, backendBase.origin).toString();
        }
      } else {
        resolvedUrl = new URL(resolvedUrl, backendBase.origin).toString();
      }
    } catch {}
  }

  return {
    url: resolvedUrl,
    filename: typeof payload.filename === 'string' && payload.filename.trim().length > 0 ? payload.filename : file.name,
    contentType:
      typeof payload.contentType === 'string' && payload.contentType.trim().length > 0
        ? payload.contentType
        : file.type || inferMimeTypeFromFilename(file.name),
    size: typeof payload.size === 'number' && Number.isFinite(payload.size) ? payload.size : file.size,
  };
};
