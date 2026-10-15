import assert from "node:assert/strict";
import test from "node:test";
import { journalApiErrors } from "./journal-api-errors";
import { CleaningConfigError, normalizeCleaningDocumentConfig, validateCleaningDocumentConfig } from "./cleaning-document";

const request = (cookie = "uz") => new Request("https://wesetup.ru/api/journal-documents/example", {
  headers: { cookie: `wesetup.site-locale=${cookie}` },
});

test("journal errors use personal, active organization and anonymous preferences without leaking between requests", async () => {
  const cases = [
    { user: { locale: "en", organizationLocale: "ru" }, expected: "en" },
    { user: { locale: null, organizationLocale: "en" }, expected: "en" },
    { user: { locale: null, organizationLocale: "ru" }, expected: "ru" },
    { user: undefined, expected: "uz" },
    { user: { locale: "uz", organizationLocale: "en" }, expected: "uz" },
  ];
  await Promise.all(cases.map(async ({ user, expected }) => {
    const errors = await journalApiErrors(request(), user);
    const response = errors.response("DOCUMENT_NOT_FOUND");
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("Content-Language"), expected);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    const body = await response.json();
    assert.equal(body.code, "DOCUMENT_NOT_FOUND");
    assert.equal(body.error, { ru: "Не найдено", en: "Not found", uz: "Topilmadi" }[expected]);
  }));
});

test("commission conflicts keep compatibility codes and original row names, but localize full messages and plural forms", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const errors = await journalApiErrors(request(), { locale });
    for (const count of [1, 2, 5, 21, 25]) {
      const rows = Array.from({ length: count }, (_, i) => ({ productName: i === 0 ? "Авторское блюдо O‘tkir" : "" }));
      const before = structuredClone(rows);
      const response = errors.unsignedRows(rows);
      assert.equal(response.status, 409);
      const body = await response.json();
      assert.equal(body.code, "unsigned-rows");
      assert.deepEqual(body.params, { count });
      assert.equal(body.unsigned.length, Math.min(count, 20));
      assert.equal(body.unsigned[0], rows[0].productName);
      assert.ok(body.error.includes(String(count)));
      if (locale !== "ru") assert.doesNotMatch(body.error, /\p{Script=Cyrillic}/u);
      assert.deepEqual(rows, before);
    }
  }
});

test("cleaning validation adds stable failure codes without changing acceptance rules", () => {
  const config = normalizeCleaningDocumentConfig({ cleaningMode: "rooms", selectedRoomIds: [], rooms: [] });
  config.cleaningMode = "rooms";
  config.selectedRoomIds = [];
  config.rooms = [];
  assert.throws(() => validateCleaningDocumentConfig(config), (error: unknown) => {
    assert.ok(error instanceof CleaningConfigError);
    assert.equal(error.code, "CLEANING_ROOMS_REQUIRED");
    assert.ok(error.message.includes("selectedRoomIds"));
    return true;
  });
  config.selectedRoomIds = ["room-1"];
  config.selectedCleanerUserIds = [];
  config.cleaningResponsibles = [];
  config.cleanerByRoomId = {};
  assert.throws(() => validateCleaningDocumentConfig(config), (error: unknown) => {
    assert.ok(error instanceof CleaningConfigError);
    assert.equal(error.code, "CLEANING_STAFF_REQUIRED");
    return true;
  });
  config.cleanerByRoomId = { "room-1": ["user-1"] };
  assert.doesNotThrow(() => validateCleaningDocumentConfig(config));
});
