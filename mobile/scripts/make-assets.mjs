// Рисует исходники иконки и заставки приложения в mobile/assets/, из которых
// `npx capacitor-assets generate` делает все размеры для Android и iOS.
//
// Знак — фирменный блокнот WeSetup с буквой «С», вектором (scripts/brand-mark.mjs):
// у старого растрового знака было всего 512 px и светлая подложка вокруг, на
// тёмном фоне и в 1024 px он выходил мыльным и в рамке. Тот же вектор рисует
// иконки кабинета на домашнем экране (PWA) — scripts/make-pwa-assets.mjs в корне.
//
// Запуск: node scripts/make-assets.mjs (из папки mobile).
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import { mark, svg } from "./brand-mark.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");

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
