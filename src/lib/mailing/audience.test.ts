import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_USER_FILTERS,
  contactWhere,
  filterAudienceUsers,
  mskDayToDate,
  normalizeContactFilters,
  normalizeUserFilters,
  userMarketingEmail,
  type AudienceUserRow,
} from "@/lib/mailing/audience";

function row(over: Partial<AudienceUserRow>): AudienceUserRow {
  return {
    id: over.id ?? "u",
    name: "Иван Петров",
    email: "ivan@mail.ru",
    isManagement: true,
    organizationId: "org1",
    organizationName: "Кафе «Ромашка»",
    sphere: "cafe",
    billing: "legacy",
    hasTelegram: false,
    webPushCount: 0,
    appDeviceCount: 0,
    createdAt: "2026-09-10T09:00:00.000Z",
    marketingOptOut: false,
    suppressed: false,
    ...over,
  };
}

const rows: AudienceUserRow[] = [
  row({ id: "boss-cafe", createdAt: "2026-09-20T09:00:00.000Z" }),
  row({ id: "cook-cafe", isManagement: false, name: "Повар Пётр", email: null }),
  row({ id: "boss-bar", sphere: "bar", organizationName: "Бар «Ёлка»", billing: "paid", hasTelegram: true }),
  row({ id: "boss-school", sphere: "education", billing: "needs_decision", webPushCount: 1 }),
  row({ id: "boss-bakery", sphere: "bakery", billing: "free", appDeviceCount: 2, createdAt: "2026-08-31T20:59:00.000Z" }),
];

const ids = (list: AudienceUserRow[]) => list.map((r) => r.id).sort();

describe("фильтры пользователей", () => {
  it("по умолчанию — только руководители", () => {
    assert.equal(DEFAULT_USER_FILTERS.role, "managers");
    assert.deepEqual(ids(filterAudienceUsers(rows, DEFAULT_USER_FILTERS)), [
      "boss-bakery",
      "boss-bar",
      "boss-cafe",
      "boss-school",
    ]);
    assert.equal(filterAudienceUsers(rows, { ...DEFAULT_USER_FILTERS, role: "all" }).length, 5);
  });

  it("сфера и состояние тарифа", () => {
    assert.deepEqual(ids(filterAudienceUsers(rows, { ...DEFAULT_USER_FILTERS, sphere: "bar" })), ["boss-bar"]);
    assert.deepEqual(ids(filterAudienceUsers(rows, { ...DEFAULT_USER_FILTERS, billing: "needs_decision" })), [
      "boss-school",
    ]);
    assert.deepEqual(ids(filterAudienceUsers(rows, { ...DEFAULT_USER_FILTERS, billing: "free" })), ["boss-bakery"]);
  });

  it("поиск по организации, имени и почте без учёта регистра и «ё»", () => {
    assert.deepEqual(ids(filterAudienceUsers(rows, { ...DEFAULT_USER_FILTERS, search: "елка" })), ["boss-bar"]);
    assert.deepEqual(
      ids(filterAudienceUsers(rows, { ...DEFAULT_USER_FILTERS, role: "all", search: "ПОВАР" })),
      ["cook-cafe"]
    );
  });

  it("есть почта / Telegram / устройство для push", () => {
    assert.deepEqual(
      ids(filterAudienceUsers(rows, { ...DEFAULT_USER_FILTERS, role: "all", hasEmail: true })).includes("cook-cafe"),
      false
    );
    assert.deepEqual(ids(filterAudienceUsers(rows, { ...DEFAULT_USER_FILTERS, hasTelegram: true })), ["boss-bar"]);
    assert.deepEqual(ids(filterAudienceUsers(rows, { ...DEFAULT_USER_FILTERS, hasPush: true })), [
      "boss-bakery",
      "boss-school",
    ]);
  });

  it("дата регистрации — границы дня по Москве", () => {
    // 2026-08-31T20:59Z — это 31.08 23:59 МСК: в «с 01.09» не входит.
    const september = filterAudienceUsers(rows, { ...DEFAULT_USER_FILTERS, registeredFrom: "2026-09-01" });
    assert.equal(ids(september).includes("boss-bakery"), false);
    const lastOfAugust = filterAudienceUsers(rows, {
      ...DEFAULT_USER_FILTERS,
      registeredFrom: "2026-08-31",
      registeredTo: "2026-08-31",
    });
    assert.deepEqual(ids(lastOfAugust), ["boss-bakery"]);
    assert.equal(mskDayToDate("2026-09-01").toISOString(), "2026-08-31T21:00:00.000Z");
  });

  it("свежие регистрации сверху", () => {
    assert.equal(filterAudienceUsers(rows, DEFAULT_USER_FILTERS)[0].id, "boss-cafe");
  });

  it("мусор в query — значения по умолчанию", () => {
    const f = normalizeUserFilters({ role: "root", sphere: "космос", billing: "gold", hasEmail: "1", registeredFrom: "вчера" });
    assert.equal(f.role, "managers");
    assert.equal(f.sphere, "any");
    assert.equal(f.billing, "any");
    assert.equal(f.hasEmail, true);
    assert.equal(f.registeredFrom, null);
  });
});

describe("адрес для рассылки пользователя", () => {
  it("служебный синтетический адрес не используется", () => {
    assert.equal(userMarketingEmail({ email: "staff-ab12@cmf1.local.haccp" }), null);
    assert.equal(userMarketingEmail({ email: "79991234567@cmf1.staff.local" }), null);
  });
  it("контактная почта важнее логина", () => {
    assert.equal(userMarketingEmail({ email: "login@mail.ru", contactEmail: "Boss@Cafe.RU" }), "boss@cafe.ru");
    assert.equal(userMarketingEmail({ email: "Login@Mail.ru", contactEmail: null }), "login@mail.ru");
  });
});

describe("фильтры контактов", () => {
  it("условие выборки из фильтров", () => {
    const f = normalizeContactFilters({ sphere: "none", tag: "VIP", status: "active", source: "2ГИС", search: "ром" });
    const where = contactWhere(f) as { AND: Record<string, unknown>[] };
    assert.deepEqual(where.AND.slice(0, 4), [
      { status: "active" },
      { sphere: null },
      { tags: { has: "vip" } },
      { source: "2ГИС" },
    ]);
    assert.ok(where.AND[4].OR);
    assert.deepEqual(contactWhere(normalizeContactFilters({})), {});
  });
});
