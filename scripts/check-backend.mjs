#!/usr/bin/env node

const stripTrailingSlashes = (value) => String(value || '').replace(/\/+$/, '');

const apiUrl = stripTrailingSlashes(
  process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || process.argv[2] || ''
);
const checkOrigin = stripTrailingSlashes(
  process.env.CHECK_ORIGIN || process.env.CORS_ORIGIN || 'https://diavlo-cord.vercel.app'
);

if (!apiUrl) {
  console.error('[backend-check] Missing API URL.');
  console.error('[backend-check] Use NEXT_PUBLIC_API_URL, API_URL, or pass it as first argument.');
  process.exit(1);
}

const request = async (path, init = {}) => {
  const url = `${apiUrl}${path}`;
  try {
    const res = await fetch(url, init);
    const text = await res.text();
    return { ok: true, status: res.status, headers: res.headers, body: text, url };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      headers: new Headers(),
      body: '',
      url,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const printResult = (label, result) => {
  if (!result.ok) {
    console.error(`[backend-check] ${label}: FAIL (${result.error})`);
    return;
  }
  const bodyPreview = result.body.length > 200 ? `${result.body.slice(0, 200)}...` : result.body;
  console.log(`[backend-check] ${label}: ${result.status} ${bodyPreview}`);
};

const run = async () => {
  console.log(`[backend-check] API URL: ${apiUrl}`);
  console.log(`[backend-check] Origin:  ${checkOrigin}`);

  const health = await request('/health', { method: 'GET' });
  printResult('GET /health', health);

  const dbHealth = await request('/health/db', { method: 'GET' });
  printResult('GET /health/db', dbHealth);

  const preflight = await request('/auth/login', {
    method: 'OPTIONS',
    headers: {
      Origin: checkOrigin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  printResult('OPTIONS /auth/login', preflight);
  if (preflight.ok) {
    const corsOrigin = preflight.headers.get('access-control-allow-origin') || '<missing>';
    console.log(`[backend-check] CORS allow-origin: ${corsOrigin}`);
  }

  const ok =
    health.ok &&
    health.status >= 200 &&
    health.status < 300 &&
    dbHealth.ok &&
    (dbHealth.status === 200 || dbHealth.status === 503) &&
    preflight.ok &&
    preflight.status >= 200 &&
    preflight.status < 300;

  if (!ok) {
    process.exit(1);
  }
};

void run();
