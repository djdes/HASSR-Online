import assert from "node:assert/strict";
import test from "node:test";

import { getDefaultCleaningVentilationConfig } from "@/lib/cleaning-ventilation-checklist-document";

/**
 * Ответственные чек-листа подписаны «Должность - ФИО». Должность —
 * самого человека из справочника, а не «Управляющий / Сотрудник» по роли:
 * в бланке выходило «Управляющий - Ярослав», хотя он «Менеджер».
 */
test("чек-лист: должность ответственных по умолчанию — из карточки", () => {
  const config = getDefaultCleaningVentilationConfig([
    {
      id: "y",
      name: "Ярослав",
      role: "manager",
      jobPosition: { name: "Менеджер", categoryKey: "management" },
    },
  ]);
  assert.equal(config.mainResponsibleUserId, "y");
  assert.equal(config.mainResponsibleTitle, "Менеджер");
  assert.deepEqual(
    config.responsibles.map((item) => item.title),
    ["Менеджер"]
  );
});
