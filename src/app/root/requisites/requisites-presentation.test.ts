import assert from "node:assert/strict";
import test from "node:test";

import { checklistMessageKey, legacyUploadErrorKey } from "./requisites-presentation";

test("only known checklist IDs map to translation keys; unknown labels remain presentation data", () => {
  assert.equal(checklistMessageKey("bank.bik"), "checklist.bik");
  assert.equal(checklistMessageKey("facsimileFile"), "checklist.facsimile");
  assert.equal(checklistMessageKey("custom"), null);
  assert.equal(checklistMessageKey("toString"), null);
  assert.equal(checklistMessageKey("__proto__"), null);
  const customRussianLabel = "Полное наименование";
  assert.equal(checklistMessageKey(customRussianLabel), null);
});

test("legacy upload diagnostics map only exact known API messages", () => {
  assert.equal(legacyUploadErrorKey("Укажите, что загружаете: подпись или печать"), "errors.imageKind");
  assert.equal(legacyUploadErrorKey("Файл не получен"), "errors.fileMissing");
  assert.equal(legacyUploadErrorKey("Файл больше 1 МБ — уменьшите картинку"), "errors.fileTooLarge");
  assert.equal(legacyUploadErrorKey("Нужен PNG с прозрачным фоном"), "errors.invalidPng");
  assert.equal(legacyUploadErrorKey("custom backend diagnostic"), null);
  assert.equal(legacyUploadErrorKey("toString"), null);
});
