#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const MAX_MIGRATE_ATTEMPTS = Math.max(1, Number(process.env.MIGRATE_ATTEMPTS || 8));
const RETRY_BASE_MS = Math.max(500, Number(process.env.MIGRATE_RETRY_BASE_MS || 2500));
const POOLER_FALLBACK_ATTEMPTS = Math.max(1, Number(process.env.MIGRATE_POOLER_FALLBACK_ATTEMPTS || 2));
const START_ON_MIGRATE_FAILURE = !/^(0|false|no)$/i.test(String(process.env.START_ON_MIGRATE_FAILURE || 'true'));
const PARAMS_TO_STRIP = ['channel_binding'];

const isNeonHost = (hostname) => /\.neon\.tech$/i.test(hostname || '');

const toDirectHostname = (hostname) => {
  if (!hostname) return hostname;
  if (hostname.includes('-pooler.')) return hostname.replace('-pooler.', '.');
  return hostname;
};

const toPoolerHostname = (hostname) => {
  if (!hostname) return hostname;
  if (hostname.includes('-pooler.')) return hostname;
  const dot = hostname.indexOf('.');
  if (dot === -1) return `${hostname}-pooler`;
  return `${hostname.slice(0, dot)}-pooler${hostname.slice(dot)}`;
};

const sanitizeDbUrl = (databaseUrl) => {
  if (!databaseUrl) return null;
  try {
    const parsed = new URL(databaseUrl);
    for (const key of PARAMS_TO_STRIP) {
      if (parsed.searchParams.has(key)) {
        parsed.searchParams.delete(key);
      }
    }
    if (!parsed.searchParams.has('sslmode')) {
      parsed.searchParams.set('sslmode', 'require');
    }
    return parsed.toString();
  } catch {
    return null;
  }
};

const deriveDirectUrl = (databaseUrl) => {
  const sanitized = sanitizeDbUrl(databaseUrl);
  if (!sanitized) return null;
  try {
    const parsed = new URL(sanitized);
    if (isNeonHost(parsed.hostname)) {
      parsed.hostname = toDirectHostname(parsed.hostname);
    }
    return parsed.toString();
  } catch {
    return null;
  }
};

const derivePooledUrl = (databaseUrl) => {
  const sanitized = sanitizeDbUrl(databaseUrl);
  if (!sanitized) return null;
  try {
    const parsed = new URL(sanitized);
    if (isNeonHost(parsed.hostname)) {
      parsed.hostname = toPoolerHostname(parsed.hostname);
    }
    return parsed.toString();
  } catch {
    return null;
  }
};

const redactDbUrl = (value) => {
  if (!value) return '<missing>';
  try {
    const parsed = new URL(value);
    if (parsed.password) parsed.password = '***';
    if (parsed.username) parsed.username = '***';
    return parsed.toString();
  } catch {
    return '<invalid>';
  }
};

const ensureDatabaseUrl = () => {
  const rawDb = process.env.DATABASE_URL || '';
  if (!rawDb) return;

  const sanitized = sanitizeDbUrl(rawDb);
  if (sanitized && sanitized !== rawDb) {
    process.env.DATABASE_URL = sanitized;
    console.log('[render-start] DATABASE_URL query params normalized.');
  }

  const currentDb = process.env.DATABASE_URL || rawDb;
  try {
    const parsed = new URL(currentDb);
    if (!isNeonHost(parsed.hostname)) return;
    if (!parsed.hostname.includes('-pooler.')) {
      const pooled = derivePooledUrl(currentDb);
      if (pooled) {
        process.env.DATABASE_URL = pooled;
        console.log('[render-start] DATABASE_URL was direct. Switched to Neon pooler host.');
      }
    }
  } catch {}
};

const ensureDirectUrl = () => {
  const existingDirect = process.env.DIRECT_URL || '';
  const existingDirectLooksPooler = (() => {
    try {
      return Boolean(existingDirect && new URL(existingDirect).hostname.includes('-pooler.'));
    } catch {
      return false;
    }
  })();

  if (existingDirect && !existingDirectLooksPooler) {
    const normalized = deriveDirectUrl(existingDirect);
    if (normalized && normalized !== existingDirect) {
      process.env.DIRECT_URL = normalized;
      console.log('[render-start] DIRECT_URL query params normalized.');
    }
    return;
  }

  const source = existingDirect || process.env.DATABASE_URL || '';
  const derived = deriveDirectUrl(source);
  if (!derived) return;
  process.env.DIRECT_URL = derived;
  if (!existingDirect) {
    console.log('[render-start] DIRECT_URL was missing. Derived from DATABASE_URL.');
  } else {
    console.log('[render-start] DIRECT_URL was pointing to pooler. Switched to direct host.');
  }
};

const runMigrateOnce = () => {
  const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: process.env,
    encoding: 'utf8',
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
};

const isReachabilityError = (output) =>
  /P1001|P1002|Can'?t reach database server|timed out|ECONNREFUSED|ENOTFOUND/i.test(output);

const runMigrationsLoop = async (attempts, label) => {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    console.log(`[render-start] Running migrations ${label} (attempt ${attempt}/${attempts})...`);
    const result = runMigrateOnce();
    if (result.status === 0) {
      console.log('[render-start] Prisma migrations applied successfully.');
      return { ok: true, result };
    }

    const mergedOutput = `${result.stdout || ''}\n${result.stderr || ''}`;
    const retryable = isReachabilityError(mergedOutput);
    if (!retryable || attempt >= attempts) {
      return { ok: false, result, retryable };
    }

    const waitMs = RETRY_BASE_MS * attempt;
    console.warn(`[render-start] Database not reachable yet. Retrying in ${waitMs}ms...`);
    await sleep(waitMs);
  }
  return { ok: false, result: null, retryable: false };
};

const runMigrationsWithRetry = async () => {
  const primary = await runMigrationsLoop(MAX_MIGRATE_ATTEMPTS, '(primary)');
  if (primary.ok) return true;

  // Fallback: if direct migrations fail with reachability errors, try pooled URL.
  const hasDifferentUrls =
    Boolean(process.env.DATABASE_URL) &&
    Boolean(process.env.DIRECT_URL) &&
    process.env.DATABASE_URL !== process.env.DIRECT_URL;
  if (primary.retryable && hasDifferentUrls) {
    console.warn('[render-start] Trying migration fallback via pooled DATABASE_URL...');
    const originalDirect = process.env.DIRECT_URL;
    process.env.DIRECT_URL = process.env.DATABASE_URL;
    const fallback = await runMigrationsLoop(POOLER_FALLBACK_ATTEMPTS, '(pooler fallback)');
    process.env.DIRECT_URL = originalDirect;
    if (fallback.ok) return true;
  }

  console.error('[render-start] Migration failed and will not be retried.');
  console.error(`[render-start] DATABASE_URL: ${redactDbUrl(process.env.DATABASE_URL)}`);
  console.error(`[render-start] DIRECT_URL: ${redactDbUrl(process.env.DIRECT_URL)}`);
  console.error('[render-start] If you use Neon, set:');
  console.error('[render-start] - DATABASE_URL = ...-pooler... ?sslmode=require');
  console.error('[render-start] - DIRECT_URL   = same host without -pooler, with ?sslmode=require');
  if (START_ON_MIGRATE_FAILURE) {
    console.warn('[render-start] Continuing startup without migrations (START_ON_MIGRATE_FAILURE=true).');
    return false;
  }
  process.exit((primary.result && primary.result.status) || 1);
};

const startServer = () => {
  console.log('[render-start] Starting server process...');
  const child = spawn('node', ['dist/index.js'], {
    env: process.env,
    stdio: 'inherit',
  });
  child.on('close', (code) => process.exit(code ?? 0));
  child.on('error', (err) => {
    console.error('[render-start] Failed to start server:', err);
    process.exit(1);
  });
};

const main = async () => {
  ensureDatabaseUrl();
  ensureDirectUrl();
  await runMigrationsWithRetry();
  startServer();
};

main().catch((err) => {
  console.error('[render-start] Unexpected bootstrap failure:', err);
  process.exit(1);
});
