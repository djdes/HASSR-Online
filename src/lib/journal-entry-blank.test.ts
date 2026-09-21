import assert from "node:assert/strict";
import test from "node:test";

import { isBlankEntryData } from "@/lib/journal-entry-blank";

test("заготовка сидера — пустая запись", () => {
  assert.equal(isBlankEntryData({ _autoSeeded: true }), true);
  // PDF заранее обнуляет заготовку до `{}` — это тоже пустая запись.
  assert.equal(isBlankEntryData({}), true);
  assert.equal(isBlankEntryData(null), true);
  assert.equal(isBlankEntryData(undefined), true);
});

test("поля без значений — пустая запись", () => {
  assert.equal(
    isBlankEntryData({ itemName: "", quantity: "   ", damageInfo: null }),
    true
  );
  assert.equal(isBlankEntryData({ photos: [], extra: {} }), true);
});

test("осознанный ответ человека — запись НЕ пустая", () => {
  // Сохранённый «повреждений нет»: флажок снят человеком, а не дефолт.
  assert.equal(
    isBlankEntryData({
      damagesDetected: false,
      itemName: "",
      quantity: "",
      damageInfo: "",
    }),
    false
  );
  assert.equal(isBlankEntryData({ temperature: 0 }), false);
  assert.equal(isBlankEntryData({ itemName: "Стакан" }), false);
  // Заготовка + реальное поле — уже заполнено.
  assert.equal(isBlankEntryData({ _autoSeeded: true, itemName: "Лампа" }), false);
});
