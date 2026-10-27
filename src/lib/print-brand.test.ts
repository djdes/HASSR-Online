import assert from "node:assert/strict";
import test from "node:test";

import { WESETUP_ACCENT, contrastRatio } from "@/lib/document-brand";
import {
  DEFAULT_PRINT_BRAND_SOURCE,
  DEFAULT_PRINT_SITE,
  MONO_PRINT_COLORS,
  isMonoParam,
  isSquareishLogo,
  normalizeWebsite,
  orgMonogram,
  printBrandCssVars,
  qrFrameColor,
  resolvePrintBrand,
  resolvePrintColors,
} from "@/lib/print-brand";

test("без цветов — цвет WeSetup, остальные подобраны из него", () => {
  const colors = resolvePrintColors(null, null, null);
  assert.equal(colors.primary, WESETUP_ACCENT);
  assert.equal(colors.secondary, WESETUP_ACCENT);
  assert.notEqual(colors.background, WESETUP_ACCENT);
  assert.ok(contrastRatio(colors.background, colors.text) >= 9);
});

test("один цвет — дополнительный повторяет основной, фон — его светлый оттенок", () => {
  const colors = resolvePrintColors("#2e7d32");
  assert.equal(colors.primary, "#2e7d32");
  assert.equal(colors.secondary, "#2e7d32");
  assert.ok(contrastRatio(colors.background, "#ffffff") < 1.3);
});

test("три цвета — каждый на своём месте, тёмный фон осветляется", () => {
  const colors = resolvePrintColors("#c62828", "#1565c0", "#0b1024");
  assert.equal(colors.primary, "#c62828");
  assert.equal(colors.secondary, "#1565c0");
  assert.ok(contrastRatio(colors.background, colors.text) >= 9);
  const light = resolvePrintColors("#c62828", null, "#fff8e1");
  assert.equal(light.background, "#fff8e1");
});

test("светлые цвета для линий затемняются до 3:1, текст на заливке читается", () => {
  const colors = resolvePrintColors("#ffeb3b", "#b2ebf2");
  assert.ok(contrastRatio(colors.primaryInk, "#ffffff") >= 3);
  assert.ok(contrastRatio(colors.secondaryInk, "#ffffff") >= 3);
  assert.ok(contrastRatio(colors.primary, colors.primaryOnFill) >= 4.5 - 1e-9 || colors.primaryOnFill !== "#ffffff");
});

test("режим «Ч/б» — все цвета чёрные, фон белый", () => {
  const brand = resolvePrintBrand({ ...DEFAULT_PRINT_BRAND_SOURCE, name: "Кафе", brandColor: "#ff0000" }, { mono: true });
  assert.deepEqual(brand.colors, MONO_PRINT_COLORS);
  assert.equal(brand.mono, true);
  assert.equal(brand.custom, true);
  assert.equal(qrFrameColor(brand), "#000000");
});

test("сайт: без протокола и www, пусто — wesetup.ru", () => {
  assert.equal(normalizeWebsite("https://www.Dobroe-Kafe.ru/"), "dobroe-kafe.ru");
  assert.equal(normalizeWebsite("кафе.рф"), "кафе.рф");
  assert.equal(normalizeWebsite("site.ru/menu"), "site.ru/menu");
  assert.equal(normalizeWebsite("not a site"), null);
  assert.equal(normalizeWebsite("localhost"), null);
  assert.equal(normalizeWebsite(""), null);
  assert.equal(resolvePrintBrand(DEFAULT_PRINT_BRAND_SOURCE).site, DEFAULT_PRINT_SITE);
  assert.equal(resolvePrintBrand({ ...DEFAULT_PRINT_BRAND_SOURCE, website: "http://a.ru" }).site, "a.ru");
});

test("рамка QR: светлый цвет затемняется до 4,5:1, выключенная — чёрная", () => {
  const brand = resolvePrintBrand({ ...DEFAULT_PRINT_BRAND_SOURCE, brandColor: "#ffd54f" });
  assert.ok(contrastRatio(qrFrameColor(brand), "#ffffff") >= 4.5);
  const off = resolvePrintBrand({ ...DEFAULT_PRINT_BRAND_SOURCE, qrBrandFrame: false });
  assert.equal(qrFrameColor(off), "#000000");
});

test("монограмма — первая буква без ОПФ и кавычек", () => {
  assert.equal(orgMonogram("ООО «Доброе кафе»"), "Д");
  assert.equal(orgMonogram("ИП Федотов А.В."), "Ф");
  assert.equal(orgMonogram("  \"сетап\" "), "С");
  assert.equal(orgMonogram(""), "W");
});

test("почти квадратный логотип — до 1 : 1,25", () => {
  assert.equal(isSquareishLogo(100, 100), true);
  assert.equal(isSquareishLogo(120, 100), true);
  assert.equal(isSquareishLogo(300, 100), false);
  assert.equal(isSquareishLogo(0, 100), false);
});

test("?bw=1 включает ч/б, CSS-переменные на месте", () => {
  assert.equal(isMonoParam("1"), true);
  assert.equal(isMonoParam(["true"]), true);
  assert.equal(isMonoParam("0"), false);
  assert.equal(isMonoParam(undefined), false);
  const vars = printBrandCssVars(resolvePrintColors(null));
  assert.equal(vars["--pb-primary"], WESETUP_ACCENT);
  assert.ok(vars["--pb-bg"]);
});
