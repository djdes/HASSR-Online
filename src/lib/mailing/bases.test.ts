import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AudienceUserRow } from "@/lib/mailing/audience";
import {
  clientBases,
  clientSegment,
  contactBaseId,
  contactBaseSource,
  normalizeBaseIds,
  userEmailable,
} from "@/lib/mailing/bases";

/** Базы адресов простого режима «Рассылки»: сегменты клиентов и загруженные базы. */

const now = new Date("2026-10-22T12:00:00.000Z");

function row(over: Partial<AudienceUserRow>): AudienceUserRow {
  return {
    id: "u1",
    name: "Иван",
    email: "ivan@cafe.ru",
    isManagement: true,
    organizationId: "o1",
    organizationName: "Кафе",
    sphere: "cafe",
    billing: "free",
    hasTelegram: false,
    webPushCount: 0,
    appDeviceCount: 0,
    createdAt: "2026-01-10T10:00:00.000Z",
    marketingOptOut: false,
    suppressed: false,
    ...over,
  };
}

describe("сегменты клиентов", () => {
  const rows = [
    row({ id: "free", billing: "free" }),
    row({ id: "period", billing: "free_period" }),
    row({ id: "decide", billing: "needs_decision" }),
    row({ id: "paid", billing: "paid" }),
    row({ id: "exempt", billing: "exempt" }),
    row({ id: "cook", billing: "free", isManagement: false }),
    row({ id: "fresh", billing: "paid", createdAt: "2026-10-01T10:00:00.000Z" }),
    row({ id: "old", billing: "paid", createdAt: "2026-09-20T10:00:00.000Z" }),
  ];
  const ids = (segmentId: string) => rows.filter((r) => clientSegment(segmentId)!.match(r, now)).map((r) => r.id);

  it("«Все клиенты» — только руководители", () => {
    assert.deepEqual(ids("clients:managers"), ["free", "period", "decide", "paid", "exempt", "fresh", "old"]);
  });

  it("«Ещё не платят» — бесплатный тариф, бесплатный период, решают про оплату", () => {
    assert.deepEqual(ids("clients:not-paid"), ["free", "period", "decide"]);
  });

  it("«Платящие» и «Новые за 30 дней»", () => {
    assert.deepEqual(ids("clients:paid"), ["paid", "fresh", "old"]);
    assert.deepEqual(ids("clients:new-30"), ["fresh"]);
  });

  it("числа: всего и сколько получат письмо (без стоп-листа, отписки и пустой почты)", () => {
    const base = clientBases(
      [row({ id: "a" }), row({ id: "b", suppressed: true }), row({ id: "c", marketingOptOut: true }), row({ id: "d", email: null })],
      now
    ).find((b) => b.id === "clients:managers");
    assert.equal(base?.total, 4);
    assert.equal(base?.emailable, 1);
    assert.equal(userEmailable(row({})), true);
  });
});

describe("id баз", () => {
  it("загруженная база — по «Источнику»", () => {
    assert.equal(contactBaseId("Кафе Москвы, октябрь"), "contacts:Кафе Москвы, октябрь");
    assert.equal(contactBaseSource("contacts:Кафе Москвы, октябрь"), "Кафе Москвы, октябрь");
    assert.equal(contactBaseSource("contacts:"), null);
    assert.equal(contactBaseSource("clients:paid"), null);
  });

  it("из запроса — только знакомые сегменты и contacts:…, без повторов", () => {
    assert.deepEqual(
      normalizeBaseIds(["clients:paid", "clients:paid", "clients:hack", "contacts:2ГИС", 5, "users:all", "contacts:"]),
      ["clients:paid", "contacts:2ГИС"]
    );
    assert.deepEqual(normalizeBaseIds("clients:paid"), []);
  });
});
