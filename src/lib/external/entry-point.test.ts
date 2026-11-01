import assert from "node:assert/strict";
import test from "node:test";

import { resolveExternalEntryPoint } from "./entry-point";

// Аудит 2026-11-01: внешний API писал строки сотрудников точки Б в самый
// свежий документ любой точки, без документа — создавал общий.

const targets = ["A", "B"];

test("точки выключены — без точки, как раньше", () => {
  assert.deepEqual(resolveExternalEntryPoint({ targets: [null], employees: [{ id: "u1", points: [null] }] }), {
    ok: true,
    pointId: null,
  });
});

test("сотрудник одной точки — её документ", () => {
  assert.deepEqual(resolveExternalEntryPoint({ targets, employees: [{ id: "cook-b", points: ["B"] }] }), {
    ok: true,
    pointId: "B",
  });
});

test("явная точка: своя организации и сотрудники на ней работают", () => {
  assert.deepEqual(
    resolveExternalEntryPoint({ targets, requested: "A", employees: [{ id: "any", points: ["A", "B"] }] }),
    { ok: true, pointId: "A" },
  );
  const foreign = resolveExternalEntryPoint({ targets, requested: "Z", employees: [] });
  assert.equal(foreign.ok, false);
  const outside = resolveExternalEntryPoint({ targets, requested: "A", employees: [{ id: "cook-b", points: ["B"] }] });
  assert.equal(outside.ok, false);
  assert.match((outside as { error: string }).error, /cook-b/);
});

test("сотрудники разных точек в одном запросе — ошибка, не угадываем", () => {
  const result = resolveExternalEntryPoint({
    targets,
    employees: [
      { id: "cook-a", points: ["A"] },
      { id: "cook-b", points: ["B"] },
    ],
  });
  assert.equal(result.ok, false);
});

test("сотрудник на всех точках — неоднозначно, кандидаты все точки", () => {
  assert.deepEqual(resolveExternalEntryPoint({ targets, employees: [{ id: "owner", points: ["A", "B"] }] }), {
    ok: true,
    pointId: null,
    ambiguous: true,
    candidates: ["A", "B"],
  });
  // С сотрудником точки А — точка А.
  assert.deepEqual(
    resolveExternalEntryPoint({
      targets,
      employees: [
        { id: "owner", points: ["A", "B"] },
        { id: "cook-a", points: ["A"] },
      ],
    }),
    { ok: true, pointId: "A" },
  );
});
