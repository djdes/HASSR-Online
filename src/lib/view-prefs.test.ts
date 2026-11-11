import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  DEFAULT_VIEW_PREFS,
  HIGH_CONTRAST_ATTR,
  MAIN_CONTENT_ID,
  STILL_ATTR,
  TEXT_SCALE,
  effectiveViewFlags,
  isDefaultViewPrefs,
  parseViewPrefs,
  serializeViewPrefs,
  viewPrefsBootstrapCode,
  viewPrefsCookieString,
  viewPrefsHtmlAttributes,
} from "@/lib/view-prefs";

const ROOT = process.cwd();
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const CSS = read("src/app/view-prefs.css");

/** WCAG 2.x: контраст двух цветов #rrggbb. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("Удобство чтения: кука устройства", () => {
  it("по умолчанию — обычный текст, контраст и анимация как в системе, пояснения видны", () => {
    assert.deepEqual(parseViewPrefs(undefined), DEFAULT_VIEW_PREFS);
    assert.deepEqual(parseViewPrefs(""), DEFAULT_VIEW_PREFS);
    assert.equal(isDefaultViewPrefs(DEFAULT_VIEW_PREFS), true);
  });

  it("запись и чтение — туда и обратно, в том числе закодированная кука", () => {
    const prefs = { textSize: "xlarge", contrast: "high", motion: "reduce", hints: "off", navLayout: "new" } as const;
    assert.deepEqual(parseViewPrefs(serializeViewPrefs(prefs)), prefs);
    assert.deepEqual(parseViewPrefs(encodeURIComponent(serializeViewPrefs(prefs))), prefs);
    assert.match(viewPrefsCookieString(prefs), /^wesetup-view=t:xlarge\|c:high\|m:reduce\|h:off\|n:new; Path=\/; Max-Age=\d+; SameSite=Lax$/);
  });

  it("шаблон меню: у всех «Новый», сохранённый «стандартный» больше не действует", () => {
    assert.equal(DEFAULT_VIEW_PREFS.navLayout, "new");
    assert.equal(parseViewPrefs("n:new").navLayout, "new");
    assert.equal(parseViewPrefs("n:classic").navLayout, "new");
    assert.equal(parseViewPrefs("t:large|n:fancy").navLayout, "new");
  });

  it("мусор и чужие значения — по умолчанию, по одному полю", () => {
    assert.deepEqual(parseViewPrefs("t:huge|c:high|zzz|m:|h:maybe"), { ...DEFAULT_VIEW_PREFS, contrast: "high" });
    assert.deepEqual(parseViewPrefs("%E0%A4%A"), DEFAULT_VIEW_PREFS);
  });

  it("«как в системе»: флаги включает настройка устройства, явный выбор — всегда", () => {
    const auto = { contrast: "auto", motion: "auto" } as const;
    assert.deepEqual(effectiveViewFlags(auto, { highContrast: false, reducedMotion: false }), { highContrast: false, still: false });
    assert.deepEqual(effectiveViewFlags(auto, { highContrast: true, reducedMotion: true }), { highContrast: true, still: true });
    assert.deepEqual(effectiveViewFlags({ contrast: "high", motion: "reduce" }, { highContrast: false, reducedMotion: false }), { highContrast: true, still: true });
  });

  it("атрибуты <html> для первого кадра: выбор и флаги явного выбора", () => {
    assert.deepEqual(viewPrefsHtmlAttributes(DEFAULT_VIEW_PREFS), {
      "data-view-text": "normal",
      "data-view-contrast": "auto",
      "data-view-motion": "auto",
      "data-view-hints": "on",
      "data-view-nav": "new",
    });
    const attrs = viewPrefsHtmlAttributes({ textSize: "large", contrast: "high", motion: "reduce", hints: "off", navLayout: "new" });
    assert.equal(attrs["data-view-text"], "large");
    assert.equal(attrs[HIGH_CONTRAST_ATTR], "");
    assert.equal(attrs[STILL_ATTR], "");
    assert.equal(attrs["data-view-hints"], "off");
    assert.equal(attrs["data-view-nav"], "new");
  });

  it("скрипт до гидрации досчитывает «как в системе» по matchMedia", () => {
    const code = viewPrefsBootstrapCode();
    assert.match(code, /prefers-contrast: more/);
    assert.match(code, /prefers-reduced-motion: reduce/);
    assert.match(code, new RegExp(HIGH_CONTRAST_ATTR));
    assert.match(code, new RegExp(STILL_ATTR));
    assert.doesNotMatch(code, /<\/script/i);
  });
});

describe("Удобство чтения: CSS", () => {
  it("множители размера текста в CSS совпадают с TEXT_SCALE", () => {
    for (const size of ["large", "xlarge"] as const) {
      const block = CSS.match(new RegExp(`:root\\[data-view-text="${size}"\\] \\{([^}]*)\\}`))?.[1] ?? "";
      assert.match(block, new RegExp(`--app-text-scale: ${TEXT_SCALE[size].text};`), size);
      assert.match(block, new RegExp(`--app-heading-scale: ${TEXT_SCALE[size].heading};`), size);
    }
    assert.deepEqual(TEXT_SCALE.normal, { text: 1, heading: 1 });
  });

  it("при печати множители всегда 1 — бумажный бланк не меняется", () => {
    const print = CSS.slice(CSS.indexOf("@media print"));
    assert.match(print, /--app-text-scale: 1 !important;/);
    assert.match(print, /--app-heading-scale: 1 !important;/);
  });

  it("высокий контраст: подписи не ниже 7:1 на белом и на светлых подложках, в тёмной теме — на карточке", () => {
    // Блоки правил высокого контраста: селектор → цвет.
    const blocks = CSS.split("}")
      .map((chunk) => chunk.split("{"))
      .filter((parts) => parts.length === 2 && parts[0].includes(":root[data-view-hc]"))
      .map(([selector, body]) => ({ selector, color: body.match(/(?:^|[\s;])color: (#[0-9a-f]{6});/i)?.[1] ?? null }))
      .filter((block) => block.color !== null);
    const text = blocks.filter((block) => !block.selector.includes("::placeholder"));
    assert.ok(text.length >= 2, "правила подписей светлой темы");
    for (const { color } of text) {
      assert.ok(contrast(color!, "#ffffff") >= 7, `${color} на белом`);
      assert.ok(contrast(color!, "#eef1ff") >= 7, `${color} на #eef1ff`);
    }
    // Подсказка в пустом поле — не ниже AA (4,5:1).
    const placeholder = blocks.find((block) => block.selector.includes("::placeholder"));
    assert.ok(placeholder && contrast(placeholder.color!, "#ffffff") >= 4.5, "подсказка в поле");
    const dark = CSS.match(/--app-text-muted: (#[0-9a-f]{6});[\s\S]*?--app-text-faint: (#[0-9a-f]{6});/i);
    assert.ok(dark, "переменные тёмной темы");
    for (const color of [dark[1], dark[2]]) assert.ok(contrast(color, "#3a3757") >= 7, `${color} на #3a3757`);
    // Рамка поля — не ниже 3:1 (WCAG 1.4.11).
    const border = CSS.match(/border-color: (#[0-9a-f]{6});/i)?.[1] ?? "";
    assert.ok(contrast(border, "#ffffff") >= 3, `рамка ${border}`);
  });

  it("пояснения: выключены — `data-page-hint` скрыт; помечены подзаголовок и «Как это работает»", () => {
    assert.match(CSS, /:root\[data-view-hints="off"\] \[data-page-hint\] \{\s*display: none !important;/);
    assert.match(read("src/components/ui/page-header.tsx"), /<p data-page-hint=""/);
    const guide = read("src/components/ui/page-guide.tsx");
    assert.equal((guide.match(/data-page-hint=""/g) ?? []).length, 2);
    assert.match(guide, /hide-hints-everywhere/);
  });

  it("корневой layout ставит атрибуты по куке и подключает CSS и скрипт", () => {
    const layout = read("src/app/layout.tsx");
    assert.match(layout, /import "\.\/view-prefs\.css";/);
    assert.match(layout, /\{\.\.\.viewPrefsHtmlAttributes\(viewPrefs\)\}/);
    assert.match(layout, /viewPrefsBootstrapCode\(\)/);
    assert.match(layout, /<ViewPrefsProvider initial=\{viewPrefs\}>/);
  });

  it("«Перейти к содержимому»: ссылка в кабинете и в мини-приложении, цель — main", () => {
    for (const file of ["src/app/(dashboard)/layout.tsx", "src/app/mini/_components/mini-app-shell.tsx"]) {
      const source = read(file);
      assert.match(source, /<SkipToContent \/>/, file);
      assert.match(source, /<main[\s\S]{0,40}id=\{MAIN_CONTENT_ID\}[\s\S]{0,20}tabIndex=\{-1\}/, file);
    }
    assert.equal(MAIN_CONTENT_ID, "main-content");
    assert.match(CSS, /\.skip-to-content:focus/);
  });
});
