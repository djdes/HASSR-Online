import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PrismaClient } from "@prisma/client";
import { restoreBrokenChainForTemplate, type TemplateDocumentGroup } from "@/lib/journal-auto-create";

/**
 * Одна цепочка «шаблон × точка» — общее правило ночного крона и QR-скана
 * первого дня периода. Здесь — ветки решений и замок; само создание
 * документа покрыто тестами `ensureActiveDocument`.
 */
const NOW = new Date("2026-10-01T09:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const TEMPLATE = { id: "t-hyg", code: "hygiene", name: "Гигиенический журнал" };

function fakeDb(options: { locked?: boolean; groups?: TemplateDocumentGroup[] } = {}) {
  const calls = { lockKeys: [] as string[], templateLookups: 0, groupBy: 0 };
  const db = {
    journalDocument: {
      groupBy: async () => {
        calls.groupBy += 1;
        return options.groups ?? [];
      },
    },
    organization: { findUnique: async () => ({ journalPeriods: null }) },
    // ensureActiveDocument под замком: шаблона «нет» — дальше не идём.
    journalTemplate: {
      findFirst: async () => {
        calls.templateLookups += 1;
        return null;
      },
    },
    async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      return fn({
        $queryRaw: async (_strings: TemplateStringsArray, key: string) => {
          calls.lockKeys.push(key);
          return [{ locked: options.locked !== false }];
        },
      });
    },
  } as unknown as PrismaClient;
  return { db, calls };
}

const group = (buildingId: string | null, dateTo: Date): TemplateDocumentGroup => ({ buildingId, _max: { dateTo } });

describe("restoreBrokenChainForTemplate", () => {
  it("документов не было никогда — не создаём", async () => {
    const { db, calls } = fakeDb({ groups: [] });
    const report = await restoreBrokenChainForTemplate(db, { organizationId: "o", template: TEMPLATE, buildingId: null, now: NOW });
    assert.equal(report.created, false);
    assert.equal(report.reason, "no-previous-document");
    assert.equal(calls.lockKeys.length, 0);
  });

  it("документ, покрывающий сегодня (даже закрытый), — цепочка цела", async () => {
    const { db, calls } = fakeDb({ groups: [group(null, new Date("2026-10-15T00:00:00.000Z"))] });
    const report = await restoreBrokenChainForTemplate(db, { organizationId: "o", template: TEMPLATE, buildingId: null, now: NOW });
    assert.equal(report.reason, "has-current-document");
    assert.equal(calls.lockKeys.length, 0);
  });

  it("точки: общий документ покрывает точку, документ другой точки — нет", async () => {
    const current = new Date(NOW.getTime() + 5 * DAY);
    const shared = fakeDb({ groups: [group(null, current)] });
    assert.equal(
      (await restoreBrokenChainForTemplate(shared.db, { organizationId: "o", template: TEMPLATE, buildingId: "b1", now: NOW })).reason,
      "has-current-document"
    );
    const other = fakeDb({ groups: [group("b2", current), group("b1", new Date(NOW.getTime() - 3 * DAY))] });
    const report = await restoreBrokenChainForTemplate(other.db, { organizationId: "o", template: TEMPLATE, buildingId: "b1", now: NOW });
    assert.notEqual(report.reason, "has-current-document");
    assert.deepEqual(other.calls.lockKeys, ["journal-period:o:hygiene:b1"]);
  });

  it("perpetual — только руками", async () => {
    const { db, calls } = fakeDb({ groups: [group(null, new Date(NOW.getTime() - 400 * DAY))] });
    const report = await restoreBrokenChainForTemplate(db, {
      organizationId: "o",
      template: { id: "t-dis", code: "disinfectant_usage", name: "Дезсредства" },
      buildingId: null,
      now: NOW,
    });
    assert.equal(report.reason, "perpetual-manual-only");
    assert.equal(calls.lockKeys.length, 0);
  });

  it("прерванная цепочка — создание под замком «журнал × точка»", async () => {
    const { db, calls } = fakeDb({ groups: [group(null, new Date("2026-09-30T00:00:00.000Z"))] });
    const report = await restoreBrokenChainForTemplate(db, { organizationId: "o", template: TEMPLATE, buildingId: null, now: NOW });
    assert.deepEqual(calls.lockKeys, ["journal-period:o:hygiene:-"]);
    // Под замком отработал ensureActiveDocument (фейк: шаблона нет).
    assert.equal(calls.templateLookups, 1);
    assert.equal(report.created, false);
    assert.equal(report.reason, "template-not-found");
  });

  it("группы переданы кроном — повторно не читаем", async () => {
    const { db, calls } = fakeDb();
    await restoreBrokenChainForTemplate(db, {
      organizationId: "o",
      template: TEMPLATE,
      buildingId: null,
      now: NOW,
      groups: [group(null, new Date(NOW.getTime() + DAY))],
    });
    assert.equal(calls.groupBy, 0);
  });
});
