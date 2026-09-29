import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  linkSphere,
  PERSONAL_CODE_MAX_LENGTH,
  personalCodeCandidate,
  promoLinkRedirect,
  promoLinkUrl,
  suggestPersonalCode,
  transliterateToCode,
} from "@/lib/promo/personal-link";
import { isValidPromoCodeFormat } from "@/lib/promo/rules";

describe("suggestPersonalCode — транслит названия + размер скидки", () => {
  it("«Ромашка» → ROMASHKA10; кавычки и ООО не мешают", () => {
    assert.equal(suggestPersonalCode("Ромашка", 10), "ROMASHKA10");
    assert.equal(suggestPersonalCode("ООО «Ромашка»", 10), "ROMASHKA10");
    assert.equal(suggestPersonalCode("Кафе «Ромашка»", 10), "ROMASHKA10");
    assert.equal(suggestPersonalCode('ИП Иванов "Щука и Ёж"', 15), "SHCHUKAIEZH15");
  });

  it("транслит: только A–Z и 0–9", () => {
    assert.equal(transliterateToCode("Чайхона №1 — Юг!"), "CHAYKHONA1YUG");
    assert.equal(transliterateToCode("Coffee Like"), "COFFEELIKE");
  });

  it("не длиннее 16 знаков вместе со скидкой; рубли — числом", () => {
    const code = suggestPersonalCode("Столовая при заводе металлоконструкций", 10);
    assert.equal(code.length, PERSONAL_CODE_MAX_LENGTH);
    assert.ok(code.endsWith("10"));
    assert.equal(suggestPersonalCode("Ромашка", 500), "ROMASHKA500");
  });

  it("пусто или без букв — случайный «KP7F3Q10» без похожих символов", () => {
    for (const name of [null, undefined, "", "   ", "«»", "№"]) {
      const code = suggestPersonalCode(name, 10);
      assert.match(code, /^KP[2-9A-HJKMNP-Z]{4}10$/);
    }
  });

  it("все варианты проходят isValidPromoCodeFormat", () => {
    for (const name of ["Ромашка", "ООО «Ромашка»", null, "Столовая при заводе металлоконструкций"]) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = personalCodeCandidate(name, 10, attempt, () => 0.42);
        assert.ok(isValidPromoCodeFormat(code), code);
        assert.ok(code.length <= PERSONAL_CODE_MAX_LENGTH, code);
      }
    }
  });

  it("коллизия — суффикс «-2», «-3», код остаётся в 16 знаках", () => {
    assert.equal(personalCodeCandidate("Ромашка", 10, 1), "ROMASHKA10-2");
    assert.equal(personalCodeCandidate("Ромашка", 10, 2), "ROMASHKA10-3");
    const long = personalCodeCandidate("Столовая при заводе металлоконструкций", 10, 1);
    assert.ok(long.endsWith("10-2"));
    assert.equal(long.length, PERSONAL_CODE_MAX_LENGTH);
  });
});

describe("promoLinkUrl — https://wesetup.ru/promo/<CODE>?s=<sphere>", () => {
  it("по умолчанию — боевой адрес, код в верхнем регистре", () => {
    assert.equal(promoLinkUrl("romashka10"), "https://wesetup.ru/promo/ROMASHKA10");
    assert.equal(promoLinkUrl("ROMASHKA10", { sphere: "cafe" }), "https://wesetup.ru/promo/ROMASHKA10?s=cafe");
  });

  it("сфера — только из ORG_SPHERES, иначе без неё", () => {
    assert.equal(promoLinkUrl("ROMASHKA10", { sphere: "Restaurant " }), "https://wesetup.ru/promo/ROMASHKA10?s=restaurant");
    assert.equal(promoLinkUrl("ROMASHKA10", { sphere: "casino" }), "https://wesetup.ru/promo/ROMASHKA10");
    assert.equal(promoLinkUrl("ROMASHKA10", { sphere: null }), "https://wesetup.ru/promo/ROMASHKA10");
  });

  it("baseUrl — для стенда; слэш в конце не удваивается", () => {
    assert.equal(
      promoLinkUrl("ROMASHKA10-2", { baseUrl: "http://localhost:3191/", sphere: "bakery" }),
      "http://localhost:3191/promo/ROMASHKA10-2?s=bakery"
    );
  });

  it("битый код — ошибка вызывающего, а не битая ссылка в письме", () => {
    assert.throws(() => promoLinkUrl(""), /bad promo code/);
    assert.throws(() => promoLinkUrl("ПРОМО"), /bad promo code/);
  });

  it("linkSphere пропускает только значения ORG_SPHERES", () => {
    assert.equal(linkSphere("cafe"), "cafe");
    assert.equal(linkSphere("gas_station"), "gas_station");
    assert.equal(linkSphere("<script>"), null);
    assert.equal(linkSphere(undefined), null);
  });
});

describe("promoLinkRedirect — куда ведёт ссылка", () => {
  it("руководитель — тариф с кодом; сотрудник — оплата с кодом", () => {
    assert.equal(promoLinkRedirect("romashka10", "cafe", "manager"), "/settings/subscription?promo=ROMASHKA10");
    assert.equal(promoLinkRedirect("ROMASHKA10", null, "member"), "/order?plan=monthly&promo=ROMASHKA10");
  });

  it("гость — регистрация со сферой, после неё тариф с кодом", () => {
    const location = promoLinkRedirect("ROMASHKA10", "cafe", "guest");
    const url = new URL(location, "https://wesetup.ru");
    assert.equal(url.pathname, "/register");
    assert.equal(url.searchParams.get("promo"), "ROMASHKA10");
    assert.equal(url.searchParams.get("s"), "cafe");
    assert.equal(url.searchParams.get("next"), "/settings/subscription?promo=ROMASHKA10");
    assert.equal(new URL(promoLinkRedirect("ROMASHKA10", "casino", "guest"), "https://x.ru").searchParams.has("s"), false);
  });
});
