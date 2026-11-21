import assert from "node:assert/strict";
import test from "node:test";

import { contrastRatio } from "./document-brand";
import { qrPageBrand } from "./qr-page-brand";

test("без логотипа и цвета — прежняя шапка WeSetup", () => {
  assert.equal(qrPageBrand({ logoUrl: null, brandColor: null }), null);
  assert.equal(qrPageBrand({ logoUrl: "  ", brandColor: "не цвет" }), null);
});

test("цвет компании — затемнённый до читаемости белого текста, наведение темнее", () => {
  const light = qrPageBrand({ logoUrl: null, brandColor: "#f7d046" });
  assert.ok(light?.accent && light.accentHover);
  assert.ok(contrastRatio(light.accent, "#ffffff") >= 4.5, light.accent);
  assert.ok(contrastRatio(light.accentHover, "#ffffff") > contrastRatio(light.accent, "#ffffff"));
  // Тёмный цвет остаётся как есть.
  assert.equal(qrPageBrand({ logoUrl: null, brandColor: "#1f3a8a" })?.accent, "#1f3a8a");
  // #rgb и #rrggbbaa — как в «Фирменном стиле».
  assert.equal(qrPageBrand({ logoUrl: null, brandColor: "#13a08fcc" })?.accent, qrPageBrand({ logoUrl: null, brandColor: "#13a08f" })?.accent);
});

test("логотип — загруженный файл или https-ссылка; прочее не показываем", () => {
  assert.equal(qrPageBrand({ logoUrl: "/api/org-assets/org_1/logo?v=2", brandColor: null })?.logoUrl, "/api/org-assets/org_1/logo?v=2");
  assert.equal(qrPageBrand({ logoUrl: "https://cdn.example.com/logo.png", brandColor: null })?.logoUrl, "https://cdn.example.com/logo.png");
  assert.equal(qrPageBrand({ logoUrl: "javascript:alert(1)", brandColor: null }), null);
  assert.equal(qrPageBrand({ logoUrl: "http://plain.example.com/logo.png", brandColor: "#1f3a8a" })?.logoUrl, null);
});
