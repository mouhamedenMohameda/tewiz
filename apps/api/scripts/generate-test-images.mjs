// Generate 14 distinct test JPEGs for the captain-flow e2e test.
// Each image is a colored card with the document type label on it,
// so they have different content hashes (the API rejects duplicates).
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const TYPES = [
  'selfie',
  'nni_front', 'nni_back',
  'license_front', 'license_back',
  'carte_grise', 'assurance', 'vignette', 'visite_technique',
  'car_front', 'car_back', 'car_left', 'car_right', 'car_interior',
];

const dir = '/tmp/tewiz-test-images';
mkdirSync(dir, { recursive: true });

for (let i = 0; i < TYPES.length; i++) {
  const t = TYPES[i];
  const hue = Math.round((i / TYPES.length) * 360);
  const svg = `<svg width="800" height="600" xmlns="http://www.w3.org/2000/svg">
    <rect width="800" height="600" fill="hsl(${hue}, 60%, 50%)"/>
    <text x="400" y="280" font-family="sans-serif" font-size="56"
          fill="white" text-anchor="middle">TEST</text>
    <text x="400" y="360" font-family="sans-serif" font-size="40"
          fill="white" text-anchor="middle">${t}</text>
  </svg>`;
  await sharp(Buffer.from(svg))
    .jpeg({ quality: 90 })
    .toFile(path.join(dir, `${t}.jpg`));
}

console.log(`Generated ${TYPES.length} test images in ${dir}`);
