import assert from "node:assert/strict";
import test from "node:test";

import {
  ORG_PROFILE_FIELDS,
  parseOrganizationProfilePatch,
  type OrgProfileField,
} from "@/lib/organization-profile-patch";
import { ORG_JOURNAL_NAME_MAX } from "@/lib/org-journal-name";

test("сокращённое название: пробелы схлопываются, длина ограничена", () => {
  const parsed = parseOrganizationProfilePatch({ journalShortName: "  Кафе   у дома " }, ORG_PROFILE_FIELDS);
  assert.deepEqual(parsed, { ok: true, data: { journalShortName: "Кафе у дома" } });

  const long = parseOrganizationProfilePatch({ journalShortName: "К".repeat(300) }, ORG_PROFILE_FIELDS);
  assert.ok(long.ok);
  assert.equal((long.data.journalShortName as string).length, ORG_JOURNAL_NAME_MAX);
});

test("пустое сокращённое название очищается в null (шапка берёт ЕГРЮЛ или полное)", () => {
  for (const value of ["", "   ", null]) {
    const parsed = parseOrganizationProfilePatch({ journalShortName: value }, ORG_PROFILE_FIELDS);
    assert.deepEqual(parsed, { ok: true, data: { journalShortName: null } });
  }
});

test("поле не из списка разрешённых не попадает в запись", () => {
  const allowed: OrgProfileField[] = ["name"];
  const parsed = parseOrganizationProfilePatch({ name: "Кафе", journalShortName: "Кафе" }, allowed);
  assert.deepEqual(parsed, { ok: true, data: { name: "Кафе" } });
});

test("пустое основное название по-прежнему запрещено", () => {
  const parsed = parseOrganizationProfilePatch({ name: " ", journalShortName: "Кафе" }, ORG_PROFILE_FIELDS);
  assert.equal(parsed.ok, false);
});

test("логотип: принимается и внешний адрес, и загруженный файл кабинета", () => {
  const external = parseOrganizationProfilePatch({ logoUrl: "https://cdn.example.com/logo.png" }, ORG_PROFILE_FIELDS);
  assert.deepEqual(external, { ok: true, data: { logoUrl: "https://cdn.example.com/logo.png" } });

  const uploaded = parseOrganizationProfilePatch({ logoUrl: "/api/org-assets/org_123/logo?v=4" }, ORG_PROFILE_FIELDS);
  assert.deepEqual(uploaded, { ok: true, data: { logoUrl: "/api/org-assets/org_123/logo?v=4" } });

  const foreign = parseOrganizationProfilePatch({ logoUrl: "/api/other/x" }, ORG_PROFILE_FIELDS);
  assert.equal(foreign.ok, false);
});
