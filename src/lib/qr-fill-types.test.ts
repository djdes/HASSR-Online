import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { posterDetailLine } from "./qr-fill-types";

describe("posterDetailLine", () => {
  it("у объекта — только норма (организация печатается строкой выше)", () => {
    assert.equal(posterDetailLine({ subtitle: "", norms: ["18…22 °C", "40…55 %"] }), "норма 18…22 °C, 40…55 %");
  });

  it("у журнала — краткая инструкция", () => {
    assert.equal(posterDetailLine({ subtitle: "Запись в журнал с телефона", norms: [] }), "Запись в журнал с телефона");
  });

  it("инструкция и норма — через разделитель", () => {
    assert.equal(
      posterDetailLine({ subtitle: "Гигиенический журнал", norms: ["0…4 °C"] }),
      "Гигиенический журнал · норма 0…4 °C",
    );
  });

  it("пусто, когда нечего показать", () => {
    assert.equal(posterDetailLine({ subtitle: "  ", norms: [] }), "");
  });
});
