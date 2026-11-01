import assert from "node:assert/strict";
import test from "node:test";

import type { PrismaClient } from "@prisma/client";
import { ensureCurrentDocumentsForBrokenChains } from "./journal-auto-create";

/**
 * Прод-баг (Q3-6): за ночь cron закрыл 32 просроченных документа и создал
 * 0 новых. Причина — создание шло только по `Organization.autoJournalCodes`,
 * поэтому журнал с прерванной цепочкой (последний документ истёк,
 * преемника нет) оставался пустым навсегда.
 *
 * Здесь проверяем ветку решений: какие шаблоны функция ПРОПУСКАЕТ.
 * Именно она даёт идемпотентность — повторный вызов в тот же день
 * не должен плодить второй документ на текущий период.
 */
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-08-14T09:00:00.000Z");

type Group = { templateId: string; _max: { dateTo: Date | null } };
type Template = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};

function fakeDb(groups: Group[], templates: Template[]) {
  const calls = { creates: 0 };
  const db = {
    journalDocument: {
      groupBy: async () => groups,
      create: async () => {
        calls.creates += 1;
        throw new Error("создание не ожидалось в этом сценарии");
      },
    },
    journalTemplate: {
      findMany: async () => templates,
    },
    organization: {
      findUnique: async () => ({ journalPeriods: null }),
    },
  } as unknown as PrismaClient;
  return { db, calls };
}

test("документ, покрывающий сегодня, пропускается — повторный запуск идемпотентен", async () => {
  const { db, calls } = fakeDb(
    [{ templateId: "t1", _max: { dateTo: new Date(NOW.getTime() + 5 * DAY) } }],
    [{ id: "t1", code: "hygiene", name: "Гигиенический журнал", isActive: true }]
  );

  const reports = await ensureCurrentDocumentsForBrokenChains(db, {
    organizationId: "org-1",
    now: NOW,
  });

  assert.equal(calls.creates, 0);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].created, false);
  assert.equal(reports[0].reason, "has-current-document");
});

test("документ, заканчивающийся сегодня, ещё считается текущим", async () => {
  // dateTo хранится как начало UTC-дня, поэтому сравнение идёт с
  // началом сегодняшнего дня, а не с «сейчас» — иначе утренний запуск
  // cron'а создал бы дубль поверх документа, живущего до конца дня.
  const { db } = fakeDb(
    [{ templateId: "t1", _max: { dateTo: new Date("2026-08-14T00:00:00.000Z") } }],
    [{ id: "t1", code: "hygiene", name: "Гигиенический журнал", isActive: true }]
  );

  const reports = await ensureCurrentDocumentsForBrokenChains(db, {
    organizationId: "org-1",
    now: NOW,
  });

  assert.equal(reports[0].reason, "has-current-document");
});

test("perpetual-журнал не воскрешаем — его закрывают только руками", async () => {
  const { db, calls } = fakeDb(
    [{ templateId: "t2", _max: { dateTo: new Date(NOW.getTime() - 400 * DAY) } }],
    [
      {
        id: "t2",
        code: "disinfectant_usage",
        name: "Журнал учёта дезсредств",
        isActive: true,
      },
    ]
  );

  const reports = await ensureCurrentDocumentsForBrokenChains(db, {
    organizationId: "org-1",
    now: NOW,
  });

  assert.equal(calls.creates, 0);
  assert.equal(reports[0].reason, "perpetual-manual-only");
});

test("выключенный шаблон не попадает в отчёт вообще", async () => {
  const { db, calls } = fakeDb(
    [{ templateId: "t3", _max: { dateTo: new Date(NOW.getTime() - 90 * DAY) } }],
    [{ id: "t3", code: "hygiene", name: "Гигиенический журнал", isActive: false }]
  );

  const reports = await ensureCurrentDocumentsForBrokenChains(db, {
    organizationId: "org-1",
    now: NOW,
  });

  assert.equal(calls.creates, 0);
  assert.deepEqual(reports, []);
});

test("организация без единого документа не трогается", async () => {
  const { db } = fakeDb([], []);

  const reports = await ensureCurrentDocumentsForBrokenChains(db, {
    organizationId: "org-empty",
    now: NOW,
  });

  assert.deepEqual(reports, []);
});

test("точки: журнал, выключенный на точке, ей не возвращается", async () => {
  const { db, calls } = fakeDb(
    [{ templateId: "t4", buildingId: null, _max: { dateTo: new Date(NOW.getTime() + 5 * DAY) } } as Group],
    [{ id: "t4", code: "hygiene", name: "Гигиенический журнал", isActive: true }]
  );

  const reports = await ensureCurrentDocumentsForBrokenChains(db, {
    organizationId: "org-1",
    now: NOW,
    buildingIds: ["a", "b"],
    skipCodes: new Set(),
    skipCodesByBuilding: new Map([["b", new Set(["hygiene"])]]),
  });

  assert.equal(calls.creates, 0);
  assert.deepEqual(
    reports.map((report) => report.reason),
    ["has-current-document", "journal-disabled"]
  );
});
