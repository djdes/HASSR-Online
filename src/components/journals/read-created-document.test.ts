import assert from "node:assert/strict";
import test from "node:test";

import { DuplicatePeriodError, PointRequiredError, readCreatedDocument } from "@/components/journals/use-document-dialog-submit";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("создан — id документа", async () => {
  assert.deepEqual(await readCreatedDocument(json(201, { document: { id: "d1" } })), { id: "d1" });
});

test("нет объекта (офис или вся организация) — PointRequiredError, а не «не удалось создать»", async () => {
  await assert.rejects(
    readCreatedDocument(json(400, { error: "Выберите объект", code: "point_required" })),
    (error: unknown) => error instanceof PointRequiredError,
  );
});

test("409 — развилка «за период уже есть документ», прочие ошибки — общий текст", async () => {
  await assert.rejects(
    readCreatedDocument(json(409, { existing: { id: "d0", title: "Март" } })),
    (error: unknown) => error instanceof DuplicatePeriodError && error.existing.id === "d0",
  );
  await assert.rejects(
    readCreatedDocument(json(500, { error: "boom" }), "Не удалось создать документ"),
    (error: unknown) => error instanceof Error && !(error instanceof PointRequiredError) && error.message === "Не удалось создать документ",
  );
});

/**
 * Проверка 2026-11-24 (AC4): журналы со своим экраном (жалобы, реестры,
 * протокол и отчёт аудита) и окна, которые разбирали ответ сами
 * (протокол аудита, металлопримеси, список стекла), при «Выберите объект»
 * писали «Ошибка создания документа» и не показывали плашку с объектами.
 */
test("окна журналов со своим экраном: ответ — через readCreatedDocument, «Выберите объект» — понятным текстом", async () => {
  const { readFileSync } = await import("node:fs");
  for (const file of [
    "src/components/journals/audit-protocol-documents-client.tsx",
    "src/components/journals/metal-impurity-documents-client.tsx",
    "src/components/journals/glass-list-documents-client.tsx",
    "src/components/journals/complaint-documents-client.tsx",
  ]) {
    const source = readFileSync(file, "utf8");
    const start = source.search(/fetch\("\/api\/journal-documents", \{\s*method: "POST"/);
    assert.ok(start >= 0, file);
    const create = source.slice(start);
    assert.match(create, /readCreatedDocument\(response/, file);
    assert.doesNotMatch(create.slice(0, 1500), /throw new Error\(result\?\.error/, file);
  }
  const complaint = readFileSync("src/components/journals/complaint-documents-client.tsx", "utf8");
  assert.match(complaint, /error instanceof PointRequiredError/);
  assert.match(complaint, /pointRequired/);
});

test("плашка «Документ журнала создаётся для объекта» — у всех журналов со списком документов", async () => {
  const { readFileSync } = await import("node:fs");
  const page = readFileSync("src/app/(dashboard)/journals/[code]/page.tsx", "utf8");
  assert.match(page, /pointChoice && hasDocumentFillUi\(resolvedCode\) \? \(\s*<JournalPointNotice/);
});

test("окна создания отчёта аудита, уборки, прослеживаемости и скан-журналов: «Выберите объект…», а не молчание или общий текст", async () => {
  const { readFileSync } = await import("node:fs");
  for (const file of [
    "src/components/journals/audit-report-documents-client.tsx",
    "src/components/journals/cleaning-documents-client.tsx",
    "src/components/journals/traceability-documents-client.tsx",
    "src/components/journals/scan-journal-documents-client.tsx",
  ]) {
    const source = readFileSync(file, "utf8");
    const start = source.search(/"\/api\/journal-documents"[\s\S]{0,120}method: (documentId \? "PATCH" : )?"POST"/);
    assert.ok(start >= 0, file);
    // Путь создания: общий разбор ответа или явный PointRequiredError.
    assert.match(source.slice(start, start + 2000), /readCreatedDocument\(|new PointRequiredError\(/, file);
  }
  // Отчёт аудита и скан-журналы глотали ошибку: у кнопки не было catch.
  const report = readFileSync("src/components/journals/audit-report-documents-client.tsx", "utf8");
  assert.match(report, /await onSubmit\(state\);\s*onOpenChange\(false\);\s*\} catch/);
  const scan = readFileSync("src/components/journals/scan-journal-documents-client.tsx", "utf8");
  const handleCreate = scan.slice(scan.indexOf("async function handleCreate"), scan.indexOf("async function handleDelete"));
  assert.match(handleCreate, /catch \(error\)/);
});
