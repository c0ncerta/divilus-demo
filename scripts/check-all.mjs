#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const apiUrlArg = (process.argv[2] || '').trim();
const apiUrl =
  (process.env.CHECK_API_URL || '').trim() ||
  (process.env.NEXT_PUBLIC_API_URL || '').trim() ||
  (process.env.API_URL || '').trim() ||
  apiUrlArg;
const includeDesktopPack = /^(1|true|yes)$/i.test((process.env.CHECK_DESKTOP_PACK || '').trim());

const steps = [
  {
    name: 'Typecheck (web)',
    cwd: root,
    command: 'npm',
    args: ['run', 'typecheck'],
  },
  {
    name: 'Build (web)',
    cwd: root,
    command: 'npm',
    args: ['run', 'build'],
  },
  {
    name: 'Build (server)',
    cwd: path.join(root, 'server'),
    command: 'npm',
    args: ['run', 'build'],
  },
  {
    name: 'Desktop icon assets',
    cwd: root,
    command: 'npm',
    args: ['run', 'desktop:icon'],
  },
  {
    name: 'FFmpeg availability',
    cwd: root,
    command: 'npm',
    args: ['run', 'media:check:ffmpeg'],
  },
];

if (apiUrl) {
  steps.push({
    name: 'Backend health + CORS',
    cwd: root,
    command: 'npm',
    args: ['run', 'backend:check', '--', apiUrl],
  });
} else {
  console.log('[check-all] Backend check skipped (no API URL provided).');
  console.log('[check-all] Pass URL as: npm run check:all -- https://diavlocord.onrender.com');
}

if (includeDesktopPack) {
  steps.push({
    name: 'Desktop packaging (win dir)',
    cwd: root,
    command: 'npm',
    args: ['run', 'desktop:build:dir'],
  });
} else {
  console.log('[check-all] Desktop packaging skipped (set CHECK_DESKTOP_PACK=1 to enable).');
}

const run = (step) =>
  new Promise((resolve) => {
    const startedAt = Date.now();
    console.log(`\n[check-all] >>> ${step.name}`);
    const child = spawn(step.command, step.args, {
      cwd: step.cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    child.on('close', (code) => {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      resolve({
        name: step.name,
        code: code ?? 1,
        elapsed,
      });
    });
  });

const main = async () => {
  const results = [];
  for (const step of steps) {
    const result = await run(step);
    results.push(result);
    if (result.code !== 0) {
      console.error(`\n[check-all] FAIL at "${result.name}" (exit ${result.code})`);
      break;
    }
  }

  console.log('\n[check-all] ===== Summary =====');
  for (const result of results) {
    const status = result.code === 0 ? 'OK' : 'FAIL';
    console.log(`[check-all] ${status.padEnd(4)} ${result.name} (${result.elapsed}s)`);
  }

  const failed = results.find((entry) => entry.code !== 0);
  if (failed) process.exit(1);
  console.log('[check-all] All checks passed.');
};

main().catch((error) => {
  console.error('[check-all] Unhandled error', error);
  process.exit(1);
});
