/**
 * Правила автогашения.
 *
 * Тест закрепляет договорённость, ради которой он и написан: по
 * умолчанию мы НЕ гасим ВСД сами, и каждое ослабление этого правила
 * должно быть видно в диффе.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canAutoProcess, normalizeAutoProcessMode } from "@/lib/mercury/access";
import { entitlementsFor } from "@/lib/tariff-plans";

describe("«Меркурий» — возможность «Премиума»", () => {
  it("«Премиум», пробный, прежняя «Подписка», демо и платформа — да; бесплатный и «Стандарт» — нет", () => {
    assert.equal(entitlementsFor("premium").features.mercury, true);
    assert.equal(entitlementsFor("trial").features.mercury, true);
    assert.equal(entitlementsFor("legacy_paid").features.mercury, true);
    assert.equal(entitlementsFor("exempt").features.mercury, true);
    assert.equal(entitlementsFor("unrestricted").features.mercury, true);
    assert.equal(entitlementsFor("standard").features.mercury, false);
    assert.equal(entitlementsFor("free").features.mercury, false);
  });
});

describe("normalizeAutoProcessMode", () => {
  it("по умолчанию assisted, а не автогашение", () => {
    assert.equal(normalizeAutoProcessMode(undefined), "assisted");
    assert.equal(normalizeAutoProcessMode("что-то левое"), "assisted");
    assert.equal(normalizeAutoProcessMode("off"), "off");
    assert.equal(normalizeAutoProcessMode("auto_after_journal"), "auto_after_journal");
  });
});

describe("canAutoProcess", () => {
  const base = {
    mode: "auto_after_journal" as const,
    journalRowAccepted: true,
    volumeMatches: true,
    supplierInn: "504712345678",
    allowedSupplierInns: ["504712345678"],
  };

  it("все условия сошлись — можно", () => {
    assert.equal(canAutoProcess(base).allowed, true);
  });

  it("в режимах off и assisted не гасим никогда", () => {
    assert.equal(canAutoProcess({ ...base, mode: "off" }).allowed, false);
    assert.equal(canAutoProcess({ ...base, mode: "assisted" }).allowed, false);
  });

  it("без заполненной строки журнала — не гасим", () => {
    const r = canAutoProcess({ ...base, journalRowAccepted: false });
    assert.equal(r.allowed, false);
    assert.match(r.reason, /входного контроля/);
  });

  it("расхождение по объёму возвращает решение человеку", () => {
    const r = canAutoProcess({ ...base, volumeMatches: false });
    assert.equal(r.allowed, false);
    assert.match(r.reason, /объём/);
  });

  it("поставщик вне белого списка — не гасим", () => {
    assert.equal(
      canAutoProcess({ ...base, supplierInn: "7714345678" }).allowed,
      false,
    );
    assert.equal(canAutoProcess({ ...base, allowedSupplierInns: [] }).allowed, false);
    assert.equal(canAutoProcess({ ...base, supplierInn: null }).allowed, false);
  });
});
