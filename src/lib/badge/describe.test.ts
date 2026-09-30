import assert from "node:assert/strict";
import test from "node:test";

import { badgePreviewDataUrl, describeBadge } from "./describe";

test("бейдж включён: ссылки для вставки и живой пример с процентом", () => {
  const d = describeBadge({ badgeEnabled: true, badgeCode: "abcdefghjk" }, 93);
  assert.equal(d.enabled, true);
  assert.equal(d.code, "abcdefghjk");
  assert.match(d.publicUrl ?? "", /\/b\/abcdefghjk$/);
  assert.match(d.imageUrl ?? "", /\/b\/abcdefghjk\/badge\.svg$/);
  assert.match(d.embedHtml ?? "", /<a href="[^"]+\/b\/abcdefghjk"[^>]*><img src="[^"]+\/b\/abcdefghjk\/badge\.svg"/);
  assert.equal(d.percent, 93);
  assert.ok(d.previewSvgDataUrl.startsWith("data:image/svg+xml"));
  assert.match(decodeURIComponent(d.previewSvgDataUrl), /93% за 30 дней/);
});

test("бейдж выключен, код заведён заранее: ссылки видны как предпросмотр, но бейдж не включён", () => {
  const d = describeBadge({ badgeEnabled: false, badgeCode: "abcdefghjk" }, 40);
  assert.equal(d.enabled, false);
  assert.equal(d.code, "abcdefghjk");
  assert.ok(d.embedHtml);
  assert.match(decodeURIComponent(d.previewSvgDataUrl), /40% за 30 дней/);
});

test("кода ещё нет: ни ссылок, ни «включён», пример — «нет данных» без процента", () => {
  const d = describeBadge({ badgeEnabled: true, badgeCode: null }, null);
  assert.equal(d.enabled, false);
  assert.equal(d.publicUrl, null);
  assert.equal(d.embedHtml, null);
  assert.match(decodeURIComponent(badgePreviewDataUrl(null)), /нет данных/);
});
