import assert from "node:assert/strict";
import test from "node:test";

import type { PrismaClient } from "@prisma/client";
import { ensureActiveDocument } from "./journal-auto-create";

/**
 * Баг: управляющая отправила документ месяца в «Закрытые», а
 * `ensureActiveDocument` искал только активный. Кнопка «Закрыть день»,
 * ночной крон и массовое создание заводили на ТОТ ЖЕ период второй
 * документ и начинали его заполнять — в журнале оказывалось два бланка
 * за один месяц.
 *
 * Теперь закрытый документ на пересекающийся период останавливает
 * создание: `created: false`, `reason: "period-closed"`, а в
 * `documentId` — тот самый закрытый документ, чтобы вызывающий мог
 * объяснить человеку, что вернуть в активные.
 */
const NOW = new Date("2026-09-19T09:00:00.000Z");

type DocRow = {
  id: string;
  status: string;
  dateFrom: Date;
  dateTo: Date;
};

function fakeDb(docs: DocRow[]) {
  const calls = { creates: 0 };
  const db = {
    journalTemplate: {
      findFirst: async () => ({ id: "t1", name: "Гигиенический журнал" }),
    },
    organization: {
      findUnique: async () => ({
        journalPeriods: null,
        journalAutomationJson: null,
        autoJournalCodes: null,
      }),
    },
    journalDocument: {
      findFirst: async (args: { where: { status?: string } }) => {
        const status = args.where.status;
        return docs.find((doc) => doc.status === status) ?? null;
      },
      create: async () => {
        calls.creates += 1;
        throw new Error("создание не ожидалось в этом сценарии");
      },
    },
  } as unknown as PrismaClient;
  return { db, calls };
}

const period = (from: string, to: string, status: string, id: string): DocRow => ({
  id,
  status,
  dateFrom: new Date(`${from}T00:00:00.000Z`),
  dateTo: new Date(`${to}T00:00:00.000Z`),
});

test("закрытый документ на тот же период — новый не создаём", async () => {
  const { db, calls } = fakeDb([
    period("2026-09-16", "2026-09-30", "closed", "closed-1"),
  ]);

  const report = await ensureActiveDocument(db, {
    organizationId: "org-1",
    templateCode: "hygiene",
    now: NOW,
  });

  assert.equal(calls.creates, 0);
  assert.equal(report.created, false);
  assert.equal(report.reason, "period-closed");
  // documentId указывает на закрытый документ — вызывающему есть что
  // показать в сообщении «верните журнал в активные».
  assert.equal(report.documentId, "closed-1");
});

test("активный документ периода по-прежнему важнее закрытого", async () => {
  const { db, calls } = fakeDb([
    period("2026-09-16", "2026-09-30", "active", "active-1"),
    period("2026-09-16", "2026-09-30", "closed", "closed-1"),
  ]);

  const report = await ensureActiveDocument(db, {
    organizationId: "org-1",
    templateCode: "hygiene",
    now: NOW,
  });

  assert.equal(calls.creates, 0);
  assert.equal(report.reason, "already-active");
  assert.equal(report.documentId, "active-1");
});

test("закрытый документ ПРОШЛОГО периода созданию не мешает", async () => {
  // Запрос на пересечение отсекает такие документы на уровне БД —
  // фейк повторяет поведение: пересечения нет, значит findFirst не
  // должен их возвращать. Здесь просто убеждаемся, что код доходит до
  // создания (и падает на нашем стабе create).
  const { db } = fakeDb([]);

  await assert.rejects(
    ensureActiveDocument(db, {
      organizationId: "org-1",
      templateCode: "hygiene",
      now: NOW,
    })
  );
});
