import test from "node:test";
import assert from "node:assert/strict";

import { AUTOFILL_DESCRIPTION, autofillToast } from "./journals-autofill";

test("текст шторки — формулировка владельца", () => {
  assert.equal(
    AUTOFILL_DESCRIPTION,
    "Создадим или дозаполним записи во всех журналах по прошлым данным, если за сегодня их нет. Уже введённые данные не тронем."
  );
});

test("тост со счётчиками журналов и отметок", () => {
  const toast = autofillToast({
    totalFilled: 12,
    documentsCreated: 1,
    processed: 5,
    upToKey: "2026-09-25",
    summaries: [{ filled: 5 }, { filled: 7 }, { filled: 0 }],
  });
  assert.equal(toast.kind, "success");
  assert.equal(toast.title, "Заполнено: 2 журнала, 12 отметок, создано 1 документ");
  assert.ok(toast.kind === "success" && toast.description.startsWith("По 25 сентября"));
});

test("нечего заполнять — спокойное сообщение, без успеха", () => {
  assert.deepEqual(
    autofillToast({ totalFilled: 0, documentsCreated: 0, processed: 3, upToKey: "2026-09-25", summaries: [] }),
    { kind: "info", title: "Всё уже заполнено — за сегодня пустых записей нет." }
  );
  assert.equal(
    autofillToast({ totalFilled: 0, documentsCreated: 0, processed: 0, upToKey: "2026-09-25", summaries: [] }).title,
    "Нет ежедневных журналов для заполнения."
  );
});
