import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DEFAULT_PRINT_BRAND_SOURCE, resolvePrintBrand } from "@/lib/print-brand";
import { PrintBrandFrame } from "./print-brand-frame";

/** Дети — третьим аргументом `createElement` (react/no-children-prop). */
type FrameProps = Parameters<typeof PrintBrandFrame>[0];

/** Текст шапки листа — от её атрибута до содержимого. */
const headerOf = (html: string) => html.slice(html.indexOf("data-print-brand-header"), html.indexOf("текст"));

test("памятка: сайт организации — в шапке, внизу всегда wesetup.ru", () => {
  const brand = resolvePrintBrand({ ...DEFAULT_PRINT_BRAND_SOURCE, name: "Доброе кафе", website: "https://dobroe-kafe.ru/" });
  const html = renderToStaticMarkup(createElement(PrintBrandFrame, { brand } as FrameProps, "текст"));
  assert.match(headerOf(html), />dobroe-kafe\.ru</);
  assert.match(html, /data-print-brand-footer-site="true">wesetup\.ru</);
  assert.ok(!/data-print-brand-footer-site="true">dobroe-kafe/.test(html));
});

test("памятка: сайт организации не указан — везде wesetup.ru", () => {
  const brand = resolvePrintBrand({ ...DEFAULT_PRINT_BRAND_SOURCE, name: "Доброе кафе" });
  const html = renderToStaticMarkup(createElement(PrintBrandFrame, { brand } as FrameProps, "текст"));
  assert.match(headerOf(html), />wesetup\.ru</);
  assert.match(html, /data-print-brand-footer-site="true">wesetup\.ru</);
});
