import test from "node:test";
import assert from "node:assert/strict";

import { orgLogoAssetOwner, orgLogoUrl, prepareOrgLogo } from "./org-logo-file";

const PNG_1x1 = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

test("адрес логотипа организации меняется с версией — браузер не держит старый", () => {
  assert.equal(orgLogoUrl("org_1", 3), "/api/org-assets/org_1/logo?v=3");
});

test("PNG принимается как есть", () => {
  const result = prepareOrgLogo(PNG_1x1, "image/png");
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.mime, "image/png");
    assert.equal(result.bytes.length, PNG_1x1.length);
  }
});

test("SVG со скриптом не принимается, чистый SVG — принимается", () => {
  const bad = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script><rect width="10" height="10"/></svg>';
  const rejected = prepareOrgLogo(new TextEncoder().encode(bad), "image/svg+xml");
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.match(rejected.error, /script/);

  const good = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
  const accepted = prepareOrgLogo(new TextEncoder().encode(good), "image/svg+xml");
  assert.equal(accepted.ok, true);
  if (accepted.ok) {
    const text = new TextDecoder().decode(accepted.bytes);
    assert.equal(accepted.mime, "image/svg+xml");
    assert.ok(text.startsWith("<svg"), text);
  }
});

test("не картинка — понятная ошибка", () => {
  const result = prepareOrgLogo(new TextEncoder().encode("%PDF-1.4"), "application/pdf");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /PNG/);
});

test("чей файл логотипа стоит по адресу: свой, чужой, внешняя ссылка", () => {
  assert.equal(orgLogoAssetOwner("/api/org-assets/org_1/logo?v=3"), "org_1");
  assert.equal(orgLogoAssetOwner("/api/org-assets/org_2/logo"), "org_2");
  assert.equal(orgLogoAssetOwner("https://example.com/logo.png"), null);
  assert.equal(orgLogoAssetOwner("/api/org-assets/org_1/icon?v=1"), null);
  assert.equal(orgLogoAssetOwner(null), null);
  assert.equal(orgLogoAssetOwner(""), null);
});
