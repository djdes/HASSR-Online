import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { db } from "@/lib/db";
import { resolveNormApprovals, resolveNormTitles } from "@/lib/inspection-norms";
import { countMedBooks, medBookStatus, summarizeChecklistResult } from "@/lib/inspector-portal-extras";
import { loadInspectorChecklistResults, loadInspectorMedBookCounts } from "@/lib/inspector-portal-extras.server";
import { NORM_CATALOG } from "@/lib/ppk/norm-catalog";

/**
 * Состав портала проверяющего (AC6, AC8): медкнижки — только два числа без
 * ФИО (152-ФЗ), итоги чек-листов — название, дата и балл без проверявших,
 * перечень норм — отмеченные заведением или рекомендуемые.
 */

const original = {
  users: db.user.findMany,
  certs: db.staffCompetency.findMany,
  inspections: db.checklistInspection.findMany,
  inspectionCount: db.checklistInspection.count,
};

afterEach(() => {
  db.user.findMany = original.users;
  db.staffCompetency.findMany = original.certs;
  db.checklistInspection.findMany = original.inspections;
  db.checklistInspection.count = original.inspectionCount;
});

const NOW = new Date("2026-10-17T12:00:00Z");

test("медкнижка: те же статусы, что у виджета кабинета", () => {
  assert.equal(medBookStatus(null, false, NOW), "missing");
  assert.equal(medBookStatus(null, true, NOW), "no_expiry");
  assert.equal(medBookStatus(new Date("2026-10-01"), true, NOW), "expired");
  assert.equal(medBookStatus(new Date("2026-11-01"), true, NOW), "warning");
  assert.equal(medBookStatus(new Date("2027-06-01"), true, NOW), "ok");
});

test("медкнижки для проверяющего: «действуют» и «просрочены», по самой поздней записи сотрудника", () => {
  const counts = countMedBooks(
    ["u1", "u2", "u3", "u4", "u5", "u1"],
    [
      { userId: "u1", expiresAt: new Date("2027-01-01") }, // действует
      { userId: "u2", expiresAt: new Date("2026-01-01") }, // старая просрочена…
      { userId: "u2", expiresAt: new Date("2026-11-01") }, // …но новая действует (истекает скоро)
      { userId: "u3", expiresAt: new Date("2026-09-01") }, // просрочена
      { userId: "u4", expiresAt: null }, // без срока — не считается
      { userId: "gone", expiresAt: new Date("2027-01-01") }, // уволен — не считается
    ],
    NOW
  );
  assert.deepEqual(counts, { valid: 2, expired: 1 });
});

test("медкнижки из БД: выбираются только id и сроки, наружу — только два числа", async () => {
  const selects: unknown[] = [];
  db.user.findMany = (async (args: { select: unknown }) => {
    selects.push(args.select);
    return [{ id: "u1" }, { id: "u2" }];
  }) as unknown as typeof db.user.findMany;
  db.staffCompetency.findMany = (async (args: { select: unknown }) => {
    selects.push(args.select);
    return [
      { userId: "u1", expiresAt: new Date("2027-01-01") },
      { userId: "u2", expiresAt: new Date("2026-01-01") },
    ];
  }) as unknown as typeof db.staffCompetency.findMany;

  const counts = await loadInspectorMedBookCounts("org-a", NOW);
  assert.deepEqual(counts, { valid: 1, expired: 1 });
  assert.deepEqual(Object.keys(counts).sort(), ["expired", "valid"]);
  assert.deepEqual(selects, [{ id: true }, { userId: true, expiresAt: true }]);
  assert.doesNotMatch(JSON.stringify(counts), /u1|u2/);
});

test("итог проверки по чек-листу: балл, нарушения, критические; обнуление и битый итог", () => {
  const question = { questionId: "q", title: "Санобработка" };
  assert.deepEqual(
    summarizeChecklistResult({ score: { earned: 18, possible: 20 }, violations: [question], critical: [], stopped: false, zeroScore: false }),
    { earned: 18, possible: 20, percent: 90, violations: 1, critical: 0, stopped: false }
  );
  assert.equal(
    summarizeChecklistResult({ score: { earned: 12, possible: 20 }, violations: [question], critical: [question], stopped: true, zeroScore: true })?.percent,
    0
  );
  assert.equal(summarizeChecklistResult({ score: { earned: 0, possible: 0 }, violations: [], critical: [] })?.percent, null);
  assert.equal(summarizeChecklistResult(null), null);
  assert.equal(summarizeChecklistResult({ score: { earned: "x", possible: 3 } }), null);
});

test("итоги чек-листов из БД: только завершённые за период и без ФИО проверявших", async () => {
  let where: Record<string, unknown> | null = null;
  let select: Record<string, unknown> | null = null;
  db.checklistInspection.findMany = (async (args: { where: Record<string, unknown>; select: Record<string, unknown> }) => {
    where = args.where;
    select = args.select;
    return [
      {
        id: "c1",
        title: "Обход кухни",
        completedAt: new Date("2026-10-10T08:00:00Z"),
        result: { score: { earned: 9, possible: 10 }, violations: [{}], critical: [], stopped: false },
      },
    ];
  }) as unknown as typeof db.checklistInspection.findMany;
  db.checklistInspection.count = (async () => 1) as unknown as typeof db.checklistInspection.count;

  const result = await loadInspectorChecklistResults("org-a", "2026-10-01", "2026-10-17");
  assert.equal(result.total, 1);
  assert.deepEqual(result.rows, [
    {
      id: "c1",
      title: "Обход кухни",
      completedAt: "2026-10-10T08:00:00.000Z",
      summary: { earned: 9, possible: 10, percent: 90, violations: 1, critical: 0, stopped: false },
    },
  ]);
  assert.deepEqual(select, { id: true, title: true, completedAt: true, result: true });
  assert.equal((where as unknown as { organizationId: string }).organizationId, "org-a");
  assert.equal((where as unknown as { status: string }).status, "completed");
});

test("перечень норм: отмеченные заведением, иначе — рекомендуемые из каталога", () => {
  const first = NORM_CATALOG[0];
  const own = resolveNormTitles({ selected: [first.id], custom: [{ title: "Внутренний стандарт сети" }] });
  assert.deepEqual(own, { norms: [first.title, "Внутренний стандарт сети"], source: "org" });

  const fallback = resolveNormTitles(null);
  assert.equal(fallback.source, "recommended");
  assert.deepEqual(fallback.norms, NORM_CATALOG.filter((doc) => doc.recommended).map((doc) => doc.title));
  assert.ok(fallback.norms.length > 0);
  assert.equal(resolveNormTitles({ selected: [], custom: [] }).source, "recommended");
});

test("утверждения ППК и ХАССП-плана: номер и дата последней версии, без того, кто утвердил", () => {
  const approvals = resolveNormApprovals([
    { doc: "ppk", version: 1, approvedAt: "2026-01-10", approvedById: "user-1", note: "" },
    { doc: "ppk", version: 2, approvedAt: "2026-09-01", approvedById: "user-2", note: "новая редакция" },
  ]);
  assert.deepEqual(approvals, { ppk: { version: 2, approvedAt: "2026-09-01" }, "haccp-plan": null });
});
