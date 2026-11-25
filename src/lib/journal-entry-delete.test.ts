import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { entryDeleteTarget } from "@/lib/journal-entry-delete";

/*
 * Удаление строк сетки руководителем (DELETE /api/journal-documents/[id]/entries):
 * одни и те же строки проверяются на закрытые дни и удаляются. Раньше при
 * { employeeId, date } проверка брала ВСЕ строки сотрудника (дата не входила в
 * условие) — одна старая закрытая строка в документе автоматики запрещала
 * удалить его строку за день в окне (проверка спецрежима, 2026-11-25).
 */

const DOC = "doc_1";

test("{ employeeId, date }: ровно строка сотрудника за этот день (полночь UTC)", () => {
  assert.deepEqual(entryDeleteTarget(DOC, { employeeId: "u1", date: "2026-11-24" }), {
    ok: true,
    where: { documentId: DOC, employeeId: "u1", date: new Date("2026-11-24T00:00:00.000Z") },
  });
  // Время внутри дня отбрасывается — как при записи.
  const target = entryDeleteTarget(DOC, { employeeId: "u1", date: "2026-11-24T15:30:00.000Z" });
  assert.equal(target.ok && target.where.date?.toISOString(), "2026-11-24T00:00:00.000Z");
});

test("{ ids }: ровно эти строки, сотрудник и дата не сужают и не расширяют выбор", () => {
  assert.deepEqual(entryDeleteTarget(DOC, { ids: ["a", "b"], employeeId: "u1", date: "2026-11-24" }), {
    ok: true,
    where: { documentId: DOC, id: { in: ["a", "b"] } },
  });
  // Не строки в списке не доходят до базы.
  assert.deepEqual(entryDeleteTarget(DOC, { ids: ["a", 5, null, ""] }), { ok: true, where: { documentId: DOC, id: { in: ["a"] } } });
});

test("{ employeeId } без даты — вся строка сотрудника, как раньше", () => {
  assert.deepEqual(entryDeleteTarget(DOC, { employeeId: "u1" }), { ok: true, where: { documentId: DOC, employeeId: "u1" } });
  // Пустой список ids — как без него.
  assert.deepEqual(entryDeleteTarget(DOC, { ids: [], employeeId: "u1" }), { ok: true, where: { documentId: DOC, employeeId: "u1" } });
});

test("неверная дата и пустой запрос — 400", () => {
  assert.deepEqual(entryDeleteTarget(DOC, { employeeId: "u1", date: "не дата" }), { ok: false, status: 400, error: "Некорректная дата" });
  assert.deepEqual(entryDeleteTarget(DOC, {}), { ok: false, status: 400, error: "Нужно передать ids либо employeeId и date" });
  assert.deepEqual(entryDeleteTarget(DOC, { date: "2026-11-24" }), { ok: false, status: 400, error: "Нужно передать ids либо employeeId и date" });
});

test("роут проверяет закрытые дни и удаляет одно и то же множество строк", () => {
  const route = readFileSync(path.join(process.cwd(), "src/app/api/journal-documents/[id]/entries/route.ts"), "utf8");
  const del = route.slice(route.indexOf("export async function DELETE"));
  assert.match(del, /const target = entryDeleteTarget\(documentId, body\);/);
  assert.match(del, /findMany\(\{\s*where: target\.where,/);
  assert.match(del, /deleteMany\(\{ where: target\.where \}\)/);
  assert.equal((del.match(/deleteMany\(/g) ?? []).length, 1, "одно удаление на все виды запроса");
});
