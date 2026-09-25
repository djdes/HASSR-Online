import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

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
