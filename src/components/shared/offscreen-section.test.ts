import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { offscreenSectionStyle } from "@/components/shared/offscreen-section";

describe("offscreenSectionStyle", () => {
  it("до первого показа — заглушка с оценочной высотой", () => {
    assert.deepEqual(offscreenSectionStyle({ show: false, far: false, estimatedHeight: 1234.4 }), { minHeight: 1234 });
  });

  it("рядом с экраном — обычная отрисовка, высота запоминается", () => {
    assert.deepEqual(offscreenSectionStyle({ show: true, far: false, estimatedHeight: 900 }), {
      contentVisibility: "visible",
      containIntrinsicHeight: "auto 900px",
    });
  });

  it("далеко от экрана — пропуск стилей и раскладки без сдвига страницы", () => {
    assert.deepEqual(offscreenSectionStyle({ show: true, far: true, estimatedHeight: 900 }), {
      contentVisibility: "hidden",
      containIntrinsicHeight: "auto 900px",
    });
  });

  it("отрицательная оценка не ломает стиль", () => {
    assert.deepEqual(offscreenSectionStyle({ show: false, far: false, estimatedHeight: -5 }), { minHeight: 0 });
  });
});
