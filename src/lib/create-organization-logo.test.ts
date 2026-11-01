import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Фирменный стиль у каждой организации свой (владелец, 2026-11-01: «если
 * подгрузить лого и цвета, меняется во всех организациях»). Новая
 * организация «как текущая» получала адрес файла логотипа донора — общий
 * файл. Теперь копируется сам файл (своя копия и свой адрес).
 */
const source = readFileSync("src/lib/create-organization.ts", "utf8");

test("адрес загруженного логотипа донора не копируется", () => {
  assert.doesNotMatch(source, /logoUrl:\s*donor\.logoUrl,/);
  assert.match(source, /logoUrl:\s*orgLogoAssetOwner\(donor\.logoUrl\)\s*\?\s*null\s*:\s*donor\.logoUrl/);
});

test("файл логотипа донора копируется новой организации", () => {
  assert.match(source, /copyOrgLogo\(logoOwner, organization\.id\)/);
});
