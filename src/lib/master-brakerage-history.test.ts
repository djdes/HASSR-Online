import assert from "node:assert/strict";
import test from "node:test";

import { batchReachedObject, objectsMissingBatch } from "@/lib/master-brakerage-history";

const ORG = "cmtwy9jft00uw3vts08st15c3";
const sent = (point: string, extra: Record<string, unknown> = {}) => ({
  organizationId: ORG,
  targetId: `${ORG}:${point}`,
  organizationName: point,
  documentId: `doc-${point}`,
  added: 18,
  ...extra,
});

test("objectsMissingBatch: точки, подключённые после выгрузки, ещё не получили её", () => {
  // Случай «Садов» 03.11.2026: выгрузка 30.10 ушла в 2 сада, ещё 5 подключили 02.11.
  const pool = ["d68", "d71", "d72", "d80", "d82", "d83", "d84"].map((point) => ({ id: `${ORG}:${point}`, name: point }));
  const recipients = [sent("d68"), sent("d82")];
  assert.deepEqual(objectsMissingBatch(pool, recipients).map((object) => object.name), ["d71", "d72", "d80", "d83", "d84"]);
});

test("batchReachedObject: ошибка или пустой документ — не получил; всё уже было — получил", () => {
  assert.equal(batchReachedObject([sent("a", { added: 0, error: "закрыт", documentId: null })], `${ORG}:a`), false);
  assert.equal(batchReachedObject([sent("a", { added: 0, skipped: 18 })], `${ORG}:a`), true);
  assert.equal(batchReachedObject([sent("a")], `${ORG}:b`), false);
});

test("batchReachedObject: старая выгрузка без targetId засчитывается по организации", () => {
  const legacy = { organizationId: ORG, organizationName: "МАУ", documentId: "doc", added: 5 };
  assert.equal(batchReachedObject([legacy], `${ORG}:d71`), true);
  assert.equal(batchReachedObject([legacy], ORG), true);
  assert.equal(batchReachedObject([legacy], "other-org"), false);
});
