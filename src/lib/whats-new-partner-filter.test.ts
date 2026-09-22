import assert from "node:assert/strict";
import test from "node:test";

import { notesWithoutPartnerProgram } from "./whats-new-notes";

test("клиент скрытого консультанта не видит заметок о партнёрской программе", () => {
  const notes = notesWithoutPartnerProgram([
    { category: "Партнёры", items: ["Партнёрская программа: 20 % с платежей"] },
    { category: "Журналы", items: ["Новый журнал", "Консультант видит ваш кабинет"] },
    { category: "Партнёрство", items: ["Иконка программы"] },
    "Вознаграждение за клиентов",
    "Тёмная тема",
  ]);
  assert.deepEqual(notes, [{ category: "Журналы", items: ["Новый журнал"] }, "Тёмная тема"]);
});

test("реальные заметки без партнёрской программы — не пустые и без её слов", () => {
  const notes = notesWithoutPartnerProgram();
  assert.ok(notes.length > 0);
  assert.ok(!JSON.stringify(notes).match(/Партнёрская программа|вознагражд/i));
});
