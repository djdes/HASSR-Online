// Рисует исходники иконки и заставки приложения в mobile/assets/, из которых
// `npx capacitor-assets generate` делает все размеры для Android и iOS.
//
// Знак — фирменный блокнот WeSetup с буквой «С» (как в public/icons/icon-512.png),
// перерисованный вектором: у растрового знака всего 512 px и светлая подложка
// вокруг, поэтому на тёмном фоне и в 1024 px он выходил мыльным и в рамке.
//
// Запуск: node scripts/make-assets.mjs (из папки mobile).
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");
const BG = "#0b1024";

/**
 * Знак в собственной системе координат 120×120, центр в (60, 60).
 * scale — во сколько раз увеличить, (cx, cy) — куда поставить центр.
 */
function mark(cx, cy, scale) {
  const t = `translate(${cx - 60 * scale} ${cy - 60 * scale}) scale(${scale})`;
  return `
  <g transform="${t}">
    <!-- тень под блокнотом -->
    <ellipse cx="62" cy="112" rx="40" ry="5" fill="#000" opacity="0.28"/>
    <!-- задняя обложка -->
    <rect x="26" y="14" width="76" height="96" rx="11" fill="url(#back)"/>
    <!-- страницы -->
    <rect x="30" y="92" width="68" height="11" rx="3" fill="url(#pages)"/>
    <!-- передняя обложка -->
    <rect x="20" y="8" width="78" height="90" rx="11" fill="url(#cover)"/>
    <rect x="23" y="11" width="72" height="84" rx="9" fill="none" stroke="#ffffff" stroke-opacity="0.16" stroke-width="1.6"/>
    <!-- застёжка -->
    <rect x="91" y="44" width="15" height="22" rx="4.5" fill="url(#clasp)"/>
    <rect x="93" y="46.5" width="4" height="17" rx="2" fill="#ffffff" opacity="0.22"/>
    <!-- кольца -->
    <g fill="none" stroke="url(#ring)" stroke-width="5.2" stroke-linecap="round">
      <path d="M27 28 C 13 26, 11 38, 26 38"/>
      <path d="M27 50 C 13 48, 11 60, 26 60"/>
      <path d="M27 72 C 13 70, 11 82, 26 82"/>
    </g>
    <!-- буква «С» -->
    <path d="M73.5 40.5 A 17.5 17.5 0 1 0 73.5 65.5" fill="none" stroke="#ffffff" stroke-width="10" stroke-linecap="round"/>
  </g>`;
}

const DEFS = `
  <defs>
    <linearGradient id="cover" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7584ff"/>
      <stop offset="0.55" stop-color="#5566f6"/>
      <stop offset="1" stop-color="#4353e6"/>
    </linearGradient>
    <linearGradient id="back" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3f4fe0"/>
      <stop offset="1" stop-color="#3342c8"/>
    </linearGradient>
    <linearGradient id="pages" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#dfe3f5"/>
    </linearGradient>
    <linearGradient id="clasp" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6070fb"/>
      <stop offset="1" stop-color="#3b4ad9"/>
    </linearGradient>
    <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#c9cdf7"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.45" r="0.5">
      <stop offset="0" stop-color="#5566f6" stop-opacity="0.38"/>
      <stop offset="1" stop-color="#5566f6" stop-opacity="0"/>
    </radialGradient>
  </defs>`;

function svg(size, body, { background = true, glow = true } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${DEFS}
  ${background ? `<rect width="${size}" height="${size}" fill="${BG}"/>` : ""}
  ${glow ? `<circle cx="${size / 2}" cy="${size / 2}" r="${size * 0.42}" fill="url(#glow)"/>` : ""}
  ${body}
</svg>`;
}

async function render(name, size, body, options) {
  const file = join(OUT, name);
  await sharp(Buffer.from(svg(size, body, options)), { density: 72 })
    .png()
    .toFile(file);
  console.log(`${name} ${size}×${size}`);
}

mkdirSync(OUT, { recursive: true });

// Иконка iOS и старых Android: знак занимает ~60 % стороны, поля по 20 %.
await render("icon-only.png", 1024, mark(512, 512, 5.1));
// Адаптивная иконка Android: capacitor-assets вписывает слой в видимую часть
// (inset 16.7 %), маска режет её кругом или «каплей». Знак того же размера, что
// на iOS: его диагональ ~70 % стороны — в круг помещается целиком.
await render("icon-foreground.png", 1024, mark(512, 512, 5.1), { background: false, glow: false });
await render("icon-background.png", 1024, "", { glow: true });
// Заставка: знак по центру, ~22 % стороны — не режется ни на каком экране.
await render("splash.png", 2732, mark(1366, 1366, 5), { glow: false });
await render("splash-dark.png", 2732, mark(1366, 1366, 5), { glow: false });
