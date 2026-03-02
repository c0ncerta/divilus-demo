import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const ROOT = process.cwd();
const INPUT_LOGO = path.join(ROOT, 'public', 'logo.png');
const BUILD_DIR = path.join(ROOT, 'build');
const OUTPUT_PNG = path.join(BUILD_DIR, 'icon.png');
const OUTPUT_ICO = path.join(BUILD_DIR, 'icon.ico');

const CANVAS_SIZE = 1024;
const SAFE_SIZE = 860;
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

const ensureLogoExists = async () => {
  try {
    await fs.access(INPUT_LOGO);
  } catch {
    throw new Error(`No se encontro logo en: ${INPUT_LOGO}`);
  }
};

const buildSquareLogoPng = async () => {
  const normalized = await sharp(INPUT_LOGO)
    .rotate()
    .resize(SAFE_SIZE, SAFE_SIZE, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      withoutEnlargement: false,
    })
    .extend({
      top: Math.floor((CANVAS_SIZE - SAFE_SIZE) / 2),
      bottom: Math.ceil((CANVAS_SIZE - SAFE_SIZE) / 2),
      left: Math.floor((CANVAS_SIZE - SAFE_SIZE) / 2),
      right: Math.ceil((CANVAS_SIZE - SAFE_SIZE) / 2),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9 })
    .toBuffer();

  return normalized;
};

const buildIco = async (squarePngBuffer) => {
  const buffers = [];
  for (const size of ICO_SIZES) {
    const resized = await sharp(squarePngBuffer)
      .resize(size, size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png({ compressionLevel: 9 })
      .toBuffer();
    buffers.push(resized);
  }
  return pngToIco(buffers);
};

const run = async () => {
  await ensureLogoExists();
  await fs.mkdir(BUILD_DIR, { recursive: true });

  const squarePng = await buildSquareLogoPng();
  await fs.writeFile(OUTPUT_PNG, squarePng);

  const ico = await buildIco(squarePng);
  await fs.writeFile(OUTPUT_ICO, ico);

  console.log(`[desktop-icon] Generated: ${path.relative(ROOT, OUTPUT_ICO)}`);
};

run().catch((error) => {
  console.error('[desktop-icon] Error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
