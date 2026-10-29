import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Пунктир реза на листах печати QR (скан 2026-10-29: «добавь пунктир для удобной
// нарезки табличек А5 — для симметрии, как у наклеек»). Стили — в PRINT_CSS.
const css = readFileSync("src/app/(dashboard)/settings/qr-posters/qr-print-sheets.tsx", "utf8");
const rule = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`^\\s*${escaped} \\{([^}]*)\\}`, "m"))?.[1] ?? "";
};
const DASH = "0.3mm dashed #777";

test("наклейка обведена пунктиром — образец для остальных форматов", () => {
  assert.ok(css.includes(`border: ${DASH} !important`));
});

test("A5: каждая половинка обведена пунктиром, общий край — одной линией", () => {
  assert.ok(rule(".qrp-a5").includes(`border: ${DASH} !important`), rule(".qrp-a5"));
  assert.ok(rule(".qrp-a5 + .qrp-a5").includes("border-top: 0 !important"));
});

test("таблички 2×2: пунктир по всем краям каждой, без двойных линий", () => {
  const plate = rule(".qrp-plate");
  assert.ok(plate.includes(`border-right: ${DASH} !important`) && plate.includes(`border-bottom: ${DASH} !important`), plate);
  assert.ok(rule(".qrp-plate:nth-child(odd)").includes(`border-left: ${DASH} !important`));
  assert.ok(rule(".qrp-plate:nth-child(-n+2)").includes(`border-top: ${DASH} !important`));
});
