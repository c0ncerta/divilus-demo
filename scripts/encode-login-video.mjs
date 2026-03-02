#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const projectRoot = process.cwd();
const publicDir = path.resolve(projectRoot, 'public');
const customInput = process.argv[2] ? path.resolve(projectRoot, process.argv[2]) : null;

const sourceCandidates = [
  customInput,
  path.join(publicDir, 'login_video_source.mp4'),
  path.join(publicDir, 'login_video.mp4'),
].filter((entry, idx, arr) => Boolean(entry) && arr.indexOf(entry) === idx);

const source = sourceCandidates.find((candidate) => fs.existsSync(candidate));
if (!source) {
  console.error('[ffmpeg] No input video found.');
  console.error('[ffmpeg] Expected one of:');
  for (const candidate of sourceCandidates) {
    console.error(`- ${candidate}`);
  }
  process.exit(1);
}

const ffmpegProbe = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
if (ffmpegProbe.status !== 0) {
  console.error('[ffmpeg] ffmpeg is not available in PATH.');
  console.error('[ffmpeg] Run: npm run media:check:ffmpeg');
  process.exit(1);
}

const outputMp4 = path.join(publicDir, 'login_video.mp4');
const outputWebm = path.join(publicDir, 'login_video.webm');
const tempMp4 = path.join(publicDir, 'login_video.tmp.mp4');

const mp4Target = path.resolve(source) === path.resolve(outputMp4) ? tempMp4 : outputMp4;

const run = (label, args) => {
  console.log(`\n[ffmpeg] ${label}`);
  const result = spawnSync('ffmpeg', args, { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`[ffmpeg] Failed: ${label}`);
    process.exit(result.status || 1);
  }
};

run('Encoding MP4 (H.264 + faststart)', [
  '-y',
  '-i',
  source,
  '-an',
  '-vf',
  'scale=min(1920\\,iw):-2:flags=lanczos,format=yuv420p',
  '-c:v',
  'libx264',
  '-preset',
  'medium',
  '-crf',
  '23',
  '-profile:v',
  'high',
  '-level',
  '4.1',
  '-pix_fmt',
  'yuv420p',
  '-movflags',
  '+faststart',
  mp4Target,
]);

if (mp4Target === tempMp4) {
  fs.renameSync(tempMp4, outputMp4);
}

run('Encoding WEBM (VP9)', [
  '-y',
  '-i',
  source,
  '-an',
  '-vf',
  'scale=min(1920\\,iw):-2:flags=lanczos',
  '-c:v',
  'libvpx-vp9',
  '-b:v',
  '0',
  '-crf',
  '34',
  '-deadline',
  'good',
  '-row-mt',
  '1',
  outputWebm,
]);

const formatBytes = (bytes) => `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
const mp4Size = fs.existsSync(outputMp4) ? formatBytes(fs.statSync(outputMp4).size) : 'n/a';
const webmSize = fs.existsSync(outputWebm) ? formatBytes(fs.statSync(outputWebm).size) : 'n/a';

console.log('\n[ffmpeg] Done.');
console.log(`[ffmpeg] MP4  -> ${outputMp4} (${mp4Size})`);
console.log(`[ffmpeg] WEBM -> ${outputWebm} (${webmSize})`);
