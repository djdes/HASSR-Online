import assert from "node:assert/strict";
import test from "node:test";

import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import {
  DEFAULT_CONTROL_PERIODICITY,
  FALLBACK_CONTROL_PERIODICITY,
  getDefaultControlPeriodicity,
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
