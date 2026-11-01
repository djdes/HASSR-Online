import assert from "node:assert/strict";
import test from "node:test";

import {
  INSPECTOR_ORG_LINK_FORBIDDEN,
  INSPECTOR_POINT_NOT_FOUND,
  inspectorDocumentVisible,
  inspectorDocumentWhere,
  inspectorEntryWhere,
  inspectorTokenVisible,
  inspectorTokensWhere,
  resolveInspectorIssuePoint,
} from "./inspector-point";
import { BUILDING_OUT_OF_SCOPE_ERROR } from "./point-scope";

const ORG = ["office", "A", "B"];
const base = { pointsEnabled: true, orgBuildingIds: ORG, viewedPointId: null as string | null, pointScope: null as string[] | null };

test("выпуск ссылки: по умолчанию — точка из шапки, в «Вся организация» — вся организация", () => {
  assert.deepEqual(resolveInspectorIssuePoint({ ...base, requested: undefined, viewedPointId: "A" }), { ok: true, buildingId: "A" });
  assert.deepEqual(resolveInspectorIssuePoint({ ...base, requested: undefined }), { ok: true, buildingId: null });
  // Точка из шапки не этой организации — как «вся организация».
  assert.deepEqual(resolveInspectorIssuePoint({ ...base, requested: undefined, viewedPointId: "foreign" }), { ok: true, buildingId: null });
});

test("выпуск ссылки: руководство на всю компанию выбирает любую точку или всю организацию", () => {
  assert.deepEqual(resolveInspectorIssuePoint({ ...base, requested: "B", viewedPointId: "A" }), { ok: true, buildingId: "B" });
  assert.deepEqual(resolveInspectorIssuePoint({ ...base, requested: null, viewedPointId: "A" }), { ok: true, buildingId: null });
  assert.deepEqual(resolveInspectorIssuePoint({ ...base, requested: "foreign" }), { ok: false, status: 400, error: INSPECTOR_POINT_NOT_FOUND });
});

test("выпуск ссылки: руководитель точки — только своя точка, на всю организацию нельзя", () => {
  const scoped = { ...base, pointScope: ["A"] };
  assert.deepEqual(resolveInspectorIssuePoint({ ...scoped, requested: undefined }), { ok: true, buildingId: "A" });
  assert.deepEqual(resolveInspectorIssuePoint({ ...scoped, requested: undefined, viewedPointId: "B" }), { ok: true, buildingId: "A" });
  assert.deepEqual(resolveInspectorIssuePoint({ ...scoped, requested: "A" }), { ok: true, buildingId: "A" });
  assert.deepEqual(resolveInspectorIssuePoint({ ...scoped, requested: "B" }), { ok: false, status: 403, error: BUILDING_OUT_OF_SCOPE_ERROR });
  assert.deepEqual(resolveInspectorIssuePoint({ ...scoped, requested: null }), { ok: false, status: 403, error: INSPECTOR_ORG_LINK_FORBIDDEN });
  // Две точки — по умолчанию точка из шапки, если она его.
  assert.deepEqual(
    resolveInspectorIssuePoint({ ...base, pointScope: ["A", "B"], requested: undefined, viewedPointId: "B" }),
    { ok: true, buildingId: "B" },
  );
});

test("выпуск ссылки: точки выключены — всегда вся организация", () => {
  const off = { ...base, pointsEnabled: false, orgBuildingIds: [] };
  assert.deepEqual(resolveInspectorIssuePoint({ ...off, requested: undefined, viewedPointId: "A" }), { ok: true, buildingId: null });
  assert.deepEqual(resolveInspectorIssuePoint({ ...off, requested: "A" }), { ok: true, buildingId: null });
});

test("список и отзыв ссылок: руководитель точки — только ссылки своих точек", () => {
  assert.deepEqual(inspectorTokensWhere(null), {});
  assert.deepEqual(inspectorTokensWhere(["A"]), { buildingId: { in: ["A"] } });
  assert.equal(inspectorTokenVisible(null, null), true);
  assert.equal(inspectorTokenVisible(null, "B"), true);
  assert.equal(inspectorTokenVisible(["A"], "A"), true);
  assert.equal(inspectorTokenVisible(["A"], "B"), false);
  assert.equal(inspectorTokenVisible(["A"], null), false, "ссылка на всю организацию — не руководителю точки");
});

test("портал: ссылка на точку видит документы точки и общие, на организацию — все", () => {
  assert.equal(inspectorDocumentVisible(null, "B"), true);
  assert.equal(inspectorDocumentVisible("A", "A"), true);
  assert.equal(inspectorDocumentVisible("A", null), true);
  assert.equal(inspectorDocumentVisible("A", "B"), false);
  assert.deepEqual(inspectorDocumentWhere(null), {});
  assert.deepEqual(inspectorDocumentWhere("A"), { OR: [{ buildingId: "A" }, { buildingId: null }] });
  assert.deepEqual(inspectorEntryWhere(null), {});
  assert.ok("OR" in inspectorEntryWhere("A"));
});
