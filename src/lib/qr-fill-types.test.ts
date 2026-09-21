import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { posterSubtitleLine } from "./qr-fill-types";

describe("posterSubtitleLine", () => {
  it("ставит организацию перед контекстом", () => {
    assert.equal(
      posterSubtitleLine({ orgName: "МБОУ Гимназия", subtitle: "Основное производство" }),
      "МБОУ Гимназия · Основное производство",
    );
  });

  it("не дублирует, когда точка названа как организация", () => {
    assert.equal(
      posterSubtitleLine({ orgName: "МБОУ Гимназия", subtitle: "мбоу гимназия" }),
      "МБОУ Гимназия",
    );
  });

  it("организация одна, если контекста нет", () => {
    assert.equal(posterSubtitleLine({ orgName: "МБОУ Гимназия", subtitle: "  " }), "МБОУ Гимназия");
  });

  it("контекст один, если организация не задана", () => {
    assert.equal(posterSubtitleLine({ orgName: "", subtitle: "Склад" }), "Склад");
  });
});
