import assert from "node:assert/strict";
import test from "node:test";
import type { ApiCallContext } from "../context";
import { DB_TEST_SKIP, createDbFixture } from "../db-test-fixtures";

test("инструменты публичного API на живой базе", { skip: DB_TEST_SKIP }, async (t) => {
  const { findTool } = await import("./index");
  const { runTool } = await import("../run-tool");
  const { orgTodayKey } = await import("@/lib/timezone");
  const { translatorFor } = await import("@/i18n/translator");
  const fx = await createDbFixture();
  try {
    const org = await fx.makeOrg();
    const other = await fx.makeOrg("Чужое кафе");
    // Оплаченная организация: на бесплатном тарифе после пробного периода второго сотрудника не добавить.
    await fx.db.organization.update({ where: { id: org.id }, data: { subscriptionEnd: new Date(Date.now() + 30 * 86_400_000) } });
    const manager = await fx.makeUser(org.id, { role: "manager", name: "Руководитель Тест" });
    const position = await fx.db.jobPosition.create({
      data: { organizationId: org.id, categoryKey: "staff", name: "Повар" },
      select: { id: true },
    });
    const anna = await fx.makeUser(org.id, { role: "cook", name: "Иванова Анна", jobPositionId: position.id });
    const petr = await fx.makeUser(org.id, { role: "cook", name: "Петров Пётр", jobPositionId: position.id });

    const ctx: ApiCallContext = {
      keyId: "test-key",
      keyName: "Тестовый ключ",
      access: "write",
      via: "mcp",
      orgId: org.id,
      orgName: org.name,
      timezone: "Europe/Moscow",
      actor: { id: manager.id, role: "manager", isRoot: false, name: manager.name },
      locale: "ru",
      baseUrl: "https://wesetup.ru",
    };
    const today = orgTodayKey("Europe/Moscow");
    const day = new Date(`${today}T00:00:00.000Z`);
    const monthStart = new Date(`${today.slice(0, 8)}01T00:00:00.000Z`);
    const monthEnd = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0));
    const templates = await fx.db.journalTemplate.findMany({
      where: { code: { in: ["hygiene", "cleaning", "fryer_oil"] } },
      select: { id: true, code: true },
    });
    const templateId = (code: string) => {
      const found = templates.find((tpl) => tpl.code === code);
      if (!found) throw new Error(`в базе нет шаблона ${code} — запустите prisma/seed.ts`);
      return found.id;
    };
    async function makeDoc(organizationId: string, code: string, extra: Record<string, unknown> = {}) {
      return fx.db.journalDocument.create({
        data: { organizationId, templateId: templateId(code), title: `Документ ${code}`, dateFrom: monthStart, dateTo: monthEnd, ...extra },
        select: { id: true },
      });
    }
    const call = (name: string, args: unknown) => runTool(findTool(name)!, args, ctx);

    const hygieneDoc = await makeDoc(org.id, "hygiene");
    const foreignDoc = await makeDoc(other.id, "hygiene");

    await t.test("list_journals не показывает журнал, выключенный в disabledJournalCodes", async () => {
      await fx.db.organization.update({ where: { id: org.id }, data: { disabledJournalCodes: ["fryer_oil"] } });
      const res = await call("list_journals", {});
      assert.equal(res.ok, true);
      if (!res.ok) return;
      const codes = (res.data.journals as Array<{ code: string }>).map((j) => j.code);
      assert.ok(codes.includes("hygiene"));
      assert.equal(codes.includes("fryer_oil"), false);
    });

    await t.test("list_journals не показывает документ другой организации", async () => {
      const res = await call("list_journals", {});
      assert.equal(res.ok, true);
      if (!res.ok) return;
      const hygiene = (res.data.journals as Array<{ code: string; documents: Array<{ id: string }> }>).find((j) => j.code === "hygiene")!;
      const ids = hygiene.documents.map((d) => d.id);
      assert.ok(ids.includes(hygieneDoc.id));
      assert.equal(ids.includes(foreignDoc.id), false);
    });

    await t.test("get_journal_document с documentId другой организации → 404", async () => {
      const res = await call("get_journal_document", { documentId: foreignDoc.id });
      assert.equal(res.ok ? 200 : res.status, 404);
    });

    await t.test("get_journal_document журнала-конфига с config длиннее 30 000 символов → configTruncated", async () => {
      const big = await makeDoc(org.id, "cleaning", { config: { notes: "x".repeat(40_000) } });
      const res = await call("get_journal_document", { documentId: big.id });
      assert.equal(res.ok, true);
      if (!res.ok) return;
      assert.equal(res.data.configTruncated, true);
      assert.equal("config" in res.data, false);
    });

    await t.test("fill_journal_cells: закрытый документ → 422 с текстом assistantActions.documentClosed", async () => {
      const closed = await makeDoc(org.id, "hygiene", { status: "closed" });
      const tr = await translatorFor("ru");
      const res = await call("fill_journal_cells", {
        documentId: closed.id,
        employeeIds: [anna.id],
        dates: [today],
        values: { kind: "status", status: "sick_leave" },
      });
      assert.deepEqual(res.ok ? null : [res.status, res.error], [422, tr("assistantActions.documentClosed")]);
    });

    await t.test("fill_journal_cells: журнал-конфиг → 422 со ссылкой на документ", async () => {
      const cleaning = await makeDoc(org.id, "cleaning");
      const res = await call("fill_journal_cells", {
        documentId: cleaning.id,
        employeeIds: [anna.id],
        dates: [today],
        values: { kind: "data", data: { done: true } },
      });
      assert.equal(res.ok ? 200 : res.status, 422);
      assert.match(res.ok ? "" : res.error, new RegExp(`/journals/cleaning/documents/${cleaning.id}`));
    });

    await t.test("fill_journal_cells через runTool: sick_leave на 2 сотрудника × 1 день → 2 ячейки и одна строка аудита", async () => {
      const res = await call("fill_journal_cells", {
        documentId: hygieneDoc.id,
        employeeIds: [anna.id, petr.id],
        dates: [today],
        values: { kind: "status", status: "sick_leave" },
      });
      assert.equal(res.ok, true, res.ok ? "" : res.error);
      const cells = await fx.db.journalDocumentEntry.findMany({ where: { documentId: hygieneDoc.id, date: day } });
      assert.equal(cells.length, 2);
      const audit = await fx.db.auditLog.findMany({ where: { organizationId: org.id, action: "public_api.call" } });
      assert.equal(audit.length, 1);
      assert.equal(audit[0].entity, "fill_journal_cells");
      assert.equal((audit[0].details as { keyName?: string }).keyName, "Тестовый ключ");
    });

    await t.test("add_employee: дубль ФИО и должности → 409; с allowDuplicate → создан", async () => {
      const dup = await call("add_employee", { fullName: "  иванова   анна ", jobPositionId: position.id });
      assert.equal(dup.ok ? 200 : dup.status, 409);
      const created = await call("add_employee", { fullName: "Иванова Анна", jobPositionId: position.id, allowDuplicate: true });
      assert.equal(created.ok, true, created.ok ? "" : created.error);
      if (!created.ok) return;
      const id = (created.data.employee as { id: string }).id;
      const row = await fx.db.user.findUnique({ where: { id }, select: { organizationId: true, name: true } });
      assert.deepEqual(row, { organizationId: org.id, name: "Иванова Анна" });
      // Созданные сотрудники получают синтетическую почту — убираем их вместе с организацией.
    });

    await t.test("list_employees: query «иван» находит «Иванова Анна»", async () => {
      const res = await call("list_employees", { query: "иван" });
      assert.equal(res.ok, true);
      if (!res.ok) return;
      const names = (res.data.employees as Array<{ name: string }>).map((e) => e.name);
      assert.ok(names.includes("Иванова Анна"));
      assert.equal(names.includes("Петров Пётр"), false);
      assert.ok((res.data.positions as Array<{ id: string }>).some((p) => p.id === position.id));
    });
  } finally {
    await fx.cleanup();
  }
});
