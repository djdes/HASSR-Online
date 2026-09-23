import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { journalFillCodeBlock } from "./journal-fill";

/**
 * JSON-API `/api/journal-fill/…` и общее ядро submit (2026-09-23): журналы
 * объектов (холодильники, склады, УФ-лампы) — только по наклейке на объекте,
 * отключённый в организации журнал — никак. Раньше запрет был только в
 * HTML-маршруте, и хаб «Все журналы» писал в них через JSON-API.
 */
describe("journalFillCodeBlock", () => {
  it("журналы объектов закрыты для QR журнала и хаба", () => {
    for (const code of ["uv_lamp_runtime", "cold_equipment_control", "climate_control"]) {
      const block = journalFillCodeBlock(code, []);
      assert.equal(block?.status, 403, code);
      assert.match(block?.error ?? "", /наклейк/);
    }
  });

  it("отключённый в организации журнал закрыт", () => {
    const block = journalFillCodeBlock("metal_impurity", ["metal_impurity"]);
    assert.deepEqual(block, { status: 403, error: "Этот журнал отключён в организации" });
  });

  it("обычный включённый журнал и мусор в disabledJournalCodes — открыто", () => {
    assert.equal(journalFillCodeBlock("metal_impurity", ["fryer_oil"]), null);
    assert.equal(journalFillCodeBlock("hygiene", null), null);
    assert.equal(journalFillCodeBlock("hygiene", "hygiene"), null);
  });
});
