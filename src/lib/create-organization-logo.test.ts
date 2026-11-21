import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Фирменный стиль у каждой организации свой (владелец, 2026-11-21: «во всех
 * организациях в фирменном стиле отображается доброе кафе»). Новая
 * организация «как текущая» раньше получала логотип донора (с 2026-11-01 —
 * копию файла) и его цвет, хотя галочка обещает только должности и набор
 * журналов. Теперь от донора — должности, набор журналов и язык; логотип,
 * цвета, сайт и значок QR новая организация задаёт себе сама.
 */
const source = readFileSync("src/lib/create-organization.ts", "utf8");
const createStart = source.indexOf("db.organization.create(");
const createCall = source.slice(createStart, source.indexOf("select: { id: true },", createStart));
const donorStart = source.indexOf("db.organization.findUnique(");
const donorSelect = source.slice(donorStart, source.indexOf(": null;", donorStart));

test("от донора не берётся ни логотип, ни цвета, ни сайт, ни значок QR", () => {
  assert.ok(createStart > 0 && donorStart > 0, "createOrganization reads the donor and creates the row");
  for (const field of ["logoUrl", "brandColor", "website", "qrIconUrl"]) {
    assert.doesNotMatch(donorSelect, new RegExp(`\\b${field}\\b`), `donor select: ${field}`);
    assert.doesNotMatch(createCall, new RegExp(`\\b${field}\\b`), `organization.create: ${field}`);
  }
  // Файл логотипа донора тоже не копируется.
  assert.doesNotMatch(source, /copyOrgLogo|organizationLogo/);
});

test("от донора по-прежнему копируются должности, набор журналов и язык", () => {
  assert.match(createCall, /disabledJournalCodes:\s*donor\s*\?\s*\(donor\.disabledJournalCodes/);
  assert.match(createCall, /autoJournalCodes:\s*donor\.autoJournalCodes/);
  assert.match(createCall, /locale:\s*donor\.locale/);
  assert.match(source, /await copyPositions\(donor\.id, organization\.id\)/);
});
