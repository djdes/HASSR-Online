import assert from "node:assert/strict";
import test from "node:test";

import { formatPositionWithName } from "@/lib/position-name-label";

test("должность и имя — через разделитель", () => {
  assert.equal(formatPositionWithName("Управляющий", "Иванова И.И."), "Управляющий: Иванова И.И.");
  assert.equal(
    formatPositionWithName("Управляющий", "Иванова И.И.", { separator: ", " }),
    "Управляющий, Иванова И.И."
  );
});

test("имени нет — должность без висящего двоеточия", () => {
  // Было «Ответственный: Управляющий:» с пустотой после двоеточия.
  assert.equal(formatPositionWithName("Управляющий", ""), "Управляющий");
  assert.equal(formatPositionWithName("Управляющий", "   "), "Управляющий");
  assert.equal(formatPositionWithName("Управляющий", null, { separator: ", " }), "Управляющий");
});

test("должности нет — только имя", () => {
  assert.equal(formatPositionWithName("", "Иванова И.И."), "Иванова И.И.");
});

test("пусто — пустая строка или заданная заглушка", () => {
  assert.equal(formatPositionWithName("", ""), "");
  assert.equal(formatPositionWithName(undefined, undefined, { emptyValue: "—" }), "—");
});
