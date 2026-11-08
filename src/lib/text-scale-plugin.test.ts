import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

import postcss from "postcss";

const require = createRequire(import.meta.url);
// Плагин — CommonJS: его грузит сборка Next (webpack и Turbopack) без TS.
const plugin = require("../../postcss-plugins/text-scale.cjs") as {
  (): postcss.Plugin;
  scaleDeclarationValue: (prop: string, value: string) => string | null;
};

const run = (css: string) => postcss([plugin()]).process(css, { from: undefined }).css;

describe("PostCSS «Размер текста»", () => {
  it("основной текст (< 20px) — на --app-text-scale", () => {
    assert.equal(plugin.scaleDeclarationValue("font-size", "13px"), "calc(13px * var(--app-text-scale, 1))");
    assert.equal(plugin.scaleDeclarationValue("font-size", "0.875rem"), "calc(0.875rem * var(--app-text-scale, 1))");
    assert.equal(plugin.scaleDeclarationValue("font-size", "var(--text-sm)"), "calc(var(--text-sm) * var(--app-text-scale, 1))");
    assert.equal(plugin.scaleDeclarationValue("font-size", "max(16px, 1rem)"), "calc(max(16px, 1rem) * var(--app-text-scale, 1))");
  });

  it("заголовки 20–31px — на --app-heading-scale, от 32px — не трогаем", () => {
    assert.equal(plugin.scaleDeclarationValue("font-size", "26px"), "calc(26px * var(--app-heading-scale, 1))");
    assert.equal(plugin.scaleDeclarationValue("font-size", "var(--text-2xl)"), "calc(var(--text-2xl) * var(--app-heading-scale, 1))");
    assert.equal(
      plugin.scaleDeclarationValue("font-size", "clamp(1.25rem, 2vw + 0.75rem, 1.75rem)"),
      "calc(clamp(1.25rem, 2vw + 0.75rem, 1.75rem) * var(--app-heading-scale, 1))",
    );
    assert.equal(plugin.scaleDeclarationValue("font-size", "32px"), null);
    assert.equal(plugin.scaleDeclarationValue("font-size", "clamp(1.75rem, 2vw + 1rem, 2rem)"), null);
    assert.equal(plugin.scaleDeclarationValue("font-size", "var(--text-5xl)"), null);
  });

  it("относительные значения и ключевые слова растут с родителем — не трогаем", () => {
    for (const value of ["0.92em", "80%", "inherit", "smaller", "0", "0px", "var(--custom-size)"]) {
      assert.equal(plugin.scaleDeclarationValue("font-size", value), null, value);
    }
  });

  it("межстрочный интервал: только длины px/rem; без единиц — не трогаем", () => {
    assert.equal(plugin.scaleDeclarationValue("line-height", "18px"), "calc(18px * var(--app-text-scale, 1))");
    assert.equal(plugin.scaleDeclarationValue("--tw-leading", "18px"), "calc(18px * var(--app-text-scale, 1))");
    assert.equal(plugin.scaleDeclarationValue("line-height", "1.5"), null);
    assert.equal(plugin.scaleDeclarationValue("line-height", "var(--tw-leading, var(--text-sm--line-height))"), null);
    assert.equal(plugin.scaleDeclarationValue("margin", "13px"), null);
  });

  it("уже обёрнутое значение второй раз не оборачивается", () => {
    const once = plugin.scaleDeclarationValue("font-size", "13px")!;
    assert.equal(plugin.scaleDeclarationValue("font-size", once), null);
    assert.equal(run(run(".a{font-size:13px}")), ".a{font-size:calc(13px * var(--app-text-scale, 1))}");
  });

  it("утилиты Tailwind и их варианты, но не печать и не @keyframes", () => {
    const css = run(
      [
        ".text-\\[13px\\]{font-size:13px}",
        ".sm\\:text-\\[15px\\]{@media (width >= 40rem){font-size:15px}}",
        "@media (width >= 64rem){.lg\\:text-\\[22px\\]{font-size:22px}}",
        "@media print{.print\\:text-\\[9px\\]{font-size:9px}}",
        "@keyframes grow{from{font-size:10px}to{font-size:12px}}",
        ".leading-\\[18px\\]{--tw-leading:18px;line-height:18px}",
      ].join("\n"),
    );
    assert.match(css, /\.text-\\\[13px\\\]\{font-size:calc\(13px \* var\(--app-text-scale, 1\)\)\}/);
    assert.match(css, /font-size:calc\(15px \* var\(--app-text-scale, 1\)\)/);
    assert.match(css, /font-size:calc\(22px \* var\(--app-heading-scale, 1\)\)/);
    assert.match(css, /@media print\{\.print\\:text-\\\[9px\\\]\{font-size:9px\}\}/);
    assert.match(css, /@keyframes grow\{from\{font-size:10px\}to\{font-size:12px\}\}/);
    assert.match(css, /--tw-leading:calc\(18px \* var\(--app-text-scale, 1\)\);line-height:calc\(18px \* var\(--app-text-scale, 1\)\)/);
  });

  it("подключён в postcss.config.mjs после Tailwind", async () => {
    const { default: config } = (await import("../../postcss.config.mjs")) as { default: { plugins: Record<string, unknown> } };
    const names = Object.keys(config.plugins);
    assert.equal(names[0], "@tailwindcss/postcss");
    assert.match(names[1], /postcss-plugins[\\/]text-scale\.cjs$/);
  });
});
