import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { IOS_STARTUP_SCREENS, NOTIFICATION_BADGE, NOTIFICATION_ICON, iosStartupImages } from "./pwa-assets";

/**
 * Манифест устанавливаемого приложения. Проверяем не «валидность вообще»,
 * а именно те поля, где ошибка не видна ни в сборке, ни в тестах, ни на
 * компьютере — только на телефоне, у живого человека.
 */
function manifest() {
  return JSON.parse(readFileSync("public/manifest.json", "utf8")) as Record<
    string,
    unknown
  >;
}

describe("manifest.json", () => {
  it("scope — весь сайт, а не только кабинет", () => {
    // Сужение до "/mini" уже ломало приложение на iPhone (2026-09-08).
    // Кабинет НАМЕРЕННО ссылается наружу: своей сетки документов у него
    // нет, и журналы по документам открываются на
    // /journals/[code]/documents/[docId]. Любой такой переход выходил из
    // области приложения, и iOS показывал встроенный браузер с крестиком
    // и адресной строкой поверх standalone-окна.
    //
    // Где ПРЕДЛАГАТЬ установку и что считать приложением — разные вещи.
    // Первое задаётся тем, на каких страницах стоит <link rel="manifest">
    // (только в src/app/mini/layout.tsx), и сужать нужно было только его.
    assert.equal(manifest().scope, "/");
  });

  it("start_url лежит внутри scope и без завершающего слеша", () => {
    const m = manifest();
    const startUrl = String(m.start_url);
    assert.ok(startUrl.startsWith(String(m.scope)), "start_url вне scope");
    // src/proxy.ts отвечает на завершающий слеш редиректом 308 — запуск
    // приложения начинался бы с лишнего прыжка.
    assert.ok(
      !startUrl.split("?")[0].endsWith("/"),
      "start_url со слешем на конце",
    );
    assert.ok(startUrl.startsWith("/mini"), "приложение открывается в кабинете");
  });

  it("цвет запуска совпадает с шапкой приложения", () => {
    // Расхождение манифеста и layout (`themeColor` в mini/layout.tsx) давало
    // вспышку чужого цвета при запуске: система рисует свой цвет, пока
    // страница не отрисовалась. Шапка приложения — тёмно-синяя, как у
    // QR-страниц, в обеих темах.
    assert.equal(manifest().background_color, "#0b1024");
    assert.equal(manifest().theme_color, "#0b1024");
  });

  it("иконки на месте и обе нужных размера", () => {
    const icons = manifest().icons as Array<{ sizes: string; src: string }>;
    const sizes = new Set(icons.map((i) => i.sizes));
    assert.ok(sizes.has("192x192"), "нет иконки 192");
    assert.ok(sizes.has("512x512"), "нет иконки 512");
  });
});

/** Ширина, высота и прозрачность PNG — прямо из заголовка файла. */
function pngInfo(file: string): { width: number; height: number; alpha: boolean } {
  const bytes = readFileSync(file);
  assert.equal(bytes.toString("latin1", 1, 4), "PNG", `${file}: не PNG`);
  assert.equal(bytes.toString("latin1", 12, 16), "IHDR");
  const colorType = bytes[25];
  // 4 и 6 — с альфа-каналом; у палитры (3) прозрачность — в чанке tRNS.
  const alpha = colorType === 4 || colorType === 6 || (colorType === 3 && bytes.includes(Buffer.from("tRNS")));
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), alpha };
}

/** Ширина и высота WebP (VP8, VP8L или VP8X) — из заголовка файла. */
function webpSize(file: string): { width: number; height: number } {
  const b = readFileSync(file);
  assert.equal(b.toString("latin1", 0, 4), "RIFF", `${file}: не WebP`);
  assert.equal(b.toString("latin1", 8, 12), "WEBP", `${file}: не WebP`);
  const chunk = b.toString("latin1", 12, 16);
  if (chunk === "VP8 ") return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  if (chunk === "VP8L") {
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  assert.equal(chunk, "VP8X", `${file}: неизвестный формат WebP ${chunk}`);
  return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
}

type ManifestIcon = { src: string; sizes: string; type: string; purpose?: string };
type ManifestScreenshot = { src: string; sizes: string; type: string; form_factor?: string; label?: string };
type ManifestShortcut = { name: string; short_name: string; description: string; url: string; icons?: ManifestIcon[] };

describe("картинки манифеста", () => {
  const m = manifest() as { icons: ManifestIcon[]; shortcuts: ManifestShortcut[] };

  it("каждая иконка и иконка ярлыка лежит в public/ и её размер совпадает с заявленным", () => {
    const all = [...m.icons, ...m.shortcuts.flatMap((s) => s.icons ?? [])];
    assert.ok(all.length > 0);
    for (const icon of all) {
      const file = `public${icon.src}`;
      assert.ok(existsSync(file), `нет файла ${file}`);
      const { width, height } = pngInfo(file);
      assert.equal(`${width}x${height}`, icon.sizes, `${icon.src}: заявлено ${icon.sizes}, в файле ${width}x${height}`);
      assert.equal(icon.type, "image/png");
    }
  });

  it("есть иконки 512 и для «any», и для maskable — maskable без прозрачности", () => {
    // Без maskable Android вписывает значок в белый круг; прозрачные углы
    // у maskable маска показала бы чёрными.
    const any = m.icons.filter((i) => (i.purpose ?? "any") === "any");
    const maskable = m.icons.filter((i) => i.purpose === "maskable");
    assert.ok(any.some((i) => i.sizes === "512x512"), "нет иконки any 512");
    assert.ok(maskable.some((i) => i.sizes === "512x512"), "нет maskable 512");
    for (const icon of maskable) assert.equal(pngInfo(`public${icon.src}`).alpha, false, `${icon.src} с прозрачностью`);
  });

  it("у ярлыков «Сегодня» и «Журналы» есть свои иконки", () => {
    for (const s of m.shortcuts) assert.ok(s.icons && s.icons.length > 0, `у ярлыка ${s.url} нет иконки`);
  });

  it("скриншоты для окна установки Android: файлы на месте, размер как заявлен, одна пропорция", () => {
    // Chrome показывает «расширенное» окно установки, только если у всех
    // скриншотов narrow одна пропорция и сторона от 320 до 3840 px.
    const shots = (manifest() as { screenshots?: ManifestScreenshot[] }).screenshots ?? [];
    assert.ok(shots.length >= 1, "нет скриншотов");
    const ratios = new Set<string>();
    for (const shot of shots) {
      const file = `public${shot.src}`;
      assert.ok(existsSync(file), `нет файла ${file}`);
      const { width, height } = webpSize(file);
      assert.equal(`${width}x${height}`, shot.sizes, shot.src);
      assert.equal(shot.type, "image/webp");
      assert.equal(shot.form_factor, "narrow");
      assert.ok(shot.label, `${shot.src}: нет подписи`);
      assert.ok(Math.min(width, height) >= 320 && Math.max(width, height) <= 3840);
      assert.ok(Math.max(width, height) / Math.min(width, height) <= 2.3);
      ratios.add((height / width).toFixed(3));
    }
    assert.equal(ratios.size, 1, "у скриншотов разные пропорции");
  });

  it("значок iPhone (apple-icon.png) 180×180 и без прозрачности — iOS залил бы её чёрным", () => {
    assert.deepEqual(pngInfo("src/app/apple-icon.png"), { width: 180, height: 180, alpha: false });
  });
});

describe("манифесты на английском и узбекском", () => {
  // Файлы manifest-en.json и manifest-uz.json лежат в public/ готовыми.
  // Правка русского манифеста (иконки, цвета, адреса) без них дала бы
  // разные приложения в зависимости от языка сайта.
  for (const locale of ["en", "uz"] as const) {
    it(`manifest-${locale}.json отличается от русского только текстами`, () => {
      const ru = manifest() as Record<string, unknown> & { shortcuts: ManifestShortcut[] };
      const local = JSON.parse(readFileSync(`public/manifest-${locale}.json`, "utf8")) as typeof ru;
      assert.equal(local.lang, locale);
      const strip = (x: typeof ru) => ({
        ...x,
        name: null,
        description: null,
        lang: null,
        shortcuts: x.shortcuts.map((s) => ({ ...s, name: null, short_name: null, description: null })),
        screenshots: ((x.screenshots ?? []) as ManifestScreenshot[]).map((s) => ({ ...s, label: null })),
      });
      assert.deepEqual(strip(local), strip(ru));
    });
  }
});

describe("уведомления кабинета", () => {
  it("service worker показывает push с той же иконкой и значком-силуэтом, что и страница", () => {
    const sw = readFileSync("public/mini-sw.js", "utf8");
    assert.ok(sw.includes(`icon: "${NOTIFICATION_ICON}"`), `mini-sw.js: icon не ${NOTIFICATION_ICON}`);
    assert.ok(sw.includes(`badge: "${NOTIFICATION_BADGE}"`), `mini-sw.js: badge не ${NOTIFICATION_BADGE}`);
    const badge = pngInfo(`public${NOTIFICATION_BADGE}`);
    assert.equal(badge.alpha, true, "значок-силуэт без прозрачности стал бы белым квадратом");
    assert.ok(existsSync(`public${NOTIFICATION_ICON}`));
  });
});

describe("заставки iPhone", () => {
  it("каждая картинка совпадает с экраном из своего media-запроса до пикселя", () => {
    const images = iosStartupImages();
    assert.equal(images.length, IOS_STARTUP_SCREENS.length);
    assert.equal(new Set(images.map((i) => i.media)).size, images.length, "повтор media-запроса");
    for (const image of images) {
      const match = image.media.match(
        /^\(device-width: (\d+)px\) and \(device-height: (\d+)px\) and \(-webkit-device-pixel-ratio: (\d)\) and \(orientation: portrait\)$/,
      );
      assert.ok(match, `media: ${image.media}`);
      const [, w, h, r] = match.map(Number);
      const file = `public${image.url}`;
      assert.ok(existsSync(file), `нет файла ${file}`);
      const info = pngInfo(file);
      assert.equal(`${info.width}x${info.height}`, `${w * r}x${h * r}`, image.url);
      assert.equal(info.alpha, false, `${image.url} с прозрачностью`);
    }
  });
});
