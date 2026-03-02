#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const whichCommand = process.platform === 'win32' ? 'where' : 'which';
const lookup = spawnSync(whichCommand, ['ffmpeg'], { encoding: 'utf8' });

if (lookup.status !== 0 || !lookup.stdout.trim()) {
  console.error('[ffmpeg] Not found in PATH.');
  console.error('[ffmpeg] Install ffmpeg and restart your terminal.');
  process.exit(1);
}

const ffmpegPath = lookup.stdout.trim().split(/\r?\n/)[0];
const version = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
const versionLine = (version.stdout || '').split(/\r?\n/)[0] || 'unknown version';

console.log(`[ffmpeg] Found: ${ffmpegPath}`);
console.log(`[ffmpeg] ${versionLine}`);
