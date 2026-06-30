/* eslint-disable no-console */
// Generates ParisPromax brand assets (icon, adaptive foreground, splash, favicon)
// from inline SVGs using sharp. Run: node scripts/generate-assets.js
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ASSETS = path.resolve(__dirname, '../assets');

// --- Brand SVGs ------------------------------------------------------------
// A stylized horseshoe (racing) + AI spark, emerald palette.

const horseshoe = (stroke) => `
  <g transform="translate(512,540)">
    <path d="M -150 -120
             A 150 150 0 1 1 150 -120
             L 110 -100
             A 110 110 0 1 0 -110 -100 Z"
          fill="${stroke}"/>
    <!-- nail holes -->
    ${[-130, -90, 130, 90].map((x, i) => `<circle cx="${x}" cy="${i < 2 ? -60 : -60}" r="9" fill="#064e3b"/>`).join('')}
    <circle cx="-150" cy="20" r="20" fill="${stroke}"/>
    <circle cx="150" cy="20" r="20" fill="${stroke}"/>
    <!-- AI spark -->
    <g transform="translate(0,-30)">
      <path d="M0 -46 L12 -12 L46 0 L12 12 L0 46 L-12 12 L-46 0 L-12 -12 Z" fill="#fbbf24"/>
    </g>
  </g>`;

const iconSvg = (withBg) => `
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#064e3b"/>
      <stop offset="1" stop-color="#0f172a"/>
    </linearGradient>
  </defs>
  ${withBg ? '<rect width="1024" height="1024" rx="220" fill="url(#bg)"/>' : ''}
  ${horseshoe('#10b981')}
</svg>`;

const splashSvg = `
<svg width="1284" height="1284" viewBox="0 0 1284 1284" xmlns="http://www.w3.org/2000/svg">
  <rect width="1284" height="1284" fill="#0f172a"/>
  <g transform="translate(130,250) scale(1.0)">
    ${horseshoe('#10b981')}
  </g>
  <text x="642" y="1020" font-family="Arial, sans-serif" font-size="92" font-weight="bold"
        fill="#f8fafc" text-anchor="middle" letter-spacing="6">PARISPROMAX</text>
  <text x="642" y="1090" font-family="Arial, sans-serif" font-size="40"
        fill="#10b981" text-anchor="middle">Pronostics IA · Courses PMU</text>
</svg>`;

async function gen() {
  const jobs = [
    { svg: iconSvg(true), out: 'icon.png', size: 1024 },
    { svg: iconSvg(false), out: 'android-icon-foreground.png', size: 1024 },
    { svg: iconSvg(true), out: 'splash-icon.png', size: 1024 },
    { svg: splashSvg, out: 'splash.png', size: 1284 },
    { svg: iconSvg(true), out: 'favicon.png', size: 48 },
  ];
  for (const j of jobs) {
    await sharp(Buffer.from(j.svg))
      .resize(j.size, j.size)
      .png()
      .toFile(path.join(ASSETS, j.out));
    console.log('wrote', j.out, `(${j.size}px)`);
  }

  // Solid emerald adaptive background.
  await sharp({
    create: { width: 1024, height: 1024, channels: 4, background: '#064e3b' },
  })
    .png()
    .toFile(path.join(ASSETS, 'android-icon-background.png'));
  console.log('wrote android-icon-background.png');

  // Monochrome foreground (white horseshoe on transparent) for themed icons.
  const mono = iconSvg(false).replace(/#10b981/g, '#ffffff').replace(/#fbbf24/g, '#ffffff');
  await sharp(Buffer.from(mono)).resize(1024, 1024).png().toFile(path.join(ASSETS, 'android-icon-monochrome.png'));
  console.log('wrote android-icon-monochrome.png');
}

gen().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
