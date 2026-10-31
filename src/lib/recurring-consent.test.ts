import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { RECURRING_CHARGES_LIVE, effectiveRecurringConsent } from "@/lib/recurring-consent";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("автопродление без автосписаний", () => {
  it("пока списаний нет, согласие из запроса или ссылки не включает автоплатёж", () => {
    assert.equal(RECURRING_CHARGES_LIVE, false);
    assert.equal(effectiveRecurringConsent(true), false);
    assert.equal(effectiveRecurringConsent(false), false);
  });

  it("флаг включён — согласие действует как раньше, без галочки платёж разовый", () => {
    assert.equal(effectiveRecurringConsent(true, true), true);
    assert.equal(effectiveRecurringConsent(false, true), false);
  });

  it("сервер, страница заказа и кабинет смотрят на один флаг", () => {
    assert.match(read("src/app/api/payments/robokassa/create/route.ts"), /effectiveRecurringConsent\(body\.recurringConsent === true\)/);
    assert.match(read("src/app/order/page.tsx"), /recurringDefault=\{effectiveRecurringConsent\(first\("recurring"\) === "1"\)\}/);
    const client = read("src/app/order/order-client.tsx");
    assert.match(client, /const autopay = RECURRING_CHARGES_LIVE && recurringConsent/);
    assert.match(client, /\{!RECURRING_CHARGES_LIVE \|\| plan\?\.kind === "upgrade"/);
    const page = read("src/app/(dashboard)/settings/subscription/page.tsx");
    assert.match(page, /!RECURRING_CHARGES_LIVE && kind === "paid" && nextChargeAt \? \(\s*<RenewalCard/);
    assert.match(page, /RECURRING_CHARGES_LIVE && \(\(kind === "paid" && renewTarget\) \|\| org\?\.recurringActive === true\) \? \(\s*<RecurringCard/);
  });

  it("карточка «Продление» не обещает списаний и называет напоминания — на трёх языках", () => {
    for (const locale of ["ru", "en", "uz"] as const) {
      const messages = JSON.parse(read(`src/i18n/messages/${locale}.json`)) as {
        settingsUi: { renewalCard: { title: string; body: string; renew: string } };
      };
      const card = messages.settingsUi.renewalCard;
      assert.ok(card.title && card.renew, locale);
      assert.match(card.body, /<strong>\{date\}<\/strong>/, locale);
      assert.match(card.body, /7, 3/, locale);
    }
    const ru = JSON.parse(read("src/i18n/messages/ru.json")) as { settingsUi: { renewalCard: { body: string } } };
    assert.match(ru.settingsUi.renewalCard.body, /Автоматических списаний нет/);
  });
});
