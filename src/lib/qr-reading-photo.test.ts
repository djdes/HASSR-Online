import test from "node:test";
import assert from "node:assert/strict";

import { readingTariffsHref } from "./qr-reading-photo";
import { TARIFFS_HREF } from "./reading-photos";

const BROWSER = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/139.0 Mobile Safari/537.36";
const APP = `${BROWSER} WeSetupApp/1.0.0 (android)`;
const IOS_APP = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 WeSetupApp/1.2 (ios)";

test("ссылка на тарифы: руководителю на бесплатном тарифе в браузере", () => {
  assert.equal(readingTariffsHref({ autofill: false, mayOpenTariffs: true, userAgent: BROWSER }), TARIFFS_HREF);
  assert.equal(readingTariffsHref({ autofill: false, mayOpenTariffs: true, userAgent: null }), TARIFFS_HREF);
});

test("ссылки на тарифы нет: платный тариф или не руководитель", () => {
  assert.equal(readingTariffsHref({ autofill: true, mayOpenTariffs: true, userAgent: BROWSER }), null);
  assert.equal(readingTariffsHref({ autofill: false, mayOpenTariffs: false, userAgent: BROWSER }), null);
});

test("в приложении WeSetup ссылки на тарифы нет (правила магазинов)", () => {
  assert.equal(readingTariffsHref({ autofill: false, mayOpenTariffs: true, userAgent: APP }), null);
  assert.equal(readingTariffsHref({ autofill: false, mayOpenTariffs: true, userAgent: IOS_APP }), null);
});
