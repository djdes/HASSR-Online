import assert from "node:assert/strict";
import test from "node:test";

import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import {
  DEFAULT_CONTROL_PERIODICITY,
  FALLBACK_CONTROL_PERIODICITY,
  LEGACY_DEFAULT_CONTROL_PERIODICITY,
  getDefaultControlPeriodicity,
  readControlPeriodicity,
} from "@/lib/control-periodicity";

test("у каждого журнала каталога своя периодичность контроля", () => {
  // Раньше осмысленный текст был только у 13 журналов, а годовой план
  // обучения, графики поверки и ТО, жалобы и акты забраковки печатали в
  // шапке «Ежесменно, перед началом работы».
  const missing = ACTIVE_JOURNAL_CATALOG.filter(
    (item) => !DEFAULT_CONTROL_PERIODICITY[item.code]
  ).map((item) => item.code);
  assert.deepEqual(missing, []);
});

test("периодичность не совпадает с запасным текстом", () => {
  for (const item of ACTIVE_JOURNAL_CATALOG) {
    assert.notEqual(
      getDefaultControlPeriodicity(item.code),
      FALLBACK_CONTROL_PERIODICITY,
      `journal ${item.code}`
    );
  }
});

test("запасной текст нейтральный, а не «ежесменно»", () => {
  assert.equal(FALLBACK_CONTROL_PERIODICITY, "По мере необходимости.");
  assert.equal(getDefaultControlPeriodicity(null), FALLBACK_CONTROL_PERIODICITY);
  assert.equal(
    getDefaultControlPeriodicity("custom_journal_of_some_org"),
    FALLBACK_CONTROL_PERIODICITY
  );
});

test("тексты периодичности короткие — одна строка шапки бланка", () => {
  // Замечание владельца по печати: длинные формулировки про смены
  // раздували строку «Периодичность контроля» на 2–3 строки.
  for (const [code, text] of Object.entries(DEFAULT_CONTROL_PERIODICITY)) {
    assert.ok(text.length <= 100, `${code}: ${text.length} символов — «${text}»`);
  }
  assert.equal(
    getDefaultControlPeriodicity("hygiene"),
    "Перед каждой сменой — сотрудники производства; остальные — перед входом на участок"
  );
});

test("старый длинный дефолт в config документа читается как новый короткий", () => {
  for (const [code, texts] of Object.entries(LEGACY_DEFAULT_CONTROL_PERIODICITY)) {
    for (const text of texts) {
      assert.equal(
        readControlPeriodicity({ controlPeriodicity: `  ${text.replace(/ /g, "  ")} ` }, code),
        getDefaultControlPeriodicity(code),
        code
      );
    }
  }
  // Свой текст владельца не трогаем, пустую строку — тоже.
  assert.equal(
    readControlPeriodicity({ controlPeriodicity: "Два раза в смену" }, "hygiene"),
    "Два раза в смену"
  );
  assert.equal(readControlPeriodicity({ controlPeriodicity: "" }, "hygiene"), "");
  // Старый дефолт ДРУГОГО журнала — это уже текст владельца.
  const hygieneOld = LEGACY_DEFAULT_CONTROL_PERIODICITY.hygiene[0];
  assert.equal(readControlPeriodicity({ controlPeriodicity: hygieneOld }, "health_check"), hygieneOld);
});
