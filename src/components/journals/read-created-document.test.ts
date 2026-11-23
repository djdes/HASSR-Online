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
