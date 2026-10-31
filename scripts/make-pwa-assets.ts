/**
 * Картинки кабинета на домашнем экране (PWA): иконки, maskable-иконки
 * Android, значок iPhone, силуэт для push, иконки ярлыков и заставки iPhone.
 *
 * Знак — тот же вектор и в той же пропорции, что у приложений из магазинов
 * (mobile/scripts/brand-mark.mjs, make-assets.mjs), фон — #0b1024, как у шапки
 * кабинета и theme_color манифеста. Список экранов iPhone и имена файлов — в
 * src/lib/pwa-assets.ts (его же читают src/app/mini/layout.tsx и тесты).
 *
 * Запуск из корня: npx tsx scripts/make-pwa-assets.ts
 * Результат коммитится: на сервере картинки не рисуются.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";

// @ts-ignore — ESM-модуль без типов из соседнего проекта mobile/.
import { BG, mark, silhouette, svg } from "../mobile/scripts/brand-mark.mjs";
import {
  IOS_STARTUP_SCREENS,
  NOTIFICATION_BADGE,
  PWA_SCREENSHOTS,
  PWA_SCREENSHOT_SIZE,
  PWA_ICON_ANY_192,
  PWA_ICON_ANY_512,
  PWA_ICON_MASKABLE_192,
  PWA_ICON_MASKABLE_512,
  PWA_SHORTCUT_JOURNALS_ICON,
  PWA_SHORTCUT_TODAY_ICON,
  iosStartupImageSize,
  iosStartupImageUrl,
} from "../src/lib/pwa-assets";

type SvgOptions = { height?: number; background?: boolean; glow?: boolean };
const toSvg = svg as (width: number, body: string, options?: SvgOptions) => string;
const markAt = mark as (cx: number, cy: number, scale: number) => string;
const silhouetteSvg = silhouette as (size: number) => string;
const background = BG as string;

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");

/**
 * Дальняя от центра точка знака — ~71 единица (см. brand-mark.mjs). Значок
 * приложения рисуется со scale 5.1 на 1024 px: эта точка на 71 % полустороны.
 * Та же пропорция здесь — значки совпадают, и знак целиком внутри безопасной
 * зоны maskable (круг радиусом 40 % стороны: 0.707 × 50 % ≈ 35 %).
 */
const MARK_FILL = (71 * 5.1) / 512;

function publicFile(url: string): string {
  return path.join(PUBLIC, url.replace(/^\//, ""));
}

async function save(file: string, image: sharp.Sharp, palette = false) {
  mkdirSync(path.dirname(file), { recursive: true });
  await image
    .png(palette ? { palette: true, colors: 256, dither: 0.6, compressionLevel: 9, effort: 10 } : { compressionLevel: 9 })
    .toFile(file);
  const meta = await sharp(file).metadata();
  console.log(`${path.relative(ROOT, file)} ${meta.width}×${meta.height}${meta.hasAlpha ? " с прозрачностью" : ""}`);
}

const render = (source: string) => sharp(Buffer.from(source), { density: 72 });

/** Квадрат во всю сторону: фон, свечение, знак. */
function appSquare(size: number): string {
  return toSvg(size, markAt(size / 2, size / 2, (size / 2 / 71) * MARK_FILL));
}

/**
 * Иконка «any» (компьютеры, окно установки): скруглённый квадрат с
 * прозрачными углами — как значки приложений, а не тёмная плитка.
 */
async function roundedIcon(url: string, size: number) {
  const square = await render(appSquare(size)).png().toBuffer();
  const r = Math.round(size * 0.2237);
  const mask = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" fill="#fff"/></svg>`;
  await save(publicFile(url), sharp(square).composite([{ input: Buffer.from(mask), blend: "dest-in" }]));
}

/** Ярлык на значке: белый значок Lucide на фоне кабинета, внутри зоны маски. */
async function shortcutIcon(url: string, iconModule: string) {
  const { __iconNode } = (await import(iconModule)) as { __iconNode: Array<[string, Record<string, string>]> };
  const size = 192;
  const k = (size * 0.46) / 24;
  const shift = (size - 24 * k) / 2;
  const nodes = __iconNode
    .map(([tag, attrs]) => {
      const rest = Object.entries(attrs)
        .filter(([name]) => name !== "key")
        .map(([name, value]) => `${name}="${value}"`)
        .join(" ");
      return `<${tag} ${rest}/>`;
    })
    .join("");
  const body =
    `<g transform="translate(${shift} ${shift}) scale(${k})" fill="none" stroke="#ffffff" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${nodes}</g>`;
  await save(publicFile(url), render(toSvg(size, body)).flatten({ background }).removeAlpha());
}

async function main() {
  await roundedIcon(PWA_ICON_ANY_192, 192);
  await roundedIcon(PWA_ICON_ANY_512, 512);
  // maskable: Android сам режет кругом, «каплей» или сквиклом — во всю сторону, без прозрачности.
  await save(publicFile(PWA_ICON_MASKABLE_192), render(appSquare(192)).flatten({ background }).removeAlpha());
  await save(publicFile(PWA_ICON_MASKABLE_512), render(appSquare(512)).flatten({ background }).removeAlpha());
  // Значок iPhone (apple-touch-icon): углы скругляет iOS, прозрачность он
  // заливает чёрным — поэтому без альфа-канала.
  await save(path.join(ROOT, "src/app/apple-icon.png"), render(appSquare(180)).flatten({ background }).removeAlpha());
  // Силуэт для push: система берёт только прозрачность.
  await save(publicFile(NOTIFICATION_BADGE), render(silhouetteSvg(96)));
  // Ярлыки «Сегодня» и «Журналы» — те же значки, что в нижнем меню кабинета.
  await shortcutIcon(PWA_SHORTCUT_TODAY_ICON, "lucide-react/dist/esm/icons/calendar-check.js");
  await shortcutIcon(PWA_SHORTCUT_JOURNALS_ICON, "lucide-react/dist/esm/icons/clipboard-list.js");
  // Заставки iPhone. У приложения из App Store заставка — квадрат 2732 px со
  // знаком (scale 5), растянутый на высоту экрана: знак ~38 % ширины телефона.
  for (const screen of IOS_STARTUP_SCREENS) {
    const { width, height } = iosStartupImageSize(screen);
    const scale = (width * 0.38) / 95;
    const source = toSvg(width, markAt(width / 2, height / 2, scale), { height, glow: false });
    await save(publicFile(iosStartupImageUrl(screen)), render(source).flatten({ background }).removeAlpha(), true);
  }
}

/** Скриншоты для окна установки — уменьшенные скриншоты Google Play. */
async function manifestScreenshots() {
  for (const shot of PWA_SCREENSHOTS) {
    const source = path.join(ROOT, "docs/mobile/screenshots/android", shot.from);
    const file = publicFile(shot.src);
    mkdirSync(path.dirname(file), { recursive: true });
    await sharp(source)
      .resize(PWA_SCREENSHOT_SIZE.width, PWA_SCREENSHOT_SIZE.height)
      .webp({ quality: 82, effort: 6 })
      .toFile(file);
    const meta = await sharp(file).metadata();
    console.log(`${path.relative(ROOT, file)} ${meta.width}×${meta.height}`);
  }
}

main()
  .then(manifestScreenshots)
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
