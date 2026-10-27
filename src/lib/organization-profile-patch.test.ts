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

test("правки реквизитов поверх ЕГРЮЛ: пусто — очистить правку (null), формат КПП и ОГРН проверяется", () => {
  const parsed = parseOrganizationProfilePatch(
    {
      legalFullName: "  Общество с ограниченной   ответственностью «Ромашка» ",
      kpp: "7701 01 001",
      ogrn: "1027700132195",
      legalAddress: "109012, г Москва, ул Ильинка, д 4",
      directorName: "Петров Пётр Петрович",
      directorPost: "",
    },
    ORG_PROFILE_FIELDS,
  );
  assert.deepEqual(parsed, {
    ok: true,
    data: {
      legalFullName: "Общество с ограниченной ответственностью «Ромашка»",
      legalAddress: "109012, г Москва, ул Ильинка, д 4",
      directorName: "Петров Пётр Петрович",
      directorPost: null,
      kpp: "770101001",
      ogrn: "1027700132195",
    },
  });

  // КПП с буквами причины постановки (с 2019 г.) и ОГРНИП из 15 цифр.
  assert.deepEqual(parseOrganizationProfilePatch({ kpp: "7701ab001", ogrn: "321774600000012" }, ORG_PROFILE_FIELDS), {
    ok: true,
    data: { kpp: "7701AB001", ogrn: "321774600000012" },
  });
  // Пустые — очистка правки.
  assert.deepEqual(parseOrganizationProfilePatch({ kpp: "", ogrn: " " }, ORG_PROFILE_FIELDS), {
    ok: true,
    data: { kpp: null, ogrn: null },
  });

  const bad = parseOrganizationProfilePatch({ kpp: "12345", ogrn: "123" }, ORG_PROFILE_FIELDS);
  assert.deepEqual(bad, { ok: false, error: "КПП — 9 знаков, например 770101001; ОГРН — 13 цифр, ОГРНИП — 15 цифр" });

  // Консультант партнёра этих полей не правит: их нет в его списке.
  const partner = parseOrganizationProfilePatch({ name: "Кафе", kpp: "770101001" }, ["name"]);
  assert.deepEqual(partner, { ok: true, data: { name: "Кафе" } });
});

test("фирменный стиль: цвета, сайт и переключатели QR", () => {
  const parsed = parseOrganizationProfilePatch(
    { brandColor2: " #112233 ", brandColor3: "", website: "https://www.Dobroe-Kafe.ru/", qrBrandFrame: false, qrCenterLogo: true },
    ORG_PROFILE_FIELDS,
  );
  assert.deepEqual(parsed, {
    ok: true,
    data: { brandColor2: "#112233", brandColor3: null, website: "dobroe-kafe.ru", qrBrandFrame: false, qrCenterLogo: true },
  });

  assert.deepEqual(parseOrganizationProfilePatch({ website: "  " }, ORG_PROFILE_FIELDS), { ok: true, data: { website: null } });
  assert.equal(parseOrganizationProfilePatch({ website: "кафе" }, ORG_PROFILE_FIELDS).ok, false);
  assert.equal(parseOrganizationProfilePatch({ brandColor2: "красный" }, ORG_PROFILE_FIELDS).ok, false);
});
