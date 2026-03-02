import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { createServer } from 'http';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { spawn, spawnSync } from 'child_process';
import { createRequire } from 'module';
import { prisma } from './prisma.js';
import { signAccessToken, requireAuth } from './auth.js';
import { createCorsOriginValidator, getAllowedCorsOrigins } from './cors.js';
import { createSocketServer, emitToAll, emitToUser } from './socket.js';

const app = express();
const allowedCorsOrigins = getAllowedCorsOrigins();
const requestBodyLimit = process.env.REQUEST_BODY_LIMIT || '320mb';
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Permissions-Policy',
    'camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), midi=(), accelerometer=(), gyroscope=()'
  );
  const isMediaChatRequest = req.path.startsWith('/media/chat/');
  // Frontend and API can live on different hosts (e.g. Vercel + Render).
  // Media must be embeddable cross-origin for avatars/banners/GIFs/audio/video.
  res.setHeader('Cross-Origin-Resource-Policy', isMediaChatRequest ? 'cross-origin' : 'same-site');
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  if (forwardedProto.includes('https')) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  next();
});

app.use(express.json({ limit: requestBodyLimit }));
app.use(
  cors({
    origin: createCorsOriginValidator(allowedCorsOrigins),
    credentials: true,
  })
);

const MEDIA_UPLOAD_MAX_BYTES = Number(process.env.MEDIA_UPLOAD_MAX_BYTES || 200 * 1024 * 1024);
const MEDIA_UPLOAD_LIMIT = process.env.MEDIA_UPLOAD_LIMIT || '220mb';
const AUTH_RATE_LIMIT_WINDOW_MS = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 10 * 60 * 1000);
const AUTH_RATE_LIMIT_MAX = Number(process.env.AUTH_RATE_LIMIT_MAX || 30);
const MEDIA_RATE_LIMIT_WINDOW_MS = Number(process.env.MEDIA_RATE_LIMIT_WINDOW_MS || 10 * 60 * 1000);
const MEDIA_RATE_LIMIT_MAX = Number(process.env.MEDIA_RATE_LIMIT_MAX || 60);
const BOOTSTRAP_CACHE_TTL_MS = Number(process.env.BOOTSTRAP_CACHE_TTL_MS || 10_000);
const BOOTSTRAP_DM_MESSAGES_PER_CONVERSATION = Number(
  process.env.BOOTSTRAP_DM_MESSAGES_PER_CONVERSATION || 120
);
const BOOTSTRAP_MAX_CONVERSATIONS = Number(process.env.BOOTSTRAP_MAX_CONVERSATIONS || 140);

const mediaStorageRoot = process.env.MEDIA_STORAGE_DIR
  ? path.resolve(process.env.MEDIA_STORAGE_DIR)
  : path.resolve(process.cwd(), 'media-storage');
const mediaChatDir = path.join(mediaStorageRoot, 'chat');

type RateLimitEntry = { count: number; resetAt: number };
const rateLimitStore = new Map<string, RateLimitEntry>();

const extractClientIp = (req: Request) => {
  const forwarded = String(req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  if (forwarded) return forwarded;
  return String(req.ip || 'unknown');
};

const createRateLimiter = (options: { keyPrefix: string; windowMs: number; max: number }) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const ip = extractClientIp(req);
    const key = `${options.keyPrefix}:${ip}`;
    const current = rateLimitStore.get(key);

    if (!current || current.resetAt <= now) {
      rateLimitStore.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }

    if (current.count >= options.max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({
        error: 'rate_limited',
        retryAfterSeconds,
      });
    }

    current.count += 1;
    rateLimitStore.set(key, current);
    return next();
  };
};

const authRateLimit = createRateLimiter({
  keyPrefix: 'auth',
  windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
  max: AUTH_RATE_LIMIT_MAX,
});

const mediaRateLimit = createRateLimiter({
  keyPrefix: 'media',
  windowMs: MEDIA_RATE_LIMIT_WINDOW_MS,
  max: MEDIA_RATE_LIMIT_MAX,
});

type BootstrapCacheEntry = {
  expiresAt: number;
  payload: unknown;
};
const bootstrapCache = new Map<string, BootstrapCacheEntry>();
const invalidateBootstrapCache = (userIds?: string[]) => {
  if (!userIds || userIds.length === 0) {
    bootstrapCache.clear();
    return;
  }
  for (const userId of userIds) {
    for (const key of Array.from(bootstrapCache.keys())) {
      if (key.startsWith(`${userId}:`)) {
        bootstrapCache.delete(key);
      }
    }
  }
};

app.use(
  '/media/chat',
  express.static(mediaChatDir, {
    fallthrough: true,
    maxAge: '30d',
    setHeaders: (res) => {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  })
);

app.get('/health', (_req, res) => res.json({ ok: true }));

const asyncRoute =
  (handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res, next).catch(next);
  };

const getErrorCode = (error: unknown): string =>
  typeof error === 'object' && error && 'code' in error && typeof (error as any).code === 'string'
    ? String((error as any).code)
    : '';

const getErrorMessage = (error: unknown): string =>
  typeof error === 'object' && error && 'message' in error && typeof (error as any).message === 'string'
    ? String((error as any).message)
    : '';

const redactSensitive = (value: string): string =>
  value
    .replace(/(postgres(?:ql)?:\/\/[^:]+:)[^@]+@/gi, '$1***@')
    .replace(/(password=)[^&\s]+/gi, '$1***')
    .replace(/(user=)[^&\s]+/gi, '$1***');

const isDatabaseUnavailableError = (error: unknown): boolean => {
  const message = getErrorMessage(error);
  const code = getErrorCode(error);
  const details = `${code} ${message}`.toLowerCase();
  return /p1001|p1002|can't reach database server|timed out|econnrefused|econnreset|enotfound|prismaclientinitializationerror|data transfer quota|connection limit|database is unavailable|no pg_hba\.conf entry|too many connections/.test(
    details
  );
};

const getDatabaseErrorDiagnosis = (error: unknown): { kind: 'unavailable' | 'auth' | 'ssl' | 'misconfigured' | 'unknown'; code: string; hint: string; details: string } => {
  const code = getErrorCode(error);
  const message = redactSensitive(getErrorMessage(error));
  const details = `${code} ${message}`.toLowerCase();

  if (
    /p1001|p1002|can't reach database server|timed out|econnrefused|econnreset|enotfound|no pg_hba\.conf entry|too many connections|database is unavailable|data transfer quota|connection limit/.test(
      details
    )
  ) {
    return {
      kind: 'unavailable',
      code,
      hint: 'No se alcanza la base de datos desde Render. Revisa host/puerto y firewall o allowlist de IPs.',
      details: message,
    };
  }

  if (/password authentication failed|authentication failed|28p01|28000|role .* does not exist|invalid credentials/.test(details)) {
    return {
      kind: 'auth',
      code,
      hint: 'Credenciales invalidas en DATABASE_URL (usuario/password).',
      details: message,
    };
  }

  if (/ssl is required|sslmode|tls|self signed certificate|certificate verify failed|ssl off/.test(details)) {
    return {
      kind: 'ssl',
      code,
      hint: 'Problema SSL/TLS. Ajusta parametros SSL en DATABASE_URL (ej: sslmode=require).',
      details: message,
    };
  }

  if (/database .* does not exist|schema .* does not exist|relation .* does not exist|p1003|p1010/.test(details)) {
    return {
      kind: 'misconfigured',
      code,
      hint: 'La base existe pero la config no coincide (database/schema/permisos).',
      details: message,
    };
  }

  return {
    kind: 'unknown',
    code,
    hint: 'Error no clasificado de base de datos. Revisa logs de Render para el stack completo.',
    details: message,
  };
};

app.get('/health/db', asyncRoute(async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.json({ ok: true, db: 'up' });
  } catch (error) {
    const diagnosis = getDatabaseErrorDiagnosis(error);
    if (isDatabaseUnavailableError(error)) {
      return res.status(503).json({
        ok: false,
        db: 'down',
        error: 'database_unavailable',
        code: diagnosis.code || null,
        hint: diagnosis.hint,
        details: diagnosis.details,
      });
    }
    return res.status(500).json({
      ok: false,
      db: 'down',
      error: 'database_error',
      code: diagnosis.code || null,
      hint: diagnosis.hint,
      details: diagnosis.details,
    });
  }
}));

type SnapshotInvite = {
  code: string;
  createdBy: string;
  createdAt: string;
  uses: number;
  maxUses: number | null;
  expiresAt: string | null;
  revoked: boolean;
  revokedAt: string | null;
};

const normalizeInviteCode = (value: string) => value.trim().toLowerCase();

const normalizeSnapshotInvite = (raw: any): SnapshotInvite | null => {
  const code = typeof raw?.code === 'string' ? normalizeInviteCode(raw.code) : '';
  if (!code) return null;
  const usesNum = Number(raw?.uses);
  const maxUsesNum = Number(raw?.maxUses);
  return {
    code,
    createdBy: typeof raw?.createdBy === 'string' ? raw.createdBy : '',
    createdAt: typeof raw?.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    uses: Number.isFinite(usesNum) ? Math.max(0, Math.floor(usesNum)) : 0,
    maxUses: Number.isFinite(maxUsesNum) && maxUsesNum > 0 ? Math.floor(maxUsesNum) : null,
    expiresAt: typeof raw?.expiresAt === 'string' ? raw.expiresAt : null,
    revoked: Boolean(raw?.revoked),
    revokedAt: typeof raw?.revokedAt === 'string' ? raw.revokedAt : null,
  };
};

const getInviteStatus = (invite: SnapshotInvite): 'valid' | 'revoked' | 'expired' | 'maxed' => {
  if (invite.revoked) return 'revoked';
  if (invite.expiresAt) {
    const expiresAtMs = new Date(invite.expiresAt).getTime();
    if (!Number.isNaN(expiresAtMs) && expiresAtMs <= Date.now()) return 'expired';
  }
  if (invite.maxUses && invite.maxUses > 0 && invite.uses >= invite.maxUses) return 'maxed';
  return 'valid';
};

const require = createRequire(import.meta.url);
const ffmpegStaticBinary: string | null = (() => {
  try {
    const candidate = require('ffmpeg-static');
    return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate : null;
  } catch {
    return null;
  }
})();

const chatVideoTranscodeEnabled = String(process.env.CHAT_VIDEO_TRANSCODE_ENABLED || 'true').toLowerCase() !== 'false';
const chatAudioTranscodeEnabled = String(process.env.CHAT_AUDIO_TRANSCODE_ENABLED || 'true').toLowerCase() !== 'false';
const ffmpegBinary = process.env.FFMPEG_PATH || ffmpegStaticBinary || 'ffmpeg';
let ffmpegProbeCached: boolean | null = null;

const isFfmpegAvailable = () => {
  if (ffmpegProbeCached !== null) return ffmpegProbeCached;
  const probe = spawnSync(ffmpegBinary, ['-version'], { stdio: 'ignore' });
  ffmpegProbeCached = probe.status === 0;
  return ffmpegProbeCached;
};

const parseDataUrl = (value: string): { contentType: string; buffer: Buffer } | null => {
  const match = value.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (!match) return null;
  const contentType = String(match[1] || '').trim().toLowerCase();
  const base64 = String(match[2] || '').trim();
  if (!contentType || !base64) return null;
  try {
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer || buffer.length === 0) return null;
    return { contentType, buffer };
  } catch {
    return null;
  }
};

const cleanupTempFile = async (filePath: string) => {
  try {
    await fs.unlink(filePath);
  } catch {}
};

const runFfmpeg = (args: string[]) =>
  new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpegBinary, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', (error) => reject(error));
    proc.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`ffmpeg_failed:${code ?? -1}:${stderr.slice(-1200)}`));
    });
  });

const normalizeMediaFilename = (input: string | undefined, fallback = 'clip') => {
  const base = (input || fallback)
    .replace(/\.[^./\\]+$/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
  return base || fallback;
};

const normalizeUploadExtension = (filename: string, contentType: string): string => {
  const extensionFromName = path.extname(filename || '').toLowerCase();
  if (/^\.[a-z0-9]{1,8}$/.test(extensionFromName)) return extensionFromName;

  const mime = (contentType || '').toLowerCase();
  if (mime.includes('image/jpeg')) return '.jpg';
  if (mime.includes('image/png')) return '.png';
  if (mime.includes('image/webp')) return '.webp';
  if (mime.includes('image/gif')) return '.gif';
  if (mime.includes('image/svg')) return '.svg';
  if (mime.includes('video/mp4')) return '.mp4';
  if (mime.includes('video/webm')) return '.webm';
  if (mime.includes('video/quicktime')) return '.mov';
  if (mime.includes('audio/webm')) return '.webm';
  if (mime.includes('audio/wav') || mime.includes('audio/wave') || mime.includes('audio/x-wav')) return '.wav';
  if (mime.includes('audio/ogg')) return '.ogg';
  if (mime.includes('audio/opus')) return '.opus';
  if (mime.includes('audio/mp4')) return '.m4a';
  if (mime.includes('audio/x-m4a')) return '.m4a';
  if (mime.includes('audio/mpeg')) return '.mp3';
  return '';
};

const shouldTranscodeAudioForMobile = (contentType: string, filename: string) => {
  const mime = (contentType || '').toLowerCase();
  const ext = path.extname(filename || '').toLowerCase();
  const lowerFilename = String(filename || '').toLowerCase();
  const audioHintInFilename = /(^|[_\-.])(voice|audio|record|rec|mic|memo|mensaje|nota)([_\-.]|$)/.test(
    lowerFilename
  );

  if (mime.startsWith('audio/')) {
    if (mime.includes('mpeg') || mime.includes('mp4') || mime.includes('aac')) return false;
    return true;
  }

  // Some browsers/devices upload recorded voice clips as video/webm or video/mp4.
  // If filename looks like a voice capture, normalize to mobile-safe AAC.
  if ((mime.includes('video/webm') || mime.includes('video/mp4')) && audioHintInFilename) {
    return true;
  }

  if (mime === 'application/octet-stream') {
    if (audioHintInFilename) return true;
    return ['.wav', '.wave', '.webm', '.ogg', '.oga', '.opus', '.flac', '.aif', '.aiff'].includes(ext);
  }

  return false;
};

const transcodeAudioToM4a = async (inputBuffer: Buffer, filenameHint: string) => {
  const tmpId = randomUUID();
  const inputPath = path.join(tmpdir(), `diavlocord-audio-${tmpId}-in`);
  const outputPath = path.join(tmpdir(), `diavlocord-audio-${tmpId}-out.m4a`);

  try {
    await fs.writeFile(inputPath, inputBuffer);
    await runFfmpeg([
      '-y',
      '-i',
      inputPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '48000',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      outputPath,
    ]);

    const outputBuffer = await fs.readFile(outputPath);
    const normalized = normalizeMediaFilename(filenameHint, 'voice');
    return {
      buffer: outputBuffer,
      filename: `${normalized}.m4a`,
      contentType: 'audio/mp4',
    };
  } finally {
    await cleanupTempFile(inputPath);
    await cleanupTempFile(outputPath);
  }
};

const findInviteInState = (state: any, inviteCode: string): { serverIndex: number; inviteIndex: number; server: any; invite: SnapshotInvite } | null => {
  const servers = Array.isArray(state?.servers) ? state.servers : [];
  for (let i = 0; i < servers.length; i += 1) {
    const server = servers[i];
    const invites = Array.isArray(server?.invites) ? server.invites : [];
    for (let j = 0; j < invites.length; j += 1) {
      const normalizedInvite = normalizeSnapshotInvite(invites[j]);
      if (!normalizedInvite) continue;
      if (normalizedInvite.code !== inviteCode) continue;
      return { serverIndex: i, inviteIndex: j, server, invite: normalizedInvite };
    }
  }
  return null;
};

const publicUserSelect = {
  id: true,
  username: true,
  displayName: true,
  pronouns: true,
  bio: true,
  discriminator: true,
  avatar: true,
  banner: true,
  bannerColor: true,
  createdAt: true,
  updatedAt: true,
} as const;

const dmAttachmentSchema = z.object({
  id: z.string().min(1).max(128),
  url: z.string().min(1).max(60_000_000),
  filename: z.string().min(1).max(512),
  contentType: z.string().min(1).max(256),
  size: z.number().int().min(0).max(250_000_000),
});

const dmAttachmentsSchema = z.array(dmAttachmentSchema).max(8);

type DmAttachment = z.infer<typeof dmAttachmentSchema>;

const normalizeDmAttachments = (value: unknown): DmAttachment[] => {
  const parsed = dmAttachmentsSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
};

type AppStateScope = 'full' | 'servers';

const MAX_STATE_MESSAGES_PER_CHANNEL = Number(process.env.STATE_MESSAGES_PER_CHANNEL || 120);
const MAX_STATE_THREAD_MESSAGES_PER_THREAD = Number(process.env.STATE_THREAD_MESSAGES_PER_THREAD || 80);
const MAX_STATE_CONTENT_LENGTH = 2000;
const MAX_STATE_ATTACHMENT_URL_LENGTH = 8192;
const MAX_STATE_ATTACHMENT_FILENAME_LENGTH = 512;
const MAX_STATE_ATTACHMENT_CONTENT_TYPE_LENGTH = 256;
const MAX_STATE_ATTACHMENTS_PER_MESSAGE = 8;

const normalizeStateAttachment = (value: unknown) => {
  if (!value || typeof value !== 'object') return null;
  const id = typeof (value as any).id === 'string' ? (value as any).id.slice(0, 128) : '';
  const url = typeof (value as any).url === 'string' ? (value as any).url.slice(0, MAX_STATE_ATTACHMENT_URL_LENGTH) : '';
  const filename =
    typeof (value as any).filename === 'string'
      ? (value as any).filename.slice(0, MAX_STATE_ATTACHMENT_FILENAME_LENGTH)
      : '';
  const contentType =
    typeof (value as any).contentType === 'string'
      ? (value as any).contentType.slice(0, MAX_STATE_ATTACHMENT_CONTENT_TYPE_LENGTH)
      : '';
  const size = Number((value as any).size);
  if (!id || !url || !filename || !contentType) return null;
  if (url.startsWith('data:')) return null;
  return {
    id,
    url,
    filename,
    contentType,
    size: Number.isFinite(size) ? Math.max(0, Math.floor(size)) : 0,
  };
};

const sanitizeStateMessage = (value: unknown) => {
  if (!value || typeof value !== 'object') return null;
  const id = typeof (value as any).id === 'string' ? (value as any).id.slice(0, 128) : '';
  const channelId = typeof (value as any).channelId === 'string' ? (value as any).channelId.slice(0, 128) : '';
  const authorId = typeof (value as any).authorId === 'string' ? (value as any).authorId.slice(0, 128) : '';
  const timestamp =
    typeof (value as any).timestamp === 'string' && (value as any).timestamp.trim().length > 0
      ? (value as any).timestamp
      : new Date().toISOString();
  const content = typeof (value as any).content === 'string' ? (value as any).content.slice(0, MAX_STATE_CONTENT_LENGTH) : '';
  const rawAttachments = Array.isArray((value as any).attachments) ? (value as any).attachments : [];
  const attachments = rawAttachments
    .map((attachment: unknown) => normalizeStateAttachment(attachment))
    .filter(
      (
        attachment: ReturnType<typeof normalizeStateAttachment>
      ): attachment is NonNullable<ReturnType<typeof normalizeStateAttachment>> => Boolean(attachment)
    )
    .slice(0, MAX_STATE_ATTACHMENTS_PER_MESSAGE);
  if (!id || !channelId || !authorId) return null;
  if (!content.trim() && attachments.length === 0) return null;

  return {
    id,
    channelId,
    authorId,
    content,
    timestamp,
    editedAt: typeof (value as any).editedAt === 'string' ? (value as any).editedAt : undefined,
    isPinned: Boolean((value as any).isPinned),
    replyToId: typeof (value as any).replyToId === 'string' ? (value as any).replyToId.slice(0, 128) : undefined,
    threadId: typeof (value as any).threadId === 'string' ? (value as any).threadId.slice(0, 128) : undefined,
    reactions: Array.isArray((value as any).reactions) ? (value as any).reactions : undefined,
    attachments: attachments.length > 0 ? attachments : undefined,
  };
};

const sanitizeStateMessageMap = (value: unknown, perChannelLimit: number) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const safe: Record<string, any[]> = {};
  for (const [channelId, messages] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(messages) || messages.length === 0) continue;
    const next = messages
      .map((message: unknown) => sanitizeStateMessage(message))
      .filter((message): message is NonNullable<typeof message> => Boolean(message))
      .slice(-Math.max(1, perChannelLimit));
    if (next.length > 0) safe[channelId] = next;
  }
  return safe;
};

const sanitizeAppState = (raw: unknown, scope: AppStateScope) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const state = raw as Record<string, unknown>;
  const safeServers = Array.isArray(state.servers) ? state.servers : [];
  const safeActiveServerId =
    typeof state.activeServerId === 'string' || state.activeServerId === null ? state.activeServerId : null;
  const safeActiveChannelId =
    typeof state.activeChannelId === 'string' || state.activeChannelId === null ? state.activeChannelId : null;

  if (scope === 'servers') {
    return {
      servers: safeServers,
      activeServerId: safeActiveServerId,
      activeChannelId: safeActiveChannelId,
    };
  }

  const safeMessages = sanitizeStateMessageMap(state.messages, MAX_STATE_MESSAGES_PER_CHANNEL);
  const safeThreadMessages = sanitizeStateMessageMap(state.threadMessages, MAX_STATE_THREAD_MESSAGES_PER_THREAD);

  return {
    servers: safeServers,
    messages: safeMessages,
    presences:
      state.presences && typeof state.presences === 'object' && !Array.isArray(state.presences)
        ? state.presences
        : {},
    activeServerId: safeActiveServerId,
    activeChannelId: safeActiveChannelId,
    memberTimeouts:
      state.memberTimeouts && typeof state.memberTimeouts === 'object' && !Array.isArray(state.memberTimeouts)
        ? state.memberTimeouts
        : {},
    serverBans:
      state.serverBans && typeof state.serverBans === 'object' && !Array.isArray(state.serverBans)
        ? state.serverBans
        : {},
    auditLog:
      state.auditLog && typeof state.auditLog === 'object' && !Array.isArray(state.auditLog)
        ? state.auditLog
        : {},
    threads:
      state.threads && typeof state.threads === 'object' && !Array.isArray(state.threads)
        ? state.threads
        : {},
    threadMessages: safeThreadMessages,
    activeThreadId:
      typeof state.activeThreadId === 'string' || state.activeThreadId === null ? state.activeThreadId : null,
  };
};

const createRecoveryCode = () => {
  const block = () => Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${block()}-${block()}-${block()}`;
};

const normalizeRecoveryCode = (value: string) => value.trim().toUpperCase();

app.post('/auth/register', authRateLimit, asyncRoute(async (req, res) => {
  const schema = z.object({ username: z.string().min(2).max(32), password: z.string().min(4).max(128) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' });

  const username = parsed.data.username.trim();
  const password = parsed.data.password;
  const discriminator = Math.floor(1000 + Math.random() * 9000).toString();

  const passwordHash = await bcrypt.hash(password, 10);

  let lastError: any = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const recoveryCode = createRecoveryCode();
    try {
      const user = await prisma.user.create({
        data: {
          username,
          discriminator,
          passwordHash,
          recoveryCode,
        },
        select: publicUserSelect,
      });

      const token = signAccessToken({ userId: user.id });
      return res.json({ user, token, recoveryCode });
    } catch (error: any) {
      lastError = error;
      if (error?.code === 'P2002') {
        const target = String(error?.meta?.target || '');
        if (target.includes('recoveryCode')) {
          continue;
        }
        return res.status(409).json({ error: 'username_taken' });
      }
      return res.status(500).json({ error: 'register_failed' });
    }
  }

  if (lastError?.code === 'P2002') {
    return res.status(409).json({ error: 'username_taken' });
  }
  return res.status(500).json({ error: 'register_failed' });
}));

app.post('/auth/login', authRateLimit, asyncRoute(async (req, res) => {
  const schema = z.object({ username: z.string().min(2), password: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' });

  const username = parsed.data.username.trim();
  const password = parsed.data.password;

  const user = await prisma.user.findFirst({
    where: { username },
    select: { ...publicUserSelect, passwordHash: true },
  });
  if (!user) return res.status(401).json({ error: 'invalid_credentials' });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

  const token = signAccessToken({ userId: user.id });
  const { passwordHash, ...safeUser } = user;
  return res.json({ user: safeUser, token });
}));

app.post('/auth/recover', authRateLimit, asyncRoute(async (req, res) => {
  const schema = z.object({
    username: z.string().trim().min(2).max(32),
    recoveryCode: z.string().trim().min(4).max(64),
    newPassword: z.string().min(4).max(128),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' });

  const username = parsed.data.username.trim();
  const recoveryCode = normalizeRecoveryCode(parsed.data.recoveryCode);
  const newPassword = parsed.data.newPassword;

  const user = await prisma.user.findFirst({
    where: { username, recoveryCode },
    select: { id: true },
  });
  if (!user) return res.status(401).json({ error: 'invalid_recovery_code' });

  const passwordHash = await bcrypt.hash(newPassword, 10);

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const nextRecoveryCode = createRecoveryCode();
    try {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          recoveryCode: nextRecoveryCode,
        },
      });
      return res.json({ ok: true, recoveryCode: nextRecoveryCode });
    } catch (error: any) {
      if (error?.code === 'P2002' && String(error?.meta?.target || '').includes('recoveryCode')) {
        continue;
      }
      return res.status(500).json({ error: 'recover_failed' });
    }
  }

  return res.status(500).json({ error: 'recover_failed' });
}));

app.get('/me', requireAuth, asyncRoute(async (req, res) => {
  const userId = (req as any).user.userId as string;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: publicUserSelect });
  return res.json({ user });
}));

app.post('/media/transcode/video', mediaRateLimit, requireAuth, asyncRoute(async (req, res) => {
  if (!chatVideoTranscodeEnabled) {
    return res.status(503).json({ error: 'transcode_disabled' });
  }

  const schema = z.object({
    dataUrl: z.string().min(32).max(120_000_000),
    filename: z.string().trim().max(255).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' });

  const parsedDataUrl = parseDataUrl(parsed.data.dataUrl);
  if (!parsedDataUrl) return res.status(400).json({ error: 'invalid_data_url' });
  if (!parsedDataUrl.contentType.startsWith('video/')) {
    return res.status(400).json({ error: 'invalid_media_type' });
  }
  if (parsedDataUrl.buffer.length > 45 * 1024 * 1024) {
    return res.status(413).json({ error: 'video_too_large' });
  }

  if (!isFfmpegAvailable()) {
    return res.status(503).json({ error: 'ffmpeg_unavailable' });
  }

  const tmpId = randomUUID();
  const inputPath = path.join(tmpdir(), `diavlocord-chat-${tmpId}-in`);
  const outputPath = path.join(tmpdir(), `diavlocord-chat-${tmpId}-out.mp4`);

  try {
    await fs.writeFile(inputPath, parsedDataUrl.buffer);
    await runFfmpeg([
      '-y',
      '-i',
      inputPath,
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '27',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      outputPath,
    ]);

    const outputBuffer = await fs.readFile(outputPath);
    const filenameBase = normalizeMediaFilename(parsed.data.filename, 'video');
    return res.json({
      ok: true,
      filename: `${filenameBase}.mp4`,
      contentType: 'video/mp4',
      size: outputBuffer.length,
      dataUrl: `data:video/mp4;base64,${outputBuffer.toString('base64')}`,
      ffmpeg: true,
    });
  } catch (error) {
    console.warn('[media-transcode] ffmpeg failed, falling back to original', error);
    return res.status(500).json({ error: 'transcode_failed' });
  } finally {
    await cleanupTempFile(inputPath);
    await cleanupTempFile(outputPath);
  }
}));

app.post(
  '/media/upload',
  mediaRateLimit,
  requireAuth,
  express.raw({ type: '*/*', limit: MEDIA_UPLOAD_LIMIT }),
  asyncRoute(async (req, res) => {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!body.length) return res.status(400).json({ error: 'empty_upload' });
    if (body.length > MEDIA_UPLOAD_MAX_BYTES) {
      return res.status(413).json({ error: 'upload_too_large', maxBytes: MEDIA_UPLOAD_MAX_BYTES });
    }

    const rawFilename = typeof req.query.filename === 'string' ? req.query.filename : 'file';
    const contentTypeHeader = String(req.headers['content-type'] || 'application/octet-stream');
    const contentType = contentTypeHeader.split(';')[0].trim().toLowerCase() || 'application/octet-stream';

    let storedBuffer = body;
    let storedContentType = contentType;
    let responseFilename = rawFilename || 'file';

    if (
      chatAudioTranscodeEnabled &&
      storedBuffer.length > 0 &&
      shouldTranscodeAudioForMobile(storedContentType, responseFilename)
    ) {
      if (isFfmpegAvailable()) {
        try {
          const converted = await transcodeAudioToM4a(storedBuffer, responseFilename);
          storedBuffer = converted.buffer;
          storedContentType = converted.contentType;
          responseFilename = converted.filename;
        } catch (error) {
          console.warn('[media-upload] audio transcode failed, keeping original', error);
        }
      }
    }

    if (storedBuffer.length > MEDIA_UPLOAD_MAX_BYTES) {
      return res.status(413).json({ error: 'upload_too_large', maxBytes: MEDIA_UPLOAD_MAX_BYTES });
    }

    const normalizedBase = normalizeMediaFilename(responseFilename || 'file', 'file');
    const extension = normalizeUploadExtension(responseFilename || '', storedContentType);
    const storageName = `${normalizedBase}-${Date.now()}-${randomUUID().slice(0, 8)}${extension}`;

    await fs.mkdir(mediaChatDir, { recursive: true });
    const destination = path.join(mediaChatDir, storageName);
    await fs.writeFile(destination, storedBuffer);

    const forwardedHost = String(req.headers['x-forwarded-host'] || req.get('host') || '').split(',')[0].trim();
    const forwardedProto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
    const baseUrl = forwardedHost ? `${forwardedProto}://${forwardedHost}` : '';
    const mediaPath = `/media/chat/${storageName}`;

    return res.json({
      ok: true,
      url: baseUrl ? `${baseUrl}${mediaPath}` : mediaPath,
      filename: responseFilename || storageName,
      contentType: storedContentType,
      size: storedBuffer.length,
    });
  })
);

app.patch('/me/profile', requireAuth, asyncRoute(async (req, res) => {
  const schema = z
    .object({
      username: z.string().trim().min(2).max(32).optional(),
      displayName: z.union([z.string().trim().max(64), z.null()]).optional(),
      pronouns: z.union([z.string().trim().max(64), z.null()]).optional(),
      bio: z.union([z.string().trim().max(512), z.null()]).optional(),
      avatar: z.union([z.string().trim().max(22_000_000), z.null()]).optional(),
      banner: z.union([z.string().trim().max(22_000_000), z.null()]).optional(),
      bannerColor: z.union([z.string().trim().regex(/^#?[0-9a-fA-F]{6}$/), z.null()]).optional(),
    })
    .refine((value) => Object.keys(value).length > 0, { message: 'empty_body' });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' });

  const userId = (req as any).user.userId as string;
  const normalizeText = (value: string | null) => {
    if (value === null) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  const data: Record<string, string | null> = {};
  if (parsed.data.username !== undefined) data.username = parsed.data.username;
  if (parsed.data.displayName !== undefined) data.displayName = normalizeText(parsed.data.displayName);
  if (parsed.data.pronouns !== undefined) data.pronouns = normalizeText(parsed.data.pronouns);
  if (parsed.data.bio !== undefined) data.bio = normalizeText(parsed.data.bio);
  if (parsed.data.avatar !== undefined) data.avatar = normalizeText(parsed.data.avatar);
  if (parsed.data.banner !== undefined) data.banner = normalizeText(parsed.data.banner);
  if (parsed.data.bannerColor !== undefined) {
    const color = normalizeText(parsed.data.bannerColor);
    data.bannerColor = color ? (color.startsWith('#') ? color : `#${color}`).toUpperCase() : null;
  }

  try {
    const user = await prisma.user.update({
      where: { id: userId },
      data,
      select: publicUserSelect,
    });

    emitToAll('user:updated', { user });
    return res.json({ user });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ error: 'username_taken' });
    }
    return res.status(500).json({ error: 'profile_update_failed' });
  }
}));

app.get('/users/search', requireAuth, asyncRoute(async (req, res) => {
  const userId = (req as any).user.userId as string;
  const q = String(req.query.q || '').trim();
  if (q.length < 1) return res.json({ users: [] });

  const users = await prisma.user.findMany({
    where: {
      id: { not: userId },
      OR: [
        { username: { contains: q, mode: 'insensitive' } },
        { discriminator: { contains: q } },
      ],
    },
    select: publicUserSelect,
    take: 20,
    orderBy: { createdAt: 'desc' },
  });

  return res.json({ users });
}));

app.get('/bootstrap', requireAuth, asyncRoute(async (req, res) => {
  const userId = (req as any).user.userId as string;
  const includeUsers = String(req.query.users ?? '1') !== '0';
  const includeMessages = String(req.query.messages ?? '1') !== '0';
  const bootstrapCacheKey = `${userId}:u${includeUsers ? 1 : 0}:m${includeMessages ? 1 : 0}`;

  const now = Date.now();
  const cached = bootstrapCache.get(bootstrapCacheKey);
  if (cached && cached.expiresAt > now) {
    res.setHeader('X-Bootstrap-Cache', 'HIT');
    return res.json(cached.payload);
  }

  const usersPromise = includeUsers
    ? prisma.user.findMany({
        select: publicUserSelect,
        orderBy: { createdAt: 'desc' },
        take: 300,
      })
    : Promise.resolve([]);

  const conversationsPromise = includeMessages
    ? prisma.dmConversation.findMany({
        where: { members: { some: { userId } } },
        include: {
          members: { select: { userId: true } },
          messages: {
            orderBy: { createdAt: 'asc' },
            select: { id: true, conversationId: true, authorId: true, content: true, attachments: true, createdAt: true },
            take: BOOTSTRAP_DM_MESSAGES_PER_CONVERSATION,
          },
        },
        orderBy: { createdAt: 'desc' },
        take: BOOTSTRAP_MAX_CONVERSATIONS,
      })
    : prisma.dmConversation.findMany({
        where: { members: { some: { userId } } },
        include: {
          members: { select: { userId: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: BOOTSTRAP_MAX_CONVERSATIONS,
      });

  const [users, incoming, outgoing, conversations] = await Promise.all([
    usersPromise,
    prisma.friendRequest.findMany({
      where: { toUserId: userId, status: 'PENDING' },
      select: { id: true, fromUserId: true, toUserId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.friendRequest.findMany({
      where: { fromUserId: userId, status: 'PENDING' },
      select: { id: true, fromUserId: true, toUserId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
    conversationsPromise,
  ]);

  const payload = {
    users,
    dmRequestsIncoming: incoming,
    dmRequestsOutgoing: outgoing,
    dmConversations: conversations.map((c) => ({
      id: c.id,
      memberIds: c.members.map((m) => m.userId),
      ...(Array.isArray((c as any).messages)
        ? {
            messages: (c as any).messages.map((m: any) => ({
              id: m.id,
              conversationId: m.conversationId,
              authorId: m.authorId,
              content: m.content,
              attachments: normalizeDmAttachments(m.attachments),
              createdAt: m.createdAt,
            })),
          }
        : {}),
    })),
  };

  bootstrapCache.set(bootstrapCacheKey, {
    payload,
    expiresAt: now + BOOTSTRAP_CACHE_TTL_MS,
  });
  res.setHeader('X-Bootstrap-Cache', 'MISS');
  return res.json(payload);
}));

app.get('/state/app', requireAuth, asyncRoute(async (req, res) => {
  const scope: AppStateScope = req.query.scope === 'servers' ? 'servers' : 'full';
  const row = await prisma.appStateSnapshot.findUnique({
    where: { id: 'global' },
    select: { data: true, updatedAt: true },
  });
  if (!row) return res.json({ state: null });
  return res.json({
    state: sanitizeAppState(row.data, scope),
    updatedAt: row.updatedAt.toISOString(),
  });
}));

app.put('/state/app', requireAuth, asyncRoute(async (req, res) => {
  const schema = z.object({ state: z.record(z.any()) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' });

  const sanitizedState = sanitizeAppState(parsed.data.state, 'full');
  if (!sanitizedState) return res.status(400).json({ error: 'invalid_state' });

  const saved = await prisma.appStateSnapshot.upsert({
    where: { id: 'global' },
    update: { data: sanitizedState },
    create: { id: 'global', data: sanitizedState },
    select: { updatedAt: true },
  });
  const updatedAt = saved.updatedAt.toISOString();
  const updatedBy = (req as any).user?.userId as string | undefined;
  emitToAll('workspace:updated', {
    scope: 'full',
    updatedAt,
    updatedBy: updatedBy || null,
  });
  return res.json({ ok: true, updatedAt });
}));

app.get('/invites/:code', asyncRoute(async (req, res) => {
  const inviteCode = normalizeInviteCode(String(req.params.code || ''));
  if (!inviteCode) return res.status(400).json({ error: 'invalid_code' });

  const row = await prisma.appStateSnapshot.findUnique({
    where: { id: 'global' },
    select: { data: true },
  });
  if (!row) return res.status(404).json({ error: 'invite_not_found' });

  const found = findInviteInState(row.data, inviteCode);
  if (!found) return res.status(404).json({ error: 'invite_not_found' });

  const inviter = found.invite.createdBy
    ? await prisma.user.findUnique({
        where: { id: found.invite.createdBy },
        select: publicUserSelect,
      })
    : null;

  const membersCount = Array.isArray(found.server?.members) ? found.server.members.length : 0;
  const status = getInviteStatus(found.invite);

  return res.json({
    server: {
      id: String(found.server?.id || ''),
      name: String(found.server?.name || 'Servidor'),
      icon: typeof found.server?.icon === 'string' ? found.server.icon : null,
      membersCount,
    },
    invite: {
      ...found.invite,
      status,
    },
    inviter,
  });
}));

app.post('/invites/:code/join', requireAuth, asyncRoute(async (req, res) => {
  const userId = (req as any).user.userId as string;
  const inviteCode = normalizeInviteCode(String(req.params.code || ''));
  if (!inviteCode) return res.status(400).json({ error: 'invalid_code' });

  const row = await prisma.appStateSnapshot.findUnique({
    where: { id: 'global' },
    select: { data: true },
  });
  if (!row) return res.status(404).json({ error: 'invite_not_found' });

  const found = findInviteInState(row.data, inviteCode);
  if (!found) return res.status(404).json({ error: 'invite_not_found' });

  const status = getInviteStatus(found.invite);
  if (status !== 'valid') return res.status(400).json({ error: `invite_${status}` });

  const nextState = JSON.parse(JSON.stringify(row.data || {}));
  const nextFound = findInviteInState(nextState, inviteCode);
  if (!nextFound) return res.status(404).json({ error: 'invite_not_found' });

  const server = nextFound.server;
  const members = Array.isArray(server?.members) ? [...server.members] : [];
  const alreadyMember = members.some((m: any) => m?.userId === userId);
  if (!alreadyMember) {
    members.push({
      userId,
      serverId: String(server?.id || ''),
      roleIds: [],
      joinedAt: new Date().toISOString(),
    });
    server.members = members;
  }

  const invites = Array.isArray(server?.invites) ? [...server.invites] : [];
  const inviteRaw = invites[nextFound.inviteIndex] || {};
  const inviteUses = Number(inviteRaw?.uses);
  if (!alreadyMember) {
    invites[nextFound.inviteIndex] = {
      ...inviteRaw,
      uses: Number.isFinite(inviteUses) ? inviteUses + 1 : 1,
    };
    server.invites = invites;
  }

  const saved = await prisma.appStateSnapshot.update({
    where: { id: 'global' },
    data: { data: nextState },
    select: { updatedAt: true },
  });
  emitToAll('workspace:updated', {
    scope: 'servers',
    updatedAt: saved.updatedAt.toISOString(),
    updatedBy: userId,
  });

  return res.json({
    ok: true,
    alreadyMember,
    updatedAt: saved.updatedAt.toISOString(),
    server: {
      id: String(server?.id || ''),
      name: String(server?.name || 'Servidor'),
    },
  });
}));

app.post('/dm/requests', requireAuth, asyncRoute(async (req, res) => {
  const schema = z.object({ toUserId: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' });

  const fromUserId = (req as any).user.userId as string;
  const toUserId = parsed.data.toUserId;
  if (toUserId === fromUserId) return res.status(400).json({ error: 'self' });

  const toUser = await prisma.user.findUnique({ where: { id: toUserId }, select: { id: true } });
  if (!toUser) return res.status(404).json({ error: 'user_not_found' });

  const existingConversation = await prisma.dmConversation.findFirst({
    where: {
      AND: [
        { members: { some: { userId: fromUserId } } },
        { members: { some: { userId: toUserId } } },
      ],
    },
    include: { members: { select: { userId: true } } },
  });
  if (existingConversation && existingConversation.members.length === 2) {
    return res.json({ ok: true, conversationId: existingConversation.id, alreadyConversation: true });
  }

  const existingPending = await prisma.friendRequest.findFirst({
    where: { fromUserId, toUserId, status: 'PENDING' },
    select: { id: true, createdAt: true },
  });
  if (existingPending) {
    return res.json({
      ok: true,
      request: { id: existingPending.id, fromUserId, toUserId, createdAt: existingPending.createdAt.toISOString() },
      pending: true,
    });
  }

  const reversePending = await prisma.friendRequest.findFirst({
    where: { fromUserId: toUserId, toUserId: fromUserId, status: 'PENDING' },
    select: { id: true },
  });
  if (reversePending) {
    const conversation = await prisma.dmConversation.create({
      data: {
        members: {
          create: [{ userId: fromUserId }, { userId: toUserId }],
        },
      },
      include: { members: { select: { userId: true } } },
    });
    await prisma.friendRequest.update({ where: { id: reversePending.id }, data: { status: 'ACCEPTED' } });
    emitToUser(toUserId, 'dm:request:accept', {
      requestId: reversePending.id,
      fromUserId: toUserId,
      toUserId: fromUserId,
      conversationId: conversation.id,
    });
    invalidateBootstrapCache([fromUserId, toUserId]);
    return res.json({ ok: true, conversationId: conversation.id, autoAccepted: true });
  }

  const request = await prisma.friendRequest.create({
    data: { fromUserId, toUserId, status: 'PENDING' },
    select: { id: true, fromUserId: true, toUserId: true, createdAt: true },
  });
  emitToUser(toUserId, 'dm:request', {
    requestId: request.id,
    fromUserId,
    toUserId,
    createdAt: request.createdAt.toISOString(),
  });
  invalidateBootstrapCache([fromUserId, toUserId]);
  return res.json({ ok: true, request: { ...request, createdAt: request.createdAt.toISOString() } });
}));

app.post('/dm/requests/:id/accept', requireAuth, asyncRoute(async (req, res) => {
  const userId = (req as any).user.userId as string;
  const requestId = req.params.id;
  const reqRow = await prisma.friendRequest.findUnique({
    where: { id: requestId },
    select: { id: true, fromUserId: true, toUserId: true, status: true },
  });
  if (!reqRow || reqRow.toUserId !== userId) return res.status(404).json({ error: 'not_found' });
  if (reqRow.status !== 'PENDING') return res.status(400).json({ error: 'not_pending' });

  const existingConversation = await prisma.dmConversation.findFirst({
    where: {
      AND: [
        { members: { some: { userId: reqRow.fromUserId } } },
        { members: { some: { userId: reqRow.toUserId } } },
      ],
    },
    include: { members: { select: { userId: true } } },
  });

  const conversation =
    existingConversation && existingConversation.members.length === 2
      ? existingConversation
      : await prisma.dmConversation.create({
          data: {
            members: {
              create: [{ userId: reqRow.fromUserId }, { userId: reqRow.toUserId }],
            },
          },
          include: { members: { select: { userId: true } } },
        });

  await prisma.friendRequest.update({ where: { id: requestId }, data: { status: 'ACCEPTED' } });
  emitToUser(reqRow.fromUserId, 'dm:request:accept', {
    requestId,
    fromUserId: reqRow.fromUserId,
    toUserId: reqRow.toUserId,
    conversationId: conversation.id,
  });
  invalidateBootstrapCache([reqRow.fromUserId, reqRow.toUserId]);

  return res.json({ ok: true, conversationId: conversation.id });
}));

app.post('/dm/requests/:id/reject', requireAuth, asyncRoute(async (req, res) => {
  const userId = (req as any).user.userId as string;
  const requestId = req.params.id;
  const reqRow = await prisma.friendRequest.findUnique({
    where: { id: requestId },
    select: { id: true, fromUserId: true, toUserId: true, status: true },
  });
  if (!reqRow || reqRow.toUserId !== userId) return res.status(404).json({ error: 'not_found' });
  if (reqRow.status !== 'PENDING') return res.status(400).json({ error: 'not_pending' });

  await prisma.friendRequest.update({ where: { id: requestId }, data: { status: 'REJECTED' } });
  emitToUser(reqRow.fromUserId, 'dm:request:reject', {
    requestId,
    fromUserId: reqRow.fromUserId,
    toUserId: reqRow.toUserId,
  });
  invalidateBootstrapCache([reqRow.fromUserId, reqRow.toUserId]);
  return res.json({ ok: true });
}));

app.get('/dm/conversations', requireAuth, asyncRoute(async (req, res) => {
  const userId = (req as any).user.userId as string;
  const conversations = await prisma.dmConversation.findMany({
    where: { members: { some: { userId } } },
    include: { members: { select: { userId: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return res.json({
    conversations: conversations.map((c) => ({
      id: c.id,
      memberIds: c.members.map((m) => m.userId),
    })),
  });
}));

app.get('/dm/conversations/:id/messages', requireAuth, asyncRoute(async (req, res) => {
  const userId = (req as any).user.userId as string;
  const conversationId = req.params.id;
  const member = await prisma.dmMember.findFirst({ where: { conversationId, userId }, select: { id: true } });
  if (!member) return res.status(403).json({ error: 'forbidden' });

  const messages = await prisma.dmMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    take: 200,
    select: { id: true, conversationId: true, authorId: true, content: true, attachments: true, createdAt: true },
  });
  return res.json({
    messages: messages.map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      authorId: m.authorId,
      content: m.content,
      attachments: normalizeDmAttachments(m.attachments),
      createdAt: m.createdAt,
    })),
  });
}));

app.post('/dm/conversations/:id/messages', requireAuth, asyncRoute(async (req, res) => {
  const schema = z.object({
    content: z.string().max(4000).optional(),
    attachments: dmAttachmentsSchema.optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' });
  const content = (parsed.data.content || '').trim();
  const attachments = parsed.data.attachments || [];
  if (content.length === 0 && attachments.length === 0) {
    return res.status(400).json({ error: 'empty_message' });
  }

  const userId = (req as any).user.userId as string;
  const conversationId = req.params.id;
  const member = await prisma.dmMember.findFirst({ where: { conversationId, userId }, select: { id: true } });
  if (!member) return res.status(403).json({ error: 'forbidden' });

  const msg = await prisma.dmMessage.create({
    data: {
      conversationId,
      authorId: userId,
      content,
      attachments: attachments.length > 0 ? attachments : undefined,
    },
    select: { id: true, conversationId: true, authorId: true, content: true, attachments: true, createdAt: true },
  });
  const normalizedAttachments = normalizeDmAttachments(msg.attachments);
  const recipients = await prisma.dmMember.findMany({
    where: { conversationId, userId: { not: userId } },
    select: { userId: true },
  });
  for (const r of recipients) {
    emitToUser(r.userId, 'dm:message', {
      conversationId,
      message: {
        id: msg.id,
        conversationId: msg.conversationId,
        authorId: msg.authorId,
        content: msg.content,
        attachments: normalizedAttachments,
        createdAt: msg.createdAt.toISOString(),
      },
    });
  }
  invalidateBootstrapCache([userId, ...recipients.map((r) => r.userId)]);
  return res.json({
    message: {
      id: msg.id,
      conversationId: msg.conversationId,
      authorId: msg.authorId,
      content: msg.content,
      attachments: normalizedAttachments,
      createdAt: msg.createdAt.toISOString(),
    },
  });
}));

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  // Keep backend responses stable; never let async route errors crash the process.
  console.error('[api-error]', error);
  if (res.headersSent) return;

  if (isDatabaseUnavailableError(error)) {
    res.status(503).json({ error: 'database_unavailable' });
    return;
  }

  res.status(500).json({ error: 'internal_server_error' });
});

const httpServer = createServer(app);
createSocketServer(httpServer);

const port = Number(process.env.PORT || 3001);
httpServer.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`diavlocord-server listening on http://localhost:${port}`);
});
