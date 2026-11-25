import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { PPK_APPROVE_ERROR_CODES, PPK_COMPARE_ERROR_CODES, PPK_DRAFT_ERROR_CODES, ppkErrorText } from "./api-errors";
import { pickCompareSides, readSnapshotWithRetry } from "./revisions";

/*
 * Мелочи после проверки ТЗ3 (2026-11-25):
 * V2 — сравнение читает текст только двух сравниваемых редакций;
 * V3 — текст утверждённой редакции соответствует её отпечатку, сбой чтения не глотается молча;
 * V5 — ошибки API сравнения и черновика переводятся по коду.
 */

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const rows = [
  { number: 5, contentHash: "h5" },
  { number: 3, contentHash: "h3" },
  { number: 1, contentHash: "h1" },
];

test("по умолчанию: изменён после утверждения — последняя ↔ текущий текст", () => {
  assert.deepEqual(pickCompareSides(rows, {}, { available: true, hash: "new" }), { ok: true, from: 5, to: { kind: "current" } });
});

test("по умолчанию: не изменён — предыдущая ↔ последняя; одна редакция — она ↔ текущий текст", () => {
  assert.deepEqual(pickCompareSides(rows, {}, { available: true, hash: "h5" }), { ok: true, from: 3, to: { kind: "revision", number: 5 } });
  assert.deepEqual(pickCompareSides(rows.slice(0, 1), {}, { available: true, hash: "h5" }), { ok: true, from: 5, to: { kind: "current" } });
  // Текста нет (документ удалён) — последняя с самой собой.
  assert.deepEqual(pickCompareSides(rows.slice(0, 1), {}, { available: false, hash: null }), { ok: true, from: 5, to: { kind: "revision", number: 5 } });
});

test("заданные стороны и их ошибки", () => {
  assert.deepEqual(pickCompareSides(rows, { from: 1, to: 3 }, { available: true, hash: "h5" }), { ok: true, from: 1, to: { kind: "revision", number: 3 } });
  assert.deepEqual(pickCompareSides(rows, { from: 3 }, { available: true, hash: "h5" }), { ok: true, from: 3, to: { kind: "current" } });
  assert.deepEqual(pickCompareSides(rows, { to: 3 }, { available: true, hash: "h5" }), { ok: true, from: 5, to: { kind: "revision", number: 3 } });
  assert.deepEqual(pickCompareSides(rows, { from: 2 }, { available: true, hash: "h5" }), { ok: false, code: "revision_not_found" });
  assert.deepEqual(pickCompareSides(rows, { from: 1, to: 4 }, { available: true, hash: "h5" }), { ok: false, code: "revision_not_found" });
  assert.deepEqual(pickCompareSides(rows, { from: 1, to: "current" }, { available: false, hash: null }), { ok: false, code: "no_current_text" });
});

test("сравнение читает текст только сравниваемых редакций", () => {
  const source = read("src/lib/ppk/revisions.server.ts");
  const compare = source.slice(source.indexOf("export async function compareRevisions"));
  const history = compare.slice(0, compare.indexOf("pickCompareSides("));
  assert.doesNotMatch(history, /content: true/, "история без текста редакций");
  assert.match(history, /content: \{ not: null \}/, "у каких редакций текст есть — отдельным лёгким запросом");
  assert.match(compare, /number: \{ in: needed \}/, "текст — только двух сторон");
});

test("чтение текста редакции: один повтор, затем лог — не молча", async () => {
  const logged: unknown[] = [];
  let calls = 0;
  assert.equal(await readSnapshotWithRetry(async () => (++calls, "text"), (error) => logged.push(error)), "text");
  assert.equal(calls, 1);
  calls = 0;
  const flaky = async () => {
    calls += 1;
    if (calls === 1) throw new Error("first");
    return "second";
  };
  assert.equal(await readSnapshotWithRetry(flaky, (error) => logged.push(error)), "second");
  assert.equal(logged.length, 0);
  const broken = async () => {
    throw new Error("down");
  };
  assert.equal(await readSnapshotWithRetry(broken, (error) => logged.push(error)), null);
  assert.equal(logged.length, 1);
  assert.equal((logged[0] as Error).message, "down");
});

test("утверждение: текст и отпечаток одной версии документа — иначе 409, ничего не сохраняется", () => {
  const source = read("src/lib/ppk/revisions.server.ts");
  const approve = source.slice(source.indexOf("export async function approveRevision"), source.indexOf("export type RegisterRow"));
  assert.match(approve, /readSnapshotWithRetry\(/);
  assert.doesNotMatch(approve, /\.catch\(\(\) => null\)/, "сбой чтения не глотается молча");
  const recheck = approve.indexOf("recheck");
  assert.ok(recheck > approve.indexOf("readSnapshotWithRetry(") && recheck < approve.indexOf("$transaction"), "отпечаток перечитывается после текста и до записи");
  assert.match(approve, /status: 409, error: "Документ изменился во время утверждения — утвердите ещё раз", code: "doc_changed"/);
});

test("тексты ошибок по коду: известный — перевод, неизвестный — текст сервера, без ответа — запасной", () => {
  const t = (key: string) => `T:${key}`;
  assert.equal(ppkErrorText({ error: "Редакция не найдена", code: "revision_not_found" }, PPK_COMPARE_ERROR_CODES, t, "fallback"), "T:revisionNotFound");
  assert.equal(ppkErrorText({ error: "Что-то новое", code: "something_new" }, PPK_COMPARE_ERROR_CODES, t, "fallback"), "Что-то новое");
  assert.equal(ppkErrorText({ error: "Нет доступа к разделу", code: "forbidden" }, PPK_DRAFT_ERROR_CODES, t, "fallback"), "T:forbidden");
  assert.equal(ppkErrorText(null, PPK_DRAFT_ERROR_CODES, t, "fallback"), "fallback");
});

test("каждый код ошибки есть в каталогах ru/en/uz", () => {
  const camel = (code: string) => code.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
  for (const locale of ["ru", "en", "uz"]) {
    const messages = JSON.parse(read(`src/i18n/messages/${locale}.json`));
    const compareErrors = messages.productionControl.revisions.compare.errors;
    const draftErrors = messages.productionControl.structure.text.draftErrors;
    const approveErrors = messages.productionControl.revisions.errors;
    for (const code of PPK_COMPARE_ERROR_CODES) assert.equal(typeof compareErrors?.[camel(code)], "string", `${locale} compare ${code}`);
    for (const code of PPK_DRAFT_ERROR_CODES) assert.equal(typeof draftErrors?.[camel(code)], "string", `${locale} draft ${code}`);
    for (const code of PPK_APPROVE_ERROR_CODES) assert.equal(typeof approveErrors?.[camel(code)], "string", `${locale} approve ${code}`);
  }
});

test("API и доступ ППК отдают код вместе с текстом; интерфейс переводит по коду", () => {
  const compareRoute = read("src/app/api/production-control/revisions/compare/route.ts");
  const draftRoute = read("src/app/api/production-control/text-docs/draft/route.ts");
  const access = read("src/lib/ppk/access.server.ts");
  const approveRoute = read("src/app/api/production-control/revisions/route.ts");
  const approveRoutePost = approveRoute.slice(approveRoute.indexOf("export async function POST"));
  for (const [name, source] of [["compare", compareRoute], ["draft", draftRoute], ["access", access], ["approve", approveRoutePost]] as const) {
    const errors = source.match(/NextResponse\.json\(\{ error[^}]*\}/g) ?? [];
    assert.ok(errors.length > 0, name);
    for (const response of errors) assert.match(response, /code/, `${name}: ${response}`);
  }
  assert.match(compareRoute, /code: result\.code/);
  assert.match(approveRoutePost, /code: result\.code/);
  // Ошибки утверждения на сервере — с кодом (документ не найден, пуст, изменился).
  const approve = read("src/lib/ppk/revisions.server.ts");
  const approveFn = approve.slice(approve.indexOf("export async function approveRevision"), approve.indexOf("export type RegisterRow"));
  for (const code of ["doc_not_found", "doc_empty", "doc_changed"]) assert.match(approveFn, new RegExp(`code: "${code}"`), code);
  assert.match(read("src/components/production-control/revision-control.tsx"), /ppkErrorText\(outcome\.body, PPK_APPROVE_ERROR_CODES/);
  assert.match(read("src/components/production-control/revision-compare.tsx"), /ppkErrorText\(body, PPK_COMPARE_ERROR_CODES/);
  assert.match(read("src/components/production-control/structure/panels/text-doc-editor.tsx"), /ppkErrorText\(body, PPK_DRAFT_ERROR_CODES/);
});
