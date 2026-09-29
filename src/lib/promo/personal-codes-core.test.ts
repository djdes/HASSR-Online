import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createPersonalPromoCodesWith,
  PromoCodeConflictError,
  promoLinkStatusWith,
  readPromoForOfferWith,
  type PersonalCodeOptions,
  type PersonalCodeRow,
  type PersonalCodeStore,
} from "@/lib/promo/personal-codes-core";
import type { PromoRule } from "@/lib/promo/rules";

const now = new Date("2026-10-01T09:00:00.000Z");
const OPTIONS: PersonalCodeOptions = {
  kind: "percent",
  value: 10,
  lifetime: true,
  endsAt: new Date("2026-12-31T20:59:59.999Z"),
  note: "КП октябрь",
  campaignId: "kp-2026-10",
};

function memoryStore(existing: string[] = [], failOnce = false) {
  const codes = new Set(existing);
  const transactions: PersonalCodeRow[][] = [];
  let fail = failOnce;
  const store: PersonalCodeStore = {
    async existingCodes(list) {
      return new Set(list.filter((code) => codes.has(code)));
    },
    async createAll(rows) {
      if (fail) {
        // Кто-то успел занять код между проверкой и записью.
        fail = false;
        for (const row of rows) codes.add(row.code);
        throw new PromoCodeConflictError();
      }
      transactions.push(rows);
      for (const row of rows) codes.add(row.code);
      return rows.map((row, i) => ({ id: `pc${transactions.length}_${i}`, code: row.code }));
    },
  };
  return { store, transactions };
}

describe("createPersonalPromoCodes — массовая выдача", () => {
  it("один запрос — один активный персональный код; всё одной транзакцией", async () => {
    const env = memoryStore();
    const result = await createPersonalPromoCodesWith(
      env.store,
      [
        { key: "lead-1", email: "Owner@Romashka.RU", companyName: "ООО «Ромашка»" },
        { key: "lead-2", email: null, organizationId: "org_lavka", companyName: "Лавка" },
      ],
      OPTIONS,
      { now }
    );
    assert.equal(env.transactions.length, 1);
    assert.equal(result.get("lead-1")?.code, "ROMASHKA10");
    assert.equal(result.get("lead-2")?.code, "LAVKA10");
    const [rom, lavka] = env.transactions[0];
    assert.equal(rom.personalEmail, "owner@romashka.ru");
    assert.equal(rom.organizationId, null);
    assert.equal(lavka.personalEmail, null);
    assert.equal(lavka.organizationId, "org_lavka");
    for (const row of env.transactions[0]) {
      assert.equal(row.active, true);
      assert.equal(row.lifetime, true);
      assert.equal(row.maxUses, 1);
      assert.equal(row.newClientsOnly, false);
      assert.equal(row.campaignId, "kp-2026-10");
      assert.equal(row.endsAt?.toISOString(), "2026-12-31T20:59:59.999Z");
    }
    assert.equal(rom.note, "КП октябрь · ООО «Ромашка»");
  });

  it("уникальность: одинаковые названия в пачке и занятый в базе код получают суффикс", async () => {
    const env = memoryStore(["ROMASHKA10"]);
    const result = await createPersonalPromoCodesWith(
      env.store,
      [
        { key: "a", email: "a@romashka.ru", companyName: "Ромашка" },
        { key: "b", email: "b@romashka.ru", companyName: "Кафе «Ромашка»" },
        { key: "c", email: "c@romashka.ru", companyName: "Ромашка" },
      ],
      OPTIONS,
      { now }
    );
    const codes = ["a", "b", "c"].map((key) => result.get(key)?.code);
    assert.deepEqual(codes, ["ROMASHKA10-2", "ROMASHKA10-3", "ROMASHKA10-4"]);
    assert.equal(new Set(codes).size, 3);
  });

  it("гонка с другим создателем — повтор с новыми вариантами, коды не пересекаются", async () => {
    const env = memoryStore([], true);
    const result = await createPersonalPromoCodesWith(env.store, [{ key: "a", email: "a@b.ru", companyName: "Ромашка" }], OPTIONS, { now });
    assert.equal(env.transactions.length, 1);
    assert.notEqual(result.get("a")?.code, "ROMASHKA10");
    assert.match(result.get("a")?.code ?? "", /^ROMASHKA10-\d+$/);
  });

  it("без названия — случайный код; пустой список — пустой ответ без записи", async () => {
    const env = memoryStore();
    const result = await createPersonalPromoCodesWith(env.store, [{ key: "x", email: "x@y.ru" }], { ...OPTIONS, value: 15 }, { now, random: () => 0 });
    assert.match(result.get("x")?.code ?? "", /^KP[2-9A-HJKMNP-Z]{4}15$/);
    const empty = await createPersonalPromoCodesWith(env.store, [], OPTIONS, { now });
    assert.equal(empty.size, 0);
    assert.equal(env.transactions.length, 1);
  });

  it("ошибки входа — исключение, ничего не создаётся", async () => {
    const env = memoryStore();
    const bad: Array<[Parameters<typeof createPersonalPromoCodesWith>[1], PersonalCodeOptions, RegExp]> = [
      [[{ key: "a", email: null }], OPTIONS, /neither email nor organizationId/],
      [[{ key: "a", email: "a@b.ru" }, { key: "a", email: "c@d.ru" }], OPTIONS, /duplicate request key/],
      [[{ key: "a", email: "not-an-email" }], OPTIONS, /bad email/],
      [[{ key: "a", email: "a@b.ru" }], { ...OPTIONS, value: 150 }, /percent value/],
      [[{ key: "a", email: "a@b.ru" }], { ...OPTIONS, value: 0 }, /positive integer/],
      [[{ key: "a", email: "a@b.ru" }], { ...OPTIONS, endsAt: new Date("2026-09-01") }, /endsAt is in the past/],
    ];
    for (const [requests, options, message] of bad) {
      await assert.rejects(createPersonalPromoCodesWith(env.store, requests, options, { now }), message);
    }
    assert.equal(env.transactions.length, 0);
  });
});

describe("readPromoForOffer / promoLinkStatus", () => {
  const rule = (partial: Partial<PromoRule & { lifetime: boolean }>): PromoRule & { lifetime: boolean } => ({
    code: "ROMASHKA10",
    kind: "percent",
    value: 10,
    active: true,
    startsAt: null,
    endsAt: new Date("2026-12-31T20:59:59.999Z"),
    maxUses: 1,
    newClientsOnly: false,
    lifetime: true,
    personalEmail: "owner@romashka.ru",
    ...partial,
  });
  const deps = (row: (PromoRule & { lifetime: boolean }) | null, uses = 0) => ({
    findCode: async (code: string) => (row && row.code === code ? row : null),
    countCodeUses: async () => uses,
  });

  it("действующий код — данные для текста предложения (кому выдан, не важно)", async () => {
    assert.deepEqual(await readPromoForOfferWith(deps(rule({})), "romashka10", now), {
      code: "ROMASHKA10",
      kind: "percent",
      value: 10,
      lifetime: true,
      endsAt: new Date("2026-12-31T20:59:59.999Z"),
    });
  });

  it("нет / выключен / истёк / исчерпан / ещё не начался — null и причина для страницы ссылки", async () => {
    const cases: Array<[ReturnType<typeof deps>, string]> = [
      [deps(null), "not-found"],
      [deps(rule({ active: false })), "inactive"],
      [deps(rule({ endsAt: new Date("2026-09-01") })), "expired"],
      [deps(rule({}), 1), "exhausted"],
      [deps(rule({ startsAt: new Date("2026-11-01") })), "not-started"],
    ];
    for (const [d, reason] of cases) {
      assert.equal(await readPromoForOfferWith(d, "ROMASHKA10", now), null);
      const status = await promoLinkStatusWith(d, "ROMASHKA10", now);
      assert.equal(status.ok, false);
      assert.equal(!status.ok && status.reason, reason);
    }
    const exhausted = await promoLinkStatusWith(deps(rule({}), 1), "ROMASHKA10", now);
    assert.equal(!exhausted.ok && exhausted.lifetime, true);
  });
});
