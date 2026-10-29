import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Ночная тема перекрашивает светлые HEX-классы по имени класса
 * (`.text-[#3c4053]`, `.from-[#f5f6ff]`, `[style*="color:#a13a32"]`).
 * Всё, что эти правила не узнают, остаётся светлым по дизайну — и выходит
 * тёмным текстом на тёмном фоне (оферта, врезки блога) или светлым на
 * светлом (блок MCP на /developers). Проверки ловят такие места до прода.
 */

const GLOBALS = readFileSync("src/app/globals.css", "utf8");

const TSX = readdirSync("src", { recursive: true, encoding: "utf8" })
  .filter((file) => file.endsWith(".tsx"))
  .map((file) => ({ file, source: readFileSync(join("src", file), "utf8") }));

test("цвет текста во вложенных селекторах — токен темы, не HEX", () => {
  const offenders = TSX.flatMap(({ file, source }) =>
    (source.match(/\[&_[^\]]+\]:text-\[#[0-9a-fA-F]{3,8}\]/g) ?? []).map((cls) => `${file}: ${cls}`)
  );
  assert.deepEqual(offenders, []);
});

test("текст врезок статьи читается в ночной теме", () => {
  const renderer = readFileSync("src/components/public/article-renderer.tsx", "utf8");
  const colors = [...renderer.matchAll(/\bfg: "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(colors.length >= 3, "не найдены тона врезок");
  for (const color of colors) {
    if (color.startsWith("var(--")) continue;
    assert.ok(
      GLOBALS.includes(`[style*="color:${color}"]`),
      `для inline-цвета ${color} нет правила ночной темы в globals.css`
    );
  }
});

test("светлые произвольные градиенты гаснут в ночной теме", () => {
  const covered = [...GLOBALS.matchAll(/\[class\*="bg-\[linear-gradient\(([^"]+)"\]/g)].map((m) => m[1]);
  const LIGHT = /^\d+deg,#(ffffff|fafbff|f5f6ff|eef1ff|f0edff)/i;
  const missing = TSX.flatMap(({ file, source }) =>
    [...source.matchAll(/bg-\[linear-gradient\(([^_\]]+)/g)]
      .map((m) => m[1])
      .filter((start) => LIGHT.test(start) && !covered.some((prefix) => start.startsWith(prefix)))
      .map((start) => `${file}: ${start}`)
  );
  assert.deepEqual(missing, []);
});
