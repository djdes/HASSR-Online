import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DEFAULT_PRINT_BRAND_SOURCE, resolvePrintBrand } from "@/lib/print-brand";
import { findPoster, POSTERS } from "@/lib/ppk/posters";
import { POSTER_PREVIEW_SIZE, PosterSheet } from "./poster-sheet";

const brand = (website: string | null) =>
  resolvePrintBrand({ ...DEFAULT_PRINT_BRAND_SOURCE, name: "МАУ «КП «ДК»", website });

function render(props: Partial<Parameters<typeof PosterSheet>[0]> = {}) {
  const poster = findPoster("dishes");
  assert.ok(poster);
  return renderToStaticMarkup(createElement(PosterSheet, { poster, brand: brand(null), ...props }));
}

/** Части листа: шапка (до линии), подвал (после `data-print-brand-footer`). */
function parts(html: string) {
  const footerAt = html.indexOf("data-print-brand-footer");
  const contentAt = html.indexOf("data-poster-content");
  assert.ok(footerAt > 0 && contentAt > 0);
  return { header: html.slice(0, contentAt), footer: html.slice(footerAt) };
}

test("скан 97: подвал всегда wesetup.ru, свой сайт организации — только в шапке", () => {
  const own = parts(render({ brand: brand("https://www.dobroe-kafe.ru/") }));
  assert.match(own.header, /dobroe-kafe\.ru/);
  assert.match(own.footer, /wesetup\.ru/);
  assert.doesNotMatch(own.footer, /dobroe-kafe\.ru/);
  assert.match(own.footer, /МАУ «КП «ДК»/);

  const none = parts(render({ brand: brand(null) }));
  assert.match(none.header, /wesetup\.ru/);
  assert.match(none.footer, /wesetup\.ru/);
});

test("строка торговой точки — между шапкой и заголовком, название и адрес", () => {
  const html = render({ point: { title: "Пищеблок СОШ № 5", detail: "г. Казань, ул. Ленина, 5" } });
  const pointAt = html.indexOf("data-poster-point");
  const titleAt = html.indexOf("Мытьё столовой посуды вручную");
  const headerAt = html.indexOf("data-print-brand-header");
  assert.ok(headerAt >= 0 && pointAt > headerAt && titleAt > pointAt, "порядок: шапка → точка → заголовок");
  assert.match(html, /Пищеблок СОШ № 5/);
  assert.match(html, /· г\. Казань, ул\. Ленина, 5/);
  // Длинное название не ломает лист: не больше двух строк.
  assert.match(html, /-webkit-line-clamp:2/);
});

test("нет точки — нет строки точки", () => {
  assert.doesNotMatch(render(), /data-poster-point/);
  assert.doesNotMatch(render({ point: null }), /data-poster-point/);
});

test("строка точки — на всех 17 плакатах и на мини-листах", () => {
  const point = { title: "Кафе на Мира", detail: null };
  for (const poster of POSTERS) {
    for (const size of ["print", "preview"] as const) {
      const html = renderToStaticMarkup(createElement(PosterSheet, { poster, brand: brand(null), point, size }));
      assert.match(html, /data-poster-point/, `${poster.key} (${size})`);
      assert.match(html, /Кафе на Мира/, `${poster.key} (${size})`);
    }
  }
});

test("мини-лист — уменьшенная копия листа 190 × 273 мм", () => {
  assert.deepEqual(POSTER_PREVIEW_SIZE, { width: 215, height: 310 });
});
